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
 * Official Highload Wallet V3 contract code (BOC)
 * Source: https://github.com/ton-blockchain/highload-wallet-contract-v3/build/HighloadWalletV3.compiled.json
 */
const HIGHLOAD_WALLET_V3_CODE = Cell.fromBoc(
    Buffer.from(
        'b5ee9c7241021001000228000114ff00f4a413f4bcf2c80b01020120020d02014803040078d020d74bc00101c060b0915be101d0d3030171b0915be0fa4030f828c705b39130e0d31f018210ae42e5a4ba9d8040d721d74cf82a01ed55fb04e030020120050a02027306070011adce76a2686b85ffc00201200809001aabb6ed44d0810122d721d70b3f0018aa3bed44d08307d721d70b1f0201200b0c001bb9a6eed44d0810162d721d70b15800e5b8bf2eda2edfb21ab09028409b0ed44d0810120d721f404f404d33fd315d1058e1bf82325a15210b99f326df82305aa0015a112b992306dde923033e2923033e25230800df40f6fa19ed021d721d70a00955f037fdb31e09130e259800df40f6fa19cd001d721d70a00937fdb31e0915be270801f6f2d48308d718d121f900ed44d0d3ffd31ff404f404d33fd315d1f82321a15220b98e12336df82324aa00a112b9926d32de58f82301de541675f910f2a106d0d31fd4d307d30cd309d33fd315d15168baf2a2515abaf2a6f8232aa15250bcf2a304f823bbf2a35304800df40f6fa199d024d721d70a00f2649130e20e01fe5309800df40f6fa18e13d05004d718d20001f264c858cf16cf8301cf168e1030c824cf40cf8384095005a1a514cf40e2f800c94039800df41704c8cbff13cb1ff40012f40012cb3f12cb15c9ed54f80f21d0d30001f265d3020171b0925f03e0fa4001d70b01c000f2a5fa4031fa0031f401fa0031fa00318060d721d300010f0020f265d2000193d431d19130e272b1fb00b585bf03',
        'hex'
    )
)[0];


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
            HIGHLOAD_WALLET_V3_CODE,
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
            HIGHLOAD_WALLET_V3_CODE,
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
            }, HIGHLOAD_WALLET_V3_CODE, this.workchain);

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
            }, HIGHLOAD_WALLET_V3_CODE, this.workchain);

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
            }, HIGHLOAD_WALLET_V3_CODE, this.workchain);

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
        }, HIGHLOAD_WALLET_V3_CODE, this.workchain);

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
