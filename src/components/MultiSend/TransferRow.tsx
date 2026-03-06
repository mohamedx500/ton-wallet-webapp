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
            className={cn(
                'group rounded-xl border border-transparent p-2 sm:p-3 transition-all duration-200',
                'hover:bg-gray-50 hover:border-gray-200',
                'dark:hover:bg-white/[0.02] dark:hover:border-white/[0.04]',
                'border-l-2',
                statusBorderClass,
                row.rowStatus === 'failed' && 'bg-red-50 dark:bg-red-500/[0.04]',
                row.rowStatus === 'success' && 'bg-emerald-50 dark:bg-emerald-500/[0.04]'
            )}
        >
            {/* Desktop: 12-column grid */}
            <div className="hidden sm:grid grid-cols-12 gap-3 items-start">
                {/* Address - col-span-4 */}
                <div className="col-span-4">
                    <AddressInput
                        value={row.address}
                        onChange={handleAddressChange}
                        addressStatus={row.addressStatus}
                        resolvedAddress={row.resolvedAddress}
                        error={row.addressStatus === 'invalid' ? (row.error || 'Invalid address') : undefined}
                        onResolve={handleResolve}
                        placeholder="EQ... or UQ..."
                        disabled={disabled}
                    />
                </div>

                {/* Amount - col-span-2 */}
                <div className="col-span-2">
                    <AmountInput
                        value={row.amount}
                        onChange={handleAmountChange}
                        coin={row.coin}
                        placeholder="10"
                        disabled={disabled}
                    />
                </div>

                {/* Comment - col-span-3 */}
                <div className="col-span-3">
                    <input
                        type="text"
                        value={row.comment}
                        onChange={handleCommentChange}
                        placeholder="memo (optional)"
                        disabled={disabled}
                        autoComplete="off"
                        className={cn(
                            'w-full h-[42px] rounded-xl border px-4',
                            'border-gray-200 bg-gray-50 text-gray-800 placeholder:text-gray-400',
                            'dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:placeholder:text-gray-600',
                            'text-sm outline-none transition-all duration-200',
                            'hover:border-gray-300 focus:border-blue-500/50 focus:bg-white',
                            'dark:hover:border-white/[0.12] dark:focus:bg-white/[0.05]',
                            'disabled:opacity-50 disabled:cursor-not-allowed'
                        )}
                    />
                </div>

                {/* Coin Selector - col-span-2 */}
                <div className="col-span-2">
                    <CoinSelectorDropdown
                        value={row.coin}
                        onChange={handleCoinChange}
                        disabled={disabled}
                        compact
                    />
                </div>

                {/* Delete - col-span-1 */}
                <div className="col-span-1 flex justify-end">
                    <button
                        type="button"
                        onClick={handleRemove}
                        disabled={disabled}
                        className={cn(
                            'w-[42px] h-[42px] rounded-xl flex items-center justify-center transition-all duration-200',
                            'text-gray-400 hover:text-red-500 hover:bg-red-50',
                            'dark:text-gray-600 dark:hover:text-red-400 dark:hover:bg-red-500/10',
                            'opacity-0 group-hover:opacity-100',
                            'disabled:opacity-30 disabled:cursor-not-allowed'
                        )}
                        title="Remove recipient"
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Mobile: Stacked layout */}
            <div className="flex flex-col gap-3 sm:hidden">
                <AddressInput
                    value={row.address}
                    onChange={handleAddressChange}
                    addressStatus={row.addressStatus}
                    resolvedAddress={row.resolvedAddress}
                    error={row.addressStatus === 'invalid' ? (row.error || 'Invalid address') : undefined}
                    onResolve={handleResolve}
                    placeholder="EQ... or UQ..."
                    disabled={disabled}
                />
                <div className="flex gap-3">
                    <div className="flex-1">
                        <AmountInput
                            value={row.amount}
                            onChange={handleAmountChange}
                            coin={row.coin}
                            placeholder="10"
                            disabled={disabled}
                        />
                    </div>
                    <CoinSelectorDropdown
                        value={row.coin}
                        onChange={handleCoinChange}
                        disabled={disabled}
                        compact
                    />
                </div>
                <div className="flex gap-3 items-center">
                    <input
                        type="text"
                        value={row.comment}
                        onChange={handleCommentChange}
                        placeholder="memo (optional)"
                        disabled={disabled}
                        autoComplete="off"
                        className={cn(
                            'flex-1 h-[42px] rounded-xl border px-4',
                            'border-gray-200 bg-gray-50 text-gray-800 placeholder:text-gray-400',
                            'dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:placeholder:text-gray-600',
                            'text-sm outline-none transition-all duration-200',
                            'hover:border-gray-300 focus:border-blue-500/50',
                            'dark:hover:border-white/[0.12]',
                            'disabled:opacity-50 disabled:cursor-not-allowed'
                        )}
                    />
                    <button
                        type="button"
                        onClick={handleRemove}
                        disabled={disabled}
                        className="w-[42px] h-[42px] rounded-xl flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 dark:text-gray-600 dark:hover:text-red-400 dark:hover:bg-red-500/10 transition-all"
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                </div>
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
