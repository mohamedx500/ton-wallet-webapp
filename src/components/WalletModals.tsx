import React, { useState } from 'react';
import { X, Copy, ExternalLink, ArrowDownToLine, Send, Check, Eye, EyeOff, Loader2, Share2, Wallet, TriangleAlert, ChevronRight, RefreshCw } from 'lucide-react';

interface BaseModalProps {
    isOpen: boolean;
    onClose: () => void;
    darkMode: boolean;
    language: string;
}

interface ReceiveModalProps extends BaseModalProps {
    walletAddress: string;
    handleCopy: () => void;
    copied: boolean;
}

interface PhraseModalProps extends BaseModalProps {
    seedPhrase: string[];
    handleCopyPhrase: () => void;
    copiedPhrase: boolean;
}

interface TransactionModalProps {
    transaction: any;
    onClose: () => void;
    darkMode: boolean;
    language: string;
}

interface PasswordPromptModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (password: string) => void;
    darkMode: boolean;
    language: string;
    isLoading?: boolean;
    error?: string;
}

interface SelectWalletTypeModalProps {
    isOpen: boolean;
    onClose: () => void;
    currentType: string;
    onSelect: (type: string) => void;
    darkMode: boolean;
    language: string;
}

interface TokenDetailsModalProps {
    isOpen: boolean;
    onClose: () => void;
    token: any; // { name, symbol, balance, value, icon, price }
    transactions: any[];
    darkMode: boolean;
    language: string;
    onSend?: () => void;
    onReceive?: () => void;
}

