import { describe, expect, it } from 'vitest';

import {
    StandardWalletTransactionConfirmer,
    WalletExecutionError,
} from '../../src/wallet';
import type {
    StandardWalletTransactionRecord,
    StandardWalletTransactionSource,
    SubmissionReference,
} from '../../src/wallet';

const WALLET_ADDRESS = 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c';
const MESSAGE_HASH = 'ab'.repeat(32);
const NOW_MS = 1_000_000_000;

class FakeSource implements StandardWalletTransactionSource {
    public readonly network = 'mainnet' as const;
    public records: readonly StandardWalletTransactionRecord[] = [];
    public seqno = 9;
    public historyError: unknown;
    public seqnoError: unknown;
    public historyCalls = 0;
    public seqnoCalls = 0;

    public async getRecentTransactions(): Promise<readonly StandardWalletTransactionRecord[]> {
        this.historyCalls += 1;
        if (this.historyError !== undefined) throw this.historyError;
        return this.records;
    }

    public async getSeqno(): Promise<number> {
        this.seqnoCalls += 1;
        if (this.seqnoError !== undefined) throw this.seqnoError;
        return this.seqno;
    }
}

function reference(overrides: Partial<SubmissionReference> = {}): SubmissionReference {
    return {
        schemaVersion: 1,
        submissionId: 'submission_001',
        network: 'mainnet',
        walletAddress: WALLET_ADDRESS,
        walletVersion: 'v4r2',
        correlationId: 'tx_001',
        submittedAtMs: NOW_MS,
        replayProtection: { kind: 'seqno', seqno: 9 },
        transportId: MESSAGE_HASH,
        ...overrides,
    };
}

function record(overrides: Partial<StandardWalletTransactionRecord> = {}): StandardWalletTransactionRecord {
    return {
        txHash: 'cd'.repeat(32),
        lt: 123n,
        nowUnix: Math.floor(NOW_MS / 1000),
        inboundExternalMessageHash: MESSAGE_HASH,
        aborted: false,
        exitCode: null,
        ...overrides,
    };
}

function confirmer(source: FakeSource, clock: () => number = () => NOW_MS) {
    return new StandardWalletTransactionConfirmer({
        source,
        clock,
        sleep: async () => undefined,
    });
}

async function expectCode(work: Promise<unknown>, code: string): Promise<WalletExecutionError> {
    try {
        await work;
        throw new Error('Expected confirmation to fail.');
    } catch (error) {
        expect(error).toBeInstanceOf(WalletExecutionError);
        expect((error as WalletExecutionError).code).toBe(code);
        return error as WalletExecutionError;
    }
}

describe('standard-wallet transaction confirmer', () => {
    it('confirms only the transaction with the exact normalized inbound message hash', async () => {
        const source = new FakeSource();
        source.records = [
            record({ txHash: '11'.repeat(32), inboundExternalMessageHash: 'ef'.repeat(32) }),
            record(),
        ];

        const result = await confirmer(source).confirm(reference());

        expect(result).toEqual({
            state: 'confirmed',
            reference: reference(),
            checkedAtMs: NOW_MS,
            txHash: 'cd'.repeat(32),
            exitCode: null,
        });
        expect(source.seqnoCalls).toBe(0);
    });

    it('reports an exactly correlated aborted wallet transaction as failed', async () => {
        const source = new FakeSource();
        source.records = [record({ aborted: true, exitCode: '33' })];

        const result = await confirmer(source).confirm(reference());

        expect(result.state).toBe('failed');
        expect(result.txHash).toBe('cd'.repeat(32));
        expect(result.exitCode).toBe('33');
    });

    it('returns pending for a non-blocking check with no exact transaction match', async () => {
        const source = new FakeSource();
        source.records = [record({ inboundExternalMessageHash: 'ef'.repeat(32) })];

        const result = await confirmer(source).confirm(reference(), { timeoutMs: 0 });

        expect(result.state).toBe('pending');
        expect(result.txHash).toBeNull();
        expect(source.seqnoCalls).toBe(0);
    });

    it('returns unknown when seqno advanced but the exact message is absent at timeout', async () => {
        const source = new FakeSource();
        source.seqno = 10;
        const times = [NOW_MS, NOW_MS, NOW_MS + 1_000, NOW_MS + 1_000];

        const result = await confirmer(source, () => times.shift() ?? NOW_MS + 1_000)
            .confirm(reference(), { timeoutMs: 1_000, pollIntervalMs: 1_000 });

        expect(result.state).toBe('unknown');
        expect(result.txHash).toBeNull();
        expect(source.seqnoCalls).toBe(1);
    });

    it('does not treat unchanged seqno as failure and raises a retryable timeout', async () => {
        const source = new FakeSource();
        source.seqno = 9;
        const times = [NOW_MS, NOW_MS, NOW_MS + 1_000];

        const error = await expectCode(
            confirmer(source, () => times.shift() ?? NOW_MS + 1_000)
                .confirm(reference(), { timeoutMs: 1_000, pollIntervalMs: 1_000 }),
            'CONFIRMATION_TIMEOUT',
        );

        expect(error.retryable).toBe(true);
    });

    it('fails closed when transaction history cannot be verified', async () => {
        const source = new FakeSource();
        source.historyError = new Error('rpc unavailable');

        const error = await expectCode(confirmer(source).confirm(reference()), 'CONFIRMATION_FAILED');

        expect(error.retryable).toBe(true);
    });

    it('fails closed when replay state cannot be checked after timeout', async () => {
        const source = new FakeSource();
        source.seqnoError = new Error('rpc unavailable');
        const times = [NOW_MS, NOW_MS + 1_000];

        const error = await expectCode(
            confirmer(source, () => times.shift() ?? NOW_MS + 1_000)
                .confirm(reference(), { timeoutMs: 1_000, pollIntervalMs: 1_000 }),
            'CONFIRMATION_TIMEOUT',
        );

        expect(error.retryable).toBe(true);
    });

    it('supports cancellation before the first chain read', async () => {
        const source = new FakeSource();
        const controller = new AbortController();
        controller.abort();

        await expectCode(
            confirmer(source).confirm(reference(), { signal: controller.signal }),
            'CONFIRMATION_CANCELLED',
        );
        expect(source.historyCalls).toBe(0);
    });

    it('rejects network mismatch before reading transaction history', async () => {
        const source = new FakeSource();

        await expectCode(
            confirmer(source).confirm(reference({ network: 'testnet' })),
            'WALLET_NETWORK_MISMATCH',
        );
        expect(source.historyCalls).toBe(0);
    });

    it('rejects references without an exact normalized message hash', async () => {
        const source = new FakeSource();

        await expectCode(
            confirmer(source).confirm(reference({ transportId: null })),
            'INVALID_WALLET_REQUEST',
        );
        await expectCode(
            confirmer(source).confirm(reference({ transportId: 'provider-request-id' })),
            'INVALID_WALLET_REQUEST',
        );
        expect(source.historyCalls).toBe(0);
    });

    it('rejects highload replay references from the standard-wallet boundary', async () => {
        const source = new FakeSource();

        await expectCode(
            confirmer(source).confirm(reference({
                walletVersion: 'highload-v3',
                replayProtection: { kind: 'highload-query', queryId: 1n, createdAtUnix: 1 },
            })),
            'UNSUPPORTED_WALLET',
        );
        expect(source.historyCalls).toBe(0);
    });
});
