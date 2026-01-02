/**
 * Transaction Tracker Service
 * 
 * Inspired by ton-wallet-api's transaction tracking and callback system.
 * Tracks pending transactions, monitors their status, and emits events
 * when transactions are confirmed or fail.
 * 
 * Features:
 * - Track pending transactions with unique IDs
 * - Poll for confirmation status
 * - Emit events for UI updates (callback-style)
 * - Persistent storage to survive page refresh
 * - Automatic cleanup of old transactions
 */

/**
 * Transaction status enum
 */
export const TransactionStatus = {
    PENDING: 'pending',
    CONFIRMING: 'confirming',
    CONFIRMED: 'confirmed',
    FAILED: 'failed',
    EXPIRED: 'expired',
};

/**
 * Event types for transaction updates
 */
export const TransactionEvent = {
    STATUS_CHANGED: 'status_changed',
    CONFIRMED: 'confirmed',
    FAILED: 'failed',
    EXPIRED: 'expired',
};

/**
 * Transaction Tracker
 */
export class TransactionTracker {
    constructor(options = {}) {
        this.transactions = new Map();
        this.listeners = new Map();
        this.pollInterval = options.pollInterval || 5000; // 5 seconds
        this.maxAge = options.maxAge || 24 * 60 * 60 * 1000; // 24 hours
        this.confirmationBlocks = options.confirmationBlocks || 1;
        this.storageKey = 'ton_wallet_pending_txs';

        // Load persisted transactions
        this._loadFromStorage();

        // Start polling if there are pending transactions
        if (this._hasPendingTransactions()) {
            this._startPolling();
        }
    }

    /**
     * Add a transaction to track
     * @param {Object} tx - Transaction details
     * @returns {string} - Transaction tracking ID
     */
    track(tx) {
        const trackingId = tx.hash || tx.queryId || this._generateId();

        const trackedTx = {
            id: trackingId,
            hash: tx.hash,
            queryId: tx.queryId,
            type: tx.type || 'transfer',
            amount: tx.amount,
            recipient: tx.recipient,
            tokenSymbol: tx.tokenSymbol || 'TON',
            status: TransactionStatus.PENDING,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            confirmations: 0,
            walletAddress: tx.walletAddress,
            network: tx.network || 'mainnet',
            retryCount: 0,
            error: null,
        };

        this.transactions.set(trackingId, trackedTx);
        this._saveToStorage();
        this._startPolling();

        console.log(`[TransactionTracker] Tracking transaction: ${trackingId}`);

        return trackingId;
    }

    /**
     * Get transaction by ID
     */
    get(trackingId) {
        return this.transactions.get(trackingId);
    }

    /**
     * Get all transactions
     */
    getAll() {
        return Array.from(this.transactions.values());
    }

    /**
     * Get pending transactions
     */
    getPending() {
        return this.getAll().filter(tx =>
            tx.status === TransactionStatus.PENDING ||
            tx.status === TransactionStatus.CONFIRMING
        );
    }

