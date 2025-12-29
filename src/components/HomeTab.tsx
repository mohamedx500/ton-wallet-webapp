import React from 'react';
import { Send, ArrowDownToLine, Wallet, ChevronRight } from 'lucide-react';

interface HomeTabProps {
    darkMode: boolean;
    language: string;
    setShowSendModal: (v: boolean) => void;
    setShowReceiveModal: (v: boolean) => void;
    setShowBuyModal: (v: boolean) => void;
    tokens: any[];
    onTokenClick: (token: any) => void;
}

export default function HomeTab({ darkMode, language, setShowSendModal, setShowReceiveModal, setShowBuyModal, tokens, onTokenClick }: HomeTabProps) {
    return (
        <>
            <div className="grid grid-cols-3 gap-3 p-6">
                <button
                    onClick={() => setShowSendModal(true)}
                    className={`flex flex-col items-center justify-center p-4 ${darkMode ? 'bg-blue-950/50' : 'bg-blue-50'} rounded-2xl ${darkMode ? 'hover:bg-blue-950/70' : 'hover:bg-blue-100'} transition`}
                >
                    <div className={`w-12 h-12 ${darkMode ? 'bg-blue-900' : 'bg-blue-600'} rounded-full flex items-center justify-center mb-2`}>
                        <Send size={20} className="text-white" />
                    </div>
                    <span className={`text-sm font-medium ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        {language === 'ar' ? 'إرسال' : 'Send'}
                    </span>
                </button>

                <button
                    onClick={() => setShowReceiveModal(true)}
                    className={`flex flex-col items-center justify-center p-4 ${darkMode ? 'bg-green-950/50' : 'bg-green-50'} rounded-2xl ${darkMode ? 'hover:bg-green-950/70' : 'hover:bg-green-100'} transition`}
                >
                    <div className={`w-12 h-12 ${darkMode ? 'bg-green-900' : 'bg-green-600'} rounded-full flex items-center justify-center mb-2`}>
                        <ArrowDownToLine size={20} className="text-white" />
                    </div>
                    <span className={`text-sm font-medium ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        {language === 'ar' ? 'استلام' : 'Receive'}
                    </span>
                </button>

                <button
                    onClick={() => setShowBuyModal(true)}
                    className={`flex flex-col items-center justify-center p-4 ${darkMode ? 'bg-purple-950/50' : 'bg-purple-50'} rounded-2xl ${darkMode ? 'hover:bg-purple-950/70' : 'hover:bg-purple-100'} transition`}
                >
                    <div className={`w-12 h-12 ${darkMode ? 'bg-purple-900' : 'bg-purple-600'} rounded-full flex items-center justify-center mb-2`}>
                        <Wallet size={20} className="text-white" />
                    </div>
                    <span className={`text-sm font-medium ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        {language === 'ar' ? 'شراء' : 'Buy'}
                    </span>
                </button>
            </div>

            <div className="px-6 pb-6">
                <div className="flex items-center justify-between mb-4">
                    <h3 className={`text-lg font-bold ${darkMode ? 'text-white' : 'text-gray-800'}`}>
                        {language === 'ar' ? 'التوكينات' : 'Tokens'}
                    </h3>
                    <button className={`text-sm ${darkMode ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-700'} flex items-center gap-1`}>
                        {language === 'ar' ? 'إضافة' : 'Add'}
                        <ChevronRight size={16} />
                    </button>
                </div>

                <div className="space-y-3">
                    {tokens.map((token, idx) => (
                        <div
                            key={idx}
                            onClick={() => onTokenClick(token)}
                            className={`flex items-center justify-between p-4 ${darkMode ? 'bg-gray-900 hover:bg-gray-800' : 'bg-gray-50 hover:bg-gray-100'} rounded-xl transition cursor-pointer`}
                        >
                            <div className="flex items-center gap-3">
                                <div className={`w-10 h-10 ${darkMode ? 'bg-gray-800' : 'bg-white'} rounded-full flex items-center justify-center text-xl shadow-sm overflow-hidden`}>
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
                                    <p className={`font-medium ${darkMode ? 'text-white' : 'text-gray-800'}`}>{token.name}</p>
                                    <p className={`text-sm ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>{token.symbol}</p>
                                </div>
                            </div>
                            <div className="text-left">
                                <p className={`font-bold ${darkMode ? 'text-white' : 'text-gray-800'}`}>{token.balance}</p>
                                <p className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>{token.value}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </>
    );
}
