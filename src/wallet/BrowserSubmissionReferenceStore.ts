import { addressKey, parseAddress } from '../core/address';
import type { NetworkId } from '../core/chain';
import { WalletExecutionError } from './errors';
import { isNormalizedExternalMessageHash } from './externalMessageHash';
import type {
    ReplayProtection,
    SubmissionReference,
    SubmissionReferenceStore,
    WalletContractVersion,
} from './types';

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const UNSIGNED_DECIMAL = /^(?:0|[1-9][0-9]*)$/;
const STORAGE_SCHEMA_VERSION = 1;
const DEFAULT_MAX_PER_WALLET = 50;
const DEFAULT_MAX_TOTAL = 500;
const MAX_CONFIGURED_RECORDS = 10_000;
const STANDARD_VERSIONS = new Set<WalletContractVersion>(['v3r1', 'v3r2', 'v4r2', 'v5r1']);
const ALL_VERSIONS = new Set<WalletContractVersion>([...STANDARD_VERSIONS, 'highload-v3']);

export interface SynchronousKeyValueStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

export interface BrowserSubmissionReferenceStoreOptions {
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

type SerializedReplayProtection = SerializedSeqnoReplayProtection | SerializedHighloadReplayProtection;

interface SerializedSubmissionReference {
    readonly schemaVersion: 1;
    readonly submissionId: string;
    readonly network: NetworkId;
    readonly walletAddress: string;
    readonly walletVersion: WalletContractVersion;
    readonly correlationId: string;
    readonly submittedAtMs: number;
    readonly replayProtection: SerializedReplayProtection;
    readonly transportId: string | null;
}

interface SerializedReferenceBucket {
    readonly schemaVersion: 1;
    readonly network: NetworkId;
    readonly records: readonly SerializedSubmissionReference[];
}

/**
 * Versioned, network-scoped persistence for secret-free submission references.
 *
 * Every read is decoded from untrusted storage. Unknown keys, malformed fields,
 * cross-network records, and wallet/replay-version mismatches fail closed. All
 * mutations are serialized within this store instance to avoid lost updates.
 */
export class BrowserSubmissionReferenceStore implements SubmissionReferenceStore {
    private readonly storage: SynchronousKeyValueStorage;
    private readonly keyPrefix: string;
    private readonly maxPerWallet: number;
    private readonly maxTotal: number;
    private mutationTail: Promise<void> = Promise.resolve();

    public constructor(options: BrowserSubmissionReferenceStoreOptions) {
        this.storage = options.storage;
        this.keyPrefix = options.keyPrefix ?? 'ton-wallet:submission-references';
        this.maxPerWallet = options.maxPerWallet ?? DEFAULT_MAX_PER_WALLET;
        this.maxTotal = options.maxTotal ?? DEFAULT_MAX_TOTAL;

        assertSafePrefix(this.keyPrefix);
        assertRetentionLimit(this.maxPerWallet, 'per-wallet');
        assertRetentionLimit(this.maxTotal, 'total');
        if (this.maxTotal < this.maxPerWallet) {
            throw new WalletExecutionError(
                'INVALID_WALLET_REQUEST',
                'Total submission retention cannot be lower than per-wallet retention.',
            );
        }
    }

    public async put(reference: SubmissionReference): Promise<void> {
        const canonical = decodeSubmissionReference(serializeSubmissionReference(reference), reference.network);
        await this.mutate(async () => {
            const records = this.readBucket(canonical.network);
            const withoutDuplicate = records.filter((item) => item.submissionId !== canonical.submissionId);
            const candidate = [...withoutDuplicate, canonical].sort(compareNewestFirst);
            const walletCounts = new Map<string, number>();
            const retained: SubmissionReference[] = [];

            for (const item of candidate) {
                const wallet = addressKey(item.walletAddress);
                const count = walletCounts.get(wallet) ?? 0;
                if (count >= this.maxPerWallet || retained.length >= this.maxTotal) continue;
                walletCounts.set(wallet, count + 1);
                retained.push(item);
            }

            this.writeBucket(canonical.network, retained);
        });
    }

    public async get(network: NetworkId, submissionId: string): Promise<SubmissionReference | null> {
        assertNetwork(network);
        assertSafeId(submissionId, 'submission identifier');
        await this.mutationTail;
        const found = this.readBucket(network).find((reference) => reference.submissionId === submissionId);
        return found ?? null;
    }

    public async list(network: NetworkId, walletAddress: string): Promise<readonly SubmissionReference[]> {
        assertNetwork(network);
        const wallet = addressKey(walletAddress);
        await this.mutationTail;
        return Object.freeze(
            this.readBucket(network)
                .filter((reference) => addressKey(reference.walletAddress) === wallet)
                .sort(compareNewestFirst),
        );
    }