    /**
     * Subscribe to transaction events
     * @param {string} event - Event type
     * @param {Function} callback - Callback function
     * @returns {Function} - Unsubscribe function
     */
    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event).add(callback);

        // Return unsubscribe function
        return () => this.listeners.get(event).delete(callback);
    }

    /**
     * Emit an event
     */
    _emit(event, data) {
        const callbacks = this.listeners.get(event);
        if (callbacks) {
            callbacks.forEach(cb => {
                try {
                    cb(data);
                } catch (error) {
                    console.error('[TransactionTracker] Callback error:', error);
                }
            });
        }
    }

    /**
     * Update transaction status
     */
    _updateStatus(trackingId, status, extra = {}) {
        const tx = this.transactions.get(trackingId);
        if (!tx) return;

        const oldStatus = tx.status;
        tx.status = status;
        tx.updatedAt = Date.now();
        Object.assign(tx, extra);

        this.transactions.set(trackingId, tx);
        this._saveToStorage();

        // Emit events
        if (oldStatus !== status) {
            this._emit(TransactionEvent.STATUS_CHANGED, { tx, oldStatus });

            if (status === TransactionStatus.CONFIRMED) {
                this._emit(TransactionEvent.CONFIRMED, tx);
            } else if (status === TransactionStatus.FAILED) {
                this._emit(TransactionEvent.FAILED, tx);
            } else if (status === TransactionStatus.EXPIRED) {
                this._emit(TransactionEvent.EXPIRED, tx);
            }
        }

        console.log(`[TransactionTracker] Status updated: ${trackingId} -> ${status}`);
    }

    /**
     * Check transaction status on blockchain
     * This is a placeholder - implement with actual TonAPI calls
     */
    async checkTransactionStatus(tx) {
        // This would typically call TonAPI to check transaction status
        // For now, we simulate confirmation after some time
        const age = Date.now() - tx.createdAt;

        // Expire after 10 minutes of pending
        if (age > 10 * 60 * 1000 && tx.status === TransactionStatus.PENDING) {
            return { status: TransactionStatus.EXPIRED };
        }

        // In real implementation, check blockchain
        // const tonApi = new TonApiService();
        // const confirmed = await tonApi.getTransaction(tx.hash);
        // if (confirmed) return { status: TransactionStatus.CONFIRMED };

        return { status: tx.status };
    }

    /**
     * Poll for transaction updates
     */
    async _poll() {
        const pending = this.getPending();

        if (pending.length === 0) {
            this._stopPolling();
            return;
        }

        for (const tx of pending) {
            try {
                const result = await this.checkTransactionStatus(tx);
                if (result.status !== tx.status) {
                    this._updateStatus(tx.id, result.status, result);
                }
            } catch (error) {
                console.warn(`[TransactionTracker] Failed to check tx ${tx.id}:`, error);
                tx.retryCount++;
                if (tx.retryCount >= 10) {
                    this._updateStatus(tx.id, TransactionStatus.FAILED, {
                        error: 'Max retries exceeded'
                    });
                }
            }
        }

        // Cleanup old transactions
        this._cleanup();
    }

    /**
     * Start polling
     */
    _startPolling() {
        if (this.pollingTimer) return;

        this.pollingTimer = setInterval(() => this._poll(), this.pollInterval);
        console.log('[TransactionTracker] Started polling');
    }

    /**
     * Stop polling
     */
    _stopPolling() {
        if (this.pollingTimer) {
            clearInterval(this.pollingTimer);
            this.pollingTimer = null;
            console.log('[TransactionTracker] Stopped polling');
        }
    }

    /**
     * Check if there are pending transactions
     */
    _hasPendingTransactions() {
        return this.getPending().length > 0;
    }

    /**
     * Generate unique ID
     */
    _generateId() {
        return `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Save to localStorage
     */
    _saveToStorage() {
        try {
            const data = Array.from(this.transactions.entries());
            localStorage.setItem(this.storageKey, JSON.stringify(data));
        } catch (error) {
            console.warn('[TransactionTracker] Failed to save:', error);
        }
    }

    /**
     * Load from localStorage
     */
    _loadFromStorage() {
        try {
            const data = localStorage.getItem(this.storageKey);
            if (data) {
                const entries = JSON.parse(data);
                this.transactions = new Map(entries);
                console.log(`[TransactionTracker] Loaded ${entries.length} transactions`);
            }
        } catch (error) {
            console.warn('[TransactionTracker] Failed to load:', error);
        }
    }

    /**
     * Cleanup old transactions
     */
    _cleanup() {
        const now = Date.now();
        let cleaned = 0;

        for (const [id, tx] of this.transactions) {
            const age = now - tx.createdAt;
            if (age > this.maxAge && tx.status !== TransactionStatus.PENDING) {
                this.transactions.delete(id);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            this._saveToStorage();
            console.log(`[TransactionTracker] Cleaned up ${cleaned} old transactions`);
        }
    }

    /**
     * Mark transaction as confirmed manually
     * (useful when we get confirmation from other sources)
     */
    confirm(trackingId, hash = null) {
        this._updateStatus(trackingId, TransactionStatus.CONFIRMED, { hash });
    }

    /**
     * Mark transaction as failed manually
     */
    fail(trackingId, error = null) {
        this._updateStatus(trackingId, TransactionStatus.FAILED, { error });
    }

    /**
     * Clear all transactions
     */
    clear() {
        this.transactions.clear();
        this._saveToStorage();
        this._stopPolling();
    }
}

// Export singleton instance
export const transactionTracker = new TransactionTracker();

export default TransactionTracker;
