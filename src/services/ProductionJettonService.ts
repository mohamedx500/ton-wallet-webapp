/**
 * Production Jetton Service
 * 
 * Enhanced Jetton service with:
 * - Pre-transfer validation
 * - Balance verification
 * - Jetton wallet existence verification
 * - Transfer confirmation tracking
 * - Metadata caching
 * 
 * @version 1.0.0
 */

import { Address, beginCell, toNano, Cell } from '@ton/core';
import { TonClient } from '@ton/ton';
import type { NetworkType } from '../types';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

/**
 * Jetton metadata
 */
export interface JettonMetadata {
    address: string;
    name: string;
    symbol: string;
    decimals: number;
    image?: string;
    description?: string;
    totalSupply?: string;
    fetchedAt: number;
}

/**
 * Jetton wallet info
 */
export interface JettonWalletInfo {
    address: string;
    ownerAddress: string;
    jettonAddress: string;
    balance: string;
    isDeployed: boolean;
}

/**
 * Transfer parameters
 */
export interface JettonTransferParams {
    senderAddress: string;
    recipientAddress: string;
    jettonAddress: string;
    amount: bigint;
    comment?: string;
    forwardTonAmount?: bigint;
}

/**
 * Transfer result
 */
export interface JettonTransferResult {
    success: boolean;
    hash?: string;
    queryId?: bigint;
    error?: string;
    details?: {
        senderJettonWallet: string;
        recipientJettonWallet?: string;
        gasUsed?: string;
    };
}

/**
 * Validation result
 */
export interface ValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
}

// ============================================================================
// CONSTANTS
// ============================================================================

const JETTON_OP_CODES = {
    TRANSFER: 0xf8a7ea5,
    TRANSFER_NOTIFICATION: 0x7362d09c,
    INTERNAL_TRANSFER: 0x178d4519,
    BURN: 0x595f07bc,
};

const DEFAULT_FORWARD_TON_AMOUNT = toNano('0.05');
const DEFAULT_GAS_AMOUNT = toNano('0.1');
const METADATA_CACHE_TTL = 3600000; // 1 hour
const TRANSFER_CONFIRMATION_TIMEOUT = 60000; // 60 seconds

// Common Jetton addresses
const KNOWN_JETTONS: Record<string, Partial<JettonMetadata>> = {
    'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs': {
        name: 'Tether USD',
        symbol: 'USDT',
        decimals: 6,
    },
    'EQDQoc5M3Bh8eWFephi9bClhevelbZZvWhkqdo80XuY_0qXv': {
        name: 'Notcoin',
        symbol: 'NOT',
        decimals: 9,
    },
    'EQBlqsm144Dq6SjbPI4jjZvA1hqTIP3CvHovbIfW_t-SCALE': {
        name: 'SCALE',
        symbol: 'SCALE',
        decimals: 9,
    },
    'EQA2kCVNwVsil2EM2mB0SkXytxCqWFnCYIQFq11TlJQr_Fvh': {
        name: 'DOGS',
        symbol: 'DOGS',
        decimals: 9,
    },
};

// ============================================================================
// PRODUCTION JETTON SERVICE
// ============================================================================

/**
 * Production Jetton Service
 */
export class ProductionJettonService {
    private network: NetworkType;
    private metadataCache: Map<string, JettonMetadata> = new Map();
    private walletCache: Map<string, JettonWalletInfo> = new Map();
    private walletCacheTTL: number = 30000; // 30 seconds

    constructor(network: NetworkType = 'mainnet') {
        this.network = network;
    }

    // ========================================================================
    // VALIDATION
    // ========================================================================

