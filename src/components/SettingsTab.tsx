import React from 'react';
import { Shield, ChevronRight, Key, Moon, Bell, Globe, Wallet, LogOut } from 'lucide-react';

interface SettingsTabProps {
    darkMode: boolean;
    setDarkMode: (v: boolean) => void;
    language: string;
    setLanguage: (v: string) => void;
    walletType: string;
    notifications: boolean;
    setNotifications: (v: boolean) => void;
    setShowBackupModal: (v: boolean) => void;
    setShowPhraseModal: (v: boolean) => void;
    onLogout: () => void;
    onWalletTypeClick: () => void;
}

export default function SettingsTab({
    darkMode, setDarkMode, language, setLanguage, walletType,
    notifications, setNotifications, setShowBackupModal, setShowPhraseModal, onLogout, onWalletTypeClick
}: SettingsTabProps) {
    return (
        <div className="px-6 pb-6 pt-4">
            {/* Security Section */}
            <div className="mb-6">
                <h4 className={`text-sm font-bold ${darkMode ? 'text-gray-500' : 'text-gray-500'} mb-3 mr-2`}>
                    {language === 'ar' ? 'الأمان' : 'Security'}
                </h4>
                <div className="space-y-2">
                    <button
                        onClick={() => setShowBackupModal(true)}
                        className={`w-full ${darkMode ? 'bg-gray-900 hover:bg-gray-800' : 'bg-white hover:bg-gray-50'} rounded-xl p-4 flex items-center justify-between transition`}
                    >
                        <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 ${darkMode ? 'bg-blue-950' : 'bg-blue-100'} rounded-full flex items-center justify-center`}>
                                <Shield size={20} className={darkMode ? 'text-blue-400' : 'text-blue-600'} />
                            </div>
                            <div className="text-right">
                                <p className={`font-medium ${darkMode ? 'text-white' : 'text-gray-800'}`}>
                                    {language === 'ar' ? 'النسخ الاحتياطي' : 'Backup'}
                                </p>
                                <p className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                                    {language === 'ar' ? 'احفظ المحفظة بأمان' : 'Save wallet securely'}
                                </p>
                            </div>
                        </div>
                        <ChevronRight className={darkMode ? 'text-gray-600' : 'text-gray-400'} size={20} />
                    </button>


                </div>
            </div>

            {/* Preferences Section */}
            <div className="mb-6">
                <h4 className={`text-sm font-bold ${darkMode ? 'text-gray-500' : 'text-gray-500'} mb-3 mr-2`}>
                    {language === 'ar' ? 'التفضيلات' : 'Preferences'}
                </h4>
                <div className="space-y-2">
                    <div className={`w-full ${darkMode ? 'bg-gray-900' : 'bg-white'} rounded-xl p-4 flex items-center justify-between`}>
                        <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 ${darkMode ? 'bg-yellow-950' : 'bg-yellow-100'} rounded-full flex items-center justify-center`}>
                                <Moon size={20} className={darkMode ? 'text-yellow-400' : 'text-yellow-600'} />
                            </div>
                            <div className="text-right">
                                <p className={`font-medium ${darkMode ? 'text-white' : 'text-gray-800'}`}>
                                    {language === 'ar' ? 'الوضع الداكن' : 'Dark Mode'}
                                </p>
                                <p className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                                    {language === 'ar' ? 'تغيير المظهر' : 'Change appearance'}
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={() => setDarkMode(!darkMode)}
                            className={`relative w-12 h-6 rounded-full transition ${darkMode ? 'bg-blue-600' : 'bg-gray-300'
                                }`}
                        >
                            <div
                                className={`absolute w-5 h-5 bg-white rounded-full top-0.5 transition ${darkMode ? 'right-0.5' : 'right-6'
                                    }`}
                            ></div>
                        </button>
                    </div>

                    <div className={`w-full ${darkMode ? 'bg-gray-900' : 'bg-white'} rounded-xl p-4 flex items-center justify-between`}>
                        <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 ${darkMode ? 'bg-red-950' : 'bg-red-100'} rounded-full flex items-center justify-center`}>
                                <Bell size={20} className={darkMode ? 'text-red-400' : 'text-red-600'} />
                            </div>
                            <div className="text-right">
                                <p className={`font-medium ${darkMode ? 'text-white' : 'text-gray-800'}`}>
                                    {language === 'ar' ? 'الإشعارات' : 'Notifications'}
                                </p>
                                <p className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                                    {language === 'ar' ? 'تنبيهات المعاملات' : 'Transaction alerts'}
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={() => setNotifications(!notifications)}
                            className={`relative w-12 h-6 rounded-full transition ${notifications ? 'bg-blue-600' : 'bg-gray-300'
                                }`}
                        >
                            <div
                                className={`absolute w-5 h-5 bg-white rounded-full top-0.5 transition ${notifications ? 'right-0.5' : 'right-6'
                                    }`}
                            ></div>
                        </button>
                    </div>

                    <button
                        onClick={() => setLanguage(language === 'ar' ? 'en' : 'ar')}
                        className={`w-full ${darkMode ? 'bg-gray-900 hover:bg-gray-800' : 'bg-white hover:bg-gray-50'} rounded-xl p-4 flex items-center justify-between transition`}
                    >
                        <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 ${darkMode ? 'bg-green-950' : 'bg-green-100'} rounded-full flex items-center justify-center`}>
                                <Globe size={20} className={darkMode ? 'text-green-400' : 'text-green-600'} />
                            </div>
                            <div className="text-right">
                                <p className={`font-medium ${darkMode ? 'text-white' : 'text-gray-800'}`}>
                                    {language === 'ar' ? 'اللغة' : 'Language'}
                                </p>
                                <p className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                                    {language === 'ar' ? 'العربية' : 'English'}
                                </p>
                            </div>
                        </div>
                        <div className={`text-sm font-medium px-3 py-1 rounded-full ${darkMode ? 'bg-gray-800 text-gray-300' : 'bg-gray-100 text-gray-600'}`}>
                            {language === 'ar' ? 'EN' : 'ع'}
                        </div>
                    </button>

                    <button
                        onClick={onWalletTypeClick}
                        className={`w-full ${darkMode ? 'bg-gray-900 hover:bg-gray-800' : 'bg-white hover:bg-gray-50'} rounded-xl p-4 flex items-center justify-between transition`}
                    >
                        <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 ${darkMode ? 'bg-indigo-950' : 'bg-indigo-100'} rounded-full flex items-center justify-center`}>
                                <Wallet size={20} className={darkMode ? 'text-indigo-400' : 'text-indigo-600'} />
                            </div>
                            <div className="text-right">
                                <p className={`font-medium ${darkMode ? 'text-white' : 'text-gray-800'}`}>
                                    {language === 'ar' ? 'نوع المحفظة' : 'Wallet Type'}
                                </p>
                                <p className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                                    {language === 'ar' ? 'تبديل الإصدار' : 'Switch version'}
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className={`text-sm font-medium ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>{walletType}</span>
                            <ChevronRight className={darkMode ? 'text-gray-600' : 'text-gray-400'} size={20} />
                        </div>
                    </button>
                </div>
            </div>

            {/* Logout Button */}
            <button
                onClick={onLogout}
                className={`w-full ${darkMode ? 'bg-red-950 text-red-400 hover:bg-red-900' : 'bg-red-50 text-red-600 hover:bg-red-100'} rounded-xl p-4 flex items-center justify-center gap-2 transition font-medium`}
            >
                <LogOut size={20} />
                {language === 'ar' ? 'تسجيل الخروج' : 'Logout'}
            </button>
        </div>
    );
}
