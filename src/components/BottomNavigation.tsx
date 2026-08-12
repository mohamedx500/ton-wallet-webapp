import React from 'react';
import { Wallet, SlidersHorizontal, ArrowLeftRight, Users } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '../lib/utils';

interface BottomNavigationProps {
    darkMode: boolean;
    activeTab: string;
    setActiveTab: (tab: string) => void;
    language: string;
    onBulkClick: () => void;
}

const tabs = [
    { id: 'home', icon: Wallet, labelEn: 'Wallet', labelAr: 'المحفظة' },
    { id: 'activity', icon: ArrowLeftRight, labelEn: 'Activity', labelAr: 'النشاط' },
    { id: 'bulk', icon: Users, labelEn: 'Bulk', labelAr: 'جماعي' },
    { id: 'settings', icon: SlidersHorizontal, labelEn: 'Settings', labelAr: 'الإعدادات' },
];

export default function BottomNavigation({
    darkMode,
    activeTab,
    setActiveTab,
    language,
    onBulkClick,
}: BottomNavigationProps) {
    return (
        <div className="px-4 pb-3 pt-1.5">
            <div className={cn('glass-card p-1.5 grid grid-cols-4 gap-1 relative')}>
                {tabs.map(({ id, icon: Icon, labelEn, labelAr }) => {
                    const isBulk = id === 'bulk';
                    const isActive = !isBulk && activeTab === id;
                    return (
                        <button
                            key={id}
                            type="button"
                            onClick={() => {
                                if (isBulk) onBulkClick();
                                else setActiveTab(id);
                            }}
                            className={cn(
                                'relative flex flex-col items-center justify-center py-2 rounded-xl transition-colors z-[1]',
                                isActive
                                    ? darkMode
                                        ? 'text-blue-400'
                                        : 'text-blue-600'
                                    : darkMode
                                        ? 'text-gray-600 hover:text-gray-400'
                                        : 'text-gray-400 hover:text-gray-600',
                            )}
                        >
                            {isActive && (
                                <motion.div
                                    layoutId="activeTabBg"
                                    className={cn(
                                        'absolute inset-0 rounded-xl',
                                        darkMode
                                            ? 'bg-white/[0.06] ring-1 ring-white/10'
                                            : 'bg-white shadow-sm ring-1 ring-black/[0.04]',
                                    )}
                                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                                />
                            )}
                            <motion.div
                                animate={{ scale: isActive ? 1 : 0.9 }}
                                transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                                className="relative z-[1]"
                            >
                                <Icon size={22} strokeWidth={isActive ? 2 : 1.5} className="mb-0.5" />
                            </motion.div>
                            <span className={cn('text-[10px] font-semibold relative z-[1]', isActive && 'tracking-wide')}>
                                {language === 'ar' ? labelAr : labelEn}
                            </span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
