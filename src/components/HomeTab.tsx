import React from 'react';
import { ArrowUp, ArrowDown, ArrowLeftRight, Users } from 'lucide-react';
import { Send, Download, RefreshCw } from 'lucide-react';
import { cn } from '../lib/utils';

interface HomeTabProps {
    darkMode: boolean;
    language: string;
    setShowSendModal: (v: boolean) => void;
    setShowReceiveModal: (v: boolean) => void;
    setShowSwapModal: (v: boolean) => void;
    onMultiSendClick: () => void;
    tokens: any[];
    onTokenClick: (token: any) => void;
}

const actions = [
    { id: 'send', icon: ArrowUp, labelEn: 'Send', labelAr: 'إرسال' },
    { id: 'receive', icon: Download, labelEn: 'Receive', labelAr: 'استلام' },
    { id: 'swap', icon: RefreshCw, labelEn: 'Swap', labelAr: 'تبديل' },
    { id: 'multisend', icon: Users, labelEn: 'Multi-Send', labelAr: 'إرسال متعدد' },
];

export default function HomeTab({ darkMode, language, setShowSendModal, setShowReceiveModal, setShowSwapModal, onMultiSendClick, tokens, onTokenClick }: HomeTabProps) {
    const actionHandlers: Record<string, () => void> = {
        send: () => setShowSendModal(true),
        receive: () => setShowReceiveModal(true),
        swap: () => setShowSwapModal(true),
        multisend: onMultiSendClick,
    };

    return (
        <>
            {/* Action Buttons - in a glass card */}
            <div className="px-5 pt-5 pb-3">
                <div className={cn("glass-card p-3 grid grid-cols-4 gap-2")}>
                    {actions.map(({ id, icon: Icon, labelEn, labelAr }) => (
                        <button
                            key={id}
                            onClick={actionHandlers[id]}
                            className={cn(
                                "flex flex-col items-center justify-center py-3 rounded-xl transition-all active:scale-95",
                                darkMode ? "hover:bg-white/5" : "hover:bg-black/[0.03]"
                            )}
                        >
                            <div className={cn(
                                "w-12 h-12 rounded-2xl flex items-center justify-center mb-1.5",
                                darkMode ? "bg-blue-500/10 text-blue-400 ring-1 ring-blue-500/20" : "bg-blue-500 text-white shadow-md shadow-blue-500/20"
                            )}>
                                <Icon size={22} strokeWidth={2} />
                            </div>
                            <span className={cn("text-xs font-semibold", darkMode ? "text-gray-400" : "text-gray-600")}>
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

                <div className={cn("glass-card divide-y overflow-hidden", darkMode ? "divide-white/[0.06]" : "divide-black/[0.04]")}>
                    {tokens.map((token, idx) => (
                        <button
                            key={idx}
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
                        </button>
                    ))}
                </div>
            </div>
        </>
    );
}
