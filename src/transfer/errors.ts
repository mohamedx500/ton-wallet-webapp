export type TransferConstructionErrorCode =
    | 'INVALID_TRANSFER_INTENT'
    | 'INVALID_TRANSFER_AMOUNT'
    | 'INVALID_TRANSFER_COMMENT'
    | 'INVALID_JETTON_QUERY_ID';

/** Stable, secret-free failure raised before a transfer reaches wallet signing. */
export class TransferConstructionError extends Error {
    public readonly code: TransferConstructionErrorCode;
    public readonly details: Readonly<Record<string, string>>;

    public constructor(
        code: TransferConstructionErrorCode,
        message: string,
        details: Record<string, string> = {},
        cause?: unknown,
    ) {
        super(message, cause === undefined ? undefined : { cause });
        this.name = new.target.name;
        this.code = code;
        this.details = Object.freeze({ ...details });
    }
}
