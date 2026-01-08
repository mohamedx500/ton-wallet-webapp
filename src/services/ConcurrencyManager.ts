/**
 * Concurrency Manager
 * 
 * Production-grade concurrency control with:
 * - Token bucket rate limiting
 * - Connection pooling
 * - Request queuing for burst traffic
 * - Adaptive backoff
 * - Per-user rate limiting
 * 
 * @version 1.0.0
 */

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

/**
 * Rate limiter configuration
 */
export interface RateLimiterConfig {
    capacity: number;
    fillRate: number; // tokens per interval
    fillInterval: number; // milliseconds
}

/**
 * Connection pool configuration
 */
export interface PoolConfig {
    minSize: number;
    maxSize: number;
    acquireTimeout: number;
    idleTimeout: number;
}

/**
 * Request queue configuration
 */
export interface QueueConfig {
    maxSize: number;
    timeout: number;
}

/**
 * Concurrency configuration
 */
export interface ConcurrencyConfig {
    rateLimiter: RateLimiterConfig;
    connectionPool: PoolConfig;
    requestQueue: QueueConfig;
    adaptiveBackoff: {
        baseDelay: number;
        maxDelay: number;
        multiplier: number;
    };
    perUserLimit: {
        requestsPerMinute: number;
    };
}

/**
 * Rate limit info
 */
export interface RateLimitInfo {
    remaining: number;
    total: number;
    resetAt: number;
}

// ============================================================================
// DEFAULT CONFIGURATION
// ============================================================================

const DEFAULT_CONFIG: ConcurrencyConfig = {
    rateLimiter: {
        capacity: 100,
        fillRate: 10,
        fillInterval: 1000,
    },
    connectionPool: {
        minSize: 5,
        maxSize: 50,
        acquireTimeout: 10000,
        idleTimeout: 300000, // 5 minutes
    },
    requestQueue: {
        maxSize: 1000,
        timeout: 30000,
    },
    adaptiveBackoff: {
        baseDelay: 1000,
        maxDelay: 30000,
        multiplier: 2,
    },
    perUserLimit: {
        requestsPerMinute: 60,
    },
};

// ============================================================================
// TOKEN BUCKET RATE LIMITER
// ============================================================================

/**
 * Token Bucket Rate Limiter
 * 
 * Implements the token bucket algorithm for rate limiting.
 * Tokens are added at a constant rate up to a maximum capacity.
 * Each request consumes one token.
 */
export class TokenBucketRateLimiter {
    private tokens: number;
    private capacity: number;
    private fillRate: number;
    private fillInterval: number;
    private lastFill: number;
    private waitQueue: Array<{
        resolve: () => void;
        reject: (error: Error) => void;
        timestamp: number;
    }> = [];
    private fillTimer: ReturnType<typeof setInterval> | null = null;

    constructor(config: RateLimiterConfig) {
        this.capacity = config.capacity;
        this.tokens = config.capacity;
        this.fillRate = config.fillRate;
        this.fillInterval = config.fillInterval;
        this.lastFill = Date.now();

        this.startFilling();
    }

    /**
     * Start the token filling process
     */
    private startFilling(): void {
        this.fillTimer = setInterval(() => {
            this.fill();
            this.processQueue();
        }, this.fillInterval);
    }

    /**
     * Stop the rate limiter
     */
    stop(): void {
        if (this.fillTimer) {
            clearInterval(this.fillTimer);
            this.fillTimer = null;
        }
        // Reject all waiting requests
        while (this.waitQueue.length > 0) {
            const item = this.waitQueue.shift()!;
            item.reject(new Error('Rate limiter stopped'));
        }
    }

    /**
     * Fill tokens based on elapsed time
     */
    private fill(): void {
        const now = Date.now();
        const elapsed = now - this.lastFill;
        const tokensToAdd = Math.floor((elapsed / this.fillInterval) * this.fillRate);

        if (tokensToAdd > 0) {
            this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
            this.lastFill = now;
        }
    }

    /**
     * Process the wait queue
     */
    private processQueue(): void {
        while (this.waitQueue.length > 0 && this.tokens > 0) {
            const item = this.waitQueue.shift()!;
            this.tokens--;
            item.resolve();
        }
    }

