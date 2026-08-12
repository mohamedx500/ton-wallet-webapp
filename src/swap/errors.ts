/**
 * Swap error taxonomy
 * ============================================================================
 *
 * Every failure mode in the swap pipeline is represented by a distinct class so
 * that the UI can render a specific, actionable message instead of a generic
 * "swap failed". Each error carries:
 *
 *  - `code`     — a stable machine-readable discriminator (safe to switch on,
 *                 safe to use as an i18n key).
 *  - `severity` — how the UI should present it. `suspicious` means the wallet
 *                 refused to sign something it could not verify; those must be
 *                 shown as a security warning, not as a transient error.
 *  - `retryable`— whether re-running the same request could plausibly succeed.
 *
 * Why a class hierarchy rather than string returns: the engine performs a chain
 * of assertions before signing, and each assertion needs to abort the flow with
 * enough structured context for the UI *and* for tests to assert on. `code`
 * is compared in tests; the message is for humans only.
 *
 * @see docs/swap.md
 */

import { CoreError, InvalidAddressError, InvalidAmountError } from '../core/errors';

/** Stable, machine-readable identifiers for every swap failure. */
export const SwapErrorCode = {
    /** The requested asset pair has no route on any registered provider. */
    NoRoute: 'NO_ROUTE',
    /** All providers failed to produce a quote (network / upstream outage). */
    QuoteUnavailable: 'QUOTE_UNAVAILABLE',
    /** The quote is older than the configured freshness window. */
    QuoteExpired: 'QUOTE_EXPIRED',
    /** Caller supplied a malformed amount, asset, or slippage value. */
    InvalidRequest: 'INVALID_REQUEST',
    /** Slippage outside the permitted range. */
    InvalidSlippage: 'INVALID_SLIPPAGE',
    /** Wallet does not hold enough of the offered asset. */
    InsufficientFunds: 'INSUFFICIENT_FUNDS',
    /** Wallet holds enough of the asset but not enough TON for gas. */
    InsufficientGas: 'INSUFFICIENT_GAS',
    /** A destination address is not on the provider's verified contract list. */
    UntrustedDestination: 'UNTRUSTED_DESTINATION',
    /** The built message violates a protocol invariant (see validation.ts). */
    MalformedTransaction: 'MALFORMED_TRANSACTION',
    /** Price moved beyond the user's tolerance between quote and build. */
    PriceMoved: 'PRICE_MOVED',
    /** The provider could not build a transaction from this quote. */
    BuildFailed: 'BUILD_FAILED',
    /** The transaction was submitted but the DEX reported a non-zero exit code. */
    SwapReverted: 'SWAP_REVERTED',
    /** Confirmation polling ran out of attempts; outcome is genuinely unknown. */
    ConfirmationTimeout: 'CONFIRMATION_TIMEOUT',
    /** A provider returned a response that failed schema validation. */
    ProviderProtocolError: 'PROVIDER_PROTOCOL_ERROR',
    /** Pending swap recovery metadata could not be safely decoded or persisted. */
    RecoveryStoreFailed: 'RECOVERY_STORE_FAILED',
} as const;

export type SwapErrorCode = (typeof SwapErrorCode)[keyof typeof SwapErrorCode];

/**
 * How the UI should present a failure.
 *
 * - `error`      — ordinary failure; show a message and let the user retry.
 * - `warning`    — nothing was signed; the user can adjust inputs and retry.
 * - `suspicious` — the wallet refused to sign because it could not verify the
 *                  destination or payload. Must be surfaced prominently: this
 *                  is the class of event that precedes fund loss.
 */
export type SwapErrorSeverity = 'error' | 'warning' | 'suspicious';

/** Base class for every error raised by the swap engine or a provider. */
export class SwapError extends Error {
    public readonly code: SwapErrorCode;
    public readonly severity: SwapErrorSeverity;
    public readonly retryable: boolean;
    /** Provider id, when the failure is attributable to one provider. */
    public readonly providerId?: string;
    /** Extra machine-readable context for logs and tests. Never rendered raw. */
    public readonly details: Readonly<Record<string, string>>;

    public constructor(
        code: SwapErrorCode,
        message: string,
        options: {
            severity?: SwapErrorSeverity;
            retryable?: boolean;
            providerId?: string;
            details?: Record<string, string>;
            cause?: unknown;
        } = {},
    ) {
        super(message, options.cause === undefined ? undefined : { cause: options.cause });
        this.name = new.target.name;
        this.code = code;
        this.severity = options.severity ?? 'error';
        this.retryable = options.retryable ?? false;
        if (options.providerId !== undefined) {
            this.providerId = options.providerId;
        }
        this.details = Object.freeze({ ...options.details });
    }
}

/** No provider offers a route for the requested pair. */
export class NoRouteError extends SwapError {
    public constructor(from: string, to: string, cause?: unknown) {
        super(SwapErrorCode.NoRoute, `No swap route available for ${from} → ${to}.`, {
            severity: 'warning',
            details: { from, to },
            ...(cause === undefined ? {} : { cause }),
        });
    }
}

/** Caller-supplied input was invalid. Never reaches the network. */
export class InvalidSwapRequestError extends SwapError {
    public constructor(message: string, details?: Record<string, string>) {
        super(SwapErrorCode.InvalidRequest, message, {
            severity: 'warning',
            ...(details === undefined ? {} : { details }),
        });
    }
}

