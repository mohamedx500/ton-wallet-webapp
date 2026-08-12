/**
 * Exact fixed-point amount arithmetic
 * ============================================================================
 *
 * Every monetary value in this wallet is a `bigint` count of indivisible token
 * units. Decimal strings exist only at the UI boundary, and the conversion
 * happens exactly once in each direction — here.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * The previous implementation round-tripped amounts through `parseFloat` /
 * `toFixed` and computed the swap safety floor in floating point:
 *
 *     (parseFloat(outputAmount) * (1 - slippage)).toFixed(decimals)
 *
 * IEEE-754 doubles carry ~15–17 significant decimal digits. A 9-decimal token
 * balance above ~10^7 loses low-order units on that round-trip. `min_out` is the
 * only thing standing between the user and an unbounded-slippage trade, so it
 * must be exact integer arithmetic end to end.
 *
 * Slippage is expressed in **basis points** (1 bp = 0.01%) as an integer for the
 * same reason: `0.005` is not exactly representable as a double, `50` is.
 */

import { InvalidAmountError } from './errors';

/** Basis-point denominator: 10 000 bps = 100%. */
export const BPS_DENOMINATOR = 10_000n;

/** Decimals of the native coin (TON). */
export const TON_DECIMALS = 9;

/** One TON, in nanotons. */
export const ONE_TON = 1_000_000_000n;

/**
 * Parse a human decimal string into an exact `bigint` unit count.
 *
 * Deliberately strict — this guards a value that determines how much of the
 * user's money moves:
 *
 *  - rejects anything that is not `digits[.digits]`
 *  - rejects negative, exponential and non-finite input
 *  - rejects **more** significant fractional digits than the token supports,
 *    rather than silently truncating. Silently truncating a *send* amount is a
 *    surprise the user never consented to. Use {@link truncateDecimalString}
 *    explicitly in an input component if you want truncating behaviour.
 *
 * @param value    Decimal string, e.g. `"1.5"`, `".5"`, `"12."`, `"0"`.
 * @param decimals Token decimals (0–255).
 * @returns Exact unit count.
 *
 * @example parseUnits('1.5', 9)   // 1_500_000_000n
 * @example parseUnits('0.19', 6)  // 190_000n — USDT has 6 decimals, not 9
 */
export function parseUnits(value: string, decimals: number): bigint {
    assertValidDecimals(decimals);

    const trimmed = value.trim();
    if (trimmed.length === 0) {
        throw new InvalidAmountError('Amount is required.');
    }
    if (!/^\d*(?:\.\d*)?$/.test(trimmed) || trimmed === '.') {
        throw new InvalidAmountError(`"${value}" is not a valid amount.`, { value });
    }

    const dotIndex = trimmed.indexOf('.');
    const wholePart = dotIndex === -1 ? trimmed : trimmed.slice(0, dotIndex);
    const fractionPart = dotIndex === -1 ? '' : trimmed.slice(dotIndex + 1);

    if (fractionPart.length > decimals) {
        // Trailing zeros beyond the supported precision carry no value and are
        // safe to drop; any other extra digit is a real loss of precision.
        const significant = fractionPart.replace(/0+$/, '');
        if (significant.length > decimals) {
            throw new InvalidAmountError(`Too many decimal places: this token supports ${decimals}.`, {
                value,
                decimals: String(decimals),
            });
        }
    }

    const paddedFraction = fractionPart.slice(0, decimals).padEnd(decimals, '0');
    return BigInt(`${wholePart === '' ? '0' : wholePart}${paddedFraction}`);
}

/** {@link parseUnits} that returns `null` instead of throwing. */
export function tryParseUnits(value: string, decimals: number): bigint | null {
    try {
        return parseUnits(value, decimals);
    } catch {
        return null;
    }
}

/**
 * Format an exact unit count as a decimal string.
 *
 * @param units    Unit count (must be non-negative).
 * @param decimals Token decimals.
 * @param options.trimTrailingZeros Drop insignificant trailing zeros (default `true`).
 * @param options.maxFractionDigits Cap the fraction length for display. Truncates
 *        toward zero and never rounds up, so a displayed balance is never larger
 *        than the real one.
 *
 * @example formatUnits(1_500_000_000n, 9)                          // '1.5'
 * @example formatUnits(1n, 9)                                      // '0.000000001'
 * @example formatUnits(1_234_567_890n, 9, { maxFractionDigits: 4 })// '1.2345'
 */
