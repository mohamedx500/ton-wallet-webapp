/**
 * Core Type Definitions for the Universal TON Wallet System
 * 
 * This file contains all shared types used across the wallet system.
 */

import { Address, Cell, MessageRelaxed, OutActionSendMsg } from '@ton/core';

// =============================================================================
// WALLET TYPES
// =============================================================================

/**
 * Supported wallet versions
 */
export type WalletVersion = 'v3r1' | 'v3r2' | 'v4r2' | 'v5r1' | 'highload-v3';

/**
 * Network types
 */
export type NetworkType = 'mainnet' | 'testnet';

/**
 * Key pair for wallet operations
 */
export interface KeyPair {
    publicKey: Buffer;
    secretKey: Buffer;
}

/**
 * Wallet configuration
 */
export interface WalletConfig {
    version: WalletVersion;
    network: NetworkType;
    subwalletId?: number;
    timeout?: number;
}

/**
 * Wallet information after creation/import
 */
export interface WalletInfo {
    version: WalletVersion;
    address: string;
    rawAddress: string;
    publicKey: string;
    keyPair: KeyPair;
    isDeployed: boolean;
    init?: { code: Cell; data: Cell };
}

/**
 * Balance information
 */
export interface BalanceInfo {
    balance: bigint;
    balanceFormatted: string;
    usdValue?: number;
}

// =============================================================================
// TRANSACTION TYPES
// =============================================================================

/**
 * Transaction direction
 */
export type TransactionDirection = 'incoming' | 'outgoing';

/**
 * Transaction status
 */
export type TransactionStatus = 'pending' | 'confirmed' | 'failed';

/**
 * Base transaction parameters
 */
export interface TransactionParams {
    to: string;
    amount: bigint;
    comment?: string;
    bounce?: boolean;
}

/**
 * Jetton transfer parameters
 */
export interface JettonTransferParams extends TransactionParams {
    jettonWalletAddress: string;
    decimals?: number;
    responseDestination?: string;
    forwardAmount?: bigint;
    forwardPayload?: Cell;
}

/**
 * Batch transaction for Highload wallet
 */
export interface BatchTransaction {
    to: string;
    amount: bigint;
    comment?: string;
    bounce?: boolean;
}

/**
 * Transaction result
 */
export interface TransactionResult {
    success: boolean;
    hash?: string;
    seqno?: number | bigint;
    queryId?: bigint;
    error?: string;
}

/**
 * Transaction history item
 */
export interface TransactionHistoryItem {
    hash: string;
    type: TransactionDirection;
    amount: bigint;
    from: string;
    to: string;
    fromRaw?: string;
    toRaw?: string;
    timestamp: number;
    comment?: string;
    jetton?: JettonInfo;
    status: TransactionStatus;
}

// =============================================================================
// JETTON TYPES
// =============================================================================

/**
 * Jetton metadata
 */
export interface JettonInfo {
    address: string;
    symbol: string;
    name: string;
    decimals: number;
    image?: string;
    verified?: boolean;
}

/**
 * Jetton balance
 */
export interface JettonBalance {
    jetton: JettonInfo;
    walletAddress: string;
    balance: bigint;
    balanceFormatted: string;
    usdValue?: number;
}

// =============================================================================
// HIGHLOAD WALLET SPECIFIC TYPES
// =============================================================================

/**
 * Highload query ID configuration
 */
export interface QueryIdState {
    shift: number;
    bitNumber: number;
}

/**
 * Highload batch send options
 */
export interface HighloadBatchOptions {
    messages: OutActionSendMsg[];
    queryId?: QueryIdState;
    timeout?: number;
    createdAt?: number;
    value?: bigint;
}

/**
 * Highload external message options
 */
export interface HighloadExternalMessageOptions {
    message: MessageRelaxed | Cell;
    mode: number;
    queryId: bigint | QueryIdState;
    createdAt: number;
    subwalletId: number;
    timeout: number;
}

// =============================================================================
// SECURITY TYPES
// =============================================================================

/**
 * Encrypted data structure
 */
export interface EncryptedData {
    iv: string;
    data: string;
    salt: string;
    version: number;
}

/**
 * Security configuration
 */
export interface SecurityConfig {
    iterations: number;
    saltBytes: number;
    algorithm: 'AES-GCM';
    keyLength: 256;
}

// =============================================================================
// API/RPC TYPES
// =============================================================================

/**
 * RPC Provider configuration
 */
export interface RpcProviderConfig {
    endpoint: string;
    apiKey?: string;
    timeout?: number;
    retryCount?: number;
    retryDelay?: number;
}

/**
 * TonAPI configuration
 */
export interface TonApiConfig {
    apiKey?: string;
    baseUrl?: string;
    timeout?: number;
}

/**
 * Account info from API
 */
export interface AccountInfo {
    address: string;
    balance: bigint;
    status: 'active' | 'frozen' | 'uninit';
    lastActivity?: number;
}

// =============================================================================
// UI STATE TYPES
// =============================================================================

/**
 * Application settings
 */
export interface AppSettings {
    theme: 'dark' | 'light';
    network: NetworkType;
    walletType: WalletVersion;
    autoRefresh: boolean;
    refreshInterval: number;
}

/**
 * Full application state
 */
export interface AppState {
    wallet: WalletInfo | null;
    mnemonic: string[] | null;
    encryptedMnemonic: EncryptedData | null;
    isAuthenticated: boolean;
    isLoading: boolean;
    balance: bigint;
    transactions: TransactionHistoryItem[];
    jettons: JettonBalance[];
    usdRate: number;
    settings: AppSettings;
}

// =============================================================================
// WALLET V5 SPECIFIC TYPES
// =============================================================================

/**
 * V5 Extension configuration
 */
export interface V5Extension {
    address: Address;
    permissions: number;
}

/**
 * V5 Gasless transaction configuration
 */
export interface GaslessTransactionConfig {
    message: MessageRelaxed;
    relayerAddress: string;
    sponsorAddress?: string;
}

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG = {
    SUBWALLET_ID: 698983191,
    HIGHLOAD_TIMEOUT: 3600,
    RETRY_COUNT: 3,
    RETRY_DELAY: 2000,
    API_TIMEOUT: 30000,
} as const;

/**
 * Jetton constants
 */
export const JETTON_OP_CODES = {
    TRANSFER: 0xf8a7ea5,
    INTERNAL_TRANSFER: 0x178d4519,
    BURN: 0x595f07bc,
    TRANSFER_NOTIFICATION: 0x7362d09c,
} as const;

/**
 * Highload wallet constants
 */
export const HIGHLOAD_CONSTANTS = {
    TIMESTAMP_SIZE: 64,
    TIMEOUT_SIZE: 22,
    MAX_ACTIONS: 254,
    QUERY_ID_SHIFT_MAX: 8191,
    QUERY_ID_BIT_MAX: 1022,
    OP_INTERNAL_TRANSFER: 0xae42e5a4,
} as const;

/**
 * TON Constants
 */
export const TON_CONSTANTS = {
    WORKCHAIN: 0,
    MASTERCHAIN: -1,
    NANO_FACTOR: 1_000_000_000n,
} as const;
