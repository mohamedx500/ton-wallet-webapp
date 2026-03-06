/**
 * UnifyCommentSection Component
 *
 * Master comment input with "Apply All" button and two sorting toggles:
 * - Numeric (# + 1, 2, 3…)
 * - Alphabetic (A + A, B, C…)
 * Dispatches to MultiSendContext to instantly mutate all row comments.
 */

import React, { useCallback } from 'react';
import { cn } from '../../lib/utils';
import { useMultiSend } from '../../context/MultiSendContext';
import type { CommentSortingMode } from '../../types/multisend';

const UnifyCommentSection: React.FC = () => {
    const {
        state,
        setUnifyCommentBase,
        setUnifyCommentSorting,
        applyUnifyComment,
    } = useMultiSend();

    const { base, sorting } = state.unification.comment;
    const isSending = state.execution.phase !== 'idle' && state.execution.phase !== 'complete' && state.execution.phase !== 'error';

    const handleBaseChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            setUnifyCommentBase(e.target.value);
        },
        [setUnifyCommentBase]
    );

    const handleSortingToggle = useCallback(
        (mode: CommentSortingMode) => {
            // Toggle: if already active, switch to 'none'; otherwise activate
            const newMode = sorting === mode ? 'none' : mode;
            setUnifyCommentSorting(newMode);
        },
        [sorting, setUnifyCommentSorting]
    );

    const handleApply = useCallback(() => {
        applyUnifyComment();
    }, [applyUnifyComment]);

    return (
        <div className="flex flex-col gap-4">
            <h4 className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                Comment
            </h4>

            {/* Base comment input */}
            <input
                type="text"
                value={base}
                onChange={handleBaseChange}
                placeholder='e.g. "Salary"'
                disabled={isSending}
                autoComplete="off"
                className={cn(
                    'w-full h-[42px] rounded-xl border px-4',
                    'border-gray-200 bg-gray-50 text-gray-800 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200',
                    'text-sm outline-none transition-all duration-200',
                    'placeholder:text-gray-400 dark:placeholder:text-gray-600',
                    'hover:border-gray-300 dark:hover:border-white/[0.12] focus:border-blue-500/50 focus:bg-white dark:focus:bg-white/[0.05]',
                    'disabled:opacity-50 disabled:cursor-not-allowed'
                )}
            />

            {/* Apply button */}
            <button
                type="button"
                onClick={handleApply}
                disabled={isSending}
                className={cn(
                    'w-full h-[40px] rounded-xl text-sm font-semibold transition-all duration-200',
                    'bg-gray-100 text-gray-700 border border-gray-200 dark:bg-white/[0.06] dark:text-gray-200 dark:border-white/[0.08]',
                    'hover:bg-gray-200 dark:hover:bg-white/[0.1] hover:border-gray-300 dark:hover:border-white/[0.12]',
                    'disabled:opacity-40 disabled:cursor-not-allowed'
                )}
            >
                Apply All
            </button>

            {/* Sorting mode toggles */}
            <div className="flex gap-2">
                <button
                    type="button"
                    onClick={() => handleSortingToggle('numeric')}
                    disabled={isSending}
                    className={cn(
                        'flex-1 h-[38px] rounded-xl text-xs font-semibold transition-all duration-200 border truncate',
                        'disabled:opacity-40 disabled:cursor-not-allowed',
                        sorting === 'numeric'
                            ? 'bg-orange-50 dark:bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-300 dark:border-orange-500/30'
                            : 'bg-gray-50 dark:bg-white/[0.03] text-gray-500 dark:text-gray-400 border-gray-200 dark:border-white/[0.06] hover:text-gray-700 dark:hover:text-gray-200 hover:border-gray-300 dark:hover:border-white/[0.1]'
                    )}
                >
                    # + 1, 2, 3…
                </button>
                <button
                    type="button"
                    onClick={() => handleSortingToggle('alpha')}
                    disabled={isSending}
                    className={cn(
                        'flex-1 h-[38px] rounded-xl text-xs font-semibold transition-all duration-200 border truncate',
                        'disabled:opacity-40 disabled:cursor-not-allowed',
                        sorting === 'alpha'
                            ? 'bg-purple-50 dark:bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-300 dark:border-purple-500/30'
                            : 'bg-gray-50 dark:bg-white/[0.03] text-gray-500 dark:text-gray-400 border-gray-200 dark:border-white/[0.06] hover:text-gray-700 dark:hover:text-gray-200 hover:border-gray-300 dark:hover:border-white/[0.1]'
                    )}
                >
                    A + A, B, C…
                </button>
            </div>
        </div>
    );
};

export default React.memo(UnifyCommentSection);
