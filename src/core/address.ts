/**
 * TON address handling
 * ============================================================================
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * The same TON account has many valid string spellings. All of these are the
 * *same* address:
 *
 *   EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs   (bounceable, url-safe)
 *   UQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_hHs   (non-bounceable)
 *   EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id+sDs   (bounceable, base64)
 *   0:b113a994b5024a16719f691393 28eb75 …               (raw)
 *
 * Comparing them as strings therefore produces false negatives. That matters a
 * great deal here: the swap engine refuses to sign a message whose destination
 * is not on a verified contract list, and a false negative in that comparison
 * would block every legitimate swap, while a *string* comparison that happens
 * to be case- or encoding-sensitive could in principle be gamed.
 *
 * Rule enforced throughout the codebase: **compare addresses only via
 * {@link addressKey} or {@link isSameAddress}, never with `===` on strings.**
 *
 * @see https://docs.ton.org/learn/overviews/addresses
 */

import { Address } from '@ton/core';

import { InvalidAddressError } from './errors';

/**
 * Canonical comparison key for an address: the raw `workchain:hex` form,
 * lower-cased. Independent of bounceable flag, test-only flag, and base64
 * variant — i.e. two spellings of the same account always produce the same key.
 */
export function addressKey(address: Address | string): string {
    return parseAddress(address).toRawString().toLowerCase();
}

/** True when both arguments denote the same account, in any spelling. */
export function isSameAddress(a: Address | string | null | undefined, b: Address | string | null | undefined): boolean {
    if (a === null || a === undefined || b === null || b === undefined) {
        return false;
    }
    try {
        return addressKey(a) === addressKey(b);
    } catch {
        // An unparseable address is not equal to anything, including itself.
        return false;
    }
}

/**
 * Parse an address, throwing a typed error with context on failure.
 *
 * `Address.parse` throws bare `Error`s with terse messages; this wrapper keeps
 * the offending input in `details` for diagnostics without interpolating
 * untrusted text into a user-facing string.
 */
export function parseAddress(address: Address | string): Address {
    if (typeof address !== 'string') {
        return address;
    }
    const trimmed = address.trim();
    if (trimmed.length === 0) {
        throw new InvalidAddressError('Address is required.');
    }
    try {
        return Address.parse(trimmed);
    } catch (cause) {
        throw new InvalidAddressError('This is not a valid TON address.', { input: trimmed }, cause);
    }
}

/** Parse without throwing. Returns `null` for any invalid input. */
export function tryParseAddress(address: string | null | undefined): Address | null {
    if (address === null || address === undefined) {
        return null;
    }
    try {
        return parseAddress(address);
    } catch {
        return null;
    }
}

/** True when the string parses as a TON address. */
export function isValidAddress(address: string | null | undefined): boolean {
    return tryParseAddress(address) !== null;
}

/**
 * Render an address in the user-facing form.
 *
 * Defaults to **bounceable** (`EQ…`), which is correct for contracts and is what
 * block explorers display. Pass `bounceable: false` for the `UQ…` form used when
 * displaying a wallet address for deposits.
 *
 * @param options.testOnly Set the test-only flag (testnet addresses render `kQ…`/`0Q…`).
 */
export function formatAddress(
    address: Address | string,
    options: { bounceable?: boolean; testOnly?: boolean; urlSafe?: boolean } = {},
): string {
    return parseAddress(address).toString({
        bounceable: options.bounceable ?? true,
        testOnly: options.testOnly ?? false,
        urlSafe: options.urlSafe ?? true,
    });
}

/**
 * Shorten an address for display: `EQCxE6…d_sDs`.
 *
 * @param head Characters to keep from the start (default 6).
 * @param tail Characters to keep from the end (default 5).
 */
export function shortenAddress(address: Address | string, head = 6, tail = 5): string {
    const friendly = typeof address === 'string' && !isValidAddress(address) ? address : formatAddress(address);
    if (friendly.length <= head + tail + 1) {
        return friendly;
    }
    return `${friendly.slice(0, head)}…${friendly.slice(-tail)}`;
}

/**
 * An immutable, order-independent set of addresses with encoding-insensitive
 * membership tests.
 *
 * Used for contract allow-lists: the swap engine builds one from the DEX
 * provider's published router set and checks every outgoing message destination
 * against it before anything is signed.
 */
export class AddressSet {
    private readonly keys: ReadonlySet<string>;

    public constructor(addresses: Iterable<Address | string> = []) {
        const keys = new Set<string>();
        for (const address of addresses) {
            const parsed = tryParseAddress(typeof address === 'string' ? address : address.toString());
            if (parsed !== null) {
                keys.add(addressKey(parsed));
            }
        }
        this.keys = keys;
    }

    /** Number of distinct accounts in the set. */
    public get size(): number {
        return this.keys.size;
    }

    /** True when `address` is in the set, regardless of spelling. */
    public has(address: Address | string | null | undefined): boolean {
        if (address === null || address === undefined) {
            return false;
        }
        const parsed = tryParseAddress(typeof address === 'string' ? address : address.toString());
        return parsed !== null && this.keys.has(addressKey(parsed));
    }

    /**
     * A new set containing the members of both.
     *
     * Safe to rebuild from the canonical keys: `Address.parse` accepts the raw
     * `workchain:hex` form, so round-tripping through the constructor is lossless.
     */
    public union(other: AddressSet): AddressSet {
        return new AddressSet([...this.keys, ...other.keys]);
    }

    /** Canonical keys, for diagnostics and snapshot tests. */
    public toArray(): readonly string[] {
        return [...this.keys].sort();
    }
}
