/**
 * Wallet Core Service
 * 
 * Unified interface for all wallet operations.
 * Integrates queue management, RPC resilience, state management,
 * rate limiting, and monitoring into a single production-grade service.
 * 
 * @version 1.0.0
 */

import { Address, toNano, Cell } from '@ton/core';
import { TonClient } from '@ton/ton';

// Import core services
import {
    TransactionQueueManager,
    getTransactionQueueManager,
    type QueuedTransaction,
    type TransactionResult,
    type TransactionPriority,
} from './queue/TransactionQueueManager';

import {
    ConcurrencyManager,
    getConcurrencyManager
} from './ConcurrencyManager';

import {
    WalletStateManager,
    getWalletStateManager,
    type TransactionRecord,
} from './WalletStateManager';

import {
    DepositMonitoringService,
    createDepositMonitoringService,
    type Deposit,
} from './DepositMonitoringService';

import {
    ProductionJettonService,
    getProductionJettonService,
    type JettonTransferParams,
    type ValidationResult,
} from './ProductionJettonService';

import {
    ResilientRpcClient,
    getResilientRpcClient,
} from '../network/ResilientRpcClient';

import type { NetworkType } from '../types';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

/**
 * Wallet core configuration
 */
export interface WalletCoreConfig {
    network: NetworkType;
    enableDepositMonitoring: boolean;
    enableMetrics: boolean;
    queueConfig?: {
        maxConcurrent?: number;
        maxRetries?: number;
    };
    rateLimitConfig?: {
        requestsPerSecond?: number;
        burstCapacity?: number;
    };
}

/**
 * Send parameters
 */
export interface SendParams {
    fromAddress: string;
    toAddress: string;
    amount: string; // In TON
    comment?: string;
    priority?: TransactionPriority;
}

/**
 * Jetton send parameters
 */
export interface JettonSendParams {
    fromAddress: string;
    toAddress: string;
    jettonAddress: string;
    amount: string; // In human-readable format
    decimals?: number;
    comment?: string;
    priority?: TransactionPriority;
}

/**
 * Balance info
 */
export interface BalanceInfo {
    ton: string; // In TON
    jettons: Array<{
        address: string;
        symbol: string;
        balance: string;
        decimals: number;
    }>;
}

/**
 * Wallet core status
 */
export interface WalletCoreStatus {
    network: NetworkType;
    isReady: boolean;
    queueStats: {
        queued: number;
        processing: number;
        confirmed: number;
        failed: number;
    };
    rpcHealth: Array<{
        url: string;
        healthy: boolean;
        latency: number;
    }>;
    depositMonitor?: {
        running: boolean;
        addressCount: number;
        pendingCount: number;
    };
}

// ============================================================================
// DEFAULT CONFIGURATION
// ============================================================================

const DEFAULT_CONFIG: WalletCoreConfig = {
    network: 'mainnet',
    enableDepositMonitoring: true,
    enableMetrics: true,
};

// ============================================================================
// WALLET CORE SERVICE
// ============================================================================

/**
 * Wallet Core Service
 * 
 * Main entry point for all wallet operations.
 */
export class WalletCoreService {
    private config: WalletCoreConfig;
    private rpcClient: ResilientRpcClient;
    private queueManager: TransactionQueueManager;
    private concurrencyManager: ConcurrencyManager;
    private stateManager: WalletStateManager;
    private jettonService: ProductionJettonService;
    private depositMonitor: DepositMonitoringService | null = null;
    private isInitialized: boolean = false;

    // Event listeners
    private onTransactionUpdate: Set<(tx: TransactionRecord) => void> = new Set();
    private onDepositReceived: Set<(deposit: Deposit) => void> = new Set();

    constructor(config?: Partial<WalletCoreConfig>) {
        this.config = { ...DEFAULT_CONFIG, ...config };

        // Initialize services
        this.rpcClient = getResilientRpcClient(this.config.network);
        this.queueManager = getTransactionQueueManager();
        this.concurrencyManager = getConcurrencyManager();
        this.stateManager = getWalletStateManager();
        this.jettonService = getProductionJettonService(this.config.network);

        // Set up queue callbacks
        this.setupQueueCallbacks();
    }

