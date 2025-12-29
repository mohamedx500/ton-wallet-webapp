import React from 'react';
import { Wallet, Settings, Clock } from 'lucide-react';

interface BottomNavigationProps {
    darkMode: boolean;
    activeTab: string;
    setActiveTab: (tab: string) => void;
    language: string;
}

export default function BottomNavigation({ darkMode, activeTab, setActiveTab, language }: BottomNavigationProps) {
    return (
        <div className={`border-t ${darkMode ? 'border-gray-900 bg-gray-950' : 'border-gray-200 bg-white'}`}>
            <div className="grid grid-cols-3 gap-1 p-2">
                <button
                    onClick={() => setActiveTab('home')}
                    className={`flex flex-col items-center justify-center py-3 rounded-xl transition ${activeTab === 'home'
                        ? darkMode
                            ? 'bg-blue-950 text-blue-400'
                            : 'bg-blue-50 text-blue-600'
                        : darkMode
                            ? 'text-gray-500'
                            : 'text-gray-500'
                        }`}
                >
                    <Wallet size={22} />
                    <span className="text-xs mt-1 font-medium">
                        {language === 'ar' ? 'المحفظة' : 'Wallet'}
                    </span>
                </button>

                <button
                    onClick={() => setActiveTab('activity')}
                    className={`flex flex-col items-center justify-center py-3 rounded-xl transition ${activeTab === 'activity'
                        ? darkMode
                            ? 'bg-blue-950 text-blue-400'
                            : 'bg-blue-50 text-blue-600'
                        : darkMode
                            ? 'text-gray-500'
                            : 'text-gray-500'
                        }`}
                >
                    <Clock size={22} />
                    <span className="text-xs mt-1 font-medium">
                        {language === 'ar' ? 'النشاط' : 'Activity'}
                    </span>
                </button>

                <button
                    onClick={() => setActiveTab('settings')}
                    className={`flex flex-col items-center justify-center py-3 rounded-xl transition ${activeTab === 'settings'
                        ? darkMode
                            ? 'bg-blue-950 text-blue-400'
                            : 'bg-blue-50 text-blue-600'
                        : darkMode
                            ? 'text-gray-500'
                            : 'text-gray-500'
                        }`}
                >
                    <Settings size={22} />
                    <span className="text-xs mt-1 font-medium">
                        {language === 'ar' ? 'الإعدادات' : 'Settings'}
                    </span>
                </button>
            </div>
        </div>
    );
}
