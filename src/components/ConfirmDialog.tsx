import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle } from 'lucide-react';
import { cn } from '../lib/utils';

interface ConfirmDialogProps {
    isOpen: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: 'danger' | 'default';
    onConfirm: () => void;
    onCancel: () => void;
    darkMode?: boolean;
}

export default function ConfirmDialog({
    isOpen, title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel',
    variant = 'default', onConfirm, onCancel, darkMode = false
}: ConfirmDialogProps) {
    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4">
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                        onClick={onCancel}
                    />
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                        className={cn(
                            "relative w-full max-w-xs rounded-3xl p-6",
                            darkMode ? "bg-[hsl(224,20%,8%)] ring-1 ring-white/5" : "bg-white ring-1 ring-black/5 shadow-xl"
                        )}
                    >
                        {variant === 'danger' && (
                            <div className="w-12 h-12 rounded-2xl bg-red-500/10 flex items-center justify-center mx-auto mb-4">
                                <AlertTriangle size={22} className="text-red-500" />
                            </div>
                        )}
                        <h3 className={cn("text-lg font-bold text-center mb-1", darkMode ? "text-white" : "text-gray-900")}>{title}</h3>
                        <p className={cn("text-sm text-center mb-6 leading-relaxed", darkMode ? "text-gray-400" : "text-gray-500")}>{message}</p>
                        <div className="flex gap-3">
                            <button onClick={onCancel} className={cn("flex-1 py-3 rounded-2xl text-sm font-semibold transition-all active:scale-[0.97]", darkMode ? "bg-white/5 text-gray-300 hover:bg-white/10" : "bg-gray-100 text-gray-700 hover:bg-gray-200")}>{cancelLabel}</button>
                            <button onClick={onConfirm} className={cn("flex-1 py-3 rounded-2xl text-sm font-semibold text-white transition-all active:scale-[0.97]", variant === 'danger' ? "bg-red-500 hover:bg-red-600" : "bg-blue-500 hover:bg-blue-600")}>{confirmLabel}</button>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
}
