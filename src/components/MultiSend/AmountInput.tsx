/**
 * AmountInput Component
 *
 * Numeric input for transfer amounts with:
 * - Token icon prefix showing the selected coin
 * - Decimal validation respecting the token's decimals
 * - Prevents non-numeric characters
 * - Visual feedback for invalid amounts
 */

import React, { useState, useCallback } from 'react';
import { cn } from '../../lib/utils';
import type { CoinInfo } from '../../types/multisend';

interface AmountInputProps {
    /** Current amount string value */
    value: string;
    /** Called when the user changes the amount */
    onChange: (value: string) => void;
    /** The coin selected for this row (used for icon + decimal validation) */
    coin: CoinInfo;
    /** Placeholder text */
    placeholder?: string;
    /** Whether the input is disabled */
    disabled?: boolean;
    /** External error message */
    error?: string;
}

/**
 * Validate and sanitize amount input.
 * - Allows only digits and a single decimal point
 * - Limits decimal places to the token's decimals
 */
function sanitizeAmount(raw: string, decimals: number): string | null {
    // Allow empty
    if (raw === '') return '';

    // Allow a single leading decimal like ".5"
    if (raw === '.') return '0.';

    // Strip anything that isn't digit or dot
    const cleaned = raw.replace(/[^0-9.]/g, '');

    // Only one decimal point
    const parts = cleaned.split('.');
    if (parts.length > 2) return null;

    // Enforce decimal precision
    if (parts.length === 2 && parts[1].length > decimals) {
        return null;
    }

    // Prevent leading zeros like "00" or "007" (but allow "0" and "0.")
    if (parts[0].length > 1 && parts[0].startsWith('0') && parts[0][1] !== '.') {
        return parts[0].replace(/^0+/, '') + (parts.length === 2 ? '.' + parts[1] : '');
    }

    return cleaned;
}

/** Minimal coin icon — shows the first letter or an image */
const CoinIcon: React.FC<{ coin: CoinInfo }> = ({ coin }) => {
    const [imgError, setImgError] = React.useState(false);

    // Reset error when icon URL changes
    React.useEffect(() => {
        setImgError(false);
    }, [coin.icon]);

    if (coin.icon && !imgError) {
        return (
            <img
                src={coin.icon}
                alt={coin.symbol}
                className="w-5 h-5 rounded-full object-cover flex-shrink-0"
                onError={() => setImgError(true)}
            />
        );
    }

    // Fallback: colored circle with first letter
    const colorMap: Record<string, string> = {
        TON: 'bg-blue-500',
        USDT: 'bg-emerald-500',
        NOT: 'bg-yellow-500',
        DOGS: 'bg-orange-500',
        HMSTR: 'bg-pink-500',
    };
    const sym = coin.symbol === 'USD₮' ? 'USDT' : coin.symbol.toUpperCase();
    const bgColor = colorMap[sym] || (coin.isNative ? 'bg-blue-500' : 'bg-purple-500');
    return (
        <div
            className={cn(
                'w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0',
                bgColor
            )}
        >
            {coin.symbol.charAt(0)}
        </div>
    );
};

const AmountInput: React.FC<AmountInputProps> = ({
    value,
    onChange,
    coin,
    placeholder = '0',
    disabled = false,
    error,
}) => {
    const [isFocused, setIsFocused] = useState(false);

    const handleChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const sanitized = sanitizeAmount(e.target.value, coin.decimals);
            if (sanitized !== null) {
                onChange(sanitized);
            }
        },
        [onChange, coin.decimals]
    );

    // Determine if value is invalid (non-empty but zero or negative)
    const hasValue = value !== '';
    const numericValue = parseFloat(value);
    const isInvalid = error || (hasValue && (isNaN(numericValue) || numericValue <= 0));

    const borderClass = isInvalid
        ? 'border-red-500/40 focus-within:border-red-500/60'
        : isFocused
            ? 'border-blue-500/40'
            : 'border-gray-200 hover:border-gray-300 dark:border-white/[0.08] dark:hover:border-white/[0.12]';

    return (
        <div className="relative">
            <div
                className={cn(
                    'flex items-center gap-2 h-[42px] rounded-xl border px-4 transition-all duration-200',
                    'bg-gray-50 dark:bg-white/[0.03]',
                    borderClass,
                    isFocused && 'bg-white dark:bg-white/[0.05]',
                    disabled && 'opacity-50 cursor-not-allowed'
                )}
            >
                {/* Coin icon */}
                <CoinIcon coin={coin} />

                <input
                    type="text"
                    inputMode="decimal"
                    value={value}
                    onChange={handleChange}
                    onFocus={() => setIsFocused(true)}
                    onBlur={() => setIsFocused(false)}
                    placeholder={placeholder}
                    disabled={disabled}
                    autoComplete="off"
                    className={cn(
                        'flex-1 bg-transparent text-sm text-gray-800 dark:text-gray-200 outline-none',
                        'placeholder:text-gray-400 dark:placeholder:text-gray-600',
                        'disabled:cursor-not-allowed',
                        'min-w-0 font-medium tabular-nums'
                    )}
                />
            </div>

            {/* Error message */}
            {error && (
                <p className="text-red-400 text-[11px] mt-1.5 ml-1">
                    {error}
                </p>
            )}
        </div>
    );
};

export default React.memo(AmountInput);
