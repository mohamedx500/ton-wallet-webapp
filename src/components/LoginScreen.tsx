import React, { useState, useEffect } from 'react';
import { Wallet, ShieldCheck, Eye, EyeOff, Copy, Check, Loader2, ChevronLeft, Download, Plus, Lock } from 'lucide-react';
import { useWallet } from '../context/WalletContext';
import { mnemonicNew, mnemonicValidate } from '@ton/crypto';
import { cn } from '../lib/utils';
import NetworkBanner from './NetworkBanner';
import ConfirmDialog from './ConfirmDialog';

interface LoginScreenProps {
    darkMode: boolean;
}

function Shell({ children, darkMode }: { children: React.ReactNode; darkMode: boolean }) {
    return (
        <div className={cn("min-h-screen flex items-center justify-center p-4 relative", darkMode ? "dark bg-[hsl(224,20%,5%)]" : "bg-gradient-to-br from-slate-50 via-blue-50/40 to-indigo-50/30")} dir="ltr">
            <NetworkBanner darkMode={darkMode} />
            <div className="fixed inset-0 overflow-hidden pointer-events-none">
                <div className={cn("absolute -top-40 -right-40 w-96 h-96 rounded-full blur-3xl", darkMode ? "bg-blue-900/20" : "bg-blue-200/40")} />
                <div className={cn("absolute -bottom-40 -left-40 w-96 h-96 rounded-full blur-3xl", darkMode ? "bg-indigo-900/15" : "bg-indigo-200/30")} />
            </div>
            <div className={cn("w-full max-w-md relative z-10 rounded-3xl p-8 animate-scale-in", "glass-strong")}>
                {children}
            </div>
        </div>
    );
}

function Logo() {
    return (
        <div className="flex justify-center mb-8">
            <div className={cn("w-[72px] h-[72px] rounded-[22px] flex items-center justify-center", "bg-gradient-to-br from-blue-500 to-blue-600 shadow-lg shadow-blue-500/25")}>
                <Wallet size={32} className="text-white" strokeWidth={1.8} />
            </div>
        </div>
    );
}

