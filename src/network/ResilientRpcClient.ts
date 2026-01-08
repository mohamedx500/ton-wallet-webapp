/**
 * Resilient RPC Client
 * 
 * Production-grade RPC client with:
 * - Multiple endpoint support with automatic failover
 * - Circuit breaker pattern to prevent cascading failures
 * - Health checking with latency-based load balancing
 * - Request timeout and retry with exponential backoff
 * - Metrics collection
 * 
 * @version 1.0.0
 */

import { TonClient } from '@ton/ton';
import { Address } from '@ton/core';
import type { NetworkType } from '../types';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

/**
 * Endpoint health status
 */
export interface EndpointHealth {
    url: string;
    healthy: boolean;
    latency: number;
    failureCount: number;
    successCount: number;
    lastCheck: number;
    lastError?: string;
    circuitOpen: boolean;
}

/**
 * Circuit breaker state
 */
type CircuitState = 'closed' | 'open' | 'half-open';

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
    failureThreshold: number;
    successThreshold: number;
    openTimeout: number;
    halfOpenMaxAttempts: number;
}

/**
 * RPC client configuration
 */
export interface ResilientRpcConfig {
    network: NetworkType;
    endpoints: string[];
    apiKeys?: Record<string, string>; // endpoint URL -> API key
    timeout: number;
    maxRetries: number;
    retryBaseDelay: number;
    healthCheckInterval: number;
    circuitBreaker: CircuitBreakerConfig;
}

/**
 * Request options
 */
export interface RequestOptions {
    timeout?: number;
    maxRetries?: number;
    priority?: 'high' | 'normal' | 'low';
}

/**
 * RPC metrics
 */
export interface RpcMetrics {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    averageLatency: number;
    endpointStats: Record<string, {
        requests: number;
        failures: number;
        latency: number;
    }>;
}

// ============================================================================
// DEFAULT CONFIGURATION
// ============================================================================

const DEFAULT_ENDPOINTS: Record<NetworkType, string[]> = {
    mainnet: [
        'https://toncenter.com/api/v2/jsonRPC',
        'https://ton-mainnet.core.chainstack.com',
    ],
    testnet: [
        'https://testnet.toncenter.com/api/v2/jsonRPC',
        'https://ton-testnet.core.chainstack.com',
    ],
};

const DEFAULT_CONFIG: ResilientRpcConfig = {
    network: 'mainnet',
    endpoints: DEFAULT_ENDPOINTS.mainnet,
    timeout: 30000,
    maxRetries: 3,
    retryBaseDelay: 1000,
    healthCheckInterval: 30000,
    circuitBreaker: {
        failureThreshold: 5,
        successThreshold: 2,
        openTimeout: 30000,
        halfOpenMaxAttempts: 3,
    },
};

// ============================================================================
// CIRCUIT BREAKER
// ============================================================================

/**
 * Circuit Breaker implementation
 */
class CircuitBreaker {
    private state: CircuitState = 'closed';
    private failureCount: number = 0;
    private successCount: number = 0;
    private lastFailureTime: number = 0;
    private halfOpenAttempts: number = 0;
    private config: CircuitBreakerConfig;

    constructor(config: CircuitBreakerConfig) {
        this.config = config;
    }

    /**
     * Check if circuit is open
     */
    isOpen(): boolean {
        if (this.state === 'open') {
            // Check if we should transition to half-open
            if (Date.now() - this.lastFailureTime >= this.config.openTimeout) {
                this.state = 'half-open';
                this.halfOpenAttempts = 0;
                return false;
            }
            return true;
        }
        return false;
    }

    /**
     * Record a successful request
     */
    recordSuccess(): void {
        if (this.state === 'half-open') {
            this.successCount++;
            if (this.successCount >= this.config.successThreshold) {
                this.close();
            }
        } else {
            this.failureCount = 0;
        }
    }