    /**
     * Validate transfer parameters before execution
     */
    async validateTransfer(
        client: TonClient,
        params: JettonTransferParams
    ): Promise<ValidationResult> {
        const errors: string[] = [];
        const warnings: string[] = [];

        try {
            // 1. Validate addresses
            try {
                Address.parse(params.senderAddress);
            } catch {
                errors.push('Invalid sender address format');
            }

            try {
                Address.parse(params.recipientAddress);
            } catch {
                errors.push('Invalid recipient address format');
            }

            try {
                Address.parse(params.jettonAddress);
            } catch {
                errors.push('Invalid jetton address format');
            }

            if (errors.length > 0) {
                return { valid: false, errors, warnings };
            }

            // 2. Check jetton master exists
            const metadata = await this.getJettonMetadata(params.jettonAddress);
            if (!metadata) {
                errors.push('Jetton contract not found or inaccessible');
                return { valid: false, errors, warnings };
            }

            // 3. Get sender's jetton wallet
            const senderWallet = await this.getJettonWallet(
                client,
                params.senderAddress,
                params.jettonAddress
            );

            if (!senderWallet) {
                errors.push('Failed to get sender jetton wallet address');
                return { valid: false, errors, warnings };
            }

            if (!senderWallet.isDeployed) {
                errors.push('Sender does not have a jetton wallet for this token');
                return { valid: false, errors, warnings };
            }

            // 4. Check balance
            const balance = BigInt(senderWallet.balance);
            if (balance < params.amount) {
                errors.push(
                    `Insufficient jetton balance. Have: ${this.formatAmount(balance, metadata.decimals)}, ` +
                    `need: ${this.formatAmount(params.amount, metadata.decimals)} ${metadata.symbol}`
                );
                return { valid: false, errors, warnings };
            }

            // 5. Check TON balance for gas
            const tonBalance = await this.getTonBalance(client, params.senderAddress);
            const requiredGas = DEFAULT_GAS_AMOUNT + (params.forwardTonAmount || DEFAULT_FORWARD_TON_AMOUNT);

            if (tonBalance < requiredGas) {
                const needed = Number(requiredGas) / 1e9;
                const have = Number(tonBalance) / 1e9;
                errors.push(
                    `Insufficient TON for gas. Have: ${have.toFixed(4)} TON, need: ${needed.toFixed(4)} TON`
                );
            }

            // Warnings for edge cases
            if (params.amount === balance) {
                warnings.push('Transferring entire balance');
            }

            if (params.senderAddress === params.recipientAddress) {
                warnings.push('Sender and recipient are the same');
            }

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            errors.push(`Validation error: ${err.message}`);
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings,
        };
    }

    // ========================================================================
    // JETTON METADATA
    // ========================================================================

    /**
     * Get jetton metadata with caching
     */
    async getJettonMetadata(jettonAddress: string): Promise<JettonMetadata | null> {
        // Check cache
        const cached = this.metadataCache.get(jettonAddress);
        if (cached && Date.now() - cached.fetchedAt < METADATA_CACHE_TTL) {
            return cached;
        }

        try {
            // Check known jettons first
            const normalizedAddress = Address.parse(jettonAddress).toString();
            const known = KNOWN_JETTONS[normalizedAddress];

            // Fetch from API
            const endpoint = this.network === 'testnet'
                ? 'https://testnet.tonapi.io/v2'
                : 'https://tonapi.io/v2';

            const response = await fetch(
                `${endpoint}/jettons/${encodeURIComponent(jettonAddress)}`
            );

            if (!response.ok) {
                // Use known data if available
                if (known) {
                    const metadata: JettonMetadata = {
                        address: normalizedAddress,
                        name: known.name || 'Unknown',
                        symbol: known.symbol || 'JETTON',
                        decimals: known.decimals || 9,
                        fetchedAt: Date.now(),
                    };
                    this.metadataCache.set(jettonAddress, metadata);
                    return metadata;
                }
                return null;
            }

            const data = await response.json();

            const metadata: JettonMetadata = {
                address: normalizedAddress,
                name: data.metadata?.name || known?.name || 'Unknown',
                symbol: data.metadata?.symbol || known?.symbol || 'JETTON',
                decimals: data.metadata?.decimals ?? known?.decimals ?? 9,
                image: data.metadata?.image,
                description: data.metadata?.description,
                totalSupply: data.total_supply,
                fetchedAt: Date.now(),
            };

            this.metadataCache.set(jettonAddress, metadata);
            return metadata;

        } catch (error) {
            console.error('[JettonService] Failed to get metadata:', error);

            // Return known data if available
            const known = KNOWN_JETTONS[Address.parse(jettonAddress).toString()];
            if (known) {
                return {
                    address: jettonAddress,
                    name: known.name || 'Unknown',
                    symbol: known.symbol || 'JETTON',
                    decimals: known.decimals || 9,
                    fetchedAt: Date.now(),
                };
            }

            return null;
        }
    }

