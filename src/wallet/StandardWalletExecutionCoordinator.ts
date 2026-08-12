import type { NetworkId } from '../core/chain';
import { BlockchainDiagnostics } from '../observability';
import type { OperationContext } from '../observability';
import { WalletExecutionError } from './errors';
import type {
    StandardWalletReplayReader,
    SubmissionReference,
    SubmissionReferenceStore,
    TransactionBroadcaster,
    TransactionConfirmer,
    WalletExecutionCoordinator,
    WalletExecutionOptions,
    WalletExecutionRequest,
    WalletExecutionResult,
    WalletSigner,
} from './types';
import { assertWalletExecutionRequest } from './validation';

const DEFAULT_MAX_FUTURE_SECONDS = 300;

export interface StandardWalletExecutionCoordinatorOptions {
    readonly network: NetworkId;
    readonly replayReader: StandardWalletReplayReader;
    readonly signer: WalletSigner;
    readonly broadcaster: TransactionBroadcaster;
    readonly store: SubmissionReferenceStore;
    readonly confirmer: TransactionConfirmer;
    readonly diagnostics?: BlockchainDiagnostics;
    /** Injected Unix clock in seconds for request validation. */
    readonly clock?: () => number;
    readonly maxFutureSeconds?: number;
}

/**
 * Composes the inactive standard-wallet boundary without duplicating protocol work.
 *
 * A request is validated before replay acquisition. Signing remains transient,
 * submission is attempted exactly once by the broadcaster, and only secret-free
 * references cross persistence/confirmation boundaries. Ambiguous submission is
 * persisted and confirmed using the broadcaster's safe recovery reference; it is
 * never automatically resubmitted.
 */
export class StandardWalletExecutionCoordinator implements WalletExecutionCoordinator {
    public readonly network: NetworkId;
    private readonly replayReader: StandardWalletReplayReader;
    private readonly signer: WalletSigner;
    private readonly broadcaster: TransactionBroadcaster;
    private readonly store: SubmissionReferenceStore;
    private readonly confirmer: TransactionConfirmer;
    private readonly diagnostics: BlockchainDiagnostics;
    private readonly clock: () => number;
    private readonly maxFutureSeconds: number;

    public constructor(options: StandardWalletExecutionCoordinatorOptions) {
        this.network = options.network;
        this.replayReader = options.replayReader;
        this.signer = options.signer;
        this.broadcaster = options.broadcaster;
        this.store = options.store;
        this.confirmer = options.confirmer;
        this.diagnostics = options.diagnostics ?? new BlockchainDiagnostics();
        this.clock = options.clock ?? (() => Math.floor(Date.now() / 1000));
        this.maxFutureSeconds = options.maxFutureSeconds ?? DEFAULT_MAX_FUTURE_SECONDS;

        if (this.replayReader.network !== this.network
            || this.broadcaster.network !== this.network
            || this.confirmer.network !== this.network) {
            throw new WalletExecutionError(
                'WALLET_NETWORK_MISMATCH',
                'Wallet execution components must use the same TON network.',
            );
        }
        if (!Number.isSafeInteger(this.maxFutureSeconds) || this.maxFutureSeconds <= 0) {
            throw new WalletExecutionError(
                'INVALID_WALLET_REQUEST',
                'The wallet execution validity limit is invalid.',
            );
        }
    }

    public async execute(
        request: WalletExecutionRequest,
        options: WalletExecutionOptions = {},
    ): Promise<WalletExecutionResult> {
        const lifecycle = this.diagnostics.start('transaction', lifecycleAttributes(request), request.correlationId);

        try {
            const nowUnix = this.clock();
            assertWalletExecutionRequest(request, {
                nowUnix,
                maxFutureSeconds: this.maxFutureSeconds,
            });
            if (request.network !== this.network) {
                throw new WalletExecutionError(
                    'WALLET_NETWORK_MISMATCH',
                    'The wallet execution request belongs to a different TON network.',
                );
            }
            if (request.wallet.kind !== 'standard' || !this.signer.supports(request.wallet)) {
                throw new WalletExecutionError(
                    'UNSUPPORTED_WALLET',
                    'This coordinator supports configured standard-wallet signers only.',
                );
            }

            const replay = await this.readReplay(request, lifecycle);
            const envelope = await this.sign(request, replay.seqno, lifecycle);
            const submission = await this.submitOrRecover(envelope, options, lifecycle);
            await this.persist(submission.reference, lifecycle);
            await this.notifySubmitted(submission.reference, options.onSubmitted, lifecycle);
            const confirmation = await this.confirm(submission.reference, options, lifecycle);

            this.completeLifecycle(lifecycle, confirmation.state, submission.ambiguous);
            return Object.freeze({
                reference: submission.reference,
                confirmation,
            });
        } catch (error) {
            this.failLifecycle(lifecycle, error);
            throw error;
        }
    }

    private async readReplay(request: WalletExecutionRequest, lifecycle: OperationContext) {
        const context = this.diagnostics.start('rpc', {
            network: this.network,
            rpcMethod: 'walletReplayState',
            walletVersion: request.wallet.version,
        }, lifecycle.correlationId);
        try {
            const replay = await this.replayReader.read(request.wallet as Extract<typeof request.wallet, { kind: 'standard' }>);
            this.diagnostics.succeed(context, { replayType: replay.kind });
            return replay;
        } catch (error) {
            this.diagnostics.fail(context, error);
            throw error;
        }
    }

    private async sign(request: WalletExecutionRequest, seqno: number, lifecycle: OperationContext) {
        const context = this.diagnostics.start('signing', {
            network: this.network,
            walletVersion: request.wallet.version,
            messageCount: request.messages.length,
        }, lifecycle.correlationId);
        try {
            const envelope = await this.signer.sign(request, { kind: 'seqno', seqno });
            this.diagnostics.succeed(context);
            return envelope;
        } catch (error) {
            this.diagnostics.fail(context, error);
            throw error;
        }
    }

