/**
 * Network Service
 * 
 * Monitors network connectivity and quality.
 * Provides utilities for detecting weak internet connections.
 * 
 * Features:
 * - Online/offline detection
 * - Connection quality monitoring (via Network Information API)
 * - Ping-based latency checks
 * - Event-based notifications
 */

export const ConnectionQuality = {
    OFFLINE: 'offline',
    WEAK: 'weak',
    MODERATE: 'moderate',
    GOOD: 'good',
    UNKNOWN: 'unknown',
};

export const ConnectionType = {
    WIFI: 'wifi',
    CELLULAR: 'cellular',
    ETHERNET: 'ethernet',
    UNKNOWN: 'unknown',
};

/**
 * Network Service class
 */
export class NetworkService {
    constructor() {
        this.isOnline = navigator.onLine;
        this.connectionQuality = ConnectionQuality.UNKNOWN;
        this.connectionType = ConnectionType.UNKNOWN;
        this.latency = null;
        this.effectiveType = null; // slow-2g, 2g, 3g, 4g
        this.downlink = null; // Mbps
        this.listeners = new Set();
        this.pingInterval = null;
        this.lastPingTime = null;

        this._init();
    }

    /**
     * Initialize network monitoring
     */
    _init() {
        // Listen for online/offline events
        window.addEventListener('online', () => this._handleOnline());
        window.addEventListener('offline', () => this._handleOffline());

        // Use Network Information API if available
        if ('connection' in navigator) {
            const connection = navigator.connection;
            this._updateConnectionInfo(connection);

            connection.addEventListener('change', () => {
                this._updateConnectionInfo(connection);
            });
        }

        // Initial state check
        this._checkConnection();
    }

    /**
     * Handle coming online
     */
    _handleOnline() {
        this.isOnline = true;
        console.log('[NetworkService] Connection restored');
        this._checkConnection();
        this._notifyListeners();
    }

    /**
     * Handle going offline
     */
    _handleOffline() {
        this.isOnline = false;
        this.connectionQuality = ConnectionQuality.OFFLINE;
        this.latency = null;
        console.log('[NetworkService] Connection lost');
        this._notifyListeners();
    }

    /**
     * Update connection info from Network Information API
     */
    _updateConnectionInfo(connection) {
        this.effectiveType = connection.effectiveType;
        this.downlink = connection.downlink;

        // Determine connection type
        if (connection.type) {
            switch (connection.type) {
                case 'wifi':
                    this.connectionType = ConnectionType.WIFI;
                    break;
                case 'cellular':
                    this.connectionType = ConnectionType.CELLULAR;
                    break;
                case 'ethernet':
                    this.connectionType = ConnectionType.ETHERNET;
                    break;
                default:
                    this.connectionType = ConnectionType.UNKNOWN;
            }
        }

        // Determine quality based on effective type
        switch (this.effectiveType) {
            case 'slow-2g':
            case '2g':
                this.connectionQuality = ConnectionQuality.WEAK;
                break;
            case '3g':
                this.connectionQuality = ConnectionQuality.MODERATE;
                break;
            case '4g':
                this.connectionQuality = ConnectionQuality.GOOD;
                break;
            default:
                this.connectionQuality = ConnectionQuality.UNKNOWN;
        }

        this._notifyListeners();
    }

    /**
     * Check connection by pinging an endpoint
     */
    async _checkConnection() {
        if (!this.isOnline) {
            this.connectionQuality = ConnectionQuality.OFFLINE;
            return;
        }

        try {
            const startTime = performance.now();

            // Try to ping a reliable endpoint
            const endpoints = [
                'https://toncenter.com/api/v2/getMasterchainInfo',
                'https://tonapi.io/v2/status',
            ];

            let success = false;
            for (const endpoint of endpoints) {
                try {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 5000);

                    const response = await fetch(endpoint, {
                        method: 'GET',
                        mode: 'cors',
                        signal: controller.signal,
                    });

                    clearTimeout(timeoutId);

                    if (response.ok) {
                        success = true;
                        break;
                    }
                } catch (e) {
                    continue; // Try next endpoint
                }
            }

            const endTime = performance.now();
            this.latency = Math.round(endTime - startTime);
            this.lastPingTime = Date.now();

            if (!success) {
                // API unreachable but navigator says online
                // This could be a firewall or DNS issue
                this.connectionQuality = ConnectionQuality.WEAK;
            } else {
                // Determine quality based on latency
                if (this.latency < 200) {
                    this.connectionQuality = ConnectionQuality.GOOD;
                } else if (this.latency < 500) {
                    this.connectionQuality = ConnectionQuality.MODERATE;
                } else {
                    this.connectionQuality = ConnectionQuality.WEAK;
                }
            }
        } catch (error) {
            console.warn('[NetworkService] Connection check failed:', error.message);
            if (!this.isOnline) {
                this.connectionQuality = ConnectionQuality.OFFLINE;
            } else {
                this.connectionQuality = ConnectionQuality.WEAK;
            }
        }

