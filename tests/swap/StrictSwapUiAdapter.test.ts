import { describe, expect, it, vi } from 'vitest';

import { parseAddress } from '../../src/core/address';
import type { NetworkId } from '../../src/core/chain';
import {
    StrictSwapUiAdapter,
} from '../../src/swap/application';
import type {
    PasswordConfirmedSwapResult,
    RecoveredSwapLifecycle,
    SwapLifecycleEvent,
    SwapQuoteSessionResult,
} from '../../src/swap/application';
import type { CreateSwapIntentInput } from '../../src/swap/application';
import type { SwapQuote } from '../../src/swap';
import {
    NOW_MS,
    TON,
    USDT,
    WALLET,
    makeQuote,
} from './fixtures';

const ENCRYPTED = Object.freeze({ iv: '00'.repeat(12), data: '11'.repeat(16) });
const INPUT: CreateSwapIntentInput = Object.freeze({
    network: 'mainnet',
    ownerAddress: WALLET,
    account: Object.freeze({ type: 'v4r2', address: WALLET }),
    from: Object.freeze({
        contractAddress: USDT.kind === 'jetton' ? USDT.master : 'unexpected',
        symbol: USDT.symbol,
        name: USDT.name,
        decimals: USDT.decimals,
    }),
    to: Object.freeze({
        contractAddress: 'native',
        symbol: TON.symbol,
        name: TON.name,
        decimals: TON.decimals,
    }),
    amount: '0.2',
    slippageBps: 100,
    correlationId: 'strict_ui_swap_1',
});

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

function quoteValue(): SwapQuote {
    return Object.freeze(makeQuote({
        providerId: 'stonfi',
        from: USDT,
        to: TON,
        offerUnits: 200_000n,
        slippageBps: 100,
        createdAtMs: NOW_MS,
    }));
}

function readyResult(generation = 1): SwapQuoteSessionResult {
    const intent = Object.freeze({
        network: 'mainnet' as const,
        ownerAddress: WALLET,
        wallet: Object.freeze({ kind: 'standard' as const, version: 'v4r2' as const, address: WALLET }),
        from: USDT,
        to: TON,
        offerUnits: 200_000n,
        slippageBps: 100,
        correlationId: INPUT.correlationId,
    });
    const quote = quoteValue();
    return Object.freeze({
        state: 'ready',
        approval: Object.freeze({
            intent,
            request: Object.freeze({
                from: USDT,
                to: TON,
                offerUnits: 200_000n,
                slippageBps: 100,
                walletAddress: WALLET,
                nowMs: NOW_MS,
            }),
            quote,
            generation,
        }),
    });
}

function executionResult(): PasswordConfirmedSwapResult {
    return Object.freeze({
        state: 'succeeded',
        network: 'mainnet',
        providerId: 'stonfi',
        walletAddress: WALLET,
        walletVersion: 'v4r2',
        correlationId: INPUT.correlationId,
        submissionId: 'strict_ui_submission_1',
        walletConfirmationState: 'confirmed',
        dexExitCode: 'swap_ok',
        txHash: 'ab'.repeat(32),
        receivedUnits: 990_000_000n,
        explorerUrl: 'https://example.invalid/swap',
    });
}

function formatNonBounceable(value: string): string {
    return parseAddress(value).toString({ bounceable: false, testOnly: false, urlSafe: true });
}

function addressKeyForTest(value: string): string {
    return parseAddress(value).toRawString();
}

function recoveredItem(): RecoveredSwapLifecycle {
    return Object.freeze({
        status: 'fulfilled',
        stage: 'dex-pending',
        network: 'mainnet',
        providerId: 'stonfi',
        correlationId: INPUT.correlationId,
        submissionId: 'strict_ui_submission_1',
        walletConfirmationState: 'confirmed',
        dexExitCode: null,
        txHash: 'ab'.repeat(32),
        explorerUrl: null,
        errorCode: null,
    });
}

