import { addressKey } from '../../core/address';
import type { NetworkId } from '../../core/chain';
import { formatUnits } from '../../core/units';
import type {
    PendingSwapRecoveryBootstrap,
    PendingSwapRecoveryBootstrapOptions,
    RecoveredSwapLifecycle,
} from './PendingSwapRecoveryBootstrap';
import type {
    PasswordConfirmedSwapResult,
} from './PasswordConfirmedSwapExecutor';
import type {
    SwapLifecycleEvent,
    SwapLifecycleExecutionOptions,
    SwapLifecycleService,
} from './SwapLifecycleService';
import type {
    SwapQuoteApproval,
    SwapQuoteSession,
} from './SwapQuoteSession';
import {
    decodePasswordConfirmedSwapAccount,
} from './legacyAccountAdapters';
import { createSwapIntent } from './legacyConversion';
import type { CreateSwapIntentInput, SwapIntent } from './types';

export type StrictSwapUiPhase =
    | 'idle'
    | 'quoting'
    | 'ready'
    | 'executing'
    | 'recovering'
    | 'error';

/** Exact display metadata projected from a private executable approval. */
export interface StrictSwapQuoteView {
    readonly generation: number;
    readonly network: NetworkId;
    readonly providerId: string;
    readonly correlationId: string;
    readonly walletAddress: string;
    readonly walletVersion: SwapIntent['wallet']['version'];
    readonly fromAssetKey: string;
    readonly fromSymbol: string;
    readonly toAssetKey: string;
    readonly toSymbol: string;
    readonly offerUnits: string;
    readonly offerAmount: string;
    readonly expectedOutUnits: string;
    readonly expectedOutAmount: string;
    readonly minOutUnits: string;
    readonly minOutAmount: string;
    readonly slippageBps: number;
    readonly recommendedSlippageBps: number | null;
    readonly priceImpactBps: number;
    readonly feeUnits: string;
    readonly feeAmount: string;
    readonly feeSymbol: string;
    readonly messageValueNano: string;
    readonly forwardValueNano: string;
    readonly estimatedGasNano: string;
    readonly routeLabels: readonly string[];
    readonly createdAtMs: number;
}

/** Secret-free immutable snapshot consumed through `useSyncExternalStore()`. */
export interface StrictSwapUiSnapshot {
    readonly phase: StrictSwapUiPhase;
    readonly network: NetworkId;
    readonly quote: StrictSwapQuoteView | null;
    readonly executionAvailable: boolean;
    readonly lifecycle: SwapLifecycleEvent | null;
    readonly recoveryOwnerKey: string | null;
    readonly recoveryInProgress: boolean;
    readonly recovered: readonly RecoveredSwapLifecycle[];
    readonly recoveryErrorCode: string | null;
    readonly errorCode: string | null;
}

export type StrictSwapUiListener = () => void;

export interface StrictSwapUiAdapterOptions {
    readonly network: NetworkId;
    readonly quoteSession: SwapQuoteSession;
    readonly lifecycle: SwapLifecycleService;
    readonly recovery: PendingSwapRecoveryBootstrap;
}

export interface ExecuteStrictSwapOptions extends SwapLifecycleExecutionOptions {}

/**
 * Long-lived inactive bridge between strict swap application services and React.
 *
 * The executable approval remains private. React receives only immutable display
 * metadata and lifecycle identifiers; password, encrypted mnemonic, payloads,
 * cells, signatures, BOCs, raw provider data, and graph internals never enter a
 * snapshot or listener. Duplicate in-flight quote, execution, and recovery calls
 * are coalesced so rerenders and repeated event delivery cannot duplicate work.
 */
export class StrictSwapUiAdapter {
    public readonly network: NetworkId;
    private readonly quoteSession: SwapQuoteSession;
    private readonly lifecycleService: SwapLifecycleService;
    private readonly recoveryBootstrap: PendingSwapRecoveryBootstrap;
    private readonly listeners = new Set<StrictSwapUiListener>();
    private snapshot: StrictSwapUiSnapshot;
    private approval: SwapQuoteApproval | null = null;
    private quoteKey: string | null = null;
    private quotePromise: Promise<StrictSwapQuoteView | null> | null = null;
    private executionPromise: Promise<PasswordConfirmedSwapResult> | null = null;
    private recoveryKey: string | null = null;
    private recoveryGeneration = 0;
    private readonly recoveryPromises = new Map<
        string,
        Promise<readonly RecoveredSwapLifecycle[]>
    >();
    private readonly recoveredByOwner = new Map<
        string,
        readonly RecoveredSwapLifecycle[]
    >();