    /**
     * Record a failed request
     */
    recordFailure(): void {
        this.failureCount++;
        this.lastFailureTime = Date.now();

        if (this.state === 'half-open') {
            this.halfOpenAttempts++;
            if (this.halfOpenAttempts >= this.config.halfOpenMaxAttempts) {
                this.open();
            }
        } else if (this.failureCount >= this.config.failureThreshold) {
            this.open();
        }
    }

    /**
     * Open the circuit
     */
    private open(): void {
        this.state = 'open';
        console.log('[CircuitBreaker] Circuit opened');
    }

    /**
     * Close the circuit
     */
    private close(): void {
        this.state = 'closed';
        this.failureCount = 0;
        this.successCount = 0;
        this.halfOpenAttempts = 0;
        console.log('[CircuitBreaker] Circuit closed');
    }

    /**
     * Get current state
     */
    getState(): CircuitState {
        return this.state;
    }
}

// ============================================================================
// LOAD BALANCER
// ============================================================================

/**
 * Load balancer with weighted round-robin based on latency
 */
class LoadBalancer {
    private endpoints: EndpointHealth[] = [];
    private currentIndex: number = 0;

    constructor(urls: string[]) {
        this.endpoints = urls.map(url => ({
            url,
            healthy: true,
            latency: 0,
            failureCount: 0,
            successCount: 0,
            lastCheck: 0,
            circuitOpen: false,
        }));
    }

    /**
     * Get the best endpoint
     */
    getEndpoint(): EndpointHealth | null {
        // Filter healthy endpoints with closed circuits
        const available = this.endpoints.filter(e =>
            e.healthy && !e.circuitOpen
        );

        if (available.length === 0) {
            // If no healthy endpoints, try any with closed circuit
            const notOpen = this.endpoints.filter(e => !e.circuitOpen);
            if (notOpen.length > 0) {
                return notOpen[0];
            }
            return null;
        }

        // Sort by latency (lowest first)
        available.sort((a, b) => {
            // New endpoints (latency 0) get priority
            if (a.latency === 0) return -1;
            if (b.latency === 0) return 1;
            return a.latency - b.latency;
        });

        // Weighted selection: 70% chance to pick the fastest, 
        // 30% chance to pick randomly (to prevent starvation)
        if (Math.random() < 0.7) {
            return available[0];
        }
        return available[Math.floor(Math.random() * available.length)];
    }

    /**
     * Update endpoint status
     */
    updateEndpoint(url: string, update: Partial<EndpointHealth>): void {
        const endpoint = this.endpoints.find(e => e.url === url);
        if (endpoint) {
            Object.assign(endpoint, update);
        }
    }

    /**
     * Get all endpoints
     */
    getAllEndpoints(): EndpointHealth[] {
        return [...this.endpoints];
    }

    /**
     * Mark endpoint as healthy
     */
    markHealthy(url: string, latency: number): void {
        this.updateEndpoint(url, {
            healthy: true,
            latency,
            failureCount: 0,
            lastCheck: Date.now(),
        });
    }

    /**
     * Mark endpoint as unhealthy
     */
    markUnhealthy(url: string, error: string): void {
        const endpoint = this.endpoints.find(e => e.url === url);
        if (endpoint) {
            endpoint.failureCount++;
            endpoint.lastError = error;
            endpoint.lastCheck = Date.now();
            if (endpoint.failureCount >= 3) {
                endpoint.healthy = false;
            }
        }
    }
}

// ============================================================================
// RESILIENT RPC CLIENT
// ============================================================================

/**
 * Resilient RPC Client
 */
export class ResilientRpcClient {
    private config: ResilientRpcConfig;
    private loadBalancer: LoadBalancer;
    private circuitBreakers: Map<string, CircuitBreaker>;
    private clients: Map<string, TonClient>;
    private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
    private metrics: RpcMetrics;