function fixture(network: NetworkId = 'mainnet') {
    const quoteDeferred = new Deferred<SwapQuoteSessionResult>();
    const executionDeferred = new Deferred<PasswordConfirmedSwapResult>();
    const recoveryDeferred = new Deferred<readonly RecoveredSwapLifecycle[]>();
    const quote = vi.fn(() => quoteDeferred.promise);
    const invalidate = vi.fn();
    const execute = vi.fn((_request: unknown, options?: { onLifecycle?: (event: SwapLifecycleEvent) => void }) => {
        options?.onLifecycle?.(Object.freeze({
            stage: 'signing',
            network,
            providerId: 'stonfi',
            correlationId: INPUT.correlationId,
            submissionId: null,
            walletConfirmationState: null,
            dexExitCode: null,
            txHash: null,
            explorerUrl: null,
        }));
        return executionDeferred.promise;
    });
    const recoverWallet = vi.fn(() => recoveryDeferred.promise);
    const adapter = new StrictSwapUiAdapter({
        network,
        quoteSession: { network, providerId: 'stonfi', quote, invalidate } as never,
        lifecycle: { network, execute } as never,
        recovery: { network, recoverWallet } as never,
    });
    return {
        adapter,
        quote,
        invalidate,
        execute,
        recoverWallet,
        quoteDeferred,
        executionDeferred,
        recoveryDeferred,
    };
}

