/**
 * ModeSelectorBar Component
 *
 * CRITICAL LOGIC:
 * - W5: FORCED to "Batches" mode only. No toggle shown. Displays hint about 254 chunks + 5s delay.
 * - Highload V3: Shows toggle with exactly TWO options:
 *   1. Batches: Groups transfers into chunks of 254, fires simultaneously
 *   2. Parallel Individual: Sends separate TX to each person in the same second
 */

import React, { useCallback } from 'react';
import { Layers, Zap, Clock, Info } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useMultiSend } from '../../context/MultiSendContext';
import type { HighloadMode } from '../../types/multisend';

const ModeSelectorBar: React.FC = () => {
    const { state, setHighloadMode } = useMultiSend();
    const { walletType, highloadMode } = state;
    const isSending = state.execution.phase !== 'idle' && state.execution.phase !== 'complete' && state.execution.phase !== 'error';

    const handleHighloadModeChange = useCallback(
        (m: HighloadMode) => {
            if (!isSending) setHighloadMode(m);
        },
        [isSending, setHighloadMode]
    );

    const isHighload = walletType === 'highload-v3';
    const isW5 = walletType === 'v5r1';

    return (
        <div className="flex flex-col gap-2">
            {/* W5: Forced Batches Mode - No Toggle */}
            {isW5 && (
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/25">
                        <Layers className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                        <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                            Batches Only
                        </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
                        <Clock className="w-3 h-3 flex-shrink-0" />
                        <span>Chunks of 254 · 5s delay</span>
                    </div>
                </div>
            )}

            {/* Highload V3: Toggle between Batches and Parallel Individual */}
            {isHighload && (
                <div className="flex flex-col gap-2">
                    <div className="flex items-center rounded-lg border border-gray-200 dark:border-white/[0.08] bg-gray-100 dark:bg-white/[0.02] p-0.5">
                        <button
                            type="button"
                            onClick={() => handleHighloadModeChange('batches')}
                            disabled={isSending}
                            className={cn(
                                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all duration-200 flex-1 justify-center',
                                'disabled:cursor-not-allowed disabled:opacity-50',
                                highloadMode === 'batches'
                                    ? 'bg-blue-500 text-white shadow-sm'
                                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                            )}
                        >
                            <Layers className="w-3.5 h-3.5" />
                            Batches
                        </button>
                        <button
                            type="button"
                            onClick={() => handleHighloadModeChange('individual')}
                            disabled={isSending}
                            className={cn(
                                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all duration-200 flex-1 justify-center',
                                'disabled:cursor-not-allowed disabled:opacity-50',
                                highloadMode === 'individual'
                                    ? 'bg-purple-500 text-white shadow-sm'
                                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                            )}
                        >
                            <Zap className="w-3.5 h-3.5" />
                            <span className="truncate">Parallel Individual</span>
                        </button>
                    </div>

                    {/* Contextual hint for selected mode */}
                    <div className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
                        <Info className="w-3 h-3 flex-shrink-0" />
                        <span>
                            {highloadMode === 'batches'
                                ? 'Groups into chunks of 254, fires all simultaneously'
                                : 'Sends 1 TX per recipient, all in the same second'}
                        </span>
                    </div>
                </div>
            )}
        </div>
    );
};

export default React.memo(ModeSelectorBar);
