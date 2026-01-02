import React, { useState, useEffect } from 'react';
import { Wallet, Shield, ArrowRight, Eye, EyeOff, Copy, Check, Loader2, ChevronLeft, Import } from 'lucide-react';
import { useWallet } from '../context/WalletContext';
import { mnemonicNew } from '@ton/crypto';
import NetworkBanner from './NetworkBanner';

interface LoginScreenProps {
    darkMode: boolean;
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
        const words = importText.trim().split(/\s+/);
        if (words.length !== 24) {
            setError(`Expected 24 words, got ${words.length}`);
            return;
        }
        setMnemonicWords(words);
        setPassword('');
        setConfirmPassword('');
        setError('');
        setView('password_setup');
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

    // Render Components
    const Logo = () => (
        <div className="flex justify-center mb-8">
            <div className="w-20 h-20 bg-blue-600 rounded-3xl flex items-center justify-center shadow-lg transform rotate-3">
                <Wallet size={40} className="text-white" />
            </div>
        </div>
    );

    if (view === 'unlock') {
        return (
            <div className={`min-h-screen ${darkMode ? 'bg-black text-white' : 'bg-gradient-to-br from-blue-50 to-indigo-50 text-gray-800'} flex items-center justify-center p-4`} dir="ltr">
                <NetworkBanner darkMode={darkMode} />
                <div className={`w-full max-w-md ${darkMode ? 'bg-gray-950' : 'bg-white'} rounded-3xl shadow-2xl p-8 text-center`}>
                    <Logo />
                    <h2 className="text-2xl font-bold mb-2">Welcome Back</h2>
                    {activeAccount && (
                        <p className={`text-sm mb-4 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                            Unlocking: <span className="font-semibold">{activeAccount.name}</span>
                        </p>
                    )}
                    <form onSubmit={handleUnlock} className="space-y-4">
                        <div className="relative">
                            <input
                                type={showPassword ? 'text' : 'password'}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Enter Password"
                                className={`w-full p-4 pr-12 rounded-xl ${darkMode ? 'bg-gray-900 border-gray-800' : 'bg-gray-50 border-gray-200'} border focus:ring-2 focus:ring-blue-500 outline-none`}
                                autoFocus
                            />
                            <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-4 text-gray-500">
                                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                            </button>
                        </div>
                        {error && <p className="text-red-500 text-sm">{error}</p>}
                        <button disabled={isLoading} className="w-full bg-blue-600 text-white py-4 rounded-xl font-bold hover:bg-blue-700 transition flex justify-center">
                            {isLoading ? <Loader2 className="animate-spin" /> : 'Unlock Wallet'}
                        </button>
                    </form>
                    <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-800">
                        <button
                            onClick={() => {
                                if (window.confirm('Are you sure you want to reset your wallet? This will delete your local data. Make sure you have your seed phrase backed up!')) {
                                    resetWallet();
                                    setView('initial');
                                }
                            }}
                            className="text-sm text-red-500 hover:text-red-400 font-medium"
                        >
                            Reset / Forgot Password
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    if (view === 'mnemonic_input') {
        return (
            <div className={`min-h-screen ${darkMode ? 'bg-black text-white' : 'bg-gradient-to-br from-blue-50 to-indigo-50 text-gray-800'} flex items-center justify-center p-4`} dir="ltr">
                <NetworkBanner darkMode={darkMode} />
                <div className={`w-full max-w-md ${darkMode ? 'bg-gray-950' : 'bg-white'} rounded-3xl shadow-2xl p-8`}>
                    <button onClick={() => setView('initial')} className="mb-4 text-gray-500 hover:text-gray-700"><ChevronLeft /></button>
                    <h2 className="text-2xl font-bold mb-2">Import Wallet</h2>
                    <p className="text-sm text-gray-500 mb-4">Enter your 24 secret words separated by spaces.</p>
                    <textarea
                        value={importText}
                        onChange={(e) => setImportText(e.target.value)}
                        className={`w-full h-40 p-4 rounded-xl mb-4 ${darkMode ? 'bg-gray-900 text-white' : 'bg-gray-50 text-black'} border-none resize-none`}
                        placeholder="word1 word2 word3 ..."
                    />
                    {error && <p className="text-red-500 text-sm mb-4">{error}</p>}
                    <button onClick={handleMnemonicInput} className="w-full bg-blue-600 text-white py-4 rounded-xl font-bold hover:bg-blue-700 transition">
                        Continue
                    </button>
                </div>
            </div>
        );
    }

    if (view === 'password_setup') {
        return (
            <div className={`min-h-screen ${darkMode ? 'bg-black text-white' : 'bg-gradient-to-br from-blue-50 to-indigo-50 text-gray-800'} flex items-center justify-center p-4`} dir="ltr">
                <NetworkBanner darkMode={darkMode} />
                <div className={`w-full max-w-md ${darkMode ? 'bg-gray-950' : 'bg-white'} rounded-3xl shadow-2xl p-8`}>
                    <button onClick={() => setView(isImportFlow ? 'mnemonic_input' : 'initial')} className="mb-4 text-gray-500 hover:text-gray-700"><ChevronLeft /></button>
                    <h2 className="text-2xl font-bold mb-2 text-center">Set Password</h2>
                    <p className="text-sm text-gray-500 mb-6 text-center">This password will encrypt your wallet locally.</p>
                    <form onSubmit={handlePasswordSetup} className="space-y-4">
                        <div className="relative">
                            <input
                                type={showPassword ? 'text' : 'password'}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="New Password"
                                className={`w-full p-4 pr-12 rounded-xl ${darkMode ? 'bg-gray-900 border-gray-800' : 'bg-gray-50 border-gray-200'} border focus:ring-2 focus:ring-blue-500 outline-none`}
                            />
                            <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-4 text-gray-500">
                                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                            </button>
                        </div>
                        <input
                            type={showPassword ? 'text' : 'password'}
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            placeholder="Confirm Password"
                            className={`w-full p-4 rounded-xl ${darkMode ? 'bg-gray-900 border-gray-800' : 'bg-gray-50 border-gray-200'} border focus:ring-2 focus:ring-blue-500 outline-none`}
                        />
                        {error && <p className="text-red-500 text-sm">{error}</p>}
                        <button disabled={isLoading} className="w-full bg-blue-600 text-white py-4 rounded-xl font-bold hover:bg-blue-700 transition flex justify-center">
                            {isLoading ? <Loader2 className="animate-spin" /> : (isImportFlow ? 'Import Wallet' : 'Create Wallet')}
                        </button>
                    </form>
                </div>
            </div>
        );
    }

    if (view === 'mnemonic_show') {
        return (
            <div className={`min-h-screen ${darkMode ? 'bg-black text-white' : 'bg-gradient-to-br from-blue-50 to-indigo-50 text-gray-800'} flex items-center justify-center p-4`} dir="ltr">
                <NetworkBanner darkMode={darkMode} />
                <div className={`w-full max-w-md ${darkMode ? 'bg-gray-950' : 'bg-white'} rounded-3xl shadow-2xl p-6`}>
                    <h2 className="text-xl font-bold mb-2 text-center text-red-500">Secret Recovery Phrase</h2>
                    <p className="text-sm text-gray-500 mb-4 text-center">Write these words down. We cannot recover them for you.</p>

                    <div className="grid grid-cols-3 gap-2 mb-4 max-h-[40vh] overflow-y-auto no-scrollbar">
                        {mnemonicWords.map((word, i) => (
                            <div key={i} className={`text-xs p-2 rounded ${darkMode ? 'bg-gray-900' : 'bg-gray-100'} flex gap-1`}>
                                <span className="text-gray-500">{i + 1}.</span>
                                <span className="font-mono font-medium">{word}</span>
                            </div>
                        ))}
                    </div>

                    <button onClick={handleCopy} className={`w-full mb-3 flex items-center justify-center gap-2 py-3 rounded-xl ${darkMode ? 'bg-gray-900' : 'bg-gray-100'} font-medium`}>
                        {copied ? <Check size={18} /> : <Copy size={18} />}
                        {copied ? 'Copied' : 'Copy to Clipboard'}
                    </button>

                    <button onClick={() => setView('password_setup')} className="w-full bg-blue-600 text-white py-4 rounded-xl font-bold hover:bg-blue-700 transition">
                        I Saved It
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className={`min-h-screen ${darkMode ? 'bg-black text-white' : 'bg-gradient-to-br from-blue-50 to-indigo-50 text-gray-800'} flex items-center justify-center p-4`} dir="ltr">
            <NetworkBanner darkMode={darkMode} />
            <div className={`w-full max-w-md ${darkMode ? 'bg-gray-950' : 'bg-white'} rounded-3xl shadow-2xl p-8 text-center`}>
                <Logo />
                <h1 className="text-3xl font-bold mb-2">TON Wallet</h1>
                <p className={`text-sm mb-12 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                    Secure & Fast Crypto Wallet
                </p>

                <div className="space-y-4">
                    <button
                        onClick={startCreate}
                        className="w-full bg-blue-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-blue-700 transition flex items-center justify-center gap-2"
                    >
                        Create New Wallet
                        <ArrowRight size={20} />
                    </button>

                    <button
                        onClick={startImport}
                        className={`w-full ${darkMode ? 'bg-gray-800 hover:bg-gray-700' : 'bg-gray-100 hover:bg-gray-200'} py-4 rounded-xl font-bold text-lg transition flex items-center justify-center gap-2`}
                    >
                        <Import size={20} />
                        I have a wallet
                    </button>
                </div>

                <div className="mt-8 flex items-center justify-center gap-2 text-xs text-gray-500">
                    <Shield size={12} />
                    <span>Fully Encrypted & Secure</span>
                </div>
            </div>
        </div>
    );
}