    public async remove(network: NetworkId, submissionId: string): Promise<void> {
        assertNetwork(network);
        assertSafeId(submissionId, 'submission identifier');
        await this.mutate(async () => {
            const records = this.readBucket(network);
            const retained = records.filter((reference) => reference.submissionId !== submissionId);
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

    private readBucket(network: NetworkId): readonly SubmissionReference[] {
        let raw: string | null;
        try {
            raw = this.storage.getItem(this.storageKey(network));
        } catch (cause) {
            throw storageFailure('Submission references could not be read.', cause);
        }
        if (raw === null) return Object.freeze([]);

        let parsed: unknown;
        try {
            parsed = JSON.parse(raw) as unknown;
        } catch (cause) {
            throw storageFailure('Stored submission references are not valid JSON.', cause);
        }

        return decodeBucket(parsed, network);
    }

    private writeBucket(network: NetworkId, records: readonly SubmissionReference[]): void {
        const bucket: SerializedReferenceBucket = {
            schemaVersion: STORAGE_SCHEMA_VERSION,
            network,
            records: records.map(serializeSubmissionReference),
        };
        try {
            this.storage.setItem(this.storageKey(network), JSON.stringify(bucket));
        } catch (cause) {
            throw storageFailure('Submission references could not be persisted.', cause);
        }
    }

    private removeBucket(network: NetworkId): void {
        try {
            this.storage.removeItem(this.storageKey(network));
        } catch (cause) {
            throw storageFailure('Stored submission references could not be removed.', cause);
        }
    }

    private storageKey(network: NetworkId): string {
        return `${this.keyPrefix}:v${STORAGE_SCHEMA_VERSION}:${network}`;
    }
}

export function decodeSubmissionReference(value: unknown, expectedNetwork?: NetworkId): SubmissionReference {
    const record = requireExactRecord(value, [
        'schemaVersion',
        'submissionId',
        'network',
        'walletAddress',
        'walletVersion',
        'correlationId',
        'submittedAtMs',
        'replayProtection',
        'transportId',
    ], 'submission reference');

    if (record['schemaVersion'] !== STORAGE_SCHEMA_VERSION) invalidStoredReference('Unsupported reference schema version.');
    const network = requireNetwork(record['network']);
    if (expectedNetwork !== undefined && network !== expectedNetwork) {
        invalidStoredReference('Stored submission reference belongs to a different network.');
    }
    const submissionId = requireSafeId(record['submissionId'], 'submission identifier');
    const walletAddress = requireCanonicalAddress(record['walletAddress']);
    const walletVersion = requireWalletVersion(record['walletVersion']);
    const correlationId = requireSafeId(record['correlationId'], 'correlation identifier');
    const submittedAtMs = requireSafeUnsignedInteger(record['submittedAtMs'], 'submission timestamp');
    const replayProtection = decodeReplayProtection(record['replayProtection']);
    const transportId = requireTransportId(record['transportId']);
    assertReplayMatchesWallet(walletVersion, replayProtection);

    return freezeReference({
        schemaVersion: STORAGE_SCHEMA_VERSION,
        submissionId,
        network,
        walletAddress,
        walletVersion,
        correlationId,
        submittedAtMs,
        replayProtection,
        transportId,
    });
}

function decodeBucket(value: unknown, expectedNetwork: NetworkId): readonly SubmissionReference[] {
    const bucket = requireExactRecord(value, ['schemaVersion', 'network', 'records'], 'reference bucket');
    if (bucket['schemaVersion'] !== STORAGE_SCHEMA_VERSION) invalidStoredReference('Unsupported bucket schema version.');
    if (requireNetwork(bucket['network']) !== expectedNetwork) {
        invalidStoredReference('Stored reference bucket belongs to a different network.');
    }
    const records = bucket['records'];
    if (!Array.isArray(records) || records.length > MAX_CONFIGURED_RECORDS) {
        invalidStoredReference('Stored submission reference collection is invalid.');
    }

    const seen = new Set<string>();
    const decoded = records.map((item) => {
        const reference = decodeSubmissionReference(item, expectedNetwork);
        if (seen.has(reference.submissionId)) invalidStoredReference('Stored submission identifiers must be unique.');
        seen.add(reference.submissionId);
        return reference;
    });
    return Object.freeze(decoded);
}

function serializeSubmissionReference(reference: SubmissionReference): SerializedSubmissionReference {
    const replayProtection: SerializedReplayProtection = reference.replayProtection.kind === 'seqno'
        ? { kind: 'seqno', seqno: reference.replayProtection.seqno }
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

function decodeReplayProtection(value: unknown): ReplayProtection {
    if (!isRecord(value) || typeof value['kind'] !== 'string') {
        invalidStoredReference('Stored replay protection is invalid.');
    }
    if (value['kind'] === 'seqno') {
        const replay = requireExactRecord(value, ['kind', 'seqno'], 'seqno replay protection');
        return Object.freeze({
            kind: 'seqno',
            seqno: requireUint32(replay['seqno'], 'wallet seqno'),
        });
    }
    if (value['kind'] === 'highload-query') {
        const replay = requireExactRecord(value, ['kind', 'queryId', 'createdAtUnix'], 'Highload replay protection');
        const queryId = replay['queryId'];
        if (typeof queryId !== 'string' || !UNSIGNED_DECIMAL.test(queryId)) {
            invalidStoredReference('Stored Highload query identifier is invalid.');
        }
        return Object.freeze({
            kind: 'highload-query',
            queryId: BigInt(queryId),
            createdAtUnix: requireSafeUnsignedInteger(replay['createdAtUnix'], 'Highload creation timestamp'),
        });
    }
    return invalidStoredReference('Stored replay-protection type is unsupported.');
}

function freezeReference(reference: SubmissionReference): SubmissionReference {
    return Object.freeze({
        ...reference,
        replayProtection: Object.freeze({ ...reference.replayProtection }),
    });
}

function compareNewestFirst(left: SubmissionReference, right: SubmissionReference): number {
    return right.submittedAtMs - left.submittedAtMs || left.submissionId.localeCompare(right.submissionId);
}

function assertReplayMatchesWallet(version: WalletContractVersion, replay: ReplayProtection): void {
    if (version === 'highload-v3' && replay.kind !== 'highload-query') {
        invalidStoredReference('Highload wallet references require Highload replay protection.');
    }
    if (STANDARD_VERSIONS.has(version) && replay.kind !== 'seqno') {
        invalidStoredReference('Standard wallet references require seqno replay protection.');
    }
}

function requireExactRecord(value: unknown, keys: readonly string[], label: string): Readonly<Record<string, unknown>> {
    if (!isRecord(value)) invalidStoredReference(`Stored ${label} is invalid.`);
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
        invalidStoredReference(`Stored ${label} contains missing or unknown fields.`);
    }
    return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireNetwork(value: unknown): NetworkId {
    if (value !== 'mainnet' && value !== 'testnet') invalidStoredReference('Stored TON network is invalid.');
    return value;
}

function requireWalletVersion(value: unknown): WalletContractVersion {
    if (typeof value !== 'string' || !ALL_VERSIONS.has(value as WalletContractVersion)) {
        invalidStoredReference('Stored wallet version is unsupported.');
    }
    return value as WalletContractVersion;
}

function requireSafeId(value: unknown, label: string): string {
    if (typeof value !== 'string' || !SAFE_ID.test(value)) invalidStoredReference(`Stored ${label} is invalid.`);
    return value;
}

function requireCanonicalAddress(value: unknown): string {
    if (typeof value !== 'string') invalidStoredReference('Stored wallet address is invalid.');
    return parseAddress(value).toString();
}

function requireSafeUnsignedInteger(value: unknown, label: string): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        invalidStoredReference(`Stored ${label} is invalid.`);
    }
    return value;
}

function requireUint32(value: unknown, label: string): number {
    const parsed = requireSafeUnsignedInteger(value, label);
    if (parsed > 0xffff_ffff) invalidStoredReference(`Stored ${label} is invalid.`);
    return parsed;
}

function requireTransportId(value: unknown): string | null {
    if (value === null) return null;
    if (typeof value !== 'string' || !isNormalizedExternalMessageHash(value)) {
        invalidStoredReference('Stored external-message correlation hash is invalid.');
    }
    return value;
}

function assertNetwork(network: NetworkId): void {
    if (network !== 'mainnet' && network !== 'testnet') {
        throw new WalletExecutionError('INVALID_WALLET_REQUEST', 'The TON network is invalid.');
    }
}

function assertSafeId(value: string, label: string): void {
    if (!SAFE_ID.test(value)) {
        throw new WalletExecutionError('INVALID_WALLET_REQUEST', `The ${label} is invalid.`);
    }
}

function assertSafePrefix(prefix: string): void {
    if (!/^[A-Za-z0-9:_-]{1,128}$/.test(prefix)) {
        throw new WalletExecutionError('INVALID_WALLET_REQUEST', 'The submission storage key prefix is invalid.');
    }
}

function assertRetentionLimit(value: number, label: string): void {
    if (!Number.isSafeInteger(value) || value < 1 || value > MAX_CONFIGURED_RECORDS) {
        throw new WalletExecutionError('INVALID_WALLET_REQUEST', `The ${label} submission retention limit is invalid.`);
    }
}

function invalidStoredReference(message: string): never {
    throw new WalletExecutionError('REFERENCE_STORE_FAILED', message);
}

function storageFailure(message: string, cause: unknown): WalletExecutionError {
    return new WalletExecutionError('REFERENCE_STORE_FAILED', message, { retryable: true, cause });
}