export function formatUnits(
    units: bigint,
    decimals: number,
    options: { trimTrailingZeros?: boolean; maxFractionDigits?: number } = {},
): string {
    assertValidDecimals(decimals);
    if (units < 0n) {
        throw new InvalidAmountError('Cannot format a negative amount.');
    }

    if (decimals === 0) {
        return units.toString();
    }

    const base = 10n ** BigInt(decimals);
    const whole = units / base;
    let fraction = (units % base).toString().padStart(decimals, '0');

    if (options.maxFractionDigits !== undefined) {
        fraction = fraction.slice(0, Math.max(0, options.maxFractionDigits));
    }
    if (options.trimTrailingZeros ?? true) {
        fraction = fraction.replace(/0+$/, '');
    }

    return fraction.length === 0 ? whole.toString() : `${whole.toString()}.${fraction}`;
}

/**
 * Truncate a decimal string to at most `decimals` fractional digits.
 *
 * For input components, where truncating as the user types is expected. Never
 * use this on a value about to be signed — {@link parseUnits} must be the one
 * that rejects over-precise amounts.
 */
export function truncateDecimalString(value: string, decimals: number): string {
    const dotIndex = value.indexOf('.');
    if (dotIndex === -1 || decimals < 0) {
        return value;
    }
    if (decimals === 0) {
        return value.slice(0, dotIndex);
    }
    return value.slice(0, dotIndex + 1 + decimals);
}

/**
 * Apply a slippage tolerance to an expected output, in exact integer maths.
 *
 * Integer division truncates toward zero, which always moves `min_out` in the
 * direction that is safe for the user: a floor one unit lower can only make the
 * trade more likely to execute, never less protected than the tolerance chosen.
 *
 * @param expectedOut Expected output in units.
 * @param slippageBps Tolerance in basis points (`100` = 1%).
 *
 * @example applySlippage(1_000_000n, 100) // 990_000n
 */
export function applySlippage(expectedOut: bigint, slippageBps: number): bigint {
    if (!Number.isInteger(slippageBps) || slippageBps < 0) {
        throw new InvalidAmountError(`Slippage must be a non-negative integer in bps, got ${slippageBps}.`);
    }
    if (BigInt(slippageBps) >= BPS_DENOMINATOR) {
        // 100% slippage means "accept zero output" — never a valid safety floor.
        throw new InvalidAmountError('Slippage of 100% or more is not permitted.');
    }
    if (expectedOut < 0n) {
        throw new InvalidAmountError('Expected output cannot be negative.');
    }
    return (expectedOut * (BPS_DENOMINATOR - BigInt(slippageBps))) / BPS_DENOMINATOR;
}

/**
 * Signed difference between two amounts in basis points, relative to
 * `reference`. Negative means `actual` is worse (smaller) than `reference`.
 *
 * Used to detect price movement between quoting and signing.
 */
export function differenceInBps(actual: bigint, reference: bigint): number {
    if (reference === 0n) {
        return actual === 0n ? 0 : Number.POSITIVE_INFINITY;
    }
    return Number(((actual - reference) * BPS_DENOMINATOR) / reference);
}

/** Parse a decimal-string percentage (`"1"`, `"0.5"`) into integer bps. */
export function percentToBps(percent: string): number {
    // Percent → bps is a shift of two decimal places: 1% === 100 bps.
    const units = parseUnits(percent, 2);
    if (units > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new InvalidAmountError(`Slippage value "${percent}" is out of range.`);
    }
    return Number(units);
}

/** Format integer bps as a percentage string: `100` → `'1'`. */
export function bpsToPercent(bps: number): string {
    return formatUnits(BigInt(Math.trunc(Math.abs(bps))), 2);
}

/** Format a nanoton amount as a TON decimal string. */
export function formatTon(nano: bigint, maxFractionDigits = 4): string {
    return formatUnits(nano, TON_DECIMALS, { maxFractionDigits });
}

/** Parse a TON decimal string into nanotons. */
export function parseTon(value: string): bigint {
    return parseUnits(value, TON_DECIMALS);
}

/** Larger of two amounts. */
export function maxBigInt(a: bigint, b: bigint): bigint {
    return a > b ? a : b;
}

/** Smaller of two amounts. */
export function minBigInt(a: bigint, b: bigint): bigint {
    return a < b ? a : b;
}

function assertValidDecimals(decimals: number): void {
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
        throw new InvalidAmountError(`Invalid token decimals: ${decimals}.`);
    }
}
