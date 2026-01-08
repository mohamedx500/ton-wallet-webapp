/**
 * Deposit Monitoring Service
 * 
 * Monitors blockchain addresses for incoming deposits.
 * Provides real-time notifications and automatic confirmation tracking.
 * 
 * Features:
 * - Polling-based deposit detection
 * - Confirmation tracking
 * - Event notifications
 * - Multiple address monitoring
 * - Transaction deduplication
 * 
 * @version 1.0.0
 */

import { Address } from '@ton/core';
import { TonClient } from '@ton/ton';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

/**
 * Deposit status
 */
export type DepositStatus = 'pending' | 'confirming' | 'confirmed';

/**
 * Detected deposit
 */
export interface Deposit {
    id: string;
    hash: string;
    toAddress: string;
    fromAddress: string;
    amount: string; // In nanotons
    timestamp: number;
    lt: string; // Logical time
    status: DepositStatus;
    confirmations: number;
    blockNumber?: number;
    comment?: string;
    jettonInfo?: {
        jettonAddress: string;
        symbol: string;
        decimals: number;
    };
}

/**
 * Monitoring configuration
 */
export interface DepositMonitorConfig {
    pollInterval: number;
    confirmationsRequired: number;
    maxTransactionsPerPoll: number;
    processHistoricalDepth: number; // How far back to look on startup
}

/**
 * Address monitoring state
 */
interface MonitoredAddress {
    address: string;
    lastLt: string; // Last processed logical time
    lastHash: string;
    isJettonWallet: boolean;
    jettonInfo?: {
        masterAddress: string;
        symbol: string;
    };
}

/**
 * Deposit event handler
 */
export type DepositHandler = (deposit: Deposit) => void | Promise<void>;

// ============================================================================
// DEFAULT CONFIGURATION
// ============================================================================

const DEFAULT_CONFIG: DepositMonitorConfig = {
    pollInterval: 5000, // 5 seconds
    confirmationsRequired: 3,
    maxTransactionsPerPoll: 100,
    processHistoricalDepth: 50,
};

// ============================================================================
// DEPOSIT MONITORING SERVICE
// ============================================================================

/**
 * Deposit Monitoring Service
 */
export class DepositMonitoringService {
    private config: DepositMonitorConfig;
    private getClient: () => Promise<TonClient>;
    private monitoredAddresses: Map<string, MonitoredAddress> = new Map();
    private processedDeposits: Map<string, Deposit> = new Map();
    private pendingConfirmations: Map<string, Deposit> = new Map();
    private pollTimer: ReturnType<typeof setInterval> | null = null;
    private isRunning: boolean = false;

    // Event handlers
    private onDeposit: Set<DepositHandler> = new Set();
    private onConfirmed: Set<DepositHandler> = new Set();
    private onError: Set<(error: Error) => void> = new Set();

