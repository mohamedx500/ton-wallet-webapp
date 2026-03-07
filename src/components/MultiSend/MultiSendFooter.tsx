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

import React, { useMemo } from 'react';
import { Send, AlertTriangle } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useWallet } from '../../context/WalletContext';
import { useMultiSend } from '../../context/MultiSendContext';
import CSVImportButton from './CSVImportButton';
import { CoinBadge } from './CoinSelectorDropdown';
import { NATIVE_TON } from '../../types/multisend';

interface MultiSendFooterProps {
    /** Called when the "Send Batch" button is clicked */
    onSend: () => void;
}

const MultiSendFooter: React.FC<MultiSendFooterProps> = ({ onSend }) => {
    const { state, totalAmount, batchCount, allRowsValid } = useMultiSend();
    const { tokens } = useWallet();
    const { validation, execution, rows } = state;
    const isSending = execution.phase !== 'idle' && execution.phase !== 'complete' && execution.phase !== 'error';

    // 1. Get the first currency used in the rows
    const firstRowCoin = rows[0]?.coin;

    // 2. Calculate the total required amount for the selected coin type
    const totalRequiredAmount = useMemo(() => {
        return rows.reduce((sum, row) => {
            if (row.coin.symbol === firstRowCoin?.symbol) {
                const amt = parseFloat(row.amount);
                return sum + (isNaN(amt) ? 0 : amt);
            }
            return sum;
        }, 0);
    }, [rows, firstRowCoin]);

    // 3. Find matching token in user wallet for balance check
    const walletToken = tokens.find(t =>
        (firstRowCoin?.isNative && t.symbol === 'TON') ||
        (!firstRowCoin?.isNative && t.masterAddress === firstRowCoin?.masterAddress)
    );
    const userBalance = walletToken ? parseFloat(walletToken.rawBalance || walletToken.balance || '0') : 0;

    // 4. Insufficient balance check
    const isInsufficientBalance = userBalance < totalRequiredAmount;

    // 5. Button control logic
    const isSendDisabled = isInsufficientBalance || !allRowsValid || isSending || rows.length === 0;

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
        <div className="flex-shrink-0 z-20 bg-white/90 dark:bg-[#0A0C10]/90 backdrop-blur-xl border-t border-gray-100 dark:border-white/[0.03] px-4 sm:px-6 py-4">
            <div className="flex flex-col gap-4">
                {/* Stats Row */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <CSVImportButton />
                        <div className="flex items-center gap-1.5 opacity-90">
                            <span
                                className={cn(
                                    'text-[13px] font-bold tracking-tight',
                                    allRowsValid ? 'text-emerald-500' : 'text-orange-400'
                                )}
                            >
                                {validation.validCount}/{validation.totalCount} valid
                            </span>
                            <span className="text-gray-400 dark:text-gray-600 text-[10px]">&bull;</span>
                            <span className="text-[13px] font-medium text-gray-500">{batchLabel}</span>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 bg-gray-100 dark:bg-white/[0.03] px-3 py-1.5 rounded-full">
                        <CoinBadge coin={firstRowCoin || NATIVE_TON} size="sm" />
                        <span className="text-[15px] font-bold text-gray-900 dark:text-gray-100 tabular-nums">
                            {totalAmount}
                        </span>
                    </div>
                </div>

                {/* Send Button Group */}
                <div className="w-full flex flex-col gap-1.5">
                    {isInsufficientBalance && rows.length > 0 && (
                        <div className="text-center w-full pb-1">
                            <span className="text-[12px] text-red-500 dark:text-red-400 font-bold bg-red-500/10 px-3 py-1 rounded-full">
                                Insufficient {firstRowCoin?.symbol || 'TON'} balance!
                            </span>
                        </div>
                    )}
                    <button
                        type="button"
                        onClick={onSend}
                        disabled={isSendDisabled}
                        className={cn(
                            'w-full flex items-center justify-center gap-2 h-[52px] rounded-[16px] text-[16px] font-bold transition-all duration-300',
                            'disabled:opacity-40 disabled:cursor-not-allowed',
                            !isSendDisabled
                                ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/20 hover:scale-[1.02] active:scale-[0.98]'
                                : 'bg-gray-100 dark:bg-white/[0.04] text-gray-400 dark:text-gray-500 border-none'
                        )}
                    >
                        <Send className="w-5 h-5" />
                        Send Batch
                    </button>
                </div>
            </div>
        </div>
    );
};

export default React.memo(MultiSendFooter);
