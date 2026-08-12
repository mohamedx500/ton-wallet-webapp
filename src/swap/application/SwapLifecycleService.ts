import type { NetworkId } from '../../core/chain';
import { WalletExecutionError } from '../../wallet';
import type { ConfirmationState } from '../../wallet';
import type { ExecuteSwapOptions, SwapExecutionProgress } from '../SwapExecutionCoordinator';
import type {
    ExecutePasswordConfirmedSwapRequest,
    PasswordConfirmedSwapResult,
} from './PasswordConfirmedSwapExecutor';

export type SwapLifecycleStage =
    | 'preparing'
    | 'signing'
    | 'submitted'
    | 'wallet-pending'
    | 'wallet-confirmed'
    | 'dex-pending'
    | 'succeeded'
    | 'failed'
    | 'unknown'
    | 'cancelled';

/** Metadata-only lifecycle event safe for an application or React state boundary. */
export interface SwapLifecycleEvent {
    readonly stage: SwapLifecycleStage;
    readonly network: NetworkId;
    readonly providerId: string;
    readonly correlationId: string;
    readonly submissionId: string | null;
    readonly walletConfirmationState: ConfirmationState | null;
    readonly dexExitCode: string | null;
    readonly txHash: string | null;
    readonly explorerUrl: string | null;
}

export interface SwapLifecycleExecutionOptions {
    readonly wallet?: ExecuteSwapOptions['wallet'];
    readonly outcome?: ExecuteSwapOptions['outcome'];
    readonly onLifecycle?: (event: SwapLifecycleEvent) => void;
}

/** Narrow Stage C dependency. */
export interface PasswordConfirmedSwapOperation {
    readonly network: NetworkId;
    execute(
        request: ExecutePasswordConfirmedSwapRequest,
        options?: ExecuteSwapOptions,
    ): Promise<PasswordConfirmedSwapResult>;
}

/**
 * Inactive Stage D lifecycle adapter.
 *
 * Progress is projected from the audited execution coordinator and terminal state
 * is derived only from the secret-free Stage C result. Wallet inclusion is never
 * reported as swap success. UI observer failures are ignored and cannot affect
 * signing, submission, confirmation, or recovery persistence.
 */
export class SwapLifecycleService {
    public readonly network: NetworkId;
    private readonly operation: PasswordConfirmedSwapOperation;

    public constructor(operation: PasswordConfirmedSwapOperation) {
        this.network = operation.network;
        this.operation = operation;
    }

    public async execute(
        request: ExecutePasswordConfirmedSwapRequest,
        options: SwapLifecycleExecutionOptions = {},
    ): Promise<PasswordConfirmedSwapResult> {
        const notify = createNotifier(options.onLifecycle);
        const executionOptions: ExecuteSwapOptions = Object.freeze({
            ...(options.wallet === undefined ? {} : { wallet: options.wallet }),
            ...(options.outcome === undefined ? {} : { outcome: preserveOutcomeProgress(options.outcome) }),
            onProgress: (progress: SwapExecutionProgress) => notify(fromExecutionProgress(progress)),
        });

        try {
            const result = await this.operation.execute(request, executionOptions);
            notify(fromResult(result));
            return result;
        } catch (error) {
            if (isCancelled(error, options)) {
                notify(Object.freeze({
                    stage: 'cancelled',
                    network: this.network,
                    providerId: request.approval.quote.providerId,
                    correlationId: request.approval.intent.correlationId,
                    submissionId: submissionIdFrom(error),
                    walletConfirmationState: null,
                    dexExitCode: null,
                    txHash: null,
                    explorerUrl: null,
                }));
            }
            throw error;
        }
    }
}

function createNotifier(
    observer: SwapLifecycleExecutionOptions['onLifecycle'],
): (event: SwapLifecycleEvent) => void {
    return (event) => {
        if (observer === undefined) return;
        try {
            observer(event);
        } catch {
            // UI lifecycle observation is best-effort and cannot alter execution.
        }
    };
}

function fromExecutionProgress(progress: SwapExecutionProgress): SwapLifecycleEvent {
    return Object.freeze({
        stage: progress.stage,
        network: progress.network,
        providerId: progress.providerId,
        correlationId: progress.correlationId,
        submissionId: progress.submissionId,
        walletConfirmationState: null,
        dexExitCode: null,
        txHash: null,
        explorerUrl: null,
    });
}

function fromResult(result: PasswordConfirmedSwapResult): SwapLifecycleEvent {
    return Object.freeze({
        stage: terminalStage(result),
        network: result.network,
        providerId: result.providerId,
        correlationId: result.correlationId,
        submissionId: result.submissionId,
        walletConfirmationState: result.walletConfirmationState,
        dexExitCode: result.dexExitCode,
        txHash: result.txHash,
        explorerUrl: result.explorerUrl,
    });
}

function terminalStage(result: PasswordConfirmedSwapResult): SwapLifecycleStage {
    if (result.walletConfirmationState === 'failed') return 'failed';
    if (result.walletConfirmationState === 'pending' || result.walletConfirmationState === 'unknown') {
        return 'wallet-pending';
    }
    if (result.state === 'succeeded') return 'succeeded';
    if (result.state === 'failed') return 'failed';
    if (result.state === 'unknown') return 'unknown';
    return 'dex-pending';
}

function preserveOutcomeProgress(
    outcome: NonNullable<ExecuteSwapOptions['outcome']>,
): NonNullable<ExecuteSwapOptions['outcome']> {
    return Object.freeze({ ...outcome });
}

function isCancelled(error: unknown, options: SwapLifecycleExecutionOptions): boolean {
    return (
        options.wallet?.confirmation?.signal?.aborted === true
        || options.outcome?.signal?.aborted === true
        || (error instanceof DOMException && error.name === 'AbortError')
        || (error instanceof WalletExecutionError && error.code === 'CONFIRMATION_CANCELLED')
    );
}

function submissionIdFrom(error: unknown): string | null {
    return error instanceof WalletExecutionError
        ? error.submissionReference?.submissionId ?? null
        : null;
}
