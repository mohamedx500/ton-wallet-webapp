/**
 * API Request Manager
 * 
 * Provides rate limiting, request queuing, retry logic with circuit breaker,
 * and multi-provider failover for reliable API communication.
 */

/**
 * Configuration for retry behavior
 */
export const RETRY_CONFIG = {
    maxRetries: 5,
    baseDelay: 1000,
    maxDelay: 30000,
    retryableErrors: ['rate', '429', '503', '504', 'timeout', 'econnreset', 'network', 'failed to fetch'],
};

/**
 * Circuit breaker configuration
 */
export const CIRCUIT_CONFIG = {
    failureThreshold: 5,
    resetTimeout: 30000, // 30 seconds
};

/**
 * Request Queue with Rate Limiting
 * Ensures we don't exceed API rate limits
 */
export class RequestQueue {
    constructor(requestsPerSecond = 1) {
        this.queue = [];
        this.processing = false;
        this.interval = 1000 / requestsPerSecond;
        this.lastRequestTime = 0;
    }

    /**
     * Add a request to the queue
     * @param {Function} fn - Async function to execute
     * @returns {Promise} - Resolves when the request completes
     */
    async add(fn) {
        return new Promise((resolve, reject) => {
            this.queue.push({ fn, resolve, reject });
            this.process();
        });
    }

    /**
     * Process the queue
     */
    async process() {
        if (this.processing || this.queue.length === 0) return;

        this.processing = true;

        // Enforce rate limit
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        if (timeSinceLastRequest < this.interval) {
            await this.sleep(this.interval - timeSinceLastRequest);
        }

        const { fn, resolve, reject } = this.queue.shift();

        try {
            this.lastRequestTime = Date.now();
            const result = await fn();
            resolve(result);
        } catch (error) {
            reject(error);
        }

        this.processing = false;

        // Process next item if any
        if (this.queue.length > 0) {
            this.process();
        }
    }

    /**
     * Sleep helper
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Clear the queue
     */
    clear() {
        const pending = this.queue;
        this.queue = [];
        pending.forEach(({ reject }) => reject(new Error('Queue cleared')));
    }
}

/**
 * Circuit Breaker
 * Prevents cascading failures by stopping requests when too many fail
 */
export class CircuitBreaker {
    constructor(config = CIRCUIT_CONFIG) {
        this.failureCount = 0;
        this.isOpen = false;
        this.openedAt = null;
        this.config = config;
    }

    /**
     * Record a successful request
     */
    recordSuccess() {
        this.failureCount = 0;
        this.isOpen = false;
        this.openedAt = null;
    }

    /**
     * Record a failed request
     */
    recordFailure() {
        this.failureCount++;
        if (this.failureCount >= this.config.failureThreshold) {
            this.isOpen = true;
            this.openedAt = Date.now();
            console.warn(`Circuit breaker opened after ${this.failureCount} failures`);
        }
    }

    /**
     * Check if requests are allowed
     */
    canRequest() {
        if (!this.isOpen) return true;

        // Check if enough time has passed to try again
        const timeSinceOpen = Date.now() - this.openedAt;
        if (timeSinceOpen >= this.config.resetTimeout) {
            console.log('Circuit breaker half-open, allowing test request');
            return true; // Half-open state
        }

        return false;
    }

    /**
     * Get circuit state
     */
    getState() {
        if (!this.isOpen) return 'closed';
        if (Date.now() - this.openedAt >= this.config.resetTimeout) return 'half-open';
        return 'open';
    }
}

/**
 * Retry Service
 * Handles retries with exponential backoff and circuit breaker
 */
export class RetryService {
    constructor(config = RETRY_CONFIG) {
        this.config = config;
        this.circuitBreaker = new CircuitBreaker();
    }

