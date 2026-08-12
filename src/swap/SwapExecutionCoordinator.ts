import type { NetworkId } from '../core/chain';
import { isSameAddress, parseAddress } from '../core/address';
import { BlockchainDiagnostics } from '../observability';
import type { OperationContext } from '../observability';
import type {
    WalletDescriptor,
    SubmissionReference,
    WalletExecutionCoordinator,
    WalletExecutionOptions,
    WalletExecutionRequest,
    WalletExecutionResult,
} from '../wallet';
import { WalletExecutionError } from '../wallet';

import { SwapEngine } from './SwapEngine';
import type {
    PrepareOptions,
    PreparedSwap,
    WaitForOutcomeOptions,
} from './SwapEngine';
import { SwapError, SwapErrorCode } from './errors';
import type {
    PendingSwapReference,
    PendingSwapReferenceStore,
    SwapOutcome,
    SwapQuote,
} from './types';
import { toUnsignedWalletMessages } from './walletAdapter';

const MAX_CORRELATION_ID_LENGTH = 128;

export interface SwapExecutionCoordinatorOptions {
    readonly network: NetworkId;
    readonly engine: SwapEngine;
    readonly wallet: WalletExecutionCoordinator;
    readonly recoveryStore: PendingSwapReferenceStore;
    readonly diagnostics?: BlockchainDiagnostics;
    /** Injected wall clock used to validate the prepared plan at execution time. */
    readonly clock: () => number;
}

export interface ExecuteSwapRequest {
    readonly quote: SwapQuote;
    readonly wallet: WalletDescriptor;
    readonly correlationId: string;
    readonly prepare?: Omit<PrepareOptions, 'walletAddress'>;
}

export type SwapExecutionProgressStage =
    | 'preparing'
    | 'signing'
    | 'submitted'
    | 'wallet-pending'
    | 'wallet-confirmed'
    | 'dex-pending';

/** Metadata-only progress emitted by the inactive execution coordinator. */
export interface SwapExecutionProgress {
    readonly stage: SwapExecutionProgressStage;
    readonly network: NetworkId;
    readonly providerId: string;
    readonly correlationId: string;
    readonly submissionId: string | null;
}

export interface ExecuteSwapOptions {
    readonly wallet?: WalletExecutionOptions;
    readonly outcome?: WaitForOutcomeOptions;
    /** Best-effort UI progress observer. Observer failures never affect execution. */
    readonly onProgress?: (progress: SwapExecutionProgress) => void;
}

/**
 * Result of one inactive swap lifecycle.
 *
 * Wallet inclusion and DEX execution are deliberately separate. `state` becomes
 * `succeeded` only when both boundaries are definitive; wallet confirmation by
 * itself can produce only `pending`, `failed`, or `unknown`.
 */
export type SwapExecutionResult =
    | {
          readonly state: 'succeeded';
          readonly prepared: PreparedSwap;
          readonly wallet: WalletExecutionResult;
          readonly outcome: SwapOutcome;
      }
    | {
          readonly state: 'pending' | 'failed' | 'unknown';
          readonly prepared: PreparedSwap;
          readonly wallet: WalletExecutionResult;
          readonly outcome: SwapOutcome | null;
      };

/**
 * Compose validated swap preparation, standard-wallet execution, and DEX outcome
 * confirmation without moving any protocol work into React.
 *
 * The coordinator does not quote, rebuild payload cells, sign, broadcast, or
 * classify provider-specific status itself. It wires the existing audited
 * boundaries in order and preserves the DEX `query_id` independently from the
 * wallet's seqno replay protection.
 */
export class SwapExecutionCoordinator {
    public readonly network: NetworkId;
    private readonly engine: SwapEngine;
    private readonly wallet: WalletExecutionCoordinator;
    private readonly recoveryStore: PendingSwapReferenceStore;
    private readonly diagnostics: BlockchainDiagnostics;
    private readonly clock: () => number;

    public constructor(options: SwapExecutionCoordinatorOptions) {
        this.network = options.network;
        this.engine = options.engine;
        this.wallet = options.wallet;
        this.recoveryStore = options.recoveryStore;
        this.diagnostics = options.diagnostics ?? new BlockchainDiagnostics();
        this.clock = options.clock;

        if (this.engine.network !== this.network || this.wallet.network !== this.network) {
            throw new WalletExecutionError(
                'WALLET_NETWORK_MISMATCH',
                'Swap and wallet execution components must use the same TON network.',
            );
        }
    }