    /**
     * Initialize the service
     */
    async initialize(): Promise<void> {
        if (this.isInitialized) {
            console.warn('[WalletCore] Already initialized');
            return;
        }

        console.log(`[WalletCore] Initializing for ${this.config.network}...`);

        // Start queue processing
        this.queueManager.startProcessing();

        // Set up deposit monitoring if enabled
        if (this.config.enableDepositMonitoring) {
            this.depositMonitor = createDepositMonitoringService(
                async () => await this.rpcClient.getActiveClient()
            );

            // Subscribe to deposits
            this.depositMonitor.onDepositConfirmed(async (deposit) => {
                await this.handleDepositConfirmed(deposit);
            });
        }

        this.isInitialized = true;
        console.log('[WalletCore] Initialized successfully');
    }

    /**
     * Shutdown the service
     */
    async shutdown(): Promise<void> {
        console.log('[WalletCore] Shutting down...');

        this.queueManager.stopProcessing();
        this.rpcClient.stopHealthChecking();
        this.depositMonitor?.stop();
        this.concurrencyManager.stop();

        this.isInitialized = false;
        console.log('[WalletCore] Shutdown complete');
    }

    // ========================================================================
    // BALANCE OPERATIONS
    // ========================================================================

    /**
     * Get wallet balance
     */
    async getBalance(address: string): Promise<string> {
        // Check cache first
        const cached = this.stateManager.getBalance(address);
        if (cached) {
            return this.formatTon(BigInt(cached));
        }

        // Fetch from chain with rate limiting
        return this.concurrencyManager.execute(async () => {
            const balance = await this.rpcClient.getBalance(address);

            // Cache the result
            this.stateManager.setBalance(address, balance.toString());

            return this.formatTon(balance);
        });
    }

    /**
     * Get full balance info including jettons
     */
    async getFullBalance(address: string): Promise<BalanceInfo> {
        const [tonBalance, jettonBalances] = await Promise.all([
            this.getBalance(address),
            this.getJettonBalances(address),
        ]);

        return {
            ton: tonBalance,
            jettons: jettonBalances,
        };
    }

    /**
     * Get jetton balances
     */
    async getJettonBalances(address: string): Promise<BalanceInfo['jettons']> {
        // This would typically fetch from TonAPI or similar
        // For now, return cached balances
        const cached = this.stateManager.getAllJettonBalances(address);

        return cached.map(entry => ({
            address: entry.jettonAddress,
            symbol: entry.symbol || 'JETTON',
            balance: this.jettonService.formatAmount(
                BigInt(entry.balance),
                entry.decimals || 9
            ),
            decimals: entry.decimals || 9,
        }));
    }

    // ========================================================================
    // SEND OPERATIONS
    // ========================================================================

    /**
     * Send TON
     */
    async sendTon(params: SendParams): Promise<string> {
        this.ensureInitialized();

        // Validate amount
        const amount = toNano(params.amount);
        if (amount <= 0n) {
            throw new Error('Amount must be positive');
        }

        // Validate addresses
        Address.parse(params.fromAddress);
        Address.parse(params.toAddress);

        // Enqueue transaction
        const txId = await this.queueManager.enqueueTransaction({
            type: 'ton_transfer',
            walletAddress: params.fromAddress,
            recipient: params.toAddress,
            amount,
            comment: params.comment,
            priority: params.priority,
        });

        // Record in state
        this.stateManager.recordTransaction({
            id: txId,
            hash: '', // Will be set when confirmed
            fromAddress: params.fromAddress,
            toAddress: params.toAddress,
            amount: amount.toString(),
            type: 'ton_transfer',
            status: 'pending',
            confirmations: 0,
            comment: params.comment,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        });

        return txId;
    }

