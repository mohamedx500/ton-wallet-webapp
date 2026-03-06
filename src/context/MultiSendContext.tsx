/**
 * Multi-Send Context & Reducer
 *
 * Provides centralized state management for the Multi-Send feature using
 * useReducer. Handles row CRUD, unification (with auto-sorting logic),
 * validation recomputation, and execution phase tracking.
 */

import React, {
    createContext,
    useContext,
    useReducer,
    useCallback,
    useMemo,
    useEffect,
    type ReactNode,
} from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useWallet } from './WalletContext';
import type {
    MultiSendState,
    MultiSendAction,
    TransferRow,
    CoinInfo,
    ValidationState,
    CommentSortingMode,
    AddressStatus,
    RowStatus,
    ExecutionPhase,
    BatchProgress,
    BatchStatus,
    SendMode,
    HighloadMode,
} from '../types/multisend';
import { NATIVE_TON } from '../types/multisend';
import type { WalletVersion } from '../types';

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Convert a 0-based index to an Excel-style alphabetic label.
 * 0 → "A", 25 → "Z", 26 → "AA", 27 → "AB", ...
 */
function indexToAlpha(index: number): string {
    let result = '';
    let n = index;
    while (n >= 0) {
        result = String.fromCharCode((n % 26) + 65) + result;
        n = Math.floor(n / 26) - 1;
    }
    return result;
}

/**
 * Create a fresh empty transfer row with a unique ID.
 */
function createEmptyRow(): TransferRow {
    return {
        id: uuidv4(),
        address: '',
        resolvedAddress: null,
        addressStatus: 'idle',
        amount: '',
        comment: '',
        coin: { ...NATIVE_TON },
        rowStatus: 'draft',
    };
}

/**
 * Apply the comment unification to all rows based on current settings.
 * Returns a new rows array (immutable).
 */
function applyCommentUnification(
    rows: TransferRow[],
    base: string,
    sorting: CommentSortingMode
): TransferRow[] {
    return rows.map((row, i) => {
        let comment: string;
        switch (sorting) {
            case 'numeric':
                comment = base ? `${base} ${i + 1}` : `${i + 1}`;
                break;
            case 'alpha':
                comment = base ? `${base} ${indexToAlpha(i)}` : indexToAlpha(i);
                break;
            case 'none':
            default:
                comment = base;
                break;
        }
        return { ...row, comment };
    });
}

/**
 * Basic TON address format check.
 * Accepts EQ, UQ, 0: prefix patterns and .ton domains.
 */
function isValidAddressFormat(address: string): boolean {
    if (!address) return false;
    const trimmed = address.trim();
    // .ton domain — considered valid format (needs DNS resolution)
    if (trimmed.endsWith('.ton')) return true;
    // Raw address: 0:<hex64>
    if (/^0:[a-fA-F0-9]{64}$/.test(trimmed)) return true;
    // User-friendly: EQ or UQ followed by base64url (48 chars)
    if (/^(EQ|UQ|kQ|0Q)[A-Za-z0-9_-]{46}$/.test(trimmed)) return true;
    return false;
}

/**
 * Recompute aggregated validation from current rows.
 */
function revalidateRows(rows: TransferRow[]): ValidationState {
    const errors: string[] = [];
    let validCount = 0;

    for (const row of rows) {
        const addressOk = row.addressStatus === 'valid' || isValidAddressFormat(row.address);
        const amountOk = row.amount !== '' && Number(row.amount) > 0 && !isNaN(Number(row.amount));
        if (addressOk && amountOk) {
            validCount++;
        }
    }

    if (rows.length === 0) {
        errors.push('Add at least one recipient.');
    }

    return {
        validCount,
        totalCount: rows.length,
        balanceSufficient: true, // Will be updated externally after balance check
        errors,
    };
}

// =============================================================================
// INITIAL STATE
// =============================================================================

const INITIAL_STATE: MultiSendState = {
    walletType: 'highload-v3',
    mode: 'batch',
    highloadMode: 'batches',
    rows: [createEmptyRow(), createEmptyRow(), createEmptyRow()],
    unification: {
        comment: { base: '', sorting: 'none' },
        amount: { value: '' },
        currency: { coin: null },
    },
    validation: {
        validCount: 0,
        totalCount: 3,
        balanceSufficient: true,
        errors: [],
    },
    execution: {
        phase: 'idle',
        batchProgress: null,
        globalError: null,
        txHashes: {},
    },
    isOpen: false,
};

