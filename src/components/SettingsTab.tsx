import React from 'react';
import { ShieldCheck, ChevronRight, Moon, BellRing, Languages, Wallet, LogOut, Globe, Link2 } from 'lucide-react';
import { cn } from '../lib/utils';

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
    onConnectedAppsClick: () => void;
    connectedAppsCount: number;
    network: 'mainnet' | 'testnet';
    onNetworkChange: (n: 'mainnet' | 'testnet') => void;
}

function Toggle({ checked, onChange, darkMode }: { checked: boolean; onChange: () => void; darkMode: boolean }) {
    return (
        <button
            onClick={onChange}
            className={cn(
                "relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ring-1",
                checked
                    ? "bg-blue-500 ring-blue-400/30"
                    : darkMode ? "bg-white/10 ring-white/10" : "bg-gray-200 ring-black/[0.04]"
            )}
        >
            <div className={cn("absolute w-5 h-5 bg-white rounded-full top-0.5 transition-all shadow-sm", checked ? "left-[22px]" : "left-0.5")} />
        </button>
    );
}

function SettingsRow({ icon: Icon, label, sublabel, darkMode, onClick, trailing, isLast }: {
    icon: any; label: string; sublabel: string; darkMode: boolean; onClick?: () => void; trailing?: React.ReactNode; isLast?: boolean;
}) {
    const Comp = onClick ? 'button' : 'div';
    return (
        <Comp
            onClick={onClick}
            className={cn(
                "w-full flex items-center justify-between px-4 py-3.5 transition-all text-left",
                onClick && "active:scale-[0.99]",
                darkMode ? "hover:bg-white/[0.03]" : "hover:bg-black/[0.02]",
                !isLast && (darkMode ? "border-b border-white/[0.06]" : "border-b border-black/[0.04]")
            )}
        >
            <div className="flex items-center gap-3">
                <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ring-1", darkMode ? "bg-white/5 text-gray-400 ring-white/10" : "bg-gray-50 text-gray-500 ring-black/[0.06]")}>
                    <Icon size={18} strokeWidth={1.8} />
                </div>
                <div>
                    <p className={cn("text-sm font-semibold", darkMode ? "text-white" : "text-gray-900")}>{label}</p>
                    <p className={cn("text-[11px]", darkMode ? "text-gray-500" : "text-gray-400")}>{sublabel}</p>
                </div>
            </div>
            {trailing}
        </Comp>
    );
}

/** Mainnet ↔ Testnet network switch pill */
function NetworkSwitch({ network, onChange, darkMode, language }: {
    network: 'mainnet' | 'testnet';
    onChange: (n: 'mainnet' | 'testnet') => void;
    darkMode: boolean;
    language: string;
}) {
    const isTestnet = network === 'testnet';
    return (
        <div className={cn(
            "flex items-center gap-1 p-1 rounded-xl ring-1",
            darkMode ? "bg-white/[0.04] ring-white/10" : "bg-black/[0.03] ring-black/[0.06]"
        )}>
            <button
                onClick={() => onChange('mainnet')}
                className={cn(
                    "text-[11px] font-bold px-3 py-1 rounded-lg transition-all",
                    !isTestnet
                        ? "bg-blue-500 text-white shadow-sm shadow-blue-500/30"
                        : darkMode ? "text-gray-500 hover:text-gray-400" : "text-gray-400 hover:text-gray-600"
                )}
            >
                {language === 'ar' ? 'رئيسية' : 'Mainnet'}
            </button>
            <button
                onClick={() => onChange('testnet')}
                className={cn(
                    "text-[11px] font-bold px-3 py-1 rounded-lg transition-all",
                    isTestnet
                        ? "bg-amber-500 text-white shadow-sm shadow-amber-500/30"
                        : darkMode ? "text-gray-500 hover:text-gray-400" : "text-gray-400 hover:text-gray-600"
                )}
            >
                {language === 'ar' ? 'تجريبية' : 'Testnet'}
            </button>
        </div>
    );
}