/** Slippage tolerance outside the permitted range. */
export class InvalidSlippageError extends SwapError {
    public constructor(bps: number, minBps: number, maxBps: number) {
        super(
            SwapErrorCode.InvalidSlippage,
            `Slippage of ${(bps / 100).toFixed(2)}% is outside the allowed range ` +
                `${(minBps / 100).toFixed(2)}%–${(maxBps / 100).toFixed(2)}%.`,
            {
                severity: 'warning',
                details: { bps: String(bps), minBps: String(minBps), maxBps: String(maxBps) },
            },
        );
    }
}

/** Balance check failed before signing. */
export class InsufficientFundsError extends SwapError {
    public constructor(params: {
        readonly symbol: string;
        readonly required: string;
        readonly available: string;
        readonly forGas?: boolean;
    }) {
        super(
            params.forGas === true ? SwapErrorCode.InsufficientGas : SwapErrorCode.InsufficientFunds,
            params.forGas === true
                ? `Not enough TON for network fees. Need ${params.required} TON, have ${params.available} TON.`
                : `Not enough ${params.symbol}. Need ${params.required}, have ${params.available}.`,
            {
                severity: 'warning',
                details: {
                    symbol: params.symbol,
                    required: params.required,
                    available: params.available,
                },
            },
        );
    }
}

/**
 * The wallet refused to sign a message addressed to a contract it could not
 * verify against the provider's on-chain/API-published contract set.
 *
 * This is the guard that prevents the audited failure mode of signing whatever
 * address an HTTP response happened to contain.
 */
export class UntrustedDestinationError extends SwapError {
    public constructor(address: string, providerId: string, reason: string) {
        super(
            SwapErrorCode.UntrustedDestination,
            `Refusing to sign: ${address} is not a verified ${providerId} contract (${reason}).`,
            {
                severity: 'suspicious',
                providerId,
                details: { address, reason },
            },
        );
    }
}

/** A built message failed one of the pre-flight protocol invariants. */
export class MalformedTransactionError extends SwapError {
    public constructor(reason: string, details?: Record<string, string>) {
        super(SwapErrorCode.MalformedTransaction, `Refusing to sign a malformed transaction: ${reason}`, {
            severity: 'suspicious',
            ...(details === undefined ? {} : { details }),
        });
    }
}

/** The quote used to build the transaction is too old to be trusted. */
export class QuoteExpiredError extends SwapError {
    public constructor(ageMs: number, maxAgeMs: number) {
        super(
            SwapErrorCode.QuoteExpired,
            `This price is ${Math.round(ageMs / 1000)}s old. Refresh the quote before swapping.`,
            {
                severity: 'warning',
                retryable: true,
                details: { ageMs: String(ageMs), maxAgeMs: String(maxAgeMs) },
            },
        );
    }
}

/** Re-simulation before signing showed the price moved past the tolerance. */
export class PriceMovedError extends SwapError {
    public constructor(params: { quoted: string; current: string; symbol: string }) {
        super(
            SwapErrorCode.PriceMoved,
            `Price moved: quoted ${params.quoted} ${params.symbol}, now ${params.current} ${params.symbol}. ` +
                `Refresh and try again.`,
            { severity: 'warning', retryable: true, details: { ...params } },
        );
    }
}

/** A provider response did not match its expected shape. */
export class ProviderProtocolError extends SwapError {
    public constructor(providerId: string, message: string, cause?: unknown) {
        super(SwapErrorCode.ProviderProtocolError, `${providerId}: ${message}`, {
            severity: 'error',
            retryable: true,
            providerId,
            ...(cause === undefined ? {} : { cause }),
        });
    }
}

/** The DEX contract accepted the message but aborted with a non-zero exit code. */
export class SwapRevertedError extends SwapError {
    public constructor(params: { exitCode: string; queryId: string; txHash?: string }) {
        super(
            SwapErrorCode.SwapReverted,
            `The DEX rejected this swap (exit code ${params.exitCode}). Your funds were returned.`,
            {
                severity: 'error',
                details: {
                    exitCode: params.exitCode,
                    queryId: params.queryId,
                    ...(params.txHash === undefined ? {} : { txHash: params.txHash }),
                },
            },
        );
    }
}

/** Confirmation polling exhausted its budget without a definitive result. */
export class ConfirmationTimeoutError extends SwapError {
    public constructor(queryId: string, waitedMs: number) {
        super(
            SwapErrorCode.ConfirmationTimeout,
            `Still waiting for confirmation after ${Math.round(waitedMs / 1000)}s. ` +
                `The swap may still complete — check the explorer link.`,
            {
                severity: 'warning',
                retryable: true,
                details: { queryId, waitedMs: String(waitedMs) },
            },
        );
    }
}

/** Narrowing helper for `catch` blocks. */
export function isSwapError(value: unknown): value is SwapError {
    return value instanceof SwapError;
}

/**
 * Convert an unknown thrown value into a `SwapError`.
 *
 * Called at every provider and engine boundary so that no raw network error,
 * `TypeError`, or bare `@ton/core` throw ever reaches the UI without a code and
 * a severity attached.
 *
 * `src/core` errors are mapped to their swap-domain equivalent so that, for
 * example, an over-precise amount surfaces as an input problem the user can fix
 * rather than as an opaque provider fault.
 */
export function toSwapError(value: unknown, providerId: string, fallbackMessage: string): SwapError {
    if (isSwapError(value)) {
        return value;
    }
    if (value instanceof InvalidAmountError || value instanceof InvalidAddressError) {
        return new InvalidSwapRequestError(value.message, value.details);
    }
    if (value instanceof CoreError) {
        return new SwapError(SwapErrorCode.InvalidRequest, value.message, {
            severity: 'warning',
            details: value.details,
            cause: value,
        });
    }
    const message = value instanceof Error ? value.message : fallbackMessage;
    return new ProviderProtocolError(providerId, message, value);
}