// =============================================================================
// REDUCER
// =============================================================================

function multiSendReducer(state: MultiSendState, action: MultiSendAction): MultiSendState {
    switch (action.type) {
        // ── Modal ──────────────────────────────────────────────────────────
        case 'OPEN_MODAL':
            return { ...state, isOpen: true };

        case 'CLOSE_MODAL':
            return { ...state, isOpen: false };

        // ── Wallet / Mode ─────────────────────────────────────────────────
        case 'SET_WALLET_TYPE':
            return { ...state, walletType: action.payload };

        case 'SET_MODE':
            return { ...state, mode: action.payload };

        case 'SET_HIGHLOAD_MODE':
            return { ...state, highloadMode: action.payload };

        // ── Row CRUD ──────────────────────────────────────────────────────
        case 'ADD_ROW': {
            const newRows = [...state.rows, createEmptyRow()];
            return {
                ...state,
                rows: newRows,
                validation: revalidateRows(newRows),
            };
        }

        case 'REMOVE_ROW': {
            const newRows = state.rows.filter((r) => r.id !== action.payload);
            // Ensure at least one row remains
            const finalRows = newRows.length === 0 ? [createEmptyRow()] : newRows;
            return {
                ...state,
                rows: finalRows,
                validation: revalidateRows(finalRows),
            };
        }

        case 'UPDATE_ROW_FIELD': {
            const { id, field, value } = action.payload;
            const newRows = state.rows.map((row) => {
                if (row.id !== id) return row;
                const updated = { ...row, [field]: value };
                // Reset address status when address changes
                if (field === 'address') {
                    updated.addressStatus = 'idle';
                    updated.resolvedAddress = null;
                    updated.error = undefined;
                }
                return updated;
            });
            return {
                ...state,
                rows: newRows,
                validation: revalidateRows(newRows),
            };
        }

        case 'UPDATE_ROW_COIN': {
            const { id, coin } = action.payload;
            const newRows = state.rows.map((row) =>
                row.id === id ? { ...row, coin } : row
            );
            return {
                ...state,
                rows: newRows,
                validation: revalidateRows(newRows),
            };
        }

        case 'SET_ROW_ADDRESS_STATUS': {
            const { id, status, resolvedAddress, error } = action.payload;
            const newRows = state.rows.map((row) => {
                if (row.id !== id) return row;
                return {
                    ...row,
                    addressStatus: status,
                    resolvedAddress: resolvedAddress ?? row.resolvedAddress,
                    error: error ?? row.error,
                };
            });
            return {
                ...state,
                rows: newRows,
                validation: revalidateRows(newRows),
            };
        }

        case 'SET_ROW_STATUS': {
            const { id, status, error, queryId, txHash } = action.payload;
            const newRows = state.rows.map((row) => {
                if (row.id !== id) return row;
                return { ...row, rowStatus: status, error, queryId };
            });
            const newTxHashes = txHash
                ? { ...state.execution.txHashes, [id]: txHash }
                : state.execution.txHashes;
            return {
                ...state,
                rows: newRows,
                execution: { ...state.execution, txHashes: newTxHashes },
            };
        }

        // ── Unify Comment ─────────────────────────────────────────────────
        case 'SET_UNIFY_COMMENT_BASE':
            return {
                ...state,
                unification: {
                    ...state.unification,
                    comment: { ...state.unification.comment, base: action.payload },
                },
            };

        case 'SET_UNIFY_COMMENT_SORTING':
            return {
                ...state,
                unification: {
                    ...state.unification,
                    comment: { ...state.unification.comment, sorting: action.payload },
                },
            };

        case 'APPLY_UNIFY_COMMENT': {
            const { base, sorting } = state.unification.comment;
            const newRows = applyCommentUnification(state.rows, base, sorting);
            return { ...state, rows: newRows };
        }

        // ── Unify Amount ──────────────────────────────────────────────────
        case 'SET_UNIFY_AMOUNT':
            return {
                ...state,
                unification: {
                    ...state.unification,
                    amount: { value: action.payload },
                },
            };

        case 'APPLY_UNIFY_AMOUNT': {
            const amountValue = state.unification.amount.value;
            const newRows = state.rows.map((row) => ({ ...row, amount: amountValue }));
            return {
                ...state,
                rows: newRows,
                validation: revalidateRows(newRows),
            };
        }

        // ── Unify Currency ────────────────────────────────────────────────
        case 'SET_UNIFY_CURRENCY':
            return {
                ...state,
                unification: {
                    ...state.unification,
                    currency: { coin: action.payload },
                },
            };

        case 'APPLY_UNIFY_CURRENCY': {
            const coin = state.unification.currency.coin;
            if (!coin) return state;
            const newRows = state.rows.map((row) => ({ ...row, coin }));
            return { ...state, rows: newRows };
        }

        // ── CSV Import ────────────────────────────────────────────────────
        case 'IMPORT_ROWS': {
            const imported: TransferRow[] = action.payload.map((raw) => ({
                id: uuidv4(),
                address: raw.address,
                resolvedAddress: null,
                addressStatus: 'idle' as const,
                amount: raw.amount,
                comment: raw.comment,
                coin: raw.coin,
                rowStatus: 'draft' as const,
            }));
            const newRows = [...state.rows, ...imported];
            return {
                ...state,
                rows: newRows,
                validation: revalidateRows(newRows),
            };
        }

        // ── Execution ─────────────────────────────────────────────────────
        case 'SET_EXECUTION_PHASE':
            return {
                ...state,
                execution: { ...state.execution, phase: action.payload },
            };

        case 'SET_BATCH_PROGRESS':
            return {
                ...state,
                execution: { ...state.execution, batchProgress: action.payload },
            };

        case 'UPDATE_BATCH_STATUS': {
            const { index, status, txHash, error } = action.payload;
            if (!state.execution.batchProgress) return state;
            const newStatuses = state.execution.batchProgress.batchStatuses.map((bs) => {
                if (bs.index !== index) return bs;
                return { ...bs, status, txHash, error };
            });
            return {
                ...state,
                execution: {
                    ...state.execution,
                    batchProgress: {
                        ...state.execution.batchProgress,
                        batchStatuses: newStatuses,
                        currentBatch: status === 'success' || status === 'failed'
                            ? Math.min(index + 1, state.execution.batchProgress.totalBatches - 1)
                            : state.execution.batchProgress.currentBatch,
                    },
                },
            };
        }

        case 'SET_GLOBAL_ERROR':
            return {
                ...state,
                execution: {
                    ...state.execution,
                    globalError: action.payload,
                    phase: action.payload ? 'error' : state.execution.phase,
                },
            };

        case 'RESET_EXECUTION':
            return {
                ...state,
                execution: {
                    phase: 'idle',
                    batchProgress: null,
                    globalError: null,
                    txHashes: {},
                },
                rows: state.rows.map((row) => ({
                    ...row,
                    rowStatus: 'draft' as const,
                    error: undefined,
                    queryId: undefined,
                })),
            };

        // ── Revalidate ────────────────────────────────────────────────────
        case 'REVALIDATE':
            return { ...state, validation: revalidateRows(state.rows) };

        default:
            return state;
    }
}

