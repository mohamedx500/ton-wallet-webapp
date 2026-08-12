import { addressKey, formatAddress } from '../../core/address';
import type { NetworkId } from '../../core/chain';
import { WalletExecutionError } from '../../wallet';
import type {
    PendingSwapRecoveryResult,
    RecoverWalletSwapsOptions,
} from '../PendingSwapRecoveryCoordinator';

export type RecoveryLifecycleStage =
    | 'wallet-pending'
    | 'wallet-confirmed'
    | 'dex-pending'
    | 'succeeded'
    | 'failed'
    | 'unknown'
    | 'cancelled';

/** Metadata-only recovered lifecycle item safe for application state. */
export interface RecoveredSwapLifecycle {
    readonly status: 'fulfilled' | 'rejected';
    readonly stage: RecoveryLifecycleStage;
    readonly network: NetworkId;
    readonly providerId: string | null;
    readonly correlationId: string | null;
    readonly submissionId: string | null;
    readonly walletConfirmationState: PendingSwapRecoveryResult['wallet']['state'] | null;
    readonly dexExitCode: string | null;
    readonly txHash: string | null;
    readonly explorerUrl: string | null;
    readonly errorCode: string | null;
}

export interface PendingSwapRecoveryBootstrapOptions extends RecoverWalletSwapsOptions {
    readonly onLifecycle?: (item: RecoveredSwapLifecycle) => void;
}

/** Narrow recovery-only dependency implemented by `PendingSwapRecoveryCoordinator`. */
export interface WalletPendingSwapRecovery {
    readonly network: NetworkId;
    recoverWallet(
        ownerAddress: string,
        options?: RecoverWalletSwapsOptions,
    ): Promise<readonly PromiseSettledResult<PendingSwapRecoveryResult>[]>;
}

/**
 * Inactive Stage E application bootstrap.
 *
 * It accepts an explicit network-bound coordinator and canonical owner, delegates
 * only to reload recovery, and projects settled records into immutable metadata.
 * No encrypted account, password, signer, broadcaster, or payload is accepted.
 */
export class PendingSwapRecoveryBootstrap {
    public readonly network: NetworkId;
    private readonly recovery: WalletPendingSwapRecovery;

    public constructor(recovery: WalletPendingSwapRecovery) {
        this.network = recovery.network;
        this.recovery = recovery;
    }

    public async recoverWallet(
        network: NetworkId,
        ownerAddress: string,
        options: PendingSwapRecoveryBootstrapOptions = {},
    ): Promise<readonly RecoveredSwapLifecycle[]> {
        if (network !== this.network) {
            throw new WalletExecutionError(
                'WALLET_NETWORK_MISMATCH',
                'Pending swap recovery must use the explicitly configured TON network.',
            );
        }
        const ownerKey = addressKey(ownerAddress);
        const canonicalOwner = formatAddress(ownerKey, { bounceable: true });
        const recoveryOptions: RecoverWalletSwapsOptions = Object.freeze({
            ...(options.wallet === undefined ? {} : { wallet: options.wallet }),
            ...(options.outcome === undefined ? {} : { outcome: options.outcome }),
            ...(options.concurrency === undefined ? {} : { concurrency: options.concurrency }),
        });
        const settled = await this.recovery.recoverWallet(canonicalOwner, recoveryOptions);
        const projected = settled.map((item) => projectSettled(item, network, ownerKey));
        for (const item of projected) {
            notify(options.onLifecycle, item);
        }
        return Object.freeze(projected);
    }
}

function projectSettled(
    item: PromiseSettledResult<PendingSwapRecoveryResult>,
    network: NetworkId,
    ownerKey: string,
): RecoveredSwapLifecycle {
    if (item.status === 'rejected') {
        return Object.freeze({
            status: 'rejected',
            stage: isCancellation(item.reason) ? 'cancelled' : 'unknown',
            network,
            providerId: null,
            correlationId: null,
            submissionId: submissionIdFrom(item.reason),
            walletConfirmationState: null,
            dexExitCode: null,
            txHash: null,
            explorerUrl: null,
            errorCode: errorCodeFrom(item.reason),
        });
    }

    const result = item.value;
    if (
        result.reference.network !== network
        || addressKey(result.reference.swap.ownerAddress) !== ownerKey
        || addressKey(result.reference.submission.walletAddress) !== ownerKey
    ) {
        throw new WalletExecutionError(
            'INVALID_WALLET_REQUEST',
            'Recovered swap metadata does not belong to the requested wallet and network.',
        );
    }
    return Object.freeze({
        status: 'fulfilled',
        stage: stageFromResult(result),
        network,
        providerId: result.reference.swap.providerId,
        correlationId: result.reference.submission.correlationId,
        submissionId: result.reference.submission.submissionId,
        walletConfirmationState: result.wallet.state,
        dexExitCode: result.outcome?.exitCode ?? null,
        txHash: result.outcome?.txHash ?? result.wallet.txHash,
        explorerUrl: result.outcome?.explorerUrl ?? null,
        errorCode: null,
    });
}

function stageFromResult(result: PendingSwapRecoveryResult): RecoveryLifecycleStage {
    if (result.wallet.state === 'failed') return 'failed';
    if (result.wallet.state === 'pending' || result.wallet.state === 'unknown') return 'wallet-pending';
    if (result.state === 'succeeded') return 'succeeded';
    if (result.state === 'failed') return 'failed';
    if (result.state === 'unknown') return 'unknown';
    return 'dex-pending';
}

function notify(
    observer: PendingSwapRecoveryBootstrapOptions['onLifecycle'],
    item: RecoveredSwapLifecycle,
): void {
    if (observer === undefined) return;
    try {
        observer(item);
    } catch {
        // Application observers cannot alter recovery or record cleanup.
    }
}

function isCancellation(error: unknown): boolean {
    return (
        (error instanceof DOMException && error.name === 'AbortError')
        || (error instanceof WalletExecutionError && error.code === 'CONFIRMATION_CANCELLED')
    );
}

function errorCodeFrom(error: unknown): string {
    if (typeof error !== 'object' || error === null || !('code' in error)) return 'RECOVERY_FAILED';
    const code = error.code;
    return typeof code === 'string' && code.length > 0 ? code : 'RECOVERY_FAILED';
}

function submissionIdFrom(error: unknown): string | null {
    return error instanceof WalletExecutionError
        ? error.submissionReference?.submissionId ?? null
        : null;
}
