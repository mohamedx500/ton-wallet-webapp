/**
 * MultiSendModal Component
 *
 * The main wrapper that ties all Multi-Send UI components together.
 * Full-screen modal with header (wallet pills, recipient count),
 * mode selector, transfer row list, unification panel, footer, and
 * batch progress overlay.
 *
 * Responsive: Mobile-first layout with proper scaling at all breakpoints.
 */

import React, { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Users, AlertTriangle } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useMultiSend } from '../../context/MultiSendContext';
import ModeSelectorBar from './ModeSelectorBar';
import TransferRowList from './TransferRowList';
import UnificationPanel from './UnificationPanel';
import MultiSendFooter from './MultiSendFooter';
import BatchProgressOverlay from './BatchProgressOverlay';
import { useExecuteMultiSend } from '../../hooks/useExecuteMultiSend';
import { PasswordPromptModal } from '../WalletModals';
import type { WalletVersion } from '../../types';

interface MultiSendModalProps {
    darkMode?: boolean;
    language?: string;
}

const MultiSendModal: React.FC<MultiSendModalProps> = ({ darkMode = false, language = 'en' }) => {
    const {
        state,
        closeModal,
    } = useMultiSend();

    const { isOpen, rows, walletType, execution } = state;
    const { executeSend } = useExecuteMultiSend();

    const [showProgress, setShowProgress] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [txError, setTxError] = useState('');

    const isUnsupportedWallet = walletType === 'v4r2' || walletType === 'v3r2' || walletType === 'v3r1';

    const handleSend = useCallback(() => {
        setTxError('');
        setShowPassword(true);
    }, []);

    const handlePasswordConfirm = useCallback(async (password: string) => {
        setShowPassword(false);
        setShowProgress(true);
        try {
            await executeSend(password);
        } catch (error: any) {
            setShowProgress(false);
            setTxError(error.message || 'Multi-Send failed');
            // Re-open password modal with error
            setShowPassword(true);
        }
    }, [executeSend]);

    const handleCloseProgress = useCallback(() => {
        setShowProgress(false);
    }, []);

    const handleClose = useCallback(() => {
        if (execution.phase === 'sending') return; // Prevent close during send
        closeModal();
    }, [closeModal, execution.phase]);

    if (!isOpen) return null;

    const isSending = execution.phase !== 'idle' && execution.phase !== 'complete' && execution.phase !== 'error';
    const showProgressOverlay = showProgress && (isSending || execution.phase === 'complete' || execution.phase === 'error');

    // Constraint: Absolute positioning within the relative parent (App.tsx container)
    // Ensures the backdrop and modal stay inside the max-w-md boundary.
    return (
        <div className="absolute inset-0 z-[100] flex items-end sm:items-center justify-center overflow-hidden">
            {/* Backdrop - now absolute to parent container */}
            <div
                className="absolute inset-0 bg-black/60 dark:bg-black/80 backdrop-blur-sm transition-opacity"
                onClick={handleClose}
            />

            {/* Modal Container */}
            <div className="relative w-full z-10 flex flex-col justify-end h-full pointer-events-none">
                <div className={cn(
                    'w-full flex-shrink-0 pointer-events-auto',
                    'rounded-t-[32px]', // Match main app's premium curved feel
                    'bg-white dark:bg-[#0A0C10]',
                    'flex flex-col h-[90%] overflow-hidden',
                    'shadow-[0_-8px_40px_rgba(0,0,0,0.15)] dark:shadow-[0_-8px_40px_rgba(0,0,0,0.5)]',
                    'animate-slide-up border-t border-white/[0.05]'
                )}>
                    {/* Visual drag handle */}
                    <div className="w-10 h-1 bg-gray-200 dark:bg-white/10 rounded-full mx-auto mt-3 shrink-0" />

                    {/* ── Header ──────────────────────────────────────── */}
                    <div className="flex-shrink-0 relative">
                        {/* Title row */}
                        <div className="flex items-center justify-between px-6 pt-4 pb-4">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-blue-500/10 rounded-xl">
                                    <Users className="w-6 h-6 text-blue-500" />
                                </div>
                                <div>
                                    <h2 className="text-lg font-bold text-gray-900 dark:text-white leading-tight">Multi-Send</h2>
                                    <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">Batch transfers</p>
                                </div>
                            </div>

                            <div className="flex items-center gap-3">
                                <span className="text-[11px] font-bold py-1 px-2.5 bg-gray-100 dark:bg-white/5 rounded-lg text-gray-500">
                                    {rows.length} {rows.length === 1 ? 'RECIPIENT' : 'RECIPIENTS'}
                                </span>
                                <button
                                    type="button"
                                    onClick={handleClose}
                                    disabled={isSending}
                                    className={cn(
                                        'w-9 h-9 rounded-full flex items-center justify-center transition-all',
                                        'bg-gray-100 text-gray-500 hover:text-gray-900 hover:bg-gray-200',
                                        'dark:bg-white/5 dark:text-gray-400 dark:hover:text-white dark:hover:bg-white/10',
                                        'disabled:opacity-30'
                                    )}
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                        </div>

                        {/* Mode selector */}
                        {!isUnsupportedWallet && (
                            <div className="px-6 pb-4">
                                <ModeSelectorBar />
                            </div>
                        )}
                    </div>

                    {/* ── Scrollable Content ──────────────────────────── */}
                    <div className="flex-1 overflow-y-auto no-scrollbar pb-32">
                        {isUnsupportedWallet ? (
                            <div className="flex flex-col items-center justify-center p-12 text-center gap-4">
                                <div className="w-16 h-16 rounded-full bg-red-50 dark:bg-red-500/10 flex items-center justify-center">
                                    <AlertTriangle className="w-8 h-8 text-red-500" />
                                </div>
                                <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                                    Multi-Send Not Supported
                                </h3>
                                <p className="text-sm text-gray-500 dark:text-gray-400 max-w-[280px] mx-auto">
                                    Your current wallet version <b>({walletType})</b> requires an upgrade to support batch transfers.
                                </p>
                            </div>
                        ) : (
                            <div className="px-5 space-y-6 py-4">
                                <TransferRowList />
                                <UnificationPanel />
                            </div>
                        )}
                    </div>

                    {/* ── Footer ──────────────────────────────────────── */}
                    {!isUnsupportedWallet && <MultiSendFooter onSend={handleSend} />}

                    {/* ── Batch Progress Overlay ──────────────────────── */}
                    {showProgressOverlay && (
                        <BatchProgressOverlay onClose={handleCloseProgress} />
                    )}

                    {/* ── Password Prompt ─────────────────────────────── */}
                    <PasswordPromptModal
                        isOpen={showPassword}
                        onClose={() => setShowPassword(false)}
                        onConfirm={handlePasswordConfirm}
                        darkMode={darkMode}
                        language={language}
                        error={txError}
                    />
                </div>
            </div>
        </div>
    );
};

export default MultiSendModal;