    // ========================================================================
    // JETTON WALLET
    // ========================================================================

    /**
     * Get jetton wallet info
     */
    async getJettonWallet(
        client: TonClient,
        ownerAddress: string,
        jettonAddress: string
    ): Promise<JettonWalletInfo | null> {
        const cacheKey = `${ownerAddress}:${jettonAddress}`;

        // Check cache
        const cached = this.walletCache.get(cacheKey);
        if (cached && Date.now() - (cached as any)._fetchedAt < this.walletCacheTTL) {
            return cached;
        }

        try {
            const endpoint = this.network === 'testnet'
                ? 'https://testnet.tonapi.io/v2'
                : 'https://tonapi.io/v2';

            const response = await fetch(
                `${endpoint}/accounts/${encodeURIComponent(ownerAddress)}/jettons/${encodeURIComponent(jettonAddress)}`
            );

            if (!response.ok) {
                // Wallet doesn't exist or other error
                return {
                    address: '',
                    ownerAddress,
                    jettonAddress,
                    balance: '0',
                    isDeployed: false,
                };
            }

            const data = await response.json();

            const walletInfo: JettonWalletInfo = {
                address: data.wallet_address?.address || '',
                ownerAddress,
                jettonAddress,
                balance: data.balance || '0',
                isDeployed: !!data.wallet_address?.address,
            };

            // Add timestamp for cache
            (walletInfo as any)._fetchedAt = Date.now();
            this.walletCache.set(cacheKey, walletInfo);

            return walletInfo;

        } catch (error) {
            console.error('[JettonService] Failed to get jetton wallet:', error);
            return null;
        }
    }

    /**
     * Calculate jetton wallet address from owner and master
     */
    async calculateJettonWalletAddress(
        ownerAddress: string,
        jettonMasterAddress: string
    ): Promise<string | null> {
        try {
            const endpoint = this.network === 'testnet'
                ? 'https://testnet.tonapi.io/v2'
                : 'https://tonapi.io/v2';

            // Use the master contract to get wallet address
            const response = await fetch(
                `${endpoint}/blockchain/accounts/${encodeURIComponent(jettonMasterAddress)}/methods/get_wallet_address?args=${encodeURIComponent(Address.parse(ownerAddress).toRawString())}`
            );

            if (!response.ok) {
                return null;
            }

            const data = await response.json();
            // Parse the returned address from the stack
            if (data.decoded?.jetton_wallet_address) {
                return data.decoded.jetton_wallet_address;
            }

            return null;

        } catch (error) {
            console.error('[JettonService] Failed to calculate wallet address:', error);
            return null;
        }
    }

    // ========================================================================
    // TRANSFER BUILDING
    // ========================================================================

    /**
     * Build jetton transfer body
     */
    buildTransferBody(params: {
        to: string;
        amount: bigint;
        responseDestination?: string;
        forwardAmount?: bigint;
        comment?: string;
    }): Cell {
        const {
            to,
            amount,
            responseDestination,
            forwardAmount = toNano('0.01'),
            comment,
        } = params;

        // Build forward payload
        let forwardPayload = beginCell().endCell();
        if (comment) {
            forwardPayload = beginCell()
                .storeUint(0, 32) // Text comment op
                .storeStringTail(comment)
                .endCell();
        }

        return beginCell()
            .storeUint(JETTON_OP_CODES.TRANSFER, 32)
            .storeUint(0, 64) // query_id (will be set by wallet)
            .storeCoins(amount)
            .storeAddress(Address.parse(to))
            .storeAddress(
                responseDestination
                    ? Address.parse(responseDestination)
                    : Address.parse(to)
            )
            .storeBit(0) // custom_payload
            .storeCoins(forwardAmount)
            .storeBit(1) // forward_payload in ref
            .storeRef(forwardPayload)
            .endCell();
    }

