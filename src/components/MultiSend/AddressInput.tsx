/**
 * AddressInput Component
 *
 * Specialized input for TON wallet addresses and .ton DNS domains.
 * Features:
 * - Detects .ton domains and shows a resolving spinner
 * - Inline validation with red border on invalid addresses
 * - Resolved address preview tooltip on successful DNS resolution
 * - Debounced validation (300ms)
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Loader2, CheckCircle2, AlertCircle, Globe } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { AddressStatus } from '../../types/multisend';

interface AddressInputProps {
    /** Current raw address value */
    value: string;
    /** Called when the user types a new value */
    onChange: (value: string) => void;
    /** Current resolution / validation status */
    addressStatus: AddressStatus;
    /** Resolved address (shown as tooltip on hover) */
    resolvedAddress: string | null;
    /** Error message to display below the input */
    error?: string;
    /** Callback to trigger DNS resolution externally */
    onResolve?: (address: string) => void;
    /** Placeholder text */
    placeholder?: string;
    /** Whether the input is disabled */
    disabled?: boolean;
}

/**
 * Quick local check — does the input look like a .ton domain?
 */
function isTonDomain(value: string): boolean {
    return value.trim().toLowerCase().endsWith('.ton');
}

/**
 * Basic format check for raw TON addresses.
 */
function looksLikeRawAddress(value: string): boolean {
    const trimmed = value.trim();
    if (!trimmed) return false;
    if (/^0:[a-fA-F0-9]{64}$/.test(trimmed)) return true;
    if (/^(EQ|UQ|kQ|0Q)[A-Za-z0-9_-]{46}$/.test(trimmed)) return true;
    return false;
}

const AddressInput: React.FC<AddressInputProps> = ({
    value,
    onChange,
    addressStatus,
    resolvedAddress,
    error,
    onResolve,
    placeholder = 'EQ... or UQ... or name.ton',
    disabled = false,
}) => {
    const [isFocused, setIsFocused] = useState(false);
    const [showTooltip, setShowTooltip] = useState(false);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Debounced validation / resolution trigger
    const handleChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const newValue = e.target.value;
            onChange(newValue);

            // Clear any pending debounce
            if (debounceRef.current) {
                clearTimeout(debounceRef.current);
            }

            debounceRef.current = setTimeout(() => {
                const trimmed = newValue.trim();
                if (!trimmed) return;

                if (isTonDomain(trimmed) && onResolve) {
                    onResolve(trimmed);
                }
            }, 300);
        },
        [onChange, onResolve]
    );

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, []);

    // Status icon
    const renderStatusIcon = () => {
        switch (addressStatus) {
            case 'resolving':
                return <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />;
            case 'valid':
                return <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
            case 'invalid':
                return <AlertCircle className="w-4 h-4 text-red-400" />;
            default:
                return null;
        }
    };

    // Detect if it's a .ton domain to show globe icon
    const isDomain = isTonDomain(value);
    const showResolvedTooltip = showTooltip && resolvedAddress && addressStatus === 'valid';

    // Border color logic
    const borderClass =
        addressStatus === 'invalid' || error
            ? 'border-red-500/40 focus-within:border-red-500/60'
            : addressStatus === 'valid'
                ? 'border-emerald-500/25 focus-within:border-emerald-500/50'
                : isFocused
                    ? 'border-blue-500/40' // Focus ring
                    : 'border-transparent dark:border-white/[0.03]';

    return (
        <div className="relative">
            <div
                className={cn(
                    'flex items-center gap-2 h-[46px] rounded-[14px] border px-4 transition-all duration-300',
                    'bg-gray-100 dark:bg-black/40',
                    borderClass,
                    isFocused && 'bg-white dark:bg-black/60 shadow-sm',
                    disabled && 'opacity-50 cursor-not-allowed'
                )}
                onMouseEnter={() => setShowTooltip(true)}
                onMouseLeave={() => setShowTooltip(false)}
            >
                {/* Domain indicator icon */}
                {isDomain && (
                    <Globe className="w-4 h-4 text-blue-400 flex-shrink-0" />
                )}

                <input
                    type="text"
                    value={value}
                    onChange={handleChange}
                    onFocus={() => setIsFocused(true)}
                    onBlur={() => setIsFocused(false)}
                    placeholder={placeholder}
                    disabled={disabled}
                    autoComplete="off"
                    spellCheck={false}
                    className={cn(
                        'flex-1 bg-transparent text-sm text-gray-800 dark:text-gray-200 outline-none',
                        'placeholder:text-gray-400 dark:placeholder:text-gray-600',
                        'disabled:cursor-not-allowed',
                        'min-w-0'
                    )}
                />

                {/* Status indicator */}
                <div className="flex-shrink-0">
                    {renderStatusIcon()}
                </div>
            </div>

            {/* Error message */}
            {error && addressStatus === 'invalid' && (
                <p className="text-red-400 text-[11px] mt-1.5 ml-1">
                    {error}
                </p>
            )}

            {/* Resolved address tooltip */}
            {showResolvedTooltip && (
                <div className="absolute left-0 top-full mt-1.5 z-50 px-3 py-2 rounded-xl bg-white dark:bg-[#1a1d28] border border-gray-200 dark:border-white/[0.08] shadow-xl">
                    <p className="text-xs text-gray-400">
                        Resolved: <span className="text-emerald-400 font-mono text-[11px]">{resolvedAddress}</span>
                    </p>
                </div>
            )}
        </div>
    );
};

export default React.memo(AddressInput);
