import { describe, expect, it, vi } from 'vitest';

import type { NetworkId } from '../../src/core/chain';
import {
    PendingSwapRecoveryBootstrap,
    StrictSwapUiAdapter,
    SwapLifecycleService,
    SwapQuoteSession,
} from '../../src/swap/application';
import type {
    ExecutePasswordConfirmedSwapRequest,
    PasswordConfirmedSwapOperation,
    PasswordConfirmedSwapResult,
    RecoveredSwapLifecycle,
    SwapQuoteEngine,
    WalletPendingSwapRecovery,
} from '../../src/swap/application';
import type {
    DexCapabilities,
    DexProvider,
    DexProviderId,
    PendingSwapRecoveryResult,
    QuoteRequest,
    SwapQuote,
} from '../../src/swap';
import type {
    ExecuteSwapOptions,
    QuoteAllOptions,
    RecoverWalletSwapsOptions,
} from '../../src/swap';
import {
    NOW_MS,
    TON,
    USDT,
    WALLET,
    makeQuote,
} from './fixtures';

const SAFE_CAPABILITIES: DexCapabilities = Object.freeze({
    assetDiscovery: true,
    simulation: true,
    onChainDeadline: true,
    statusTracking: true,
    referrals: true,
    exactMinOut: true,
});
const ENCRYPTED_ACCOUNT = Object.freeze({
    type: 'v4r2',
    address: WALLET,
    encryptedSeed: Object.freeze({
        iv: '00'.repeat(12),
        data: '11'.repeat(16),
    }),
});

function provider(id: DexProviderId = 'stonfi'): DexProvider {
    return Object.freeze({
        id,
        displayName: id,
        website: 'https://example.invalid',
        capabilities: SAFE_CAPABILITIES,
        listAssets: () => Promise.resolve([]),
        supportsPair: () => Promise.resolve(true),
        quote: () => Promise.reject(new Error('unused provider method')),
        buildSwap: () => Promise.reject(new Error('unused provider method')),
        verifyDestination: () => Promise.reject(new Error('unused provider method')),
        getOutcome: () => Promise.reject(new Error('unused provider method')),
        explorerUrl: () => 'https://example.invalid',
    });
}

class Deferred<T> {
    public readonly promise: Promise<T>;
    private resolvePromise!: (value: T) => void;
    private rejectPromise!: (reason: unknown) => void;

    public constructor() {
        this.promise = new Promise<T>((resolve, reject) => {
            this.resolvePromise = resolve;
            this.rejectPromise = reject;
        });
    }

    public resolve(value: T): void {
        this.resolvePromise(value);
    }

    public reject(reason: unknown): void {
        this.rejectPromise(reason);
    }
}

class SimulatedStonfiEngine implements SwapQuoteEngine {
    public readonly network: NetworkId;
    public readonly providers: readonly DexProvider[];
    public readonly requests: QuoteRequest[] = [];
    public readonly options: QuoteAllOptions[] = [];
    public failure: unknown;
    public deferred: Deferred<SwapQuote> | null = null;
    public quoteValue: SwapQuote | null = null;

    public constructor(network: NetworkId = 'mainnet') {
        this.network = network;
        this.providers = Object.freeze([provider()]);
    }

    public requireBest(request: QuoteRequest, options: QuoteAllOptions = {}): Promise<SwapQuote> {
        this.requests.push(request);
        this.options.push(options);
        if (this.failure !== undefined) return Promise.reject(this.failure);
        if (this.deferred !== null) return this.deferred.promise;
        const quote = Object.freeze(makeQuote({
            providerId: 'stonfi',
            from: request.from,
            to: request.to,
            offerUnits: request.offerUnits,
            slippageBps: request.slippageBps,
            createdAtMs: request.nowMs,
        }));
        this.quoteValue = quote;
        return Promise.resolve(quote);
    }
}

class CapturingOperation implements PasswordConfirmedSwapOperation {
    public readonly network: NetworkId;
    public calls = 0;
    public request: ExecutePasswordConfirmedSwapRequest | null = null;
    public options: ExecuteSwapOptions | undefined;
    public deferred: Deferred<PasswordConfirmedSwapResult> | null = null;

    public constructor(network: NetworkId = 'mainnet') {
        this.network = network;
    }

    public execute(
        request: ExecutePasswordConfirmedSwapRequest,
        options?: ExecuteSwapOptions,
    ): Promise<PasswordConfirmedSwapResult> {
        this.calls += 1;
        this.request = request;
        this.options = options;
        options?.onProgress?.(Object.freeze({
            stage: 'wallet-confirmed',
            network: this.network,
            providerId: request.approval.quote.providerId,
            correlationId: request.approval.intent.correlationId,
            submissionId: 'parity_submission_1',
        }));
        options?.onProgress?.(Object.freeze({
            stage: 'dex-pending',
            network: this.network,
            providerId: request.approval.quote.providerId,
            correlationId: request.approval.intent.correlationId,
            submissionId: 'parity_submission_1',
        }));
        if (this.deferred !== null) return this.deferred.promise;
        return Promise.resolve(successResult(this.network, request.approval.intent.correlationId));
    }
}