    /**
     * Get transfer message for execution
     * Returns the prepared message that can be sent by the wallet
     */
    async prepareTransfer(
        client: TonClient,
        params: JettonTransferParams
    ): Promise<{
        to: string;
        value: bigint;
        body: Cell;
    } | null> {
        try {
            // Get sender's jetton wallet
            const senderWallet = await this.getJettonWallet(
                client,
                params.senderAddress,
                params.jettonAddress
            );

            if (!senderWallet || !senderWallet.isDeployed) {
                console.error('[JettonService] Sender jetton wallet not found');
                return null;
            }

            // Build transfer body
            const body = this.buildTransferBody({
                to: params.recipientAddress,
                amount: params.amount,
                responseDestination: params.senderAddress,
                forwardAmount: params.forwardTonAmount || DEFAULT_FORWARD_TON_AMOUNT,
                comment: params.comment,
            });

            return {
                to: senderWallet.address,
                value: DEFAULT_GAS_AMOUNT,
                body,
            };

        } catch (error) {
            console.error('[JettonService] Failed to prepare transfer:', error);
            return null;
        }
    }

    // ========================================================================
    // TRANSFER CONFIRMATION
    // ========================================================================

    /**
     * Wait for jetton transfer confirmation
     */
    async waitForTransferConfirmation(
        client: TonClient,
        txHash: string,
        recipientAddress: string,
        timeout: number = TRANSFER_CONFIRMATION_TIMEOUT
    ): Promise<boolean> {
        const startTime = Date.now();

        while (Date.now() - startTime < timeout) {
            try {
                // Check if transaction is confirmed
                const confirmed = await this.checkTransferConfirmation(
                    client,
                    txHash,
                    recipientAddress
                );

                if (confirmed) {
                    return true;
                }

            } catch (error) {
                // Continue polling
                console.warn('[JettonService] Confirmation check error:', error);
            }

            // Wait before next check
            await this.sleep(2000);
        }

        return false;
    }

    /**
     * Check if transfer is confirmed
     */
    private async checkTransferConfirmation(
        client: TonClient,
        txHash: string,
        recipientAddress: string
    ): Promise<boolean> {
        try {
            // Get transaction and check for transfer notification
            // This is a simplified check - a full implementation would
            // trace the message chain

            const endpoint = this.network === 'testnet'
                ? 'https://testnet.tonapi.io/v2'
                : 'https://tonapi.io/v2';

            const response = await fetch(
                `${endpoint}/blockchain/transactions/${txHash}`
            );

            if (!response.ok) {
                return false;
            }

            const data = await response.json();

            // Check if transaction succeeded
            return data.success === true && data.compute_phase?.success === true;

        } catch {
            return false;
        }
    }

    // ========================================================================
    // UTILITY METHODS
    // ========================================================================

    /**
     * Get TON balance
     */
    private async getTonBalance(
        client: TonClient,
        address: string
    ): Promise<bigint> {
        try {
            const addr = Address.parse(address);
            return await client.getBalance(addr);
        } catch {
            return 0n;
        }
    }

    /**
     * Format amount with decimals
     */
    formatAmount(amount: bigint, decimals: number): string {
        const divisor = BigInt(10 ** decimals);
        const whole = amount / divisor;
        const fraction = amount % divisor;

        if (fraction === 0n) {
            return whole.toString();
        }

        const fractionStr = fraction.toString().padStart(decimals, '0');
        const trimmed = fractionStr.replace(/0+$/, '');

        return `${whole}.${trimmed}`;
    }

    /**
     * Parse amount string to bigint
     */
    parseAmount(amount: string, decimals: number): bigint {
        const [whole, fraction = ''] = amount.split('.');
        const paddedFraction = fraction.padEnd(decimals, '0').slice(0, decimals);
        return BigInt(whole + paddedFraction);
    }

    /**
     * Clear caches
     */
    clearCache(): void {
        this.metadataCache.clear();
        this.walletCache.clear();
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
 * Create production jetton service
 */
export function createProductionJettonService(
    network: NetworkType = 'mainnet'
): ProductionJettonService {
    return new ProductionJettonService(network);
}

// Singleton instances
const instances: Record<NetworkType, ProductionJettonService | null> = {
    mainnet: null,
    testnet: null,
};

/**
 * Get singleton instance
 */
export function getProductionJettonService(
    network: NetworkType = 'mainnet'
): ProductionJettonService {
    if (!instances[network]) {
        instances[network] = new ProductionJettonService(network);
    }
    return instances[network]!;
}

export default ProductionJettonService;
