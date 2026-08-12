/**
 * Fungible asset model
 * ============================================================================
 *
 * The wallet's canonical representation of anything with a balance and a decimal
 * precision: the native coin and TEP-74 jettons.
 *
 * MODELLED AS A DISCRIMINATED UNION, NOT A MAGIC ADDRESS
 * -----------------------------------------------------
 * A common shortcut is to represent TON as a jetton with a sentinel master
 * address (`'native'`, the zero address, or a pTON proxy address). That leaks a
 * protocol-specific convention into every layer and, worse, makes it possible to
 * accidentally *send* to the sentinel. Here the distinction lives in the type
 * system: `asset.kind === 'jetton'` is the only way to reach `asset.master`, so
 * code that forgets to handle the native case does not compile.
 *
 * Each DEX provider maps this model onto its own wire convention internally
 * (STON.fi, for instance, represents TON by its pTON proxy master address).
 *
 * @see https://github.com/ton-blockchain/TEPs/blob/master/text/0074-jettons-standard.md
 */

import { addressKey, formatAddress, isSameAddress } from '../core/address';
import { TON_DECIMALS } from '../core/units';

/** Discriminator for the fungible asset union. */
export type FungibleAssetKind = 'native' | 'jetton';

/** Where an asset's metadata came from, which determines how much to trust it. */
export type AssetTrustLevel =
    /** Hardcoded in this wallet, or the native coin. Highest confidence. */
    | 'builtin'
    /** Present on a curated list (e.g. a DEX's verified asset registry). */
    | 'verified'
    /** Read from on-chain metadata only. Display with a caution affordance. */
    | 'community'
    /** Flagged as a scam or impersonation by a source we trust. */
    | 'blacklisted'
    /** Nothing is known about this asset. */
    | 'unknown';

interface FungibleAssetBase {
    readonly symbol: string;
    readonly name: string;
    readonly decimals: number;
    /** Absolute https/ipfs URL. Validate before use — see `isSafeImageUrl`. */
    readonly imageUrl?: string;
    readonly trust: AssetTrustLevel;
}

/** The native coin. There is exactly one. */
export interface NativeAsset extends FungibleAssetBase {
    readonly kind: 'native';
}

/** A TEP-74 jetton, identified by its minter (master) contract. */
export interface JettonAsset extends FungibleAssetBase {
    readonly kind: 'jetton';
    /** Jetton master (minter) address, bounceable friendly form. */
    readonly master: string;
}

export type FungibleAsset = NativeAsset | JettonAsset;

/**
 * The native coin, TON.
 *
 * `decimals` is 9 by protocol definition — not configurable, and never read from
 * a remote source.
 */
export const TON_ASSET: NativeAsset = Object.freeze({
    kind: 'native',
    symbol: 'TON',
    name: 'Toncoin',
    decimals: TON_DECIMALS,
    trust: 'builtin',
});

/** Stable identity key for an asset. Safe as a `Map` key or a React `key`. */
export function assetKey(asset: FungibleAsset): string {
    return asset.kind === 'native' ? 'native' : `jetton:${addressKey(asset.master)}`;
}

/** True when both references denote the same asset. */
export function isSameAsset(a: FungibleAsset | null | undefined, b: FungibleAsset | null | undefined): boolean {
    if (a === null || a === undefined || b === null || b === undefined) {
        return false;
    }
    if (a.kind === 'native' || b.kind === 'native') {
        return a.kind === b.kind;
    }
    return isSameAddress(a.master, b.master);
}

/** Type guard narrowing to the jetton branch. */
export function isJettonAsset(asset: FungibleAsset): asset is JettonAsset {
    return asset.kind === 'jetton';
}

/** Type guard narrowing to the native branch. */
export function isNativeAsset(asset: FungibleAsset): asset is NativeAsset {
    return asset.kind === 'native';
}

/**
 * Construct a jetton asset with a normalised master address and sanitised text.
 *
 * Normalising at construction means every later comparison is a plain compare on
 * an already-canonical value, and an unparseable address fails here rather than
 * deep inside a transaction builder.
 */
