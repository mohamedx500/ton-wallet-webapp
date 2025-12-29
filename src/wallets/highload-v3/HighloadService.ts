/**
 * Highload Wallet V3 Service
 * 
 * High-level service for Highload Wallet V3 operations.
 * Supports batch transactions up to 254 messages per external message.
 */

import { Buffer } from 'buffer';
import { TonClient, internal } from '@ton/ton';
import {
    Address,
    beginCell,
    toNano,
    Cell,
    SendMode,
    OutActionSendMsg
} from '@ton/core';
import { mnemonicToPrivateKey } from '@ton/crypto';
import type {
    WalletInfo,
    KeyPair,
    TransactionParams,
    TransactionResult,
    BatchTransaction,
    NetworkType
} from '../../types';
import { TON_CONSTANTS, DEFAULT_CONFIG, HIGHLOAD_CONSTANTS } from '../../types';
import { HighloadWalletV3 } from './HighloadWalletV3';
import { HighloadQueryId, QueryIdStore } from './HighloadQueryId';

/**
 * Highload Wallet V3 Service
 */
export class HighloadWalletV3Service {
    private readonly network: NetworkType;
    private readonly workchain: number;
    private readonly subwalletId: number;
    private readonly timeout: number;
    private queryIdStore: QueryIdStore | null = null;

    constructor(
        network: NetworkType = 'mainnet',
        subwalletId: number = DEFAULT_CONFIG.SUBWALLET_ID,
        timeout: number = DEFAULT_CONFIG.HIGHLOAD_TIMEOUT
    ) {
        this.network = network;
        this.workchain = TON_CONSTANTS.WORKCHAIN;
        this.subwalletId = subwalletId;
        this.timeout = timeout;
    }

    /**
     * Create wallet from mnemonic
     */
    async createFromMnemonic(mnemonic: string[]): Promise<WalletInfo> {
        const keyPair = await mnemonicToPrivateKey(mnemonic);

        const wallet = HighloadWalletV3.createFromConfig(
            {
                publicKey: keyPair.publicKey,
                subwalletId: this.subwalletId,
                timeout: this.timeout,
            },
            undefined,
            this.workchain
        );

        const address = wallet.address.toString({
            bounceable: false,
            testOnly: this.network === 'testnet',
        });

        // Initialize query ID store for this wallet
        this.queryIdStore = new QueryIdStore(address);

        return {
            version: 'highload-v3',
            address,
            rawAddress: wallet.address.toRawString(),
            publicKey: keyPair.publicKey.toString('hex'),
            keyPair,
            isDeployed: false,
            init: wallet.init,
        };
    }

    /**
     * Get or create query ID store
     */
    private getQueryIdStore(walletAddress: string): QueryIdStore {
        if (!this.queryIdStore) {
            this.queryIdStore = new QueryIdStore(walletAddress);
        }
        return this.queryIdStore;
    }

    /**
     * Get opened contract
     */
    getOpenedContract(client: TonClient, keyPair: KeyPair): HighloadWalletV3 {
        const wallet = HighloadWalletV3.createFromConfig(
            {
                publicKey: keyPair.publicKey,
                subwalletId: this.subwalletId,
                timeout: this.timeout,
            },
            undefined,
            this.workchain
        );
        return client.open(wallet) as unknown as HighloadWalletV3;
    }

