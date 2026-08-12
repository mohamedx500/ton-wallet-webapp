import { describe, expect, it } from 'vitest';

import type { NetworkId } from '../../src/core/chain';
import {
    SwapApplicationError,
    SwapApplicationErrorCode,
    SwapQuoteSession,
} from '../../src/swap/application';
import type {
    SwapIntent,
    SwapQuoteEngine,
} from '../../src/swap/application';
import type {
    DexCapabilities,
    DexProvider,
    DexProviderId,
    QuoteRequest,
    SwapQuote,
} from '../../src/swap/types';
import type { QuoteAllOptions } from '../../src/swap/SwapEngine';
import {
    NOW_MS,
    TON,
    USDT,
    WALLET,
    makeQuote,
} from './fixtures';

const STONFI_PROVIDER_ID = 'stonfi';
const DEDUST_PROVIDER_ID = 'dedust';

const SAFE_CAPABILITIES: DexCapabilities = Object.freeze({
    assetDiscovery: true,
    simulation: true,
    onChainDeadline: true,
    statusTracking: true,
    referrals: false,
    exactMinOut: true,
});

function provider(
    id: DexProviderId,
    capabilities: DexCapabilities = SAFE_CAPABILITIES,
): DexProvider {
    return {
        id,
        displayName: id,
        website: 'https://example.invalid',
        capabilities,
        listAssets: () => Promise.resolve([]),
        supportsPair: () => Promise.resolve(true),
        quote: () => Promise.reject(new Error('unused')),
        buildSwap: () => Promise.reject(new Error('unused')),
        verifyDestination: () => Promise.reject(new Error('unused')),
        getOutcome: () => Promise.reject(new Error('unused')),
        explorerUrl: () => 'https://example.invalid',
    };
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

class FakeQuoteEngine implements SwapQuoteEngine {
    public readonly network: NetworkId;
    public readonly providers: readonly DexProvider[];
    public readonly requests: QuoteRequest[] = [];
    public readonly options: QuoteAllOptions[] = [];
    public readonly deferred: Deferred<SwapQuote>[] = [];

    public constructor(
        network: NetworkId = 'mainnet',
        providers: readonly DexProvider[] = [provider(STONFI_PROVIDER_ID)],
    ) {
        this.network = network;
        this.providers = providers;
    }

    public requireBest(request: QuoteRequest, options: QuoteAllOptions = {}): Promise<SwapQuote> {
        this.requests.push(request);
        this.options.push(options);
        const deferred = new Deferred<SwapQuote>();
        this.deferred.push(deferred);
        return deferred.promise;
    }
}

const INTENT: SwapIntent = Object.freeze({
    network: 'mainnet',
    ownerAddress: WALLET,
    wallet: Object.freeze({
        kind: 'standard',
        version: 'v4r2',
        address: WALLET,
    }),
    from: USDT,
    to: TON,
    offerUnits: 200_000n,
    slippageBps: 100,
    correlationId: 'stage_b_quote_1',
});

function quote(): SwapQuote {
    return Object.freeze(makeQuote({
        providerId: STONFI_PROVIDER_ID,
        from: INTENT.from,
        to: INTENT.to,
        offerUnits: INTENT.offerUnits,
        slippageBps: INTENT.slippageBps,
        createdAtMs: NOW_MS,
    }));
}

function expectApplicationError(run: () => unknown, code: string): void {
    let thrown: unknown;
    try {
        run();
    } catch (error) {
        thrown = error;
    }
    expect(thrown).toBeInstanceOf(SwapApplicationError);
    expect((thrown as SwapApplicationError).code).toBe(code);
}

describe('SwapQuoteSession configuration', () => {
    it('fails closed when the configured provider is absent', () => {
        const engine = new FakeQuoteEngine('mainnet', [provider(DEDUST_PROVIDER_ID)]);
        expectApplicationError(
            () => new SwapQuoteSession({ engine, providerId: STONFI_PROVIDER_ID, clock: () => NOW_MS }),
            SwapApplicationErrorCode.QuoteProviderUnavailable,
        );
    });

    it.each([
        'simulation',
        'exactMinOut',
        'onChainDeadline',
        'statusTracking',
    ] as const)('rejects a provider without required %s capability', (capability) => {
        const capabilities = Object.freeze({ ...SAFE_CAPABILITIES, [capability]: false });
        const engine = new FakeQuoteEngine('mainnet', [provider(STONFI_PROVIDER_ID, capabilities)]);
        expectApplicationError(
            () => new SwapQuoteSession({ engine, providerId: STONFI_PROVIDER_ID, clock: () => NOW_MS }),
            SwapApplicationErrorCode.QuoteProviderUnsafe,
        );
    });
});

describe('SwapQuoteSession quoting', () => {
    it('constructs one exact immutable request and restricts the engine to STON.fi', async () => {
        const engine = new FakeQuoteEngine();
        const session = new SwapQuoteSession({
            engine,
            providerId: STONFI_PROVIDER_ID,
            clock: () => NOW_MS,
        });
        const expectedQuote = quote();
        const pending = session.quote(INTENT);

        expect(engine.requests).toHaveLength(1);
        expect(engine.requests[0]).toEqual({
            from: INTENT.from,
            to: INTENT.to,
            offerUnits: INTENT.offerUnits,
            slippageBps: INTENT.slippageBps,
            walletAddress: INTENT.ownerAddress,
            nowMs: NOW_MS,
        });
        expect(Object.isFrozen(engine.requests[0])).toBe(true);
        expect(engine.options).toEqual([{ providerIds: [STONFI_PROVIDER_ID] }]);
        expect(Object.isFrozen(engine.options[0]?.providerIds)).toBe(true);

        engine.deferred[0]?.resolve(expectedQuote);
        const result = await pending;
        expect(result.state).toBe('ready');
        if (result.state === 'ready') {
            expect(result.approval.intent).toBe(INTENT);
            expect(result.approval.request).toBe(engine.requests[0]);
            expect(result.approval.quote).toBe(expectedQuote);
            expect(result.approval.generation).toBe(1);
            expect(Object.isFrozen(result)).toBe(true);
            expect(Object.isFrozen(result.approval)).toBe(true);
        }
    });

    it('rejects intent/session network mismatch before quoting', async () => {
        const engine = new FakeQuoteEngine('testnet');
        const session = new SwapQuoteSession({
            engine,
            providerId: STONFI_PROVIDER_ID,
            clock: () => NOW_MS,
        });
        await expect(session.quote(INTENT)).rejects.toMatchObject({
            code: SwapApplicationErrorCode.QuoteSessionNetworkMismatch,
        });
        expect(engine.requests).toEqual([]);
    });

    it('does not convert a provider failure into an estimated quote', async () => {
        const engine = new FakeQuoteEngine();
        const session = new SwapQuoteSession({
            engine,
            providerId: STONFI_PROVIDER_ID,
            clock: () => NOW_MS,
        });
        const failure = new Error('official simulation unavailable');
        const pending = session.quote(INTENT);
        engine.deferred[0]?.reject(failure);
        await expect(pending).rejects.toBe(failure);
    });

    it('rejects a quote attributed to a provider outside the configured boundary', async () => {
        const engine = new FakeQuoteEngine();
        const session = new SwapQuoteSession({
            engine,
            providerId: STONFI_PROVIDER_ID,
            clock: () => NOW_MS,
        });
        const pending = session.quote(INTENT);
        engine.deferred[0]?.resolve(Object.freeze(makeQuote({
            providerId: DEDUST_PROVIDER_ID,
            from: INTENT.from,
            to: INTENT.to,
            offerUnits: INTENT.offerUnits,
            slippageBps: INTENT.slippageBps,
            createdAtMs: NOW_MS,
        })));
        await expect(pending).rejects.toMatchObject({
            code: SwapApplicationErrorCode.QuoteProviderUnavailable,
        });
    });

    it('suppresses an older successful response after a newer request begins', async () => {
        const engine = new FakeQuoteEngine();
        let nowMs = NOW_MS;
        const session = new SwapQuoteSession({
            engine,
            providerId: STONFI_PROVIDER_ID,
            clock: () => nowMs,
        });
        const firstPending = session.quote(INTENT);
        nowMs += 1;
        const secondIntent = Object.freeze({ ...INTENT, correlationId: 'stage_b_quote_2' });
        const secondPending = session.quote(secondIntent);
        const firstQuote = quote();
        const secondQuote = Object.freeze({ ...quote(), createdAtMs: nowMs });

        engine.deferred[0]?.resolve(firstQuote);
        expect(await firstPending).toEqual({ state: 'superseded', generation: 1 });

        engine.deferred[1]?.resolve(secondQuote);
        const secondResult = await secondPending;
        expect(secondResult.state).toBe('ready');
        if (secondResult.state === 'ready') {
            expect(secondResult.approval.intent).toBe(secondIntent);
            expect(secondResult.approval.quote).toBe(secondQuote);
            expect(secondResult.approval.generation).toBe(2);
        }
    });

    it('suppresses an older failure after a newer request begins', async () => {
        const engine = new FakeQuoteEngine();
        const session = new SwapQuoteSession({
            engine,
            providerId: STONFI_PROVIDER_ID,
            clock: () => NOW_MS,
        });
        const firstPending = session.quote(INTENT);
        const secondPending = session.quote(Object.freeze({
            ...INTENT,
            correlationId: 'stage_b_quote_2',
        }));
        engine.deferred[0]?.reject(new Error('obsolete request failed'));
        await expect(firstPending).resolves.toEqual({ state: 'superseded', generation: 1 });
        engine.deferred[1]?.resolve(quote());
        await expect(secondPending).resolves.toMatchObject({ state: 'ready' });
    });

    it('invalidates an in-flight request when the consumer closes or changes intent', async () => {
        const engine = new FakeQuoteEngine();
        const session = new SwapQuoteSession({
            engine,
            providerId: STONFI_PROVIDER_ID,
            clock: () => NOW_MS,
        });
        const pending = session.quote(INTENT);
        session.invalidate();
        engine.deferred[0]?.resolve(quote());
        await expect(pending).resolves.toEqual({ state: 'superseded', generation: 1 });
    });

    it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid quote clock %s', async (nowMs) => {
        const engine = new FakeQuoteEngine();
        const session = new SwapQuoteSession({
            engine,
            providerId: STONFI_PROVIDER_ID,
            clock: () => nowMs,
        });
        await expect(session.quote(INTENT)).rejects.toMatchObject({
            code: SwapApplicationErrorCode.InvalidNetwork,
        });
        expect(engine.requests).toEqual([]);
    });
});
