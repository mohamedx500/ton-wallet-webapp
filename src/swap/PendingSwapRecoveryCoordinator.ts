import { isSameAddress, parseAddress } from '../core/address';
import type { NetworkId } from '../core/chain';
import { BlockchainDiagnostics } from '../observability';
import type { OperationContext } from '../observability';
import type {
    ConfirmationOptions,
    TransactionConfirmation,
    TransactionConfirmer,
} from '../wallet';
import { WalletExecutionError } from '../wallet';

import { SwapEngine } from './SwapEngine';
import type { WaitForOutcomeOptions } from './SwapEngine';
import { SwapError, SwapErrorCode } from './errors';
import type {
    PendingSwapReference,
    PendingSwapReferenceStore,
    SwapOutcome,
} from './types';

export interface PendingSwapRecoveryCoordinatorOptions {
    readonly network: NetworkId;
    readonly store: PendingSwapReferenceStore;
    readonly walletConfirmer: TransactionConfirmer;
    readonly engine: SwapEngine;
    readonly diagnostics?: BlockchainDiagnostics;
}

export interface RecoverPendingSwapOptions {
    readonly wallet?: ConfirmationOptions;
    readonly outcome?: WaitForOutcomeOptions;
}

export interface RecoverWalletSwapsOptions extends RecoverPendingSwapOptions {
    readonly concurrency?: number;
}

export interface PendingSwapRecoveryResult {
    readonly reference: PendingSwapReference;
    readonly state: 'pending' | 'succeeded' | 'failed' | 'unknown';
    readonly wallet: TransactionConfirmation;
    readonly outcome: SwapOutcome | null;
}

const DEFAULT_CONCURRENCY = 4;
const MAX_CONCURRENCY = 16;

/**
 * Resumes a persisted swap without rebuilding, signing, or resubmitting it.
 */
export class PendingSwapRecoveryCoordinator {
    public readonly network: NetworkId;
    private readonly store: PendingSwapReferenceStore;
    private readonly walletConfirmer: TransactionConfirmer;
    private readonly engine: SwapEngine;
    private readonly diagnostics: BlockchainDiagnostics;

    public constructor(options: PendingSwapRecoveryCoordinatorOptions) {
        this.network = options.network;
        this.store = options.store;
        this.walletConfirmer = options.walletConfirmer;
        this.engine = options.engine;
        this.diagnostics = options.diagnostics ?? new BlockchainDiagnostics();

        if (
            this.walletConfirmer.network !== this.network
            || this.engine.network !== this.network
        ) {
            throw new WalletExecutionError(
                'WALLET_NETWORK_MISMATCH',
                'Pending swap recovery components must use the same TON network.',
            );
        }
    }

    public async recover(
        reference: PendingSwapReference,
        options: RecoverPendingSwapOptions = {},
    ): Promise<PendingSwapRecoveryResult> {
        this.assertReference(reference);
        const lifecycle = this.diagnostics.start('transaction', {
            network: this.network,
            providerId: reference.swap.providerId,
            walletVersion: reference.submission.walletVersion,
            walletKind: reference.submission.walletVersion === 'highload-v3'
                ? 'highload-v3'
                : 'standard',
            lifecycleState: 'recovery',
            submissionId: reference.submission.submissionId,
        }, reference.submission.correlationId);

        try {
            const wallet = await this.confirmWallet(reference, options.wallet, lifecycle);
            if (wallet.state !== 'confirmed') {
                const result = freezeResult({
                    reference,
                    state: wallet.state,
                    wallet,
                    outcome: null,
                });
                if (wallet.state === 'failed') {
                    await this.store.remove(this.network, reference.submission.submissionId);
                    this.diagnostics.fail(
                        lifecycle,
                        new WalletExecutionError(
                            'CONFIRMATION_FAILED',
                            'The recovered wallet transaction failed on-chain.',
                        ),
                        { walletConfirmationState: wallet.state },
                    );
                } else {
                    this.diagnostics.pending(lifecycle, {
                        walletConfirmationState: wallet.state,
                        outcome: wallet.state,
                    });
                }
                return result;
            }

            const outcome = await this.confirmOutcome(reference, options.outcome, lifecycle);
            const result = freezeResult({
                reference,
                state: outcome.state,
                wallet,
                outcome,
            });
            if (outcome.state === 'succeeded' || outcome.state === 'failed') {
                await this.store.remove(this.network, reference.submission.submissionId);
            }
            this.complete(lifecycle, result);
            return result;
        } catch (error) {
            if (isCancelled(error, options)) {
                this.diagnostics.cancel(lifecycle);
            } else {
                this.diagnostics.fail(lifecycle, error);
            }
            throw error;
        }
    }

    public async recoverWallet(
        ownerAddress: string,
        options: RecoverWalletSwapsOptions = {},
    ): Promise<readonly PromiseSettledResult<PendingSwapRecoveryResult>[]> {
        const owner = parseAddress(ownerAddress).toString();
        const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
        if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > MAX_CONCURRENCY) {
            throw new SwapError(
                SwapErrorCode.InvalidRequest,
                'Pending swap recovery concurrency is invalid.',
                { severity: 'warning' },
            );
        }
        const references = await this.store.list(this.network, owner);
        const results: PromiseSettledResult<PendingSwapRecoveryResult>[] = new Array(references.length);
        let nextIndex = 0;