class CapturingRecovery implements WalletPendingSwapRecovery {
    public readonly network: NetworkId;
    public calls = 0;
    public ownerAddress: string | null = null;
    public options: RecoverWalletSwapsOptions | undefined;
    public value: readonly PromiseSettledResult<PendingSwapRecoveryResult>[] = Object.freeze([]);

    public constructor(network: NetworkId = 'mainnet') {
        this.network = network;
    }

    public recoverWallet(
        ownerAddress: string,
        options?: RecoverWalletSwapsOptions,
    ): Promise<readonly PromiseSettledResult<PendingSwapRecoveryResult>[]> {
        this.calls += 1;
        this.ownerAddress = ownerAddress;
        this.options = options;
        return Promise.resolve(this.value);
    }
}

function successResult(
    network: NetworkId,
    correlationId: string,
): PasswordConfirmedSwapResult {
    return Object.freeze({
        state: 'succeeded',
        network,
        providerId: 'stonfi',
        walletAddress: WALLET,
        walletVersion: 'v4r2',
        correlationId,
        submissionId: 'parity_submission_1',
        walletConfirmationState: 'confirmed',
        dexExitCode: 'swap_ok',
        txHash: 'ab'.repeat(32),
        receivedUnits: 990_000_000n,
        explorerUrl: 'https://example.invalid/swap',
    });
}

function input(overrides: Partial<{
    readonly network: NetworkId;
    readonly amount: string;
    readonly correlationId: string;
    readonly symbol: string;
}> = {}) {
    return Object.freeze({
        network: overrides.network ?? 'mainnet',
        ownerAddress: WALLET,
        account: Object.freeze({ type: 'v4r2', address: WALLET }),
        from: Object.freeze({
            contractAddress: USDT.kind === 'jetton' ? USDT.master : 'invalid-fixture',
            symbol: overrides.symbol ?? USDT.symbol,
            name: 'Display metadata only',
            decimals: USDT.decimals,
        }),
        to: Object.freeze({
            contractAddress: 'native',
            symbol: TON.symbol,
            name: TON.name,
            decimals: TON.decimals,
        }),
        amount: overrides.amount ?? '0.2',
        slippageBps: 100,
        correlationId: overrides.correlationId ?? 'strict_integration_1',
    });
}

function integrationFixture(network: NetworkId = 'mainnet') {
    const engine = new SimulatedStonfiEngine(network);
    const quoteSession = new SwapQuoteSession({
        engine,
        providerId: 'stonfi',
        clock: () => NOW_MS,
    });
    const operation = new CapturingOperation(network);
    const lifecycle = new SwapLifecycleService(operation);
    const recoveryOperation = new CapturingRecovery(network);
    const recovery = new PendingSwapRecoveryBootstrap(recoveryOperation);
    const adapter = new StrictSwapUiAdapter({
        network,
        quoteSession,
        lifecycle,
        recovery,
    });
    return {
        adapter,
        engine,
        quoteSession,
        operation,
        recoveryOperation,
    };
}

