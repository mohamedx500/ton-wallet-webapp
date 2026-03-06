import React from 'react';
import { ArrowDown, ArrowUp, ArrowLeftRight, XCircle, Inbox } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '../lib/utils';

interface ActivityTabProps {
    darkMode: boolean;
    language: string;
    activityFilter: string;
    setActivityFilter: (v: string) => void;
    activities: any[];
    setSelectedTransaction: (v: any) => void;
}

const filters = [
    { id: 'all', labelEn: 'All', labelAr: 'الكل' },
    { id: 'received', labelEn: 'Received', labelAr: 'المستلمة' },
    { id: 'sent', labelEn: 'Sent', labelAr: 'المرسلة' },
    { id: 'swap', labelEn: 'Swap', labelAr: 'مبادلة' },
    { id: 'failed', labelEn: 'Failed', labelAr: 'فاشلة' },
];

function getDateLabel(timeStr: string, language: string): string {
    try {
        // Parse the time string — expected formats: "M/D/YYYY, H:MM:SS PM" or similar
        const date = new Date(timeStr);
        if (isNaN(date.getTime())) return timeStr;

        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const txDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

        if (txDate.getTime() === today.getTime()) {
            return language === 'ar' ? 'اليوم' : 'Today';
        }
        if (txDate.getTime() === yesterday.getTime()) {
            return language === 'ar' ? 'أمس' : 'Yesterday';
        }
        return date.toLocaleDateString(language === 'ar' ? 'ar-EG' : 'en-US', {
            weekday: 'long',
            month: 'short',
            day: 'numeric',
        });
    } catch {
        return timeStr;
    }
}

function groupByDate(activities: any[], language: string): { label: string; items: any[] }[] {
    const groups: { label: string; items: any[] }[] = [];
    let currentLabel = '';

    for (const activity of activities) {
        const label = getDateLabel(activity.time, language);
        if (label !== currentLabel) {
            currentLabel = label;
            groups.push({ label, items: [] });
        }
        groups[groups.length - 1].items.push(activity);
    }
    return groups;
}

function getIconConfig(activity: any, darkMode: boolean) {
    if (activity.status === 'failed') {
        return { Icon: XCircle, bg: darkMode ? 'bg-red-500/10 text-red-400 ring-1 ring-red-500/20' : 'bg-red-50 text-red-500 ring-1 ring-red-200/60' };
    }
    if (activity.type === 'received') {
        return { Icon: ArrowDown, bg: darkMode ? 'bg-green-500/10 text-green-400 ring-1 ring-green-500/20' : 'bg-green-50 text-green-600 ring-1 ring-green-200/60' };
    }
    if (activity.type === 'swap') {
        return { Icon: ArrowLeftRight, bg: darkMode ? 'bg-blue-500/10 text-blue-400 ring-1 ring-blue-500/20' : 'bg-blue-50 text-blue-600 ring-1 ring-blue-200/60' };
    }
    return { Icon: ArrowUp, bg: darkMode ? 'bg-white/5 text-gray-400 ring-1 ring-white/10' : 'bg-gray-100 text-gray-500 ring-1 ring-gray-200/60' };
}

function getTimeOnly(timeStr: string): string {
    try {
        const date = new Date(timeStr);
        if (isNaN(date.getTime())) return timeStr;
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
        return timeStr;
    }
}