export default function LoginScreen({ darkMode }: LoginScreenProps) {
    const { hasPassword, unlockWallet, createWallet, importWallet, isLoading, resetWallet, activeAccount } = useWallet();
    const [view, setView] = useState<'initial' | 'unlock' | 'password_setup' | 'mnemonic_show' | 'mnemonic_input'>('initial');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [mnemonicWords, setMnemonicWords] = useState<string[]>([]);
    const [importText, setImportText] = useState('');
    const [copied, setCopied] = useState(false);
    const [isImportFlow, setIsImportFlow] = useState(false);
    const [showResetConfirm, setShowResetConfirm] = useState(false);

    useEffect(() => {
        if (hasPassword) {
            setView('unlock');
        }
    }, [hasPassword]);

    const handleUnlock = async (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!password) return;
        setError('');
        const success = await unlockWallet(password);
        if (!success) setError('Incorrect password');
    };

    const startCreate = async () => {
        setIsImportFlow(false);
        setPassword('');
        setConfirmPassword('');
        setError('');
        const words = await mnemonicNew(24);
        setMnemonicWords(words);
        setView('mnemonic_show');
    };

    const startImport = () => {
        setIsImportFlow(true);
        setImportText('');
        setError('');
        setView('mnemonic_input');
    };

    const handleMnemonicInput = () => {
        const words = importText
            .trim()
            .split(/\s+/)
            .map((word) =>
                word
                    .normalize('NFKD')
                    .toLowerCase()
                    .replace(/[\u200B-\u200D\uFEFF]/g, '')
                    .trim()
            )
            .filter(Boolean);
        if (words.length !== 24) {
            setError(`Expected 24 words, got ${words.length}`);
            return;
        }
        mnemonicValidate(words).then((isValid) => {
            if (!isValid) {
                setError('Invalid mnemonic phrase');
                return;
            }
            setMnemonicWords(words);
            setPassword('');
            setConfirmPassword('');
            setError('');
            setView('password_setup');
        });
    };

    const handlePasswordSetup = async (e?: React.FormEvent) => {
        e?.preventDefault();
        if (password.length < 4) {
            setError('Password too short');
            return;
        }
        if (password !== confirmPassword) {
            setError('Passwords do not match');
            return;
        }

        setError('');
        if (isImportFlow) {
            try {
                await importWallet(mnemonicWords, password, 'Main Wallet');
            } catch (e) {
                setError('Failed to import wallet');
            }
        } else {
            try {
                // Pass the already generated mnemonic to register it
                await createWallet(password, mnemonicWords, 'Main Wallet');
                // No need to set view, component will unmount as isLoggedIn becomes true
            } catch (e) {
                setError('Failed to create wallet');
            }
        }
    };

    const handleCopy = () => {
        navigator.clipboard.writeText(mnemonicWords.join(' '));
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };


    if (view === 'unlock') {
        return (
            <Shell darkMode={darkMode}>
                <Logo />
                <h2 className={cn("text-2xl font-bold text-center mb-1", darkMode ? "text-white" : "text-gray-900")}>Welcome Back</h2>
                {activeAccount && (
                    <p className={cn("text-sm text-center mb-6", darkMode ? "text-gray-400" : "text-gray-500")}>
                        <span className="font-medium">{activeAccount.name}</span>
                    </p>
                )}
                {!activeAccount && <div className="mb-6" />}
                <form onSubmit={handleUnlock} className="space-y-4">
                    <div className="relative w-full">
                        <Lock size={16} className={cn("absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none", darkMode ? "text-gray-500" : "text-gray-400")} />
                        <input
                            type={showPassword ? 'text' : 'password'}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            name="wallet-unlock-input-unique"
                            id="wallet-unlock-input-unique"
                            autoComplete="new-password"
                            data-lpignore="true"
                            data-1p-ignore="true"
                            data-form-type="other"
                            spellCheck="false"
                            placeholder="Enter Password"
                            className={cn(
                                "w-full pl-11 pr-12 py-3.5 rounded-2xl text-sm font-medium outline-none transition-all",
                                darkMode ? "bg-white/5 border border-white/10 text-white placeholder:text-gray-500 focus:border-blue-500/50 focus:bg-white/[0.07]" : "bg-white/70 border border-gray-200/80 text-gray-900 placeholder:text-gray-400 focus:border-blue-400 focus:bg-white"
                            )}
                            autoFocus
                        />
                        <button type="button" onClick={() => setShowPassword(!showPassword)} className={cn("absolute right-4 top-1/2 -translate-y-1/2", darkMode ? "text-gray-500 hover:text-gray-300" : "text-gray-400 hover:text-gray-600")}>
                            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                    </div>
                    {error && <p className="text-red-500 text-sm text-center font-medium">{error}</p>}
                    <button disabled={isLoading} className="w-full bg-gradient-to-r from-blue-500 to-blue-600 text-white py-3.5 rounded-2xl font-semibold text-sm hover:from-blue-600 hover:to-blue-700 transition-all flex justify-center shadow-lg shadow-blue-500/20 active:scale-[0.98]">
                        {isLoading ? <Loader2 size={20} className="animate-spin" /> : 'Unlock'}
                    </button>
                </form>
                <div className={cn("mt-6 pt-6 text-center", darkMode ? "border-t border-white/5" : "border-t border-gray-200/60")}>
                    <button
                        onClick={() => setShowResetConfirm(true)}
                        className={cn("text-xs font-medium transition-colors", darkMode ? "text-gray-600 hover:text-gray-400" : "text-gray-400 hover:text-gray-600")}
                    >
                        Reset / Forgot Password
                    </button>
                </div>
                <ConfirmDialog
                    isOpen={showResetConfirm}
                    title="Reset Wallet"
                    message="This will delete your local data. Make sure you have your seed phrase backed up!"
                    confirmLabel="Reset"
                    cancelLabel="Cancel"
                    variant="danger"
                    onConfirm={() => {
                        setShowResetConfirm(false);
                        resetWallet();
                        setView('initial');
                    }}
                    onCancel={() => setShowResetConfirm(false)}
                    darkMode={darkMode}
                />
            </Shell>
        );
    }

    if (view === 'mnemonic_input') {
        return (
            <Shell darkMode={darkMode}>
                <button onClick={() => setView('initial')} className={cn("mb-6 flex items-center gap-1 text-sm font-medium transition-colors", darkMode ? "text-gray-400 hover:text-white" : "text-gray-500 hover:text-gray-900")}>
                    <ChevronLeft size={18} />
                    Back
                </button>
                <div className="flex items-center gap-3 mb-6">
                    <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", darkMode ? "bg-blue-500/10" : "bg-blue-50")}>
                        <Download size={18} className="text-blue-500" />
                    </div>
                    <div>
                        <h2 className={cn("text-lg font-bold", darkMode ? "text-white" : "text-gray-900")}>Import Wallet</h2>
                        <p className={cn("text-xs", darkMode ? "text-gray-500" : "text-gray-400")}>Enter your 24 secret words</p>
                    </div>
                </div>
                <textarea
                    value={importText}
                    onChange={(e) => setImportText(e.target.value)}
                    className={cn(
                        "w-full h-36 p-4 rounded-2xl mb-4 text-sm font-mono resize-none outline-none transition-all",
                        darkMode ? "bg-white/5 border border-white/10 text-white placeholder:text-gray-600 focus:border-blue-500/40" : "bg-white/70 border border-gray-200/80 text-gray-900 placeholder:text-gray-400 focus:border-blue-400"
                    )}
                    placeholder="word1 word2 word3 ..."
                />
                {error && <p className="text-red-500 text-sm mb-4 font-medium">{error}</p>}
                <button onClick={handleMnemonicInput} className="w-full bg-gradient-to-r from-blue-500 to-blue-600 text-white py-3.5 rounded-2xl font-semibold text-sm hover:from-blue-600 hover:to-blue-700 transition-all shadow-lg shadow-blue-500/20 active:scale-[0.98]">
                    Continue
                </button>
            </Shell>
        );
    }

    if (view === 'password_setup') {
        return (
            <Shell darkMode={darkMode}>
                <button onClick={() => setView(isImportFlow ? 'mnemonic_input' : 'initial')} className={cn("mb-6 flex items-center gap-1 text-sm font-medium transition-colors", darkMode ? "text-gray-400 hover:text-white" : "text-gray-500 hover:text-gray-900")}>
                    <ChevronLeft size={18} />
                    Back
                </button>
                <div className="text-center mb-6">
                    <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-3", darkMode ? "bg-blue-500/10" : "bg-blue-50")}>
                        <Lock size={20} className="text-blue-500" />
                    </div>
                    <h2 className={cn("text-lg font-bold", darkMode ? "text-white" : "text-gray-900")}>Set Password</h2>
                    <p className={cn("text-xs mt-1", darkMode ? "text-gray-500" : "text-gray-400")}>This password will encrypt your wallet locally</p>
                </div>
                <form onSubmit={handlePasswordSetup} className="space-y-3">
                    <div className="relative">
                        <div>
                            <input
                                type={showPassword ? 'text' : 'password'}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                autoComplete="new-password"
                                data-lpignore="true"
                                data-1p-ignore="true"
                                data-form-type="other"
                                spellCheck="false"
                                placeholder="New Password"
                                className={cn(
                                    "w-full px-4 pr-12 py-3.5 rounded-2xl text-sm font-medium outline-none transition-all",
                                    darkMode ? "bg-white/5 border border-white/10 text-white placeholder:text-gray-500 focus:border-blue-500/50" : "bg-white/70 border border-gray-200/80 text-gray-900 placeholder:text-gray-400 focus:border-blue-400"
                                )}
                            />
                        </div>
                        <button type="button" onClick={() => setShowPassword(!showPassword)} className={cn("absolute right-4 top-1/2 -translate-y-1/2", darkMode ? "text-gray-500 hover:text-gray-300" : "text-gray-400 hover:text-gray-600")}>
                            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                    </div>
                    {password.length > 0 && (
                        <div className="flex gap-1.5 px-1">
                            {[0, 1, 2, 3].map(i => {
                                const strength = password.length >= 12 ? 4 : password.length >= 8 ? 3 : password.length >= 6 ? 2 : password.length >= 4 ? 1 : 0;
                                const colors = ['bg-red-500', 'bg-orange-500', 'bg-amber-500', 'bg-emerald-500'];
                                return (
                                    <div key={i} className={cn("h-1 flex-1 rounded-full transition-all duration-300", i < strength ? colors[strength - 1] : darkMode ? "bg-white/10" : "bg-gray-200")} />
                                );
                            })}
                        </div>
                    )}
                    <div>
                        <input
                            type={showPassword ? 'text' : 'password'}
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            autoComplete="new-password"
                            data-lpignore="true"
                            data-1p-ignore="true"
                            data-form-type="other"
                            spellCheck="false"
                            placeholder="Confirm Password"
                            className={cn(
                                "w-full px-4 py-3.5 rounded-2xl text-sm font-medium outline-none transition-all",
                                darkMode ? "bg-white/5 border border-white/10 text-white placeholder:text-gray-500 focus:border-blue-500/50" : "bg-white/70 border border-gray-200/80 text-gray-900 placeholder:text-gray-400 focus:border-blue-400"
                            )}
                        />
                    </div>
                    {error && <p className="text-red-500 text-sm text-center font-medium">{error}</p>}
                    <button disabled={isLoading} className="w-full bg-gradient-to-r from-blue-500 to-blue-600 text-white py-3.5 rounded-2xl font-semibold text-sm hover:from-blue-600 hover:to-blue-700 transition-all flex justify-center shadow-lg shadow-blue-500/20 active:scale-[0.98]">
                        {isLoading ? <Loader2 size={20} className="animate-spin" /> : (isImportFlow ? 'Import Wallet' : 'Create Wallet')}
                    </button>
                </form>
            </Shell>
        );
    }

    if (view === 'mnemonic_show') {
        return (
            <Shell darkMode={darkMode}>
                <div className="text-center mb-5">
                    <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-3", "bg-red-500/10")}>
                        <ShieldCheck size={20} className="text-red-500" />
                    </div>
                    <h2 className={cn("text-lg font-bold", darkMode ? "text-white" : "text-gray-900")}>Recovery Phrase</h2>
                    <p className={cn("text-xs mt-1", darkMode ? "text-gray-500" : "text-gray-400")}>Write these down. We cannot recover them for you.</p>
                </div>

                <div className="grid grid-cols-3 gap-1.5 mb-5 max-h-[38vh] overflow-y-auto no-scrollbar">
                    {mnemonicWords.map((word, i) => (
                        <div key={i} className={cn("text-xs py-2 px-2.5 rounded-xl flex items-center gap-1.5", darkMode ? "bg-white/5" : "bg-gray-50/80 border border-gray-100")}>
                            <span className={cn("text-[10px] font-medium w-4 text-right", darkMode ? "text-gray-600" : "text-gray-300")}>{i + 1}</span>
                            <span className={cn("font-mono font-semibold", darkMode ? "text-white" : "text-gray-800")}>{word}</span>
                        </div>
                    ))}
                </div>

                <button onClick={handleCopy} className={cn("w-full mb-3 flex items-center justify-center gap-2 py-3 rounded-2xl text-sm font-medium transition-all active:scale-[0.98]", darkMode ? "glass-btn text-gray-300" : "glass-btn text-gray-600")}>
                    {copied ? <Check size={16} className="text-green-500" /> : <Copy size={16} />}
                    {copied ? 'Copied!' : 'Copy to Clipboard'}
                </button>

                <button onClick={() => setView('password_setup')} className="w-full bg-gradient-to-r from-blue-500 to-blue-600 text-white py-3.5 rounded-2xl font-semibold text-sm hover:from-blue-600 hover:to-blue-700 transition-all shadow-lg shadow-blue-500/20 active:scale-[0.98]">
                    I Saved It
                </button>
            </Shell>
        );
    }

    // Initial view
    return (
        <Shell darkMode={darkMode}>
            <Logo />
            <h1 className={cn("text-2xl font-bold text-center mb-1", darkMode ? "text-white" : "text-gray-900")}>TON Wallet</h1>
            <p className={cn("text-sm text-center mb-10", darkMode ? "text-gray-500" : "text-gray-400")}>
                Secure & Fast Crypto Wallet
            </p>

            <div className="space-y-3">
                <button
                    onClick={startCreate}
                    className="w-full bg-gradient-to-r from-blue-500 to-blue-600 text-white py-3.5 rounded-2xl font-semibold text-sm hover:from-blue-600 hover:to-blue-700 transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20 active:scale-[0.98]"
                >
                    <Plus size={18} strokeWidth={2.5} />
                    Create New Wallet
                </button>

                <button
                    onClick={startImport}
                    className={cn("w-full py-3.5 rounded-2xl font-semibold text-sm transition-all flex items-center justify-center gap-2 active:scale-[0.98]", darkMode ? "glass-btn text-gray-300" : "glass-btn text-gray-600")}
                >
                    <Download size={18} />
                    I Have a Wallet
                </button>
            </div>

            <div className={cn("mt-10 flex items-center justify-center gap-1.5 text-[11px]", darkMode ? "text-gray-600" : "text-gray-400")}>
                <ShieldCheck size={12} />
                <span>End-to-end encrypted</span>
            </div>
        </Shell>
    );
}
