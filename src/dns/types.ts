/**
 * TON DNS types — Slice 3: Modernize TON DNS support.
 */

import type { NetworkId } from '../core/chain';

/** A successfully resolved DNS record. */
export interface DnsRecord {
    /** The original name as entered by the user (e.g. "medo.ton"). */
    readonly name: string;
    /** Canonical TON address the name resolves to. */
    readonly address: string;
    /** Network that produced this resolution. */
    readonly network: NetworkId;
    /** Unix timestamp (ms) when this record was fetched. */
    readonly resolvedAtMs: number;
    /** Optional expiry from on-chain data (Unix seconds). */
    readonly expiresAtUnix: number | null;
}

/** Result of a single DNS lookup attempt. */
export type DnsLookupResult =
    | { readonly kind: 'resolved'; readonly record: DnsRecord }
    | { readonly kind: 'not-found' }
    | { readonly kind: 'error'; readonly message: string };
