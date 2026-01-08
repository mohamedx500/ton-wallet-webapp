/**
 * Wallet State Manager
 * 
 * In-memory state management with multi-layer caching for wallet operations.
 * For production, integrate with Redis and PostgreSQL.
 * 
 * Features:
 * - Multi-layer caching (L1: Memory, L2: LocalStorage/IndexedDB)
 * - Transaction history tracking
 * - Balance caching with TTL
 * - Transaction reconciliation
 * 
 * @version 1.0.0
 */

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

/**
 * Transaction record
 */
export interface TransactionRecord {
    id: string;
    hash: string;
    fromAddress: string;
    toAddress: string;
    amount: string; // Store as string to preserve precision
    fee?: string;
    type: 'ton_transfer' | 'jetton_transfer' | 'swap' | 'batch' | 'deploy' | 'other';
    status: 'pending' | 'confirmed' | 'failed';
    confirmations: number;
    blockNumber?: number;
    comment?: string;
    metadata?: Record<string, unknown>;
    createdAt: number;
    confirmedAt?: number;
    updatedAt: number;
}

/**
 * Balance cache entry
 */
export interface BalanceEntry {
    address: string;
    balance: string;
    updatedAt: number;
    expiresAt: number;
}

/**
 * Jetton balance cache entry
 */
export interface JettonBalanceEntry {
    walletAddress: string;
    jettonAddress: string;
    balance: string;
    symbol?: string;
    decimals?: number;
    updatedAt: number;
    expiresAt: number;
}

/**
 * Cache configuration
 */
export interface CacheConfig {
    balanceTTL: number;
    jettonBalanceTTL: number;
    transactionHistoryTTL: number;
    maxTransactionHistory: number;
    persistToStorage: boolean;
}

/**
 * Pagination options
 */
export interface PaginationOptions {
    page?: number;
    limit?: number;
    cursor?: string;
}

/**
 * Paginated result
 */
export interface PaginatedResult<T> {
    items: T[];
    total: number;
    page: number;
    limit: number;
    hasMore: boolean;
    cursor?: string;
}

// ============================================================================
// DEFAULT CONFIGURATION
// ============================================================================

const DEFAULT_CONFIG: CacheConfig = {
    balanceTTL: 30000, // 30 seconds
    jettonBalanceTTL: 60000, // 60 seconds
    transactionHistoryTTL: 300000, // 5 minutes
    maxTransactionHistory: 1000,
    persistToStorage: true,
};

const STORAGE_KEYS = {
    TRANSACTIONS: 'wallet_transactions',
    BALANCES: 'wallet_balances',
    JETTON_BALANCES: 'wallet_jetton_balances',
};

// ============================================================================
// LRU CACHE
// ============================================================================

/**
 * Simple LRU (Least Recently Used) Cache
 */
class LRUCache<K, V> {
    private cache: Map<K, V>;
    private maxSize: number;

    constructor(maxSize: number) {
        this.cache = new Map();
        this.maxSize = maxSize;
    }

    get(key: K): V | undefined {
        const value = this.cache.get(key);
        if (value !== undefined) {
            // Move to end (most recently used)
            this.cache.delete(key);
            this.cache.set(key, value);
        }
        return value;
    }

    set(key: K, value: V): void {
        // If key exists, delete it first
        if (this.cache.has(key)) {
            this.cache.delete(key);
        }

        // Evict oldest if at capacity
        if (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            if (firstKey !== undefined) {
                this.cache.delete(firstKey);
            }
        }

        this.cache.set(key, value);
    }

    has(key: K): boolean {
        return this.cache.has(key);
    }

    delete(key: K): boolean {
        return this.cache.delete(key);
    }

    clear(): void {
        this.cache.clear();
    }

    size(): number {
        return this.cache.size;
    }

    values(): V[] {
        return Array.from(this.cache.values());
    }

    entries(): [K, V][] {
        return Array.from(this.cache.entries());
    }
}

// ============================================================================
// STORAGE ADAPTER
// ============================================================================

/**
 * Storage adapter for persistence
 */
class StorageAdapter {
    private useLocalStorage: boolean;

    constructor() {
        this.useLocalStorage = typeof localStorage !== 'undefined';
    }

    async get<T>(key: string): Promise<T | null> {
        if (!this.useLocalStorage) return null;

        try {
            const item = localStorage.getItem(key);
            if (item) {
                return JSON.parse(item) as T;
            }
        } catch (error) {
            console.warn('[StorageAdapter] Failed to read from storage:', error);
        }
        return null;
    }