    /**
     * Execute function with retry logic
     * @param {Function} fn - Async function to execute
     * @param {Object} options - Override options
     * @returns {Promise} - Result of the function
     */
    async execute(fn, options = {}) {
        const {
            maxRetries = this.config.maxRetries,
            baseDelay = this.config.baseDelay,
            maxDelay = this.config.maxDelay,
            retryableErrors = this.config.retryableErrors,
        } = options;

        // Check circuit breaker
        if (!this.circuitBreaker.canRequest()) {
            throw new Error('Circuit breaker open - service temporarily unavailable');
        }

        let lastError;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const result = await fn();
                this.circuitBreaker.recordSuccess();
                return result;
            } catch (error) {
                lastError = error;
                const errorStr = (error.message || '').toLowerCase();

                // Log the error
                console.warn(`Request failed (attempt ${attempt + 1}/${maxRetries}):`, errorStr);

                // Check if error is retryable
                const isRetryable = retryableErrors.some(e => errorStr.includes(e.toLowerCase()));

                if (!isRetryable) {
                    console.error('Non-retryable error, failing fast:', errorStr);
                    throw error;
                }

                // Don't sleep on the last attempt
                if (attempt < maxRetries - 1) {
                    // Exponential backoff with jitter
                    const delay = Math.min(
                        baseDelay * Math.pow(2, attempt) + Math.random() * 1000,
                        maxDelay
                    );
                    console.log(`Retrying in ${Math.round(delay)}ms...`);
                    await this.sleep(delay);
                }
            }
        }

        // All retries exhausted
        this.circuitBreaker.recordFailure();
        throw lastError;
    }

    /**
     * Sleep helper
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Get circuit breaker state
     */
    getCircuitState() {
        return this.circuitBreaker.getState();
    }
}

/**
 * Multi-Provider Fetch
 * Automatically failover between multiple API endpoints
 */
export class MultiProviderFetch {
    /**
     * @param {Array} providers - Array of { baseUrl, apiKey, name } objects
     */
    constructor(providers) {
        this.providers = providers;
        this.currentIndex = 0;
        this.retryService = new RetryService();
    }

    /**
     * Fetch with automatic failover
     * @param {string} path - API path (appended to base URL)
     * @param {Object} options - Fetch options
     * @returns {Promise<Response>}
     */
    async fetch(path, options = {}) {
        const errors = [];

        // Try each provider
        for (let i = 0; i < this.providers.length; i++) {
            const providerIndex = (this.currentIndex + i) % this.providers.length;
            const provider = this.providers[providerIndex];

            try {
                const result = await this.retryService.execute(async () => {
                    const url = `${provider.baseUrl}${path}`;
                    const headers = {
                        'Content-Type': 'application/json',
                        ...(provider.apiKey && { 'Authorization': `Bearer ${provider.apiKey}` }),
                        ...options.headers,
                    };

                    const controller = new AbortController();
                    const timeout = setTimeout(() => controller.abort(), 30000);

                    try {
                        const response = await fetch(url, {
                            ...options,
                            headers,
                            signal: controller.signal,
                        });

                        if (!response.ok) {
                            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                        }

                        return response;
                    } finally {
                        clearTimeout(timeout);
                    }
                });

                // Success - remember this provider for next request
                this.currentIndex = providerIndex;
                return result;

            } catch (error) {
                console.warn(`Provider ${provider.name || providerIndex} failed:`, error.message);
                errors.push({ provider: provider.name || providerIndex, error: error.message });
            }
        }

        // All providers failed
        throw new Error(`All providers failed: ${JSON.stringify(errors)}`);
    }

    /**
     * Get current provider info
     */
    getCurrentProvider() {
        return this.providers[this.currentIndex];
    }
}

/**
 * Create a preconfigured API client with multiple providers
 */
export function createReliableApiClient(network = 'mainnet') {
    const isTestnet = network === 'testnet';

    // Get API keys from environment
    const tonapiKey = typeof import.meta !== 'undefined'
        ? import.meta.env?.VITE_TONAPI_KEY
        : process?.env?.VITE_TONAPI_KEY;

    const toncenterKey = typeof import.meta !== 'undefined'
        ? import.meta.env?.VITE_TONCENTER_API_KEY
        : process?.env?.VITE_TONCENTER_API_KEY;

    const providers = [
        {
            name: 'TonAPI',
            baseUrl: isTestnet ? 'https://testnet.tonapi.io/v2' : 'https://tonapi.io/v2',
            apiKey: tonapiKey,
        },
    ];

    // Toncenter uses different auth method (query param), so keep separate
    // But we can still use it as fallback

    return new MultiProviderFetch(providers);
}

// Export singleton instances
export const retryService = new RetryService();
export const requestQueue = new RequestQueue(2); // 2 requests per second

export default {
    RequestQueue,
    CircuitBreaker,
    RetryService,
    MultiProviderFetch,
    createReliableApiClient,
    retryService,
    requestQueue,
};
