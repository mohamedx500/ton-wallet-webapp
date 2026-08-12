/**
 * TonConnectConnectModal — connection approval UI for incoming TON Connect links.
 *
 * Shown after a tc:// URI is validated. Fetches the DApp manifest through the
 * wallet service before the user approves the session.
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Globe, Loader2, AlertCircle, Lock } from 'lucide-react';
import { cn } from '../lib/utils';
import type { TonConnectLink, TonConnectManifest } from '../tonconnect/wallet/types';

interface TonConnectConnectModalProps {
    isOpen: boolean;
    link: TonConnectLink | null;
    manifest: TonConnectManifest | null;
    walletLabel: string;
    loading: boolean;
    connecting: boolean;
    error: string | null;
    darkMode: boolean;
    language: string;
    onClose: () => void;
    onConnect: (password: string) => void | Promise<void>;
    onReject: () => void;
}

function requestedItems(link: TonConnectLink, language: string): string[] {
    const isAr = language === 'ar';
    return link.request.items.map((item) => {
        if (item.name === 'ton_addr') {
            return isAr ? 'عنوان المحفظة' : 'Wallet address';
        }
        if (item.name === 'ton_proof') {
            return isAr ? 'إثبات TON' : 'TON Proof';
        }
        return isAr ? 'عنصر غير مدعوم' : 'Unsupported item';
    });
}

export default function TonConnectConnectModal({
    isOpen,
    link,
    manifest,
    walletLabel,
    loading,
    connecting,
    error,
    darkMode,
    language,
    onClose,
    onConnect,
    onReject,
}: TonConnectConnectModalProps) {
    const isAr = language === 'ar';
    const [password, setPassword] = useState('');

    useEffect(() => {
        if (!isOpen) setPassword('');
    }, [isOpen]);

    const sheetClass = cn(
        'w-full max-w-md rounded-t-3xl p-6 ring-1',
        darkMode ? 'bg-[hsl(228,18%,8%)] ring-white/[0.08]' : 'bg-white ring-black/[0.06]',
    );

    return (
        <AnimatePresence>
            {isOpen && link && (
                <motion.div
                    className="fixed inset-0 z-[110] flex items-end justify-center bg-black/60 backdrop-blur-sm"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                >
                    <motion.div
                        className={sheetClass}
                        initial={{ y: '100%' }}
                        animate={{ y: 0 }}
                        exit={{ y: '100%' }}
                        transition={{ type: 'spring', stiffness: 340, damping: 32 }}
                    >
                        <div className="flex items-center justify-between mb-5">
                            <div className="flex items-center gap-3">
                                {manifest?.iconUrl ? (
                                    <img src={manifest.iconUrl} alt={manifest.name} className="w-10 h-10 rounded-xl object-cover" />
                                ) : (
                                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500/20 to-cyan-500/20 flex items-center justify-center">
                                        <Globe size={18} className="text-blue-400" />
                                    </div>
                                )}
                                <div>
                                    <p className={cn('text-sm font-bold', darkMode ? 'text-white' : 'text-gray-900')}>
                                        {manifest?.name ?? (isAr ? 'تطبيق' : 'Application')}
                                    </p>
                                    <p className="text-xs text-gray-400 truncate max-w-[180px]">
                                        {manifest?.origin ?? ''}
                                    </p>
                                </div>
                            </div>
                            <button onClick={onClose} className="p-2 rounded-xl text-gray-400 hover:bg-white/10 transition-colors">
                                <X size={18} />
                            </button>
                        </div>

                        <div className="flex flex-col gap-4">
                            <div>
                                <p className={cn('text-base font-semibold', darkMode ? 'text-white' : 'text-gray-900')}>
                                    {isAr ? 'طلب اتصال' : 'Connection request'}
                                </p>
                                <p className={cn('text-xs mt-1', darkMode ? 'text-gray-400' : 'text-gray-500')}>
                                    {isAr ? 'المحفظة:' : 'Wallet:'}{' '}
                                    <span className={cn('font-medium', darkMode ? 'text-gray-300' : 'text-gray-700')}>
                                        {walletLabel}
                                    </span>
                                </p>
                            </div>

                            <div className={cn('p-3 rounded-xl', darkMode ? 'bg-white/[0.04]' : 'bg-gray-50')}>
                                <p className={cn('text-xs font-semibold mb-2', darkMode ? 'text-gray-300' : 'text-gray-700')}>
                                    {isAr ? 'المطلوب:' : 'Requested:'}
                                </p>
                                <ul className="space-y-1">
                                    {requestedItems(link, language).map((item) => (
                                        <li key={item} className="text-xs text-gray-400">
                                            • {item}
                                        </li>
                                    ))}
                                </ul>
                            </div>

                            {loading && (
                                <div className="flex items-center gap-2 text-sm text-gray-400">
                                    <Loader2 size={16} className="animate-spin" />
                                    {isAr ? 'جاري التحقق من التطبيق...' : 'Verifying application…'}
                                </div>
                            )}

                            {error && (
                                <div className="flex items-start gap-2 text-sm text-red-400">
                                    <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                                    <span>{error}</span>
                                </div>
                            )}

                            <div className={cn('relative', darkMode ? 'text-white' : 'text-gray-900')}>
                                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                <input
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder={isAr ? 'كلمة مرور المحفظة' : 'Wallet password'}
                                    disabled={loading || connecting}
                                    className={cn(
                                        'w-full pl-10 pr-3 py-3 rounded-xl text-sm outline-none ring-1 transition-colors',
                                        darkMode
                                            ? 'bg-white/[0.04] ring-white/[0.08] placeholder:text-gray-500'
                                            : 'bg-gray-50 ring-black/[0.06] placeholder:text-gray-400',
                                    )}
                                />
                            </div>

                            <div className="flex gap-3 pt-1">
                                <button
                                    onClick={onReject}
                                    disabled={loading || connecting}
                                    className={cn(
                                        'flex-1 py-3.5 rounded-xl text-sm font-semibold disabled:opacity-40',
                                        darkMode ? 'bg-white/[0.06] text-gray-300' : 'bg-gray-100 text-gray-700',
                                    )}
                                >
                                    {isAr ? 'رفض' : 'Reject'}
                                </button>
                                <button
                                    onClick={() => void onConnect(password)}
                                    disabled={loading || connecting || !!error || !manifest || !password.trim()}
                                    className="flex-1 py-3.5 rounded-xl bg-gradient-to-r from-blue-500 to-blue-600 text-white text-sm font-semibold disabled:opacity-40 flex items-center justify-center gap-2"
                                >
                                    {connecting && <Loader2 size={16} className="animate-spin" />}
                                    {connecting ? (isAr ? 'جاري الاتصال…' : 'Connecting…') : (isAr ? 'اتصال' : 'Connect')}
                                </button>
                            </div>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