    async set<T>(key: string, value: T): Promise<void> {
        if (!this.useLocalStorage) return;

        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (error) {
            console.warn('[StorageAdapter] Failed to write to storage:', error);
        }
    }

    async delete(key: string): Promise<void> {
        if (!this.useLocalStorage) return;

        try {
            localStorage.removeItem(key);
        } catch (error) {
            console.warn('[StorageAdapter] Failed to delete from storage:', error);
        }
    }
}

// ============================================================================
// WALLET STATE MANAGER
// ============================================================================

/**
 * Wallet State Manager
 */
export class WalletStateManager {
    private config: CacheConfig;
    private storage: StorageAdapter;

    // L1 Cache (Memory)
    private balanceCache: LRUCache<string, BalanceEntry>;
    private jettonBalanceCache: LRUCache<string, JettonBalanceEntry>;
    private transactionCache: LRUCache<string, TransactionRecord>;

    // Transaction index by address
    private transactionsByAddress: Map<string, Set<string>> = new Map();

    // Listeners
    private balanceListeners: Map<string, Set<(balance: string) => void>> = new Map();
    private transactionListeners: Set<(tx: TransactionRecord) => void> = new Set();

    constructor(config?: Partial<CacheConfig>) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.storage = new StorageAdapter();

        this.balanceCache = new LRUCache(1000);
        this.jettonBalanceCache = new LRUCache(5000);
        this.transactionCache = new LRUCache(this.config.maxTransactionHistory);

