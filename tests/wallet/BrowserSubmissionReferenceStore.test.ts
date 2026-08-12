import { Address } from '@ton/core';
import { describe, expect, it } from 'vitest';

import {
    BrowserSubmissionReferenceStore,
    WalletExecutionError,
    decodeSubmissionReference,
} from '../../src/wallet';
import type {
    SubmissionReference,
    SynchronousKeyValueStorage,
} from '../../src/wallet';

const WALLET_A = 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c';
const WALLET_B = Address.parseRaw(`0:${'01'.repeat(32)}`).toString();
const HASH = 'ab'.repeat(32);

class MemoryStorage implements SynchronousKeyValueStorage {
    public readonly values = new Map<string, string>();
    public getError: unknown;
    public setError: unknown;
    public removeError: unknown;

    public getItem(key: string): string | null {
        if (this.getError !== undefined) throw this.getError;
        return this.values.get(key) ?? null;
    }

    public setItem(key: string, value: string): void {
        if (this.setError !== undefined) throw this.setError;
        this.values.set(key, value);
    }

    public removeItem(key: string): void {
        if (this.removeError !== undefined) throw this.removeError;
        this.values.delete(key);
    }
}

function standardReference(overrides: Partial<SubmissionReference> = {}): SubmissionReference {
    return {
        schemaVersion: 1,
        submissionId: 'submission_001',
        network: 'mainnet',
        walletAddress: WALLET_A,
        walletVersion: 'v4r2',
        correlationId: 'tx_001',
        submittedAtMs: 1_000,
        replayProtection: { kind: 'seqno', seqno: 9 },
        transportId: HASH,
        ...overrides,
    };
}

function store(storage: MemoryStorage, options: { maxPerWallet?: number; maxTotal?: number } = {}) {
    return new BrowserSubmissionReferenceStore({ storage, ...options });
}

async function expectCode(work: Promise<unknown>, code: string): Promise<WalletExecutionError> {
    try {
        await work;
        throw new Error('Expected reference-store operation to fail.');
    } catch (error) {
        expect(error).toBeInstanceOf(WalletExecutionError);
        expect((error as WalletExecutionError).code).toBe(code);
        return error as WalletExecutionError;
    }
}