    private async submitOrRecover(
        envelope: Awaited<ReturnType<WalletSigner['sign']>>,
        options: WalletExecutionOptions,
        lifecycle: OperationContext,
    ): Promise<{ readonly reference: SubmissionReference; readonly ambiguous: boolean }> {
        const context = this.diagnostics.start('submission', {
            network: this.network,
            walletVersion: envelope.walletVersion,
        }, lifecycle.correlationId);
        try {
            const reference = await this.broadcaster.submit(
                envelope,
                options.transientCapture === undefined
                    ? {}
                    : { transientCapture: options.transientCapture },
            );
            this.diagnostics.succeed(context, { submissionId: reference.submissionId });
            return { reference, ambiguous: false };
        } catch (error) {
            if (error instanceof WalletExecutionError
                && error.code === 'SUBMISSION_AMBIGUOUS'
                && error.submissionReference !== null) {
                this.diagnostics.pending(context, {
                    submissionId: error.submissionReference.submissionId,
                    outcome: 'ambiguous',
                });
                return { reference: error.submissionReference, ambiguous: true };
            }
            this.diagnostics.fail(context, error);
            throw error;
        }
    }

    private async persist(reference: SubmissionReference, lifecycle: OperationContext): Promise<void> {
        try {
            await this.store.put(reference);
        } catch (cause) {
            if (cause instanceof WalletExecutionError
                && cause.code === 'REFERENCE_STORE_FAILED'
                && cause.submissionReference !== null) {
                throw cause;
            }
            throw new WalletExecutionError(
                'REFERENCE_STORE_FAILED',
                'The submission was attempted but its recovery reference could not be persisted.',
                { retryable: true, cause, submissionReference: reference },
            );
        }
        this.diagnostics.pending(lifecycle, {
            submissionId: reference.submissionId,
            lifecycleState: 'submitted',
        });
    }

    private async notifySubmitted(
        reference: SubmissionReference,
        hook: WalletExecutionOptions['onSubmitted'],
        lifecycle: OperationContext,
    ): Promise<void> {
        if (hook === undefined) return;
        try {
            await hook(reference);
        } catch (cause) {
            throw new WalletExecutionError(
                'POST_SUBMISSION_HOOK_FAILED',
                'The submission was accepted but feature recovery metadata could not be persisted.',
                { retryable: true, cause, submissionReference: reference },
            );
        }
        this.diagnostics.pending(lifecycle, {
            submissionId: reference.submissionId,
            lifecycleState: 'featureRecoveryPersisted',
        });
    }

    private async confirm(
        reference: SubmissionReference,
        options: WalletExecutionOptions,
        lifecycle: OperationContext,
    ) {
        const context = this.diagnostics.start('confirmation', {
            network: this.network,
            walletVersion: reference.walletVersion,
            submissionId: reference.submissionId,
        }, lifecycle.correlationId);
        try {
            const confirmation = await this.confirmer.confirm(reference, options.confirmation);
            if (confirmation.state === 'confirmed') {
                this.diagnostics.succeed(context, {
                    confirmationState: confirmation.state,
                    txHash: confirmation.txHash,
                    exitCode: confirmation.exitCode,
                });
            } else if (confirmation.state === 'pending' || confirmation.state === 'unknown') {
                this.diagnostics.pending(context, { confirmationState: confirmation.state });
            } else {
                this.diagnostics.fail(
                    context,
                    new WalletExecutionError('CONFIRMATION_FAILED', 'The wallet transaction failed on-chain.'),
                    { confirmationState: confirmation.state, txHash: confirmation.txHash, exitCode: confirmation.exitCode },
                );
            }
            return confirmation;
        } catch (error) {
            if (error instanceof WalletExecutionError && error.code === 'CONFIRMATION_CANCELLED') {
                this.diagnostics.cancel(context);
            } else if (error instanceof WalletExecutionError && error.code === 'CONFIRMATION_TIMEOUT') {
                this.diagnostics.timeout(context, error);
            } else {
                this.diagnostics.fail(context, error);
            }
            throw error;
        }
    }

    private completeLifecycle(
        lifecycle: OperationContext,
        state: WalletExecutionResult['confirmation']['state'],
        ambiguous: boolean,
    ): void {
        const attributes = { confirmationState: state, submissionAmbiguous: ambiguous };
        if (state === 'confirmed') {
            this.diagnostics.succeed(lifecycle, attributes);
        } else if (state === 'pending' || state === 'unknown') {
            this.diagnostics.pending(lifecycle, attributes);
        } else {
            this.diagnostics.fail(
                lifecycle,
                new WalletExecutionError('CONFIRMATION_FAILED', 'The wallet transaction failed on-chain.'),
                attributes,
            );
        }
    }

    private failLifecycle(lifecycle: OperationContext, error: unknown): void {
        if (error instanceof WalletExecutionError && error.code === 'CONFIRMATION_CANCELLED') {
            this.diagnostics.cancel(lifecycle);
        } else if (error instanceof WalletExecutionError && error.code === 'CONFIRMATION_TIMEOUT') {
            this.diagnostics.timeout(lifecycle, error);
        } else {
            this.diagnostics.fail(lifecycle, error);
        }
    }
}

function lifecycleAttributes(request: WalletExecutionRequest): Readonly<Record<string, unknown>> {
    return {
        network: request.network,
        walletVersion: request.wallet.version,
        walletKind: request.wallet.kind,
        messageCount: request.messages.length,
    };
}
