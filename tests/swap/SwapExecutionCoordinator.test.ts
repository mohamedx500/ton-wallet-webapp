import type { Address } from '@ton/core';
import { describe, expect, it } from 'vitest';

import type { BalanceReader } from '../../src/core/jetton';
import { BlockchainDiagnostics, MemoryDiagnosticSink } from '../../src/observability';
import {
    SwapEngine,
    SwapError,
    SwapErrorCode,
    SwapExecutionCoordinator,
} from '../../src/swap';
import type {
    DestinationCheck,
    DestinationVerdict,
    DexCapabilities,
    DexProvider,
    DexProviderSource,
    PendingSwapReference,
    PendingSwapReferenceStore,
    SwapBuildContext,
    SwapOutcome,
    SwapPlan,
    SwapQuote,
} from '../../src/swap';
import type {
    StandardWalletDescriptor,
    TransactionConfirmation,
    WalletExecutionCoordinator,
    WalletExecutionOptions,
    WalletExecutionRequest,
    WalletExecutionResult,
} from '../../src/wallet';
import { WalletExecutionError } from '../../src/wallet';
import {
    DEFAULT_GAS,
    NOW_MS,
    OWN_JETTON_WALLET,
    ROUTER,
    TON,
    USDT,
    WALLET,
    makeMessage,
    makePlan,
    makeQuote,
    FakeChain,
} from './fixtures';

const QUERY_ID = 0x1234_5678_9abc_def0n;
const CORRELATION_ID = 'swap_execution_001';

const DESCRIPTOR: StandardWalletDescriptor = Object.freeze({
    kind: 'standard',
    version: 'v4r2',
    address: WALLET,
});

const CAPABILITIES: DexCapabilities = Object.freeze({
    assetDiscovery: false,
    simulation: true,
    onChainDeadline: true,
    statusTracking: true,
    referrals: false,
    exactMinOut: true,
});

class FakeProvider implements DexProvider {
    public readonly id = 'test-dex';
    public readonly displayName = 'Test DEX';
    public readonly website = 'https://example.invalid';
    public readonly capabilities = CAPABILITIES;
    public buildCalls = 0;
    public outcomeCalls = 0;
    public outcome: SwapOutcome = Object.freeze({
        state: 'succeeded',
        exitCode: 'swap_ok',
        txHash: 'ab'.repeat(32),
        receivedUnits: 990_000_000n,
        explorerUrl: 'https://example.invalid/transaction',
    });
    public builtPlan: SwapPlan | null = null;

    public listAssets(): Promise<readonly never[]> {
        return Promise.resolve([]);
    }

    public supportsPair(): Promise<boolean> {
        return Promise.resolve(true);
    }

    public quote(): Promise<SwapQuote> {
        throw new Error('unused');
    }

    public buildSwap(quote: SwapQuote, context: SwapBuildContext): Promise<SwapPlan> {
        this.buildCalls += 1;
        const plan = makePlan({
            quote,
            providerId: this.id,
            messages: [makeMessage({
                to: OWN_JETTON_WALLET,
                value: quote.gas.messageValue,
                purpose: 'Execute the verified test swap',
            })],
            reference: {
                providerId: this.id,
                routerAddress: ROUTER,
                ownerAddress: context.walletAddress,
                queryId: context.queryId,
                deadlineUnix: Math.floor(context.nowMs / 1_000) + context.deadlineSeconds,
            },
            expiresAtMs: context.nowMs + 120_000,
        });
        this.builtPlan = plan;
        return Promise.resolve(plan);
    }

    public verifyDestination(check: DestinationCheck): Promise<DestinationVerdict> {
        if (this.builtPlan === null) {
            throw new Error('build must precede verification');
        }
        return Promise.resolve({
            trusted: true,
            role: check.expectedRole,
            reason: 'derived independently by the test provider',
        });
    }

    public getOutcome(): Promise<SwapOutcome> {
        this.outcomeCalls += 1;
        return Promise.resolve(this.outcome);
    }

    public explorerUrl(): string {
        return 'https://example.invalid/wallet';
    }
}