    public async execute(
        request: ExecuteSwapRequest,
        options: ExecuteSwapOptions = {},
    ): Promise<SwapExecutionResult> {
        assertCorrelationId(request.correlationId);
        parseAddress(request.wallet.address);

        const lifecycle = this.diagnostics.start('transaction', {
            network: this.network,
            providerId: request.quote.providerId,
            walletVersion: request.wallet.version,
            walletKind: request.wallet.kind,
        }, request.correlationId);

        try {
            this.progress(options.onProgress, request, 'preparing');
            const prepared = await this.prepare(request, lifecycle);
            const outcomeBaselineUnits = await this.engine.snapshotAssetBalance(
                prepared.plan.quote.to,
                request.wallet.address,
            );
            this.progress(options.onProgress, request, 'signing');
            const walletResult = await this.executeWallet(request, prepared, options.wallet, lifecycle, options.onProgress);
            const walletStage = walletProgressStage(walletResult.confirmation.state);
            if (walletStage !== null) {
                this.progress(
                    options.onProgress,
                    request,
                    walletStage,
                    walletResult.reference.submissionId,
                );
            }
            if (walletResult.confirmation.state === 'confirmed') {
                this.progress(options.onProgress, request, 'dex-pending', walletResult.reference.submissionId);
            }
            const result = await this.resolveOutcome(
                prepared,
                walletResult,
                options.outcome,
                lifecycle,
                outcomeBaselineUnits,
            );
            this.complete(lifecycle, result);
            return result;
        } catch (error) {
            this.fail(lifecycle, error, options.outcome?.signal);
            throw error;
        }
    }

    private async prepare(request: ExecuteSwapRequest, lifecycle: OperationContext): Promise<PreparedSwap> {
        const context = this.diagnostics.start('payload_build', {
            network: this.network,
            providerId: request.quote.providerId,
        }, lifecycle.correlationId);
        try {
            const prepared = await this.engine.prepare(request.quote, {
                ...request.prepare,
                walletAddress: request.wallet.address,
            });
            this.diagnostics.succeed(context, {
                providerId: prepared.plan.providerId,
                messageCount: prepared.plan.messages.length,
                routeHopCount: prepared.plan.quote.route.length,
            });
            return prepared;
        } catch (error) {
            this.diagnostics.fail(context, error);
            throw error;
        }
    }

    private async executeWallet(
        request: ExecuteSwapRequest,
        prepared: PreparedSwap,
        options: WalletExecutionOptions | undefined,
        lifecycle: OperationContext,
        progress: ExecuteSwapOptions['onProgress'],
    ): Promise<WalletExecutionResult> {
        const nowMs = this.clock();
        const validUntilUnix = Math.floor(prepared.plan.expiresAtMs / 1_000);
        if (prepared.plan.expiresAtMs <= nowMs || validUntilUnix <= Math.floor(nowMs / 1_000)) {
            throw new SwapError(
                SwapErrorCode.QuoteExpired,
                'This prepared swap expired before wallet approval. Refresh the quote before signing.',
                { severity: 'warning', retryable: true, providerId: prepared.plan.providerId },
            );
        }
        if (!isSameAddress(prepared.plan.reference.ownerAddress, request.wallet.address)) {
            throw new SwapError(
                SwapErrorCode.MalformedTransaction,
                'The prepared swap reference belongs to a different signing wallet.',
                { severity: 'suspicious', providerId: prepared.plan.providerId },
            );
        }

        const walletRequest: WalletExecutionRequest = Object.freeze({
            network: this.network,
            wallet: request.wallet,
            messages: toUnsignedWalletMessages(prepared.plan.messages),
            validUntilUnix,
            correlationId: request.correlationId,
        });
        const walletOptions: WalletExecutionOptions = Object.freeze({
            ...(options?.confirmation === undefined
                ? {}
                : { confirmation: options.confirmation }),
            onSubmitted: async (reference: SubmissionReference) => {
                await this.persistRecovery(prepared, reference, lifecycle);
                await options?.onSubmitted?.(reference);
                this.progress(progress, request, 'submitted', reference.submissionId);
            },
        });
        return this.wallet.execute(walletRequest, walletOptions);
    }

    private async persistRecovery(
        prepared: PreparedSwap,
        submission: SubmissionReference,
        lifecycle: OperationContext,
    ): Promise<void> {
        const recovery: PendingSwapReference = Object.freeze({
            schemaVersion: 1,
            network: this.network,
            submission,
            swap: prepared.plan.reference,
        });
        await this.recoveryStore.put(recovery);
        this.diagnostics.pending(lifecycle, {
            providerId: prepared.plan.providerId,
            submissionId: submission.submissionId,
            lifecycleState: 'swapRecoveryPersisted',
        });
    }

