import { addressKey, parseAddress } from '../core/address';
import type { NetworkId } from '../core/chain';
import {
    decodeSubmissionReference,
} from '../wallet';
import type {
    SubmissionReference,
    SynchronousKeyValueStorage,
} from '../wallet';

import { SwapError, SwapErrorCode } from './errors';
import type {
    DexProviderId,
    PendingSwapReference,
    PendingSwapReferenceStore,
    SwapReference,
} from './types';

const STORAGE_SCHEMA_VERSION = 1;
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const PROVIDER_ID = /^[a-z][a-z0-9-]{0,63}$/;
const UNSIGNED_DECIMAL = /^(?:0|[1-9][0-9]*)$/;
const MAX_QUERY_ID = (1n << 64n) - 1n;
const DEFAULT_MAX_PER_WALLET = 50;
const DEFAULT_MAX_TOTAL = 500;
const MAX_CONFIGURED_RECORDS = 10_000;

export interface BrowserPendingSwapReferenceStoreOptions {
    readonly storage: SynchronousKeyValueStorage;
    readonly keyPrefix?: string;
    readonly maxPerWallet?: number;
    readonly maxTotal?: number;
}

interface SerializedSeqnoReplayProtection {
    readonly kind: 'seqno';
    readonly seqno: number;
}

interface SerializedHighloadReplayProtection {
    readonly kind: 'highload-query';
    readonly queryId: string;
    readonly createdAtUnix: number;
}

type SerializedReplayProtection =
    | SerializedSeqnoReplayProtection
    | SerializedHighloadReplayProtection;

interface SerializedSubmissionReference {
    readonly schemaVersion: 1;
    readonly submissionId: string;
    readonly network: NetworkId;
    readonly walletAddress: string;
    readonly walletVersion: SubmissionReference['walletVersion'];
    readonly correlationId: string;
    readonly submittedAtMs: number;
    readonly replayProtection: SerializedReplayProtection;
    readonly transportId: string | null;
}

interface SerializedSwapReference {
    readonly providerId: DexProviderId;
    readonly routerAddress: string;
    readonly ownerAddress: string;
    readonly queryId: string;
    readonly deadlineUnix: number | null;
}

interface SerializedPendingSwapReference {
    readonly schemaVersion: 1;
    readonly network: NetworkId;
    readonly submission: SerializedSubmissionReference;
    readonly swap: SerializedSwapReference;
}

interface SerializedPendingSwapBucket {
    readonly schemaVersion: 1;
    readonly network: NetworkId;
    readonly records: readonly SerializedPendingSwapReference[];
}

/**
 * Strict, versioned persistence for the two secret-free references required to
 * resume a submitted swap after reload.
 */
export class BrowserPendingSwapReferenceStore implements PendingSwapReferenceStore {
    private readonly storage: SynchronousKeyValueStorage;
    private readonly keyPrefix: string;
    private readonly maxPerWallet: number;
    private readonly maxTotal: number;
    private mutationTail: Promise<void> = Promise.resolve();

    public constructor(options: BrowserPendingSwapReferenceStoreOptions) {
        this.storage = options.storage;
        this.keyPrefix = options.keyPrefix ?? 'ton-wallet:pending-swaps';
        this.maxPerWallet = options.maxPerWallet ?? DEFAULT_MAX_PER_WALLET;
        this.maxTotal = options.maxTotal ?? DEFAULT_MAX_TOTAL;

        assertSafePrefix(this.keyPrefix);
        assertRetentionLimit(this.maxPerWallet, 'per-wallet');
        assertRetentionLimit(this.maxTotal, 'total');
        if (this.maxTotal < this.maxPerWallet) {
            throw invalidRequest('Total pending-swap retention cannot be lower than per-wallet retention.');
        }
    }