        // Load from storage
        if (this.config.persistToStorage) {
            this.loadFromStorage();
        }
    }

    // ========================================================================
    // BALANCE MANAGEMENT
    // ========================================================================

    /**
     * Get cached balance
     */
    getBalance(address: string): string | null {
        const entry = this.balanceCache.get(address);

        if (entry && Date.now() < entry.expiresAt) {
            return entry.balance;
        }

        // Expired or not found
        if (entry) {
            this.balanceCache.delete(address);
        }

        return null;
    }

    /**
     * Set balance in cache
     */
    setBalance(address: string, balance: string): void {
        const now = Date.now();
        const entry: BalanceEntry = {
            address,
            balance,
            updatedAt: now,
            expiresAt: now + this.config.balanceTTL,
        };

        this.balanceCache.set(address, entry);

        // Notify listeners
        this.notifyBalanceChange(address, balance);

        // Persist
        if (this.config.persistToStorage) {
            this.persistBalances();
        }
    }

    /**
     * Update balance cache (atomic update)
     */
    updateBalance(address: string, delta: string): void {
        const current = this.getBalance(address);
        if (current !== null) {
            const newBalance = (BigInt(current) + BigInt(delta)).toString();
            this.setBalance(address, newBalance);
        }
    }

    /**
     * Subscribe to balance changes
     */
    onBalanceChange(address: string, callback: (balance: string) => void): () => void {
        if (!this.balanceListeners.has(address)) {
            this.balanceListeners.set(address, new Set());
        }
        this.balanceListeners.get(address)!.add(callback);

        // Return unsubscribe function
        return () => {
            this.balanceListeners.get(address)?.delete(callback);
        };
    }

    /**
     * Notify balance change listeners
     */
    private notifyBalanceChange(address: string, balance: string): void {
        const listeners = this.balanceListeners.get(address);
        if (listeners) {
            for (const callback of listeners) {
                try {
                    callback(balance);
                } catch (error) {
                    console.error('[WalletState] Error in balance listener:', error);
                }
            }
        }
    }

    // ========================================================================
    // JETTON BALANCE MANAGEMENT
    // ========================================================================

    /**
     * Get cached jetton balance
     */
    getJettonBalance(walletAddress: string, jettonAddress: string): JettonBalanceEntry | null {
        const key = `${walletAddress}:${jettonAddress}`;
        const entry = this.jettonBalanceCache.get(key);

        if (entry && Date.now() < entry.expiresAt) {
            return entry;
        }

        if (entry) {
            this.jettonBalanceCache.delete(key);
        }

        return null;
    }

    /**
     * Set jetton balance in cache
     */
    setJettonBalance(
        walletAddress: string,
        jettonAddress: string,
        balance: string,
        metadata?: { symbol?: string; decimals?: number }
    ): void {
        const key = `${walletAddress}:${jettonAddress}`;
        const now = Date.now();

        const entry: JettonBalanceEntry = {
            walletAddress,
            jettonAddress,
            balance,
            symbol: metadata?.symbol,
            decimals: metadata?.decimals,
            updatedAt: now,
            expiresAt: now + this.config.jettonBalanceTTL,
        };

        this.jettonBalanceCache.set(key, entry);

        // Persist
        if (this.config.persistToStorage) {
            this.persistJettonBalances();
        }
    }

    /**
     * Get all jetton balances for a wallet
     */
    getAllJettonBalances(walletAddress: string): JettonBalanceEntry[] {
        const now = Date.now();
        return this.jettonBalanceCache.values()
            .filter(entry =>
                entry.walletAddress === walletAddress &&
                now < entry.expiresAt
            );
    }

    // ========================================================================
    // TRANSACTION MANAGEMENT
    // ========================================================================

    /**
     * Record a transaction
     */
    recordTransaction(tx: TransactionRecord): void {
        this.transactionCache.set(tx.id, tx);

        // Index by address
        this.indexTransaction(tx.fromAddress, tx.id);
        if (tx.toAddress) {
            this.indexTransaction(tx.toAddress, tx.id);
        }

        // Notify listeners
        for (const callback of this.transactionListeners) {
            try {
                callback(tx);
            } catch (error) {
                console.error('[WalletState] Error in transaction listener:', error);
            }
        }

        // Persist
        if (this.config.persistToStorage) {
            this.persistTransactions();
        }
    }

    /**
     * Index transaction by address
     */
    private indexTransaction(address: string, txId: string): void {
        if (!this.transactionsByAddress.has(address)) {
            this.transactionsByAddress.set(address, new Set());
        }
        this.transactionsByAddress.get(address)!.add(txId);
    }

    /**
     * Update transaction status
     */
    updateTransaction(
        id: string,
        updates: Partial<Pick<TransactionRecord, 'status' | 'confirmations' | 'blockNumber' | 'confirmedAt'>>
    ): TransactionRecord | null {
        const tx = this.transactionCache.get(id);
        if (!tx) return null;

        const updated: TransactionRecord = {
            ...tx,
            ...updates,
            updatedAt: Date.now(),
        };

        this.transactionCache.set(id, updated);

        // Notify listeners
        for (const callback of this.transactionListeners) {
            try {
                callback(updated);
            } catch (error) {
                console.error('[WalletState] Error in transaction listener:', error);
            }
        }

        // Persist
        if (this.config.persistToStorage) {
            this.persistTransactions();
        }

        return updated;
    }

    /**
     * Get transaction by ID
     */
    getTransaction(id: string): TransactionRecord | null {
        return this.transactionCache.get(id) || null;
    }

    /**
     * Get transaction by hash
     */
    getTransactionByHash(hash: string): TransactionRecord | null {
        for (const tx of this.transactionCache.values()) {
            if (tx.hash === hash) {
                return tx;
            }
        }
        return null;
    }

    /**
     * Get transaction history for an address
     */
    getTransactionHistory(
        address: string,
        options?: PaginationOptions
    ): PaginatedResult<TransactionRecord> {
        const txIds = this.transactionsByAddress.get(address) || new Set();
        const transactions: TransactionRecord[] = [];

        for (const id of txIds) {
            const tx = this.transactionCache.get(id);
            if (tx) {
                transactions.push(tx);
            }
        }

        // Sort by creation time (newest first)
        transactions.sort((a, b) => b.createdAt - a.createdAt);

        // Paginate
        const page = options?.page || 1;
        const limit = options?.limit || 20;
        const startIndex = (page - 1) * limit;
        const items = transactions.slice(startIndex, startIndex + limit);

        return {
            items,
            total: transactions.length,
            page,
            limit,
            hasMore: startIndex + limit < transactions.length,
        };
    }

    /**
     * Get pending transactions
     */
    getPendingTransactions(): TransactionRecord[] {
        return this.transactionCache.values()
            .filter(tx => tx.status === 'pending');
    }

    /**
     * Subscribe to transaction changes
     */
    onTransaction(callback: (tx: TransactionRecord) => void): () => void {
        this.transactionListeners.add(callback);
        return () => {
            this.transactionListeners.delete(callback);
        };
    }

    // ========================================================================
    // RECONCILIATION
    // ========================================================================

    /**
     * Get transactions that need reconciliation
     */
    getTransactionsForReconciliation(): TransactionRecord[] {
        const now = Date.now();
        const timeout = 600000; // 10 minutes

        return this.transactionCache.values()
            .filter(tx =>
                tx.status === 'pending' &&
                (now - tx.createdAt) < timeout
            );
    }

    /**
     * Mark transaction as confirmed
     */
    confirmTransaction(id: string, blockNumber: number, confirmations: number): TransactionRecord | null {
        return this.updateTransaction(id, {
            status: 'confirmed',
            blockNumber,
            confirmations,
            confirmedAt: Date.now(),
        });
    }

    /**
     * Mark transaction as failed
     */
    failTransaction(id: string): TransactionRecord | null {
        return this.updateTransaction(id, {
            status: 'failed',
        });
    }

    // ========================================================================
    // PERSISTENCE
    // ========================================================================

    /**
     * Load data from storage
     */
    private async loadFromStorage(): Promise<void> {
        try {
            // Load transactions
            const transactions = await this.storage.get<TransactionRecord[]>(
                STORAGE_KEYS.TRANSACTIONS
            );
            if (transactions) {
                for (const tx of transactions) {
                    this.transactionCache.set(tx.id, tx);
                    this.indexTransaction(tx.fromAddress, tx.id);
                    if (tx.toAddress) {
                        this.indexTransaction(tx.toAddress, tx.id);
                    }
                }
            }

            // Load balances (but they'll likely be expired)
            const balances = await this.storage.get<BalanceEntry[]>(
                STORAGE_KEYS.BALANCES
            );
            if (balances) {
                for (const entry of balances) {
                    this.balanceCache.set(entry.address, entry);
                }
            }

            console.log('[WalletState] Loaded from storage');
        } catch (error) {
            console.error('[WalletState] Failed to load from storage:', error);
        }
    }

    /**
     * Persist transactions to storage
     */
    private async persistTransactions(): Promise<void> {
        const transactions = this.transactionCache.values();
        await this.storage.set(STORAGE_KEYS.TRANSACTIONS, transactions);
    }

    /**
     * Persist balances to storage
     */
    private async persistBalances(): Promise<void> {
        const balances = this.balanceCache.values();
        await this.storage.set(STORAGE_KEYS.BALANCES, balances);
    }

    /**
     * Persist jetton balances to storage
     */
    private async persistJettonBalances(): Promise<void> {
        const balances = this.jettonBalanceCache.values();
        await this.storage.set(STORAGE_KEYS.JETTON_BALANCES, balances);
    }

    // ========================================================================
    // CACHE MANAGEMENT
    // ========================================================================

    /**
     * Clear all caches
     */
    clearCache(): void {
        this.balanceCache.clear();
        this.jettonBalanceCache.clear();
        console.log('[WalletState] Caches cleared');
    }

    /**
     * Clear all data including persisted
     */
    async clearAll(): Promise<void> {
        this.balanceCache.clear();
        this.jettonBalanceCache.clear();
        this.transactionCache.clear();
        this.transactionsByAddress.clear();

        if (this.config.persistToStorage) {
            await this.storage.delete(STORAGE_KEYS.TRANSACTIONS);
            await this.storage.delete(STORAGE_KEYS.BALANCES);
            await this.storage.delete(STORAGE_KEYS.JETTON_BALANCES);
        }

        console.log('[WalletState] All data cleared');
    }

    /**
     * Get cache statistics
     */
    getStats(): {
        balanceCacheSize: number;
        jettonBalanceCacheSize: number;
        transactionCacheSize: number;
        indexedAddresses: number;
    } {
        return {
            balanceCacheSize: this.balanceCache.size(),
            jettonBalanceCacheSize: this.jettonBalanceCache.size(),
            transactionCacheSize: this.transactionCache.size(),
            indexedAddresses: this.transactionsByAddress.size,
        };
    }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create wallet state manager
 */
export function createWalletStateManager(
    config?: Partial<CacheConfig>
): WalletStateManager {
    return new WalletStateManager(config);
}

// Singleton instance
let stateManagerInstance: WalletStateManager | null = null;

/**
 * Get singleton instance
 */
export function getWalletStateManager(): WalletStateManager {
    if (!stateManagerInstance) {
        stateManagerInstance = new WalletStateManager();
    }
    return stateManagerInstance;
}

export default WalletStateManager;
