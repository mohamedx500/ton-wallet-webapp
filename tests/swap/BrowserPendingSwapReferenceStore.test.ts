import { Address } from '@ton/core';
import { describe, expect, it } from 'vitest';

import {
    BrowserPendingSwapReferenceStore,
    SwapError,
    SwapErrorCode,
    decodePendingSwapReference,
} from '../../src/swap';
import type {
    BrowserPendingSwapReferenceStoreOptions,
    PendingSwapReference,
} from '../../src/swap';
import type {
    SubmissionReference,
    SynchronousKeyValueStorage,
} from '../../src/wallet';

const OWNER = 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c';
const OTHER_OWNER = Address.parseRaw(`0:${'01'.repeat(32)}`).toString();
const ROUTER = Address.parseRaw(`0:${'02'.repeat(32)}`).toString();
const HASH = 'ab'.repeat(32);
const QUERY_ID = (1n << 63n) + 123n;

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

function submission(overrides: Partial<SubmissionReference> = {}): SubmissionReference {
    return {
        schemaVersion: 1,
        submissionId: 'submission_001',
        network: 'mainnet',
        walletAddress: OWNER,
        walletVersion: 'v4r2',
        correlationId: 'swap_001',
        submittedAtMs: 1_000,
        replayProtection: { kind: 'seqno', seqno: 9 },
        transportId: HASH,
        ...overrides,
    };
}

function pending(overrides: {
    readonly submission?: Partial<SubmissionReference>;
    readonly swap?: Partial<PendingSwapReference['swap']>;
    readonly network?: PendingSwapReference['network'];
} = {}): PendingSwapReference {
    const network = overrides.network ?? 'mainnet';
    return {
        schemaVersion: 1,
        network,
        submission: submission({ network, ...overrides.submission }),
        swap: {
            providerId: 'stonfi',
            routerAddress: ROUTER,
            ownerAddress: OWNER,
            queryId: QUERY_ID,
            deadlineUnix: 2_000_000_000,
            ...overrides.swap,
        },
    };
}

function store(
    storage: MemoryStorage,
    options: Omit<BrowserPendingSwapReferenceStoreOptions, 'storage'> = {},
) {
    return new BrowserPendingSwapReferenceStore({ storage, ...options });
}

async function expectSwapCode(work: Promise<unknown>, code: string): Promise<SwapError> {
    try {
        await work;
        throw new Error('Expected pending swap store operation to fail.');
    } catch (error) {
        expect(error).toBeInstanceOf(SwapError);
        expect((error as SwapError).code).toBe(code);
        return error as SwapError;
    }
}

function serialized(reference = pending()): unknown {
    return JSON.parse(JSON.stringify(reference, (_key, value: unknown) => (
        typeof value === 'bigint' ? value.toString(10) : value
    ))) as unknown;
}

