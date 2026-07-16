/**
 * CoinSelectorDropdown Component
 *
 * Per-row dropdown for selecting native TON or Jetton tokens.
 * Shows token icon, symbol, and handles click-outside to close.
 * 
 * Only displays tokens the user actually holds in their wallet.
 */
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { CoinInfo } from '../../types/multisend';
import { NATIVE_TON } from '../../types/multisend';
import { useWallet } from '../../context/WalletContext';

/** Well-known Jetton master addresses for matching wallet tokens to CoinInfo */
const KNOWN_JETTON_ADDRESSES: Record<string, Partial<CoinInfo>> = {
    'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs': {
        symbol: 'USDT',
        name: 'Tether USD',
        decimals: 6,
        isNative: false,
    },
    'EQAvlWFDxGF2lXm67y4yzC17wYKD9A0guwPkMs1gOsM__NOT': {
        symbol: 'NOT',
        name: 'Notcoin',
        decimals: 9,
        isNative: false,
    },
    'EQCvxJy4eG8hyHBFsZ7eePxrRsUQSFE_jpptRAYBmcG_DOGS': {
        symbol: 'DOGS',
        name: 'DOGS',
        decimals: 9,
        isNative: false,
    },
    'EQAJ8uWd7EBqsmpSWaRdf_I-8R8-XHwh3gsNKhy-UrdrPcUo': {
        symbol: 'HMSTR',
        name: 'Hamster Kombat',
        decimals: 9,
        isNative: false,
    },
};
/** Hardcoded fallback coins list (only used if wallet context unavailable) */
export const AVAILABLE_COINS: CoinInfo[] = [
    { ...NATIVE_TON },

];
/** Helper to normalize symbol for comparison (handles USD₮ vs USDT) */
function normalizeSymbol(sym: string | undefined): string {
    if (!sym) return '';
    if (sym === 'USD₮' || sym === 'USDT') return 'USDT';
    return sym.toUpperCase();
}
/**
 * Hook to build the list of coins from the user's wallet tokens.
 * Only returns tokens with a positive balance.
 * Always includes TON first.
 */
export function useWalletCoins(): CoinInfo[] {
    const { tokens } = useWallet();
    return useMemo(() => {
        const coins: CoinInfo[] = [];
        // Only include native TON if user has a balance
        const tonToken = tokens.find(t => normalizeSymbol(t.symbol) === 'Gram');
        const tonBal = parseFloat(tonToken?.rawBalance ?? tonToken?.balance ?? '0');
        if (tonBal > 0) {
            coins.push({
                ...NATIVE_TON,
                icon: tonToken?.icon || NATIVE_TON.icon,
            });
        }
        // Add jettons from wallet that have a positive balance
        for (const token of tokens) {
            const sym = normalizeSymbol(token.symbol);
            // Skip TON (already added)
            if (sym === 'Gram') continue;
            // Only include tokens with a balance > 0
            const rawBal = parseFloat(token.rawBalance ?? token.balance ?? '0');
            if (rawBal <= 0) continue;
            // Build CoinInfo from wallet token data
            const coin: CoinInfo = {
                symbol: sym === 'USDT' ? 'USDT' : token.symbol,
                name: token.name || sym,
                masterAddress: token.masterAddress || null,              // Jetton Master Contract address
                decimals: token.decimals || 9,
                isNative: false,
                icon: token.icon || undefined,
                jettonWalletAddress: token.walletAddress || undefined,   // User's Jetton Wallet address (pre-fetched)
            };
            coins.push(coin);
        }
        // If no tokens loaded yet, return TON-only
        return coins.length > 0 ? coins : [{ ...NATIVE_TON }];
    }, [tokens]);
}
/** Coin icon with real image + fallback colored circle */

const CoinBadge: React.FC<{ coin: CoinInfo; size?: 'sm' | 'md' }> = ({ coin, size = 'md' }) => {
    const dim = size === 'sm' ? 'w-5 h-5 text-[10px]' : 'w-6 h-6 text-xs';
    const [imgError, setImgError] = React.useState(false);

    // Reset error state when icon URL changes
    React.useEffect(() => {
        setImgError(false);
    }, [coin.icon]);

    const iconUrl = coin.icon || null;
    if (iconUrl && !imgError) {
        return (
            <img
                src={iconUrl}
                alt={coin.symbol}
                className={cn(dim, 'rounded-full object-cover flex-shrink-0')}
                onError={() => setImgError(true)}
            />
        );
    }
    const colorMap: Record<string, string> = {
        TON: 'bg-slate-500', // Modern slate instead of bright blue
        USDT: 'bg-emerald-500',
        NOT: 'bg-yellow-500',
        DOGS: 'bg-orange-500',
        HMSTR: 'bg-pink-500',
    };
    const bg = colorMap[normalizeSymbol(coin.symbol)] || 'bg-slate-400';
    return (
        <div className={cn(dim, bg, 'rounded-full flex items-center justify-center font-bold text-white flex-shrink-0')}>
            {coin.symbol.charAt(0)}
        </div>
    );
};

