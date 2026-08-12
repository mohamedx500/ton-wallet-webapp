/**
 * Strict scan URI classifier — maps a raw scan string to an immutable typed
 * metadata record without navigating, executing, or storing anything.
 *
 * Supported URI schemes:
 *   - `tc://`          — TON Connect v2 deep-link (validated by the existing
 *                        `decodeTonConnectLink` decoder; no duplication)
 *   - `ton://transfer` — TON transfer intent (TEP-2 address, optional amount /
 *                        text / exp; no binary payload, no Jetton transfer)
 *   - anything else    — classified as UNSUPPORTED; callers must not act on it
 *
 * The classifier is pure: it accepts an unknown string from a camera frame,
 * validates it in isolation, and returns a frozen result. It never touches
 * React state, console output, or the network.
 *
 * All validated `ton://transfer` amounts are returned as exact `bigint` nano-TON
 * so downstream callers do not need to perform any decimal arithmetic.
 */

import { tryParseUnits } from '../core/units';
import type { NetworkId } from '../core/chain';
import { parseAddress } from '../core/address';
import { decodeTonConnectLink } from '../tonconnect/wallet/decode';
import type { TonConnectLink } from '../tonconnect/wallet/types';
import { Address } from '@ton/core';

// ─── constants ───────────────────────────────────────────────────────────────

/** Max raw scan length that will be examined. Frames beyond this are UNSUPPORTED. */
export const SCAN_MAX_TEXT_BYTES = 4_096;

/** Max UTF-8 byte length of a `ton://transfer` comment. */
const TON_TRANSFER_MAX_COMMENT_BYTES = 1_024;

/** Max absolute value of a `ton://transfer` expiry timestamp (Unix seconds). */
const TON_TRANSFER_MAX_EXPIRY = 4_294_967_295; // 0xFFFFFFFF — year 2106

/** Exact set of recognised `ton://transfer` query parameters. */
const TON_TRANSFER_ALLOWED_PARAMS = new Set(['amount', 'text', 'exp']);

const UTF8 = new TextEncoder();

// ─── result types ────────────────────────────────────────────────────────────

export type ScanResultKind =
    | 'TON_CONNECT_LINK'
    | 'TON_TRANSFER'
    | 'UNSUPPORTED';

/** A fully decoded TON Connect deep-link from a camera scan. */
export interface TonConnectScanResult {
    readonly kind: 'TON_CONNECT_LINK';
    /** Decoded and validated link object. */
    readonly link: TonConnectLink;
}

/** A decoded `ton://transfer` URI. Amount and expiry are validated but optional. */
export interface TonTransferScanResult {
    readonly kind: 'TON_TRANSFER';
    /** TEP-2 user-friendly address, bounceable, url-safe. */
    readonly address: string;
    /** Exact nanotons; present only when the URI contained a valid positive amount. */
    readonly amountNano: bigint | null;
    /** Verified UTF-8 comment text (no control characters). */
    readonly comment: string | null;
    /** Unix seconds expiry; null when absent. */
    readonly expiry: number | null;
}

/** Raw text that could not be classified as a known, network-coherent URI. */
export interface UnsupportedScanResult {
    readonly kind: 'UNSUPPORTED';
}

export type ScanResult = TonConnectScanResult | TonTransferScanResult | UnsupportedScanResult;

const UNSUPPORTED: UnsupportedScanResult = Object.freeze({ kind: 'UNSUPPORTED' });

// ─── public API ──────────────────────────────────────────────────────────────

/**
 * Classify a raw camera frame string.
 *
 * Always returns a frozen result; never throws.
 *
 * @param raw     - The decoded text from a QR/barcode camera frame.
 * @param network - The application's explicit network identity.
 */
export function classifyScanResult(raw: string, network: NetworkId): ScanResult {
    if (typeof raw !== 'string' || UTF8.encode(raw).byteLength > SCAN_MAX_TEXT_BYTES) {
        return UNSUPPORTED;
    }

    const trimmed = raw.trim();
    if (trimmed.length === 0) return UNSUPPORTED;

    const lowered = trimmed.toLowerCase();

    if (lowered.startsWith('tc:')) {
        return classifyTonConnectLink(trimmed);
    }

    if (lowered.startsWith('ton://transfer/') || lowered.startsWith('ton://transfer?')) {
        return classifyTonTransfer(trimmed, network);
    }

    return UNSUPPORTED;
}

