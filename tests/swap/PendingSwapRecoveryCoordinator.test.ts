import { Address } from '@ton/core';
import { describe, expect, it } from 'vitest';

import type { BalanceReader } from '../../src/core/jetton';
import { BlockchainDiagnostics, MemoryDiagnosticSink } from '../../src/observability';
import {
    PendingSwapRecoveryCoordinator,
    SwapEngine,
    SwapError,
    SwapErrorCode,
} from '../../src/swap';
import type {
    DexProvider,
    DexProviderSource,
    PendingSwapReference,
    PendingSwapReferenceStore,
    SwapOutcome,
} from '../../src/swap';
import type {
    ConfirmationOptions,
    SubmissionReference,
    TransactionConfirmation,
    TransactionConfirmer,
} from '../../src/wallet';
import { WalletExecutionError } from '../../src/wallet';
import {
    NOW_MS,
    ROUTER,
    WALLET,
    FakeChain,
} from './fixtures';

const QUERY_ID = 0x1234_5678_9abc_def0n;
const CORRELATION_ID = 'swap_recovery_001';

function submission(): SubmissionReference {
    return {
        schemaVersion: 1,
        submissionId: 'submission_001',
        network: 'mainnet',
        walletAddress: WALLET,
        walletVersion: 'v4r2',
        correlationId: CORRELATION_ID,
        submittedAtMs: NOW_MS,
        replayProtection: { kind: 'seqno', seqno: 9 },
        transportId: 'ab'.repeat(32),
    };
}

function pending(): PendingSwapReference {
    return {
        schemaVersion: 1,
        network: 'mainnet',
        submission: submission(),
        swap: {
            providerId: 'test-dex',
            routerAddress: ROUTER,
            ownerAddress: WALLET,
            queryId: QUERY_ID,
            deadlineUnix: Math.floor(NOW_MS / 1_000) + 120,
        },
    };
}

class FakeStore implements PendingSwapReferenceStore {
    public references: PendingSwapReference[] = [pending()];
    public removed: string[] = [];
    public async put(reference: PendingSwapReference): Promise<void> {
        this.references.push(reference);
    }
    public async get(_network: 'mainnet' | 'testnet', submissionId: string) {
        return this.references.find((item) => item.submission.submissionId === submissionId) ?? null;
    }
    public async list(_network: 'mainnet' | 'testnet', ownerAddress: string) {
        return this.references.filter((item) => Address.parse(item.swap.ownerAddress).equals(Address.parse(ownerAddress)));
    }
    public async remove(_network: 'mainnet' | 'testnet', submissionId: string): Promise<void> {
        this.removed.push(submissionId);
        this.references = this.references.filter((item) => item.submission.submissionId !== submissionId);
    }
}

class FakeConfirmer implements TransactionConfirmer {
    public readonly network = 'mainnet' as const;
    public calls = 0;
    public options: ConfirmationOptions | undefined;
    public error: unknown;
    public state: TransactionConfirmation['state'] = 'confirmed';
    public async confirm(reference: SubmissionReference, options?: ConfirmationOptions): Promise<TransactionConfirmation> {
        this.calls += 1;
        this.options = options;
        if (this.error !== undefined) throw this.error;
        return {
            state: this.state,
            reference,
            checkedAtMs: NOW_MS + 1_000,
            txHash: this.state === 'confirmed' || this.state === 'failed' ? 'cd'.repeat(32) : null,
            exitCode: this.state === 'failed' ? '33' : null,
        };
    }
}

class FakeProvider implements DexProvider {
    public readonly id = 'test-dex';
    public readonly displayName = 'Test DEX';
    public readonly website = 'https://example.invalid';
    public readonly capabilities = {
        assetDiscovery: false,
        simulation: true,
        onChainDeadline: true,
        statusTracking: true,
        referrals: false,
        exactMinOut: true,
    } as const;
    public outcomeCalls = 0;
    public outcome: SwapOutcome = {
        state: 'succeeded',
        exitCode: 'swap_ok',
        txHash: 'ef'.repeat(32),
        receivedUnits: 99n,
        explorerUrl: 'https://example.invalid/tx',
    };
    public listAssets(): Promise<readonly never[]> { return Promise.resolve([]); }
    public supportsPair(): Promise<boolean> { return Promise.resolve(true); }
    public quote(): Promise<never> { return Promise.reject(new Error('unused')); }
    public buildSwap(): Promise<never> { return Promise.reject(new Error('unused')); }
    public verifyDestination(): Promise<never> { return Promise.reject(new Error('unused')); }
    public getOutcome(): Promise<SwapOutcome> {
        this.outcomeCalls += 1;
        return Promise.resolve(this.outcome);
    }
    public explorerUrl(): string { return 'https://example.invalid'; }
}

