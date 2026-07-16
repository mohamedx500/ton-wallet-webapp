/**
 * Multi-Send Type Definitions
 *
 * All strict TypeScript interfaces for the TON Multi-Send feature.
 * Covers UI state, transfer rows, unification, validation, execution tracking,
 * and blockchain integration types.
 */

import type { WalletVersion } from './index';

// =============================================================================
// COIN / TOKEN
// =============================================================================

/**
 * Represents a selectable coin or Jetton token.
 */
export interface CoinInfo {
    /** Display symbol, e.g. "TON", "USDT", "NOT" */
    symbol: string;
    /** Human-readable name */
    name: string;
    /** Jetton master contract address. `null` for native TON. */
    masterAddress: string | null;
    /** Token decimals (9 for TON, 6 for USDT, etc.) */
    decimals: number;
    /** URL or data-uri for the token icon */
    icon?: string;
    /** Whether this is native TON (not a Jetton) */
    isNative: boolean;
    /** Pre-fetched sender's Jetton wallet address (from TonAPI). Bypasses redundant API call in MultiSendService. */
    jettonWalletAddress?: string;
}

/** The default native TON coin */
export const NATIVE_TON: CoinInfo = {
    symbol: 'Gram',
    name: 'Gram',
    masterAddress: null,
    decimals: 9,
    isNative: true,
    icon: 'https://assets.dedust.io/images/ton.webp',
};

// =============================================================================
// ADDRESS RESOLUTION
// =============================================================================

/** Status of an address field during validation / DNS resolution */
export type AddressStatus = 'idle' | 'resolving' | 'valid' | 'invalid';

// =============================================================================
// TRANSFER ROW
// =============================================================================

/** Status of an individual transfer row during execution */
export type RowStatus = 'draft' | 'valid' | 'sending' | 'success' | 'failed';

/**
 * A single recipient row in the multi-send form.
 */
export interface TransferRow {
    /** Unique identifier (uuid) */
    id: string;
    /** Raw user input — may be an EQ/UQ address or a .ton domain */
    address: string;
    /** Resolved wallet address after DNS lookup. `null` if not yet resolved. */
    resolvedAddress: string | null;
    /** Current address validation / resolution status */
    addressStatus: AddressStatus;
    /** Transfer amount as a string (user-facing decimal, e.g. "10.5") */
    amount: string;
    /** Optional memo / comment attached to the transfer */
    comment: string;
    /** Selected coin or Jetton for this row */
    coin: CoinInfo;
    /** Lifecycle status of this row */
    rowStatus: RowStatus;
    /** Human-readable error message, if any */
    error?: string;
    /** Assigned Highload Query ID for failure mapping (set during dispatch) */
    queryId?: bigint;
}

// =============================================================================
// UNIFICATION
// =============================================================================

/** Comment sorting mode for the unification tool */
export type CommentSortingMode = 'none' | 'numeric' | 'alpha';

/**
 * State for the comment unification sub-section.
 */
export interface UnifyCommentState {
    /** Base comment text (e.g. "Salary") */
    base: string;
    /** Active sorting mode */
    sorting: CommentSortingMode;
}

/**
 * State for the amount unification sub-section.
 */
export interface UnifyAmountState {
    /** The amount value to apply to all rows */
    value: string;
}

/**
 * State for the currency unification sub-section.
 */
export interface UnifyCurrencyState {
    /** The coin to apply to all rows. `null` if none selected. */
    coin: CoinInfo | null;
}

/**
 * Combined unification panel state.
 */
export interface UnificationState {
    comment: UnifyCommentState;
    amount: UnifyAmountState;
    currency: UnifyCurrencyState;
}

// =============================================================================
// VALIDATION
// =============================================================================

/**
 * Aggregated validation state across all rows.
 */
export interface ValidationState {
    /** Number of rows that pass all validation checks */
    validCount: number;
    /** Total number of rows */
    totalCount: number;
    /** Whether balance is sufficient for the total transfer + fees */
    balanceSufficient: boolean;
    /** Human-readable validation errors (global level) */
    errors: string[];
}

// =============================================================================
// EXECUTION / PROGRESS
// =============================================================================

/** High-level execution phase */
export type ExecutionPhase =
    | 'idle'
    | 'validating'
    | 'resolving_dns'
    | 'resolving_jettons'
    | 'checking_balance'
    | 'sending'
    | 'complete'
    | 'error';

/**
 * Tracks progress of batch dispatch (primarily for W5 sequential batching).
 */
export interface BatchProgress {
    /** Current batch index (0-based) */
    currentBatch: number;
    /** Total number of batches */
    totalBatches: number;
    /** Status of each batch */
    batchStatuses: BatchStatus[];
}

/** Status of a single batch */
export interface BatchStatus {
    /** Batch index */
    index: number;
    /** Batch status */
    status: 'pending' | 'sending' | 'waiting_confirmation' | 'success' | 'failed';
    /** TX hash if available */
    txHash?: string;
    /** Error message if failed */
    error?: string;
    /** Row IDs included in this batch */
    rowIds: string[];
}

