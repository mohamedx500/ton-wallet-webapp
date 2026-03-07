/**
 * BatchProgressOverlay Component
 *
 * Modal overlay shown during multi-send execution.
 * - W5: Animated segmented progress bar with per-batch status,
 *   5s countdown timer, and "Batch 1/3 Sent… Waiting…" labels.
 * - Highload V3: Single dispatch spinner with completion summary.
 * - Post-send: TX hash links to TON explorer, per-row status.
 */

import React, { useMemo } from 'react';
import {
    X,
    CheckCircle2,
    XCircle,
    Loader2,
    Clock,
    ExternalLink,
    Send,
    AlertTriangle,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useMultiSend } from '../../context/MultiSendContext';

interface BatchProgressOverlayProps {
    /** Close the overlay (only allowed after completion/error) */
    onClose: () => void;
}

/** TON explorer URL builder */
function getExplorerUrl(txHash: string, network: string): string {
    const base = network === 'testnet'
        ? 'https://testnet.tonviewer.com'
        : 'https://tonviewer.com';
    return `${base}/transaction/${txHash}`;
}

/** Status icon for a batch */
const BatchStatusIcon: React.FC<{ status: string }> = ({ status }) => {
    switch (status) {
        case 'success':
            return <CheckCircle2 className="w-5 h-5 text-emerald-400" />;
        case 'failed':
            return <XCircle className="w-5 h-5 text-red-400" />;
        case 'sending':
            return <Loader2 className="w-5 h-5 text-blue-400 animate-spin" />;
        case 'waiting_confirmation':
            return <Clock className="w-5 h-5 text-yellow-400 animate-pulse" />;
        default:
            return <div className="w-5 h-5 rounded-full border-2 border-gray-600" />;
    }
};

/** Status label text */
function getStatusLabel(status: string, index: number, total: number): string {
    switch (status) {
        case 'pending':
            return `Batch ${index + 1}/${total} — Pending`;
        case 'sending':
            return `Sending Batch ${index + 1} of ${total}...`;
        case 'waiting_confirmation':
            return `Batch ${index + 1}/${total} — Waiting for confirmation...`;
        case 'success':
            return `Batch ${index + 1}/${total} — Sent`;
        case 'failed':
            return `Batch ${index + 1}/${total} — Failed`;
        default:
            return `Batch ${index + 1}/${total}`;
    }
}

