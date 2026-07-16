import React, { createContext, useContext, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, X, AlertTriangle, Info } from 'lucide-react';
import { cn } from '../lib/utils';

type ToastVariant = 'success' | 'error' | 'warning' | 'info';

interface ToastItem {
    id: number;
    variant: ToastVariant;
    message: string;
}

interface ToastContextValue {
    success: (message: string) => void;
    error: (message: string) => void;
    warning: (message: string) => void;
    info: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
    const ctx = useContext(ToastContext);
    if (!ctx) throw new Error('useToast must be inside ToastProvider');
    return ctx;
}

let nextId = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
    const [toasts, setToasts] = useState<ToastItem[]>([]);

    const add = useCallback((variant: ToastVariant, message: string) => {
        const id = ++nextId;
        setToasts(prev => [...prev, { id, variant, message }]);
        setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
    }, []);

    const value: ToastContextValue = {
        success: (m) => add('success', m),
        error: (m) => add('error', m),
        warning: (m) => add('warning', m),
        info: (m) => add('info', m),
    };

    return (
        <ToastContext.Provider value={value}>
            {children}
            <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-2 pointer-events-none w-full max-w-sm px-4">
                <AnimatePresence>
                    {toasts.map(toast => (
                        <motion.div
                            key={toast.id}
                            initial={{ opacity: 0, y: -20, scale: 0.95 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -20, scale: 0.95 }}
                            transition={{ type: 'spring', damping: 25, stiffness: 350 }}
                            className="pointer-events-auto"
                        >
                            <ToastCard toast={toast} onDismiss={() => setToasts(prev => prev.filter(t => t.id !== toast.id))} />
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>
        </ToastContext.Provider>
    );
}

const icons: Record<ToastVariant, React.ReactNode> = {
    success: <Check size={14} strokeWidth={3} />,
    error: <X size={14} strokeWidth={3} />,
    warning: <AlertTriangle size={14} />,
    info: <Info size={14} />,
};

const bgColors: Record<ToastVariant, string> = {
    success: 'bg-emerald-500',
    error: 'bg-red-500',
    warning: 'bg-amber-500',
    info: 'bg-blue-500',
};

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
    return (
        <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-gray-900/95 backdrop-blur-xl text-white shadow-xl shadow-black/20 ring-1 ring-white/10">
            <div className={cn("w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0", bgColors[toast.variant])}>
                {icons[toast.variant]}
            </div>
            <p className="text-sm font-medium flex-1 leading-snug">{toast.message}</p>
            <button onClick={onDismiss} className="text-white/40 hover:text-white/80 transition p-0.5 flex-shrink-0">
                <X size={14} />
            </button>
        </div>
    );
}