class Registry implements DexProviderSource {
    public constructor(private readonly provider: DexProvider) {}
    public list() { return [this.provider]; }
    public get(id: string) { return id === this.provider.id ? this.provider : undefined; }
    public require(id: string) {
        const provider = this.get(id);
        if (provider === undefined) throw new Error('missing provider');
        return provider;
    }
}

class UnusedBalances implements BalanceReader {
    public getNativeBalance(): Promise<bigint> { return Promise.resolve(0n); }
    public getJettonBalance(): Promise<bigint> { return Promise.resolve(0n); }
}

function fixture() {
    const store = new FakeStore();
    const confirmer = new FakeConfirmer();
    const provider = new FakeProvider();
    const sink = new MemoryDiagnosticSink();
    const diagnostics = new BlockchainDiagnostics({ sink, clock: () => NOW_MS });
    const engine = new SwapEngine({
        chain: new FakeChain(),
        registry: new Registry(provider),
        balances: new UnusedBalances(),
        clock: () => NOW_MS,
    });
    const coordinator = new PendingSwapRecoveryCoordinator({
        network: 'mainnet',
        store,
        walletConfirmer: confirmer,
        engine,
        diagnostics,
    });
    return { coordinator, store, confirmer, provider, sink, engine };
}

describe('pending swap recovery coordinator', () => {
    it('reconfirms the exact wallet submission, resolves DEX success, and removes the terminal record', async () => {
        const f = fixture();
        const walletSignal = new AbortController().signal;
        const outcomeSignal = new AbortController().signal;

        const result = await f.coordinator.recover(pending(), {
            wallet: { timeoutMs: 5_000, signal: walletSignal },
            outcome: { timeoutMs: 5_000, pollIntervalMs: 1, signal: outcomeSignal },
        });

        expect(result.state).toBe('succeeded');
        expect(result.wallet.reference).toEqual(submission());
        expect(result.outcome?.state).toBe('succeeded');
        expect(f.confirmer.calls).toBe(1);
        expect(f.provider.outcomeCalls).toBe(1);
        expect(f.store.removed).toEqual(['submission_001']);
        expect(Object.isFrozen(result)).toBe(true);
    });

    it.each(['pending', 'unknown'] as const)(
        'retains the record and skips DEX polling when wallet confirmation is %s',
        async (state) => {
            const f = fixture();
            f.confirmer.state = state;

            const result = await f.coordinator.recover(pending());

            expect(result.state).toBe(state);
            expect(result.outcome).toBeNull();
            expect(f.provider.outcomeCalls).toBe(0);
            expect(f.store.removed).toEqual([]);
        },
    );

    it('removes the record after definitive wallet failure without polling the DEX', async () => {
        const f = fixture();
        f.confirmer.state = 'failed';

        const result = await f.coordinator.recover(pending());

        expect(result.state).toBe('failed');
        expect(result.outcome).toBeNull();
        expect(f.provider.outcomeCalls).toBe(0);
        expect(f.store.removed).toEqual(['submission_001']);
    });

    it.each(['succeeded', 'failed'] as const)(
        'removes the record after terminal DEX outcome %s',
        async (state) => {
            const f = fixture();
            f.provider.outcome = {
                state,
                exitCode: state === 'succeeded' ? 'swap_ok' : 'refund',
                txHash: 'ef'.repeat(32),
                receivedUnits: state === 'succeeded' ? 99n : null,
                explorerUrl: 'https://example.invalid/tx',
            };

            const result = await f.coordinator.recover(pending());

            expect(result.state).toBe(state);
            expect(f.store.removed).toEqual(['submission_001']);
        },
    );

    it.each(['pending', 'unknown'] as const)(
        'retains the record after non-terminal DEX outcome %s',
        async (state) => {
            const f = fixture();
            f.provider.outcome = {
                state,
                exitCode: null,
                txHash: null,
                receivedUnits: null,
                explorerUrl: 'https://example.invalid/pending',
            };

            const result = await f.coordinator.recover(pending(), {
                outcome: { timeoutMs: 0, pollIntervalMs: 1 },
            });

            expect(result.state).toBe('unknown');
            expect(f.store.removed).toEqual([]);
        },
    );

    it('retains the record on wallet cancellation and never resubmits', async () => {
        const f = fixture();
        f.confirmer.error = new WalletExecutionError(
            'CONFIRMATION_CANCELLED',
            'cancelled',
        );

        await expect(f.coordinator.recover(pending())).rejects.toMatchObject({
            code: 'CONFIRMATION_CANCELLED',
        });

        expect(f.store.removed).toEqual([]);
        expect(f.provider.outcomeCalls).toBe(0);
        expect(f.sink.events().filter((event) => event.operation === 'transaction').at(-1)?.stage)
            .toBe('cancelled');
    });

    it('retains the record on DEX cancellation', async () => {
        const f = fixture();
        const controller = new AbortController();
        controller.abort(new Error('navigation cancelled'));

        await expect(f.coordinator.recover(pending(), {
            outcome: { signal: controller.signal },
        })).rejects.toBe(controller.signal.reason);

        expect(f.store.removed).toEqual([]);
        expect(f.provider.outcomeCalls).toBe(0);
        expect(f.sink.events().filter((event) => event.operation === 'transaction').at(-1)?.stage)
            .toBe('cancelled');
    });

    it('rejects network and owner mismatches before confirmation', async () => {
        const f = fixture();
        const wrongNetwork = { ...pending(), network: 'testnet' as const };
        const wrongOwner = {
            ...pending(),
            swap: {
                ...pending().swap,
                ownerAddress: Address.parseRaw(`0:${'44'.repeat(32)}`).toString(),
            },
        };

        await expect(f.coordinator.recover(wrongNetwork)).rejects.toBeInstanceOf(WalletExecutionError);
        await expect(f.coordinator.recover(wrongOwner)).rejects.toMatchObject({
            code: SwapErrorCode.RecoveryStoreFailed,
        });
        expect(f.confirmer.calls).toBe(0);
    });

    it('recovers a wallet list with bounded concurrency and isolated failures', async () => {
        const f = fixture();
        f.store.references = [
            pending(),
            {
                ...pending(),
                submission: {
                    ...submission(),
                    submissionId: 'submission_002',
                },
                swap: {
                    ...pending().swap,
                    queryId: QUERY_ID + 1n,
                },
            },
        ];
        let calls = 0;
        f.confirmer.confirm = async (reference) => {
            calls += 1;
            if (reference.submissionId === 'submission_002') {
                throw new WalletExecutionError('CONFIRMATION_FAILED', 'rpc unavailable');
            }
            return {
                state: 'confirmed',
                reference,
                checkedAtMs: NOW_MS,
                txHash: 'cd'.repeat(32),
                exitCode: null,
            };
        };

        const results = await f.coordinator.recoverWallet(WALLET, { concurrency: 2 });

        expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
        expect(calls).toBe(2);
    });

    it('validates recovery concurrency', async () => {
        const f = fixture();

        await expect(f.coordinator.recoverWallet(WALLET, { concurrency: 0 }))
            .rejects.toBeInstanceOf(SwapError);
    });

    it('rejects component network mismatch at construction', () => {
        const f = fixture();
        const testnetConfirmer: TransactionConfirmer = {
            network: 'testnet',
            confirm: f.confirmer.confirm.bind(f.confirmer),
        };

        expect(() => new PendingSwapRecoveryCoordinator({
            network: 'mainnet',
            store: f.store,
            walletConfirmer: testnetConfirmer,
            engine: f.engine,
        })).toThrowError(WalletExecutionError);
    });

    it('emits correlated metadata-only recovery diagnostics', async () => {
        const f = fixture();

        await f.coordinator.recover(pending());

        const events = f.sink.events();
        expect(new Set(events.map((event) => event.correlationId)))
            .toEqual(new Set([CORRELATION_ID]));
        expect(events.some((event) => (
            event.operation === 'confirmation'
            && event.attributes['confirmationPhase'] === 'walletRecovery'
        ))).toBe(true);
        expect(events.some((event) => (
            event.operation === 'confirmation'
            && event.attributes['confirmationPhase'] === 'dexRecovery'
        ))).toBe(true);
        expect(JSON.stringify(events.map((event) => event.attributes)))
            .not.toMatch(/body|boc|cell|signature|mnemonic|password|signed|payload/i);
    });
});
