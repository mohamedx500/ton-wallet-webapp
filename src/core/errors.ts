/**
 * Core error primitives
 * ============================================================================
 *
 * Errors raised by the low-level chain primitives (address parsing, fixed-point
 * arithmetic). Deliberately independent of any feature module so that
 * `src/core/*` has no upward dependencies.
 *
 * Feature layers (swap, nft, dns, tonconnect) catch these at their boundary and
 * re-wrap them in a domain error carrying a user-facing message.
 */

/** Base class for every error thrown by `src/core`. */
export class CoreError extends Error {
    /** Stable machine-readable discriminator, safe to switch on. */
    public readonly code: string;
    /** Structured context for logs and tests. Never rendered to users raw. */
    public readonly details: Readonly<Record<string, string>>;

    public constructor(code: string, message: string, details: Record<string, string> = {}, cause?: unknown) {
        super(message, cause === undefined ? undefined : { cause });
        this.name = new.target.name;
        this.code = code;
        this.details = Object.freeze({ ...details });
    }
}

/** A decimal string or unit count failed validation. */
export class InvalidAmountError extends CoreError {
    public constructor(message: string, details?: Record<string, string>) {
        super('INVALID_AMOUNT', message, details);
    }
}

/** A string could not be parsed as a TON address, or failed a policy check. */
export class InvalidAddressError extends CoreError {
    public constructor(message: string, details?: Record<string, string>, cause?: unknown) {
        super('INVALID_ADDRESS', message, details, cause);
    }
}
