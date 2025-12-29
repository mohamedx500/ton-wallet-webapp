import React from 'react';
import { Copy, Check, ChevronDown } from 'lucide-react';

interface WalletHeaderProps {
    darkMode: boolean;
    language: string;
    walletType: string;
    activeTab: string;
    totalBalance: string;
    walletAddress: string;
    copied: boolean;
    handleCopy: () => void;
    accountName: string;
    onAccountsClick: () => void;
}

export default function WalletHeader({
    darkMode, language, walletType, activeTab, totalBalance, walletAddress, copied, handleCopy, accountName, onAccountsClick
}: WalletHeaderProps) {
    return (
        <div className={`${darkMode ? 'bg-gradient-to-r from-gray-900 to-black' : 'bg-gradient-to-r from-blue-600 to-indigo-600'} p-6 text-white`}>
            <div className="flex justify-between items-center mb-6">
                <button onClick={onAccountsClick} className="flex items-center gap-2 hover:bg-white/10 px-3 py-1.5 rounded-lg transition -ml-2 text-left">
                    <h1 className="text-xl font-bold truncate max-w-[200px]">{accountName}</h1>
                    <ChevronDown size={20} className="opacity-80" />
                </button>
                <div className={`${darkMode ? 'bg-white/5' : 'bg-white/20'} backdrop-blur-sm px-3 py-1 rounded-full text-sm font-mono`}>
                    {walletType}
                </div>
            </div>

            {activeTab === 'home' && (
                <>
                    <div className="text-center mb-4">
                        <p className="text-sm opacity-80 mb-2">{language === 'ar' ? 'الرصيد الإجمالي' : 'Total Balance'}</p>
                        <h2 className="text-4xl font-bold mb-1">${totalBalance}</h2>
                        <p className="text-sm opacity-90">USD</p>
                    </div>

                    <div
                        onClick={handleCopy}
                        className={`mx-auto w-fit ${darkMode ? 'bg-white/5 hover:bg-white/10' : 'bg-white/20 hover:bg-white/30'} backdrop-blur-md rounded-full px-4 py-2 flex items-center gap-2 cursor-pointer transition-all active:scale-95`}
                    >
                        <Copy size={14} className="opacity-70" />
                        <span className="text-sm font-mono font-medium tracking-tight">
                            {walletAddress.slice(0, 4)}••••{walletAddress.slice(-4)}
                        </span>
                        {copied && <Check size={14} className="text-green-300" />}
                    </div>
                </>
            )}
        </div>
    );
}