        const worker = async (): Promise<void> => {
            while (true) {
                const index = nextIndex;
                nextIndex += 1;
                const reference = references[index];
                if (reference === undefined) return;
                try {
                    results[index] = {
                        status: 'fulfilled',
                        value: await this.recover(reference, options),
                    };
                } catch (reason) {
                    results[index] = { status: 'rejected', reason };
                }
            }
        };

        await Promise.all(
            Array.from(
                { length: Math.min(concurrency, references.length) },
                async () => worker(),
            ),
        );
        return Object.freeze(results);
    }

    private async confirmWallet(
        reference: PendingSwapReference,
        options: ConfirmationOptions | undefined,
        lifecycle: OperationContext,
    ): Promise<TransactionConfirmation> {
        const context = this.diagnostics.start('confirmation', {
            network: this.network,
            confirmationPhase: 'walletRecovery',
            submissionId: reference.submission.submissionId,
        }, lifecycle.correlationId);
        try {
            const confirmation = await this.walletConfirmer.confirm(reference.submission, options);
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
                    new WalletExecutionError(
                        'CONFIRMATION_FAILED',
                        'The recovered wallet transaction failed on-chain.',
                    ),
                    {
                        confirmationState: confirmation.state,
                        txHash: confirmation.txHash,
                        exitCode: confirmation.exitCode,
                    },
                );
            }
            return confirmation;
        } catch (error) {
            if (isWalletCancelled(error, options?.signal)) {
                this.diagnostics.cancel(context);
            } else if (
                error instanceof WalletExecutionError
                && error.code === 'CONFIRMATION_TIMEOUT'
            ) {
                this.diagnostics.timeout(context, error);
            } else {
                this.diagnostics.fail(context, error);
            }
            throw error;
        }
    }

    private async confirmOutcome(
        reference: PendingSwapReference,
        options: WaitForOutcomeOptions | undefined,
        lifecycle: OperationContext,
    ): Promise<SwapOutcome> {
        const context = this.diagnostics.start('confirmation', {
            network: this.network,
            providerId: reference.swap.providerId,
            confirmationPhase: 'dexRecovery',
            submissionId: reference.submission.submissionId,
        }, lifecycle.correlationId);
        try {
            const outcome = await this.engine.waitForOutcome(reference.swap, options);
            if (outcome.state === 'succeeded') {
                this.diagnostics.succeed(context, outcomeAttributes(outcome));
            } else if (outcome.state === 'pending' || outcome.state === 'unknown') {
                this.diagnostics.pending(context, outcomeAttributes(outcome));
            } else {
                this.diagnostics.fail(
                    context,
                    new SwapError(SwapErrorCode.SwapReverted, 'The recovered DEX swap failed.'),
                    outcomeAttributes(outcome),
                );
            }
            return outcome;
        } catch (error) {
            if (isOutcomeCancelled(error, options?.signal)) {
                this.diagnostics.cancel(context);
            } else {
                this.diagnostics.fail(context, error);
            }
            throw error;
        }
    }

    private complete(
        lifecycle: OperationContext,
        result: PendingSwapRecoveryResult,
    ): void {
        const attributes = {
            providerId: result.reference.swap.providerId,
            walletConfirmationState: result.wallet.state,
            outcome: result.state,
            submissionId: result.reference.submission.submissionId,
        };
        if (result.state === 'succeeded') {
            this.diagnostics.succeed(lifecycle, attributes);
        } else if (result.state === 'pending' || result.state === 'unknown') {
            this.diagnostics.pending(lifecycle, attributes);
        } else {
            this.diagnostics.fail(
                lifecycle,
                new SwapError(SwapErrorCode.SwapReverted, 'The recovered swap failed.'),
                attributes,
            );
        }
    }

    private assertReference(reference: PendingSwapReference): void {
        if (
            reference.schemaVersion !== 1
            || reference.network !== this.network
            || reference.submission.network !== this.network
        ) {
            throw new WalletExecutionError(
                'WALLET_NETWORK_MISMATCH',
                'The pending swap reference belongs to a different TON network.',
            );
        }
        if (!isSameAddress(reference.submission.walletAddress, reference.swap.ownerAddress)) {
            throw new SwapError(
                SwapErrorCode.RecoveryStoreFailed,
                'The pending swap owner does not match the submitting wallet.',
                { severity: 'suspicious' },
            );
        }
    }
}

function freezeResult(result: PendingSwapRecoveryResult): PendingSwapRecoveryResult {
    return Object.freeze({ ...result });
}

function outcomeAttributes(outcome: SwapOutcome) {
    return {
        outcome: outcome.state,
        txHash: outcome.txHash,
        exitCode: outcome.exitCode,
    };
}

function isCancelled(error: unknown, options: RecoverPendingSwapOptions): boolean {
    return isWalletCancelled(error, options.wallet?.signal)
        || isOutcomeCancelled(error, options.outcome?.signal);
}

function isWalletCancelled(error: unknown, signal?: AbortSignal): boolean {
    return signal?.aborted === true
        || (error instanceof WalletExecutionError && error.code === 'CONFIRMATION_CANCELLED')
        || (error instanceof DOMException && error.name === 'AbortError');
}

function isOutcomeCancelled(error: unknown, signal?: AbortSignal): boolean {
    return signal?.aborted === true
        || (error instanceof DOMException && error.name === 'AbortError');
}