describe('browser submission reference store', () => {
    it('round-trips immutable canonical standard-wallet references', async () => {
        const storage = new MemoryStorage();
        const references = store(storage);

        await references.put(standardReference());
        const loaded = await references.get('mainnet', 'submission_001');

        expect(loaded).toEqual({
            ...standardReference(),
            walletAddress: Address.parse(WALLET_A).toString(),
        });
        expect(Object.isFrozen(loaded)).toBe(true);
        expect(Object.isFrozen(loaded?.replayProtection)).toBe(true);
        expect(storage.values.size).toBe(1);
        expect([...storage.values.keys()][0]).toMatch(/:v1:mainnet$/);
        expect([...storage.values.values()][0]).not.toMatch(/signedBody|signature|boc|payload|mnemonic|password/i);
    });

    it('round-trips Highload query IDs as exact decimal bigint strings', async () => {
        const storage = new MemoryStorage();
        const references = store(storage);
        const queryId = (1n << 62n) + 123n;
        const highload = standardReference({
            submissionId: 'highload_001',
            walletVersion: 'highload-v3',
            replayProtection: { kind: 'highload-query', queryId, createdAtUnix: 777 },
            transportId: null,
        });

        await references.put(highload);
        const loaded = await references.get('mainnet', 'highload_001');

        expect(loaded?.replayProtection).toEqual({
            kind: 'highload-query',
            queryId,
            createdAtUnix: 777,
        });
        expect([...storage.values.values()][0]).toContain(`"queryId":"${queryId.toString()}"`);
    });

    it('isolates buckets by network and lists only the canonical target wallet', async () => {
        const storage = new MemoryStorage();
        const references = store(storage);
        await references.put(standardReference({ submissionId: 'main_a', submittedAtMs: 1_000 }));
        await references.put(standardReference({
            submissionId: 'main_b',
            walletAddress: WALLET_B,
            submittedAtMs: 2_000,
        }));
        await references.put(standardReference({
            submissionId: 'test_a',
            network: 'testnet',
            submittedAtMs: 3_000,
        }));

        await expect(references.list('mainnet', Address.parse(WALLET_A).toRawString()))
            .resolves.toEqual([{ ...standardReference({ submissionId: 'main_a' }), walletAddress: Address.parse(WALLET_A).toString() }]);
        await expect(references.get('testnet', 'main_a')).resolves.toBeNull();
        await expect(references.get('mainnet', 'test_a')).resolves.toBeNull();
        expect(storage.values.size).toBe(2);
    });

    it('replaces a duplicate submission ID and orders listings newest first', async () => {
        const storage = new MemoryStorage();
        const references = store(storage);
        await references.put(standardReference({ submissionId: 'one', submittedAtMs: 1_000 }));
        await references.put(standardReference({ submissionId: 'two', submittedAtMs: 2_000 }));
        await references.put(standardReference({
            submissionId: 'one',
            submittedAtMs: 3_000,
            correlationId: 'updated',
        }));

        const listed = await references.list('mainnet', WALLET_A);

        expect(listed.map((item) => item.submissionId)).toEqual(['one', 'two']);
        expect(listed[0]?.correlationId).toBe('updated');
    });

    it('enforces per-wallet and total retention bounds', async () => {
        const storage = new MemoryStorage();
        const references = store(storage, { maxPerWallet: 2, maxTotal: 3 });
        await references.put(standardReference({ submissionId: 'a1', submittedAtMs: 1_000 }));
        await references.put(standardReference({ submissionId: 'a2', submittedAtMs: 2_000 }));
        await references.put(standardReference({ submissionId: 'a3', submittedAtMs: 3_000 }));
        await references.put(standardReference({ submissionId: 'b1', walletAddress: WALLET_B, submittedAtMs: 4_000 }));
        await references.put(standardReference({ submissionId: 'b2', walletAddress: WALLET_B, submittedAtMs: 5_000 }));

        expect((await references.list('mainnet', WALLET_A)).map((item) => item.submissionId)).toEqual(['a3']);
        expect((await references.list('mainnet', WALLET_B)).map((item) => item.submissionId)).toEqual(['b2', 'b1']);
    });

    it('removes references and deletes an empty network bucket', async () => {
        const storage = new MemoryStorage();
        const references = store(storage);
        await references.put(standardReference());

        await references.remove('mainnet', 'submission_001');

        await expect(references.get('mainnet', 'submission_001')).resolves.toBeNull();
        expect(storage.values.size).toBe(0);
    });

    it('fails closed on invalid JSON, unknown fields, and cross-network bucket content', async () => {
        const storage = new MemoryStorage();
        const references = store(storage);
        const key = 'ton-wallet:submission-references:v1:mainnet';

        storage.values.set(key, '{invalid');
        await expectCode(references.list('mainnet', WALLET_A), 'REFERENCE_STORE_FAILED');

        storage.values.set(key, JSON.stringify({ schemaVersion: 1, network: 'mainnet', records: [], extra: true }));
        await expectCode(references.list('mainnet', WALLET_A), 'REFERENCE_STORE_FAILED');

        storage.values.set(key, JSON.stringify({ schemaVersion: 1, network: 'testnet', records: [] }));
        await expectCode(references.list('mainnet', WALLET_A), 'REFERENCE_STORE_FAILED');
    });

    it('rejects malformed, sensitive, and wallet/replay-incoherent decoded records', () => {
        const serialized = {
            ...standardReference(),
            replayProtection: { kind: 'seqno', seqno: 9 },
        };

        expect(() => decodeSubmissionReference({ ...serialized, signedBody: 'secret' })).toThrowError(WalletExecutionError);
        expect(() => decodeSubmissionReference({ ...serialized, transportId: 'provider-id' })).toThrowError(WalletExecutionError);
        expect(() => decodeSubmissionReference({
            ...serialized,
            walletVersion: 'highload-v3',
        })).toThrowError(WalletExecutionError);
    });

    it('fails closed and marks storage I/O failures retryable', async () => {
        const readStorage = new MemoryStorage();
        readStorage.getError = new Error('blocked');
        expect((await expectCode(store(readStorage).list('mainnet', WALLET_A), 'REFERENCE_STORE_FAILED')).retryable)
            .toBe(true);

        const writeStorage = new MemoryStorage();
        writeStorage.setError = new Error('quota');
        expect((await expectCode(store(writeStorage).put(standardReference()), 'REFERENCE_STORE_FAILED')).retryable)
            .toBe(true);

        const removeStorage = new MemoryStorage();
        const references = store(removeStorage);
        await references.put(standardReference());
        removeStorage.removeError = new Error('blocked');
        expect((await expectCode(references.remove('mainnet', 'submission_001'), 'REFERENCE_STORE_FAILED')).retryable)
            .toBe(true);
    });

    it('validates retention configuration before touching storage', () => {
        const storage = new MemoryStorage();

        expect(() => store(storage, { maxPerWallet: 0 })).toThrowError(WalletExecutionError);
        expect(() => store(storage, { maxPerWallet: 10, maxTotal: 5 })).toThrowError(WalletExecutionError);
    });
});