    public async put(reference: PendingSwapReference): Promise<void> {
        const canonical = decodePendingSwapReference(
            serializePendingSwapReference(reference),
            reference.network,
        );

        await this.mutate(async () => {
            const records = this.readBucket(canonical.network);
            const existing = records.find(
                (item) => item.submission.submissionId === canonical.submission.submissionId,
            );
            if (existing !== undefined && !samePendingReference(existing, canonical)) {
                throw recoveryFailure(
                    'A pending swap already uses this wallet submission identifier with different correlation data.',
                );
            }

            const candidate = [
                ...records.filter(
                    (item) => item.submission.submissionId !== canonical.submission.submissionId,
                ),
                canonical,
            ].sort(compareNewestFirst);
            const walletCounts = new Map<string, number>();
            const retained: PendingSwapReference[] = [];

            for (const item of candidate) {
                const owner = addressKey(item.swap.ownerAddress);
                const count = walletCounts.get(owner) ?? 0;
                if (count >= this.maxPerWallet || retained.length >= this.maxTotal) continue;
                walletCounts.set(owner, count + 1);
                retained.push(item);
            }

            this.writeBucket(canonical.network, retained);
        });
    }

    public async get(
        network: NetworkId,
        submissionId: string,
    ): Promise<PendingSwapReference | null> {
        assertNetwork(network);
        assertSafeId(submissionId, 'submission identifier');
        await this.mutationTail;
        return this.readBucket(network).find(
            (item) => item.submission.submissionId === submissionId,
        ) ?? null;
    }

    public async list(
        network: NetworkId,
        ownerAddress: string,
    ): Promise<readonly PendingSwapReference[]> {
        assertNetwork(network);
        const owner = addressKey(ownerAddress);
        await this.mutationTail;
        return Object.freeze(
            this.readBucket(network)
                .filter((item) => addressKey(item.swap.ownerAddress) === owner)
                .sort(compareNewestFirst),
        );
    }

    public async remove(network: NetworkId, submissionId: string): Promise<void> {
        assertNetwork(network);
        assertSafeId(submissionId, 'submission identifier');
        await this.mutate(async () => {
            const records = this.readBucket(network);
            const retained = records.filter(
                (item) => item.submission.submissionId !== submissionId,
            );
            if (retained.length === records.length) return;
            if (retained.length === 0) {
                this.removeBucket(network);
                return;
            }
            this.writeBucket(network, retained);
        });
    }

    private async mutate(work: () => Promise<void>): Promise<void> {
        const operation = this.mutationTail.then(work, work);
        this.mutationTail = operation.then(() => undefined, () => undefined);
        await operation;
    }

    private readBucket(network: NetworkId): readonly PendingSwapReference[] {
        let raw: string | null;
        try {
            raw = this.storage.getItem(this.storageKey(network));
        } catch (cause) {
            throw recoveryFailure('Pending swap references could not be read.', cause, true);
        }
        if (raw === null) return Object.freeze([]);

        let parsed: unknown;
        try {
            parsed = JSON.parse(raw) as unknown;
        } catch (cause) {
            throw recoveryFailure('Stored pending swap references are not valid JSON.', cause);
        }
        return decodeBucket(parsed, network);
    }

    private writeBucket(network: NetworkId, records: readonly PendingSwapReference[]): void {
        const bucket: SerializedPendingSwapBucket = {
            schemaVersion: STORAGE_SCHEMA_VERSION,
            network,
            records: records.map(serializePendingSwapReference),
        };
        try {
            this.storage.setItem(this.storageKey(network), JSON.stringify(bucket));
        } catch (cause) {
            throw recoveryFailure('Pending swap references could not be persisted.', cause, true);
        }
    }

    private removeBucket(network: NetworkId): void {
        try {
            this.storage.removeItem(this.storageKey(network));
        } catch (cause) {
            throw recoveryFailure('Pending swap references could not be removed.', cause, true);
        }
    }

    private storageKey(network: NetworkId): string {
        return `${this.keyPrefix}:v${STORAGE_SCHEMA_VERSION}:${network}`;
    }
}

export function decodePendingSwapReference(
    value: unknown,
    expectedNetwork?: NetworkId,
): PendingSwapReference {
    const record = requireExactRecord(
        value,
        ['schemaVersion', 'network', 'submission', 'swap'],
        'pending swap reference',
    );
    if (record['schemaVersion'] !== STORAGE_SCHEMA_VERSION) {
        throw recoveryFailure('Stored pending swap schema version is unsupported.');
    }

    const network = requireNetwork(record['network']);
    if (expectedNetwork !== undefined && network !== expectedNetwork) {
        throw recoveryFailure('Stored pending swap belongs to a different network.');
    }

    let submission: SubmissionReference;
    try {
        submission = decodeSubmissionReference(record['submission'], network);
    } catch (cause) {
        throw recoveryFailure('Stored pending swap submission metadata is invalid.', cause);
    }
    const swap = decodeSwapReference(record['swap']);

    if (submission.network !== network) {
        throw recoveryFailure('Stored pending swap submission belongs to a different network.');
    }
    if (addressKey(submission.walletAddress) !== addressKey(swap.ownerAddress)) {
        throw recoveryFailure('Stored pending swap owner does not match the submitting wallet.');
    }

    return freezePendingReference({
        schemaVersion: STORAGE_SCHEMA_VERSION,
        network,
        submission,
        swap,
    });
}

