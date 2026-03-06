import React from 'react';
import { Copy, Check, ChevronDown } from 'lucide-react';
import { cn } from '../lib/utils';

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
        <div className={cn("px-5 pt-5 pb-5", darkMode ? "bg-gradient-to-b from-[hsl(228,25%,12%)] via-[hsl(228,20%,9%)] to-transparent" : "bg-gradient-to-b from-blue-600 to-blue-500 text-white")}>
            <div className="flex justify-between items-center mb-5">
                <button onClick={onAccountsClick} className="flex items-center gap-1.5 hover:bg-white/10 px-2.5 py-1.5 rounded-xl transition -ml-1.5 text-left">
                    <span className={cn("text-base font-bold truncate max-w-[180px]", darkMode ? "text-white" : "text-white")}>{accountName}</span>
                    <ChevronDown size={16} className="opacity-60" />
                </button>
                <div className={cn("px-2.5 py-1 rounded-lg text-[11px] font-semibold tracking-wide uppercase ring-1", darkMode ? "bg-white/5 text-gray-400 ring-white/10" : "bg-white/20 text-white/90 ring-white/20")}>
                    {walletType}
                </div>
            </div>

            {activeTab === 'home' && (
                <div className="text-center">
                    <p className={cn("text-[11px] font-medium uppercase tracking-wider mb-2", darkMode ? "text-gray-500" : "text-white/60")}>
                        {language === 'ar' ? 'الرصيد الإجمالي' : 'Total Balance'}
                    </p>
                    <h2 className={cn("text-[36px] font-extrabold tracking-tight leading-none mb-1", darkMode ? "text-white" : "text-white")}>
                        ${totalBalance}
                    </h2>
                    <p className={cn("text-xs font-medium mb-4", darkMode ? "text-gray-500" : "text-white/50")}>USD</p>

                    <button
                        onClick={handleCopy}
                        className={cn(
                            "mx-auto flex items-center gap-2 px-4 py-2 rounded-full text-xs font-medium cursor-pointer transition-all active:scale-95 ring-1",
                            darkMode ? "bg-white/5 hover:bg-white/8 text-gray-400 ring-white/10" : "bg-white/15 hover:bg-white/25 text-white/80 ring-white/20"
                        )}
                    >
                        {copied ? <Check size={13} className="text-green-400" /> : <Copy size={13} className="opacity-60" />}
                        <span className="font-mono tracking-tight">
                            {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
                        </span>
                    </button>
                </div>
            )}
        </div>
    );
}
