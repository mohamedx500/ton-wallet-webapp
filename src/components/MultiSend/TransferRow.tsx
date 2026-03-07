/**
 * TransferRow Component
 *
 * A single recipient row composing AddressInput, AmountInput, comment field,
 * CoinSelectorDropdown, and a delete button. Connected to MultiSendContext.
 * Wrapped in React.memo for virtualized list performance.
 */

import React, { useCallback } from 'react';
import { Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import AddressInput from './AddressInput';
import AmountInput from './AmountInput';
import CoinSelectorDropdown from './CoinSelectorDropdown';
import type { TransferRow as TransferRowType, CoinInfo, AddressStatus } from '../../types/multisend';

interface TransferRowProps {
    /** The row data */
    row: TransferRowType;
    /** Row index (for display, e.g. row number) */
    index: number;
    /** Called when address changes */
    onAddressChange: (id: string, value: string) => void;
    /** Called when amount changes */
    onAmountChange: (id: string, value: string) => void;
    /** Called when comment changes */
    onCommentChange: (id: string, value: string) => void;
    /** Called when coin changes */
    onCoinChange: (id: string, coin: CoinInfo) => void;
    /** Called when delete is clicked */
    onRemove: (id: string) => void;
    /** Called to trigger DNS resolution for .ton domains */
    onResolveAddress: (id: string, address: string) => void;
    /** Whether the row is disabled (e.g. during send) */
    disabled?: boolean;
    /** Style prop for virtualized positioning */
    style?: React.CSSProperties;
}

const TransferRow: React.FC<TransferRowProps> = ({
    row,
    index,
    onAddressChange,
    onAmountChange,
    onCommentChange,
    onCoinChange,
    onRemove,
    onResolveAddress,
    disabled = false,
    style,
}) => {
    const handleAddressChange = useCallback(
        (value: string) => onAddressChange(row.id, value),
        [row.id, onAddressChange]
    );

    const handleAmountChange = useCallback(
        (value: string) => onAmountChange(row.id, value),
        [row.id, onAmountChange]
    );

    const handleCommentChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => onCommentChange(row.id, e.target.value),
        [row.id, onCommentChange]
    );

    const handleCoinChange = useCallback(
        (coin: CoinInfo) => onCoinChange(row.id, coin),
        [row.id, onCoinChange]
    );

    const handleRemove = useCallback(
        () => onRemove(row.id),
        [row.id, onRemove]
    );

    const handleResolve = useCallback(
        (address: string) => onResolveAddress(row.id, address),
        [row.id, onResolveAddress]
    );

    // Row status indicator color
    const statusBorderClass =
        row.rowStatus === 'success'
            ? 'border-l-emerald-500'
            : row.rowStatus === 'failed'
                ? 'border-l-red-500'
                : row.rowStatus === 'sending'
                    ? 'border-l-blue-500'
                    : 'border-l-transparent';

    return (
        <div
            style={style}
            // Vertical card layout with padding and spacing
            className={cn(
                'group flex flex-col gap-3.5 bg-white dark:bg-[#14161C] border border-gray-100 dark:border-white/[0.03] p-4 sm:p-5 rounded-[24px] mb-5 transition-all duration-300 shadow-sm',
                row.rowStatus === 'failed' && 'border-red-500/50 bg-red-500/5',
                row.rowStatus === 'success' && 'border-emerald-500/50 bg-emerald-500/5'
            )}
        >
            {/* Header Row: Number Badge & Delete Button */}
            <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2.5 shadow-sm shadow-blue-500/10 justify-center min-w-[30px] h-[30px] bg-blue-500/10 text-blue-500 font-bold text-[13px] rounded-[10px]">
                    {index + 1}
                </div>
                <button
                    type="button"
                    onClick={handleRemove}
                    disabled={disabled}
                    className="w-8 h-8 flex items-center justify-center text-gray-400 dark:text-gray-500 hover:text-red-500 hover:bg-red-500/10 rounded-full transition-all"
                    title="Delete Row"
                >
                    <Trash2 className="w-4 h-4" />
                </button>
            </div>

            {/* Input 1: Address (Full Width) */}
            <div className="w-full">
                <AddressInput
                    value={row.address}
                    onChange={handleAddressChange}
                    addressStatus={row.addressStatus}
                    resolvedAddress={row.resolvedAddress}
                    error={row.addressStatus === 'invalid' ? (row.error || 'Invalid address') : undefined}
                    onResolve={handleResolve}
                    placeholder="Recipient address or .ton"
                    disabled={disabled}
                />
            </div>

            {/* Input 2 & 3: Amount + Coin (2 Columns Side-by-Side) */}
            <div className="flex flex-row gap-3 w-full">
                <div className="flex-1 min-w-0">
                    <AmountInput
                        value={row.amount}
                        onChange={handleAmountChange}
                        coin={row.coin}
                        placeholder="0.0"
                        disabled={disabled}
                    />
                </div>
                <div className="flex-1 min-w-0">
                    <CoinSelectorDropdown
                        value={row.coin}
                        onChange={handleCoinChange}
                        disabled={disabled}
                        compact
                    />
                </div>
            </div>

            {/* Input 4: Memo (Full Width) */}
            <div className="w-full">
                <input
                    type="text"
                    value={row.comment}
                    onChange={handleCommentChange}
                    placeholder="Memo (optional)"
                    disabled={disabled}
                    autoComplete="off"
                    spellCheck="false"
                    className={cn(
                        'w-full h-[46px] rounded-[14px] border border-transparent dark:border-white/[0.03] px-4',
                        'bg-gray-100 dark:bg-black/40 text-gray-800 dark:text-gray-200',
                        'text-sm outline-none transition-all duration-300',
                        'placeholder:text-gray-400 dark:placeholder:text-gray-600',
                        'hover:bg-gray-200 dark:hover:bg-black/60',
                        'focus:bg-white dark:focus:bg-black/60 focus:border-blue-500/40 focus:shadow-sm',
                        'disabled:opacity-50 disabled:cursor-not-allowed'
                    )}
                />
            </div>
        </div>
    );
};

export default React.memo(TransferRow, (prev, next) => {
    return (
        prev.row.id === next.row.id &&
        prev.row.address === next.row.address &&
        prev.row.amount === next.row.amount &&
        prev.row.comment === next.row.comment &&
        prev.row.coin.symbol === next.row.coin.symbol &&
        prev.row.addressStatus === next.row.addressStatus &&
        prev.row.resolvedAddress === next.row.resolvedAddress &&
        prev.row.rowStatus === next.row.rowStatus &&
        prev.row.error === next.row.error &&
        prev.disabled === next.disabled &&
        prev.index === next.index
    );
});