function decodeBucket(
    value: unknown,
    expectedNetwork: NetworkId,
): readonly PendingSwapReference[] {
    const bucket = requireExactRecord(
        value,
        ['schemaVersion', 'network', 'records'],
        'pending swap bucket',
    );
    if (bucket['schemaVersion'] !== STORAGE_SCHEMA_VERSION) {
        throw recoveryFailure('Stored pending swap bucket schema version is unsupported.');
    }
    if (requireNetwork(bucket['network']) !== expectedNetwork) {
        throw recoveryFailure('Stored pending swap bucket belongs to a different network.');
    }
    const records = bucket['records'];
    if (!Array.isArray(records) || records.length > MAX_CONFIGURED_RECORDS) {
        throw recoveryFailure('Stored pending swap collection is invalid.');
    }

    const submissions = new Set<string>();
    const swapKeys = new Set<string>();
    const decoded = records.map((item) => {
        const reference = decodePendingSwapReference(item, expectedNetwork);
        const submissionId = reference.submission.submissionId;
        const swapKey = referenceKey(reference.swap);
        if (submissions.has(submissionId)) {
            throw recoveryFailure('Stored pending swap submission identifiers must be unique.');
        }
        if (swapKeys.has(swapKey)) {
            throw recoveryFailure('Stored pending swap query identifiers must be unique per router and owner.');
        }
        submissions.add(submissionId);
        swapKeys.add(swapKey);
        return reference;
    });
    return Object.freeze(decoded);
}

function decodeSwapReference(value: unknown): SwapReference {
    const record = requireExactRecord(
        value,
        ['providerId', 'routerAddress', 'ownerAddress', 'queryId', 'deadlineUnix'],
        'swap correlation reference',
    );
    const queryId = record['queryId'];
    if (typeof queryId !== 'string' || !UNSIGNED_DECIMAL.test(queryId)) {
        throw recoveryFailure('Stored DEX query identifier is invalid.');
    }
    const exactQueryId = BigInt(queryId);
    if (exactQueryId <= 0n || exactQueryId > MAX_QUERY_ID) {
        throw recoveryFailure('Stored DEX query identifier is outside the unsigned 64-bit range.');
    }

    return Object.freeze({
        providerId: requireProviderId(record['providerId']),
        routerAddress: requireCanonicalAddress(record['routerAddress'], 'router'),
        ownerAddress: requireCanonicalAddress(record['ownerAddress'], 'owner'),
        queryId: exactQueryId,
        deadlineUnix: requireDeadline(record['deadlineUnix']),
    });
}

function serializePendingSwapReference(
    reference: PendingSwapReference,
): SerializedPendingSwapReference {
    return {
        schemaVersion: reference.schemaVersion,
        network: reference.network,
        submission: serializeSubmissionReference(reference.submission),
        swap: {
            providerId: reference.swap.providerId,
            routerAddress: reference.swap.routerAddress,
            ownerAddress: reference.swap.ownerAddress,
            queryId: reference.swap.queryId.toString(10),
            deadlineUnix: reference.swap.deadlineUnix,
        },
    };
}

function serializeSubmissionReference(
    reference: SubmissionReference,
): SerializedSubmissionReference {
    const replayProtection: SerializedReplayProtection =
        reference.replayProtection.kind === 'seqno'
            ? {
                kind: 'seqno',
                seqno: reference.replayProtection.seqno,
            }
            : {
                kind: 'highload-query',
                queryId: reference.replayProtection.queryId.toString(10),
                createdAtUnix: reference.replayProtection.createdAtUnix,
            };

    return {
        schemaVersion: reference.schemaVersion,
        submissionId: reference.submissionId,
        network: reference.network,
        walletAddress: reference.walletAddress,
        walletVersion: reference.walletVersion,
        correlationId: reference.correlationId,
        submittedAtMs: reference.submittedAtMs,
        replayProtection,
        transportId: reference.transportId,
    };
}