    private async resolveOutcome(
        prepared: PreparedSwap,
        walletResult: WalletExecutionResult,
        options: WaitForOutcomeOptions | undefined,
        lifecycle: OperationContext,
        outcomeBaselineUnits: bigint,
    ): Promise<SwapExecutionResult> {
        const walletState = walletResult.confirmation.state;
        if (walletState !== 'confirmed') {
            if (walletState === 'failed') {
                await this.removeRecovery(walletResult.reference.submissionId, prepared, lifecycle);
            }
            return Object.freeze({
                state: walletState,
                prepared,
                wallet: walletResult,
                outcome: null,
            });
        }

        const context = this.diagnostics.start('confirmation', {
            network: this.network,
            providerId: prepared.plan.providerId,
            confirmationPhase: 'dexOutcome',
        }, lifecycle.correlationId);
        try {
            const outcome = await this.engine.waitForOutcome(prepared.plan.reference, {
                ...options,
                balanceFallback: Object.freeze({
                    ownerAddress: prepared.plan.reference.ownerAddress,
                    asset: prepared.plan.quote.to,
                    minReceivedUnits: prepared.plan.quote.minOutUnits,
                    baselineUnits: outcomeBaselineUnits,
                }),
            });
            this.recordOutcome(context, outcome);
            if (outcome.state === 'succeeded' || outcome.state === 'failed') {
                await this.removeRecovery(walletResult.reference.submissionId, prepared, lifecycle);
            }
            return Object.freeze({
                state: outcome.state,
                prepared,
                wallet: walletResult,
                outcome,
            });
        } catch (error) {
            if (isCancelled(error, options?.signal)) {
                this.diagnostics.cancel(context);
            } else {
                this.diagnostics.fail(context, error);
            }
            throw error;
        }
    }

    private async removeRecovery(
        submissionId: string,
        prepared: PreparedSwap,
        lifecycle: OperationContext,
    ): Promise<void> {
        await this.recoveryStore.remove(this.network, submissionId);
        this.diagnostics.pending(lifecycle, {
            providerId: prepared.plan.providerId,
            submissionId,
            lifecycleState: 'swapRecoveryRemoved',
        });
    }

    private recordOutcome(context: OperationContext, outcome: SwapOutcome): void {
        const attributes = {
            outcome: outcome.state,
            txHash: outcome.txHash,
            exitCode: outcome.exitCode,
        };
        if (outcome.state === 'succeeded') {
            this.diagnostics.succeed(context, attributes);
        } else if (outcome.state === 'pending' || outcome.state === 'unknown') {
            this.diagnostics.pending(context, attributes);
        } else {
            this.diagnostics.fail(
                context,
                new SwapError(SwapErrorCode.SwapReverted, 'The DEX rejected this swap.'),
                attributes,
            );
        }
    }

    private progress(
        observer: ExecuteSwapOptions['onProgress'],
        request: ExecuteSwapRequest,
        stage: SwapExecutionProgressStage,
        submissionId: string | null = null,
    ): void {
        if (observer === undefined) return;
        try {
            observer(Object.freeze({
                stage,
                network: this.network,
                providerId: request.quote.providerId,
                correlationId: request.correlationId,
                submissionId,
            }));
        } catch {
            // UI observers are best-effort and cannot change signing or submission.
        }
    }

    private complete(lifecycle: OperationContext, result: SwapExecutionResult): void {
        const attributes = {
            providerId: result.prepared.plan.providerId,
            walletConfirmationState: result.wallet.confirmation.state,
            outcome: result.state,
        };
        if (result.state === 'succeeded') {
            this.diagnostics.succeed(lifecycle, attributes);
        } else if (result.state === 'pending' || result.state === 'unknown') {
            this.diagnostics.pending(lifecycle, attributes);
        } else {
            this.diagnostics.fail(
                lifecycle,
                new SwapError(SwapErrorCode.SwapReverted, 'The swap did not complete successfully.'),
                attributes,
            );
        }
    }

    private fail(lifecycle: OperationContext, error: unknown, signal?: AbortSignal): void {
        if (isCancelled(error, signal)) {
            this.diagnostics.cancel(lifecycle);
        } else {
            this.diagnostics.fail(lifecycle, error);
        }
    }
}

function walletProgressStage(
    state: WalletExecutionResult['confirmation']['state'],
): Extract<SwapExecutionProgressStage, 'wallet-pending' | 'wallet-confirmed'> | null {
    if (state === 'confirmed') return 'wallet-confirmed';
    if (state === 'pending' || state === 'unknown') return 'wallet-pending';
    return null;
}

function isCancelled(error: unknown, signal?: AbortSignal): boolean {
    return (
        signal?.aborted === true ||
        (error instanceof DOMException && error.name === 'AbortError') ||
        (error instanceof WalletExecutionError && error.code === 'CONFIRMATION_CANCELLED')
    );
}

function assertCorrelationId(value: string): void {
    if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > MAX_CORRELATION_ID_LENGTH) {
        throw new WalletExecutionError(
            'INVALID_WALLET_REQUEST',
            'The swap correlation identifier is invalid.',
        );
    }
}