    /**
     * Acquire a token (blocking if none available)
     */
    async acquire(timeout?: number): Promise<boolean> {
        // Try to get a token immediately
        if (this.tokens > 0) {
            this.tokens--;
            return true;
        }

        // Wait for a token
        return new Promise((resolve, reject) => {
            const item = {
                resolve: () => resolve(true),
                reject,
                timestamp: Date.now(),
            };

            this.waitQueue.push(item);

            // Set timeout
            if (timeout) {
                setTimeout(() => {
                    const index = this.waitQueue.indexOf(item);
                    if (index !== -1) {
                        this.waitQueue.splice(index, 1);
                        resolve(false);
                    }
                }, timeout);
            }
        });
    }

    /**
     * Try to acquire a token without waiting
     */
    tryAcquire(): boolean {
        if (this.tokens > 0) {
            this.tokens--;
            return true;
        }
        return false;
    }

    /**
     * Get current token count
     */
    getAvailable(): number {
        return this.tokens;
    }

    /**
     * Get rate limit info
     */
    getInfo(): RateLimitInfo {
        return {
            remaining: this.tokens,
            total: this.capacity,
            resetAt: this.lastFill + this.fillInterval,
        };
    }

    /**
     * Get burst capacity
     */
    getBurstCapacity(): number {
        return this.tokens;
    }
}

// ============================================================================
// CONNECTION POOL
// ============================================================================

/**
 * Generic connection pool
 */
export class ConnectionPool<T> {
    private available: T[] = [];
    private inUse: Set<T> = new Set();
    private waitQueue: Array<{
        resolve: (conn: T) => void;
        reject: (error: Error) => void;
        timestamp: number;
    }> = [];
    private config: PoolConfig;
    private factory: () => Promise<T>;
    private destroyer: (conn: T) => Promise<void>;
    private validator: (conn: T) => Promise<boolean>;
    private lastUsed: Map<T, number> = new Map();
    private idleCheckTimer: ReturnType<typeof setInterval> | null = null;

    constructor(
        config: PoolConfig,
        factory: () => Promise<T>,
        destroyer: (conn: T) => Promise<void> = async () => { },
        validator: (conn: T) => Promise<boolean> = async () => true
    ) {
        this.config = config;
        this.factory = factory;
        this.destroyer = destroyer;
        this.validator = validator;

        // Start idle connection cleanup
        this.startIdleCheck();
    }

    /**
     * Initialize pool with minimum connections
     */
    async initialize(): Promise<void> {
        const promises: Promise<void>[] = [];
        for (let i = 0; i < this.config.minSize; i++) {
            promises.push(
                this.factory().then(conn => {
                    this.available.push(conn);
                    this.lastUsed.set(conn, Date.now());
                })
            );
        }
        await Promise.all(promises);
    }

    /**
     * Start idle connection cleanup
     */
    private startIdleCheck(): void {
        this.idleCheckTimer = setInterval(async () => {
            await this.cleanupIdle();
        }, this.config.idleTimeout / 2);
    }

    /**
     * Stop the pool
     */
    async stop(): Promise<void> {
        if (this.idleCheckTimer) {
            clearInterval(this.idleCheckTimer);
            this.idleCheckTimer = null;
        }

        // Reject waiting requests
        while (this.waitQueue.length > 0) {
            const item = this.waitQueue.shift()!;
            item.reject(new Error('Connection pool stopped'));
        }

        // Close all connections
        for (const conn of this.available) {
            await this.destroyer(conn);
        }
        for (const conn of this.inUse) {
            await this.destroyer(conn);
        }

        this.available = [];
        this.inUse.clear();
        this.lastUsed.clear();
    }

    /**
     * Acquire a connection
     */
    async acquire(): Promise<T> {
        // Try to get an available connection
        while (this.available.length > 0) {
            const conn = this.available.pop()!;

            // Validate connection
            if (await this.validator(conn)) {
                this.inUse.add(conn);
                this.lastUsed.set(conn, Date.now());
                return conn;
            } else {
                // Connection is invalid, destroy it
                await this.destroyer(conn);
                this.lastUsed.delete(conn);
            }
        }

        // Create new connection if possible
        const totalSize = this.available.length + this.inUse.size;
        if (totalSize < this.config.maxSize) {
            const conn = await this.factory();
            this.inUse.add(conn);
            this.lastUsed.set(conn, Date.now());
            return conn;
        }

        // Wait for a connection
        return new Promise((resolve, reject) => {
            const item = {
                resolve,
                reject,
                timestamp: Date.now(),
            };

            this.waitQueue.push(item);

            // Set timeout
            setTimeout(() => {
                const index = this.waitQueue.indexOf(item);
                if (index !== -1) {
                    this.waitQueue.splice(index, 1);
                    reject(new Error('Connection acquire timeout'));
                }
            }, this.config.acquireTimeout);
        });
    }