describe('StrictSwapUiAdapter', () => {
    it('starts with one immutable metadata-only snapshot', () => {
        const { adapter } = fixture();
        expect(adapter.getSnapshot()).toEqual({
            phase: 'idle',
            network: 'mainnet',
            quote: null,
            executionAvailable: false,
            lifecycle: null,
            recoveryOwnerKey: null,
            recoveryInProgress: false,
            recovered: [],
            recoveryErrorCode: null,
            errorCode: null,
        });
        expect(Object.isFrozen(adapter.getSnapshot())).toBe(true);
    });

    it('projects exact display metadata while retaining the executable approval privately', async () => {
        const f = fixture();
        const pending = f.adapter.quote(INPUT);
        expect(f.adapter.getSnapshot().phase).toBe('quoting');
        f.quoteDeferred.resolve(readyResult());
        const view = await pending;

        expect(view).toEqual({
            generation: 1,
            network: 'mainnet',
            providerId: 'stonfi',
            correlationId: INPUT.correlationId,
            walletAddress: WALLET,
            walletVersion: 'v4r2',
            fromAssetKey: USDT.kind === 'jetton' ? `jetton:${USDT.master}` : 'unexpected',
            fromSymbol: USDT.symbol,
            toAssetKey: 'native:ton',
            toSymbol: TON.symbol,
            offerUnits: '200000',
            offerAmount: '0.2',
            expectedOutUnits: '1000000000',
            expectedOutAmount: '1',
            minOutUnits: '990000000',
            minOutAmount: '0.99',
            slippageBps: 100,
            recommendedSlippageBps: null,
            priceImpactBps: 12,
            feeUnits: '600',
            feeAmount: '0.0006',
            feeSymbol: USDT.symbol,
            messageValueNano: '300000000',
            forwardValueNano: '240000000',
            estimatedGasNano: '180000000',
            routeLabels: ['Test DEX · constant product pool'],
            createdAtMs: NOW_MS,
        });
        expect(f.adapter.getSnapshot().phase).toBe('ready');
        expect(f.adapter.getSnapshot().executionAvailable).toBe(true);
        expect(JSON.stringify(f.adapter.getSnapshot())).not.toMatch(/providerData|rawData|payload|encrypted|password/i);
    });

    it('coalesces an identical in-flight quote', async () => {
        const f = fixture();
        const first = f.adapter.quote(INPUT);
        const duplicate = f.adapter.quote(INPUT);
        expect(duplicate).toBe(first);
        expect(f.quote).toHaveBeenCalledOnce();

        f.quoteDeferred.resolve(readyResult());
        await expect(first).resolves.toMatchObject({ providerId: 'stonfi' });
    });

    it('does not coalesce a changed intent and suppresses the older completion', async () => {
        const firstDeferred = new Deferred<SwapQuoteSessionResult>();
        const secondDeferred = new Deferred<SwapQuoteSessionResult>();
        const quote = vi.fn()
            .mockImplementationOnce(() => firstDeferred.promise)
            .mockImplementationOnce(() => secondDeferred.promise);
        const adapter = new StrictSwapUiAdapter({
            network: 'mainnet',
            quoteSession: { network: 'mainnet', providerId: 'stonfi', quote, invalidate: vi.fn() } as never,
            lifecycle: { network: 'mainnet', execute: vi.fn() } as never,
            recovery: { network: 'mainnet', recoverWallet: vi.fn() } as never,
        });

        const first = adapter.quote(INPUT);
        const changed = adapter.quote({ ...INPUT, amount: '0.3', correlationId: 'strict_ui_swap_2' });
        expect(changed).not.toBe(first);
        expect(quote).toHaveBeenCalledTimes(2);

        firstDeferred.resolve(readyResult(1));
        secondDeferred.resolve(Object.freeze({ state: 'superseded', generation: 2 }));
        await expect(first).resolves.toBeNull();
        await expect(changed).resolves.toBeNull();
        expect(adapter.getSnapshot().quote).toBeNull();
    });

    it('invalidates the private approval and suppresses a later quote completion', async () => {
        const f = fixture();
        const pending = f.adapter.quote(INPUT);
        f.adapter.invalidate();
        f.quoteDeferred.resolve(readyResult());

        await expect(pending).resolves.toBeNull();
        expect(f.invalidate).toHaveBeenCalledOnce();
        expect(f.adapter.getSnapshot().phase).toBe('idle');
        expect(f.adapter.getSnapshot().quote).toBeNull();
        await expect(f.adapter.execute({ type: 'v4r2' }, 'password')).rejects.toThrow('approval');
    });

    it('coalesces duplicate execution and never exposes password or encrypted account in snapshots', async () => {
        const f = fixture();
        const quoted = f.adapter.quote(INPUT);
        f.quoteDeferred.resolve(readyResult());
        await quoted;
        const account = { type: 'v4r2', address: WALLET, encryptedSeed: ENCRYPTED };
        const first = f.adapter.execute(account, 'top-secret-password');
        const duplicate = f.adapter.execute(account, 'top-secret-password');

        expect(duplicate).toBe(first);
        expect(f.execute).toHaveBeenCalledOnce();
        expect(f.adapter.getSnapshot().phase).toBe('executing');
        expect(f.adapter.getSnapshot().executionAvailable).toBe(false);
        expect(f.adapter.getSnapshot().lifecycle?.stage).toBe('signing');
        expect(JSON.stringify(f.adapter.getSnapshot())).not.toContain('top-secret-password');
        expect(JSON.stringify(f.adapter.getSnapshot())).not.toContain(ENCRYPTED.data);

        f.adapter.invalidate();
        expect(f.adapter.getSnapshot().phase).toBe('executing');

        f.executionDeferred.resolve(executionResult());
        await expect(first).resolves.toMatchObject({ state: 'succeeded' });
        expect(f.adapter.getSnapshot().phase).toBe('idle');
        expect(f.adapter.getSnapshot().quote).toBeNull();
        expect(f.adapter.getSnapshot().executionAvailable).toBe(false);
        await expect(f.adapter.execute(account, 'top-secret-password')).rejects.toThrow('approval');
    });

    it('keeps the approval retryable after a pre-submission password failure', async () => {
        const f = fixture();
        const quoted = f.adapter.quote(INPUT);
        f.quoteDeferred.resolve(readyResult());
        await quoted;
        const account = { type: 'v4r2', address: WALLET, encryptedSeed: ENCRYPTED };
        const error = Object.assign(new Error('invalid password'), { code: 'MNEMONIC_DECRYPTION_FAILED' });
        const pending = f.adapter.execute(account, 'wrong-password');
        f.executionDeferred.reject(error);

        await expect(pending).rejects.toBe(error);
        expect(f.adapter.getSnapshot().phase).toBe('error');
        expect(f.adapter.getSnapshot().quote).not.toBeNull();
        expect(f.adapter.getSnapshot().executionAvailable).toBe(true);
        expect(f.adapter.getSnapshot().errorCode).toBe('MNEMONIC_DECRYPTION_FAILED');
    });

    it('consumes the approval when a submission reference exists on failure', async () => {
        const f = fixture();
        const quoted = f.adapter.quote(INPUT);
        f.quoteDeferred.resolve(readyResult());
        await quoted;
        const account = { type: 'v4r2', address: WALLET, encryptedSeed: ENCRYPTED };
        const error = Object.assign(new Error('ambiguous submission'), {
            code: 'SUBMISSION_AMBIGUOUS',
            submissionReference: { submissionId: 'strict_ui_submission_1' },
        });
        const pending = f.adapter.execute(account, 'password');
        f.executionDeferred.reject(error);

        await expect(pending).rejects.toBe(error);
        expect(f.adapter.getSnapshot().quote).toBeNull();
        expect(f.adapter.getSnapshot().executionAvailable).toBe(false);
        await expect(f.adapter.execute(account, 'password')).rejects.toThrow('approval');
    });


    it('coalesces duplicate recovery calls by canonical owner and stores only lifecycle metadata', async () => {
        const f = fixture();
        const nonBounceable = formatNonBounceable(WALLET);
        const first = f.adapter.recover(WALLET);
        const duplicate = f.adapter.recover(nonBounceable);
        expect(duplicate).toBe(first);
        expect(f.recoverWallet).toHaveBeenCalledOnce();
        expect(f.recoverWallet).toHaveBeenCalledWith('mainnet', WALLET, expect.any(Object));
        expect(f.adapter.getSnapshot()).toMatchObject({
            recoveryOwnerKey: addressKeyForTest(WALLET),
            recoveryInProgress: true,
            recoveryErrorCode: null,
        });

        const recovered = Object.freeze([recoveredItem()]);
        f.recoveryDeferred.resolve(recovered);
        await expect(first).resolves.toBe(recovered);
        expect(f.adapter.getSnapshot().recovered).toBe(recovered);
        expect(f.adapter.getSnapshot().recoveryInProgress).toBe(false);
        expect(f.adapter.getSnapshot().phase).toBe('idle');

        const strictModeReplay = f.adapter.recover(nonBounceable);
        await expect(strictModeReplay).resolves.toBe(recovered);
        expect(f.recoverWallet).toHaveBeenCalledOnce();
    });

    it('does not let background recovery overwrite an active quote phase', async () => {
        const f = fixture();
        const recovery = f.adapter.recover(WALLET);
        const quote = f.adapter.quote(INPUT);
        expect(f.adapter.getSnapshot().phase).toBe('quoting');
        expect(f.adapter.getSnapshot().recoveryInProgress).toBe(true);

        f.recoveryDeferred.resolve(Object.freeze([recoveredItem()]));
        await recovery;
        expect(f.adapter.getSnapshot().phase).toBe('quoting');
        expect(f.adapter.getSnapshot().recoveryInProgress).toBe(false);

        f.quoteDeferred.resolve(readyResult());
        await quote;
        expect(f.adapter.getSnapshot().phase).toBe('ready');
    });

    it('suppresses stale recovery publication after an account switch', async () => {
        const firstDeferred = new Deferred<readonly RecoveredSwapLifecycle[]>();
        const secondDeferred = new Deferred<readonly RecoveredSwapLifecycle[]>();
        const recoverWallet = vi.fn()
            .mockImplementationOnce(() => firstDeferred.promise)
            .mockImplementationOnce(() => secondDeferred.promise);
        const adapter = new StrictSwapUiAdapter({
            network: 'mainnet',
            quoteSession: { network: 'mainnet', providerId: 'stonfi', quote: vi.fn(), invalidate: vi.fn() } as never,
            lifecycle: { network: 'mainnet', execute: vi.fn() } as never,
            recovery: { network: 'mainnet', recoverWallet } as never,
        });
        const secondOwner = 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c';

        const first = adapter.recover(WALLET);
        const second = adapter.recover(secondOwner);
        const secondRecovered = Object.freeze([{ ...recoveredItem(), correlationId: 'second-owner' }]);
        secondDeferred.resolve(secondRecovered);
        await second;
        expect(adapter.getSnapshot().recovered).toBe(secondRecovered);

        firstDeferred.resolve(Object.freeze([recoveredItem()]));
        await first;
        expect(adapter.getSnapshot().recoveryOwnerKey).toBe(addressKeyForTest(secondOwner));
        expect(adapter.getSnapshot().recovered).toBe(secondRecovered);
    });

    it('supports repeated Strict Mode-style subscribe/unsubscribe without starting work', () => {
        const f = fixture();
        const listener = vi.fn();
        const unsubscribeFirst = f.adapter.subscribe(listener);
        unsubscribeFirst();
        const unsubscribeSecond = f.adapter.subscribe(listener);
        unsubscribeSecond();

        expect(f.quote).not.toHaveBeenCalled();
        expect(f.execute).not.toHaveBeenCalled();
        expect(f.recoverWallet).not.toHaveBeenCalled();
    });

    it('isolates subscriber failures from state publication', () => {
        const f = fixture();
        const healthy = vi.fn();
        f.adapter.subscribe(() => {
            throw new Error('render observer failure');
        });
        f.adapter.subscribe(healthy);

        f.adapter.invalidate();
        expect(healthy).toHaveBeenCalledOnce();
        expect(f.adapter.getSnapshot().phase).toBe('idle');
    });

    it('rejects mixed-network services at construction', () => {
        expect(() => new StrictSwapUiAdapter({
            network: 'mainnet',
            quoteSession: { network: 'testnet' } as never,
            lifecycle: { network: 'mainnet' } as never,
            recovery: { network: 'mainnet' } as never,
        })).toThrow('same TON network');
    });
});
