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
    const [isExpanded, setIsExpanded] = useState(false);

    return (
        <div className="rounded-[24px] border border-gray-200 dark:border-white/[0.03] bg-gray-50 dark:bg-[#14161C]">
            {/* Header / Toggle */}
            <button
                type="button"
                onClick={() => setIsExpanded((prev) => !prev)}
                className={cn(
                    'w-full flex items-center gap-3 px-4 sm:px-6 py-4 sm:py-5 transition-colors duration-200',
                    'hover:bg-gray-100 dark:hover:bg-white/[0.02]',
                    isExpanded ? 'rounded-t-[24px]' : 'rounded-[24px]'
                )}
            >
                <Settings className="w-5 h-5 text-blue-500" />
                <span className="text-[13px] font-bold text-gray-800 dark:text-gray-200 uppercase tracking-wider">
                    Unification
                </span>
                <ChevronDown
                    className={cn(
                        'w-5 h-5 text-gray-500 ml-auto transition-transform duration-300',
                        isExpanded && 'rotate-180'
                    )}
                />
            </button>

            {/* Expandable content */}
            {isExpanded && (
                <div className="px-4 pb-5 pt-2">
                    <div className="flex flex-col gap-6">
                        {/* Comment Section */}
                        <div className="rounded-[18px] border border-transparent dark:border-white/[0.03] bg-white dark:bg-black/20 p-4 sm:p-5 w-full shadow-[inset_0_1px_4px_rgba(0,0,0,0.1)]">
                            <UnifyCommentSection />
                        </div>

                        {/* Amount Section */}
                        <div className="rounded-[18px] border border-transparent dark:border-white/[0.03] bg-white dark:bg-black/20 p-4 sm:p-5 w-full shadow-[inset_0_1px_4px_rgba(0,0,0,0.1)]">
                            <UnifyAmountSection />
                        </div>

                        {/* Currency Section */}
                        <div className="rounded-[18px] border border-transparent dark:border-white/[0.03] bg-white dark:bg-black/20 p-4 sm:p-5 w-full shadow-[inset_0_1px_4px_rgba(0,0,0,0.1)]">
                            <UnifyCurrencySection />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default React.memo(UnificationPanel);