    /**
     * Release a connection back to the pool
     */
    async release(conn: T): Promise<void> {
        this.inUse.delete(conn);
        this.lastUsed.set(conn, Date.now());

        // If there are waiting requests, give them this connection
        if (this.waitQueue.length > 0) {
            const item = this.waitQueue.shift()!;
            this.inUse.add(conn);
            item.resolve(conn);
            return;
        }

        // Otherwise, add to available pool
        this.available.push(conn);
    }

    /**
     * Cleanup idle connections
     */
    private async cleanupIdle(): Promise<void> {
        const now = Date.now();
        const toRemove: T[] = [];

        // Check available connections for idle timeout
        for (const conn of this.available) {
            const lastUsedTime = this.lastUsed.get(conn) || 0;
            if (now - lastUsedTime > this.config.idleTimeout) {
                // Keep minimum connections
                if (this.available.length - toRemove.length > this.config.minSize) {
                    toRemove.push(conn);
                }
            }
        }

        // Remove idle connections
        for (const conn of toRemove) {
            const index = this.available.indexOf(conn);
            if (index !== -1) {
                this.available.splice(index, 1);
                await this.destroyer(conn);
                this.lastUsed.delete(conn);
            }
        }
    }

    /**
     * Get pool stats
     */
    getStats(): {
        available: number;
        inUse: number;
        waiting: number;
        total: number;
    } {
        return {
            available: this.available.length,
            inUse: this.inUse.size,
            waiting: this.waitQueue.length,
            total: this.available.length + this.inUse.size,
        };
    }
}

// ============================================================================
// PER-USER RATE LIMITER
// ============================================================================

/**
 * Per-user sliding window rate limiter
 */
export class PerUserRateLimiter {
    private requests: Map<string, number[]> = new Map();
    private windowMs: number;
    private maxRequests: number;
    private cleanupInterval: ReturnType<typeof setInterval> | null = null;

    constructor(maxRequests: number, windowMs: number = 60000) {
        this.maxRequests = maxRequests;
        this.windowMs = windowMs;

        // Cleanup old entries periodically
        this.cleanupInterval = setInterval(() => {
            this.cleanup();
        }, windowMs);
    }

    /**
     * Stop the rate limiter
     */
    stop(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        this.requests.clear();
    }

    /**
     * Check if user is rate limited
     */
    isLimited(userId: string): boolean {
        const now = Date.now();
        const userRequests = this.requests.get(userId) || [];

        // Filter to recent requests
        const recentRequests = userRequests.filter(t => now - t < this.windowMs);

        return recentRequests.length >= this.maxRequests;
    }

    /**
     * Record a request for a user
     */
    recordRequest(userId: string): boolean {
        if (this.isLimited(userId)) {
            return false;
        }

        const now = Date.now();
        const userRequests = this.requests.get(userId) || [];
        userRequests.push(now);
        this.requests.set(userId, userRequests);

        return true;
    }

    /**
     * Get remaining requests for a user
     */
    getRemaining(userId: string): number {
        const now = Date.now();
        const userRequests = this.requests.get(userId) || [];
        const recentRequests = userRequests.filter(t => now - t < this.windowMs);

        return Math.max(0, this.maxRequests - recentRequests.length);
    }

    /**
     * Get reset time for a user
     */
    getResetTime(userId: string): number {
        const userRequests = this.requests.get(userId) || [];
        if (userRequests.length === 0) {
            return Date.now();
        }

        const oldest = Math.min(...userRequests);
        return oldest + this.windowMs;
    }

    /**
     * Cleanup old entries
     */
    private cleanup(): void {
        const now = Date.now();

        for (const [userId, requests] of this.requests.entries()) {
            const recentRequests = requests.filter(t => now - t < this.windowMs);

            if (recentRequests.length === 0) {
                this.requests.delete(userId);
            } else {
                this.requests.set(userId, recentRequests);
            }
        }
    }
}

// ============================================================================
// CONCURRENCY MANAGER
// ============================================================================

