export const SwapApplicationErrorCode = {
    InvalidAssetIdentity: 'INVALID_ASSET_IDENTITY',
    InvalidDecimals: 'INVALID_ASSET_DECIMALS',
    InvalidAmount: 'INVALID_OFFER_AMOUNT',
    InvalidNetwork: 'INVALID_NETWORK',
    UnsupportedWalletVersion: 'UNSUPPORTED_WALLET_VERSION',
    UnsupportedHighloadV3: 'UNSUPPORTED_HIGHLOAD_V3',
    InvalidWalletAddress: 'INVALID_WALLET_ADDRESS',
    WalletAddressMismatch: 'WALLET_ADDRESS_MISMATCH',
    IdenticalAssetPair: 'IDENTICAL_ASSET_PAIR',
    InvalidSlippage: 'INVALID_SLIPPAGE',
    InvalidCorrelationId: 'INVALID_CORRELATION_ID',
    QuoteSessionNetworkMismatch: 'QUOTE_SESSION_NETWORK_MISMATCH',
    QuoteProviderUnavailable: 'QUOTE_PROVIDER_UNAVAILABLE',
    QuoteProviderUnsafe: 'QUOTE_PROVIDER_UNSAFE',
    PasswordRequired: 'PASSWORD_REQUIRED',
    PasswordCancelled: 'PASSWORD_CANCELLED',
    EncryptedAccountInvalid: 'ENCRYPTED_ACCOUNT_INVALID',
    EncryptedAccountMismatch: 'ENCRYPTED_ACCOUNT_MISMATCH',
    DecryptionFailed: 'MNEMONIC_DECRYPTION_FAILED',
    InvalidMnemonic: 'INVALID_MNEMONIC',
    ExecutionNetworkMismatch: 'EXECUTION_NETWORK_MISMATCH',
    ApprovalMismatch: 'SWAP_APPROVAL_MISMATCH',
} as const;

export type SwapApplicationErrorCode =
    (typeof SwapApplicationErrorCode)[keyof typeof SwapApplicationErrorCode];

/** Typed fail-closed error raised before quoting or signing can begin. */
export class SwapApplicationError extends Error {
    public readonly code: SwapApplicationErrorCode;
    public readonly details: Readonly<Record<string, string>>;

    public constructor(
        code: SwapApplicationErrorCode,
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