function freezePendingReference(reference: PendingSwapReference): PendingSwapReference {
    return Object.freeze({
        ...reference,
        submission: Object.freeze({
            ...reference.submission,
            replayProtection: Object.freeze({ ...reference.submission.replayProtection }),
        }),
        swap: Object.freeze({ ...reference.swap }),
    });
}

function samePendingReference(left: PendingSwapReference, right: PendingSwapReference): boolean {
    return (
        left.network === right.network
        && left.submission.submissionId === right.submission.submissionId
        && left.submission.correlationId === right.submission.correlationId
        && left.submission.transportId === right.submission.transportId
        && left.swap.providerId === right.swap.providerId
        && addressKey(left.swap.routerAddress) === addressKey(right.swap.routerAddress)
        && addressKey(left.swap.ownerAddress) === addressKey(right.swap.ownerAddress)
        && left.swap.queryId === right.swap.queryId
        && left.swap.deadlineUnix === right.swap.deadlineUnix
    );
}

function referenceKey(reference: SwapReference): string {
    return [
        reference.providerId,
        addressKey(reference.routerAddress),
        addressKey(reference.ownerAddress),
        reference.queryId.toString(10),
    ].join(':');
}

function compareNewestFirst(left: PendingSwapReference, right: PendingSwapReference): number {
    return right.submission.submittedAtMs - left.submission.submittedAtMs
        || left.submission.submissionId.localeCompare(right.submission.submissionId);
}

function requireExactRecord(
    value: unknown,
    keys: readonly string[],
    label: string,
): Readonly<Record<string, unknown>> {
    if (!isRecord(value)) throw recoveryFailure(`Stored ${label} is invalid.`);
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
        throw recoveryFailure(`Stored ${label} contains missing or unknown fields.`);
    }
    return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireNetwork(value: unknown): NetworkId {
    if (value !== 'mainnet' && value !== 'testnet') {
        throw recoveryFailure('Stored TON network is invalid.');
    }
    return value;
}

function requireProviderId(value: unknown): DexProviderId {
    if (typeof value !== 'string' || !PROVIDER_ID.test(value)) {
        throw recoveryFailure('Stored DEX provider identifier is invalid.');
    }
    return value;
}

function requireCanonicalAddress(value: unknown, label: string): string {
    if (typeof value !== 'string') {
        throw recoveryFailure(`Stored ${label} address is invalid.`);
    }
    try {
        return parseAddress(value).toString();
    } catch (cause) {
        throw recoveryFailure(`Stored ${label} address is invalid.`, cause);
    }
}

function requireDeadline(value: unknown): number | null {
    if (value === null) return null;
    if (!Number.isSafeInteger(value) || typeof value !== 'number' || value <= 0) {
        throw recoveryFailure('Stored swap deadline is invalid.');
    }
    return value;
}

function assertNetwork(network: NetworkId): void {
    if (network !== 'mainnet' && network !== 'testnet') {
        throw invalidRequest('The TON network is invalid.');
    }
}

function assertSafeId(value: string, label: string): void {
    if (!SAFE_ID.test(value)) {
        throw invalidRequest(`The ${label} is invalid.`);
    }
}

function assertSafePrefix(prefix: string): void {
    if (!/^[A-Za-z0-9:_-]{1,128}$/.test(prefix)) {
        throw invalidRequest('The pending-swap storage key prefix is invalid.');
    }
}

function assertRetentionLimit(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 1 || value > MAX_CONFIGURED_RECORDS) {
        throw invalidRequest(`The ${label} pending-swap retention limit is invalid.`);
    }
}

function invalidRequest(message: string): SwapError {
    return new SwapError(SwapErrorCode.InvalidRequest, message, {
        severity: 'warning',
    });
}

function recoveryFailure(message: string, cause?: unknown, retryable = false): SwapError {
    return new SwapError(SwapErrorCode.RecoveryStoreFailed, message, {
        retryable,
        ...(cause === undefined ? {} : { cause }),
    });
}
