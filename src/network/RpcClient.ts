/**
 * TON RPC Client
 * 
 * Provides a unified interface to TON RPC providers.
 * Supports Toncenter and Chainstack endpoints.
 */

import { TonClient } from '@ton/ton';
import type { RpcProviderConfig, NetworkType } from '../types';
import { DEFAULT_CONFIG } from '../types';

/**
 * Default RPC endpoints
 */
export const RPC_ENDPOINTS = {
    toncenter: {
        mainnet: 'https://toncenter.com/api/v2/jsonRPC',
        testnet: 'https://testnet.toncenter.com/api/v2/jsonRPC',
    },
    chainstack: {
        mainnet: 'https://ton-mainnet.core.chainstack.com',
        testnet: 'https://ton-testnet.core.chainstack.com',
    },
};

/**
 * RPC Provider type
 */
export type RpcProvider = 'toncenter' | 'chainstack';

/**
 * RPC Client configuration
 */
export interface RpcClientConfig {
    network: NetworkType;
    provider?: RpcProvider;
    apiKey?: string;
    timeout?: number;
    retryCount?: number;
    retryDelay?: number;
}

/**
 * TON RPC Client
 */
export class RpcClient {
    private readonly network: NetworkType;
    private readonly provider: RpcProvider;
    private readonly apiKey?: string;
    private readonly timeout: number;
    private readonly retryCount: number;
    private readonly retryDelay: number;
    private client: TonClient | null = null;

    constructor(config: RpcClientConfig) {
        this.network = config.network;
        this.provider = config.provider ?? 'toncenter';
        this.apiKey = config.apiKey;
        this.timeout = config.timeout ?? DEFAULT_CONFIG.API_TIMEOUT;
        this.retryCount = config.retryCount ?? DEFAULT_CONFIG.RETRY_COUNT;
        this.retryDelay = config.retryDelay ?? DEFAULT_CONFIG.RETRY_DELAY;
    }

    /**
     * Get endpoint URL
     */
    private getEndpoint(): string {
        const endpoints = RPC_ENDPOINTS[this.provider];
        return endpoints[this.network];
    }

    /**
     * Get TonClient instance
     */
    getClient(): TonClient {
        if (!this.client) {
            this.client = new TonClient({
                endpoint: this.getEndpoint(),
                apiKey: this.apiKey,
                timeout: this.timeout,
            });
        }
        return this.client;
    }

    /**
     * Execute with retry
     */
    async withRetry<T>(fn: () => Promise<T>): Promise<T> {
        let lastError: Error | null = null;

        for (let i = 0; i < this.retryCount; i++) {
            try {
                return await fn();
            } catch (error) {
                lastError = error instanceof Error ? error : new Error('Unknown error');
                const errorStr = lastError.message.toLowerCase();

                // Check for rate limiting
                if (errorStr.includes('429') || errorStr.includes('rate') || errorStr.includes('too many')) {
                    const delay = this.retryDelay * Math.pow(2, i);
                    console.log(`Rate limited, retrying in ${delay}ms... (attempt ${i + 1}/${this.retryCount})`);
                    await this.sleep(delay);
                } else {
                    // For other errors, throw immediately
                    throw lastError;
                }
            }
        }

        throw lastError || new Error('All retries failed');
    }

    /**
     * Sleep helper
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Get balance
     */
    async getBalance(address: string): Promise<bigint> {
        return this.withRetry(async () => {
            const client = this.getClient();
            const addr = await import('@ton/core').then(m => m.Address.parse(address));
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
     * Get current network
     */
    getNetwork(): NetworkType {
        return this.network;
    }

    /**
     * Check if testnet
     */
    isTestnet(): boolean {
        return this.network === 'testnet';
    }

    /**
     * Create a new client with different network
     */
    withNetwork(network: NetworkType): RpcClient {
        return new RpcClient({
            network,
            provider: this.provider,
            apiKey: this.apiKey,
            timeout: this.timeout,
            retryCount: this.retryCount,
            retryDelay: this.retryDelay,
        });
    }

    /**
     * Create a new client with different provider
     */
    withProvider(provider: RpcProvider): RpcClient {
        return new RpcClient({
            network: this.network,
            provider,
            apiKey: this.apiKey,
            timeout: this.timeout,
            retryCount: this.retryCount,
            retryDelay: this.retryDelay,
        });
    }
}

/**
 * Create default RPC client
 */
export function createRpcClient(network: NetworkType = 'mainnet', apiKey?: string): RpcClient {
    return new RpcClient({
        network,
        apiKey,
    });
}

export default RpcClient;
