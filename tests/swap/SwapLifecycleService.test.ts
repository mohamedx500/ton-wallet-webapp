import { describe, expect, it } from 'vitest';

import type { NetworkId } from '../../src/core/chain';
import { SwapLifecycleService } from '../../src/swap/application';
import type {
    ExecutePasswordConfirmedSwapRequest,
    PasswordConfirmedSwapOperation,
    PasswordConfirmedSwapResult,
    SwapLifecycleEvent,
} from '../../src/swap/application';
import type { ExecuteSwapOptions, SwapExecutionProgressStage } from '../../src/swap';
import { WalletExecutionError } from '../../src/wallet';
import type { SubmissionReference } from '../../src/wallet';
import {
    NOW_MS,
    TON,
    USDT,
    WALLET,
    makeQuote,
} from './fixtures';

const DESCRIPTOR = Object.freeze({
    kind: 'standard' as const,
    version: 'v4r2' as const,
    address: WALLET,
});
const INTENT = Object.freeze({
    network: 'mainnet' as const,
    ownerAddress: WALLET,
    wallet: DESCRIPTOR,
    from: USDT,
    to: TON,
    offerUnits: 200_000n,
    slippageBps: 100,
    correlationId: 'stage_d_swap_1',
});
const QUOTE = makeQuote({
    providerId: 'stonfi',
    from: USDT,
    to: TON,
    offerUnits: INTENT.offerUnits,
    slippageBps: INTENT.slippageBps,
    createdAtMs: NOW_MS,
});
const REQUEST: ExecutePasswordConfirmedSwapRequest = Object.freeze({
    approval: Object.freeze({
        intent: INTENT,
        request: Object.freeze({
            from: USDT,
            to: TON,
            offerUnits: INTENT.offerUnits,
            slippageBps: INTENT.slippageBps,
            walletAddress: WALLET,
            nowMs: NOW_MS,
        }),
        quote: QUOTE,
        generation: 1,
    }),
    account: Object.freeze({
        address: WALLET,
        wallet: DESCRIPTOR,
        encryptedMnemonic: Object.freeze({ iv: '00'.repeat(12), data: '11'.repeat(32) }),
    }),
    password: 'password',
});

function result(overrides: Partial<PasswordConfirmedSwapResult> = {}): PasswordConfirmedSwapResult {
    return Object.freeze({
        state: 'succeeded',
        network: 'mainnet',
        providerId: 'stonfi',
        walletAddress: WALLET,
        walletVersion: 'v4r2',
        correlationId: 'stage_d_swap_1',
        submissionId: 'submission_stage_d_1',
        walletConfirmationState: 'confirmed',
        dexExitCode: 'swap_ok',
        txHash: 'ab'.repeat(32),
        receivedUnits: 990_000_000n,
        explorerUrl: 'https://example.invalid/swap',
        ...overrides,
    });
}

class FakeOperation implements PasswordConfirmedSwapOperation {
    public readonly network: NetworkId;
    public calls = 0;
    public request: ExecutePasswordConfirmedSwapRequest | null = null;
    public options: ExecuteSwapOptions | undefined;
    public value: PasswordConfirmedSwapResult = result();
    public error: unknown;
    public progress: readonly SwapExecutionProgressStage[] = [
        'preparing',
        'signing',
        'submitted',
        'wallet-confirmed',
        'dex-pending',
    ];

    public constructor(network: NetworkId = 'mainnet') {
        this.network = network;
    }

    public async execute(
        request: ExecutePasswordConfirmedSwapRequest,
        options?: ExecuteSwapOptions,
    ): Promise<PasswordConfirmedSwapResult> {
        this.calls += 1;
        this.request = request;
        this.options = options;
        for (const stage of this.progress) {
            options?.onProgress?.(Object.freeze({
                stage,
                network: this.network,
                providerId: request.approval.quote.providerId,
                correlationId: request.approval.intent.correlationId,
                submissionId: stage === 'preparing' || stage === 'signing'
                    ? null
                    : 'submission_stage_d_1',
            }));
        }
        if (this.error !== undefined) throw this.error;
        return this.value;
    }
}

