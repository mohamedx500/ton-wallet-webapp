/**
 * TonConnectRequestModal — Slice 7: TON Connect request confirmation UI.
 *
 * Displayed when a DApp sends a `sendTransaction` or `signData` request
 * through the TON Connect bridge. Shows:
 *   - DApp name, icon, and origin.
 *   - Transaction messages (amount + destination).
 *   - Password input for signing.
 *   - Approve / Reject buttons.
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Shield, Globe, Send, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { cn } from '../lib/utils';
import type { TonConnectPendingRequest } from '../tonconnect/wallet/TonConnectWalletService';

interface TonConnectRequestModalProps {
    isOpen: boolean;
    pending: TonConnectPendingRequest | null;
    onClose: () => void;
    darkMode: boolean;
    language: string;
    /** Called with the user's password to sign the transaction. */
    onApprove: (pending: TonConnectPendingRequest, password: string) => Promise<string | undefined>;
}

type Step = 'review' | 'password' | 'signing' | 'success' | 'error';

function parseMessages(params: readonly string[]): Array<{ to: string; amount: string }> {
    try {
        const first = params[0];
        if (!first) return [];
        const obj = JSON.parse(first) as Record<string, unknown>;
        const msgs = obj['messages'] as Array<Record<string, unknown>> | undefined;
        if (!Array.isArray(msgs)) return [];
        return msgs.map((m) => ({
            to: String(m['address'] ?? ''),
            amount: String(m['amount'] ?? '0'),
        }));
    } catch {
        return [];
    }
}

