/**
 * DNS Resolver Service
 *
 * Resolves .ton DNS domains to standard TON wallet addresses (EQ.../UQ...).
 * Smart contracts only accept standard addresses, so all .ton domains
 * must be resolved before constructing transaction payloads.
 *
 * Uses the TON SDK DNS resolution methods and TonAPI as a fallback.
 */

import { TonClient } from '@ton/ton';
import { Address } from '@ton/core';
import type { NetworkType } from '../types';

/** Result of a single DNS resolution attempt */
export interface DnsResolutionResult {
    /** Original input (e.g. "alice.ton") */
    domain: string;
    /** Resolved wallet address, or null if resolution failed */
    address: string | null;
    /** Whether the resolution was successful */
    success: boolean;
    /** Error message if resolution failed */
    error?: string;
}

/** Map of original domain → resolved address */
export type DnsResolutionMap = Record<string, DnsResolutionResult>;

/**
 * DNS Resolver Service for TON .ton domains.
 */
export class DnsResolverService {
    private readonly network: NetworkType;
    private readonly cache: Map<string, DnsResolutionResult>;

    constructor(network: NetworkType = 'mainnet') {
        this.network = network;
        this.cache = new Map();
    }

    /**
     * Get the TonAPI base URL for the current network.
     */
    private getApiBaseUrl(): string {
        return this.network === 'testnet'
            ? 'https://testnet.tonapi.io/v2'
            : 'https://tonapi.io/v2';
    }

    /**
     * Check if a string is a .ton domain.
     */
    static isTonDomain(input: string): boolean {
        return input.trim().toLowerCase().endsWith('.ton');
    }

    /**
     * Check if a string is already a valid TON address (not a domain).
     */
    static isRawAddress(input: string): boolean {
        const trimmed = input.trim();
        if (/^0:[a-fA-F0-9]{64}$/.test(trimmed)) return true;
        if (/^(EQ|UQ|kQ|0Q)[A-Za-z0-9_-]{46}$/.test(trimmed)) return true;
        return false;
    }

    /**
     * Resolve a single .ton domain to a wallet address.
     * Uses TonAPI DNS resolution endpoint.
     */
    async resolveSingle(domain: string): Promise<DnsResolutionResult> {
        const normalized = domain.trim().toLowerCase();

        // Check cache first
        const cached = this.cache.get(normalized);
        if (cached) return cached;

        // Skip if it's already a raw address
        if (DnsResolverService.isRawAddress(normalized)) {
            const result: DnsResolutionResult = {
                domain: normalized,
                address: normalized,
                success: true,
            };
            this.cache.set(normalized, result);
            return result;
        }

        // Must be a .ton domain
        if (!DnsResolverService.isTonDomain(normalized)) {
            const result: DnsResolutionResult = {
                domain: normalized,
                address: null,
                success: false,
                error: 'Not a valid .ton domain or TON address',
            };
            return result;
        }

        try {
            // Use TonAPI to resolve the DNS domain
            const baseUrl = this.getApiBaseUrl();
            const response = await fetch(
                `${baseUrl}/dns/${encodeURIComponent(normalized)}/resolve`,
                {
                    headers: { 'Content-Type': 'application/json' },
                    signal: AbortSignal.timeout(10000),
                }
            );

            if (!response.ok) {
                throw new Error(`DNS resolution failed: HTTP ${response.status}`);
            }

            const data = await response.json();

            // Extract wallet address from DNS records
            // The response contains an array of records; we look for the wallet record
            let walletAddress: string | null = null;

            if (data.wallet) {
                walletAddress = data.wallet.address;
            } else if (data.records) {
                // Fallback: look through records for a wallet entry
                for (const record of data.records) {
                    if (record.type === 'wallet' && record.value) {
                        walletAddress = record.value;
                        break;
                    }
                }
            }

            if (!walletAddress) {
                // Try alternative endpoint
                const altResponse = await fetch(
                    `${baseUrl}/accounts/search?name=${encodeURIComponent(normalized)}`,
                    {
                        headers: { 'Content-Type': 'application/json' },
                        signal: AbortSignal.timeout(10000),
                    }
                );

                if (altResponse.ok) {
                    const altData = await altResponse.json();
                    if (altData.addresses && altData.addresses.length > 0) {
                        walletAddress = altData.addresses[0].address;
                    }
                }
            }

            if (walletAddress) {
                // Normalize the address to user-friendly format
                try {
                    const addr = Address.parse(walletAddress);
                    walletAddress = addr.toString({
                        bounceable: false,
                        testOnly: this.network === 'testnet',
                    });
                } catch {
                    // Keep as-is if parsing fails
                }

                const result: DnsResolutionResult = {
                    domain: normalized,
                    address: walletAddress,
                    success: true,
                };
                this.cache.set(normalized, result);
                return result;
            }

            const result: DnsResolutionResult = {
                domain: normalized,
                address: null,
                success: false,
                error: `Domain "${normalized}" has no associated wallet`,
            };
            return result;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown DNS resolution error';
            const result: DnsResolutionResult = {
                domain: normalized,
                address: null,
                success: false,
                error: errorMessage,
            };
            return result;
        }
    }

    /**
     * Resolve an array of addresses/domains in parallel.
     * Only .ton domains are resolved; raw addresses are passed through.
     * Returns a map of original input → resolution result.
     */
    async resolveAll(addresses: string[]): Promise<DnsResolutionMap> {
        const results: DnsResolutionMap = {};

        // Split into domains and raw addresses
        const resolutionPromises = addresses.map(async (addr) => {
            const trimmed = addr.trim();

            if (DnsResolverService.isRawAddress(trimmed)) {
                // Already a valid address, no resolution needed
                results[trimmed] = {
                    domain: trimmed,
                    address: trimmed,
                    success: true,
                };
            } else if (DnsResolverService.isTonDomain(trimmed)) {
                // Resolve the domain
                const result = await this.resolveSingle(trimmed);
                results[trimmed] = result;
            } else if (trimmed.length > 0) {
                // Invalid format
                results[trimmed] = {
                    domain: trimmed,
                    address: null,
                    success: false,
                    error: 'Invalid address format',
                };
            }
        });

        await Promise.allSettled(resolutionPromises);
        return results;
    }

    /**
     * Clear the resolution cache.
     */
    clearCache(): void {
        this.cache.clear();
    }
}

export default DnsResolverService;