describe('strict swap pre-cutover integration parity', () => {
    it.each([
        ['.5', 500_000n, '0.5'],
        ['12.', 12_000_000n, '12'],
    ] as const)('preserves UI amount form %s through exact Stage A/B quote units', async (
        amount,
        units,
        display,
    ) => {
        const f = integrationFixture();
        const quote = await f.adapter.quote(input({ amount }));

        expect(quote?.offerUnits).toBe(units.toString());
        expect(quote?.offerAmount).toBe(display);
        expect(f.engine.requests).toHaveLength(1);
        expect(f.engine.requests[0]?.offerUnits).toBe(units);
        expect(f.engine.options).toEqual([{ providerIds: ['stonfi'] }]);
        expect(Object.isFrozen(f.engine.options[0]?.providerIds)).toBe(true);
    });

    it('uses Jetton master identity even when display metadata claims TON', async () => {
        const f = integrationFixture();
        const quote = await f.adapter.quote(input({ symbol: 'TON' }));
        const request = f.engine.requests[0];

        expect(request?.from.kind).toBe('jetton');
        expect(quote?.fromAssetKey).toBe(USDT.kind === 'jetton' ? `jetton:${USDT.master}` : 'invalid');
        expect(quote?.fromSymbol).toBe('TON');
        expect(quote?.toAssetKey).toBe('native:ton');
    });

    it('does not fabricate an estimated approval when STON.fi simulation fails', async () => {
        const f = integrationFixture();
        const failure = Object.assign(new Error('official simulation unavailable'), { code: 'SIMULATION_FAILED' });
        f.engine.failure = failure;

        await expect(f.adapter.quote(input())).rejects.toBe(failure);
        expect(f.adapter.getSnapshot()).toMatchObject({
            phase: 'error',
            quote: null,
            errorCode: 'SIMULATION_FAILED',
        });
        expect(JSON.stringify(f.adapter.getSnapshot())).not.toMatch(/isEstimate|estimatedQuote|allQuotes|rawData/i);
    });

    it('hands the exact Stage B approval and quote instance into Stage C/D without reconstruction', async () => {
        const f = integrationFixture();
        const view = await f.adapter.quote(input({ amount: '.5' }));
        const issuedQuote = f.engine.quoteValue;
        expect(issuedQuote).not.toBeNull();

        const result = await f.adapter.execute(ENCRYPTED_ACCOUNT, 'password');
        const request = f.operation.request;
        expect(result.state).toBe('succeeded');
        expect(f.operation.calls).toBe(1);
        expect(request?.approval.quote).toBe(issuedQuote);
        expect(request?.approval.intent.offerUnits).toBe(500_000n);
        expect(request?.approval.request).toBeDefined();
        expect(request?.approval.generation).toBe(view?.generation);
        expect(request?.account.wallet.address).toBe(request?.approval.intent.wallet.address);
        expect(request?.password).toBe('password');
    });

    it('never reports success at wallet inclusion and waits for definitive DEX success', async () => {
        const f = integrationFixture();
        f.operation.deferred = new Deferred<PasswordConfirmedSwapResult>();
        await f.adapter.quote(input());

        const pending = f.adapter.execute(ENCRYPTED_ACCOUNT, 'password');
        expect(f.adapter.getSnapshot().lifecycle?.stage).toBe('dex-pending');
        expect(f.adapter.getSnapshot().lifecycle?.stage).not.toBe('succeeded');

        f.operation.deferred.resolve(successResult('mainnet', 'strict_integration_1'));
        await pending;
        expect(f.adapter.getSnapshot().lifecycle?.stage).toBe('succeeded');
        expect(f.adapter.getSnapshot().lifecycle?.dexExitCode).toBe('swap_ok');
    });

    it('invalidates an in-flight real quote session and prevents approval execution', async () => {
        const f = integrationFixture();
        f.engine.deferred = new Deferred<SwapQuote>();
        const pending = f.adapter.quote(input());
        f.adapter.invalidate();
        f.engine.deferred.resolve(Object.freeze(makeQuote({
            providerId: 'stonfi',
            from: USDT,
            to: TON,
            offerUnits: 200_000n,
            slippageBps: 100,
            createdAtMs: NOW_MS,
        })));

        await expect(pending).resolves.toBeNull();
        await expect(f.adapter.execute(ENCRYPTED_ACCOUNT, 'password')).rejects.toThrow('approval');
        expect(f.operation.calls).toBe(0);
    });


    it('rejects explicit network mismatch before provider simulation', async () => {
        const f = integrationFixture('mainnet');

        await expect(f.adapter.quote(input({ network: 'testnet' }))).rejects.toMatchObject({
            code: 'QUOTE_SESSION_NETWORK_MISMATCH',
        });
        expect(f.engine.requests).toEqual([]);
    });

    it('runs Stage E recovery only and never routes reload bootstrap through execution', async () => {
        const f = integrationFixture();
        const recovered = await f.adapter.recover(WALLET);

        expect(recovered).toEqual([]);
        expect(f.recoveryOperation.calls).toBe(1);
        expect(f.recoveryOperation.ownerAddress).toBe(WALLET);
        expect(f.operation.calls).toBe(0);
        expect(f.engine.requests).toEqual([]);
        expect(f.adapter.getSnapshot().phase).toBe('idle');
    });

    it('projects rejected recovery records into metadata-only adapter state', async () => {
        const f = integrationFixture();
        const failure = Object.assign(new Error('recovery unavailable'), { code: 'RECOVERY_RPC_FAILED' });
        f.recoveryOperation.value = Object.freeze([
            Object.freeze({ status: 'rejected' as const, reason: failure }),
        ]);
        const observer = vi.fn<[RecoveredSwapLifecycle], void>();

        const recovered = await f.adapter.recover(WALLET, { onLifecycle: observer });
        expect(recovered).toEqual([{
            status: 'rejected',
            stage: 'unknown',
            network: 'mainnet',
            providerId: null,
            correlationId: null,
            submissionId: null,
            walletConfirmationState: null,
            dexExitCode: null,
            txHash: null,
            explorerUrl: null,
            errorCode: 'RECOVERY_RPC_FAILED',
        }]);
        expect(observer).toHaveBeenCalledOnce();
        expect(observer).toHaveBeenCalledWith(recovered[0]);
        expect(f.adapter.getSnapshot().recovered).toBe(recovered);
        expect(JSON.stringify(f.adapter.getSnapshot())).not.toMatch(
            /password|mnemonic|seed|payload|signature|providerData|rawData/i,
        );
    });
});
