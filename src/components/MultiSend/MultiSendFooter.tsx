/**
 * MultiSendFooter Component
 *
 * Sticky bottom bar containing:
 * - CSV import button (left)
 * - Validation summary + total amount with USD equivalent (center)
 * - "Send Batch" button (right)
 *
 * Responsive: On mobile, stacks into a compact two-row layout.
 */

import React from 'react';
import { Send, AlertTriangle } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useMultiSend } from '../../context/MultiSendContext';
import CSVImportButton from './CSVImportButton';
import { CoinBadge } from './CoinSelectorDropdown';
import { NATIVE_TON } from '../../types/multisend';

interface MultiSendFooterProps {
    /** Called when the "Send Batch" button is clicked */
    onSend: () => void;
}

const MultiSendFooter: React.FC<MultiSendFooterProps> = ({ onSend }) => {
    const { state, totalAmount, batchCount, canSend, allRowsValid } = useMultiSend();
    const { validation, execution, rows } = state;
    const isSending = execution.phase !== 'idle' && execution.phase !== 'complete' && execution.phase !== 'error';

    // Compute a simple estimated USD value (mock rate — in production, fetch from API)
    const TON_USD_RATE = 5.20;
    const tonTotal = rows.reduce((sum, row) => {
        if (row.coin.isNative) {
            const amt = parseFloat(row.amount);
            return sum + (isNaN(amt) ? 0 : amt);
        }
        return sum;
    }, 0);
    const estimatedUsd = (tonTotal * TON_USD_RATE).toFixed(2);

    // Determine batch label
    const batchLabel = batchCount === 1 ? '1 batch TX' : `${batchCount} batch TXs`;

    return (
        <div className="flex-shrink-0 border-t border-gray-200 dark:border-white/[0.06] bg-gray-50 dark:bg-[#0d0f16]">
            <div className="px-3 sm:px-6 lg:px-8 py-3 sm:py-4">
                {/* Mobile: Two rows — info on top, buttons on bottom */}
                {/* Desktop: Single row with all elements */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    {/* Row 1 on mobile / Left+Center on desktop: Validation + Total */}
                    <div className="flex items-center justify-between sm:justify-start gap-3 sm:gap-5">
                        {/* CSV Import - compact on mobile */}
                        <CSVImportButton />

                        {/* Validation badge */}
                        <div className="flex items-center gap-1.5">
                            <span
                                className={cn(
                                    'text-xs sm:text-sm font-semibold tabular-nums',
                                    allRowsValid ? 'text-emerald-500 dark:text-emerald-400' : 'text-yellow-500 dark:text-yellow-400'
                                )}
                            >
                                {validation.validCount}/{validation.totalCount} valid
                            </span>
                            <span className="text-gray-300 dark:text-gray-700">·</span>
                            <span className="text-xs sm:text-sm text-gray-500">{batchLabel}</span>
                        </div>

                        {/* Total amount */}
                        <div className="flex items-center gap-1.5">
                            <CoinBadge coin={NATIVE_TON} size="sm" />
                            <span className="text-sm sm:text-lg font-bold text-gray-900 dark:text-white tabular-nums">
                                {totalAmount}
                            </span>
                            {tonTotal > 0 && (
                                <span className="text-xs text-gray-500 hidden sm:inline">
                                    ≈ ${estimatedUsd}
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Balance warning */}
                    {!validation.balanceSufficient && (
                        <div className="flex items-center gap-1.5 text-xs text-red-500 dark:text-red-400">
                            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                            Insufficient balance
                        </div>
                    )}

                    {/* Row 2 on mobile / Right on desktop: Send button */}
                    <button
                        type="button"
                        onClick={onSend}
                        disabled={!canSend || isSending}
                        className={cn(
                            'flex items-center gap-2 px-6 h-10 sm:h-11 rounded-xl text-sm font-bold transition-all duration-200',
                            'w-full sm:w-auto justify-center flex-shrink-0',
                            'disabled:opacity-40 disabled:cursor-not-allowed',
                            canSend && !isSending
                                ? 'bg-gradient-to-r from-blue-500 to-emerald-500 text-white shadow-lg shadow-blue-500/20 hover:shadow-blue-500/30 hover:scale-[1.02] active:scale-[0.98]'
                                : 'bg-gray-200 dark:bg-white/[0.06] text-gray-400 dark:text-gray-500 border border-gray-300 dark:border-white/[0.06]'
                        )}
                    >
                        <Send className="w-4 h-4" />
                        Send Batch
                    </button>
                </div>
            </div>
        </div>
    );
};

export default React.memo(MultiSendFooter);