    public constructor(options: StrictSwapUiAdapterOptions) {
        this.network = options.network;
        this.quoteSession = options.quoteSession;
        this.lifecycleService = options.lifecycle;
        this.recoveryBootstrap = options.recovery;
        if (
            options.quoteSession.network !== this.network
            || options.lifecycle.network !== this.network
            || options.recovery.network !== this.network
        ) {
            throw new Error('Strict swap UI dependencies must use the same TON network.');
        }
        this.snapshot = initialSnapshot(this.network);
    }

    public getSnapshot = (): StrictSwapUiSnapshot => this.snapshot;

    public subscribe = (listener: StrictSwapUiListener): (() => void) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };

    /** Invalidate approval and suppress every quote response currently in flight. */
    public invalidate(): void {
        this.quoteSession.invalidate();
        if (this.executionPromise !== null) return;
        this.approval = null;
        this.quoteKey = null;
        this.quotePromise = null;
        this.publish({
            ...this.snapshot,
            phase: 'idle',
            quote: null,
            executionAvailable: false,
            errorCode: null,
        });
    }

    /** Convert and quote one exact UI intent, coalescing an identical in-flight request. */
    public quote(input: CreateSwapIntentInput): Promise<StrictSwapQuoteView | null> {
        const intent = createSwapIntent(input);
        const key = intentKey(intent);
        if (this.quotePromise !== null && this.quoteKey === key) {
            return this.quotePromise;
        }

        this.approval = null;
        this.quoteKey = key;
        this.publish({
            ...this.snapshot,
            phase: 'quoting',
            quote: null,
            executionAvailable: false,
            lifecycle: null,
            errorCode: null,
        });

        const operation = this.quoteIntent(intent, key);
        this.quotePromise = operation;
        void operation.finally(() => {
            if (this.quotePromise === operation) {
                this.quotePromise = null;
            }
        }).catch(() => undefined);
        return operation;
    }

    /** Execute the privately retained exact approval once for repeated UI delivery. */
    public execute(
        legacyAccount: unknown,
        password: string,
        options: ExecuteStrictSwapOptions = {},
    ): Promise<PasswordConfirmedSwapResult> {
        if (this.executionPromise !== null) return this.executionPromise;
        const approval = this.approval;
        if (approval === null) {
            return Promise.reject(new Error('A current strict swap approval is required.'));
        }
        const account = decodePasswordConfirmedSwapAccount(legacyAccount);
        const operation = this.executeApproval(approval, account, password, options);
        this.executionPromise = operation;
        void operation.finally(() => {
            if (this.executionPromise === operation) {
                this.executionPromise = null;
            }
        }).catch(() => undefined);
        return operation;
    }

    /** Recover one explicit network/owner partition once per process lifetime. */
    public recover(
        ownerAddress: string,
        options: PendingSwapRecoveryBootstrapOptions = {},
    ): Promise<readonly RecoveredSwapLifecycle[]> {
        const key = addressKey(ownerAddress);
        const inFlight = this.recoveryPromises.get(key);
        if (inFlight !== undefined) return inFlight;

        const completed = this.recoveredByOwner.get(key);
        if (completed !== undefined) {
            if (this.snapshot.recoveryOwnerKey !== key) {
                this.publish({
                    ...this.snapshot,
                    recoveryOwnerKey: key,
                    recoveryInProgress: false,
                    recovered: completed,
                    recoveryErrorCode: null,
                });
            }
            return Promise.resolve(completed);
        }

        const generation = this.recoveryGeneration + 1;
        this.recoveryGeneration = generation;
        this.recoveryKey = key;
        this.publish({
            ...this.snapshot,
            recoveryOwnerKey: key,
            recoveryInProgress: true,
            recovered: Object.freeze([]),
            recoveryErrorCode: null,
        });
        const operation = this.recoverOwner(ownerAddress, key, generation, options);
        this.recoveryPromises.set(key, operation);
        void operation.finally(() => {
            if (this.recoveryPromises.get(key) === operation) {
                this.recoveryPromises.delete(key);
            }
        }).catch(() => undefined);
        return operation;
    }

    private async quoteIntent(intent: SwapIntent, key: string): Promise<StrictSwapQuoteView | null> {
        try {
            const result = await this.quoteSession.quote(intent);
            if (result.state === 'superseded' || this.quoteKey !== key) return null;
            this.approval = result.approval;
            const quote = projectQuote(result.approval);
            this.publish({
                ...this.snapshot,
                phase: 'ready',
                quote,
                executionAvailable: true,
                errorCode: null,
            });
            return quote;
        } catch (error) {
            if (this.quoteKey === key) {
                this.approval = null;
                this.publish({
                    ...this.snapshot,
                    phase: 'error',
                    quote: null,
                    executionAvailable: false,
                    errorCode: errorCode(error, 'QUOTE_FAILED'),
                });
            }
            throw error;
        }
    }

    private async executeApproval(
        approval: SwapQuoteApproval,
        account: ReturnType<typeof decodePasswordConfirmedSwapAccount>,
        password: string,
        options: ExecuteStrictSwapOptions,
    ): Promise<PasswordConfirmedSwapResult> {
        this.publish({
            ...this.snapshot,
            phase: 'executing',
            executionAvailable: false,
            lifecycle: null,
            errorCode: null,
        });
        let submissionObserved = false;
        try {
            const result = await this.lifecycleService.execute(
                Object.freeze({ approval, account, password }),
                Object.freeze({
                    ...(options.wallet === undefined ? {} : { wallet: options.wallet }),
                    ...(options.outcome === undefined ? {} : { outcome: options.outcome }),
                    onLifecycle: (event: SwapLifecycleEvent) => {
                        submissionObserved ||= event.submissionId !== null;
                        this.publish({ ...this.snapshot, lifecycle: event });
                        notify(options.onLifecycle, event);
                    },
                }),
            );
            this.approval = null;
            this.publish({
                ...this.snapshot,
                phase: result.state === 'succeeded' ? 'idle' : 'error',
                quote: null,
                executionAvailable: false,
                errorCode: result.state === 'succeeded' ? null : resultErrorCode(result),
            });
            return result;
        } catch (error) {
            if (submissionObserved || hasSubmissionReference(error)) {
                this.approval = null;
            }
            this.publish({
                ...this.snapshot,
                phase: 'error',
                ...(this.approval === null ? { quote: null } : {}),
                executionAvailable: this.approval !== null,
                errorCode: errorCode(error, 'EXECUTION_FAILED'),
            });
            throw error;
        }
    }

    private async recoverOwner(
        ownerAddress: string,
        ownerKey: string,
        generation: number,
        options: PendingSwapRecoveryBootstrapOptions,
    ): Promise<readonly RecoveredSwapLifecycle[]> {
        try {
            const recovered = await this.recoveryBootstrap.recoverWallet(
                this.network,
                ownerAddress,
                Object.freeze({
                    ...(options.wallet === undefined ? {} : { wallet: options.wallet }),
                    ...(options.outcome === undefined ? {} : { outcome: options.outcome }),
                    ...(options.concurrency === undefined ? {} : { concurrency: options.concurrency }),
                    onLifecycle: (item: RecoveredSwapLifecycle) => notify(options.onLifecycle, item),
                }),
            );
            this.recoveredByOwner.set(ownerKey, recovered);
            if (this.isCurrentRecovery(ownerKey, generation)) {
                this.publish({
                    ...this.snapshot,
                    recoveryInProgress: false,
                    recovered,
                    recoveryErrorCode: null,
                });
            }
            return recovered;
        } catch (error) {
            if (this.isCurrentRecovery(ownerKey, generation)) {
                this.publish({
                    ...this.snapshot,
                    recoveryInProgress: false,
                    recoveryErrorCode: errorCode(error, 'RECOVERY_FAILED'),
                });
            }
            throw error;
        }
    }

    private isCurrentRecovery(ownerKey: string, generation: number): boolean {
        return this.recoveryKey === ownerKey && this.recoveryGeneration === generation;
    }

    private publish(next: Omit<StrictSwapUiSnapshot, never>): void {
        this.snapshot = Object.freeze(next);
        for (const listener of this.listeners) {
            try {
                listener();
            } catch {
                // React subscribers cannot alter protocol execution.
            }
        }
    }
}

