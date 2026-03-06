/**
 * UnificationPanel Component
 *
 * Collapsible "⚙ UNIFICATION" section containing three sub-sections
 * side by side: Comment, Amount, Currency.
 * Matches the wireframe layout with a bordered container.
 */

import React, { useState } from 'react';
import { Settings, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';
import UnifyCommentSection from './UnifyCommentSection';
import UnifyAmountSection from './UnifyAmountSection';
import UnifyCurrencySection from './UnifyCurrencySection';

const UnificationPanel: React.FC = () => {
    const [isExpanded, setIsExpanded] = useState(true);

    return (
        <div className="rounded-2xl border border-gray-200 dark:border-white/[0.06] bg-gray-50 dark:bg-white/[0.02]">
            {/* Header / Toggle */}
            <button
                type="button"
                onClick={() => setIsExpanded((prev) => !prev)}
                className={cn(
                    'w-full flex items-center gap-3 px-4 sm:px-6 py-3 sm:py-4 transition-colors duration-200',
                    'hover:bg-gray-100 dark:hover:bg-white/[0.02]',
                    isExpanded ? 'rounded-t-2xl' : 'rounded-2xl'
                )}
            >
                <Settings className="w-4 h-4 text-blue-400" />
                <span className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                    Unification
                </span>
                <ChevronDown
                    className={cn(
                        'w-4 h-4 text-gray-500 ml-auto transition-transform duration-200',
                        isExpanded && 'rotate-180'
                    )}
                />
            </button>

            {/* Expandable content */}
            {isExpanded && (
                <div className="px-4 sm:px-6 pb-4 sm:pb-6 pt-2">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-5">
                        {/* Comment Section */}
                        <div className="rounded-xl border border-gray-200 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] p-4 sm:p-5">
                            <UnifyCommentSection />
                        </div>

                        {/* Amount Section */}
                        <div className="rounded-xl border border-gray-200 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] p-4 sm:p-5">
                            <UnifyAmountSection />
                        </div>

                        {/* Currency Section */}
                        <div className="rounded-xl border border-gray-200 dark:border-white/[0.06] bg-white dark:bg-white/[0.02] p-4 sm:p-5">
                            <UnifyCurrencySection />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default React.memo(UnificationPanel);