// =============================================================================
// CONTEXT
// =============================================================================

interface MultiSendContextValue {
    state: MultiSendState;
    dispatch: React.Dispatch<MultiSendAction>;

    // Convenience action creators
    openModal: () => void;
    closeModal: () => void;
    setWalletType: (wt: WalletVersion) => void;
    setMode: (m: SendMode) => void;
    setHighloadMode: (m: HighloadMode) => void;
    addRow: () => void;
    removeRow: (id: string) => void;
    updateRowField: (id: string, field: 'address' | 'amount' | 'comment', value: string) => void;
    updateRowCoin: (id: string, coin: CoinInfo) => void;
    setRowAddressStatus: (id: string, status: AddressStatus, resolvedAddress?: string | null, error?: string) => void;
    setRowStatus: (id: string, status: RowStatus, error?: string, queryId?: bigint, txHash?: string) => void;
    setUnifyCommentBase: (base: string) => void;
    setUnifyCommentSorting: (sorting: CommentSortingMode) => void;
    applyUnifyComment: () => void;
    setUnifyAmount: (value: string) => void;
    applyUnifyAmount: () => void;
    setUnifyCurrency: (coin: CoinInfo) => void;
    applyUnifyCurrency: () => void;
    setExecutionPhase: (phase: ExecutionPhase) => void;
    setBatchProgress: (progress: BatchProgress) => void;
    updateBatchStatus: (index: number, status: BatchStatus['status'], txHash?: string, error?: string) => void;
    setGlobalError: (error: string | null) => void;
    resetExecution: () => void;