    /**
     * Send single TON transaction
     */
    async sendTransaction(
        client: TonClient,
        keyPair: KeyPair,
        params: TransactionParams
    ): Promise<TransactionResult> {
        try {
            const wallet = HighloadWalletV3.createFromConfig({
                publicKey: keyPair.publicKey,
                subwalletId: this.subwalletId,
                timeout: this.timeout,
            });

            const walletAddress = wallet.address.toString({
                bounceable: false,
                testOnly: this.network === 'testnet',
            });

            const queryIdStore = this.getQueryIdStore(walletAddress);
            const queryId = queryIdStore.getNext();

            // Build message body
            let body: Cell | undefined;
            if (params.comment) {
                body = beginCell()
                    .storeUint(0, 32)
                    .storeStringTail(params.comment)
                    .endCell();
            }

            const internalMessage = internal({
                to: Address.parse(params.to),
                value: params.amount,
                body,
                bounce: params.bounce ?? false,
            });

            // Try multiple timestamp offsets for reliability
            const offsets = [30, 60, 120, 180];
            let lastError: Error | null = null;

            for (const offset of offsets) {
                const createdAt = Math.floor(Date.now() / 1000) - offset;

                try {
                    const openedWallet = client.open(wallet) as unknown as HighloadWalletV3;

                    await openedWallet.sendExternalMessage(
                        client.provider(wallet.address),
                        keyPair.secretKey,
                        {
                            message: internalMessage,
                            mode: SendMode.PAY_GAS_SEPARATELY,
                            query_id: queryId,
                            createdAt,
                            subwalletId: this.subwalletId,
                            timeout: this.timeout,
                        }
                    );

                    return {
                        success: true,
                        queryId: queryId.getQueryId(),
                    };
                } catch (error) {
                    lastError = error instanceof Error ? error : new Error('Unknown error');
                    console.log(`Attempt with offset ${offset}s failed:`, lastError.message);
                }
            }

            throw lastError || new Error('All timestamp offsets failed');
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }

    /**
     * Send batch of transactions (up to 254 per external message)
     */
    async sendBatch(
        client: TonClient,
        keyPair: KeyPair,
        transactions: BatchTransaction[]
    ): Promise<TransactionResult> {
        try {
            if (transactions.length === 0) {
                throw new Error('No transactions to send');
            }

            if (transactions.length > HIGHLOAD_CONSTANTS.MAX_ACTIONS) {
                throw new Error(`Maximum ${HIGHLOAD_CONSTANTS.MAX_ACTIONS} transactions per batch`);
            }

            const wallet = HighloadWalletV3.createFromConfig({
                publicKey: keyPair.publicKey,
                subwalletId: this.subwalletId,
                timeout: this.timeout,
            });

            const walletAddress = wallet.address.toString({
                bounceable: false,
                testOnly: this.network === 'testnet',
            });

            const queryIdStore = this.getQueryIdStore(walletAddress);
            const queryId = queryIdStore.getNext();

            // Build batch messages
            const messages: OutActionSendMsg[] = transactions.map(tx => {
                let body: Cell | undefined;
                if (tx.comment) {
                    body = beginCell()
                        .storeUint(0, 32)
                        .storeStringTail(tx.comment)
                        .endCell();
                }

                return {
                    type: 'sendMsg' as const,
                    mode: SendMode.PAY_GAS_SEPARATELY,
                    outMsg: internal({
                        to: Address.parse(tx.to),
                        value: tx.amount,
                        body,
                        bounce: tx.bounce ?? false,
                    }),
                };
            });

            const createdAt = Math.floor(Date.now() / 1000) - 60;
            const openedWallet = client.open(wallet) as unknown as HighloadWalletV3;

            await openedWallet.sendBatch(
                client.provider(wallet.address),
                keyPair.secretKey,
                messages,
                this.subwalletId,
                queryId,
                this.timeout,
                createdAt
            );

            return {
                success: true,
                queryId: queryId.getQueryId(),
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }

    /**
     * Send batch with multiple external messages (for > 254 transactions)
     */
    async sendLargeBatch(
        client: TonClient,
        keyPair: KeyPair,
        transactions: BatchTransaction[],
        delayMs: number = 2000
    ): Promise<TransactionResult[]> {
        const results: TransactionResult[] = [];
        const batchSize = HIGHLOAD_CONSTANTS.MAX_ACTIONS;

        for (let i = 0; i < transactions.length; i += batchSize) {
            const batch = transactions.slice(i, i + batchSize);
            const result = await this.sendBatch(client, keyPair, batch);
            results.push(result);

            // Add delay between batches to avoid rate limiting
            if (i + batchSize < transactions.length) {
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
        }

        return results;
    }

    /**
     * Check if a query ID has been processed
     */
    async isQueryProcessed(
        client: TonClient,
        keyPair: KeyPair,
        queryId: HighloadQueryId
    ): Promise<boolean> {
        try {
            const wallet = HighloadWalletV3.createFromConfig({
                publicKey: keyPair.publicKey,
                subwalletId: this.subwalletId,
                timeout: this.timeout,
            });

            const openedWallet = client.open(wallet) as unknown as HighloadWalletV3;
            return await openedWallet.getProcessed(
                client.provider(wallet.address),
                queryId
            );
        } catch {
            return false;
        }
    }

    /**
     * Deploy wallet if not already deployed
     */
    async deploy(
        client: TonClient,
        keyPair: KeyPair,
        initialBalance: bigint = toNano('0.1')
    ): Promise<TransactionResult> {
        // Highload wallet is deployed on first external message
        // Just send a minimal transaction to ourselves
        const wallet = HighloadWalletV3.createFromConfig({
            publicKey: keyPair.publicKey,
            subwalletId: this.subwalletId,
            timeout: this.timeout,
        });

        const address = wallet.address.toString({
            bounceable: false,
            testOnly: this.network === 'testnet',
        });

        return this.sendTransaction(client, keyPair, {
            to: address,
            amount: toNano('0.01'),
            comment: 'Deploy',
        });
    }
}

export default HighloadWalletV3Service;
