/**
 * UnifyCurrencySection Component
 *
 * Token dropdown with "Apply to All" button.
 * Sets the same coin/Jetton for every row in the multi-send list.
 */

import React, { useCallback } from 'react';
import { cn } from '../../lib/utils';
import { useMultiSend } from '../../context/MultiSendContext';
import CoinSelectorDropdown from './CoinSelectorDropdown';
import { NATIVE_TON } from '../../types/multisend';
import type { CoinInfo } from '../../types/multisend';

const UnifyCurrencySection: React.FC = () => {
    const {
        state,
        setUnifyCurrency,
        applyUnifyCurrency,
    } = useMultiSend();

    const selectedCoin = state.unification.currency.coin || NATIVE_TON;
    const isSending = state.execution.phase !== 'idle' && state.execution.phase !== 'complete' && state.execution.phase !== 'error';

    const handleCoinChange = useCallback(
        (coin: CoinInfo) => {
            setUnifyCurrency(coin);
        },
        [setUnifyCurrency]
    );

    const handleApply = useCallback(() => {
        applyUnifyCurrency();
    }, [applyUnifyCurrency]);

    return (
        <div className="flex flex-col gap-4">
            <h4 className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                Currency
            </h4>

            {/* Coin selector */}
            <CoinSelectorDropdown
                value={selectedCoin}
                onChange={handleCoinChange}
                disabled={isSending}
                placement="top"
            />

            {/* Apply button */}
            <button
                type="button"
                onClick={handleApply}
                disabled={isSending}
                className={cn(
                    'w-full h-[40px] rounded-xl text-sm font-semibold transition-all duration-200 border',
                    'bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-300 dark:border-blue-500/25',
                    'hover:bg-blue-100 dark:hover:bg-blue-500/20',
                    'disabled:opacity-40 disabled:cursor-not-allowed'
                )}
            >
                Apply to All
            </button>
        </div>
    );
};

export default React.memo(UnifyCurrencySection);
