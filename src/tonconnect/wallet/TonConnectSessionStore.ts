import type { NetworkId } from '../../core/chain';
import { TonConnectWalletError } from './errors';
import type {
    TonConnectStoredSession,
    TonConnectSynchronousStorage,
} from './types';

const HEX_32_BYTES = /^[0-9a-f]{64}$/u;
const DECIMAL_ID = /^(?:0|[1-9][0-9]*)$/u;

export interface TonConnectSessionStoreOptions {
    readonly storage: TonConnectSynchronousStorage;
    readonly keyPrefix?: string;
}

/** Versioned browser persistence for wallet-side session secrets only. */
export class TonConnectSessionStore {
    private readonly storage: TonConnectSynchronousStorage;
    private readonly keyPrefix: string;

    public constructor(options: TonConnectSessionStoreOptions) {
        this.storage = options.storage;
        this.keyPrefix = decodePrefix(options.keyPrefix ?? 'ton-wallet:tonconnect:sessions:v1');
    }

    public put(session: TonConnectStoredSession): void {
        const decoded = decodeStoredSession(session);
        try {
            this.storage.setItem(this.key(decoded.network, decoded.accountId, decoded.appClientId), JSON.stringify(decoded));
        } catch (cause) {
            throw storageFailure('The TON Connect session could not be persisted.', cause);
        }
    }

    public get(network: NetworkId, accountId: string, appClientId: string): TonConnectStoredSession | null {
        let raw: string | null;
        try {
            raw = this.storage.getItem(this.key(network, accountId, appClientId));
        } catch (cause) {
            throw storageFailure('The TON Connect session could not be read.', cause);
        }
        if (raw === null) return null;
        try {
            return decodeStoredSession(JSON.parse(raw) as unknown);
        } catch (cause) {
            if (cause instanceof TonConnectWalletError) throw cause;
            throw storageFailure('The stored TON Connect session is not valid JSON.', cause);
        }
    }

    public remove(network: NetworkId, accountId: string, appClientId: string): void {
        try {
            this.storage.removeItem(this.key(network, accountId, appClientId));
        } catch (cause) {
            throw storageFailure('The TON Connect session could not be removed.', cause);
        }
    }

    private key(network: NetworkId, accountId: string, appClientId: string): string {
        assertSafeKeyPart(accountId, 'account ID');
        if (!HEX_32_BYTES.test(appClientId)) {
            throw new TonConnectWalletError('INVALID_SESSION', 'The TON Connect application client ID is invalid.');
        }
        return `${this.keyPrefix}:${network}:${accountId}:${appClientId}`;
    }
}

export function decodeStoredSession(value: unknown): TonConnectStoredSession {
    const record = exactRecord(value, [
        'schemaVersion',
        'network',
        'accountId',
        'accountAddress',
        'appClientId',
        'walletClientId',
        'walletSecretKey',
        'walletDescriptor',
        'manifestUrl',
        'manifestOrigin',
        'bridgeUrl',
        'createdAtMs',
        'lastRequestId',
        'nextEventId',
    ]);
    if (record['schemaVersion'] !== 1) throw invalidSession('The TON Connect session schema version is unsupported.');
    const network = record['network'];
    if (network !== 'mainnet' && network !== 'testnet') throw invalidSession('The TON Connect session network is invalid.');
    const accountId = requiredString(record, 'accountId');
    const accountAddress = requiredString(record, 'accountAddress');
    const appClientId = requiredString(record, 'appClientId');
    const walletClientId = requiredString(record, 'walletClientId');
    const walletSecretKey = requiredString(record, 'walletSecretKey');
    const manifestUrl = requiredHttpsUrl(record, 'manifestUrl');
    const manifestOrigin = requiredHttpsOrigin(record, 'manifestOrigin');
    const bridgeUrl = requiredHttpsUrl(record, 'bridgeUrl');
    const createdAtMs = safeNonNegativeInteger(record, 'createdAtMs');
    const nextEventId = safeNonNegativeInteger(record, 'nextEventId');
    const lastRequestId = record['lastRequestId'];
    assertSafeKeyPart(accountId, 'account ID');
    if (accountAddress.length > 128) throw invalidSession('The TON Connect account address is invalid.');
    if (!HEX_32_BYTES.test(appClientId) || !HEX_32_BYTES.test(walletClientId) || !HEX_32_BYTES.test(walletSecretKey)) {
        throw invalidSession('The TON Connect session key material is invalid.');
    }
    if (lastRequestId !== null && (typeof lastRequestId !== 'string' || !DECIMAL_ID.test(lastRequestId))) {
        throw invalidSession('The TON Connect session request cursor is invalid.');
    }
    const walletDescriptor = record['walletDescriptor'] as any;
    if (!walletDescriptor || typeof walletDescriptor !== 'object' || typeof walletDescriptor.kind !== 'string') {
        throw invalidSession('The TON Connect wallet descriptor is invalid.');
    }
    return Object.freeze({
        schemaVersion: 1,
        network,
        accountId,
        accountAddress,
        appClientId,
        walletClientId,
        walletSecretKey,
        walletDescriptor,
        manifestUrl,
        manifestOrigin,
        bridgeUrl,
        createdAtMs,
        lastRequestId,
        nextEventId,
    });
}

function exactRecord(value: unknown, fields: readonly string[]): Readonly<Record<string, unknown>> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw invalidSession('The TON Connect session record is invalid.');
    }
    const record = value as Readonly<Record<string, unknown>>;
    const keys = Object.keys(record);
    if (keys.length !== fields.length || keys.some((key) => !fields.includes(key))) {
        throw invalidSession('The TON Connect session record has missing or unknown fields.');
    }
    return record;
}

function requiredString(record: Readonly<Record<string, unknown>>, key: string): string {
    const value = record[key];
    if (typeof value !== 'string' || value.length === 0) throw invalidSession('A TON Connect session string field is invalid.');
    return value;
}

function requiredHttpsUrl(record: Readonly<Record<string, unknown>>, key: string): string {
    const value = requiredString(record, key);
    let url: URL;
    try {
        url = new URL(value);
    } catch (cause) {
        throw new TonConnectWalletError('INVALID_SESSION', 'A TON Connect session URL is invalid.', {}, { cause });
    }
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
        throw invalidSession('A TON Connect session URL is invalid.');
    }
    return url.href;
}

function requiredHttpsOrigin(record: Readonly<Record<string, unknown>>, key: string): string {
    const value = requiredHttpsUrl(record, key);
    const url = new URL(value);
    if (url.href !== `${url.origin}/`) throw invalidSession('The TON Connect manifest origin is invalid.');
    return url.origin;
}

function safeNonNegativeInteger(record: Readonly<Record<string, unknown>>, key: string): number {
    const value = record[key];
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        throw invalidSession('A TON Connect session numeric field is invalid.');
    }
    return value;
}

function decodePrefix(value: string): string {
    if (value.length === 0 || value.length > 128 || /[\u0000-\u0020\u007f]/u.test(value)) {
        throw invalidSession('The TON Connect session storage prefix is invalid.');
    }
    return value;
}

function assertSafeKeyPart(value: string, label: string): void {
    if (value.length === 0 || value.length > 128 || !/^[A-Za-z0-9._-]+$/u.test(value)) {
        throw invalidSession(`The TON Connect ${label} is invalid.`);
    }
}

function invalidSession(message: string): TonConnectWalletError {
    return new TonConnectWalletError('INVALID_SESSION', message);
}

function storageFailure(message: string, cause: unknown): TonConnectWalletError {
    return new TonConnectWalletError('SESSION_STORAGE_FAILED', message, {}, { cause });
}
