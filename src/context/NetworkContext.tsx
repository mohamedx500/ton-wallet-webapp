import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
// @ts-ignore
import { networkService, ConnectionQuality } from '../services/NetworkService';

interface NetworkStatus {
    isOnline: boolean;
    quality: string;
    type: string;
    latency: number | null;
    effectiveType: string | null;
    downlink: number | null;
    lastCheck: number | null;
}

interface NetworkContextType {
    status: NetworkStatus;
    isOnline: boolean;
    isWeak: boolean;
    isOffline: boolean;
    latency: number | null;
    quality: string;
    checkConnection: () => Promise<NetworkStatus>;
    getStatusMessage: () => { title: string; message: string; severity: string };
    showBanner: boolean;
    dismissBanner: () => void;
}

const defaultStatus: NetworkStatus = {
    isOnline: true,
    quality: ConnectionQuality.UNKNOWN,
    type: 'unknown',
    latency: null,
    effectiveType: null,
    downlink: null,
    lastCheck: null,
};

const NetworkContext = createContext<NetworkContextType | undefined>(undefined);

export function NetworkProvider({ children }: { children: ReactNode }) {
    const [status, setStatus] = useState<NetworkStatus>(defaultStatus);
    const [showBanner, setShowBanner] = useState(false);
    const [dismissedAt, setDismissedAt] = useState<number | null>(null);

    // Update state when network status changes
    useEffect(() => {
        // Initial status
        setStatus(networkService.getStatus());

        // Start monitoring
        networkService.startMonitoring(30000); // Check every 30 seconds

        // Listen for changes
        const unsubscribe = networkService.addListener((newStatus: NetworkStatus) => {
            setStatus(newStatus);

            // Show banner if connection is weak or offline
            const isProblematic = newStatus.quality === ConnectionQuality.WEAK ||
                newStatus.quality === ConnectionQuality.OFFLINE ||
                !newStatus.isOnline;

            // Don't show if user dismissed recently (within 1 minute)
            if (isProblematic && (!dismissedAt || Date.now() - dismissedAt > 60000)) {
                setShowBanner(true);
            } else if (!isProblematic) {
                setShowBanner(false);
            }
        });

        return () => {
            unsubscribe();
            networkService.stopMonitoring();
        };
    }, [dismissedAt]);

    const checkConnection = useCallback(async () => {
        const newStatus = await networkService.checkNow();
        setStatus(newStatus);
        return newStatus;
    }, []);

    const getStatusMessage = useCallback(() => {
        return networkService.getStatusMessage();
    }, []);

    const dismissBanner = useCallback(() => {
        setShowBanner(false);
        setDismissedAt(Date.now());
    }, []);

    const value: NetworkContextType = {
        status,
        isOnline: status.isOnline,
        isWeak: status.quality === ConnectionQuality.WEAK,
        isOffline: !status.isOnline || status.quality === ConnectionQuality.OFFLINE,
        latency: status.latency,
        quality: status.quality,
        checkConnection,
        getStatusMessage,
        showBanner,
        dismissBanner,
    };

    return (
        <NetworkContext.Provider value={value}>
            {children}
        </NetworkContext.Provider>
    );
}

export function useNetwork() {
    const context = useContext(NetworkContext);
    if (!context) {
        throw new Error('useNetwork must be used within NetworkProvider');
    }
    return context;
}

export { ConnectionQuality };