// ─── TON Connect classifier ───────────────────────────────────────────────────

function classifyTonConnectLink(raw: string): ScanResult {
    try {
        const link = decodeTonConnectLink(raw, { acceptedSchemes: ['tc:'] });
        return Object.freeze({ kind: 'TON_CONNECT_LINK', link });
    } catch {
        return UNSUPPORTED;
    }
}

// ─── TON transfer classifier ──────────────────────────────────────────────────

function classifyTonTransfer(raw: string, network: NetworkId): ScanResult {
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return UNSUPPORTED;
    }

    // Scheme must be exactly ton:
    if (url.protocol !== 'ton:') return UNSUPPORTED;

    // Path must be /transfer/<ADDRESS> with nothing else
    // URL parses `ton://transfer/EQ...` as host=transfer, pathname=/<ADDRESS>
    const host = url.hostname.toLowerCase();
    if (host !== 'transfer') return UNSUPPORTED;

    // The address is the first path segment (no trailing segments)
    const pathParts = url.pathname.split('/').filter((p) => p.length > 0);
    if (pathParts.length !== 1) return UNSUPPORTED;

    const rawAddress = pathParts[0];
    if (rawAddress === undefined || rawAddress.length === 0) return UNSUPPORTED;

    // Validate: structurally valid TON address, network-coherent test-only flag
    let address: Address;
    try {
        address = parseAddress(rawAddress);
    } catch {
        return UNSUPPORTED;
    }

    // Friendly-address network-flag check
    if (
        Address.isFriendly(rawAddress)
        && Address.parseFriendly(rawAddress).isTestOnly !== (network === 'testnet')
    ) {
        return UNSUPPORTED;
    }

    // Reject unknown or duplicate query parameters
    const paramKeys: string[] = [];
    for (const key of url.searchParams.keys()) {
        paramKeys.push(key);
    }
    if (new Set(paramKeys).size !== paramKeys.length) return UNSUPPORTED;
    if (paramKeys.some((key) => !TON_TRANSFER_ALLOWED_PARAMS.has(key))) return UNSUPPORTED;

    // amount (optional) — the URI carries raw nanotons as a whole integer (decimals=0)
    let amountNano: bigint | null = null;
    const rawAmount = url.searchParams.get('amount');
    if (rawAmount !== null) {
        // Must be a canonical non-negative decimal integer with no dot
        if (!/^(?:0|[1-9][0-9]*)$/u.test(rawAmount)) return UNSUPPORTED;
        const parsed = tryParseUnits(rawAmount, 0);
        if (parsed === null || parsed <= 0n) return UNSUPPORTED;
        amountNano = parsed;
    }

    // text (optional) — bounded UTF-8, no control characters
    let comment: string | null = null;
    const rawText = url.searchParams.get('text');
    if (rawText !== null) {
        if (UTF8.encode(rawText).byteLength > TON_TRANSFER_MAX_COMMENT_BYTES) return UNSUPPORTED;
        // Reject C0/C1 control characters (excluding common whitespace is intentional for security)
        if (/[\u0000-\u001f\u007f-\u009f]/u.test(rawText)) return UNSUPPORTED;
        comment = rawText;
    }

    // exp (optional) — canonical non-negative integer seconds
    let expiry: number | null = null;
    const rawExp = url.searchParams.get('exp');
    if (rawExp !== null) {
        if (!/^(?:0|[1-9][0-9]*)$/u.test(rawExp)) return UNSUPPORTED;
        const exp = Number(rawExp);
        if (!Number.isSafeInteger(exp) || exp < 0 || exp > TON_TRANSFER_MAX_EXPIRY) return UNSUPPORTED;
        expiry = exp;
    }

    // Build the canonical user-friendly address (bounceable, not testOnly for mainnet)
    const friendlyAddress = address.toString({
        bounceable: true,
        testOnly: network === 'testnet',
        urlSafe: true,
    });

    return Object.freeze({
        kind: 'TON_TRANSFER',
        address: friendlyAddress,
        amountNano,
        comment,
        expiry,
    } satisfies TonTransferScanResult);
}