    constructor(config?: Partial<ResilientRpcConfig>) {
        this.config = { ...DEFAULT_CONFIG, ...config };

        // Use network-specific endpoints if none provided
        if (!config?.endpoints) {
            this.config.endpoints = DEFAULT_ENDPOINTS[this.config.network];
        }

        this.loadBalancer = new LoadBalancer(this.config.endpoints);
        this.circuitBreakers = new Map();
        this.clients = new Map();

        // Initialize circuit breakers
        this.config.endpoints.forEach(url => {
            this.circuitBreakers.set(url, new CircuitBreaker(this.config.circuitBreaker));
        });

        // Initialize metrics
        this.metrics = {
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            averageLatency: 0,
            endpointStats: {},
        };

        // Start health checking
        this.startHealthChecking();
    }

    /**
     * Get TonClient for an endpoint
     */
    private getClient(endpoint: EndpointHealth): TonClient {
        if (!this.clients.has(endpoint.url)) {
            const apiKey = this.config.apiKeys?.[endpoint.url];
            this.clients.set(endpoint.url, new TonClient({
                endpoint: endpoint.url,
                apiKey,
                timeout: this.config.timeout,
            }));
        }
        return this.clients.get(endpoint.url)!;
    }

    /**
     * Execute a request with failover
     */
    async request<T>(
        method: (client: TonClient) => Promise<T>,
        options?: RequestOptions
    ): Promise<T> {
        const maxRetries = options?.maxRetries ?? this.config.maxRetries;
        const timeout = options?.timeout ?? this.config.timeout;
        let lastError: Error | null = null;

        this.metrics.totalRequests++;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            // Get best endpoint
            const endpoint = this.loadBalancer.getEndpoint();
            if (!endpoint) {
                throw new Error('No available endpoints');
            }

            // Check circuit breaker
            const breaker = this.circuitBreakers.get(endpoint.url);
            if (breaker?.isOpen()) {
                this.loadBalancer.updateEndpoint(endpoint.url, { circuitOpen: true });
                continue;
            }

            try {
                const client = this.getClient(endpoint);
                const startTime = Date.now();

                // Execute with timeout
                const result = await Promise.race([
                    method(client),
                    this.timeoutPromise<T>(timeout),
                ]);

                const latency = Date.now() - startTime;

                // Record success
                breaker?.recordSuccess();
                this.loadBalancer.markHealthy(endpoint.url, latency);
                this.updateMetrics(endpoint.url, true, latency);

                this.metrics.successfulRequests++;
                return result;

            } catch (error) {
                lastError = error instanceof Error ? error : new Error('Unknown error');
                console.warn(`[ResilientRPC] Attempt ${attempt + 1} failed on ${endpoint.url}:`, lastError.message);

                // Record failure
                const breaker = this.circuitBreakers.get(endpoint.url);
                breaker?.recordFailure();
                this.loadBalancer.markUnhealthy(endpoint.url, lastError.message);
                this.updateMetrics(endpoint.url, false, 0);

                // Check if circuit should open
                if (breaker?.isOpen()) {
                    this.loadBalancer.updateEndpoint(endpoint.url, { circuitOpen: true });
                }

                // Exponential backoff before retry
                if (attempt < maxRetries - 1) {
                    const delay = this.config.retryBaseDelay * Math.pow(2, attempt);
                    await this.sleep(delay);
                }
            }
        }