    /**
     * Send Jetton (token)
     */
    async sendJetton(params: JettonSendParams): Promise<string> {
        this.ensureInitialized();

        // Get jetton metadata for decimals
        const metadata = await this.jettonService.getJettonMetadata(params.jettonAddress);
        const decimals = params.decimals || metadata?.decimals || 9;

        // Parse amount
        const amount = this.jettonService.parseAmount(params.amount, decimals);
        if (amount <= 0n) {
            throw new Error('Amount must be positive');
        }

        // Validate the transfer
        const client = await this.rpcClient.getActiveClient();
        const validation = await this.jettonService.validateTransfer(client, {
            senderAddress: params.fromAddress,
            recipientAddress: params.toAddress,
            jettonAddress: params.jettonAddress,
            amount,
            comment: params.comment,
        });

        if (!validation.valid) {
            throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
        }

        // Prepare the transfer
        const prepared = await this.jettonService.prepareTransfer(client, {
            senderAddress: params.fromAddress,
            recipientAddress: params.toAddress,
            jettonAddress: params.jettonAddress,
            amount,
            comment: params.comment,
        });

        if (!prepared) {
            throw new Error('Failed to prepare jetton transfer');
        }

        // Enqueue transaction
        const txId = await this.queueManager.enqueueTransaction({
            type: 'jetton_transfer',
            walletAddress: params.fromAddress,
            recipient: prepared.to,
            amount: prepared.value,
            payload: prepared.body,
            priority: params.priority,
            metadata: {
                jettonAddress: params.jettonAddress,
                finalRecipient: params.toAddress,
                jettonAmount: amount.toString(),
            },
        });

        // Record in state
        this.stateManager.recordTransaction({
            id: txId,
            hash: '',
            fromAddress: params.fromAddress,
            toAddress: params.toAddress,
            amount: amount.toString(),
            type: 'jetton_transfer',
            status: 'pending',
            confirmations: 0,
            comment: params.comment,
            metadata: {
                jettonAddress: params.jettonAddress,
                symbol: metadata?.symbol,
            },
            createdAt: Date.now(),
            updatedAt: Date.now(),
        });

        return txId;
    }

    // ========================================================================
    // TRANSACTION TRACKING
    // ========================================================================

    /**
     * Get transaction status
     */
    getTransactionStatus(txId: string): string | null {
        return this.queueManager.getStatus(txId);
    }

    /**
     * Get transaction details
     */
    getTransaction(txId: string): TransactionRecord | null {
        return this.stateManager.getTransaction(txId);
    }

    /**
     * Get transaction history
     */
    getTransactionHistory(address: string, options?: { page?: number; limit?: number }) {
        return this.stateManager.getTransactionHistory(address, options);
    }

    /**
     * Cancel a pending transaction
     */
    cancelTransaction(txId: string): boolean {
        const cancelled = this.queueManager.cancelTransaction(txId);
        if (cancelled) {
            this.stateManager.updateTransaction(txId, { status: 'failed' });
        }
        return cancelled;
    }

    // ========================================================================
    // DEPOSIT MONITORING
    // ========================================================================

    /**
     * Start monitoring an address for deposits
     */
    startDepositMonitoring(address: string): void {
        if (!this.depositMonitor) {
            throw new Error('Deposit monitoring not enabled');
        }

        this.depositMonitor.addAddress(address);

        if (!this.depositMonitor.getStatus().running) {
            this.depositMonitor.start();
        }
    }

    /**
     * Stop monitoring an address
     */
    stopDepositMonitoring(address: string): void {
        this.depositMonitor?.removeAddress(address);
    }

    /**
     * Subscribe to deposit events
     */
    onDeposit(callback: (deposit: Deposit) => void): () => void {
        this.onDepositReceived.add(callback);
        return () => this.onDepositReceived.delete(callback);
    }

    // ========================================================================
    // VALIDATION
    // ========================================================================

    /**
     * Validate jetton transfer
     */
    async validateJettonTransfer(params: JettonSendParams): Promise<ValidationResult> {
        const client = await this.rpcClient.getActiveClient();
        const metadata = await this.jettonService.getJettonMetadata(params.jettonAddress);
        const decimals = params.decimals || metadata?.decimals || 9;

        return this.jettonService.validateTransfer(client, {
            senderAddress: params.fromAddress,
            recipientAddress: params.toAddress,
            jettonAddress: params.jettonAddress,
            amount: this.jettonService.parseAmount(params.amount, decimals),
            comment: params.comment,
        });
    }

    // ========================================================================
    // STATUS & HEALTH
    // ========================================================================

