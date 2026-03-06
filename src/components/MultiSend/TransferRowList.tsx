/**
 * TransferRowList Component
 *
 * Scrollable container for all recipient rows with custom virtualization.
 * Only renders visible rows + buffer to handle 800+ rows without DOM lag.
 * Includes the "+ ADD RECIPIENT" button and column headers.
 */

import React, { useCallback, useRef, useState, useEffect, useMemo } from 'react';
import { Plus } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useMultiSend } from '../../context/MultiSendContext';
import TransferRow from './TransferRow';
import type { CoinInfo } from '../../types/multisend';

/** Height of a single row in pixels (increased for spacious layout) */
const ROW_HEIGHT = 66;
/** Number of extra rows to render above/below the visible area */
const OVERSCAN = 5;
/** Maximum visible height before scrolling kicks in */
const MAX_VISIBLE_HEIGHT = 400;

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

    const containerRef = useRef<HTMLDivElement>(null);
    const [scrollTop, setScrollTop] = useState(0);
    const [containerHeight, setContainerHeight] = useState(MAX_VISIBLE_HEIGHT);

    // Measure container on mount and resize
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                setContainerHeight(entry.contentRect.height);
            }
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
        setScrollTop(e.currentTarget.scrollTop);
    }, []);

    // Virtualization calculations
    const totalHeight = rows.length * ROW_HEIGHT;
    const visibleHeight = Math.min(containerHeight, MAX_VISIBLE_HEIGHT);
    const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
    const endIndex = Math.min(
        rows.length - 1,
        Math.ceil((scrollTop + visibleHeight) / ROW_HEIGHT) + OVERSCAN
    );

    const visibleRows = useMemo(() => {
        return rows.slice(startIndex, endIndex + 1).map((row, i) => ({
            row,
            index: startIndex + i,
        }));
    }, [rows, startIndex, endIndex]);

    // Row action handlers
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
            // Set status to resolving
            setRowAddressStatus(id, 'resolving');
            // Mock DNS resolution — in production this calls DnsResolverService
            // The actual resolution is triggered by useExecuteMultiSend hook
            const trimmed = address.trim().toLowerCase();
            if (trimmed.endsWith('.ton')) {
                // Mark as resolving; the hook will handle actual resolution
                setRowAddressStatus(id, 'resolving');
            }
        },
        [setRowAddressStatus]
    );

    // Determine if we should use virtualization
    const useVirtualization = rows.length > 10;
    const listHeight = useVirtualization
        ? Math.min(rows.length * ROW_HEIGHT, MAX_VISIBLE_HEIGHT)
        : 'auto';

    return (
        <div className="flex flex-col gap-1">
            {/* Column Headers — desktop only, matching 12-col grid */}
            <div className="hidden sm:grid grid-cols-12 gap-3 px-3 pb-2">
                <span className="col-span-4 text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                    Address
                </span>
                <span className="col-span-2 text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                    Amount
                </span>
                <span className="col-span-3 text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                    Comment
                </span>
                <span className="col-span-2 text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                    Coin
                </span>
                <span className="col-span-1" />
            </div>

            {/* Rows Container */}
            {useVirtualization ? (
                <div
                    ref={containerRef}
                    onScroll={handleScroll}
                    className="overflow-y-auto"
                    style={{ height: listHeight, position: 'relative' }}
                >
                    <div style={{ height: totalHeight, position: 'relative' }}>
                        {visibleRows.map(({ row, index }) => (
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
                                style={{
                                    position: 'absolute',
                                    top: index * ROW_HEIGHT,
                                    left: 0,
                                    right: 0,
                                    height: ROW_HEIGHT,
                                }}
                            />
                        ))}
                    </div>
                </div>
            ) : (
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
            )}

            {/* Add Recipient Button */}
            <button
                type="button"
                onClick={addRow}
                disabled={isSending}
                className={cn(
                    'flex items-center justify-center gap-2 w-full py-4 mt-2',
                    'text-sm font-medium text-gray-400 dark:text-gray-500 transition-all duration-200',
                    'rounded-xl border border-dashed border-gray-300 dark:border-white/[0.08]',
                    'hover:text-blue-500 dark:hover:text-blue-400 hover:border-blue-400 dark:hover:border-blue-500/30 hover:bg-blue-50 dark:hover:bg-blue-500/[0.04]',
                    'disabled:opacity-30 disabled:cursor-not-allowed'
                )}
            >
                <Plus className="w-4 h-4" />
                ADD RECIPIENT
            </button>
        </div>
    );
};

export default TransferRowList;
