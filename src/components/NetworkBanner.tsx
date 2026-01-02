import React, { useEffect, useState } from 'react';
import { useNetwork, ConnectionQuality } from '../context/NetworkContext';

interface NetworkBannerProps {
    darkMode?: boolean;
}

/**
 * Network Banner Component
 * 
 * Displays a persistent banner when network connection is weak or offline.
 * Features:
 * - Auto-dismiss when connection is restored
 * - Retry button to force connection check
 * - Smooth animations
 * - Dark mode support
 */
export default function NetworkBanner({ darkMode = false }: NetworkBannerProps) {
    const { status, showBanner, dismissBanner, checkConnection, isOffline, isWeak, getStatusMessage } = useNetwork();
    const [isChecking, setIsChecking] = useState(false);
    const [isVisible, setIsVisible] = useState(false);

    // Animate in/out
    useEffect(() => {
        if (showBanner) {
            // Small delay for mount animation
            const timer = setTimeout(() => setIsVisible(true), 10);
            return () => clearTimeout(timer);
        } else {
            setIsVisible(false);
        }
    }, [showBanner]);

    const handleRetry = async () => {
        setIsChecking(true);
        try {
            await checkConnection();
        } finally {
            setTimeout(() => setIsChecking(false), 500);
        }
    };

    if (!showBanner) return null;

    const { title, message, severity } = getStatusMessage();

    // Colors based on severity
    const getBannerColors = () => {
        if (isOffline) {
            return darkMode
                ? 'bg-gradient-to-r from-red-900/95 to-red-800/95 border-red-700'
                : 'bg-gradient-to-r from-red-500 to-red-600 border-red-400';
        }
        if (isWeak) {
            return darkMode
                ? 'bg-gradient-to-r from-amber-900/95 to-orange-900/95 border-amber-700'
                : 'bg-gradient-to-r from-amber-500 to-orange-500 border-amber-400';
        }
        return darkMode
            ? 'bg-gradient-to-r from-blue-900/95 to-indigo-900/95 border-blue-700'
            : 'bg-gradient-to-r from-blue-500 to-indigo-500 border-blue-400';
    };

    const getIcon = () => {
        if (isOffline) {
            return (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3m8.293 8.293l4.414 4.414" />
                </svg>
            );
        }
        if (isWeak) {
            return (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
                </svg>
            );
        }
        return (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
        );
    };

    return (
        <div
            className={`
                fixed top-0 left-0 right-0 z-[9999]
                transition-all duration-300 ease-out
                ${isVisible ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0'}
            `}
        >
            <div className={`
                ${getBannerColors()}
                backdrop-blur-md
                border-b
                shadow-lg
                text-white
                px-4 py-3
            `}>
                <div className="max-w-md mx-auto flex items-center justify-between gap-3">
                    {/* Icon */}
                    <div className="flex-shrink-0 animate-pulse">
                        {getIcon()}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm">{title}</p>
                        <p className="text-xs opacity-90 truncate">{message}</p>
                        {status.latency && (
                            <p className="text-xs opacity-75 mt-0.5">
                                Latency: {status.latency}ms
                            </p>
                        )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                        {/* Retry Button */}
                        <button
                            onClick={handleRetry}
                            disabled={isChecking}
                            className={`
                                p-2 rounded-full
                                bg-white/20 hover:bg-white/30
                                transition-all duration-200
                                ${isChecking ? 'cursor-not-allowed' : 'cursor-pointer'}
                            `}
                            title="Retry connection"
                        >
                            <svg
                                className={`w-4 h-4 ${isChecking ? 'animate-spin' : ''}`}
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                            >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                        </button>

                        {/* Dismiss Button */}
                        <button
                            onClick={dismissBanner}
                            className="
                                p-2 rounded-full
                                bg-white/20 hover:bg-white/30
                                transition-all duration-200
                            "
                            title="Dismiss"
                        >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