    /**
     * Get service status
     */
    getStatus(): WalletCoreStatus {
        const queueStats = this.queueManager.getStats();
        const rpcHealth = this.rpcClient.getEndpointHealth();

        return {
            network: this.config.network,
            isReady: this.isInitialized,
            queueStats: {
                queued: queueStats.queued,
                processing: queueStats.processing,
                confirmed: queueStats.confirmed,
                failed: queueStats.failed,
            },
            rpcHealth: rpcHealth.map(e => ({
                url: e.url,
                healthy: e.healthy,
                latency: e.latency,
            })),
            depositMonitor: this.depositMonitor?.getStatus(),
        };
    }

    /**
     * Get rate limit info
     */
    getRateLimitInfo(userId?: string) {
        return this.concurrencyManager.getRateLimitInfo(userId);
    }

    // ========================================================================
    // PRIVATE METHODS
    // ========================================================================

    /**
     * Ensure service is initialized
     */
    private ensureInitialized(): void {
        if (!this.isInitialized) {
            throw new Error('WalletCoreService not initialized. Call initialize() first.');
        }
    }

    /**
     * Set up queue callbacks
     */
    private setupQueueCallbacks(): void {
        this.queueManager.setOnStatusChange((tx) => {
            // Update state manager
            const updates: Partial<TransactionRecord> = {
                status: tx.status === 'confirmed' ? 'confirmed' :
                    tx.status === 'failed' ? 'failed' : 'pending',
                confirmations: tx.confirmations,
            };

            if (tx.hash) {
                (updates as any).hash = tx.hash;
            }

            this.stateManager.updateTransaction(tx.id, updates);

            // Notify listeners
            const record = this.stateManager.getTransaction(tx.id);
            if (record) {
                for (const callback of this.onTransactionUpdate) {
                    try {
                        callback(record);
                    } catch (error) {
                        console.error('[WalletCore] Error in transaction callback:', error);
                    }
                }
            }
        });

        this.queueManager.setOnError((tx, error) => {
            console.error(`[WalletCore] Transaction ${tx.id} failed:`, error.message);
        });
    }

    /**
     * Handle confirmed deposit
     */
    private async handleDepositConfirmed(deposit: Deposit): Promise<void> {
        console.log(`[WalletCore] Deposit confirmed: ${deposit.amount} to ${deposit.toAddress}`);

        // Record in state
        this.stateManager.recordTransaction({
            id: `deposit_${deposit.id}`,
            hash: deposit.hash,
            fromAddress: deposit.fromAddress,
            toAddress: deposit.toAddress,
            amount: deposit.amount,
            type: deposit.jettonInfo ? 'jetton_transfer' : 'ton_transfer',
            status: 'confirmed',
            confirmations: deposit.confirmations,
            blockNumber: deposit.blockNumber,
            comment: deposit.comment,
            metadata: deposit.jettonInfo as Record<string, unknown>,
            createdAt: deposit.timestamp,
            confirmedAt: Date.now(),
            updatedAt: Date.now(),
        });

        // Update balance cache
        this.stateManager.setBalance(
            deposit.toAddress,
            (BigInt(this.stateManager.getBalance(deposit.toAddress) || '0') + BigInt(deposit.amount)).toString()
        );

        // Notify listeners
        for (const callback of this.onDepositReceived) {
            try {
                callback(deposit);
            } catch (error) {
                console.error('[WalletCore] Error in deposit callback:', error);
            }
        }
    }

    /**
     * Format TON amount
     */
    private formatTon(nanotons: bigint): string {
        const ton = Number(nanotons) / 1e9;
        return ton.toFixed(9).replace(/\.?0+$/, '');
    }

    /**
     * Subscribe to transaction updates
     */
    onTransactionChange(callback: (tx: TransactionRecord) => void): () => void {
        this.onTransactionUpdate.add(callback);
        return () => this.onTransactionUpdate.delete(callback);
    }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create wallet core service
 */
export function createWalletCoreService(
    config?: Partial<WalletCoreConfig>
): WalletCoreService {
    return new WalletCoreService(config);
}

// Singleton instances
const instances: Record<NetworkType, WalletCoreService | null> = {
    mainnet: null,
    testnet: null,
};

/**
 * Get singleton instance
 */
export function getWalletCoreService(
    network: NetworkType = 'mainnet'
): WalletCoreService {
    if (!instances[network]) {
        instances[network] = new WalletCoreService({ network });
    }
    return instances[network]!;
}

export default WalletCoreService;
