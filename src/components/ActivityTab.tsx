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
        <div className="px-6 pb-6 pt-2">
            <div className="flex items-center justify-between mb-4">
                <h3 className={`text-lg font-bold ${darkMode ? 'text-white' : 'text-gray-800'}`}>
                    {language === 'ar' ? 'سجل المعاملات' : 'Transactions'}
                </h3>
            </div>

            {/* Activity Filter */}
            <div className="flex gap-2 mb-4">
                <button
                    onClick={() => setActivityFilter('all')}
                    className={`px-4 py-2 rounded-full text-sm font-medium transition ${activityFilter === 'all'
                        ? 'bg-blue-600 text-white'
                        : darkMode
                            ? 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                >
                    {language === 'ar' ? 'الكل' : 'All'}
                </button>
                <button
                    onClick={() => setActivityFilter('received')}
                    className={`px-4 py-2 rounded-full text-sm font-medium transition ${activityFilter === 'received'
                        ? 'bg-green-600 text-white'
                        : darkMode
                            ? 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                >
                    {language === 'ar' ? 'المستلمة' : 'Received'}
                </button>
                <button
                    onClick={() => setActivityFilter('sent')}
                    className={`px-4 py-2 rounded-full text-sm font-medium transition ${activityFilter === 'sent'
                        ? 'bg-red-600 text-white'
                        : darkMode
                            ? 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                >
                    {language === 'ar' ? 'المرسلة' : 'Sent'}
                </button>
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
                            className={`p-4 ${darkMode ? 'bg-gray-900 hover:bg-gray-800' : 'bg-gray-50 hover:bg-gray-100'} rounded-xl transition cursor-pointer`}
                        >
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-3">
                                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${activity.type === 'received'
                                        ? darkMode ? 'bg-green-950' : 'bg-green-100'
                                        : darkMode ? 'bg-red-950' : 'bg-red-100'
                                        }`}>
                                        {activity.type === 'received' ? (
                                            <ArrowDownToLine size={18} className={darkMode ? 'text-green-400' : 'text-green-600'} />
                                        ) : (
                                            <Send size={18} className={darkMode ? 'text-red-400' : 'text-red-600'} />
                                        )}
                                    </div>
                                    <div>
                                        <p className={`font-medium ${darkMode ? 'text-white' : 'text-gray-800'}`}>
                                            {activity.type === 'received'
                                                ? (language === 'ar' ? 'استلام' : 'Receive')
                                                : (language === 'ar' ? 'إرسال' : 'Send')} {activity.token}
                                        </p>
                                        <div className={`flex items-center gap-2 text-xs ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                                            <Clock size={12} />
                                            <span>{activity.time}</span>
                                        </div>
                                    </div>
                                </div>
                                <div className="text-left">
                                    <p className={`font-bold ${activity.type === 'received'
                                        ? darkMode ? 'text-green-400' : 'text-green-600'
                                        : darkMode ? 'text-red-400' : 'text-red-600'
                                        }`}>
                                        {activity.amount}
                                    </p>
                                    <p className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>{activity.token}</p>
                                </div>
                            </div>

                            <div className={`flex items-center justify-between pt-2 border-t ${darkMode ? 'border-gray-800' : 'border-gray-200'}`}>
                                <div className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                                    {language === 'ar' ? 'من' : 'From'}: {activity.type === 'received' ? activity.from : activity.to}
                                </div>
                                <div className="flex items-center gap-1">
                                    <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                                    <span className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-600'}`}>
                                        {language === 'ar' ? activity.status : 'Completed'}
                                    </span>
                                </div>
                            </div>
                        </div>
                    ))}
            </div>
        </div>
    );
}