function initialSnapshot(network: NetworkId): StrictSwapUiSnapshot {
    return Object.freeze({
        phase: 'idle',
        network,
        quote: null,
        executionAvailable: false,
        lifecycle: null,
        recoveryOwnerKey: null,
        recoveryInProgress: false,
        recovered: Object.freeze([]),
        recoveryErrorCode: null,
        errorCode: null,
    });
}

function projectQuote(approval: SwapQuoteApproval): StrictSwapQuoteView {
    const { intent, quote } = approval;
    return Object.freeze({
        generation: approval.generation,
        network: intent.network,
        providerId: quote.providerId,
        correlationId: intent.correlationId,
        walletAddress: intent.wallet.address,
        walletVersion: intent.wallet.version,
        fromAssetKey: assetKey(intent.from),
        fromSymbol: intent.from.symbol,
        toAssetKey: assetKey(intent.to),
        toSymbol: intent.to.symbol,
        offerUnits: quote.offerUnits.toString(),
        offerAmount: formatUnits(quote.offerUnits, quote.from.decimals),
        expectedOutUnits: quote.expectedOutUnits.toString(),
        expectedOutAmount: formatUnits(quote.expectedOutUnits, quote.to.decimals),
        minOutUnits: quote.minOutUnits.toString(),
        minOutAmount: formatUnits(quote.minOutUnits, quote.to.decimals),
        slippageBps: quote.slippageBps,
        recommendedSlippageBps: quote.recommendedSlippageBps,
        priceImpactBps: quote.priceImpactBps,
        feeUnits: quote.feeUnits.toString(),
        feeAmount: formatUnits(quote.feeUnits, quote.feeAsset.decimals),
        feeSymbol: quote.feeAsset.symbol,
        messageValueNano: quote.gas.messageValue.toString(),
        forwardValueNano: quote.gas.forwardValue.toString(),
        estimatedGasNano: quote.gas.estimatedConsumption.toString(),
        routeLabels: Object.freeze(quote.route.map((hop) => hop.label)),
        createdAtMs: quote.createdAtMs,
    });
}