const BatchProgressOverlay: React.FC<BatchProgressOverlayProps> = ({ onClose }) => {
    const { state, resetExecution } = useMultiSend();
    const { execution, walletType, rows } = state;
    const { phase, batchProgress, globalError, txHashes } = execution;

    const isHighload = walletType === 'highload-v3';
    const isComplete = phase === 'complete';
    const isError = phase === 'error';
    const canClose = isComplete || isError || phase === 'idle';

    const handleDone = () => {
        resetExecution();
        onClose();
    };

    // Count row statuses
    const rowCounts = useMemo(() => {
        let success = 0;
        let failed = 0;
        let sending = 0;
        for (const row of rows) {
            if (row.rowStatus === 'success') success++;
            else if (row.rowStatus === 'failed') failed++;
            else if (row.rowStatus === 'sending') sending++;
        }
        return { success, failed, sending, total: rows.length };
    }, [rows]);

    // Progress percentage for the progress bar
    const progressPercent = useMemo(() => {
        if (!batchProgress) return 0;
        const completed = batchProgress.batchStatuses.filter(
            (b) => b.status === 'success' || b.status === 'failed'
        ).length;
        return Math.round((completed / batchProgress.totalBatches) * 100);
    }, [batchProgress]);

    // Collect all TX hashes
    const allTxHashes = useMemo(() => {
        const hashes: Array<{ label: string; hash: string }> = [];
        if (batchProgress) {
            for (const bs of batchProgress.batchStatuses) {
                if (bs.txHash) {
                    hashes.push({ label: `Batch ${bs.index + 1}`, hash: bs.txHash });
                }
            }
        }
        // Also from individual row TX hashes
        for (const [rowId, hash] of Object.entries(txHashes)) {
            if (!hashes.find((h) => h.hash === hash)) {
                const row = rows.find((r) => r.id === rowId);
                const label = row ? `→ ${row.address.slice(0, 10)}…` : rowId;
                hashes.push({ label, hash });
            }
        }
        return hashes;
    }, [batchProgress, txHashes, rows]);

    return (
        <div className="absolute inset-0 z-60 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div
                className={cn(
                    'w-full max-w-lg mx-4 rounded-2xl border bg-gray-950/95',
                    'border-gray-700/50 shadow-2xl shadow-black/50',
                    'flex flex-col overflow-hidden animate-scale-in'
                )}
            >
                {/* ── Header ──────────────────────────────────────────── */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800/60">
                    <div className="flex items-center gap-2">
                        <Send className="w-5 h-5 text-blue-400" />
                        <h3 className="text-base font-bold text-white">
                            {isComplete
                                ? 'Transaction Complete'
                                : isError
                                    ? 'Transaction Error'
                                    : 'Sending Transactions...'}
                        </h3>
                    </div>
                    {canClose && (
                        <button
                            type="button"
                            onClick={onClose}
                            className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 hover:text-white hover:bg-gray-800 transition-all"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    )}
                </div>

                {/* ── Body ────────────────────────────────────────────── */}
                <div className="px-5 py-5 flex flex-col gap-5 max-h-[400px] overflow-y-auto no-scrollbar">

                    {/* Global Progress Bar */}
                    <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between text-xs text-gray-400">
                            <span>
                                {isHighload ? 'Dispatching all batches…' : `Sequential batch processing`}
                            </span>
                            <span className="font-mono">{progressPercent}%</span>
                        </div>
                        <div className="w-full h-2 rounded-full bg-gray-800 overflow-hidden">
                            <div
                                className={cn(
                                    'h-full rounded-full transition-all duration-700 ease-out',
                                    isError
                                        ? 'bg-red-500'
                                        : isComplete
                                            ? 'bg-emerald-500'
                                            : 'bg-gradient-to-r from-blue-500 to-emerald-500'
                                )}
                                style={{ width: `${progressPercent}%` }}
                            />
                        </div>
                    </div>

                    {/* Per-Batch Status List (W5 sequential) */}
                    {batchProgress && batchProgress.batchStatuses.length > 0 && (
                        <div className="flex flex-col gap-2">
                            {batchProgress.batchStatuses.map((bs) => (
                                <div
                                    key={bs.index}
                                    className={cn(
                                        'flex items-center gap-3 px-3 py-2 rounded-xl border transition-all duration-300',
                                        bs.status === 'success'
                                            ? 'border-emerald-500/20 bg-emerald-500/5'
                                            : bs.status === 'failed'
                                                ? 'border-red-500/20 bg-red-500/5'
                                                : bs.status === 'sending' || bs.status === 'waiting_confirmation'
                                                    ? 'border-blue-500/20 bg-blue-500/5'
                                                    : 'border-gray-700/30 bg-gray-900/30'
                                    )}
                                >
                                    <BatchStatusIcon status={bs.status} />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm text-gray-200 font-medium">
                                            {getStatusLabel(bs.status, bs.index, batchProgress.totalBatches)}
                                        </p>
                                        {bs.error && (
                                            <p className="text-xs text-red-400 mt-0.5 truncate">
                                                {bs.error}
                                            </p>
                                        )}
                                    </div>
                                    {bs.txHash && (
                                        <a
                                            href={getExplorerUrl(bs.txHash, walletType === 'highload-v3' ? 'mainnet' : 'mainnet')}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 flex-shrink-0"
                                        >
                                            <ExternalLink className="w-3.5 h-3.5" />
                                            Explorer
                                        </a>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Sending phase indicator (when no batch progress yet) */}
                    {!batchProgress && phase === 'sending' && (
                        <div className="flex flex-col items-center gap-3 py-4">
                            <Loader2 className="w-10 h-10 text-blue-400 animate-spin" />
                            <p className="text-sm text-gray-300">
                                Preparing and dispatching transactions...
                            </p>
                        </div>
                    )}

                    {/* Pre-send phases */}
                    {(phase === 'validating' || phase === 'resolving_dns' || phase === 'resolving_jettons' || phase === 'checking_balance') && (
                        <div className="flex flex-col items-center gap-3 py-4">
                            <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
                            <p className="text-sm text-gray-400">
                                {phase === 'validating' && 'Validating inputs...'}
                                {phase === 'resolving_dns' && 'Resolving .ton domains...'}
                                {phase === 'resolving_jettons' && 'Looking up Jetton wallets...'}
                                {phase === 'checking_balance' && 'Checking wallet balance...'}
                            </p>
                        </div>
                    )}

                    {/* Global Error */}
                    {globalError && (
                        <div className="flex items-start gap-3 px-4 py-3 rounded-xl border border-red-500/20 bg-red-500/5">
                            <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                            <div>
                                <p className="text-sm font-medium text-red-400">Error</p>
                                <p className="text-xs text-red-300/80 mt-0.5">{globalError}</p>
                            </div>
                        </div>
                    )}

                    {/* Completion Summary */}
                    {isComplete && (
                        <div className="flex flex-col gap-3">
                            {/* Row summary */}
                            <div className="grid grid-cols-3 gap-3">
                                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-center">
                                    <p className="text-2xl font-bold text-emerald-400 tabular-nums">
                                        {rowCounts.success}
                                    </p>
                                    <p className="text-[11px] text-gray-500 mt-0.5">Successful</p>
                                </div>
                                <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-center">
                                    <p className="text-2xl font-bold text-red-400 tabular-nums">
                                        {rowCounts.failed}
                                    </p>
                                    <p className="text-[11px] text-gray-500 mt-0.5">Failed</p>
                                </div>
                                <div className="rounded-xl border border-gray-700/30 bg-gray-900/30 p-3 text-center">
                                    <p className="text-2xl font-bold text-gray-200 tabular-nums">
                                        {rowCounts.total}
                                    </p>
                                    <p className="text-[11px] text-gray-500 mt-0.5">Total</p>
                                </div>
                            </div>

                            {/* TX Hash Links */}
                            {allTxHashes.length > 0 && (
                                <div className="flex flex-col gap-1.5">
                                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                                        Transaction Hashes
                                    </p>
                                    {allTxHashes.map(({ label, hash }) => (
                                        <a
                                            key={hash}
                                            href={getExplorerUrl(hash, 'mainnet')}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className={cn(
                                                'flex items-center gap-2 px-3 py-2 rounded-lg',
                                                'border border-gray-700/30 bg-gray-900/30',
                                                'text-sm text-blue-400 hover:text-blue-300 hover:bg-gray-800/50',
                                                'transition-all duration-200'
                                            )}
                                        >
                                            <ExternalLink className="w-3.5 h-3.5 flex-shrink-0" />
                                            <span className="font-medium">{label}</span>
                                            <span className="text-gray-600 font-mono text-xs truncate ml-auto">
                                                {hash.slice(0, 20)}…
                                            </span>
                                        </a>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* ── Footer ──────────────────────────────────────────── */}
                {canClose && (
                    <div className="px-5 py-4 border-t border-gray-800/60">
                        <button
                            type="button"
                            onClick={handleDone}
                            className={cn(
                                'w-full py-2.5 rounded-xl text-sm font-semibold transition-all duration-200',
                                isComplete
                                    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25'
                                    : 'bg-gray-800 text-gray-300 border border-gray-700/50 hover:bg-gray-700'
                            )}
                        >
                            {isComplete ? 'Done / New Batch' : 'Close'}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default React.memo(BatchProgressOverlay);