export default function SettingsTab({
    darkMode, setDarkMode, language, setLanguage, walletType,
    notifications, setNotifications, setShowBackupModal, setShowPhraseModal,
    onLogout, onWalletTypeClick, onConnectedAppsClick, connectedAppsCount,
    network, onNetworkChange
}: SettingsTabProps) {
    return (
        <div className="px-5 pb-6 pt-3">
            {/* Network */}
            <p className={cn("text-[11px] font-bold uppercase tracking-wider mb-2 px-1", darkMode ? "text-blue-400/50" : "text-gray-400")}>
                {language === 'ar' ? 'الشبكة' : 'Network'}
            </p>
            <div className="glass-card overflow-hidden mb-5">
                <SettingsRow
                    icon={Globe}
                    label={language === 'ar' ? 'الشبكة النشطة' : 'Active Network'}
                    sublabel={
                        network === 'testnet'
                            ? (language === 'ar' ? '⚠️ وضع الاختبار — لا قيمة حقيقية' : '⚠️ Test mode — no real value')
                            : (language === 'ar' ? 'الشبكة الرئيسية' : 'Production network')
                    }
                    darkMode={darkMode}
                    isLast
                    trailing={
                        <NetworkSwitch
                            network={network}
                            onChange={onNetworkChange}
                            darkMode={darkMode}
                            language={language}
                        />
                    }
                />
            </div>

            {/* Security */}
            <p className={cn("text-[11px] font-bold uppercase tracking-wider mb-2 px-1", darkMode ? "text-blue-400/50" : "text-gray-400")}>
                {language === 'ar' ? 'الأمان' : 'Security'}
            </p>
            <div className="glass-card overflow-hidden mb-5">
                <SettingsRow
                    icon={ShieldCheck}
                    label={language === 'ar' ? 'النسخ الاحتياطي' : 'Backup'}
                    sublabel={language === 'ar' ? 'احفظ المحفظة بأمان' : 'Save wallet securely'}
                    darkMode={darkMode}
                    onClick={() => setShowBackupModal(true)}
                    trailing={<ChevronRight size={16} className={darkMode ? "text-gray-600" : "text-gray-300"} />}
                />
                <SettingsRow
                    icon={Link2}
                    label={language === 'ar' ? 'التطبيقات المتصلة' : 'Connected Apps'}
                    sublabel={
                        connectedAppsCount > 0
                            ? (language === 'ar' ? `${connectedAppsCount} متصل` : `${connectedAppsCount} connected`)
                            : (language === 'ar' ? 'إدارة جلسات TON Connect' : 'Manage TON Connect sessions')
                    }
                    darkMode={darkMode}
                    onClick={onConnectedAppsClick}
                    isLast
                    trailing={
                        <div className="flex items-center gap-1.5">
                            {connectedAppsCount > 0 && (
                                <span className={cn(
                                    "text-[11px] font-bold px-2 py-0.5 rounded-md ring-1",
                                    darkMode ? "text-blue-300 ring-blue-400/20 bg-blue-500/10" : "text-blue-600 ring-blue-500/20 bg-blue-50",
                                )}>
                                    {connectedAppsCount}
                                </span>
                            )}
                            <ChevronRight size={16} className={darkMode ? "text-gray-600" : "text-gray-300"} />
                        </div>
                    }
                />
            </div>

            {/* Preferences */}
            <p className={cn("text-[11px] font-bold uppercase tracking-wider mb-2 px-1", darkMode ? "text-blue-400/50" : "text-gray-400")}>
                {language === 'ar' ? 'التفضيلات' : 'Preferences'}
            </p>
            <div className="glass-card overflow-hidden mb-5">
                <SettingsRow
                    icon={Moon}
                    label={language === 'ar' ? 'الوضع الداكن' : 'Dark Mode'}
                    sublabel={language === 'ar' ? 'تغيير المظهر' : 'Change appearance'}
                    darkMode={darkMode}
                    trailing={<Toggle checked={darkMode} onChange={() => setDarkMode(!darkMode)} darkMode={darkMode} />}
                />

                <SettingsRow
                    icon={BellRing}
                    label={language === 'ar' ? 'الإشعارات' : 'Notifications'}
                    sublabel={language === 'ar' ? 'تنبيهات المعاملات' : 'Transaction alerts'}
                    darkMode={darkMode}
                    trailing={<Toggle checked={notifications} onChange={() => setNotifications(!notifications)} darkMode={darkMode} />}
                />

                <SettingsRow
                    icon={Languages}
                    label={language === 'ar' ? 'اللغة' : 'Language'}
                    sublabel={language === 'ar' ? 'العربية' : 'English'}
                    darkMode={darkMode}
                    onClick={() => setLanguage(language === 'ar' ? 'en' : 'ar')}
                    trailing={
                        <span className={cn("text-[11px] font-bold px-2.5 py-1 rounded-lg ring-1", darkMode ? "bg-white/5 text-gray-400 ring-white/10" : "bg-gray-50 text-gray-500 ring-black/[0.06]")}>
                            {language === 'ar' ? 'EN' : 'ع'}
                        </span>
                    }
                />

                <SettingsRow
                    icon={Wallet}
                    label={language === 'ar' ? 'نوع المحفظة' : 'Wallet Type'}
                    sublabel={language === 'ar' ? 'تبديل الإصدار' : 'Switch version'}
                    darkMode={darkMode}
                    onClick={onWalletTypeClick}
                    isLast
                    trailing={
                        <div className="flex items-center gap-1.5">
                            <span className={cn("text-[11px] font-bold px-2 py-0.5 rounded-md ring-1", darkMode ? "text-gray-500 ring-white/10" : "text-gray-400 ring-black/[0.06]")}>{walletType}</span>
                            <ChevronRight size={14} className={darkMode ? "text-gray-600" : "text-gray-300"} />
                        </div>
                    }
                />
            </div>

            {/* Logout */}
            <div className="glass-card overflow-hidden">
                <button
                    onClick={onLogout}
                    className={cn(
                        "w-full px-4 py-3.5 flex items-center justify-center gap-2 text-sm font-semibold transition-all active:scale-[0.99]",
                        darkMode ? "text-red-400 hover:bg-white/[0.03]" : "text-red-500 hover:bg-black/[0.02]"
                    )}
                >
                    <LogOut size={16} strokeWidth={2} />
                    {language === 'ar' ? 'تسجيل الخروج' : 'Logout'}
                </button>
            </div>
        </div>
    );
}
