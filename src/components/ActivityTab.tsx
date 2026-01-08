import React from 'react';
import { ArrowDownToLine, Send, Clock, RefreshCw, AlertCircle } from 'lucide-react';

interface ActivityTabProps {
    darkMode: boolean;
    language: string;
    activityFilter: string;
    setActivityFilter: (v: string) => void;
    activities: any[];
    setSelectedTransaction: (v: any) => void;
}

export default function ActivityTab({ darkMode, language, activityFilter, setActivityFilter, activities, setSelectedTransaction }: ActivityTabProps) {
    return (
        <div className="px-5 pb-6 pt-2">
            <div className="flex items-center justify-between mb-4">
                <h3 className={`text-lg font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                    {language === 'ar' ? 'سجل المعاملات' : 'Transactions'}
                </h3>
            </div>

            {/* Activity Filter - Cleaner Look */}
            <div className="flex gap-2 mb-4 overflow-x-auto no-scrollbar">
                {['all', 'received', 'sent', 'swap', 'failed'].map((filter) => (
                    <button
                        key={filter}
                        onClick={() => setActivityFilter(filter)}
                        className={`px-4 py-2 rounded-xl text-xs font-semibold transition whitespace-nowrap ${activityFilter === filter
                            ? (darkMode ? 'bg-white text-black' : 'bg-black text-white')
                            : (darkMode ? 'bg-gray-800 text-gray-400 hover:bg-gray-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')
                            }`}
                    >
                        {filter === 'all' && (language === 'ar' ? 'الكل' : 'All')}
                        {filter === 'received' && (language === 'ar' ? 'المستلمة' : 'Received')}
                        {filter === 'sent' && (language === 'ar' ? 'المرسلة' : 'Sent')}
                        {filter === 'swap' && (language === 'ar' ? 'مبادلة' : 'Swap')}
                        {filter === 'failed' && (language === 'ar' ? 'فاشلة' : 'Failed')}
                    </button>
                ))}
            </div>

            <div className="space-y-3">
                {activities
                    .filter(activity => {
                        if (activityFilter === 'all') return true;
                        if (activityFilter === 'failed') return activity.status === 'failed';
                        if (activityFilter === 'received') return activity.type === 'received' && activity.status !== 'failed';
                        if (activityFilter === 'sent') return activity.type === 'sent' && activity.status !== 'failed';
                        if (activityFilter === 'swap') return activity.type === 'swap' && activity.status !== 'failed';
                        return true;
                    })
                    .map((activity, idx) => {
                        // Determine Icon and Color based on type and status
                        let Icon = Send;
                        let colorClass = '';

                        if (activity.status === 'failed') {
                            Icon = AlertCircle;
                            colorClass = darkMode ? 'bg-red-500/10 text-red-400' : 'bg-red-100 text-red-600';
                        } else if (activity.type === 'received') {
                            Icon = ArrowDownToLine;
                            colorClass = darkMode ? 'bg-green-500/10 text-green-400' : 'bg-green-100 text-green-600';
                        } else if (activity.type === 'swap') {
                            Icon = RefreshCw;
                            colorClass = darkMode ? 'bg-blue-500/10 text-blue-400' : 'bg-blue-100 text-blue-600';
                        } else {
                            // Sent
                            Icon = Send;
                            colorClass = darkMode ? 'bg-gray-500/10 text-gray-400' : 'bg-gray-100 text-gray-600';
                        }

                        return (
                            <div
                                key={idx}
                                onClick={() => setSelectedTransaction(activity)}
                                className={`p-4 rounded-2xl transition cursor-pointer border ${darkMode
                                    ? 'bg-gray-900 border-gray-800 hover:bg-gray-800'
                                    : 'bg-white border-gray-100 hover:bg-gray-50 hover:shadow-sm'
                                    }`}
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-4">
                                        {/* Colored Icon */}
                                        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${colorClass}`}>
                                            <Icon size={18} />
                                        </div>

                                        <div>
                                            <div className="flex items-center gap-2">
                                                <p className={`font-semibold text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                                                    {activity.status === 'failed'
                                                        ? (language === 'ar' ? 'فشل' : 'Failed')
                                                        : activity.type === 'received'
                                                            ? (language === 'ar' ? 'استلام' : 'Receive')
                                                            : activity.type === 'swap'
                                                                ? (language === 'ar' ? 'مبادلة' : 'Swap')
                                                                : (language === 'ar' ? 'إرسال' : 'Send')
                                                    }
                                                </p>
                                                <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-medium ${activity.status === 'failed'
                                                    ? (darkMode ? 'bg-red-500/10 text-red-400' : 'bg-red-50 text-red-700')
                                                    : (darkMode ? 'bg-gray-500/10 text-gray-400' : 'bg-gray-100 text-gray-600')
                                                    }`}>
                                                    {activity.token}
                                                </span>
                                            </div>
                                            <div className={`flex items-center gap-2 text-xs mt-1 ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                                                <span>{activity.time}</span>
                                                {/* Hide To/From for swaps if simpler */}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="text-right">
                                        {activity.type === 'swap' ? (
                                            <>
                                                <p className="font-bold text-sm text-red-500">
                                                    -{activity.amount || '0.00'} <span className="text-xs font-normal">{activity.fromToken}</span>
                                                </p>
                                                <p className="font-bold text-sm text-green-500">
                                                    +{activity.amountOut ? (Number(activity.amountOut) / Math.pow(10, activity.decimalsOut || 9)).toFixed(2) : '0.00'} <span className="text-xs font-normal">{activity.toToken}</span>
                                                </p>
                                            </>
                                        ) : (
                                            <>
                                                <p className={`font-bold text-sm ${activity.status === 'failed'
                                                        ? 'text-red-500'
                                                        : activity.type === 'received'
                                                            ? 'text-green-500'
                                                            : 'text-red-500'
                                                    }`}>
                                                    {activity.type === 'received' ? '+' : '-'}{activity.amount || '0.00'}
                                                </p>
                                                <p className={`text-xs font-medium ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                                                    {activity.token}
                                                </p>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}

                {activities.length === 0 && (
                    <div className={`text-center py-10 ${darkMode ? 'text-gray-600' : 'text-gray-400'}`}>
                        <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 mx-auto mb-3 flex items-center justify-center">
                            <Clock size={24} className="opacity-50" />
                        </div>
                        <p>{language === 'ar' ? 'لا توجد معاملات بعد' : 'No transactions yet'}</p>
                    </div>
                )}
            </div>
        </div>
    );
}
