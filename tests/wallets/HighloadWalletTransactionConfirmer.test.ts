import { describe, expect, it, vi } from 'vitest';
import type { TonClient } from '@ton/ton';

import {
    HighloadWalletTransactionConfirmer,
} from '../../src/wallets/highload-v3/HighloadWalletTransactionConfirmer';
import {
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
    public historyError: unknown;
    public historyCalls = 0;

    public async getRecentTransactions(): Promise<readonly StandardWalletTransactionRecord[]> {
        this.historyCalls += 1;
        if (this.historyError !== undefined) throw this.historyError;
        return this.records;
    }

    public async getSeqno(): Promise<number> {
        return 0;
    }
}

function reference(overrides: Partial<SubmissionReference> = {}): SubmissionReference {
    return {
        schemaVersion: 1,
        submissionId: 'submission_hl_001',
        network: 'mainnet',
        walletAddress: WALLET_ADDRESS,
        walletVersion: 'highload-v3',
        correlationId: 'tx_hl_001',
        submittedAtMs: NOW_MS,
        replayProtection: { kind: 'highload-query', queryId: 42n, createdAtUnix: 1_700_000_000 },
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

function confirmer(
    source: FakeSource,
    processed = false,
    clock: () => number = () => NOW_MS,
) {
    const wallet = {
        getProcessed: vi.fn(async () => processed),
    };
    const client = {
        open: vi.fn(() => wallet),
    } as unknown as Pick<TonClient, 'open'>;
    return {
        confirmer: new HighloadWalletTransactionConfirmer({
            source,
            client,
            clock,
            sleep: async () => undefined,
        }),
        wallet,
        client,
    };
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

describe('highload-wallet transaction confirmer', () => {
    it('confirms only the transaction with the exact normalized inbound message hash', async () => {
        const source = new FakeSource();
        source.records = [
            record({ txHash: '11'.repeat(32), inboundExternalMessageHash: 'ef'.repeat(32) }),
            record(),
        ];
        const { confirmer: hlConfirmer, client } = confirmer(source);

        const result = await hlConfirmer.confirm(reference());

        expect(result).toEqual({
            state: 'confirmed',
            reference: reference(),
            checkedAtMs: NOW_MS,
            txHash: 'cd'.repeat(32),
            exitCode: null,
        });
        expect(client.open).not.toHaveBeenCalled();
    });

    it('rejects standard-wallet seqno references from the highload boundary', async () => {
        const source = new FakeSource();
        const { confirmer: hlConfirmer } = confirmer(source);

        await expectCode(
            hlConfirmer.confirm(reference({
                walletVersion: 'v4r2',
                replayProtection: { kind: 'seqno', seqno: 9 },
            })),
            'UNSUPPORTED_WALLET',
        );
        expect(source.historyCalls).toBe(0);
    });

    it('returns unknown when the query id was processed but the exact message is absent at timeout', async () => {
        const source = new FakeSource();
        const times = [NOW_MS, NOW_MS, NOW_MS + 1_000, NOW_MS + 1_000];
        const { confirmer: hlConfirmer, wallet } = confirmer(source, true, () => times.shift() ?? NOW_MS + 1_000);

        const result = await hlConfirmer.confirm(reference(), { timeoutMs: 1_000, pollIntervalMs: 1_000 });

        expect(result.state).toBe('unknown');
        expect(result.txHash).toBeNull();
        expect(wallet.getProcessed).toHaveBeenCalledOnce();
    });

    it('raises a retryable timeout when the query id was not processed', async () => {
        const source = new FakeSource();
        const times = [NOW_MS, NOW_MS, NOW_MS + 1_000];
        const { confirmer: hlConfirmer } = confirmer(source, false, () => times.shift() ?? NOW_MS + 1_000);

        const error = await expectCode(
            hlConfirmer.confirm(reference(), { timeoutMs: 1_000, pollIntervalMs: 1_000 }),
            'CONFIRMATION_TIMEOUT',
        );

        expect(error.retryable).toBe(true);
    });
});