function assetKey(asset: SwapIntent['from']): string {
    return asset.kind === 'native' ? 'native:ton' : `jetton:${asset.master}`;
}

function intentKey(intent: SwapIntent): string {
    return [
        intent.network,
        intent.ownerAddress,
        intent.wallet.version,
        assetKey(intent.from),
        assetKey(intent.to),
        intent.offerUnits.toString(),
        String(intent.slippageBps),
        intent.correlationId,
    ].join('|');
}

function errorCode(error: unknown, fallback: string): string {
    if (typeof error !== 'object' || error === null || !('code' in error)) return fallback;
    const code = error.code;
    return typeof code === 'string' && code.length > 0 ? code : fallback;
}

function hasSubmissionReference(error: unknown): boolean {
    if (typeof error !== 'object' || error === null || !('submissionReference' in error)) return false;
    return error.submissionReference !== null && error.submissionReference !== undefined;
}

function resultErrorCode(result: PasswordConfirmedSwapResult): string {
    if (result.walletConfirmationState === 'pending' || result.walletConfirmationState === 'unknown') {
        return 'WALLET_CONFIRMATION_PENDING';
    }
    if (result.walletConfirmationState === 'failed') return 'WALLET_TRANSACTION_FAILED';
    if (result.state === 'pending') return 'DEX_OUTCOME_PENDING';
    if (result.state === 'unknown') return 'DEX_OUTCOME_UNKNOWN';
    return result.dexExitCode ?? 'DEX_SWAP_FAILED';
}

function notify<T>(observer: ((value: T) => void) | undefined, value: T): void {
    if (observer === undefined) return;
    try {
        observer(value);
    } catch {
        // External UI observers cannot alter protocol execution.
    }
}
