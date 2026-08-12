import React from 'react';
import { ArrowUp, Download, RefreshCw, Users, ScanLine, ArrowRightLeft } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '../lib/utils';

interface HomeTabProps {
    darkMode: boolean;
    language: string;
    setShowSendModal: (v: boolean) => void;
    setShowReceiveModal: (v: boolean) => void;
    setShowSwapModal: (v: boolean) => void;
    onMultiSendClick: () => void;
    onScanQr?: () => void;
    tokens: any[];
    onTokenClick: (token: any) => void;
}

const actions = [
    { id: 'send', icon: ArrowUp, labelEn: 'Send', labelAr: 'إرسال', color: 'blue' },
    { id: 'receive', icon: Download, labelEn: 'Receive', labelAr: 'استلام', color: 'green' },
    { id: 'swap', icon: ArrowRightLeft, labelEn: 'Swap', labelAr: 'تبديل', color: 'amber' },
    { id: 'scan', icon: ScanLine, labelEn: 'Scan', labelAr: 'مسح', color: 'cyan' },
    { id: 'multisend', icon: Users, labelEn: 'Multi', labelAr: 'متعدد', color: 'violet' },
];

const actionColors: Record<string, { light: string; dark: string }> = {
    blue: {
        light: 'bg-blue-500 text-white shadow-md shadow-blue-500/20',
        dark: 'bg-blue-500/10 text-blue-400 ring-1 ring-blue-500/20',
    },
    green: {
        light: 'bg-emerald-500 text-white shadow-md shadow-emerald-500/20',
        dark: 'bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20',
    },
    cyan: {
        light: 'bg-cyan-500 text-white shadow-md shadow-cyan-500/20',
        dark: 'bg-cyan-500/10 text-cyan-400 ring-1 ring-cyan-500/20',
    },
    amber: {
        light: 'bg-amber-500 text-white shadow-md shadow-amber-500/20',
        dark: 'bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/20',
    },
    violet: {
        light: 'bg-violet-500 text-white shadow-md shadow-violet-500/20',
        dark: 'bg-violet-500/10 text-violet-400 ring-1 ring-violet-500/20',
    },
};

function TokenSkeleton({ darkMode }: { darkMode: boolean }) {
    return (
        <div className={cn("glass-card divide-y overflow-hidden", darkMode ? "divide-white/[0.06]" : "divide-black/[0.04]")}>
            {[0, 1, 2].map(i => (
                <div key={i} className="flex items-center justify-between px-4 py-3.5">
                    <div className="flex items-center gap-3">
                        <div className={cn("w-10 h-10 rounded-full animate-pulse", darkMode ? "bg-white/5" : "bg-gray-100")} />
                        <div className="space-y-2">
                            <div className={cn("h-3.5 w-16 rounded-md animate-pulse", darkMode ? "bg-white/5" : "bg-gray-100")} />
                            <div className={cn("h-3 w-10 rounded-md animate-pulse", darkMode ? "bg-white/5" : "bg-gray-100")} />
                        </div>
                    </div>
                    <div className="text-right space-y-2">
                        <div className={cn("h-3.5 w-14 rounded-md animate-pulse ml-auto", darkMode ? "bg-white/5" : "bg-gray-100")} />
                        <div className={cn("h-3 w-10 rounded-md animate-pulse ml-auto", darkMode ? "bg-white/5" : "bg-gray-100")} />
                    </div>
                </div>
            ))}
        </div>
    );
}

export default function HomeTab({ darkMode, language, setShowSendModal, setShowReceiveModal, setShowSwapModal, onMultiSendClick, onScanQr, tokens, onTokenClick }: HomeTabProps) {
    const actionHandlers: Record<string, () => void> = {
        send: () => setShowSendModal(true),
        receive: () => setShowReceiveModal(true),
        swap: () => setShowSwapModal(true),
        scan: () => onScanQr?.(),
        multisend: onMultiSendClick,
    };

    return (
        <>
            {/* Action Buttons - in a glass card */}
            <div className="px-5 pt-5 pb-3">
                <div className={cn("glass-card p-2.5 grid grid-cols-5 gap-1.5")}>
                    {actions.map(({ id, icon: Icon, labelEn, labelAr, color }) => (
                        <button
                            key={id}
                            onClick={actionHandlers[id]}
                            className={cn(
                                "flex flex-col items-center justify-center py-2 rounded-xl transition-all active:scale-95",
                                darkMode ? "hover:bg-white/5" : "hover:bg-black/[0.03]"
                            )}
                        >
                            <div className={cn(
                                "w-11 h-11 rounded-[14px] flex items-center justify-center mb-1.5",
                                darkMode ? actionColors[color].dark : actionColors[color].light
                            )}>
                                <Icon size={20} strokeWidth={2} />
                            </div>
                            <span className={cn("text-[10px] font-semibold tracking-tight", darkMode ? "text-gray-400" : "text-gray-600")}>
                                {language === 'ar' ? labelAr : labelEn}
                            </span>
                        </button>
                    ))}
                </div>
            </div>

            {/* Token List */}
            <div className="px-5 pb-6">
                <div className="flex items-center justify-between mb-3">
                    <h3 className={cn("text-sm font-bold", darkMode ? "text-gray-300" : "text-gray-800")}>
                        {language === 'ar' ? 'التوكينات' : 'Tokens'}
                    </h3>
                </div>

                {tokens.length === 0 ? (
                    <TokenSkeleton darkMode={darkMode} />
                ) : (
                    <div className={cn("glass-card divide-y overflow-hidden", darkMode ? "divide-white/[0.06]" : "divide-black/[0.04]")}>
                        {tokens.map((token, idx) => (
                            <motion.button
                                key={idx}
                                initial={{ opacity: 0, y: 12 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.25, delay: idx * 0.04, ease: 'easeOut' }}
                                onClick={() => onTokenClick(token)}
                                className={cn(
                                    "w-full flex items-center justify-between px-4 py-3.5 transition-all active:scale-[0.99] text-left",
                                    darkMode ? "hover:bg-white/[0.03]" : "hover:bg-black/[0.02]"
                                )}
                            >
                                <div className="flex items-center gap-3">
                                    <div className={cn("w-10 h-10 rounded-full flex items-center justify-center text-lg overflow-hidden flex-shrink-0", darkMode ? "bg-white/5 ring-1 ring-white/10" : "bg-gray-50 ring-1 ring-black/[0.06]")}>
                                        {token.icon && token.icon.startsWith && token.icon.startsWith('http') ? (
                                            <img
                                                src={token.icon}
                                                alt={token.symbol}
                                                className="w-full h-full object-cover"
                                                onError={(e) => {
                                                    (e.target as HTMLImageElement).onerror = null;
                                                    (e.target as HTMLImageElement).src = 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ton/info/logo.png';
                                                }}
                                            />
                                        ) : (
                                            token.icon
                                        )}
                                    </div>
                                    <div>
                                        <p className={cn("text-sm font-semibold", darkMode ? "text-white" : "text-gray-900")}>{token.name}</p>
                                        <p className={cn("text-xs", darkMode ? "text-gray-500" : "text-gray-400")}>{token.symbol}</p>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <p className={cn("text-sm font-bold tabular-nums", darkMode ? "text-white" : "text-gray-900")}>{token.balance}</p>
                                    <p className={cn("text-xs tabular-nums", darkMode ? "text-gray-500" : "text-gray-400")}>{token.value}</p>
                                </div>
                            </motion.button>
                        ))}
                    </div>
                )}
            </div>
        </>
    );
}