    // Computed values
    totalAmount: string;
    batchCount: number;
    allRowsValid: boolean;
    canSend: boolean;
}

const MultiSendContext = createContext<MultiSendContextValue | undefined>(undefined);

// =============================================================================
// PROVIDER
// =============================================================================

export function MultiSendProvider({ children }: { children: ReactNode }) {
    const { walletType } = useWallet();
    const [state, dispatch] = useReducer(multiSendReducer, INITIAL_STATE);

    // ── Action creators ──────────────────────────────────────────────────
    const openModal = useCallback(() => dispatch({ type: 'OPEN_MODAL' }), []);
    const closeModal = useCallback(() => dispatch({ type: 'CLOSE_MODAL' }), []);
    const setWalletType = useCallback((wt: WalletVersion) => dispatch({ type: 'SET_WALLET_TYPE', payload: wt }), []);
    const setMode = useCallback((m: SendMode) => dispatch({ type: 'SET_MODE', payload: m }), []);
    const setHighloadMode = useCallback((m: HighloadMode) => dispatch({ type: 'SET_HIGHLOAD_MODE', payload: m }), []);

    // Sync active wallet type from global WalletContext
    useEffect(() => {
        if (walletType) {
            setWalletType(walletType as WalletVersion);
            // W5 strictly requires batches mode
            if (walletType === 'v5r1') {
                setHighloadMode('batches');
            }
        }
    }, [walletType, setWalletType, setHighloadMode]);

    const addRow = useCallback(() => dispatch({ type: 'ADD_ROW' }), []);
    const removeRow = useCallback((id: string) => dispatch({ type: 'REMOVE_ROW', payload: id }), []);

    const updateRowField = useCallback(
        (id: string, field: 'address' | 'amount' | 'comment', value: string) =>
            dispatch({ type: 'UPDATE_ROW_FIELD', payload: { id, field, value } }),
        []
    );

    const updateRowCoin = useCallback(
        (id: string, coin: CoinInfo) => dispatch({ type: 'UPDATE_ROW_COIN', payload: { id, coin } }),
        []
    );

    const setRowAddressStatus = useCallback(
        (id: string, status: AddressStatus, resolvedAddress?: string | null, error?: string) =>
            dispatch({ type: 'SET_ROW_ADDRESS_STATUS', payload: { id, status, resolvedAddress, error } }),
        []
    );

    const setRowStatus = useCallback(
        (id: string, status: RowStatus, error?: string, queryId?: bigint, txHash?: string) =>
            dispatch({ type: 'SET_ROW_STATUS', payload: { id, status, error, queryId, txHash } }),
        []
    );

    const setUnifyCommentBase = useCallback((base: string) => dispatch({ type: 'SET_UNIFY_COMMENT_BASE', payload: base }), []);
    const setUnifyCommentSorting = useCallback((sorting: CommentSortingMode) => dispatch({ type: 'SET_UNIFY_COMMENT_SORTING', payload: sorting }), []);
    const applyUnifyComment = useCallback(() => dispatch({ type: 'APPLY_UNIFY_COMMENT' }), []);
    const setUnifyAmount = useCallback((value: string) => dispatch({ type: 'SET_UNIFY_AMOUNT', payload: value }), []);
    const applyUnifyAmount = useCallback(() => dispatch({ type: 'APPLY_UNIFY_AMOUNT' }), []);
    const setUnifyCurrency = useCallback((coin: CoinInfo) => dispatch({ type: 'SET_UNIFY_CURRENCY', payload: coin }), []);
    const applyUnifyCurrency = useCallback(() => dispatch({ type: 'APPLY_UNIFY_CURRENCY' }), []);

    const setExecutionPhase = useCallback((phase: ExecutionPhase) => dispatch({ type: 'SET_EXECUTION_PHASE', payload: phase }), []);
    const setBatchProgress = useCallback((progress: BatchProgress) => dispatch({ type: 'SET_BATCH_PROGRESS', payload: progress }), []);
    const updateBatchStatus = useCallback(
        (index: number, status: BatchStatus['status'], txHash?: string, error?: string) =>
            dispatch({ type: 'UPDATE_BATCH_STATUS', payload: { index, status, txHash, error } }),
        []
    );
    const setGlobalError = useCallback((error: string | null) => dispatch({ type: 'SET_GLOBAL_ERROR', payload: error }), []);
    const resetExecution = useCallback(() => dispatch({ type: 'RESET_EXECUTION' }), []);

    // ── Computed values ──────────────────────────────────────────────────
    const totalAmount = useMemo(() => {
        // Group by coin symbol and sum amounts per coin
        const totals: Record<string, number> = {};
        for (const row of state.rows) {
            const amt = parseFloat(row.amount);
            if (isNaN(amt) || amt <= 0) continue;
            const key = row.coin.symbol;
            totals[key] = (totals[key] || 0) + amt;
        }
        // Format as "30.0000 TON" or "30 TON + 100 USDT"
        const parts = Object.entries(totals).map(
            ([symbol, amount]) => `${amount % 1 === 0 ? amount.toFixed(0) : amount.toFixed(4)} ${symbol}`
        );
        return parts.length > 0 ? parts.join(' + ') : '0 TON';
    }, [state.rows]);

    const batchCount = useMemo(() => {
        const validRows = state.rows.filter((r) => {
            const addressOk = r.addressStatus === 'valid' || r.address.trim().length > 0;
            const amountOk = r.amount !== '' && Number(r.amount) > 0;
            return addressOk && amountOk;
        });
        return Math.max(1, Math.ceil(validRows.length / 254));
    }, [state.rows]);

    const allRowsValid = useMemo(
        () => state.validation.validCount === state.validation.totalCount && state.validation.totalCount > 0,
        [state.validation]
    );

    const canSend = useMemo(
        () => allRowsValid && state.validation.balanceSufficient && state.execution.phase === 'idle',
        [allRowsValid, state.validation.balanceSufficient, state.execution.phase]
    );

    // ── Context value ────────────────────────────────────────────────────
    const value = useMemo<MultiSendContextValue>(
        () => ({
            state,
            dispatch,
            openModal,
            closeModal,
            setWalletType,
            setMode,
            setHighloadMode,
            addRow,
            removeRow,
            updateRowField,
            updateRowCoin,
            setRowAddressStatus,
            setRowStatus,
            setUnifyCommentBase,
            setUnifyCommentSorting,
            applyUnifyComment,
            setUnifyAmount,
            applyUnifyAmount,
            setUnifyCurrency,
            applyUnifyCurrency,
            setExecutionPhase,
            setBatchProgress,
            updateBatchStatus,
            setGlobalError,
            resetExecution,
            totalAmount,
            batchCount,
            allRowsValid,
            canSend,
        }),
        [
            state,
            openModal,
            closeModal,
            setWalletType,
            setMode,
            setHighloadMode,
            addRow,
            removeRow,
            updateRowField,
            updateRowCoin,
            setRowAddressStatus,
            setRowStatus,
            setUnifyCommentBase,
            setUnifyCommentSorting,
            applyUnifyComment,
            setUnifyAmount,
            applyUnifyAmount,
            setUnifyCurrency,
            applyUnifyCurrency,
            setExecutionPhase,
            setBatchProgress,
            updateBatchStatus,
            setGlobalError,
            resetExecution,
            totalAmount,
            batchCount,
            allRowsValid,
            canSend,
        ]
    );

    return (
        <MultiSendContext.Provider value={value}>
            {children}
        </MultiSendContext.Provider>
    );
}

// =============================================================================
// HOOK
// =============================================================================

/**
 * Access the MultiSend context. Must be used within a `<MultiSendProvider>`.
 */
export function useMultiSend(): MultiSendContextValue {
    const ctx = useContext(MultiSendContext);
    if (!ctx) {
        throw new Error('useMultiSend must be used within a <MultiSendProvider>');
    }
    return ctx;
}

// Re-export helper for external use (e.g., in services)
export { indexToAlpha, isValidAddressFormat };
