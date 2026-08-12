/**
 * TonDnsResolver — Slice 3: Modernize TON DNS support.
 *
 * Resolves .ton and .t.me names to TON wallet addresses using the TonAPI.
 * Results are cached with a configurable TTL (default 5 minutes).
 * Network-scoped: a mainnet resolver will never return testnet addresses.
 *
 * Thread-safety: the in-flight map prevents duplicate concurrent requests
 * for the same name, coalescing them into a single fetch.
 */

import type { NetworkId } from '../core/chain';
import type { DnsLookupResult, DnsRecord } from './types';

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_NEGATIVE_TTL_MS = 60 * 1000; // 1 minute

// TonAPI endpoint (v3)
const TONAPI_BASE: Record<NetworkId, string> = {
    mainnet: 'https://tonapi.io',
    testnet: 'https://testnet.tonapi.io',
};

const TON_SUFFIX_PATTERN = /\.ton$/iu;
const TME_SUFFIX_PATTERN = /^@|\.t\.me$/iu;

export interface TonDnsResolverOptions {
    readonly network: NetworkId;
    readonly ttlMs?: number;
    readonly negativeTtlMs?: number;
    /** Optional API key for TonAPI. */
    readonly apiKey?: string;
}

interface CacheEntry {
    readonly result: DnsLookupResult;
    readonly expiresAtMs: number;
}

export class TonDnsResolver {
    private readonly network: NetworkId;
    private readonly ttlMs: number;
    private readonly negativeTtlMs: number;
    private readonly apiKey: string | undefined;
    private readonly cache = new Map<string, CacheEntry>();
    private readonly inFlight = new Map<string, Promise<DnsLookupResult>>();

    public constructor(options: TonDnsResolverOptions) {
        this.network = options.network;
        this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
        this.negativeTtlMs = options.negativeTtlMs ?? DEFAULT_NEGATIVE_TTL_MS;
        this.apiKey = options.apiKey;
    }

    /**
     * Returns true if the value looks like a DNS name (not a raw address).
     */
    public static isDnsName(value: string): boolean {
        return (
            TON_SUFFIX_PATTERN.test(value) ||
            TME_SUFFIX_PATTERN.test(value)
        );
    }

    /**
     * Resolve a .ton or .t.me name to a TON address.
     * Returns a cached result if within TTL.
     */
    public async resolve(name: string): Promise<DnsLookupResult> {
        const normalized = name.trim().toLowerCase();
        const cacheKey = `${this.network}:${normalized}`;

        // Check cache
        const cached = this.cache.get(cacheKey);
        if (cached && Date.now() < cached.expiresAtMs) {
            return cached.result;
        }

        // Coalesce concurrent requests for the same name
        const inflight = this.inFlight.get(cacheKey);
        if (inflight) return inflight;

        const request = this.fetch(normalized, cacheKey);
        this.inFlight.set(cacheKey, request);
        try {
            return await request;
        } finally {
            this.inFlight.delete(cacheKey);
        }
    }

    /** Evict all cache entries (e.g. on network switch). */
    public clearCache(): void {
        this.cache.clear();
    }

    // ─── Private ───────────────────────────────────────────────────────────────

    private async fetch(name: string, cacheKey: string): Promise<DnsLookupResult> {
        try {
            const base = TONAPI_BASE[this.network];
            const headers: Record<string, string> = { 'Accept': 'application/json' };
            if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

            const response = await fetch(
                `${base}/v2/dns/${encodeURIComponent(name)}/resolve`,
                { headers, signal: AbortSignal.timeout(8000) },
            );

            if (response.status === 404) {
                return this.cacheAndReturn(cacheKey, { kind: 'not-found' }, this.negativeTtlMs);
            }
            if (!response.ok) {
                return this.cacheAndReturn(
                    cacheKey,
                    { kind: 'error', message: `TonAPI returned HTTP ${response.status}` },
                    this.negativeTtlMs,
                );
            }

            const json = await response.json() as Record<string, unknown>;

            // TonAPI v2/dns/resolve returns { wallet: { address: string } }
            const walletSection = json['wallet'] as Record<string, unknown> | undefined;
            const address = (walletSection?.['address'] as string | undefined) ?? (json['address'] as string | undefined);

            if (!address || typeof address !== 'string') {
                return this.cacheAndReturn(cacheKey, { kind: 'not-found' }, this.negativeTtlMs);
            }

            const record: DnsRecord = {
                name,
                address,
                network: this.network,
                resolvedAtMs: Date.now(),
                expiresAtUnix: null,
            };
            return this.cacheAndReturn(
                cacheKey,
                { kind: 'resolved', record },
                this.ttlMs,
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            return this.cacheAndReturn(
                cacheKey,
                { kind: 'error', message },
                this.negativeTtlMs,
            );
        }
    }

    private cacheAndReturn(
        key: string,
        result: DnsLookupResult,
        ttlMs: number,
    ): DnsLookupResult {
        this.cache.set(key, { result, expiresAtMs: Date.now() + ttlMs });
        return result;
    }
}
