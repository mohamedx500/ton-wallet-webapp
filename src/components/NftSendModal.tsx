/**
 * NftSendModal — Slice 5: NFT transfer confirmation modal.
 *
 * Collects: recipient address + optional forward comment.
 * On confirm: builds NftTransferIntent → runs through the password-confirmed
 * execution boundary → shows result.
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Send, Package, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { cn } from '../lib/utils';
import type { NftItem } from '../nft/types';

interface NftSendModalProps {
    isOpen: boolean;
    item: NftItem | null;
    onClose: () => void;
    darkMode: boolean;
    language: string;
    ownerAddress: string;
    /** Inject the send handler from the parent (decouples execution from UI). */
    onSend?: (params: {
        item: NftItem;
        recipient: string;
        comment: string;
        password: string;
    }) => Promise<void>;
}

type Step = 'form' | 'password' | 'sending' | 'success' | 'error';

export default function NftSendModal({
    isOpen,
    item,
    onClose,
    darkMode,
    language,
    ownerAddress,
    onSend,
}: NftSendModalProps) {
    const [step, setStep] = useState<Step>('form');
    const [recipient, setRecipient] = useState('');
    const [comment, setComment] = useState('');
    const [password, setPassword] = useState('');
    const [errorMsg, setErrorMsg] = useState('');
    const isAr = language === 'ar';

    const reset = () => {
        setStep('form');
        setRecipient('');
        setComment('');
        setPassword('');
        setErrorMsg('');
    };

    const handleClose = () => {
        reset();
        onClose();
    };

    const handleFormSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!recipient.trim()) return;
        setStep('password');
    };

    const handlePasswordConfirm = async () => {
        if (!item || !onSend) return;
        setStep('sending');
        try {
            await onSend({ item, recipient: recipient.trim(), comment, password });
            setStep('success');
        } catch (err) {
            setErrorMsg(err instanceof Error ? err.message : 'Send failed');
            setStep('error');
        }
    };

    const overlayClass = cn(
        'fixed inset-0 z-50 flex items-end justify-center',
        darkMode ? 'bg-black/60 backdrop-blur-sm' : 'bg-black/30 backdrop-blur-sm',
    );

    const sheetClass = cn(
        'w-full max-w-md rounded-t-3xl p-6 ring-1',
        darkMode
            ? 'bg-[hsl(228,18%,8%)] ring-white/[0.08]'
            : 'bg-white ring-black/[0.06]',
    );

    if (!isOpen || !item) return null;

    const nftName = item.metadata.name ?? `NFT ${item.address.slice(0, 8)}…`;

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    className={overlayClass}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={handleClose}
                >
                    <motion.div
                        className={sheetClass}
                        initial={{ y: '100%' }}
                        animate={{ y: 0 }}
                        exit={{ y: '100%' }}
                        transition={{ type: 'spring', stiffness: 340, damping: 32 }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between mb-5">
                            <div className="flex items-center gap-3">
                                {item.metadata.image ? (
                                    <img src={item.metadata.image} alt={nftName} className="w-10 h-10 rounded-xl object-cover" />
                                ) : (
                                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center">
                                        <Package size={18} className="text-blue-400" />
                                    </div>
                                )}
                                <div>
                                    <p className={cn('text-sm font-bold', darkMode ? 'text-white' : 'text-gray-900')}>
                                        {isAr ? 'إرسال' : 'Send'} NFT
                                    </p>
                                    <p className="text-xs text-gray-400 truncate max-w-[160px]">{nftName}</p>
                                </div>
                            </div>
                            <button
                                onClick={handleClose}
                                className={cn('p-2 rounded-xl', darkMode ? 'hover:bg-white/10 text-gray-400' : 'hover:bg-black/5 text-gray-500')}
                            >
                                <X size={18} />
                            </button>
                        </div>

                        {/* Step: form */}
                        {step === 'form' && (
                            <form onSubmit={handleFormSubmit} className="flex flex-col gap-4">
                                <div>
                                    <label className={cn('block text-xs font-medium mb-1.5', darkMode ? 'text-gray-400' : 'text-gray-500')}>
                                        {isAr ? 'عنوان المستلم' : 'Recipient address'}
                                    </label>
                                    <input
                                        type="text"
                                        value={recipient}
                                        onChange={(e) => setRecipient(e.target.value)}
                                        placeholder="UQ… or name.ton"
                                        className={cn(
                                            'w-full px-4 py-3 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all',
                                            darkMode
                                                ? 'bg-white/[0.05] text-white border border-white/[0.08] placeholder:text-gray-600'
                                                : 'bg-gray-50 text-gray-900 border border-gray-200 placeholder:text-gray-400',
                                        )}
                                        required
                                    />
                                </div>
                                <div>
                                    <label className={cn('block text-xs font-medium mb-1.5', darkMode ? 'text-gray-400' : 'text-gray-500')}>
                                        {isAr ? 'تعليق (اختياري)' : 'Comment (optional)'}
                                    </label>
                                    <input
                                        type="text"
                                        value={comment}
                                        onChange={(e) => setComment(e.target.value)}
                                        placeholder={isAr ? 'أضف تعليقاً...' : 'Add a message…'}
                                        className={cn(
                                            'w-full px-4 py-3 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all',
                                            darkMode
                                                ? 'bg-white/[0.05] text-white border border-white/[0.08] placeholder:text-gray-600'
                                                : 'bg-gray-50 text-gray-900 border border-gray-200 placeholder:text-gray-400',
                                        )}
                                    />
                                </div>
                                <button
                                    type="submit"
                                    className="w-full py-3.5 rounded-xl bg-gradient-to-r from-blue-500 to-blue-600 text-white text-sm font-semibold flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
                                >
                                    <Send size={14} />
                                    {isAr ? 'متابعة' : 'Continue'}
                                </button>
                            </form>
                        )}

                        {/* Step: password */}
                        {step === 'password' && (
                            <div className="flex flex-col gap-4">
                                <p className={cn('text-sm', darkMode ? 'text-gray-300' : 'text-gray-600')}>
                                    {isAr ? 'أدخل كلمة المرور لتأكيد الإرسال' : 'Enter your password to confirm the transfer'}
                                </p>
                                <input
                                    type="password"
                                    autoFocus
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder={isAr ? 'كلمة المرور' : 'Password'}
                                    className={cn(
                                        'w-full px-4 py-3 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all',
                                        darkMode
                                            ? 'bg-white/[0.05] text-white border border-white/[0.08]'
                                            : 'bg-gray-50 text-gray-900 border border-gray-200',
                                    )}
                                />
                                <div className="flex gap-3">
                                    <button
                                        onClick={() => setStep('form')}
                                        className={cn('flex-1 py-3 rounded-xl text-sm font-medium', darkMode ? 'bg-white/[0.06] text-gray-300' : 'bg-gray-100 text-gray-700')}
                                    >
                                        {isAr ? 'رجوع' : 'Back'}
                                    </button>
                                    <button
                                        onClick={() => void handlePasswordConfirm()}
                                        disabled={!password}
                                        className="flex-1 py-3 rounded-xl bg-gradient-to-r from-blue-500 to-blue-600 text-white text-sm font-semibold disabled:opacity-40"
                                    >
                                        {isAr ? 'تأكيد الإرسال' : 'Confirm Send'}
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Step: sending */}
                        {step === 'sending' && (
                            <div className="flex flex-col items-center gap-4 py-4">
                                <Loader2 size={36} className="text-blue-400 animate-spin" />
                                <p className={cn('text-sm', darkMode ? 'text-gray-300' : 'text-gray-600')}>
                                    {isAr ? 'جاري الإرسال...' : 'Sending…'}
                                </p>
                            </div>
                        )}

                        {/* Step: success */}
                        {step === 'success' && (
                            <div className="flex flex-col items-center gap-4 py-4">
                                <CheckCircle2 size={36} className="text-emerald-400" />
                                <p className={cn('text-sm font-semibold', darkMode ? 'text-white' : 'text-gray-900')}>
                                    {isAr ? 'تم الإرسال بنجاح' : 'NFT sent successfully!'}
                                </p>
                                <button onClick={handleClose} className="w-full py-3 rounded-xl bg-emerald-500/10 text-emerald-400 text-sm font-medium">
                                    {isAr ? 'إغلاق' : 'Close'}
                                </button>
                            </div>
                        )}

                        {/* Step: error */}
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
