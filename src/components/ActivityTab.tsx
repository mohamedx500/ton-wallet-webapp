import React from 'react';
import { ArrowDownToLine, Send, Clock } from 'lucide-react';

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
                {['all', 'received', 'sent'].map((filter) => (
                    <button
                        key={filter}
                        onClick={() => setActivityFilter(filter)}
                        className={`px-4 py-2 rounded-xl text-xs font-semibold transition ${activityFilter === filter
                            ? (darkMode ? 'bg-white text-black' : 'bg-black text-white')
                            : (darkMode ? 'bg-gray-800 text-gray-400 hover:bg-gray-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')
                            }`}
                    >
                        {filter === 'all' && (language === 'ar' ? 'الكل' : 'All')}
                        {filter === 'received' && (language === 'ar' ? 'المستلمة' : 'Received')}
                        {filter === 'sent' && (language === 'ar' ? 'المرسلة' : 'Sent')}
                    </button>
                ))}
            </div>

            <div className="space-y-3">
                {activities
                    .filter(activity => {
                        if (activityFilter === 'all') return true;
                        if (activityFilter === 'received') return activity.type === 'received';
                        if (activityFilter === 'sent') return activity.type === 'sent';
                        return true;
                    })
                    .map((activity, idx) => (
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
                                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${activity.type === 'received'
                                            ? (darkMode ? 'bg-green-500/10 text-green-400' : 'bg-green-100 text-green-600')
                                            : (darkMode ? 'bg-red-500/10 text-red-400' : 'bg-red-100 text-red-600')
                                        }`}>
                                        {activity.type === 'received' ? (
                                            <ArrowDownToLine size={18} />
                                        ) : (
                                            <Send size={18} />
                                        )}
                                    </div>

                                    <div>
                                        <div className="flex items-center gap-2">
                                            <p className={`font-semibold text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                                                {activity.type === 'received'
                                                    ? (language === 'ar' ? 'استلام' : 'Receive')
                                                    : (language === 'ar' ? 'إرسال' : 'Send')}
                                            </p>
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-medium ${activity.status === 'completed'
                                                ? (darkMode ? 'bg-green-500/10 text-green-400' : 'bg-green-50 text-green-700')
                                                : (darkMode ? 'bg-yellow-500/10 text-yellow-400' : 'bg-yellow-50 text-yellow-700')
                                                }`}>
                                                {/* simplified status */}
                                                {activity.token}
                                            </span>
                                        </div>
                                        <div className={`flex items-center gap-2 text-xs mt-1 ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                                            <span>{activity.time}</span>
                                            <span>•</span>
                                            <span className="truncate max-w-[100px]">
                                                {activity.type === 'received'
                                                    ? (language === 'ar' ? 'من' : 'From')
                                                    : (language === 'ar' ? 'إلى' : 'To')
                                                }: {activity.type === 'received' ? activity.from : activity.to}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                <div className="text-right">
                                    <p className={`font-bold text-sm ${activity.type === 'received'
                                            ? 'text-green-600 dark:text-green-400'
                                            : 'text-red-600 dark:text-red-400'
                                        }`}>
                                        {activity.type === 'received' ? '+' : '-'}{activity.amount}
                                    </p>
                                    <p className={`text-xs font-medium ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                                        {activity.token}
                                    </p>
                                </div>
                            </div>
                        </div>
                    ))}

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