export function createJettonAsset(params: {
    master: string;
    symbol: string;
    name: string;
    decimals: number;
    imageUrl?: string;
    trust?: AssetTrustLevel;
}): JettonAsset {
    const imageUrl = params.imageUrl !== undefined && isSafeImageUrl(params.imageUrl) ? params.imageUrl : undefined;
    return {
        kind: 'jetton',
        master: formatAddress(params.master),
        symbol: sanitizeAssetText(params.symbol, 32),
        name: sanitizeAssetText(params.name, 64),
        decimals: params.decimals,
        ...(imageUrl === undefined ? {} : { imageUrl }),
        trust: params.trust ?? 'unknown',
    };
}

/**
 * Whether the UI must show a warning affordance next to this asset.
 *
 * Jetton metadata is attacker-controlled: anyone can deploy a minter whose
 * symbol is `USDT`. An unverified asset must never be presented the same way a
 * verified one is.
 */
export function requiresTrustWarning(asset: FungibleAsset): boolean {
    return asset.trust === 'unknown' || asset.trust === 'community' || asset.trust === 'blacklisted';
}

/**
 * Code points that are invisible or that change text rendering.
 *
 * Written as numeric ranges rather than regex escapes so the source file stays
 * pure ASCII and the intent of each range is documented inline.
 */
const INVISIBLE_RANGES: readonly (readonly [number, number])[] = [
    [0x0000, 0x001f], // C0 controls
    [0x007f, 0x009f], // DEL and C1 controls
    [0x200b, 0x200f], // zero-width space/joiners, LTR/RTL marks
    [0x2028, 0x2029], // line/paragraph separators
    [0x202a, 0x202e], // bidi embedding and override
    [0x2066, 0x2069], // bidi isolates
    [0xfeff, 0xfeff], // zero-width no-break space (BOM)
];

/**
 * Sanitise attacker-controlled metadata text for display.
 *
 * React escapes HTML on interpolation, so this defends against the attacks
 * escaping does *not* cover:
 *
 *  - **Bidi spoofing.** `U+202E` (RIGHT-TO-LEFT OVERRIDE) makes a string render
 *    differently from how it compares, which is how impersonation tokens are
 *    built. A jetton can be named so that it *displays* as `USDT`.
 *  - **Layout breaking.** Newlines and separators injected into a symbol to push
 *    real content out of view on a confirmation screen.
 *  - **Zero-width padding** used to make two distinct symbols look identical.
 *
 * Then hard-truncates, so a 10 000-character "symbol" cannot blow up the UI.
 */
export function sanitizeAssetText(value: string, maxChars = 64): string {
    let cleaned = '';
    for (const character of value) {
        const codePoint = character.codePointAt(0);
        if (codePoint === undefined || isInvisibleCodePoint(codePoint)) {
            continue;
        }
        cleaned += character;
    }
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    return cleaned.length > maxChars ? `${cleaned.slice(0, maxChars - 1)}…` : cleaned;
}

function isInvisibleCodePoint(codePoint: number): boolean {
    // Tab, LF and CR are in the C0 range but collapse harmlessly to a space in
    // the whitespace pass, so they are allowed through here.
    if (codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d) {
        return false;
    }
    return INVISIBLE_RANGES.some(([start, end]) => codePoint >= start && codePoint <= end);
}

/**
 * Whether a metadata image URL is safe to place in an `<img src>`.
 *
 * Rejects `javascript:`, `data:` and every other scheme. `data:` is excluded
 * deliberately: an SVG data URL is a script execution vector, and there is no
 * legitimate reason for a jetton icon to be inlined into metadata.
 */
export function isSafeImageUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'https:' || parsed.protocol === 'ipfs:';
    } catch {
        return false;
    }
}

/** Human label for logs and confirmation screens. */
export function assetLabel(asset: FungibleAsset): string {
    const symbol = sanitizeAssetText(asset.symbol, 32);
    if (symbol.length > 0) {
        return symbol;
    }
    return asset.kind === 'native' ? 'TON' : 'Unknown token';
}