function fixture() {
    const operation = new FakeOperation();
    const service = new SwapLifecycleService(operation);
    const events: SwapLifecycleEvent[] = [];
    return { operation, service, events };
}

describe('swap lifecycle service', () => {
    it('emits the complete successful lifecycle and reports success only after DEX success', async () => {
        const f = fixture();
        const value = await f.service.execute(REQUEST, { onLifecycle: (event) => f.events.push(event) });

        expect(value.state).toBe('succeeded');
        expect(f.operation.request).toBe(REQUEST);
        expect(f.events.map((event) => event.stage)).toEqual([
            'preparing',
            'signing',
            'submitted',
            'wallet-confirmed',
            'dex-pending',
            'succeeded',
        ]);
        expect(f.events.at(-1)).toEqual({
            stage: 'succeeded',
            network: 'mainnet',
            providerId: 'stonfi',
            correlationId: 'stage_d_swap_1',
            submissionId: 'submission_stage_d_1',
            walletConfirmationState: 'confirmed',
            dexExitCode: 'swap_ok',
            txHash: 'ab'.repeat(32),
            explorerUrl: 'https://example.invalid/swap',
        });
        expect(f.events.every(Object.isFrozen)).toBe(true);
    });

    it('classifies DEX refund as failed after wallet confirmation', async () => {
        const f = fixture();
        f.operation.value = result({ state: 'failed', dexExitCode: 'swap_refund_slippage' });
        await f.service.execute(REQUEST, { onLifecycle: (event) => f.events.push(event) });
        expect(f.events.at(-1)?.stage).toBe('failed');
        expect(f.events.at(-1)?.walletConfirmationState).toBe('confirmed');
        expect(f.events.at(-1)?.dexExitCode).toBe('swap_refund_slippage');
        expect(f.events.some((event) => event.stage === 'succeeded')).toBe(false);
    });

    it.each([
        ['pending', 'pending', 'wallet-pending'],
        ['unknown', 'unknown', 'wallet-pending'],
        ['failed', 'failed', 'failed'],
    ] as const)('classifies wallet %s without claiming DEX success', async (walletState, state, terminal) => {
        const f = fixture();
        f.operation.progress = walletState === 'failed'
            ? ['preparing', 'signing', 'submitted']
            : ['preparing', 'signing', 'submitted', 'wallet-pending'];
        f.operation.value = result({
            state,
            walletConfirmationState: walletState,
            dexExitCode: null,
            txHash: walletState === 'failed' ? 'cd'.repeat(32) : null,
            receivedUnits: null,
            explorerUrl: null,
        });
        await f.service.execute(REQUEST, { onLifecycle: (event) => f.events.push(event) });
        expect(f.events.at(-1)?.stage).toBe(terminal);
        expect(f.events.some((event) => event.stage === 'wallet-confirmed')).toBe(false);
        expect(f.events.some((event) => event.stage === 'dex-pending')).toBe(false);
        expect(f.events.some((event) => event.stage === 'succeeded')).toBe(false);
    });

    it.each([
        ['pending', 'dex-pending'],
        ['unknown', 'unknown'],
    ] as const)('classifies DEX %s after wallet confirmation', async (state, terminal) => {
        const f = fixture();
        f.operation.value = result({
            state,
            walletConfirmationState: 'confirmed',
            dexExitCode: null,
            receivedUnits: null,
        });
        await f.service.execute(REQUEST, { onLifecycle: (event) => f.events.push(event) });
        expect(f.events.at(-1)?.stage).toBe(terminal);
        expect(f.events.some((event) => event.stage === 'wallet-confirmed')).toBe(true);
        expect(f.events.some((event) => event.stage === 'succeeded')).toBe(false);
    });

    it('emits cancelled and propagates cancellation before submission', async () => {
        const f = fixture();
        f.operation.progress = ['preparing'];
        f.operation.error = new WalletExecutionError(
            'CONFIRMATION_CANCELLED',
            'Cancelled before signing.',
        );
        await expect(f.service.execute(REQUEST, { onLifecycle: (event) => f.events.push(event) }))
            .rejects.toMatchObject({ code: 'CONFIRMATION_CANCELLED' });
        expect(f.events.map((event) => event.stage)).toEqual(['preparing', 'cancelled']);
        expect(f.events.at(-1)?.submissionId).toBeNull();
    });

    it('retains safe submission identity when cancellation occurs after submission', async () => {
        const f = fixture();
        const reference: SubmissionReference = Object.freeze({
            schemaVersion: 1,
            submissionId: 'submission_stage_d_1',
            network: 'mainnet',
            walletAddress: WALLET,
            walletVersion: 'v4r2',
            correlationId: 'stage_d_swap_1',
            submittedAtMs: NOW_MS,
            replayProtection: Object.freeze({ kind: 'seqno', seqno: 7 }),
            transportId: 'ef'.repeat(32),
        });
        f.operation.progress = ['preparing', 'signing', 'submitted'];
        f.operation.error = new WalletExecutionError(
            'CONFIRMATION_CANCELLED',
            'Cancelled after submission.',
            { submissionReference: reference },
        );
        await expect(f.service.execute(REQUEST, { onLifecycle: (event) => f.events.push(event) }))
            .rejects.toMatchObject({ code: 'CONFIRMATION_CANCELLED' });
        expect(f.events.at(-1)?.stage).toBe('cancelled');
        expect(f.events.at(-1)?.submissionId).toBe('submission_stage_d_1');
    });

    it('does not invent a terminal failure event for a pre-submission validation error', async () => {
        const f = fixture();
        f.operation.progress = [];
        f.operation.error = new WalletExecutionError('INVALID_WALLET_REQUEST', 'Invalid request.');
        await expect(f.service.execute(REQUEST, { onLifecycle: (event) => f.events.push(event) }))
            .rejects.toMatchObject({ code: 'INVALID_WALLET_REQUEST' });
        expect(f.events).toEqual([]);
    });

    it('preserves confirmation and outcome options', async () => {
        const f = fixture();
        const walletSignal = new AbortController().signal;
        const outcomeSignal = new AbortController().signal;
        await f.service.execute(REQUEST, {
            wallet: { confirmation: { timeoutMs: 5_000, pollIntervalMs: 10, signal: walletSignal } },
            outcome: { timeoutMs: 8_000, pollIntervalMs: 20, signal: outcomeSignal },
        });
        expect(f.operation.options?.wallet).toEqual({
            confirmation: { timeoutMs: 5_000, pollIntervalMs: 10, signal: walletSignal },
        });
        expect(f.operation.options?.outcome).toEqual({
            timeoutMs: 8_000,
            pollIntervalMs: 20,
            signal: outcomeSignal,
        });
    });

    it('ignores lifecycle observer failures and executes exactly once', async () => {
        const f = fixture();
        const value = await f.service.execute(REQUEST, {
            onLifecycle: () => { throw new Error('UI state update failed'); },
        });
        expect(value.state).toBe('succeeded');
        expect(f.operation.calls).toBe(1);
    });

    it('keeps every lifecycle event metadata-only', async () => {
        const f = fixture();
        await f.service.execute(REQUEST, { onLifecycle: (event) => f.events.push(event) });
        expect(Object.keys(f.events[0] ?? {}).join(' ')).not.toMatch(
            /password|mnemonic|seed|key|signer|signed|signature|boc|cell|payload|prepared|providerData|receivedUnits/i,
        );
        expect(JSON.stringify(f.events)).not.toMatch(
            /password|mnemonic|secretKey|signedBody|payload|queryId/i,
        );
    });
});