export default function TonConnectRequestModal({
    isOpen,
    pending,
    onClose,
    darkMode,
    language,
    onApprove,
}: TonConnectRequestModalProps) {
    const [step, setStep] = useState<Step>('review');
    const [password, setPassword] = useState('');
    const [errorMsg, setErrorMsg] = useState('');
    const isAr = language === 'ar';

    const reset = () => {
        setStep('review');
        setPassword('');
        setErrorMsg('');
    };

    const handleClose = () => {
        reset();
        onClose();
    };

    const handleReject = async () => {
        if (pending) {
            await pending.reject(300, 'User rejected');
        }
        handleClose();
    };

    const handleApprove = async () => {
        if (!pending) return;
        setStep('signing');
        try {
            const txHash = await onApprove(pending, password);
            await pending.approve(txHash);
            setStep('success');
        } catch (err) {
            setErrorMsg(err instanceof Error ? err.message : 'Failed to sign');
            setStep('error');
        }
    };

    const messages = pending ? parseMessages(pending.request.params) : [];
    const manifest = pending?.manifest;

    const sheetClass = cn(
        'w-full max-w-md rounded-t-3xl p-6 ring-1',
        darkMode ? 'bg-[hsl(228,18%,8%)] ring-white/[0.08]' : 'bg-white ring-black/[0.06]',
    );

    return (
        <AnimatePresence>
            {isOpen && pending && (
                <motion.div
                    className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 backdrop-blur-sm"
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
                        {/* Header */}
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
                                        {manifest?.name ?? 'DApp'}
                                    </p>
                                    <p className="text-xs text-gray-400 truncate max-w-[180px]">{manifest?.origin ?? ''}</p>
                                </div>
                            </div>
                            <button onClick={handleClose} className="p-2 rounded-xl text-gray-400 hover:bg-white/10 transition-colors">
                                <X size={18} />
                            </button>
                        </div>

                        {/* Step: review */}
                        {step === 'review' && (
                            <div className="flex flex-col gap-4">
                                <div className={cn('flex items-center gap-2 p-3 rounded-xl', darkMode ? 'bg-blue-500/10' : 'bg-blue-50')}>
                                    <Shield size={16} className="text-blue-400 flex-shrink-0" />
                                    <p className="text-xs text-blue-400">
                                        {isAr ? 'طلب معاملة عبر TON Connect' : 'Transaction request via TON Connect'}
                                    </p>
                                </div>

                                {messages.length > 0 && (
                                    <div className="flex flex-col gap-2">
                                        {messages.map((msg, i) => (
                                            <div key={i} className={cn('p-3 rounded-xl', darkMode ? 'bg-white/[0.04]' : 'bg-gray-50')}>
                                                <div className="flex items-center justify-between">
                                                    <span className="text-xs text-gray-400">{isAr ? 'الوجهة' : 'Destination'}</span>
                                                    <span className={cn('text-xs font-mono', darkMode ? 'text-gray-300' : 'text-gray-700')}>
                                                        {msg.to.slice(0, 10)}…
                                                    </span>
                                                </div>
                                                <div className="flex items-center justify-between mt-1">
                                                    <span className="text-xs text-gray-400">{isAr ? 'المبلغ' : 'Amount'}</span>
                                                    <span className={cn('text-sm font-bold', darkMode ? 'text-white' : 'text-gray-900')}>
                                                        {(Number(msg.amount) / 1e9).toFixed(4)} TON
                                                    </span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                <div className="flex gap-3">
                                    <button
                                        onClick={() => void handleReject()}
                                        className={cn('flex-1 py-3.5 rounded-xl text-sm font-semibold', darkMode ? 'bg-white/[0.06] text-gray-300' : 'bg-gray-100 text-gray-700')}
                                    >
                                        {isAr ? 'رفض' : 'Reject'}
                                    </button>
                                    <button
                                        onClick={() => setStep('password')}
                                        className="flex-1 py-3.5 rounded-xl bg-gradient-to-r from-blue-500 to-blue-600 text-white text-sm font-semibold flex items-center justify-center gap-2"
                                    >
                                        <Send size={14} />
                                        {isAr ? 'موافقة' : 'Approve'}
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Step: password */}
                        {step === 'password' && (
                            <div className="flex flex-col gap-4">
                                <p className={cn('text-sm', darkMode ? 'text-gray-300' : 'text-gray-600')}>
                                    {isAr ? 'أدخل كلمة المرور لتوقيع المعاملة' : 'Enter your password to sign the transaction'}
                                </p>
                                <input
                                    type="password"
                                    autoFocus
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter' && password) void handleApprove(); }}
                                    placeholder={isAr ? 'كلمة المرور' : 'Password'}
                                    className={cn(
                                        'w-full px-4 py-3 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50',
                                        darkMode ? 'bg-white/[0.05] text-white border border-white/[0.08]' : 'bg-gray-50 text-gray-900 border border-gray-200',
                                    )}
                                />
                                <div className="flex gap-3">
                                    <button onClick={() => setStep('review')} className={cn('flex-1 py-3 rounded-xl text-sm font-medium', darkMode ? 'bg-white/[0.06] text-gray-300' : 'bg-gray-100 text-gray-700')}>
                                        {isAr ? 'رجوع' : 'Back'}
                                    </button>
                                    <button
                                        onClick={() => void handleApprove()}
                                        disabled={!password}
                                        className="flex-1 py-3 rounded-xl bg-gradient-to-r from-blue-500 to-blue-600 text-white text-sm font-semibold disabled:opacity-40"
                                    >
                                        {isAr ? 'توقيع وإرسال' : 'Sign & Send'}
                                    </button>
                                </div>
                            </div>
                        )}

                        {step === 'signing' && (
                            <div className="flex flex-col items-center gap-4 py-4">
                                <Loader2 size={36} className="text-blue-400 animate-spin" />
                                <p className={cn('text-sm', darkMode ? 'text-gray-300' : 'text-gray-600')}>
                                    {isAr ? 'جاري التوقيع والإرسال...' : 'Signing and sending…'}
                                </p>
                            </div>
                        )}

                        {step === 'success' && (
                            <div className="flex flex-col items-center gap-4 py-4">
                                <CheckCircle2 size={36} className="text-emerald-400" />
                                <p className={cn('text-sm font-semibold', darkMode ? 'text-white' : 'text-gray-900')}>
                                    {isAr ? 'تم الإرسال بنجاح' : 'Transaction sent successfully!'}
                                </p>
                                <button onClick={handleClose} className="w-full py-3 rounded-xl bg-emerald-500/10 text-emerald-400 text-sm font-medium">
                                    {isAr ? 'إغلاق' : 'Close'}
                                </button>
                            </div>
                        )}

                        {step === 'error' && (
                            <div className="flex flex-col items-center gap-4 py-4">
                                <AlertCircle size={36} className="text-red-400" />
                                <p className="text-sm text-red-400 text-center">{errorMsg}</p>
                                <button onClick={reset} className="w-full py-3 rounded-xl bg-red-500/10 text-red-400 text-sm font-medium">
                                    {isAr ? 'حاول مجدداً' : 'Try again'}
                                </button>
                            </div>
                        )}
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