describe('browser pending swap reference store', () => {
    it('round-trips immutable canonical recovery metadata with exact DEX query ID', async () => {
        const storage = new MemoryStorage();
        const references = store(storage);

        await references.put(pending());
        const loaded = await references.get('mainnet', 'submission_001');

        expect(loaded).toEqual({
            ...pending(),
            submission: {
                ...pending().submission,
                walletAddress: Address.parse(OWNER).toString(),
            },
            swap: {
                ...pending().swap,
                routerAddress: Address.parse(ROUTER).toString(),
                ownerAddress: Address.parse(OWNER).toString(),
            },
        });
        expect(loaded?.swap.queryId).toBe(QUERY_ID);
        expect(Object.isFrozen(loaded)).toBe(true);
        expect(Object.isFrozen(loaded?.submission)).toBe(true);
        expect(Object.isFrozen(loaded?.submission.replayProtection)).toBe(true);
        expect(Object.isFrozen(loaded?.swap)).toBe(true);
        expect([...storage.values.keys()][0]).toMatch(/:v1:mainnet$/);
        expect([...storage.values.values()][0]).toContain(`"queryId":"${QUERY_ID.toString()}"`);
        expect([...storage.values.values()][0]).not.toMatch(
            /signedBody|signature|boc|payload|mnemonic|password|providerData|quote/i,
        );
    });

    it('isolates network buckets and lists only the canonical owner wallet', async () => {
        const storage = new MemoryStorage();
        const references = store(storage);
        await references.put(pending());
        await references.put(pending({
            network: 'testnet',
            submission: { submissionId: 'test_001', submittedAtMs: 2_000 },
        }));
        await references.put(pending({
            submission: {
                submissionId: 'other_001',
                walletAddress: OTHER_OWNER,
                submittedAtMs: 3_000,
            },
            swap: { ownerAddress: OTHER_OWNER, queryId: QUERY_ID + 1n },
        }));

        await expect(references.list('mainnet', Address.parse(OWNER).toRawString()))
            .resolves.toHaveLength(1);
        await expect(references.get('testnet', 'submission_001')).resolves.toBeNull();
        expect(storage.values.size).toBe(2);
    });

    it('supports secret-free Highload submission replay metadata', async () => {
        const storage = new MemoryStorage();
        const references = store(storage);
        const walletQueryId = (1n << 62n) + 77n;
        await references.put(pending({
            submission: {
                walletVersion: 'highload-v3',
                replayProtection: {
                    kind: 'highload-query',
                    queryId: walletQueryId,
                    createdAtUnix: 777,
                },
            },
        }));

        const loaded = await references.get('mainnet', 'submission_001');
        expect(loaded?.submission.replayProtection).toEqual({
            kind: 'highload-query',
            queryId: walletQueryId,
            createdAtUnix: 777,
        });
        expect(loaded?.swap.queryId).toBe(QUERY_ID);
    });

    it('rejects owner, network, and submission coherence mismatches', () => {
        const ownerMismatch = serialized(pending({ swap: { ownerAddress: OTHER_OWNER } }));
        const networkMismatch = serialized(pending({ network: 'testnet' }));
        const record = networkMismatch as Record<string, unknown>;
        record['network'] = 'mainnet';

        expect(() => decodePendingSwapReference(ownerMismatch)).toThrowError(SwapError);
        expect(() => decodePendingSwapReference(networkMismatch)).toThrowError(SwapError);
        expect(() => decodePendingSwapReference(serialized(), 'testnet')).toThrowError(SwapError);
    });

    it('rejects unknown sensitive fields and malformed DEX correlation values', () => {
        const withPayload = serialized() as Record<string, unknown>;
        withPayload['payload'] = 'secret';
        expect(() => decodePendingSwapReference(withPayload)).toThrowError(SwapError);

        const invalidQuery = serialized() as { swap: Record<string, unknown> };
        invalidQuery.swap['queryId'] = '-1';
        expect(() => decodePendingSwapReference(invalidQuery)).toThrowError(SwapError);

        const zeroQuery = serialized() as { swap: Record<string, unknown> };
        zeroQuery.swap['queryId'] = '0';
        expect(() => decodePendingSwapReference(zeroQuery)).toThrowError(SwapError);

        const oversizedQuery = serialized() as { swap: Record<string, unknown> };
        oversizedQuery.swap['queryId'] = (1n << 64n).toString();
        expect(() => decodePendingSwapReference(oversizedQuery)).toThrowError(SwapError);

        const invalidProvider = serialized() as { swap: Record<string, unknown> };
        invalidProvider.swap['providerId'] = 'STON.fi';
        expect(() => decodePendingSwapReference(invalidProvider)).toThrowError(SwapError);
    });

    it('does not overwrite an existing submission with different swap correlation', async () => {
        const storage = new MemoryStorage();
        const references = store(storage);
        await references.put(pending());

        await expectSwapCode(
            references.put(pending({ swap: { queryId: QUERY_ID + 1n } })),
            SwapErrorCode.RecoveryStoreFailed,
        );
        expect((await references.get('mainnet', 'submission_001'))?.swap.queryId).toBe(QUERY_ID);
    });

    it('fails closed on duplicate submissions and duplicate DEX references in storage', async () => {
        const storage = new MemoryStorage();
        const references = store(storage);
        const key = 'ton-wallet:pending-swaps:v1:mainnet';
        const record = serialized();

        storage.values.set(key, JSON.stringify({
            schemaVersion: 1,
            network: 'mainnet',
            records: [record, record],
        }));
        await expectSwapCode(references.list('mainnet', OWNER), SwapErrorCode.RecoveryStoreFailed);

        const sameSwap = serialized(pending({
            submission: { submissionId: 'submission_002' },
        }));
        storage.values.set(key, JSON.stringify({
            schemaVersion: 1,
            network: 'mainnet',
            records: [record, sameSwap],
        }));
        await expectSwapCode(references.list('mainnet', OWNER), SwapErrorCode.RecoveryStoreFailed);
    });

    it('enforces bounded per-wallet and total retention newest first', async () => {
        const storage = new MemoryStorage();
        const references = store(storage, { maxPerWallet: 2, maxTotal: 3 });
        await references.put(pending({
            submission: { submissionId: 'a1', submittedAtMs: 1_000 },
            swap: { queryId: 1n },
        }));
        await references.put(pending({
            submission: { submissionId: 'a2', submittedAtMs: 2_000 },
            swap: { queryId: 2n },
        }));
        await references.put(pending({
            submission: { submissionId: 'a3', submittedAtMs: 3_000 },
            swap: { queryId: 3n },
        }));
        await references.put(pending({
            submission: {
                submissionId: 'b1',
                walletAddress: OTHER_OWNER,
                submittedAtMs: 4_000,
            },
            swap: { ownerAddress: OTHER_OWNER, queryId: 4n },
        }));

        expect((await references.list('mainnet', OWNER)).map(
            (item) => item.submission.submissionId,
        )).toEqual(['a3', 'a2']);
        expect((await references.list('mainnet', OTHER_OWNER)).map(
            (item) => item.submission.submissionId,
        )).toEqual(['b1']);
    });

    it('removes a reference and deletes the empty network bucket', async () => {
        const storage = new MemoryStorage();
        const references = store(storage);
        await references.put(pending());

        await references.remove('mainnet', 'submission_001');

        await expect(references.get('mainnet', 'submission_001')).resolves.toBeNull();
        expect(storage.values.size).toBe(0);
    });

    it('fails closed on malformed buckets and marks storage I/O errors retryable', async () => {
        const malformedStorage = new MemoryStorage();
        malformedStorage.values.set('ton-wallet:pending-swaps:v1:mainnet', '{invalid');
        await expectSwapCode(
            store(malformedStorage).list('mainnet', OWNER),
            SwapErrorCode.RecoveryStoreFailed,
        );

        const readStorage = new MemoryStorage();
        readStorage.getError = new Error('blocked');
        expect((await expectSwapCode(
            store(readStorage).list('mainnet', OWNER),
            SwapErrorCode.RecoveryStoreFailed,
        )).retryable).toBe(true);

        const writeStorage = new MemoryStorage();
        writeStorage.setError = new Error('quota');
        expect((await expectSwapCode(
            store(writeStorage).put(pending()),
            SwapErrorCode.RecoveryStoreFailed,
        )).retryable).toBe(true);
    });

    it('validates retention and key configuration before storage access', () => {
        const storage = new MemoryStorage();
        expect(() => store(storage, { maxPerWallet: 0 })).toThrowError(SwapError);
        expect(() => store(storage, { maxPerWallet: 10, maxTotal: 5 })).toThrowError(SwapError);
        expect(() => store(storage, { keyPrefix: 'unsafe prefix' })).toThrowError(SwapError);
    });
});