class SingleProviderRegistry implements DexProviderSource {
    public constructor(private readonly provider: DexProvider) {}
    public list(): readonly DexProvider[] { return [this.provider]; }
    public get(id: string): DexProvider | undefined { return id === this.provider.id ? this.provider : undefined; }
    public require(id: string): DexProvider {
        const provider = this.get(id);
        if (provider === undefined) throw new Error(`missing provider: ${id}`);
        return provider;
    }
}

class FixedBalances implements BalanceReader {
    public getNativeBalance(_owner: Address): Promise<bigint> {
        return Promise.resolve(10_000_000_000n);
    }
    public getJettonBalance(_owner: Address, _master: Address): Promise<bigint> {
        return Promise.resolve(10_000_000_000n);
    }
}

class FakeRecoveryStore implements PendingSwapReferenceStore {
    public persisted: PendingSwapReference | null = null;
    public removed: string[] = [];
    public error: unknown;
    public async put(reference: PendingSwapReference): Promise<void> {
        if (this.error !== undefined) throw this.error;
        this.persisted = reference;
    }
    public async get(): Promise<PendingSwapReference | null> { return null; }
    public async list(): Promise<readonly PendingSwapReference[]> { return []; }
    public async remove(_network: 'mainnet' | 'testnet', submissionId: string): Promise<void> {
        this.removed.push(submissionId);
    }
}

class FakeWalletCoordinator implements WalletExecutionCoordinator {
    public readonly network = 'mainnet' as const;
    public calls = 0;
    public request: WalletExecutionRequest | null = null;
    public options: WalletExecutionOptions | undefined;
    public error: unknown;
    public confirmationState: TransactionConfirmation['state'] = 'confirmed';

    public async execute(
        request: WalletExecutionRequest,
        options?: WalletExecutionOptions,
    ): Promise<WalletExecutionResult> {
        this.calls += 1;
        this.request = request;
        this.options = options;
        if (this.error !== undefined) throw this.error;
        const reference = {
            schemaVersion: 1 as const,
            submissionId: 'submission_001',
            network: this.network,
            walletAddress: request.wallet.address,
            walletVersion: request.wallet.version,
            correlationId: request.correlationId,
            submittedAtMs: NOW_MS + 1_000,
            replayProtection: { kind: 'seqno' as const, seqno: 9 },
            transportId: 'cd'.repeat(32),
        };
        try {
            await options?.onSubmitted?.(reference);
        } catch (cause) {
            throw new WalletExecutionError(
                'POST_SUBMISSION_HOOK_FAILED',
                'Feature recovery metadata could not be persisted.',
                { retryable: true, cause, submissionReference: reference },
            );
        }
        return Object.freeze({
            reference,
            confirmation: Object.freeze({
                state: this.confirmationState,
                reference,
                checkedAtMs: NOW_MS + 2_000,
                txHash: this.confirmationState === 'confirmed' || this.confirmationState === 'failed'
                    ? 'ef'.repeat(32)
                    : null,
                exitCode: this.confirmationState === 'failed' ? '33' : null,
            }),
        });
    }
}

function fixture() {
    const provider = new FakeProvider();
    const wallet = new FakeWalletCoordinator();
    const recoveryStore = new FakeRecoveryStore();
    const sink = new MemoryDiagnosticSink();
    const diagnostics = new BlockchainDiagnostics({ sink, clock: () => NOW_MS });
    const engine = new SwapEngine({
        chain: new FakeChain(),
        registry: new SingleProviderRegistry(provider),
        balances: new FixedBalances(),
        clock: () => NOW_MS,
        queryIds: { next: () => QUERY_ID },
    });
    const coordinator = new SwapExecutionCoordinator({
        network: 'mainnet',
        engine,
        wallet,
        recoveryStore,
        diagnostics,
        clock: () => NOW_MS,
    });
    const quote = makeQuote({
        providerId: provider.id,
        from: USDT,
        to: TON,
        offerUnits: 200_000n,
        gas: DEFAULT_GAS,
        createdAtMs: NOW_MS,
    });
    return { coordinator, provider, wallet, recoveryStore, sink, quote };
}

