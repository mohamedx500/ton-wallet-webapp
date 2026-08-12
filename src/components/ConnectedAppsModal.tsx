/**
 * ConnectedAppsModal — list and revoke active TON Connect sessions.
 */

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Link2, Unplug, Loader2, Globe } from 'lucide-react';
import { Address } from '@ton/core';
import { cn } from '../lib/utils';
import type { TonConnectSessionDescriptor } from '../tonconnect/wallet/types';

interface ConnectedAppsModalProps {
    isOpen: boolean;
    sessions: readonly TonConnectSessionDescriptor[];
    loading: boolean;
    darkMode: boolean;
    language: string;
    onClose: () => void;
    onDisconnect: (walletClientId: string) => Promise<void>;
}

function shortAddress(value: string): string {
    try {
        const friendly = Address.parse(value).toString({ bounceable: false, urlSafe: true });
        return `${friendly.slice(0, 4)}…${friendly.slice(-4)}`;
    } catch {
        return value.length > 12 ? `${value.slice(0, 4)}…${value.slice(-4)}` : value;
    }
}

function hostLabel(origin: string): string {
    try {
        return new URL(origin).hostname;
    } catch {
        return origin;
    }
}

export default function ConnectedAppsModal({
    isOpen,
    sessions,
    loading,
    darkMode,
    language,
    onClose,
    onDisconnect,
}: ConnectedAppsModalProps) {
    const isAr = language === 'ar';
    const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!isOpen) {
            setDisconnectingId(null);
            setError(null);
        }
    }, [isOpen]);

    const handleDisconnect = async (walletClientId: string) => {
        setDisconnectingId(walletClientId);
        setError(null);
        try {
            await onDisconnect(walletClientId);
        } catch (err) {
            setError(err instanceof Error ? err.message : (isAr ? 'تعذر قطع الاتصال.' : 'Could not disconnect.'));
        } finally {
            setDisconnectingId(null);
        }
    };

    const sheetClass = cn(
        'w-full max-w-md max-h-[85vh] overflow-y-auto rounded-t-3xl p-5 ring-1',
        darkMode ? 'bg-[hsl(228,18%,8%)] ring-white/[0.08]' : 'bg-white ring-black/[0.06]',
    );

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    className="fixed inset-0 z-[110] flex items-end justify-center bg-black/60 backdrop-blur-sm"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={onClose}
                >
                    <motion.div
                        className={sheetClass}
                        initial={{ y: '100%' }}
                        animate={{ y: 0 }}
                        exit={{ y: '100%' }}
                        transition={{ type: 'spring', stiffness: 340, damping: 32 }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <p className={cn('text-base font-semibold', darkMode ? 'text-white' : 'text-gray-900')}>
                                    {isAr ? 'التطبيقات المتصلة' : 'Connected Apps'}
                                </p>
                                <p className={cn('text-xs mt-0.5', darkMode ? 'text-gray-500' : 'text-gray-400')}>
                                    {isAr ? 'جلسات TON Connect النشطة' : 'Active TON Connect sessions'}
                                </p>
                            </div>
                            <button onClick={onClose} className="p-2 rounded-xl text-gray-400 hover:bg-white/10">
                                <X size={18} />
                            </button>
                        </div>

                        {error && (
                            <div className="mb-3 text-sm text-red-400">{error}</div>
                        )}

                        {loading && (
                            <div className="flex items-center justify-center gap-2 py-10 text-gray-400 text-sm">
                                <Loader2 size={16} className="animate-spin" />
                                {isAr ? 'جاري التحميل…' : 'Loading…'}
                            </div>
                        )}

                        {!loading && sessions.length === 0 && (
                            <div className="flex flex-col items-center justify-center py-12 gap-3">
                                <div className={cn(
                                    'w-14 h-14 rounded-2xl flex items-center justify-center',
                                    darkMode ? 'bg-white/[0.04]' : 'bg-gray-50',
                                )}>
                                    <Link2 size={22} className="text-blue-400" />
                                </div>
                                <p className={cn('text-sm', darkMode ? 'text-gray-400' : 'text-gray-500')}>
                                    {isAr ? 'لا توجد تطبيقات متصلة' : 'No connected apps'}
                                </p>
                            </div>
                        )}

                        {!loading && sessions.length > 0 && (
                            <div className="flex flex-col gap-2.5">
                                {sessions.map((session) => {
                                    const name = session.appName ?? hostLabel(session.manifestOrigin);
                                    const busy = disconnectingId === session.walletClientId;
                                    return (
                                        <div
                                            key={session.walletClientId}
                                            className={cn(
                                                'flex items-center gap-3 p-3 rounded-2xl ring-1',
                                                darkMode ? 'bg-white/[0.04] ring-white/[0.06]' : 'bg-gray-50 ring-black/[0.04]',
                                            )}
                                        >
                                            {session.appIconUrl ? (
                                                <img
                                                    src={session.appIconUrl}
                                                    alt={name}
                                                    className="w-11 h-11 rounded-xl object-cover flex-shrink-0"
                                                />
                                            ) : (
                                                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-500/20 to-cyan-500/20 flex items-center justify-center flex-shrink-0">
                                                    <Globe size={18} className="text-blue-400" />
                                                </div>
                                            )}
                                            <div className="flex-1 min-w-0">
                                                <p className={cn('text-sm font-semibold truncate', darkMode ? 'text-white' : 'text-gray-900')}>
                                                    {name}
                                                </p>
                                                <p className="text-[11px] text-gray-400 truncate">
                                                    {hostLabel(session.manifestOrigin)}
                                                </p>
                                                <p className={cn('text-[11px] mt-0.5 truncate', darkMode ? 'text-gray-500' : 'text-gray-400')}>
                                                    {isAr ? 'المحفظة:' : 'Wallet:'} {shortAddress(session.accountAddress)}
                                                </p>
                                            </div>
                                            <button
                                                onClick={() => void handleDisconnect(session.walletClientId)}
                                                disabled={busy || disconnectingId !== null}
                                                className={cn(
                                                    'flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold disabled:opacity-40',
                                                    darkMode
                                                        ? 'bg-red-500/15 text-red-400 hover:bg-red-500/25'
                                                        : 'bg-red-50 text-red-500 hover:bg-red-100',
                                                )}
                                            >
                                                {busy ? <Loader2 size={12} className="animate-spin" /> : <Unplug size={12} />}
                                                {isAr ? 'قطع' : 'Disconnect'}
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