/**
 * Concurrency Manager
 * 
 * Combines rate limiting, connection pooling, and request queuing.
 */
export class ConcurrencyManager {
    private config: ConcurrencyConfig;
    private rateLimiter: TokenBucketRateLimiter;
    private perUserLimiter: PerUserRateLimiter;
    private consecutiveFailures: number = 0;

    constructor(config?: Partial<ConcurrencyConfig>) {
        this.config = { ...DEFAULT_CONFIG, ...config };

        this.rateLimiter = new TokenBucketRateLimiter(this.config.rateLimiter);
        this.perUserLimiter = new PerUserRateLimiter(
            this.config.perUserLimit.requestsPerMinute
        );
    }

    /**
     * Stop the manager
     */
    stop(): void {
        this.rateLimiter.stop();
        this.perUserLimiter.stop();
    }

    /**
     * Execute a request with rate limiting
     */
    async execute<T>(
        fn: () => Promise<T>,
        options?: {
            userId?: string;
            timeout?: number;
        }
    ): Promise<T> {
        // Check per-user rate limit
        if (options?.userId && !this.perUserLimiter.recordRequest(options.userId)) {
            throw new Error('User rate limit exceeded');
        }

        // Acquire token from rate limiter
        const acquired = await this.rateLimiter.acquire(options?.timeout);
        if (!acquired) {
            throw new Error('Global rate limit exceeded');
        }

        try {
            const result = await fn();
            this.recordSuccess();
            return result;
        } catch (error) {
            this.recordFailure();
            throw error;
        }
    }

    /**
     * Handle burst of requests
     */
    async handleBurst<T>(
        requests: Array<() => Promise<T>>,
        options?: {
            userId?: string;
            concurrency?: number;
        }
    ): Promise<Array<PromiseSettledResult<T>>> {
        const concurrency = options?.concurrency || this.config.rateLimiter.fillRate;
        const batches: Array<Array<() => Promise<T>>> = [];

        // Split into batches
        for (let i = 0; i < requests.length; i += concurrency) {
            batches.push(requests.slice(i, i + concurrency));
        }

        const results: Array<PromiseSettledResult<T>> = [];

        for (const batch of batches) {
            const batchResults = await Promise.allSettled(
                batch.map(fn => this.execute(fn, options))
            );
            results.push(...batchResults);

            // Check if we should backoff
            if (this.shouldBackoff(batchResults)) {
                await this.sleep(this.calculateBackoff());
            }
        }

        return results;
    }

    /**
     * Record successful request
     */
    private recordSuccess(): void {
        this.consecutiveFailures = 0;
    }

    /**
     * Record failed request
     */
    private recordFailure(): void {
        this.consecutiveFailures++;
    }

    /**
     * Check if we should backoff
     */
    private shouldBackoff<T>(results: Array<PromiseSettledResult<T>>): boolean {
        const failures = results.filter(r => r.status === 'rejected').length;
        return failures > results.length * 0.5; // More than 50% failures
    }

    /**
     * Calculate backoff delay
     */
    calculateBackoff(): number {
        const { baseDelay, maxDelay, multiplier } = this.config.adaptiveBackoff;
        const delay = baseDelay * Math.pow(multiplier, this.consecutiveFailures);
        return Math.min(delay, maxDelay);
    }

    /**
     * Get rate limit info
     */
    getRateLimitInfo(userId?: string): {
        global: RateLimitInfo;
        user?: {
            remaining: number;
            resetAt: number;
        };
    } {
        const result: ReturnType<typeof this.getRateLimitInfo> = {
            global: this.rateLimiter.getInfo(),
        };

        if (userId) {
            result.user = {
                remaining: this.perUserLimiter.getRemaining(userId),
                resetAt: this.perUserLimiter.getResetTime(userId),
            };
        }

        return result;
    }

    /**
     * Sleep helper
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create concurrency manager
 */
export function createConcurrencyManager(
    config?: Partial<ConcurrencyConfig>
): ConcurrencyManager {
    return new ConcurrencyManager(config);
}

// Singleton instance
let concurrencyManagerInstance: ConcurrencyManager | null = null;

/**
 * Get singleton instance
 */
export function getConcurrencyManager(): ConcurrencyManager {
    if (!concurrencyManagerInstance) {
        concurrencyManagerInstance = new ConcurrencyManager();
    }
    return concurrencyManagerInstance;
}

export default ConcurrencyManager;
