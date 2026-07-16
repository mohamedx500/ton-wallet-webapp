import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../lib/utils';

interface ModalShellProps {
    isOpen: boolean;
    onClose: () => void;
    children: React.ReactNode;
    position?: 'center' | 'bottom';
    maxWidth?: 'sm' | 'md';
}

export default function ModalShell({ isOpen, onClose, children, position = 'center', maxWidth = 'sm' }: ModalShellProps) {
    return (
        <AnimatePresence>
            {isOpen && (
                <div className={cn(
                    "fixed inset-0 z-50 flex justify-center",
                    position === 'bottom' ? "items-end" : "items-center p-4"
                )}>
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
                        onClick={onClose}
                    />
                    <motion.div
                        initial={position === 'bottom' ? { y: '100%' } : { opacity: 0, scale: 0.96, y: 8 }}
                        animate={position === 'bottom' ? { y: 0 } : { opacity: 1, scale: 1, y: 0 }}
                        exit={position === 'bottom' ? { y: '100%' } : { opacity: 0, scale: 0.96, y: 8 }}
                        transition={{ type: 'spring', damping: 30, stiffness: 350 }}
                        className={cn("relative w-full", maxWidth === 'md' ? "max-w-md" : "max-w-sm")}
                        onClick={e => e.stopPropagation()}
                    >
                        {children}
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
}
