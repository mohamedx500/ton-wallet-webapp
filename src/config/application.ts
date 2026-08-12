import type { NetworkId } from '../core/chain';

const DEFAULT_RPC_TIMEOUT_MS = 30_000;
const MIN_RPC_TIMEOUT_MS = 1_000;
const MAX_RPC_TIMEOUT_MS = 120_000;
const DECIMAL_INTEGER = /^(?:0|[1-9][0-9]*)$/;

const TONCENTER_ENDPOINTS: Readonly<Record<NetworkId, string>> = Object.freeze({
    mainnet: 'https://toncenter.com/api/v2/jsonRPC',
    testnet: 'https://testnet.toncenter.com/api/v2/jsonRPC',
});

/** Environment values accepted by the inactive typed application configuration boundary. */
export interface ApplicationEnvironment {
    readonly VITE_TON_NETWORK?: unknown;
    readonly VITE_TONCENTER_API_KEY?: unknown;
    readonly VITE_TON_RPC_TIMEOUT_MS?: unknown;
}

export interface ApplicationRpcConfig {
    readonly provider: 'toncenter';
    readonly endpoint: string;
    readonly apiKey?: string;
    readonly timeoutMs: number;
}

/** Immutable application configuration from which every TON dependency will be composed. */
export interface ApplicationConfig {
    readonly network: NetworkId;
    readonly rpc: ApplicationRpcConfig;
}

export type ApplicationConfigErrorCode =
    | 'APPLICATION_NETWORK_REQUIRED'
    | 'APPLICATION_NETWORK_INVALID'
    | 'APPLICATION_API_KEY_INVALID'
    | 'APPLICATION_RPC_TIMEOUT_INVALID';

/** Stable configuration error that never includes credentials or raw environment values. */
export class ApplicationConfigError extends Error {
    public readonly code: ApplicationConfigErrorCode;

    public constructor(code: ApplicationConfigErrorCode, message: string) {
        super(message);
        this.name = 'ApplicationConfigError';
        this.code = code;
    }
}

/**
 * Decode explicit TON configuration without reading browser globals or activating runtime code.
 *
 * The network is mandatory and authoritative. The RPC endpoint is selected from a fixed,
 * network-indexed table, so no endpoint text, address, account record, connectivity state, or
 * legacy boolean is ever used to infer chain identity.
 */
export function decodeApplicationConfig(environment: ApplicationEnvironment): ApplicationConfig {
    const network = decodeNetwork(environment.VITE_TON_NETWORK);
    const apiKey = decodeOptionalApiKey(environment.VITE_TONCENTER_API_KEY);
    const timeoutMs = decodeTimeout(environment.VITE_TON_RPC_TIMEOUT_MS);

    const rpc: ApplicationRpcConfig = Object.freeze({
        provider: 'toncenter',
        endpoint: TONCENTER_ENDPOINTS[network],
        ...(apiKey === undefined || network === 'testnet' ? {} : { apiKey }),
        timeoutMs,
    });
    return Object.freeze({ network, rpc });
}

function decodeNetwork(value: unknown): NetworkId {
    if (value === undefined || value === null || value === '') {
        return 'mainnet'; // Fallback for environments without VITE_TON_NETWORK set
    }
    if (value !== 'mainnet' && value !== 'testnet') {
        throw new ApplicationConfigError(
            'APPLICATION_NETWORK_INVALID',
            'VITE_TON_NETWORK must be exactly mainnet or testnet.',
        );
    }
    return value;
}

function decodeOptionalApiKey(value: unknown): string | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value !== 'string') {
        throw new ApplicationConfigError(
            'APPLICATION_API_KEY_INVALID',
            'VITE_TONCENTER_API_KEY must be a string when configured.',
        );
    }

    const apiKey = value.trim();
    if (apiKey.length === 0) return undefined;
    if (apiKey.length > 512 || /[\u0000-\u001f\u007f]/.test(apiKey)) {
        throw new ApplicationConfigError(
            'APPLICATION_API_KEY_INVALID',
            'VITE_TONCENTER_API_KEY has an invalid format.',
        );
    }
    return apiKey;
}

function decodeTimeout(value: unknown): number {
    if (value === undefined || value === null || value === '') return DEFAULT_RPC_TIMEOUT_MS;
    if (typeof value !== 'string' || !DECIMAL_INTEGER.test(value)) {
        throw new ApplicationConfigError(
            'APPLICATION_RPC_TIMEOUT_INVALID',
            'VITE_TON_RPC_TIMEOUT_MS must be a whole number of milliseconds.',
        );
    }

    const timeoutMs = Number(value);
    if (
        !Number.isSafeInteger(timeoutMs)
        || timeoutMs < MIN_RPC_TIMEOUT_MS
        || timeoutMs > MAX_RPC_TIMEOUT_MS
    ) {
        throw new ApplicationConfigError(
            'APPLICATION_RPC_TIMEOUT_INVALID',
            'VITE_TON_RPC_TIMEOUT_MS must be between 1000 and 120000 milliseconds.',
        );
    }
    return timeoutMs;
}