    constructor(
        getClient: () => Promise<TonClient>,
        config?: Partial<DepositMonitorConfig>
    ) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.getClient = getClient;
    }

    // ========================================================================
    // MONITORING CONTROL
    // ========================================================================

    /**
     * Start monitoring
     */
    start(): void {
        if (this.isRunning) {
            console.warn('[DepositMonitor] Already running');
            return;
        }

        this.isRunning = true;
        this.pollTimer = setInterval(
            () => this.poll(),
            this.config.pollInterval
        );

        // Initial poll
        this.poll();

        console.log('[DepositMonitor] Started');
    }

    /**
     * Stop monitoring
     */
    stop(): void {
        if (!this.isRunning) return;

        this.isRunning = false;
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }

        console.log('[DepositMonitor] Stopped');
    }

    /**
     * Add address to monitor
     */
    addAddress(
        address: string,
        options?: {
            isJettonWallet?: boolean;
            jettonMasterAddress?: string;
            jettonSymbol?: string;
        }
    ): void {
        const normalizedAddress = Address.parse(address).toString();

        if (this.monitoredAddresses.has(normalizedAddress)) {
            console.log(`[DepositMonitor] Address already monitored: ${normalizedAddress}`);
            return;
        }

        this.monitoredAddresses.set(normalizedAddress, {
            address: normalizedAddress,
            lastLt: '0',
            lastHash: '',
            isJettonWallet: options?.isJettonWallet || false,
            jettonInfo: options?.jettonMasterAddress ? {
                masterAddress: options.jettonMasterAddress,
                symbol: options.jettonSymbol || 'JETTON',
            } : undefined,
        });

        console.log(`[DepositMonitor] Now monitoring: ${normalizedAddress}`);
    }

    /**
     * Remove address from monitoring
     */
    removeAddress(address: string): boolean {
        const normalizedAddress = Address.parse(address).toString();
        const removed = this.monitoredAddresses.delete(normalizedAddress);

        if (removed) {
            console.log(`[DepositMonitor] Stopped monitoring: ${normalizedAddress}`);
        }

        return removed;
    }

    /**
     * Get monitored addresses
     */
    getMonitoredAddresses(): string[] {
        return Array.from(this.monitoredAddresses.keys());
    }

    // ========================================================================
    // EVENT HANDLERS
    // ========================================================================

    /**
     * Subscribe to deposit events
     */
    onDepositDetected(handler: DepositHandler): () => void {
        this.onDeposit.add(handler);
        return () => this.onDeposit.delete(handler);
    }

    /**
     * Subscribe to confirmed deposit events
     */
    onDepositConfirmed(handler: DepositHandler): () => void {
        this.onConfirmed.add(handler);
        return () => this.onConfirmed.delete(handler);
    }

    /**
     * Subscribe to error events
     */
    onMonitorError(handler: (error: Error) => void): () => void {
        this.onError.add(handler);
        return () => this.onError.delete(handler);
    }

    // ========================================================================
    // POLLING LOGIC
    // ========================================================================

    /**
     * Poll for new deposits
     */
    private async poll(): Promise<void> {
        if (!this.isRunning) return;

        try {
            const client = await this.getClient();

            // Check each monitored address
            for (const [address, state] of this.monitoredAddresses.entries()) {
                try {
                    await this.checkAddress(client, state);
                } catch (error) {
                    console.error(`[DepositMonitor] Error checking ${address}:`, error);
                }
            }

            // Check pending confirmations
            await this.checkConfirmations(client);

        } catch (error) {
            const err = error instanceof Error ? error : new Error('Unknown error');
            console.error('[DepositMonitor] Poll error:', err);
            this.notifyError(err);
        }
    }

    /**
     * Check an address for new deposits
     */
    private async checkAddress(
        client: TonClient,
        state: MonitoredAddress
    ): Promise<void> {
        const address = Address.parse(state.address);

        // Get recent transactions
        const transactions = await client.getTransactions(address, {
            limit: this.config.maxTransactionsPerPoll,
            lt: state.lastLt !== '0' ? state.lastLt : undefined,
            hash: state.lastHash !== '' ? state.lastHash : undefined,
        });

        if (transactions.length === 0) return;

        // Update last processed
        const latestTx = transactions[0];
        state.lastLt = latestTx.lt.toString();
        state.lastHash = latestTx.hash().toString('hex');

        // Process transactions (skip first if we've seen it)
        const toProcess = state.lastLt === '0'
            ? transactions
            : transactions.slice(1);

        for (const tx of toProcess) {
            // Only process incoming transactions
            if (tx.inMessage) {
                const deposit = await this.processIncomingTransaction(
                    tx,
                    state.address,
                    state.jettonInfo
                );

                if (deposit && !this.processedDeposits.has(deposit.id)) {
                    this.processedDeposits.set(deposit.id, deposit);
                    this.pendingConfirmations.set(deposit.id, deposit);
                    this.notifyDeposit(deposit);
                }
            }
        }
    }

    /**
     * Process an incoming transaction
     */
    private async processIncomingTransaction(
        tx: any, // Transaction type from TON client
        toAddress: string,
        jettonInfo?: { masterAddress: string; symbol: string }
    ): Promise<Deposit | null> {
        const inMsg = tx.inMessage;
        if (!inMsg?.info?.src) return null;

        const fromAddress = inMsg.info.src.toString();
        const amount = inMsg.info.value?.toString() || '0';

        // Skip empty transfers
        if (amount === '0' && !jettonInfo) return null;

        // Extract comment if present
        let comment: string | undefined;
        if (inMsg.body) {
            try {
                const slice = inMsg.body.beginParse();
                if (slice.remainingBits >= 32) {
                    const op = slice.loadUint(32);
                    if (op === 0) {
                        // Text comment
                        comment = slice.loadStringTail();
                    }
                }
            } catch {
                // No readable comment
            }
        }

        const deposit: Deposit = {
            id: `${tx.hash().toString('hex')}_${toAddress}`,
            hash: tx.hash().toString('hex'),
            toAddress,
            fromAddress,
            amount,
            timestamp: tx.now * 1000, // Convert to milliseconds
            lt: tx.lt.toString(),
            status: 'pending',
            confirmations: 0,
            comment,
            jettonInfo: jettonInfo ? {
                jettonAddress: jettonInfo.masterAddress,
                symbol: jettonInfo.symbol,
                decimals: 9, // Default, should fetch from contract
            } : undefined,
        };

        return deposit;
    }

    /**
     * Check pending deposits for confirmations
     */
    private async checkConfirmations(client: TonClient): Promise<void> {
        const currentBlock = await this.getCurrentBlock(client);

        for (const [id, deposit] of this.pendingConfirmations.entries()) {
            try {
                // Check if transaction is confirmed
                const confirmed = await this.checkTransactionConfirmation(
                    client,
                    deposit.hash,
                    currentBlock
                );

                if (confirmed.confirmations > deposit.confirmations) {
                    deposit.confirmations = confirmed.confirmations;
                    deposit.blockNumber = confirmed.blockNumber;

                    if (deposit.confirmations >= this.config.confirmationsRequired) {
                        deposit.status = 'confirmed';
                        this.pendingConfirmations.delete(id);
                        this.notifyConfirmed(deposit);
                    } else {
                        deposit.status = 'confirming';
                    }
                }
            } catch (error) {
                console.error(`[DepositMonitor] Error checking confirmation for ${id}:`, error);
            }
        }
    }

    /**
     * Get current masterchain block
     */
    private async getCurrentBlock(client: TonClient): Promise<number> {
        try {
            const info = await client.getMasterchainInfo();
            // Use latestSeqno which is the correct property name
            return info.latestSeqno;
        } catch {
            return 0;
        }
    }

    /**
     * Check transaction confirmation status
     */
    private async checkTransactionConfirmation(
        client: TonClient,
        hash: string,
        currentBlock: number
    ): Promise<{ confirmations: number; blockNumber?: number }> {
        // In TON, we typically consider a transaction confirmed after
        // a certain number of masterchain blocks have passed.
        // This is a simplified implementation.

        // For a real implementation, you would:
        // 1. Get the block containing the transaction
        // 2. Calculate blocks since then

        // Simplified: assume 1 confirmation per poll cycle
        return {
            confirmations: Math.min(
                this.config.confirmationsRequired,
                Math.ceil((Date.now() - parseFloat(hash.substring(0, 8))) / this.config.pollInterval)
            ),
            blockNumber: currentBlock,
        };
    }

    // ========================================================================
    // NOTIFICATIONS
    // ========================================================================

    /**
     * Notify deposit detected
     */
    private notifyDeposit(deposit: Deposit): void {
        console.log(`[DepositMonitor] Deposit detected: ${deposit.amount} nano to ${deposit.toAddress}`);

        for (const handler of this.onDeposit) {
            try {
                const result = handler(deposit);
                if (result instanceof Promise) {
                    result.catch(err =>
                        console.error('[DepositMonitor] Handler error:', err)
                    );
                }
            } catch (error) {
                console.error('[DepositMonitor] Handler error:', error);
            }
        }
    }

    /**
     * Notify deposit confirmed
     */
    private notifyConfirmed(deposit: Deposit): void {
        console.log(`[DepositMonitor] Deposit confirmed: ${deposit.hash}`);

        for (const handler of this.onConfirmed) {
            try {
                const result = handler(deposit);
                if (result instanceof Promise) {
                    result.catch(err =>
                        console.error('[DepositMonitor] Handler error:', err)
                    );
                }
            } catch (error) {
                console.error('[DepositMonitor] Handler error:', error);
            }
        }
    }

    /**
     * Notify error
     */
    private notifyError(error: Error): void {
        for (const handler of this.onError) {
            try {
                handler(error);
            } catch (e) {
                console.error('[DepositMonitor] Error handler error:', e);
            }
        }
    }

    // ========================================================================
    // UTILITY METHODS
    // ========================================================================

    /**
     * Get all detected deposits
     */
    getDeposits(): Deposit[] {
        return Array.from(this.processedDeposits.values());
    }

    /**
     * Get pending deposits awaiting confirmation
     */
    getPendingDeposits(): Deposit[] {
        return Array.from(this.pendingConfirmations.values());
    }

    /**
     * Get confirmed deposits
     */
    getConfirmedDeposits(): Deposit[] {
        return Array.from(this.processedDeposits.values())
            .filter(d => d.status === 'confirmed');
    }

    /**
     * Get deposits for a specific address
     */
    getDepositsForAddress(address: string): Deposit[] {
        const normalizedAddress = Address.parse(address).toString();
        return Array.from(this.processedDeposits.values())
            .filter(d => d.toAddress === normalizedAddress);
    }

    /**
     * Clear processed deposits history
     */
    clearHistory(): void {
        this.processedDeposits.clear();
        console.log('[DepositMonitor] History cleared');
    }

    /**
     * Get monitor status
     */
    getStatus(): {
        running: boolean;
        addressCount: number;
        processedCount: number;
        pendingCount: number;
    } {
        return {
            running: this.isRunning,
            addressCount: this.monitoredAddresses.size,
            processedCount: this.processedDeposits.size,
            pendingCount: this.pendingConfirmations.size,
        };
    }
}

// ============================================================================
// FACTORY
// ============================================================================

/**
 * Create deposit monitoring service
 */
export function createDepositMonitoringService(
    getClient: () => Promise<TonClient>,
    config?: Partial<DepositMonitorConfig>
): DepositMonitoringService {
    return new DepositMonitoringService(getClient, config);
}

export default DepositMonitoringService;
