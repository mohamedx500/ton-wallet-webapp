import React, { useState } from 'react';
import { X, Copy, ExternalLink, ArrowDownToLine, Send, Check, Eye, EyeOff, Loader2, Share2, Wallet, TriangleAlert } from 'lucide-react';

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
}

// Token Details Modal
export function TokenDetailsModal({ isOpen, onClose, token, transactions, darkMode, language }: TokenDetailsModalProps) {
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
                    <button className="flex-1 bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 transition">
                        {language === 'ar' ? 'إرسال' : 'Send'}
                    </button>
                    <button className="flex-1 bg-green-600 text-white py-3 rounded-xl font-bold hover:bg-green-700 transition">
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

// Buy Modal
export function BuyModal({ isOpen, onClose, darkMode, language }: BaseModalProps) {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className={`w-full max-w-sm ${darkMode ? 'bg-gray-900' : 'bg-white'} rounded-3xl p-6 animate-scale-up`} onClick={(e) => e.stopPropagation()}>
                <div className="text-center">
                    <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <ExternalLink size={32} className="text-blue-600" />
                    </div>
                    <h3 className={`text-xl font-bold ${darkMode ? 'text-white' : 'text-gray-800'} mb-2`}>{language === 'ar' ? 'شراء TON' : 'Buy TON'}</h3>
                    <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'} mb-6`}>
                        {language === 'ar' ? 'سيتم تحويلك إلى مزود خدمة خارجي لإكمال عملية الشراء.' : 'You will be redirected to an external provider to complete the purchase.'}
                    </p>
                    <div className="flex gap-3">
                        <button onClick={onClose} className={`flex-1 py-3 rounded-xl font-medium ${darkMode ? 'bg-gray-800 text-gray-300 hover:bg-gray-700' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'} transition`}>
                            {language === 'ar' ? 'إلغاء' : 'Cancel'}
                        </button>
                        <button className="flex-1 bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 transition">
                            {language === 'ar' ? 'متابعة' : 'Continue'}
                        </button>
                    </div>
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
        <div className="fixed inset-0 bg-black/50 flex items-end justify-center z-50" onClick={onClose}>
            <div className={`w-full max-w-md ${darkMode ? 'bg-gray-900' : 'bg-white'} rounded-t-3xl p-6 animate-slide-up`} onClick={(e) => e.stopPropagation()}>
                <div className="w-12 h-1 bg-gray-300 rounded-full mx-auto mb-6"></div>

                <div className="text-center mb-8">
                    <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${transaction.type === 'received'
                        ? darkMode ? 'bg-green-950 text-green-400' : 'bg-green-100 text-green-600'
                        : darkMode ? 'bg-red-950 text-red-400' : 'bg-red-100 text-red-600'
                        }`}>
                        {transaction.type === 'received' ? <ArrowDownToLine size={32} /> : <Send size={32} />}
                    </div>
                    <h2 className={`text-2xl font-bold mb-1 ${darkMode ? 'text-white' : 'text-gray-900'} dir-ltr`}>
                        {transaction.amount} {transaction.token}
                    </h2>
                    <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                        {transaction.date}
                    </p>
                </div>

                <div className="space-y-4 mb-8">
                    <div className={`p-4 rounded-xl ${darkMode ? 'bg-gray-800' : 'bg-gray-50'} space-y-3`}>
                        <div className="flex justify-between items-center">
                            <span className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{language === 'ar' ? 'الحالة' : 'Status'}</span>
                            <span className={`text-sm font-medium ${darkMode ? 'text-green-400' : 'text-green-600'}`}>{language === 'ar' ? 'مكتمل' : 'Completed'}</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{language === 'ar' ? 'الرسوم' : 'Fee'}</span>
                            <span className={`text-sm font-medium ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>{transaction.fee} TON</span>
                        </div>
                        <div className="pt-3 border-t border-gray-200 dark:border-gray-700">
                            <div className="mb-1">
                                <span className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                    {transaction.type === 'received' ? (language === 'ar' ? 'من' : 'From') : (language === 'ar' ? 'إلى' : 'To')}
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                <p className={`text-xs font-mono break-all ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                                    {transaction.type === 'received' ? transaction.fullFrom : transaction.fullTo}
                                </p>
                                <button className={`p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition`}>
                                    <Copy size={12} className={darkMode ? 'text-gray-400' : 'text-gray-500'} />
                                </button>
                            </div>
                        </div>
                        <div className="pt-3 border-t border-gray-200 dark:border-gray-700">
                            <div className="mb-1">
                                <span className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{language === 'ar' ? 'رقم المعاملة' : 'Transaction Hash'}</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <p className={`text-xs font-mono break-all ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                                    {transaction.hash}
                                </p>
                                <button className={`p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition`}>
                                    <Copy size={12} className={darkMode ? 'text-gray-400' : 'text-gray-500'} />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex gap-3">
                    <button className={`flex-1 py-3 rounded-xl font-bold ${darkMode ? 'bg-gray-800 text-white hover:bg-gray-700' : 'bg-gray-100 text-gray-900 hover:bg-gray-200'} transition flex items-center justify-center gap-2`}>
                        <ExternalLink size={18} />
                        <span>{language === 'ar' ? 'عرض في المستكشف' : 'View in Explorer'}</span>
                    </button>
                    <button onClick={onClose} className="flex-1 bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 transition">
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