/**
 * Overall execution state.
 */
export interface ExecutionState {
    /** Current phase of the execution pipeline */
    phase: ExecutionPhase;
    /** Batch progress tracker (populated during send phase) */
    batchProgress: BatchProgress | null;
    /** Global error message */
    globalError: string | null;
    /** Map of row ID → TX hash for successfully sent rows */
    txHashes: Record<string, string>;
}

// =============================================================================
// MULTI-SEND MODE
// =============================================================================

/** Top-level sending mode */
export type SendMode = 'batch' | 'single';

/** Sub-mode for Highload V3 */
export type HighloadMode = 'batches' | 'individual';

// =============================================================================
// MULTI-SEND STATE (ROOT)
// =============================================================================

/**
 * Root state shape for the entire Multi-Send feature.
 */
export interface MultiSendState {
    /** Active wallet version */
    walletType: WalletVersion;
    /** Batch vs Single mode */
    mode: SendMode;
    /** Highload sub-mode (only relevant when walletType === 'highload-v3') */
    highloadMode: HighloadMode;
    /** The array of transfer rows */
    rows: TransferRow[];
    /** Unification panel state */
    unification: UnificationState;
    /** Aggregated validation */
    validation: ValidationState;
    /** Execution / progress tracking */
    execution: ExecutionState;
    /** Whether the multi-send modal is open */
    isOpen: boolean;
}

// =============================================================================
// REDUCER ACTIONS
// =============================================================================

export type MultiSendAction =
    | { type: 'OPEN_MODAL' }
    | { type: 'CLOSE_MODAL' }
    | { type: 'SET_WALLET_TYPE'; payload: WalletVersion }
    | { type: 'SET_MODE'; payload: SendMode }
    | { type: 'SET_HIGHLOAD_MODE'; payload: HighloadMode }
    | { type: 'ADD_ROW' }
    | { type: 'REMOVE_ROW'; payload: string }
    | { type: 'UPDATE_ROW_FIELD'; payload: { id: string; field: keyof Pick<TransferRow, 'address' | 'amount' | 'comment'>; value: string } }
    | { type: 'UPDATE_ROW_COIN'; payload: { id: string; coin: CoinInfo } }
    | { type: 'SET_ROW_ADDRESS_STATUS'; payload: { id: string; status: AddressStatus; resolvedAddress?: string | null; error?: string } }
    | { type: 'SET_ROW_STATUS'; payload: { id: string; status: RowStatus; error?: string; queryId?: bigint; txHash?: string } }
    | { type: 'SET_UNIFY_COMMENT_BASE'; payload: string }
    | { type: 'SET_UNIFY_COMMENT_SORTING'; payload: CommentSortingMode }
    | { type: 'APPLY_UNIFY_COMMENT' }
    | { type: 'SET_UNIFY_AMOUNT'; payload: string }
    | { type: 'APPLY_UNIFY_AMOUNT' }
    | { type: 'SET_UNIFY_CURRENCY'; payload: CoinInfo }
    | { type: 'APPLY_UNIFY_CURRENCY' }
    | { type: 'IMPORT_ROWS'; payload: Omit<TransferRow, 'id' | 'resolvedAddress' | 'addressStatus' | 'rowStatus'>[] }
    | { type: 'SET_EXECUTION_PHASE'; payload: ExecutionPhase }
    | { type: 'SET_BATCH_PROGRESS'; payload: BatchProgress }
    | { type: 'UPDATE_BATCH_STATUS'; payload: { index: number; status: BatchStatus['status']; txHash?: string; error?: string } }
    | { type: 'SET_GLOBAL_ERROR'; payload: string | null }
    | { type: 'RESET_EXECUTION' }
    | { type: 'REVALIDATE' };

// =============================================================================
// CSV IMPORT
// =============================================================================

/**
 * Shape of a parsed CSV row before it becomes a TransferRow.
 */
export interface CSVTransferRow {
    address: string;
    amount: string;
    comment?: string;
    coin?: string;
}

// =============================================================================
// SERVICE TYPES
// =============================================================================

/**
 * Prepared payload chunk ready for blockchain dispatch.
 */
export interface PreparedChunk {
    /** Index of this chunk */
    index: number;
    /** Transfer rows in this chunk (max 254) */
    rows: TransferRow[];
    /** Assigned Query ID for Highload (set during preparation) */
    queryId?: bigint;
}

/**
 * Result of a single chunk dispatch.
 */
export interface ChunkResult {
    /** Chunk index */
    chunkIndex: number;
    /** Whether the dispatch succeeded */
    success: boolean;
    /** TX hash if successful */
    txHash?: string;
    /** Error message if failed */
    error?: string;
    /** Query ID used (Highload only) */
    queryId?: bigint;
}