        this._notifyListeners();
    }

    /**
     * Start periodic connection checks
     */
    startMonitoring(intervalMs = 30000) {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
        }

        this._checkConnection();
        this.pingInterval = setInterval(() => this._checkConnection(), intervalMs);
    }

    /**
     * Stop periodic connection checks
     */
    stopMonitoring() {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
    }

    /**
     * Manual connection check
     */
    async checkNow() {
        await this._checkConnection();
        return this.getStatus();
    }

    /**
     * Get current network status
     */
    getStatus() {
        return {
            isOnline: this.isOnline,
            quality: this.connectionQuality,
            type: this.connectionType,
            latency: this.latency,
            effectiveType: this.effectiveType,
            downlink: this.downlink,
            lastCheck: this.lastPingTime,
        };
    }

    /**
     * Check if connection is weak
     */
    isWeak() {
        return this.connectionQuality === ConnectionQuality.WEAK ||
            this.connectionQuality === ConnectionQuality.OFFLINE;
    }

    /**
     * Check if connection is offline
     */
    isOffline() {
        return !this.isOnline || this.connectionQuality === ConnectionQuality.OFFLINE;
    }

    /**
     * Add status change listener
     */
    addListener(callback) {
        this.listeners.add(callback);
        return () => this.listeners.delete(callback);
    }

    /**
     * Remove status change listener
     */
    removeListener(callback) {
        this.listeners.delete(callback);
    }

    /**
     * Notify all listeners of status change
     */
    _notifyListeners() {
        const status = this.getStatus();
        this.listeners.forEach(callback => {
            try {
                callback(status);
            } catch (e) {
                console.error('[NetworkService] Listener error:', e);
            }
        });
    }

    /**
     * Get user-friendly status message
     */
    getStatusMessage() {
        const { isOnline, quality, latency } = this.getStatus();

        if (!isOnline) {
            return {
                title: 'No Internet Connection',
                message: 'Please check your network settings and try again.',
                severity: 'error',
            };
        }

        switch (quality) {
            case ConnectionQuality.WEAK:
                return {
                    title: 'Weak Connection',
                    message: `Slow network detected${latency ? ` (${latency}ms latency)` : ''}. Some features may be slow.`,
                    severity: 'warning',
                };
            case ConnectionQuality.MODERATE:
                return {
                    title: 'Moderate Connection',
                    message: 'Network connection is acceptable.',
                    severity: 'info',
                };
            case ConnectionQuality.GOOD:
                return {
                    title: 'Good Connection',
                    message: 'Network connection is stable.',
                    severity: 'success',
                };
            default:
                return {
                    title: 'Checking Connection',
                    message: 'Verifying network status...',
                    severity: 'info',
                };
        }
    }

    /**
     * Create a fetch wrapper with timeout and retry
     */
    async fetchWithRetry(url, options = {}, maxRetries = 3, baseDelay = 1000) {
        const timeout = options.timeout || 10000;
        let lastError = null;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), timeout);

                const response = await fetch(url, {
                    ...options,
                    signal: controller.signal,
                });

                clearTimeout(timeoutId);
                return response;
            } catch (error) {
                lastError = error;

                // Don't retry on certain errors
                if (error.name === 'AbortError') {
                    console.warn(`[NetworkService] Request timeout (attempt ${attempt + 1}/${maxRetries})`);
                } else if (!this.isOnline) {
                    throw new Error('No internet connection');
                }

                // Wait before retrying (exponential backoff)
                if (attempt < maxRetries - 1) {
                    const delay = baseDelay * Math.pow(2, attempt);
                    console.log(`[NetworkService] Retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));

                    // Re-check connection before retry
                    await this._checkConnection();
                }
            }
        }

        throw lastError || new Error('Network request failed after retries');
    }
}

// Export singleton instance
export const networkService = new NetworkService();

export default NetworkService;
