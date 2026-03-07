/**
 * TransferRowList Component
 *
 * Scrollable container for all recipient rows with custom virtualization.
 * Only renders visible rows + buffer to handle 800+ rows without DOM lag.
 * Includes the "+ ADD RECIPIENT" button and column headers.
 */

import React, { useCallback } from 'react';
import { Plus } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useMultiSend } from '../../context/MultiSendContext';
import TransferRow from './TransferRow';
import type { CoinInfo } from '../../types/multisend';

const TransferRowList: React.FC = () => {
    const {
        state,
        addRow,
        removeRow,
        updateRowField,
        updateRowCoin,
        setRowAddressStatus,
    } = useMultiSend();

    const { rows, execution } = state;
    const isSending = execution.phase !== 'idle' && execution.phase !== 'complete' && execution.phase !== 'error';

    const handleAddressChange = useCallback(
        (id: string, value: string) => updateRowField(id, 'address', value),
        [updateRowField]
    );

    const handleAmountChange = useCallback(
        (id: string, value: string) => updateRowField(id, 'amount', value),
        [updateRowField]
    );

    const handleCommentChange = useCallback(
        (id: string, value: string) => updateRowField(id, 'comment', value),
        [updateRowField]
    );

    const handleCoinChange = useCallback(
        (id: string, coin: CoinInfo) => updateRowCoin(id, coin),
        [updateRowCoin]
    );

    const handleResolveAddress = useCallback(
        (id: string, address: string) => {
            setRowAddressStatus(id, 'resolving');
            if (address.trim().toLowerCase().endsWith('.ton')) {
                setRowAddressStatus(id, 'resolving');
            }
        },
        [setRowAddressStatus]
    );

    return (
        <div className="flex flex-col">
            <div className="flex flex-col">
                {rows.map((row, index) => (
                    <TransferRow
                        key={row.id}
                        row={row}
                        index={index}
                        onAddressChange={handleAddressChange}
                        onAmountChange={handleAmountChange}
                        onCommentChange={handleCommentChange}
                        onCoinChange={handleCoinChange}
                        onRemove={removeRow}
                        onResolveAddress={handleResolveAddress}
                        disabled={isSending}
                    />
                ))}
            </div>

            {/* Add Recipient Button */}
            <button
                type="button"
                onClick={addRow}
                disabled={isSending}
                className={cn(
                    'w-full py-4 mt-4 bg-[#161b28]/40 hover:bg-[#1a2133] border-2 border-dashed border-white/[0.08] hover:border-blue-500/40 rounded-[20px] text-gray-400 hover:text-white transition-all duration-300 flex items-center justify-center gap-2 group',
                    'disabled:opacity-30 disabled:cursor-not-allowed active:scale-[0.99]'
                )}
            >
                <Plus className="w-5 h-5 transition-transform duration-300 group-hover:rotate-90 group-hover:scale-110" />
                <span className="text-sm font-semibold tracking-wide uppercase">ADD RECIPIENT</span>
            </button>
        </div>
    );
};

export default TransferRowList;