export default function ActivityTab({ darkMode, language, activityFilter, setActivityFilter, activities, setSelectedTransaction }: ActivityTabProps) {
    const filtered = activities.filter(activity => {
        if (activityFilter === 'all') return true;
        if (activityFilter === 'failed') return activity.status === 'failed';
        if (activityFilter === 'received') return activity.type === 'received' && activity.status !== 'failed';
        if (activityFilter === 'sent') return activity.type === 'sent' && activity.status !== 'failed';
        if (activityFilter === 'swap') return activity.type === 'swap' && activity.status !== 'failed';
        return true;
    });

    const dateGroups = groupByDate(filtered, language);

    return (
        <div className="px-5 pb-6 pt-3">
            <h3 className={cn("text-base font-extrabold tracking-tight mb-3", darkMode ? "text-gray-200" : "text-black")}>
                {language === 'ar' ? 'سجل المعاملات' : 'Transactions'}
            </h3>

            {/* Filter Pills - with animated indicator */}
            <div className={cn("p-1 flex gap-0.5 mb-5 overflow-x-auto no-scrollbar rounded-xl", darkMode ? "bg-white/[0.03] ring-1 ring-white/[0.06]" : "bg-gray-100/60 ring-1 ring-black/[0.03]")}>
                {filters.map(({ id, labelEn, labelAr }) => (
                    <button
                        key={id}
                        onClick={() => setActivityFilter(id)}
                        className={cn(
                            "relative flex-1 py-1.5 rounded-lg text-[11px] font-bold transition-colors whitespace-nowrap z-[1]",
                            activityFilter === id
                                ? "text-white"
                                : darkMode ? "text-gray-500 hover:text-gray-300" : "text-gray-400 hover:text-gray-600"
                        )}
                    >
                        {activityFilter === id && (
                            <motion.div
                                layoutId="activityFilterBg"
                                className="absolute inset-0 rounded-lg bg-gradient-to-r from-blue-500 to-blue-600 shadow-sm"
                                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                            />
                        )}
                        <span className="relative z-[1]">{language === 'ar' ? labelAr : labelEn}</span>
                    </button>
                ))}
            </div>

            {/* Transaction List - grouped by date */}
            {filtered.length > 0 ? (
                <div className="space-y-4">
                    {dateGroups.map((group, gi) => (
                        <div key={gi}>
                            {/* Date Header */}
                            <div className="flex items-center gap-3 mb-2 px-1">
                                <h4 className={cn("text-base font-bold uppercase tracking-wider flex-shrink-0", darkMode ? "text-gray-300" : "text-black")}>
                                    {group.label}
                                </h4>
                                <div className={cn("h-px flex-1", darkMode ? "bg-white/[0.06]" : "bg-gray-200/80")} />
                            </div>

                            {/* Transactions Card */}
                            <div className={cn("rounded-2xl overflow-hidden divide-y", darkMode ? "bg-white/[0.025] ring-1 ring-white/[0.06] divide-white/[0.05]" : "bg-white ring-1 ring-black/[0.04] divide-gray-100 shadow-sm shadow-black/[0.02]")}>
                                {group.items.map((activity, idx) => {
                                    const { Icon, bg } = getIconConfig(activity, darkMode);
                                    const label = activity.status === 'failed'
                                        ? (language === 'ar' ? 'فشل' : 'Failed')
                                        : activity.type === 'received'
                                            ? (language === 'ar' ? 'استلام' : 'Received')
                                            : activity.type === 'swap'
                                                ? (language === 'ar' ? 'مبادلة' : 'Swap')
                                                : (language === 'ar' ? 'إرسال' : 'Sent');

                                    return (
                                        <button
                                            key={idx}
                                            onClick={() => setSelectedTransaction(activity)}
                                            className={cn(
                                                "w-full px-4 py-3 transition-all cursor-pointer flex items-center justify-between text-left active:scale-[0.99]",
                                                darkMode ? "hover:bg-white/[0.03]" : "hover:bg-gray-50/80"
                                            )}
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0", bg)}>
                                                    <Icon size={18} strokeWidth={2.2} />
                                                </div>
                                                <div>
                                                    <div className="flex items-center gap-2">
                                                        <p className={cn("font-bold text-sm", darkMode ? "text-white" : "text-black")}>
                                                            {label}
                                                        </p>
                                                        <span className={cn("text-[11px] px-1.5 py-0.5 rounded-md font-bold", darkMode ? "bg-white/5 text-gray-400" : "bg-gray-100 text-gray-600")}>
                                                            {activity.token}
                                                        </span>
                                                    </div>
                                                    <p className={cn("text-xs mt-0.5 tabular-nums font-medium", darkMode ? "text-gray-500" : "text-gray-600")}>
                                                        {getTimeOnly(activity.time)}
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="text-right flex-shrink-0 ml-3">
                                                {activity.type === 'swap' ? (
                                                    <>
                                                        <p className="font-bold text-sm text-red-600 tabular-nums">
                                                            -{activity.amount || '0.00'} <span className="font-semibold opacity-70">{activity.fromToken}</span>
                                                        </p>
                                                        <p className="font-bold text-sm text-green-600 tabular-nums">
                                                            +{activity.amountOut ? (Number(activity.amountOut) / Math.pow(10, activity.decimalsOut || 9)).toFixed(2) : '0.00'} <span className="font-semibold opacity-70">{activity.toToken}</span>
                                                        </p>
                                                    </>
                                                ) : (
                                                    <>
                                                        <p className={cn("font-bold text-base tabular-nums", activity.status === 'failed' ? 'text-red-600' : activity.type === 'received' ? 'text-green-600' : darkMode ? 'text-white' : 'text-black')}>
                                                            {activity.type === 'received' ? '+' : '-'}{activity.amount || '0.00'}
                                                        </p>
                                                        <p className={cn("text-xs font-medium", darkMode ? "text-gray-500" : "text-gray-600")}>
                                                            {activity.token}
                                                        </p>
                                                    </>
                                                )}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className={cn("rounded-2xl text-center py-16", darkMode ? "bg-white/[0.025] ring-1 ring-white/[0.06] text-gray-600" : "bg-white ring-1 ring-black/[0.04] text-gray-400 shadow-sm")}>
                    <div className={cn("w-14 h-14 rounded-2xl mx-auto mb-3 flex items-center justify-center", darkMode ? "bg-white/5 ring-1 ring-white/10" : "bg-gray-50 ring-1 ring-gray-100")}>
                        <Inbox size={22} className="opacity-40" />
                    </div>
                    <p className="text-sm font-medium">{language === 'ar' ? 'لا توجد معاملات بعد' : 'No transactions yet'}</p>
                </div>
            )}
        </div>
    );
}