// Token Details Modal
export function TokenDetailsModal({ isOpen, onClose, token, transactions, darkMode, language, onSend, onReceive }: TokenDetailsModalProps) {
    if (!isOpen || !token) return null;

    // Filter transactions for this token
    const tokenTxs = transactions.filter(tx => tx.token === token.symbol || (token.symbol === 'TON' && !tx.token));

    return (
        <div className="fixed inset-0 bg-black/50 flex items-end justify-center z-50 pointer-events-auto" onClick={onClose}>
            <div className={`w-full max-w-md ${darkMode ? 'bg-gray-900' : 'bg-white'} rounded-t-3xl p-6 h-[80vh] flex flex-col animate-slide-up`} onClick={(e) => e.stopPropagation()}>
                <div className="w-12 h-1 bg-gray-300 rounded-full mx-auto mb-6 shrink-0"></div>

                {/* Header */}
                {/* Header */}
                <div className="flex flex-col items-center mb-8 shrink-0">
                    <div className="w-24 h-24 bg-gray-50 dark:bg-gray-800 rounded-full flex items-center justify-center p-1 mb-4 shadow-lg ring-1 ring-black/5 dark:ring-white/10">
                        <div className="w-full h-full rounded-full overflow-hidden flex items-center justify-center bg-white dark:bg-gray-900">
                            {token.icon && token.icon.startsWith && token.icon.startsWith('http') ? (
                                <img src={token.icon} alt={token.symbol} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).src = 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ton/info/logo.png'; }} />
                            ) : (
                                <span className="text-4xl">{token.icon}</span>
                            )}
                        </div>
                    </div>

                    <h3 className={`text-3xl font-extrabold mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                        {token.balance} <span className="text-blue-500">{token.symbol}</span>
                    </h3>

                    <p className={`text-lg font-medium mb-4 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                        {token.value}
                    </p>

                    {/* Price & Diff Card */}
                    <div className="flex flex-col items-center mt-2">
                        <div className={`px-5 py-3 rounded-2xl border flex items-center gap-4 shadow-sm transition-all hover:shadow-md ${darkMode ? 'border-gray-700 bg-gray-800/50' : 'border-gray-100 bg-white'}`}>
                            <div className="flex flex-col items-center">
                                <span className={`text-[10px] font-bold uppercase tracking-wider mb-0.5 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>Current Price</span>
                                <span className={`text-xl font-bold tracking-tight ${darkMode ? 'text-white' : 'text-gray-900'}`}>${token.price?.toFixed(2)}</span>
                            </div>

                            <div className={`h-8 w-px ${darkMode ? 'bg-gray-700' : 'bg-gray-200'}`}></div>

                            {token.diff && (
                                <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold text-sm ${String(token.diff).includes('-')
                                    ? 'text-red-500 bg-red-500/10'
                                    : 'text-green-500 bg-green-500/10'
                                    }`}>
                                    {String(token.diff).includes('-')
                                        ? <ArrowDownToLine size={16} />
                                        : <ArrowDownToLine className="rotate-180" size={16} />
                                    }
                                    <span dir="ltr">{String(token.diff).replace('-', '')}</span>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Actions */}
                <div className="flex gap-4 mb-8 shrink-0">
                    <button
                        onClick={() => {
                            onClose();
                            onSend?.();
                        }}
                        className="flex-1 bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 transition"
                    >
                        {language === 'ar' ? 'إرسال' : 'Send'}
                    </button>
                    <button
                        onClick={() => {
                            onClose();
                            onReceive?.();
                        }}
                        className="flex-1 bg-green-600 text-white py-3 rounded-xl font-bold hover:bg-green-700 transition"
                    >
                        {language === 'ar' ? 'استلام' : 'Receive'}
                    </button>
                </div>

                {/* History */}
                <div className="flex-1 overflow-auto no-scrollbar">
                    <h4 className={`font-bold mb-4 ${darkMode ? 'text-white' : 'text-gray-800'}`}>
                        {language === 'ar' ? 'النشاط الأخير' : 'Recent Activity'}
                    </h4>
                    {tokenTxs.length > 0 ? (
                        <div className="space-y-3">
                            {tokenTxs.map((tx, i) => (
                                <div key={i} className={`flex items-center justify-between p-3 rounded-xl ${darkMode ? 'bg-gray-800' : 'bg-gray-50'}`}>
                                    <div className="flex items-center gap-3">
                                        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${tx.type === 'received'
                                            ? (darkMode ? 'bg-green-900/30 text-green-500' : 'bg-green-100 text-green-600')
                                            : (darkMode ? 'bg-red-900/30 text-red-500' : 'bg-red-100 text-red-600')
                                            }`}>
                                            {tx.type === 'received' ? <ArrowDownToLine size={18} /> : <Send size={18} />}
                                        </div>
                                        <div>
                                            <p className={`font-medium ${darkMode ? 'text-white' : 'text-gray-800'}`}>
                                                {tx.type === 'received' ? 'Received' : 'Sent'}
                                            </p>
                                            <p className="text-xs text-gray-500">{tx.time}</p>
                                        </div>
                                    </div>
                                    <span className={`font-bold ${tx.type === 'received' ? 'text-green-500' : 'text-gray-500'}`}>
                                        {tx.type === 'received' ? '+' : '-'}{tx.amount} {token.symbol}
                                    </span>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-center text-gray-500 py-8">No transactions</div>
                    )}
                </div>
            </div>
        </div>
    );
}

// Select Wallet Type Modal
export function SelectWalletTypeModal({ isOpen, onClose, currentType, onSelect, darkMode, language }: SelectWalletTypeModalProps) {
    if (!isOpen) return null;

    const types = [
        { id: 'v5r1', name: 'Wallet V5R1', desc: 'Newest standard, low fees' },
        { id: 'v4r2', name: 'Wallet V4R2', desc: 'Standard usage' },
        { id: 'v3r2', name: 'Wallet V3R2', desc: 'Legacy version' },
        { id: 'highload-v3', name: 'Highload V3', desc: 'For high throughput' },
    ];

    return (
        <div className="fixed inset-0 bg-black/50 flex items-end justify-center z-50" onClick={onClose}>
            <div className={`w-full max-w-md ${darkMode ? 'bg-gray-900' : 'bg-white'} rounded-t-3xl p-6 animate-slide-up`} onClick={(e) => e.stopPropagation()}>
                <div className="w-12 h-1 bg-gray-300 rounded-full mx-auto mb-6"></div>
                <h3 className={`text-xl font-bold ${darkMode ? 'text-white' : 'text-gray-800'} mb-6`}>
                    {language === 'ar' ? 'نوع المحفظة' : 'Wallet Version'}
                </h3>

                <div className="space-y-3">
                    {types.map((t) => (
                        <button
                            key={t.id}
                            onClick={() => onSelect(t.id)}
                            className={`w-full p-4 rounded-xl flex items-center justify-between border ${currentType === t.id
                                ? (darkMode ? 'bg-blue-900/20 border-blue-500' : 'bg-blue-50 border-blue-500')
                                : (darkMode ? 'bg-gray-800 border-transparent hover:bg-gray-700' : 'bg-gray-50 border-transparent hover:bg-gray-100')
                                } transition`}
                        >
                            <div className="text-left">
                                <p className={`font-bold ${darkMode ? 'text-white' : 'text-gray-800'} ${currentType === t.id ? 'text-blue-500' : ''}`}>
                                    {t.name}
                                </p>
                                <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                    {t.desc}
                                </p>
                            </div>
                            {currentType === t.id && <Check className="text-blue-500" size={20} />}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}

// Password Prompt Modal
export function PasswordPromptModal({ isOpen, onClose, onConfirm, darkMode, language, isLoading, error }: PasswordPromptModalProps) {
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onConfirm(password);
        setPassword('');
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className={`w-full max-w-sm ${darkMode ? 'bg-gray-900' : 'bg-white'} rounded-3xl p-6 animate-scale-up`} onClick={(e) => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-6">
                    <h3 className={`text-xl font-bold ${darkMode ? 'text-white' : 'text-gray-800'}`}>
                        {language === 'ar' ? 'تأكيد كلمة المرور' : 'Confirm Password'}
                    </h3>
                    <button onClick={onClose} className={`p-2 rounded-full ${darkMode ? 'hover:bg-gray-800 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}>
                        <X size={20} />
                    </button>
                </div>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        {language === 'ar' ? 'يرجى إدخال كلمة المرور لتأكيد المعاملة.' : 'Please enter your password to confirm transaction.'}
                    </p>
                    <div className="relative">
                        <input
                            type={showPassword ? 'text' : 'password'}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder={language === 'ar' ? 'كلمة المرور' : 'Password'}
                            className={`w-full p-4 pr-12 rounded-xl ${darkMode ? 'bg-gray-800 text-white border-gray-700' : 'bg-gray-50 text-gray-900 border-gray-200'} border focus:ring-2 focus:ring-blue-500 outline-none`}
                            autoFocus
                        />
                        <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-4 text-gray-500">
                            {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                        </button>
                    </div>
                    {error && <p className="text-red-500 text-sm">{error}</p>}
                    <button disabled={isLoading} className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 transition flex justify-center">
                        {isLoading ? <Loader2 className="animate-spin" /> : (language === 'ar' ? 'تأكيد' : 'Confirm')}
                    </button>
                </form>
            </div>
        </div>
    );
}

interface SendModalProps extends BaseModalProps {
    onSend: (address: string, amount: string, comment?: string, token?: any) => void;
    tokens?: any[];
    walletAddress?: string;
}

// Send Modal
export function SendModal({ isOpen, onClose, darkMode, language, onSend, tokens = [], walletAddress }: SendModalProps) {
    const [step, setStep] = useState(1);
    const [address, setAddress] = useState('');
    const [comment, setComment] = useState('');
    const [amount, setAmount] = useState('');
    const [selectedAsset, setSelectedAsset] = useState<any>(null); // null = TON
    const [addressError, setAddressError] = useState('');

    // Validate TON address (EQ/UQ format, 48 chars, or .ton domain)
    const isValidTonAddress = (addr: string): boolean => {
        if (!addr) return false;
        // .ton domain
        if (addr.toLowerCase().endsWith('.ton')) return true;
        // Raw address: starts with EQ or UQ, 48 characters, base64
        const tonAddrRegex = /^(EQ|UQ)[a-zA-Z0-9_-]{46}$/;
        return tonAddrRegex.test(addr);
    };

    if (!isOpen) return null;

    // Reset on close... ideally in useEffect or wrapper
    // simplifying for now

    const handleNext = () => {
        if (step === 1) {
            if (!isValidTonAddress(address)) {
                setAddressError(language === 'ar' ? 'عنوان غير صالح' : 'Invalid TON address');
                return;
            }
            setAddressError('');
        }
        setStep(prev => prev + 1);
    };
    const handleBack = () => setStep(prev => prev - 1);

    // Default to TON if nothing selected or simplify
    // Default to TON if nothing selected or simplify
    const currentAsset = selectedAsset || { symbol: 'TON', icon: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ton/info/logo.png', balance: '0.00' };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className={`w-full max-w-sm ${darkMode ? 'bg-gray-950' : 'bg-white'} rounded-[32px] p-6 animate-scale-up shadow-2xl relative overflow-hidden`} onClick={(e) => e.stopPropagation()}>

                {/* Header with Back Button */}
                <div className="flex items-center justify-between mb-6">
                    {step > 1 ? (
                        <button onClick={handleBack} className={`p-2 rounded-full ${darkMode ? 'hover:bg-gray-800 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}>
                            <ArrowDownToLine className="rotate-90" size={20} />
                        </button>
                    ) : <div className="w-9" />} {/* Spacer */}

                    <h3 className={`text-xl font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                        {step === 1 && (language === 'ar' ? 'المستلم' : 'Recipient')}
                        {step === 2 && (language === 'ar' ? 'المبلغ' : 'Amount')}
                        {step === 3 && (language === 'ar' ? 'مراجعة' : 'Review')}
                    </h3>

                    <button onClick={onClose} className={`p-2 rounded-full ${darkMode ? 'hover:bg-gray-800 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}>
                        <X size={20} />
                    </button>
                </div>

                {/* Content based on Step */}
                <div className="min-h-[300px] flex flex-col">

                    {/* STEP 1: Address & Comment */}
                    {step === 1 && (
                        <div className="space-y-4 flex-1">
                            <div>
                                <label className={`block text-xs font-bold ${darkMode ? 'text-gray-400' : 'text-gray-500'} uppercase mb-2 ml-1`}>
                                    {language === 'ar' ? 'إلى عنوان' : 'To Address'}
                                </label>
                                <input
                                    type="text"
                                    placeholder={language === 'ar' ? 'العنوان أو النطاق (.ton)...' : 'Address or domain (.ton)...'}
                                    value={address}
                                    onChange={(e) => setAddress(e.target.value)}
                                    className={`w-full p-4 rounded-xl ${darkMode ? 'bg-gray-900 text-white placeholder-gray-600' : 'bg-gray-50 text-gray-900 placeholder-gray-400'} border-none focus:ring-2 focus:ring-blue-500 font-mono text-sm shadow-inner`}
                                    autoFocus
                                />
                                {addressError && (
                                    <p className="text-red-500 text-xs mt-1 ml-1">{addressError}</p>
                                )}
                            </div>
                            <div>
                                <label className={`block text-xs font-bold ${darkMode ? 'text-gray-400' : 'text-gray-500'} uppercase mb-2 ml-1`}>
                                    {language === 'ar' ? 'تعليق (اختياري)' : 'Comment (Optional)'}
                                </label>
                                <textarea
                                    value={comment}
                                    onChange={(e) => setComment(e.target.value)}
                                    placeholder={language === 'ar' ? 'رسالة للمستلم...' : 'Message for recipient...'}
                                    className={`w-full p-4 rounded-xl ${darkMode ? 'bg-gray-900 text-white placeholder-gray-600' : 'bg-gray-50 text-gray-900 placeholder-gray-400'} border-none focus:ring-2 focus:ring-blue-500 font-medium text-sm shadow-inner resize-none h-24`}
                                />
                            </div>
                        </div>
                    )}

                    {/* STEP 2: Asset & Amount */}
                    {step === 2 && (
                        <div className="space-y-6 flex-1">
                            {/* Token Selector */}
                            <div>
                                <label className={`block text-xs font-bold ${darkMode ? 'text-gray-400' : 'text-gray-500'} uppercase mb-2 ml-1`}>
                                    {language === 'ar' ? 'العملة' : 'Asset'}
                                </label>
                                <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2">
                                    <button
                                        onClick={() => setSelectedAsset(null)}
                                        className={`flex items-center gap-2 px-4 py-2 rounded-full border ${!selectedAsset
                                            ? 'bg-blue-600 border-blue-600 text-white'
                                            : (darkMode ? 'bg-gray-900 border-gray-800 text-gray-400' : 'bg-white border-gray-200 text-gray-600')
                                            } transition`}
                                    >
                                        <div className="w-5 h-5 rounded-full overflow-hidden flex items-center justify-center">
                                            <img src="https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ton/info/logo.png" alt="TON" className="w-full h-full object-cover" />
                                        </div>
                                        <span className="font-bold text-sm">TON</span>
                                    </button>
                                    {tokens.map((t, i) => t.symbol !== 'TON' && (
                                        <button
                                            key={i}
                                            onClick={() => setSelectedAsset(t)}
                                            className={`flex items-center gap-2 px-4 py-2 rounded-full border ${selectedAsset?.symbol === t.symbol
                                                ? 'bg-blue-600 border-blue-600 text-white'
                                                : (darkMode ? 'bg-gray-900 border-gray-800 text-gray-400' : 'bg-white border-gray-200 text-gray-600')
                                                } transition`}
                                        >
                                            <div className="w-5 h-5 rounded-full overflow-hidden flex items-center justify-center bg-white/10">
                                                {t.icon && t.icon.startsWith && t.icon.startsWith('http') ? (
                                                    <img src={t.icon} alt={t.symbol} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).src = 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ton/info/logo.png'; }} />
                                                ) : (
                                                    <span>{t.icon}</span>
                                                )}
                                            </div>
                                            <span className="font-bold text-sm">{t.symbol}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Amount Input */}
                            <div>
                                <div className="flex justify-between items-end mb-2 ml-1">
                                    <label className={`block text-xs font-bold ${darkMode ? 'text-gray-400' : 'text-gray-500'} uppercase`}>
                                        {language === 'ar' ? 'المبلغ' : 'Amount'}
                                    </label>
                                    <span className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                        Max: {selectedAsset ? selectedAsset.balance : '...'}
                                    </span>
                                </div>
                                <div className="relative">
                                    <input
                                        type="number"
                                        placeholder="0.00"
                                        value={amount}
                                        onChange={(e) => setAmount(e.target.value)}
                                        className={`w-full p-4 rounded-xl ${darkMode ? 'bg-gray-900 text-white placeholder-gray-600' : 'bg-gray-50 text-gray-900 placeholder-gray-400'} border-none focus:ring-2 focus:ring-blue-500 text-2xl font-bold shadow-inner`}
                                        autoFocus
                                    />
                                    <div className="absolute right-4 top-1/2 -translate-y-1/2 font-bold text-gray-500 pointer-events-none">
                                        {currentAsset.symbol}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* STEP 3: Review */}
                    {step === 3 && (
                        <div className="space-y-6 flex-1">
                            <div className="flex flex-col items-center justify-center py-4">
                                <div className="w-20 h-20 bg-blue-500 rounded-full flex items-center justify-center mb-4 shadow-lg shadow-blue-500/30 ring-4 ring-blue-500/20 animate-scale-up">
                                    <Send size={40} className="text-white ml-2" />
                                </div>
                                <h2 className={`text-lg font-medium ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                                    {language === 'ar' ? 'تأكيد الإرسال' : 'Confirm sending'}
                                </h2>
                            </div>

                            <div className={`p-5 rounded-2xl ${darkMode ? 'bg-gray-900 border-gray-800' : 'bg-gray-50 border-gray-100'} border space-y-4`}>
                                {/* Recipient */}
                                <div className="flex justify-between items-center py-1">
                                    <span className={`text-sm ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>{language === 'ar' ? 'المستلم' : 'Recipient'}</span>
                                    <span className={`font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                                        {address.slice(0, 4)}...{address.slice(-4)}
                                    </span>
                                </div>

                                {/* Full Address */}
                                <div className="flex justify-between items-center py-1">
                                    <span className={`text-sm ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>{language === 'ar' ? 'العنوان' : 'Recipient address'}</span>
                                    <p className={`font-mono text-xs max-w-[150px] truncate text-right ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                                        {address}
                                    </p>
                                </div>

                                <div className={`h-px w-full ${darkMode ? 'bg-gray-800' : 'bg-gray-200'} my-2`}></div>

                                {/* Amount */}
                                <div className="flex justify-between items-center py-1">
                                    <span className={`text-sm ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>{language === 'ar' ? 'المبلغ' : 'Amount'}</span>
                                    <div className="text-right">
                                        <span className={`font-bold text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                                            {amount} {currentAsset.symbol}
                                        </span>
                                        <p className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>≈ ${(parseFloat(amount) * (currentAsset.price || 0)).toFixed(2)}</p>
                                    </div>
                                </div>

                                {/* Fee */}
                                <div className="flex justify-between items-center py-1">
                                    <span className={`text-sm ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>{language === 'ar' ? 'الرسوم' : 'Fee'}</span>
                                    <div className="text-right">
                                        <span className={`font-medium ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                            0.0055 TON
                                        </span>
                                        <p className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>≈ $0.005</p>
                                    </div>
                                </div>

                                {comment && (
                                    <>
                                        <div className={`h-px w-full ${darkMode ? 'bg-gray-800' : 'bg-gray-200'} my-2`}></div>
                                        <div className="flex justify-between items-start py-1">
                                            <span className={`text-sm ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>{language === 'ar' ? 'تعليق' : 'Comment'}</span>
                                            <p className={`text-sm italic text-right max-w-[200px] break-words ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                                                "{comment}"
                                            </p>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Footer Actions */}
                    <div className="mt-6">
                        {step < 3 ? (
                            <button
                                onClick={handleNext}
                                disabled={(!address || address.length < 3) && step === 1 || !amount && step === 2}
                                className="w-full bg-blue-600 text-white py-4 rounded-xl font-bold hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-blue-500/30"
                            >
                                {language === 'ar' ? 'متابعة' : 'Continue'}
                            </button>
                        ) : (
                            <button
                                onClick={() => onSend(address, amount, comment, selectedAsset)}
                                className="w-full bg-blue-600 text-white py-4 rounded-xl font-bold hover:bg-blue-700 transition shadow-lg shadow-blue-500/30 flex items-center justify-center gap-2"
                            >
                                {language === 'ar' ? 'تأكيد وإرسال' : 'Confirm & Send'}
                                <Send size={18} />
                            </button>
                        )}
                    </div>

                </div>
            </div>
        </div>
    );
}

// Receive Modal
// Receive Modal
export function ReceiveModal({ isOpen, onClose, darkMode, language, walletAddress, handleCopy, copied }: ReceiveModalProps) {
    if (!isOpen) return null;

    const handleShare = async () => {
        if (navigator.share) {
            try {
                await navigator.share({
                    title: 'My TON Wallet Address',
                    text: walletAddress,
                });
            } catch (err) {
                console.error('Share failed:', err);
            }
        } else {
            handleCopy();
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className={`w-full max-w-sm ${darkMode ? 'bg-gray-950' : 'bg-white'} rounded-[32px] p-6 animate-scale-up shadow-2xl`} onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="flex justify-between items-center mb-8">
                    <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 ${darkMode ? 'bg-blue-900/30 text-blue-400' : 'bg-blue-50 text-blue-600'} rounded-full flex items-center justify-center`}>
                            <ArrowDownToLine size={20} />
                        </div>
                        <div>
                            <h3 className={`text-xl font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                                {language === 'ar' ? 'استلام' : 'Receive'}
                            </h3>
                            <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                TON & Jettons
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className={`p-2 rounded-full transition ${darkMode ? 'hover:bg-gray-800 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}
                    >
                        <X size={24} />
                    </button>
                </div>

                {/* QR Code Container */}
                <div className="flex flex-col items-center justify-center mb-8">
                    <div className="relative group">
                        {/* Card Effect */}
                        <div className={`absolute -inset-1 rounded-[26px] blur opacity-30 group-hover:opacity-50 transition duration-500 ${darkMode ? 'bg-gradient-to-r from-blue-600 to-purple-600' : 'bg-blue-200'}`}></div>

                        <div className={`relative w-64 h-64 ${darkMode ? 'bg-white' : 'bg-white'} p-4 rounded-[24px] shadow-sm flex items-center justify-center`}>
                            <img
                                src={`https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${walletAddress}`}
                                alt="QR Code"
                                className="w-full h-full object-contain rounded-xl"
                            />
                            {/* Logo Overlay */}
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                <div className="w-12 h-12 bg-white rounded-full p-1 shadow-md flex items-center justify-center overflow-hidden">
                                    <img src="https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ton/info/logo.png" alt="TON" className="w-full h-full object-cover" />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Address Container */}
                <div className={`mb-8 p-4 rounded-2xl ${darkMode ? 'bg-gray-900' : 'bg-gray-50'} border ${darkMode ? 'border-gray-800' : 'border-gray-100'}`}>
                    <p className={`text-xs text-center mb-2 font-medium ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                        {language === 'ar' ? 'عنوان محفظتك' : 'Your Wallet Address'}
                    </p>
                    <p className={`text-sm text-center font-mono break-all font-medium ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        {walletAddress}
                    </p>
                </div>

                {/* Actions */}
                <div className="grid grid-cols-2 gap-3">
                    <button
                        onClick={handleCopy}
                        className={`col-span-1 flex items-center justify-center gap-2 py-4 rounded-xl font-bold transition text-white shadow-lg shadow-blue-500/20 active:scale-95 ${copied ? 'bg-green-600' : 'bg-blue-600 hover:bg-blue-700'}`}
                    >
                        {copied ? <Check size={20} /> : <Copy size={20} />}
                        <span>{copied ? (language === 'ar' ? 'تم النسخ' : 'Copied') : (language === 'ar' ? 'نسخ' : 'Copy')}</span>
                    </button>

                    <button
                        onClick={handleShare}
                        className={`col-span-1 flex items-center justify-center gap-2 py-4 rounded-xl font-bold border transition active:scale-95 ${darkMode ? 'bg-gray-800 border-gray-700 text-white hover:bg-gray-700' : 'bg-white border-gray-200 text-gray-800 hover:bg-gray-50'}`}
                    >
                        <Share2 size={20} />
                        <span>{language === 'ar' ? 'مشاركة' : 'Share'}</span>
                    </button>
                </div>
            </div>
        </div>
    );
}

// Buy Modal - Simple redirect to Changelly
interface BuyModalProps extends BaseModalProps {
    walletAddress: string;
}

export function BuyModal({ isOpen, onClose, darkMode, language, walletAddress }: BuyModalProps) {
    const handleGoToSite = () => {
        window.open('https://changelly.com/buy-crypto', '_blank', 'noopener,noreferrer');
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className={`w-full max-w-sm ${darkMode ? 'bg-gray-900' : 'bg-white'} rounded-[24px] overflow-hidden animate-scale-up shadow-2xl`} onClick={(e) => e.stopPropagation()}>

                {/* Header */}
                <div className={`p-5 border-b ${darkMode ? 'border-gray-800' : 'border-gray-100'}`}>
                    <div className="flex justify-between items-center">
                        <h3 className={`text-lg font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                            {language === 'ar' ? 'شراء عملات رقمية' : 'Buy Crypto'}
                        </h3>
                        <button onClick={onClose} className={`p-2 rounded-full ${darkMode ? 'hover:bg-gray-800 text-gray-400' : 'hover:bg-gray-100 text-gray-500'} transition`}>
                            <X size={20} />
                        </button>
                    </div>
                </div>

                <div className="p-5">
                    {/* Changelly Provider Card */}
                    <button
                        onClick={handleGoToSite}
                        className={`w-full p-4 rounded-2xl ${darkMode ? 'bg-gray-800 hover:bg-gray-750' : 'bg-gray-50 hover:bg-gray-100'} transition group`}
                    >
                        <div className="flex items-center gap-4">
                            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center shadow-lg shadow-green-500/20">
                                <span className="text-white font-bold text-2xl">C</span>
                            </div>
                            <div className="flex-1 text-left">
                                <p className={`font-bold text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>Changelly</p>
                                <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                    {language === 'ar' ? 'محرك تبادل فوري' : 'An instant swap engine'}
                                </p>
                            </div>
                            <ChevronRight size={20} className={`${darkMode ? 'text-gray-500' : 'text-gray-400'} group-hover:translate-x-1 transition-transform`} />
                        </div>
                    </button>
                </div>
            </div>
        </div>
    );
}
// Swap Modal - Real On-Chain Swap Interface
interface SwapModalProps extends BaseModalProps {
    walletAddress: string;
    tokens: any[];
    onSwapInitiated?: (swapData: any) => void;
}

export function SwapModal({ isOpen, onClose, darkMode, language, walletAddress, tokens, onSwapInitiated }: SwapModalProps) {
    const [fromToken, setFromToken] = useState('TON');
    const [toToken, setToToken] = useState('USDT');
    const [amount, setAmount] = useState('');
    const [selectedDex, setSelectedDex] = useState<'stonfi' | 'dedust'>('stonfi');
    const [showFromPicker, setShowFromPicker] = useState(false);
    const [showToPicker, setShowToPicker] = useState(false);
    const [isLoadingQuote, setIsLoadingQuote] = useState(false);
    const [quote, setQuote] = useState<any>(null);
    const [error, setError] = useState('');

    const availableTokens = [
        { symbol: 'TON', name: 'Toncoin', icon: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ton/info/logo.png', decimals: 9 },
        { symbol: 'USDT', name: 'Tether USD', icon: 'https://tether.to/images/logoCircle.png', decimals: 6 },
        { symbol: 'USDC', name: 'USD Coin', icon: 'https://assets.coingecko.com/coins/images/6319/small/usdc.png', decimals: 6 },
        { symbol: 'NOT', name: 'Notcoin', icon: 'https://cache.tonapi.io/imgproxy/4KCMNm34jZLXt0rqeFm4rH-BK4FoK76EVX9r0cCIGDg/rs:fill:200:200:1/g:no/aHR0cHM6Ly9jZG4uam9pbmNvbW11bml0eS54eXovbm90L2xvZ28ucG5n.webp', decimals: 9 },
        { symbol: 'DOGS', name: 'Dogs', icon: 'https://cache.tonapi.io/imgproxy/4K0vW2fG-B3x-Kbp-i_ZC9nQHfO7uP5YJ3r7QoPqhvo/rs:fill:200:200:1/g:no/aHR0cHM6Ly9jZG4uam9pbmNvbW11bml0eS54eXovY2xpY2tlci9kb2dzL2xvZ28ucG5n.webp', decimals: 9 },
    ];

    const dexProviders = [
        { id: 'stonfi' as const, name: 'STON.fi' },
        { id: 'dedust' as const, name: 'DeDust' },
    ];

    const getToken = (symbol: string) => availableTokens.find(t => t.symbol === symbol);

    const getBalance = (symbol: string) => {
        const token = tokens.find(t => t.symbol === symbol);
        return token?.rawBalance || 0;
    };

    const handleSwapTokens = () => {
        const temp = fromToken;
        setFromToken(toToken);
        setToToken(temp);
        setQuote(null);
    };

    // Fetch quote when amount changes - using the new SwapService
    const fetchQuote = async () => {
        if (!amount || parseFloat(amount) <= 0 || fromToken === toToken) {
            setQuote(null);
            return;
        }

        setIsLoadingQuote(true);
        setError('');

        try {
            // Import the SwapService dynamically
            const { swapService } = await import('../services/SwapService');

            // Get the best quote from both DEXes (STON.fi and DeDust)
            const result = await swapService.getBestQuote(fromToken, toToken, amount);

            // Use the best quote
            const bestQuote = result.bestQuote;

            // Calculate rate for display
            const inputNum = parseFloat(bestQuote.inputAmount);
            const outputNum = parseFloat(bestQuote.outputAmount);
            const rate = inputNum > 0 ? (outputNum / inputNum).toFixed(4) : '0';

            setQuote({
                provider: bestQuote.provider,
                fromToken: bestQuote.fromToken,
                toToken: bestQuote.toToken,
                inputAmount: bestQuote.inputAmount,
                outputAmount: bestQuote.outputAmount,
                minOutputAmount: bestQuote.minOutputAmount,
                priceImpact: bestQuote.priceImpact || '< 0.1%',
                fee: bestQuote.fee || '~0.3%',
                rate: `1 ${fromToken} ≈ ${rate} ${toToken}`,
                isEstimate: bestQuote.isEstimate,
                poolAddress: bestQuote.poolAddress,
                allQuotes: result.allQuotes, // Store all quotes for comparison
            });

            // Update selected DEX to match best quote
            setSelectedDex(bestQuote.provider);
        } catch (err: any) {
            console.warn('[SwapModal] Quote error, using fallback:', err);

            // Fallback to approximate prices if SwapService fails
            // Updated to current market rates (Jan 2026)
            const fallbackPrices: Record<string, number> = {
                TON: 1.80,   // ~$1.80 per TON
                USDT: 1.0,
                USDC: 1.0,
                NOT: 0.005,
                DOGS: 0.0003,
            };

            const fromPrice = fallbackPrices[fromToken] || 1;
            const toPrice = fallbackPrices[toToken] || 1;
            const inputAmount = parseFloat(amount);
            const outputAmount = (inputAmount * fromPrice / toPrice);
            const minOutput = outputAmount * 0.99;
            const toDecimals = getToken(toToken)?.decimals || 6;

            setQuote({
                provider: selectedDex,
                fromToken,
                toToken,
                inputAmount: amount,
                outputAmount: outputAmount.toFixed(toDecimals > 6 ? 4 : 2),
                minOutputAmount: minOutput.toFixed(toDecimals > 6 ? 4 : 2),
                priceImpact: '< 0.1%',
                fee: '~0.3%',
                rate: `1 ${fromToken} ≈ ${(fromPrice / toPrice).toFixed(4)} ${toToken}`,
                isEstimate: true,
            });
        } finally {
            setIsLoadingQuote(false);
        }
    };

    // Debounce quote fetching when amount/tokens change
    React.useEffect(() => {
        const timer = setTimeout(() => {
            if (amount && parseFloat(amount) > 0) {
                fetchQuote();
            }
        }, 500);
        return () => clearTimeout(timer);
    }, [amount, fromToken, toToken, selectedDex]);

    // Auto-refresh prices every 10 seconds
    const [refreshCountdown, setRefreshCountdown] = React.useState(10);

    React.useEffect(() => {
        if (!isOpen || !amount || parseFloat(amount) <= 0) {
            setRefreshCountdown(10);
            return;
        }

        // Countdown timer
        const countdownInterval = setInterval(() => {
            setRefreshCountdown(prev => {
                if (prev <= 1) {
                    return 10; // Reset countdown
                }
                return prev - 1;
            });
        }, 1000);

        // Refresh prices every 10 seconds
        const refreshInterval = setInterval(() => {
            if (amount && parseFloat(amount) > 0 && !isLoadingQuote) {
                fetchQuote();
            }
        }, 10000);

        return () => {
            clearInterval(countdownInterval);
            clearInterval(refreshInterval);
        };
    }, [isOpen, amount, fromToken, toToken, selectedDex]);

    // Reset countdown when quote is manually fetched
    const handleManualRefresh = () => {
        setRefreshCountdown(10);
        if (amount && parseFloat(amount) > 0) {
            fetchQuote();
        }
    };

    const handleMaxClick = () => {
        const balance = getBalance(fromToken);
        // For TON, leave some for gas
        const max = fromToken === 'TON' ? Math.max(0, balance - 0.5) : balance;
        setAmount(max.toString());
    };

    const handleSwap = () => {
        if (!quote || !amount || parseFloat(amount) <= 0) return;

        const balance = getBalance(fromToken);
        if (parseFloat(amount) > balance) {
            setError(language === 'ar' ? 'رصيد غير كافي' : 'Insufficient balance');
            return;
        }

        // Trigger swap - this will open password modal for confirmation
        if (onSwapInitiated) {
            onSwapInitiated({
                fromToken,
                toToken,
                amount,
                minOutput: quote.minOutputAmount,
                provider: selectedDex,
                quote,
            });
        }
        onClose();
    };

    if (!isOpen) return null;

    const fromTokenData = getToken(fromToken);
    const toTokenData = getToken(toToken);
    const balance = getBalance(fromToken);
    const hasInsufficientBalance = parseFloat(amount || '0') > balance;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className={`w-full max-w-sm ${darkMode ? 'bg-gray-900' : 'bg-white'} rounded-2xl animate-scale-up shadow-xl`} onClick={(e) => e.stopPropagation()}>

                {/* Header */}
                <div className={`p-4 border-b ${darkMode ? 'border-gray-800' : 'border-gray-100'}`}>
                    <div className="flex justify-between items-center">
                        <h3 className={`text-lg font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                            {language === 'ar' ? 'تبديل' : 'Swap'}
                        </h3>
                        <button onClick={onClose} className={`p-1.5 rounded-full ${darkMode ? 'hover:bg-gray-800 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}>
                            <X size={18} />
                        </button>
                    </div>
                </div>

                <div className="p-4">
                    {/* Send Section */}
                    <div className={`p-3 rounded-xl mb-2 ${darkMode ? 'bg-gray-800' : 'bg-gray-50'}`}>
                        <div className="flex justify-between items-center mb-2">
                            <span className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                                {language === 'ar' ? 'أرسل' : 'Send'}
                            </span>
                            <div className="flex items-center gap-2">
                                <span className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                                    {language === 'ar' ? 'الرصيد:' : 'Balance:'} {balance.toFixed(4)}
                                </span>
                                <button
                                    onClick={handleMaxClick}
                                    className="text-xs text-blue-500 font-semibold hover:text-blue-400"
                                >
                                    MAX
                                </button>
                            </div>
                        </div>
                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => { setShowFromPicker(!showFromPicker); setShowToPicker(false); }}
                                className={`flex items-center gap-2 px-3 py-2 rounded-xl ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-white hover:bg-gray-100'} transition`}
                            >
                                <img src={fromTokenData?.icon} alt={fromToken} className="w-6 h-6 rounded-full" />
                                <span className={`font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>{fromToken}</span>
                                <ArrowDownToLine size={12} className={darkMode ? 'text-gray-400' : 'text-gray-500'} />
                            </button>
                            <input
                                type="number"
                                inputMode="decimal"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                placeholder="0"
                                style={{ MozAppearance: 'textfield' }}
                                className={`flex-1 text-right text-2xl font-bold bg-transparent outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${hasInsufficientBalance
                                    ? 'text-red-500'
                                    : darkMode ? 'text-white' : 'text-gray-900'
                                    }`}
                            />
                        </div>
                    </div>

                    {/* Token Picker - From */}
                    {showFromPicker && (
                        <div className={`rounded-xl mb-2 overflow-hidden ${darkMode ? 'bg-gray-800' : 'bg-gray-50'}`}>
                            {availableTokens.filter(t => t.symbol !== toToken).map((t) => (
                                <button
                                    key={t.symbol}
                                    onClick={() => { setFromToken(t.symbol); setShowFromPicker(false); setQuote(null); }}
                                    className={`w-full flex items-center gap-3 p-3 ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'} transition`}
                                >
                                    <img src={t.icon} alt={t.symbol} className="w-6 h-6 rounded-full" />
                                    <span className={`font-medium ${darkMode ? 'text-white' : 'text-gray-800'}`}>{t.symbol}</span>
                                    <span className={`text-sm ml-auto ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                                        {getBalance(t.symbol).toFixed(4)}
                                    </span>
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Swap Direction */}
                    <div className="flex justify-center -my-1 relative z-10">
                        <button
                            onClick={handleSwapTokens}
                            className={`p-2 rounded-full ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-white hover:bg-gray-100'} border-4 ${darkMode ? 'border-gray-900' : 'border-white'} shadow transition`}
                        >
                            <ArrowDownToLine size={16} className={darkMode ? 'text-gray-300' : 'text-gray-600'} />
                        </button>
                    </div>

                    {/* Receive Section */}
                    <div className={`p-3 rounded-xl mb-3 ${darkMode ? 'bg-gray-800' : 'bg-gray-50'}`}>
                        <div className="flex justify-between items-center mb-2">
                            <span className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                                {language === 'ar' ? 'استلم' : 'Receive'}
                            </span>
                            <span className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                                {language === 'ar' ? 'الرصيد:' : 'Balance:'} {getBalance(toToken).toFixed(4)}
                            </span>
                        </div>
                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => { setShowToPicker(!showToPicker); setShowFromPicker(false); }}
                                className={`flex items-center gap-2 px-3 py-2 rounded-xl ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-white hover:bg-gray-100'} transition`}
                            >
                                <img src={toTokenData?.icon} alt={toToken} className="w-6 h-6 rounded-full" />
                                <span className={`font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>{toToken}</span>
                                <ArrowDownToLine size={12} className={darkMode ? 'text-gray-400' : 'text-gray-500'} />
                            </button>
                            <div className="flex-1 text-right">
                                {isLoadingQuote ? (
                                    <Loader2 size={20} className={`animate-spin ml-auto ${darkMode ? 'text-gray-500' : 'text-gray-400'}`} />
                                ) : (
                                    <span className={`text-2xl font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                                        {quote ? quote.outputAmount : '0'}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Token Picker - To */}
                    {showToPicker && (
                        <div className={`rounded-xl mb-3 overflow-hidden ${darkMode ? 'bg-gray-800' : 'bg-gray-50'}`}>
                            {availableTokens.filter(t => t.symbol !== fromToken).map((t) => (
                                <button
                                    key={t.symbol}
                                    onClick={() => { setToToken(t.symbol); setShowToPicker(false); setQuote(null); }}
                                    className={`w-full flex items-center gap-3 p-3 ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'} transition`}
                                >
                                    <img src={t.icon} alt={t.symbol} className="w-6 h-6 rounded-full" />
                                    <span className={`font-medium ${darkMode ? 'text-white' : 'text-gray-800'}`}>{t.symbol}</span>
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Quote Info */}
                    {quote && !isLoadingQuote && (
                        <div className={`p-3 rounded-xl mb-3 ${darkMode ? 'bg-gray-800/50' : 'bg-gray-50'}`}>
                            {/* Rate with refresh indicator */}
                            <div className="flex justify-between items-center text-xs mb-1">
                                <span className={darkMode ? 'text-gray-500' : 'text-gray-400'}>{language === 'ar' ? 'السعر' : 'Rate'}</span>
                                <div className="flex items-center gap-2">
                                    <span className={darkMode ? 'text-gray-300' : 'text-gray-600'}>{quote.rate}</span>
                                    <button
                                        onClick={handleManualRefresh}
                                        className={`p-1 rounded-full hover:bg-gray-700/50 transition ${isLoadingQuote ? 'animate-spin' : ''}`}
                                        title={`${language === 'ar' ? 'تحديث' : 'Refresh'} (${refreshCountdown}s)`}
                                    >
                                        <RefreshCw size={12} className={darkMode ? 'text-gray-400' : 'text-gray-500'} />
                                    </button>
                                </div>
                            </div>
                            <div className="flex justify-between text-xs mb-1">
                                <span className={darkMode ? 'text-gray-500' : 'text-gray-400'}>{language === 'ar' ? 'الحد الأدنى' : 'Min. received'}</span>
                                <span className={darkMode ? 'text-gray-300' : 'text-gray-600'}>{quote.minOutputAmount} {toToken}</span>
                            </div>
                            <div className="flex justify-between text-xs mb-1">
                                <span className={darkMode ? 'text-gray-500' : 'text-gray-400'}>{language === 'ar' ? 'المنصة' : 'Provider'}</span>
                                <span className={darkMode ? 'text-gray-300' : 'text-gray-600'}>{selectedDex === 'stonfi' ? 'STON.fi' : 'DeDust'}</span>
                            </div>
                            {/* Live update indicator */}
                            <div className="flex items-center justify-center gap-1 mt-2 pt-2 border-t border-gray-700/50">
                                <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></div>
                                <span className={`text-[10px] ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                                    {language === 'ar' ? `تحديث تلقائي خلال ${refreshCountdown} ثانية` : `Auto-update in ${refreshCountdown}s`}
                                </span>
                            </div>
                        </div>
                    )}

                    {/* DEX Selection */}
                    <div className="flex gap-2 mb-3">
                        {dexProviders.map((dex) => (
                            <button
                                key={dex.id}
                                onClick={() => { setSelectedDex(dex.id); setQuote(null); }}
                                className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${selectedDex === dex.id
                                    ? 'bg-blue-500 text-white'
                                    : `${darkMode ? 'bg-gray-800 text-gray-400' : 'bg-gray-100 text-gray-600'}`
                                    }`}
                            >
                                {dex.name}
                            </button>
                        ))}
                    </div>

                    {/* Error Message */}
                    {error && (
                        <div className="p-2 mb-3 rounded-lg bg-red-500/10 border border-red-500/30">
                            <p className="text-red-500 text-sm text-center">{error}</p>
                        </div>
                    )}

                    {/* Swap Button */}
                    <button
                        onClick={handleSwap}
                        disabled={!quote || !amount || parseFloat(amount) <= 0 || hasInsufficientBalance || isLoadingQuote}
                        className="w-full py-3.5 rounded-xl bg-blue-500 hover:bg-blue-600 text-white font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                        {isLoadingQuote ? (
                            <Loader2 size={18} className="animate-spin" />
                        ) : hasInsufficientBalance ? (
                            language === 'ar' ? 'رصيد غير كافي' : 'Insufficient Balance'
                        ) : (
                            <>
                                <Send size={16} />
                                {language === 'ar' ? 'تبديل' : 'Swap'}
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}


// Backup Modal
interface BackupModalProps extends BaseModalProps {
    onShowPhrase: () => void;
    onShowPrivateKey: () => void;
}

export function BackupModal({ isOpen, onClose, darkMode, language, onShowPhrase, onShowPrivateKey }: BackupModalProps) {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className={`w-full max-w-sm ${darkMode ? 'bg-gray-900' : 'bg-white'} rounded-3xl p-6 animate-scale-up`} onClick={(e) => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-6">
                    <h3 className={`text-xl font-bold ${darkMode ? 'text-white' : 'text-gray-800'}`}>{language === 'ar' ? 'النسخ الاحتياطي' : 'Backup'}</h3>
                    <button onClick={onClose} className={`p-2 rounded-full ${darkMode ? 'hover:bg-gray-800 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}>
                        <X size={20} />
                    </button>
                </div>
                <div className="space-y-4">
                    <div className={`p-4 rounded-xl ${darkMode ? 'bg-yellow-950/30 border border-yellow-900/50' : 'bg-yellow-50 border border-yellow-200'}`}>
                        <p className={`text-sm ${darkMode ? 'text-yellow-500' : 'text-yellow-700'} leading-relaxed`}>
                            {language === 'ar' ? 'قم بحفظ العبارة السرية في مكان آمن. لا تشاركها مع أي أحد أبداً.' : 'Save your secret phrase in a safe place. Never share it with anyone.'}
                        </p>
                    </div>
                    <button onClick={onShowPhrase} className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 transition">
                        {language === 'ar' ? 'عرض العبارة السرية' : 'Show Secret Phrase'}
                    </button>
                    <button onClick={onShowPrivateKey} className={`w-full py-3 rounded-xl font-medium ${darkMode ? 'bg-gray-800 text-gray-300 hover:bg-gray-700' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'} transition`}>
                        {language === 'ar' ? 'عرض المفتاح الخاص' : 'Show Private Key'}
                    </button>
                    <button className={`w-full py-3 rounded-xl font-medium ${darkMode ? 'bg-gray-800 text-gray-300 hover:bg-gray-700' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'} transition`}>
                        {language === 'ar' ? 'حفظ في Google Drive' : 'Save to Google Drive'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// Phrase Modal
export function PhraseModal({ isOpen, onClose, darkMode, language, seedPhrase, handleCopyPhrase, copiedPhrase }: PhraseModalProps) {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 bg-black/50 flex items-end justify-center z-50" onClick={onClose}>
            <div className={`w-full max-w-md ${darkMode ? 'bg-gray-900' : 'bg-white'} rounded-t-3xl p-6 animate-slide-up max-h-[90vh] overflow-y-auto no-scrollbar`} onClick={(e) => e.stopPropagation()}>
                <div className="w-12 h-1 bg-gray-300 rounded-full mx-auto mb-6"></div>

                <div className="flex justify-between items-center mb-6">
                    <h3 className={`text-xl font-bold ${darkMode ? 'text-white' : 'text-gray-800'}`}>{language === 'ar' ? 'العبارة السرية' : 'Secret Phrase'}</h3>
                    <button
                        onClick={handleCopyPhrase}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition ${darkMode ? 'bg-blue-950 text-blue-400 hover:bg-blue-900' : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
                            }`}
                    >
                        {copiedPhrase ? <Check size={16} /> : <Copy size={16} />}
                        {copiedPhrase ? (language === 'ar' ? 'تم النسخ' : 'Copied') : (language === 'ar' ? 'نسخ' : 'Copy')}
                    </button>
                </div>

                <div className={`grid grid-cols-2 gap-3 mb-6`}>
                    {seedPhrase.map((word, index) => (
                        <div key={index} className={`relative flex items-center gap-3 p-3.5 rounded-2xl border transition-all hover:shadow-md ${darkMode ? 'bg-gray-800/50 border-gray-700' : 'bg-white border-gray-100 shadow-sm'}`}>
                            <span className={`flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold ${darkMode ? 'bg-gray-700 text-gray-400' : 'bg-blue-50 text-blue-600'}`}>
                                {index + 1}
                            </span>
                            <span className={`font-bold tracking-wide ${darkMode ? 'text-white' : 'text-gray-800'}`}>
                                {word}
                            </span>
                        </div>
                    ))}
                </div>

                <div className={`flex items-start gap-3 p-4 rounded-xl mb-6 ${darkMode ? 'bg-red-500/10 border border-red-500/20' : 'bg-red-50 border border-red-100'}`}>
                    <TriangleAlert className="text-red-500 shrink-0" size={20} />
                    <p className={`text-xs font-medium leading-relaxed ${darkMode ? 'text-red-400' : 'text-red-600'}`}>
                        {language === 'ar'
                            ? 'تحذير: لا تقم بتصوير الشاشة. أي شخص يملك هذه الكلمات يمكنه الوصول لأموالك.'
                            : 'Warning: Do not take screenshots. Anyone with these words can access your funds.'}
                    </p>
                </div>

                <button onClick={onClose} className={`w-full py-4 rounded-xl font-bold ${darkMode ? 'bg-gray-800 text-white hover:bg-gray-700' : 'bg-gray-100 text-gray-900 hover:bg-gray-200'} transition`}>
                    {language === 'ar' ? 'إغلاق' : 'Close'}
                </button>
            </div>
        </div>
    );
}

// Transaction Modal
export function TransactionModal({ transaction, onClose, darkMode, language }: TransactionModalProps) {
    if (!transaction) return null;
    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end justify-center z-50" onClick={onClose}>
            <div className={`w-full max-w-sm ${darkMode ? 'bg-gray-950' : 'bg-white'} rounded-t-[32px] p-6 animate-slide-up shadow-2xl`} onClick={(e) => e.stopPropagation()}>
                <div className="w-10 h-1 bg-gray-300/50 rounded-full mx-auto mb-8"></div>

                <div className="text-center mb-8">
                    <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 border ${darkMode ? 'bg-gray-900 border-gray-800' : 'bg-gray-50 border-gray-100'
                        }`}>
                        {transaction.type === 'received' ? (
                            <ArrowDownToLine size={28} className={darkMode ? 'text-gray-300' : 'text-gray-700'} />
                        ) : (
                            <Send size={28} className={darkMode ? 'text-gray-300' : 'text-gray-700'} />
                        )}
                    </div>

                    <h2 className={`text-3xl font-bold mb-1 tracking-tight ${darkMode ? 'text-white' : 'text-gray-900'} dir-ltr`}>
                        {transaction.amount} <span className="text-xl font-medium text-gray-400">{transaction.token}</span>
                    </h2>

                    <p className={`text-sm font-medium ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                        {transaction.time}
                    </p>
                </div>

                <div className="space-y-4 mb-8">
                    <div className={`p-5 rounded-2xl ${darkMode ? 'bg-gray-900' : 'bg-gray-50'} space-y-4`}>
                        {/* Status Row */}
                        <div className="flex justify-between items-center">
                            <span className={`text-sm font-medium ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                                {language === 'ar' ? 'الحالة' : 'Status'}
                            </span>
                            <div className="flex items-center gap-1.5">
                                <div className="w-2 h-2 rounded-full bg-green-500"></div>
                                <span className={`text-sm font-semibold ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                    {language === 'ar' ? 'مكتمل' : 'Completed'}
                                </span>
                            </div>
                        </div>

                        {/* Fee Row */}
                        <div className="flex justify-between items-center">
                            <span className={`text-sm font-medium ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                                {language === 'ar' ? 'الرسوم' : 'Fee'}
                            </span>
                            <span className={`text-sm font-medium ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                {transaction.fee} TON
                            </span>
                        </div>

                        {/* Divider */}
                        <div className={`h-px w-full ${darkMode ? 'bg-gray-800' : 'bg-gray-200'}`}></div>

                        {/* Address Row */}
                        <div>
                            <div className="flex justify-between items-center mb-1">
                                <span className={`text-xs font-bold uppercase tracking-wider ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                                    {transaction.type === 'received' ? (language === 'ar' ? 'من' : 'From') : (language === 'ar' ? 'إلى' : 'To')}
                                </span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                                <p className={`text-sm font-mono break-all ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                                    {transaction.from}
                                </p>
                                <button
                                    onClick={() => navigator.clipboard.writeText(transaction.from)}
                                    className={`p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-800 transition text-gray-400 hover:text-gray-600`}
                                >
                                    <Copy size={16} />
                                </button>
                            </div>
                        </div>

                        {/* Hash Row */}
                        <div className="pt-2">
                            <div className="flex justify-between items-center mb-1">
                                <span className={`text-xs font-bold uppercase tracking-wider ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                                    {language === 'ar' ? 'المعرف' : 'Hash'}
                                </span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                                <p className={`text-xs font-mono break-all text-gray-500`}>
                                    {transaction.hash}
                                </p>
                                <button
                                    onClick={() => navigator.clipboard.writeText(transaction.hash)}
                                    className={`p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-800 transition text-gray-400 hover:text-gray-600`}
                                >
                                    <Copy size={14} />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex gap-3">
                    <button className={`flex-1 py-4 rounded-xl font-bold flex items-center justify-center gap-2 transition ${darkMode ? 'bg-gray-800 text-white hover:bg-gray-800/80' : 'bg-gray-100 text-gray-900 hover:bg-gray-200'
                        }`}>
                        <ExternalLink size={18} />
                        <span>{language === 'ar' ? 'المستكشف' : 'Explorer'}</span>
                    </button>
                    <button
                        onClick={onClose}
                        className="flex-1 bg-black text-white dark:bg-white dark:text-black py-4 rounded-xl font-bold hover:opacity-90 transition"
                    >
                        {language === 'ar' ? 'إغلاق' : 'Close'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// Private Key Modal
interface PrivateKeyModalProps {
    isOpen: boolean;
    onClose: () => void;
    darkMode: boolean;
    language: string;
    privateKey: string;
}

export function PrivateKeyModal({ isOpen, onClose, darkMode, language, privateKey }: PrivateKeyModalProps) {
    const [copied, setCopied] = useState(false);
    if (!isOpen) return null;
    const handleCopy = () => {
        navigator.clipboard.writeText(privateKey);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };
    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className={`w-full max-w-sm ${darkMode ? 'bg-gray-900' : 'bg-white'} rounded-3xl p-6 animate-scale-up`} onClick={(e) => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-6">
                    <h3 className={`text-xl font-bold ${darkMode ? 'text-white' : 'text-gray-800'}`}>{language === 'ar' ? 'المفتاح الخاص' : 'Private Key'}</h3>
                    <button onClick={onClose} className={`p-2 rounded-full ${darkMode ? 'hover:bg-gray-800 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}>
                        <X size={20} />
                    </button>
                </div>
                <div className="space-y-4">
                    <div className={`p-4 rounded-xl break-all font-mono text-xs ${darkMode ? 'bg-gray-800 text-gray-200' : 'bg-gray-100 text-gray-800'}`}>
                        {privateKey}
                    </div>
                    <button onClick={handleCopy} className={`w-full py-3 rounded-xl font-bold flex items-center justify-center gap-2 ${copied ? 'bg-green-600 text-white' : 'bg-blue-600 text-white hover:bg-blue-700'} transition`}>
                        {copied ? <Check size={18} /> : <Copy size={18} />}
                        {copied ? (language === 'ar' ? 'تم النسخ' : 'Copied') : (language === 'ar' ? 'نسخ المفتاح' : 'Copy Key')}
                    </button>
                    <div className={`p-3 rounded-xl flex items-start gap-2 ${darkMode ? 'bg-red-900/20 text-red-400' : 'bg-red-50 text-red-600'}`}>
                        <TriangleAlert size={18} className="shrink-0 mt-0.5" />
                        <span className="text-xs font-medium leading-tight">{language === 'ar' ? 'تحذير: لا تشارك هذا المفتاح مع أي شخص. يمكنه سرقة أموالك.' : 'Warning: Never share this key. Anyone with it can access your funds.'}</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
