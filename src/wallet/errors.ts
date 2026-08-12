import { CoreError } from '../core/errors';
import type { SubmissionReference } from './types';

/** Stable failure codes for wallet execution orchestration. */
export type WalletExecutionErrorCode =
    | 'INVALID_WALLET_REQUEST'
    | 'WALLET_NETWORK_MISMATCH'
    | 'UNSUPPORTED_WALLET'
    | 'REQUEST_EXPIRED'
    | 'REPLAY_STATE_UNAVAILABLE'
    | 'SIGNING_FAILED'
    | 'SUBMISSION_REJECTED'
    | 'SUBMISSION_AMBIGUOUS'
    | 'CONFIRMATION_FAILED'
    | 'CONFIRMATION_TIMEOUT'
    | 'CONFIRMATION_CANCELLED'
    | 'REFERENCE_STORE_FAILED'
    | 'POST_SUBMISSION_HOOK_FAILED';

/**
 * Protocol-safe wallet execution error.
 *
 * The message is suitable for an application boundary. `details` must remain
 * metadata-only; never place payloads, BOCs, signatures, keys, or vendor bodies
 * in it.
 */
export class WalletExecutionError extends CoreError {
    public readonly retryable: boolean;
    /**
     * Optional secret-free recovery metadata for failures after transport began.
     * It may be persisted/confirmed, but never contains a signed body or BOC.
     */
    public readonly submissionReference: SubmissionReference | null;

    public constructor(
        code: WalletExecutionErrorCode,
        message: string,
        options: {
            readonly retryable?: boolean;
            readonly details?: Readonly<Record<string, string>>;
            readonly cause?: unknown;
            readonly submissionReference?: SubmissionReference;
        } = {},
    ) {
        super(code, message, options.details === undefined ? {} : { ...options.details }, options.cause);
        this.retryable = options.retryable ?? false;
        this.submissionReference = options.submissionReference ?? null;
    }
}
