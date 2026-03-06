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

    // CRITICAL: Use createPortal to render on document.body
    // The modal is placed inside the wallet's max-w-md overflow-hidden container in App.tsx.
    // Without a portal, fixed positioning cannot escape the parent's overflow clipping.
    return createPortal(
        <div className="fixed inset-0 z-[9999] flex items-start justify-center overflow-y-auto">
            {/* Backdrop */}
            <div
                className="fixed inset-0 bg-black/40 dark:bg-black/70 backdrop-blur-md"
                onClick={handleClose}
            />

            {/* Modal — wide on desktop, full on mobile */}
            <div className="relative w-full max-w-6xl mx-auto my-0 sm:my-6 px-0 sm:px-6 lg:px-8 z-10 min-h-screen sm:min-h-0">
                <div className={cn(
                    'w-full border',
                    'rounded-none sm:rounded-2xl',
                    'border-transparent sm:border-gray-200 bg-white shadow-2xl shadow-black/10',
                    'dark:sm:border-white/[0.07] dark:bg-[#0c0e15] dark:shadow-black/70',
                    'flex flex-col min-h-screen sm:min-h-0 sm:max-h-[90vh] overflow-hidden',
                    'animate-scale-in'
                )}>
                    {/* ── Header ──────────────────────────────────────── */}
                    <div className="flex-shrink-0 border-b border-gray-200 dark:border-white/[0.06]">
                        {/* Title row */}
                        <div className="flex items-center justify-between px-3 sm:px-6 lg:px-8 pt-3 sm:pt-5 pb-2 sm:pb-4">
                            <div className="flex items-center gap-2.5 sm:gap-4">
                                <img
                                    src="https://assets.dedust.io/images/ton.webp"
                                    alt="TON"
                                    className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl object-cover flex-shrink-0"
                                />
                                <div>
                                    <h2 className="text-base sm:text-xl font-bold text-gray-900 dark:text-white">Multi-Send</h2>
                                    <p className="text-[10px] sm:text-xs text-gray-500 mt-0.5">Batch transfers on TON</p>
                                </div>
                            </div>

                            <div className="flex items-center gap-2">
                                <span className="text-[11px] sm:text-xs font-medium text-gray-500">{rows.length} recipients</span>
                                <button
                                    type="button"
                                    onClick={handleClose}
                                    disabled={isSending}
                                    className={cn(
                                        'w-8 h-8 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center transition-all',
                                        'text-gray-400 hover:text-gray-900 hover:bg-gray-100',
                                        'dark:text-gray-500 dark:hover:text-white dark:hover:bg-white/[0.06]',
                                        'disabled:opacity-30 disabled:cursor-not-allowed'
                                    )}
                                >
                                    <X className="w-4 h-4 sm:w-5 sm:h-5" />
                                </button>
                            </div>
                        </div>

                        {/* Wallet context info + Mode selector */}
                        {!isUnsupportedWallet && (
                            <div className="flex flex-col gap-2 sm:gap-3 px-3 sm:px-6 lg:px-8 pb-3 sm:pb-4">
                                <ModeSelectorBar />
                            </div>
                        )}
                    </div>

                    {/* ── Scrollable Content ──────────────────────────── */}
                    <div className="flex-1 overflow-y-auto min-h-0">
                        {isUnsupportedWallet ? (
                            <div className="flex flex-col items-center justify-center p-8 sm:p-12 text-center h-full max-h-[500px] gap-4">
                                <div className="w-16 h-16 rounded-full bg-red-50 dark:bg-red-500/10 flex items-center justify-center mb-2">
                                    <AlertTriangle className="w-8 h-8 text-red-500" />
                                </div>
                                <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                                    Multi-Send Not Supported
                                </h3>
                                <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md">
                                    Your current wallet version <b>({walletType})</b> only supports single transfers. To use Multi-Send, please deploy or switch to a W5 or Highload V3 wallet.
                                </p>
                            </div>
                        ) : (
                            <>
                                <div className="px-2 sm:px-6 lg:px-8 py-3 sm:py-6">
                                    <TransferRowList />
                                </div>

                                <div className="px-2 sm:px-6 lg:px-8 pb-3 sm:pb-6">
                                    <UnificationPanel />
                                </div>
                            </>
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
        </div>,
        document.body
    );
};

export default MultiSendModal;