describe('swap execution coordinator', () => {
    it('prepares, preserves payload identity, confirms wallet inclusion, then verifies DEX success', async () => {
        const f = fixture();
        const walletSignal = new AbortController().signal;
        const outcomeSignal = new AbortController().signal;

        const result = await f.coordinator.execute(
            { quote: f.quote, wallet: DESCRIPTOR, correlationId: CORRELATION_ID },
            {
                wallet: { confirmation: { timeoutMs: 5_000, signal: walletSignal } },
                outcome: { timeoutMs: 5_000, pollIntervalMs: 1, signal: outcomeSignal },
            },
        );

        expect(result.state).toBe('succeeded');
        expect(f.wallet.calls).toBe(1);
        expect(f.provider.outcomeCalls).toBe(1);
        expect(f.wallet.request?.network).toBe('mainnet');
        expect(f.wallet.request?.wallet).toBe(DESCRIPTOR);
        expect(f.wallet.request?.correlationId).toBe(CORRELATION_ID);
        expect(f.wallet.request?.messages[0]?.body).toBe(result.prepared.plan.messages[0]?.body);
        expect(f.wallet.request?.messages[0]?.bounce).toBe(true);
        expect(f.wallet.request?.validUntilUnix).toBe(Math.floor(result.prepared.plan.expiresAtMs / 1_000));
        expect(f.wallet.options?.confirmation).toEqual({ timeoutMs: 5_000, signal: walletSignal });
        expect(f.wallet.options?.onSubmitted).toBeTypeOf('function');
        expect(result.prepared.plan.reference.queryId).toBe(QUERY_ID);
        expect(result.wallet.reference.replayProtection).toEqual({ kind: 'seqno', seqno: 9 });
        expect(result.outcome?.receivedUnits).toBe(990_000_000n);
        expect(f.recoveryStore.persisted).toEqual({
            schemaVersion: 1,
            network: 'mainnet',
            submission: result.wallet.reference,
            swap: result.prepared.plan.reference,
        });
        expect(f.recoveryStore.removed).toEqual(['submission_001']);
        expect(Object.isFrozen(result)).toBe(true);
    });

    it('emits ordered metadata-only progress and preserves caller hooks', async () => {
        const f = fixture();
        const progress: import('../../src/swap').SwapExecutionProgress[] = [];

        await f.coordinator.execute(
            { quote: f.quote, wallet: DESCRIPTOR, correlationId: CORRELATION_ID },
            { onProgress: (event) => progress.push(event) },
        );

        expect(progress.map((event) => event.stage)).toEqual([
            'preparing',
            'signing',
            'submitted',
            'wallet-confirmed',
            'dex-pending',
        ]);
        expect(progress.every(Object.isFrozen)).toBe(true);
        expect(progress[0]).toEqual({
            stage: 'preparing',
            network: 'mainnet',
            providerId: 'test-dex',
            correlationId: CORRELATION_ID,
            submissionId: null,
        });
        expect(progress[2]?.submissionId).toBe('submission_001');
        expect(JSON.stringify(progress)).not.toMatch(
            /body|boc|cell|signature|mnemonic|password|signed|payload|queryId/i,
        );
    });

    it('ignores progress-observer errors without changing execution', async () => {
        const f = fixture();
        const result = await f.coordinator.execute(
            { quote: f.quote, wallet: DESCRIPTOR, correlationId: CORRELATION_ID },
            { onProgress: () => { throw new Error('UI observer failed'); } },
        );
        expect(result.state).toBe('succeeded');
        expect(f.wallet.calls).toBe(1);
        expect(f.provider.outcomeCalls).toBe(1);
    });

    it('persists swap recovery before wallet confirmation and preserves caller hooks', async () => {
        const f = fixture();
        let observedSubmissionId: string | null = null;

        await f.coordinator.execute(
            { quote: f.quote, wallet: DESCRIPTOR, correlationId: CORRELATION_ID },
            {
                wallet: {
                    onSubmitted: (reference) => {
                        observedSubmissionId = reference.submissionId;
                        expect(f.recoveryStore.persisted?.submission).toBe(reference);
                    },
                },
            },
        );

        expect(observedSubmissionId).toBe('submission_001');
        expect(f.recoveryStore.persisted?.swap.queryId).toBe(QUERY_ID);
    });

    it('does not poll the DEX when swap recovery persistence fails post-submission', async () => {
        const f = fixture();
        f.recoveryStore.error = new SwapError(
            SwapErrorCode.RecoveryStoreFailed,
            'recovery store unavailable',
            { retryable: true },
        );

        await expect(f.coordinator.execute({
            quote: f.quote,
            wallet: DESCRIPTOR,
            correlationId: CORRELATION_ID,
        })).rejects.toMatchObject({
            code: 'POST_SUBMISSION_HOOK_FAILED',
            cause: { code: SwapErrorCode.RecoveryStoreFailed },
        });

        expect(f.wallet.calls).toBe(1);
        expect(f.provider.outcomeCalls).toBe(0);
    });

    it.each(['pending', 'unknown', 'failed'] as const)(
        'does not query the DEX when wallet confirmation is %s',
        async (state) => {
            const f = fixture();
            f.wallet.confirmationState = state;

            const progress: import('../../src/swap').SwapExecutionProgress[] = [];
            const result = await f.coordinator.execute(
                {
                    quote: f.quote,
                    wallet: DESCRIPTOR,
                    correlationId: CORRELATION_ID,
                },
                { onProgress: (event) => progress.push(event) },
            );

            expect(result.state).toBe(state);
            expect(progress.map((event) => event.stage)).toEqual(
                state === 'failed'
                    ? ['preparing', 'signing', 'submitted']
                    : ['preparing', 'signing', 'submitted', 'wallet-pending'],
            );
            expect(result.outcome).toBeNull();
            expect(f.provider.outcomeCalls).toBe(0);
            expect(f.recoveryStore.removed).toEqual(
                state === 'failed' ? ['submission_001'] : [],
            );
        },
    );

    it('reports a DEX refund as failed even after the wallet transaction was confirmed', async () => {
        const f = fixture();
        f.provider.outcome = Object.freeze({
            state: 'failed',
            exitCode: 'swap_refund_slippage',
            txHash: 'ab'.repeat(32),
            receivedUnits: 200_000n,
            explorerUrl: 'https://example.invalid/refund',
        });

        const result = await f.coordinator.execute({
            quote: f.quote,
            wallet: DESCRIPTOR,
            correlationId: CORRELATION_ID,
        });

        expect(result.state).toBe('failed');
        expect(result.wallet.confirmation.state).toBe('confirmed');
        expect(result.outcome?.exitCode).toBe('swap_refund_slippage');
        expect(f.recoveryStore.removed).toEqual(['submission_001']);
    });

    it('returns unknown instead of inventing success when DEX confirmation times out', async () => {
        const f = fixture();
        f.provider.outcome = Object.freeze({
            state: 'pending',
            exitCode: null,
            txHash: null,
            receivedUnits: null,
            explorerUrl: 'https://example.invalid/pending',
        });

        const result = await f.coordinator.execute(
            { quote: f.quote, wallet: DESCRIPTOR, correlationId: CORRELATION_ID },
            { outcome: { timeoutMs: 0, pollIntervalMs: 1 } },
        );

        expect(result.state).toBe('unknown');
        expect(result.outcome?.state).toBe('unknown');
        expect(f.provider.outcomeCalls).toBe(1);
        expect(f.recoveryStore.removed).toEqual([]);
    });

    it('does not query the DEX when wallet signing or submission fails', async () => {
        const f = fixture();
        f.wallet.error = new WalletExecutionError('SIGNING_FAILED', 'Signing failed.');

        await expect(f.coordinator.execute({
            quote: f.quote,
            wallet: DESCRIPTOR,
            correlationId: CORRELATION_ID,
        })).rejects.toMatchObject({ code: 'SIGNING_FAILED' });

        expect(f.provider.outcomeCalls).toBe(0);
    });

    it('marks wallet confirmation cancellation as cancelled diagnostics', async () => {
        const f = fixture();
        f.wallet.error = new WalletExecutionError(
            'CONFIRMATION_CANCELLED',
            'Transaction confirmation was cancelled.',
        );

        await expect(f.coordinator.execute({
            quote: f.quote,
            wallet: DESCRIPTOR,
            correlationId: CORRELATION_ID,
        })).rejects.toMatchObject({ code: 'CONFIRMATION_CANCELLED' });

        const transactionEvents = f.sink.events().filter((event) => event.operation === 'transaction');
        expect(transactionEvents.at(-1)?.stage).toBe('cancelled');
        expect(f.provider.outcomeCalls).toBe(0);
    });

    it('marks DEX outcome cancellation as cancelled diagnostics', async () => {
        const f = fixture();
        const controller = new AbortController();
        controller.abort(new Error('navigation cancelled'));

        await expect(f.coordinator.execute(
            { quote: f.quote, wallet: DESCRIPTOR, correlationId: CORRELATION_ID },
            { outcome: { signal: controller.signal } },
        )).rejects.toBe(controller.signal.reason);

        const events = f.sink.events();
        expect(events.some((event) => event.operation === 'confirmation' && event.stage === 'cancelled'))
            .toBe(true);
        expect(events.filter((event) => event.operation === 'transaction').at(-1)?.stage).toBe('cancelled');
        expect(f.provider.outcomeCalls).toBe(0);
    });

    it('rejects an expired plan before the wallet coordinator can sign', async () => {
        const f = fixture();
        const coordinator = new SwapExecutionCoordinator({
            network: 'mainnet',
            engine: new SwapEngine({
                chain: new FakeChain(),
                registry: new SingleProviderRegistry(f.provider),
                balances: new FixedBalances(),
                clock: () => NOW_MS,
                queryIds: { next: () => QUERY_ID },
            }),
            wallet: f.wallet,
            recoveryStore: f.recoveryStore,
            clock: () => NOW_MS + 121_000,
        });

        await expect(coordinator.execute({
            quote: f.quote,
            wallet: DESCRIPTOR,
            correlationId: CORRELATION_ID,
        })).rejects.toMatchObject({ code: SwapErrorCode.QuoteExpired });

        expect(f.wallet.calls).toBe(0);
        expect(f.provider.outcomeCalls).toBe(0);
    });

    it('rejects coordinator network mismatch at construction', () => {
        const f = fixture();
        const testnetWallet: WalletExecutionCoordinator = {
            network: 'testnet',
            execute: f.wallet.execute.bind(f.wallet),
        };
        const engine = new SwapEngine({
            chain: new FakeChain(),
            registry: new SingleProviderRegistry(f.provider),
            balances: new FixedBalances(),
            clock: () => NOW_MS,
        });

        expect(() => new SwapExecutionCoordinator({
            network: 'mainnet',
            engine,
            wallet: testnetWallet,
            recoveryStore: f.recoveryStore,
            clock: () => NOW_MS,
        })).toThrowError(WalletExecutionError);
    });

    it('emits correlated metadata-only lifecycle diagnostics', async () => {
        const f = fixture();

        await f.coordinator.execute({
            quote: f.quote,
            wallet: DESCRIPTOR,
            correlationId: CORRELATION_ID,
        });

        const events = f.sink.events();
        expect(new Set(events.map((event) => event.correlationId))).toEqual(new Set([CORRELATION_ID]));
        expect(events.some((event) => event.operation === 'payload_build' && event.stage === 'succeeded')).toBe(true);
        expect(events.some((event) => event.operation === 'confirmation' && event.attributes['confirmationPhase'] === 'dexOutcome'))
            .toBe(true);
        expect(JSON.stringify(events.map((event) => event.attributes)))
            .not.toMatch(/body|boc|cell|signature|mnemonic|password|signed/i);
    });
});
