export type TonConnectWalletErrorCode =
    | 'INVALID_CONNECT_LINK'
    | 'UNSUPPORTED_PROTOCOL_VERSION'
    | 'INVALID_CONNECT_REQUEST'
    | 'INVALID_MANIFEST'
    | 'MANIFEST_UNAVAILABLE'
    | 'NETWORK_MISMATCH'
    | 'INVALID_APP_REQUEST'
    | 'INVALID_SEND_TRANSACTION'
    | 'TRANSACTION_EXECUTION_FAILED'
    | 'REPLAYED_APP_REQUEST'
    | 'INVALID_SESSION'
    | 'SESSION_CRYPTO_FAILED'
    | 'SESSION_STORAGE_FAILED'
    | 'INVALID_TON_PROOF_REQUEST';

/** Stable wallet-side TON Connect failure that never includes protocol secrets. */
export class TonConnectWalletError extends Error {
    public readonly code: TonConnectWalletErrorCode;
    public readonly details: Readonly<Record<string, string | number | boolean | null>>;

    public constructor(
        code: TonConnectWalletErrorCode,
        message: string,
        details: Readonly<Record<string, string | number | boolean | null>> = {},
        options?: ErrorOptions,
    ) {
        super(message, options);
        this.name = 'TonConnectWalletError';
        this.code = code;
        this.details = Object.freeze({ ...details });
    }
}