        this.metrics.failedRequests++;
        throw lastError || new Error('All retry attempts failed');
    }

    /**
     * Get balance with failover
     */
    async getBalance(address: string): Promise<bigint> {
        return this.request(async (client) => {
            const addr = Address.parse(address);
            return client.getBalance(addr);
        });
    }

    /**
     * Check if account is deployed
     */
    async isDeployed(address: string): Promise<boolean> {
        try {
            const balance = await this.getBalance(address);
            return balance > 0n;
        } catch {
            return false;
        }
    }

    /**
     * Get seqno with failover
     */
    async getSeqno(address: string): Promise<number> {
        return this.request(async (client) => {
            const addr = Address.parse(address);
            const contract = await client.open(
                await import('@ton/ton').then(m => m.WalletContractV4.create({
                    workchain: 0,
                    publicKey: Buffer.alloc(32) // Dummy, will be replaced by actual call
                }))
            );
            // This is a simplified version - actual implementation should
            // use the specific wallet contract
            return 0;
        });
    }

    /**
     * Get a TonClient for direct access
     */
    async getActiveClient(): Promise<TonClient> {
        const endpoint = this.loadBalancer.getEndpoint();
        if (!endpoint) {
            throw new Error('No available endpoints');
        }
        return this.getClient(endpoint);
    }

    /**
     * Start health checking
     */
    private startHealthChecking(): void {
        if (this.healthCheckTimer) return;

        this.healthCheckTimer = setInterval(
            () => this.performHealthChecks(),
            this.config.healthCheckInterval
        );

        // Initial health check
        this.performHealthChecks();
    }

    /**
     * Stop health checking
     */
    stopHealthChecking(): void {
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
            this.healthCheckTimer = null;
        }
    }

    /**
     * Perform health checks on all endpoints
     */
    private async performHealthChecks(): Promise<void> {
        const endpoints = this.loadBalancer.getAllEndpoints();

        for (const endpoint of endpoints) {
            try {
                const startTime = Date.now();
                const client = this.getClient(endpoint);

                // Simple health check - get masterchain info
                await Promise.race([
                    client.getMasterchainInfo(),
                    this.timeoutPromise(5000),
                ]);

                const latency = Date.now() - startTime;
                this.loadBalancer.markHealthy(endpoint.url, latency);

                // Reset circuit breaker if health check passes
                const breaker = this.circuitBreakers.get(endpoint.url);
                if (breaker?.getState() === 'open') {
                    breaker.recordSuccess();
                }

            } catch (error) {
                const err = error instanceof Error ? error : new Error('Unknown error');
                this.loadBalancer.markUnhealthy(endpoint.url, err.message);
            }
        }
    }

    /**
     * Timeout promise
     */
    private timeoutPromise<T>(ms: number): Promise<T> {
        return new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Request timeout')), ms);
        });
    }

    /**
     * Update metrics
     */
    private updateMetrics(endpoint: string, success: boolean, latency: number): void {
        if (!this.metrics.endpointStats[endpoint]) {
            this.metrics.endpointStats[endpoint] = {
                requests: 0,
                failures: 0,
                latency: 0,
            };
        }

        const stats = this.metrics.endpointStats[endpoint];
        stats.requests++;
        if (!success) stats.failures++;
        if (latency > 0) {
            stats.latency = (stats.latency * (stats.requests - 1) + latency) / stats.requests;
        }

        // Update average latency
        const totalLatency = Object.values(this.metrics.endpointStats)
            .reduce((sum, s) => sum + s.latency, 0);
        const count = Object.keys(this.metrics.endpointStats).length;
        this.metrics.averageLatency = count > 0 ? totalLatency / count : 0;
    }

    /**
     * Get metrics
     */
    getMetrics(): RpcMetrics {
        return { ...this.metrics };
    }

    /**
     * Get endpoint health status
     */
    getEndpointHealth(): EndpointHealth[] {
        return this.loadBalancer.getAllEndpoints();
    }

    /**
     * Sleep helper
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Get current network
     */
    getNetwork(): NetworkType {
        return this.config.network;
    }

    /**
     * Create client for different network
     */
    withNetwork(network: NetworkType): ResilientRpcClient {
        return new ResilientRpcClient({
            ...this.config,
            network,
            endpoints: DEFAULT_ENDPOINTS[network],
        });
    }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create resilient RPC client
 */
export function createResilientRpcClient(
    config?: Partial<ResilientRpcConfig>
): ResilientRpcClient {
    return new ResilientRpcClient(config);
}

// Singleton instances
const instances: Record<NetworkType, ResilientRpcClient | null> = {
    mainnet: null,
    testnet: null,
};

/**
 * Get singleton instance
 */
export function getResilientRpcClient(network: NetworkType = 'mainnet'): ResilientRpcClient {
    if (!instances[network]) {
        instances[network] = new ResilientRpcClient({ network });
    }
    return instances[network]!;
}

export default ResilientRpcClient;