export interface CoinSelectorDropdownProps {
    /** Currently selected coin */
    value: CoinInfo;
    /** Called when a coin is selected */
    onChange: (coin: CoinInfo) => void;

    /** Optional list of available coins (defaults to wallet coins) */
    coins?: CoinInfo[];
    /** Disable the dropdown */
    disabled?: boolean;
    /** Compact mode for use inside rows */
    compact?: boolean;
    /** Render dropdown menu towards top or bottom */
    placement?: 'top' | 'bottom';
}
const CoinSelectorDropdown: React.FC<CoinSelectorDropdownProps> = ({
    value,
    onChange,
    coins: coinsProp,
    disabled = false,
    compact = false,
    placement = 'bottom',
}) => {
    const walletCoins = useWalletCoins();
    const coins = coinsProp || walletCoins;
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    // Close on click outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);
    const handleSelect = useCallback(
        (coin: CoinInfo) => {
            onChange(coin);
            setIsOpen(false);
        },
        [onChange]
    );
    return (
        <div ref={dropdownRef} className="relative w-full">
            {/* Trigger Button */}
            <button
                type="button"
                onClick={() => !disabled && setIsOpen((prev) => !prev)}
                disabled={disabled}
                className={cn(
                    'flex items-center gap-2 h-[46px] rounded-[14px] border px-4 transition-all duration-300 w-full',
                    'bg-gray-100 dark:bg-black/40 border-transparent dark:border-white/[0.03]',
                    'hover:bg-gray-200 dark:hover:bg-black/60',
                    'disabled:opacity-50 disabled:cursor-not-allowed',
                    isOpen && 'border-blue-500/40 dark:bg-black/80 bg-white shadow-sm',
                    compact ? 'min-w-[70px]' : 'min-w-[110px]',
                    'min-w-0'
                )}
            >
                <CoinBadge coin={value} size="sm" />
                <span className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                    {value.symbol}
                </span>
                <ChevronDown
                    className={cn(
                        'w-3.5 h-3.5 text-gray-400 dark:text-gray-500 transition-transform duration-200 ml-auto',
                        isOpen && 'rotate-180'
                    )}
                />
            </button>
            {/* Dropdown Menu */}
            {isOpen && (
                <div
                    className={cn(
                        'absolute z-50 min-w-[180px]',
                        compact ? 'right-0' : 'left-0 right-0 w-full',
                        placement === 'top' ? 'bottom-full mb-2' : 'top-full mt-2',
                        'rounded-xl border shadow-2xl py-1.5 backdrop-blur-xl',
                        'max-h-[240px] overflow-y-auto custom-scrollbar',
                        'border-gray-200 bg-white shadow-black/10',
                        'dark:border-white/[0.08] dark:bg-[#13151e] dark:shadow-black/50',
                        'animate-scale-in'
                    )}
                >

                    {coins.length === 0 ? (
                        <div className="px-4 py-3 text-sm text-gray-400 dark:text-gray-500 text-center">
                            No tokens found
                        </div>
                    ) : (
                        coins.map((coin) => {
                            const isSelected = normalizeSymbol(coin.symbol) === normalizeSymbol(value.symbol);
                            return (
                                <button
                                    key={coin.symbol}
                                    type="button"
                                    onClick={() => handleSelect(coin)}
                                    className={cn(
                                        'w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors duration-150',
                                        'hover:bg-gray-50 dark:hover:bg-white/[0.04]',
                                        isSelected && 'bg-gray-100 dark:bg-white/[0.06]' // Subtle gray instead of blue-50
                                    )}
                                >
                                    <CoinBadge coin={coin} size="sm" />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
                                            {coin.symbol}
                                        </p>
                                        <p className="text-[11px] text-gray-500 truncate">
                                            {coin.name}
                                        </p>
                                    </div>
                                    {isSelected && (
                                        <Check className="w-4 h-4 text-blue-500 dark:text-blue-400 flex-shrink-0" />
                                    )}
                                </button>
                            );
                        })
                    )}
                </div>
            )}
        </div>
    );
};
export { CoinBadge };
export default React.memo(CoinSelectorDropdown);
