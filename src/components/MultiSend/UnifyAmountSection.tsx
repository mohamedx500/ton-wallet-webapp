/**
 * UnifyAmountSection Component
 *
 * Master amount input with "Apply to All" button.
 * Shows a preview text: "Each address will receive X TON".
 */

import React, { useCallback } from 'react';
import { cn } from '../../lib/utils';
import { useMultiSend } from '../../context/MultiSendContext';
import { CoinBadge } from './CoinSelectorDropdown';
import { NATIVE_TON } from '../../types/multisend';

const UnifyAmountSection: React.FC = () => {
    const {
        state,
        setUnifyAmount,
        applyUnifyAmount,
    } = useMultiSend();

    const { value } = state.unification.amount;
    const isSending = state.execution.phase !== 'idle' && state.execution.phase !== 'complete' && state.execution.phase !== 'error';

    // Determine the dominant coin across rows for the preview
    const dominantCoin = (() => {
        const counts: Record<string, { coin: typeof NATIVE_TON; count: number }> = {};
        for (const row of state.rows) {
            const key = row.coin.symbol;
            if (!counts[key]) counts[key] = { coin: row.coin, count: 0 };
            counts[key].count++;
        }
        let max = { coin: NATIVE_TON, count: 0 };
        for (const entry of Object.values(counts)) {
            if (entry.count > max.count) max = entry;
        }
        return max.coin;
    })();

    const handleChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const raw = e.target.value;
            // Allow only numeric + single decimal
            const cleaned = raw.replace(/[^0-9.]/g, '');
            const parts = cleaned.split('.');
            if (parts.length > 2) return;
            setUnifyAmount(cleaned);
        },
        [setUnifyAmount]
    );

    const handleApply = useCallback(() => {
        applyUnifyAmount();
    }, [applyUnifyAmount]);

    const numericValue = parseFloat(value);
    const hasValidAmount = !isNaN(numericValue) && numericValue > 0;

    return (
        <div className="flex flex-col gap-4">
            <h4 className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                Amount
            </h4>

            {/* Amount input with coin icon */}
            <div className={cn(
                'flex items-center gap-2 w-full h-[42px] rounded-xl border px-4',
                'border-gray-200 bg-gray-50 dark:border-white/[0.08] dark:bg-white/[0.03]',
                'transition-all duration-200',
                'focus-within:border-blue-500/50 focus-within:bg-white dark:focus-within:bg-white/[0.05]'
            )}>
                <CoinBadge coin={dominantCoin} size="sm" />
                <input
                    type="text"
                    inputMode="decimal"
                    value={value}
                    onChange={handleChange}
                    placeholder="10"
                    disabled={isSending}
                    autoComplete="off"
                    className={cn(
                        'flex-1 bg-transparent text-sm text-gray-800 dark:text-gray-200 outline-none min-w-0',
                        'placeholder:text-gray-400 dark:placeholder:text-gray-600 font-medium tabular-nums',
                        'disabled:cursor-not-allowed'
                    )}
                />
            </div>

            {/* Apply button */}
            <button
                type="button"
                onClick={handleApply}
                disabled={isSending || !hasValidAmount}
                className={cn(
                    'w-full h-[40px] rounded-xl text-sm font-semibold transition-all duration-200 border',
                    'disabled:opacity-40 disabled:cursor-not-allowed',
                    hasValidAmount
                        ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-300 dark:border-emerald-500/25 hover:bg-emerald-100 dark:hover:bg-emerald-500/20'
                        : 'bg-gray-50 dark:bg-white/[0.03] text-gray-400 dark:text-gray-500 border-gray-200 dark:border-white/[0.06]'
                )}
            >
                Apply to All
            </button>

            {/* Preview text */}
            {hasValidAmount && (
                <p className="text-xs text-gray-500 dark:text-gray-500">
                    Each address will receive{' '}
                    <span className="text-emerald-400 font-semibold">
                        {value} {dominantCoin.symbol}
                    </span>
                </p>
            )}
        </div>
    );
};

export default React.memo(UnifyAmountSection);
