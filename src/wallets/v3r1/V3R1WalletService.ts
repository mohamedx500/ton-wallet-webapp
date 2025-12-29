/**
 * V3R1 Wallet Service
 * 
 * Implements the Wallet V3R1 contract for basic TON operations.
 * V3R1 is one of the earliest wallet versions with seqno-based replay protection.
 */

import {
    WalletContractV3R1,
    TonClient,
    internal
} from '@ton/ton';
import {
    Address,
    beginCell,
    toNano,
    Cell,
    SendMode
} from '@ton/core';
import { mnemonicToPrivateKey } from '@ton/crypto';
import type {
    WalletInfo,
    WalletConfig,
    KeyPair,
    TransactionParams,
    TransactionResult,
    NetworkType
} from '../../types';
import { TON_CONSTANTS, DEFAULT_CONFIG } from '../../types';

/**
 * V3R1 Wallet Service
 * Handles creation, management, and transactions for V3R1 wallets
 */
export class V3R1WalletService {
    private readonly network: NetworkType;
    private readonly workchain: number;

    constructor(network: NetworkType = 'mainnet') {
        this.network = network;
        this.workchain = TON_CONSTANTS.WORKCHAIN;
    }

    /**
     * Create wallet from mnemonic
     */
    async createFromMnemonic(mnemonic: string[]): Promise<WalletInfo> {
        const keyPair = await mnemonicToPrivateKey(mnemonic);

        const wallet = WalletContractV3R1.create({
            publicKey: keyPair.publicKey,
            workchain: this.workchain,
        });

        const address = wallet.address.toString({
            bounceable: false,
            testOnly: this.network === 'testnet'
        });

        return {
            version: 'v3r1',
            address,
            rawAddress: wallet.address.toRawString(),
            publicKey: keyPair.publicKey.toString('hex'),
            keyPair,
            isDeployed: false,
            init: wallet.init,
        };
    }

    /**
     * Create wallet contract instance
     */
    createContract(publicKey: Buffer): WalletContractV3R1 {
        return WalletContractV3R1.create({
            publicKey,
            workchain: this.workchain,
        });
    }

    /**
     * Get opened wallet contract from client
     */
    getOpenedContract(client: TonClient, keyPair: KeyPair) {
        const wallet = this.createContract(keyPair.publicKey);
        return client.open(wallet);
    }

    /**
     * Get current seqno
     */
    async getSeqno(client: TonClient, keyPair: KeyPair): Promise<number> {
        const wallet = this.getOpenedContract(client, keyPair);
        try {
            return await wallet.getSeqno();
        } catch {
            return 0;
        }
    }

    /**
     * Send TON transaction
     */
    async sendTransaction(
        client: TonClient,
        keyPair: KeyPair,
        params: TransactionParams
    ): Promise<TransactionResult> {
        try {
            const wallet = this.getOpenedContract(client, keyPair);
            const seqno = await this.getSeqno(client, keyPair);

            // Build message body with optional comment
            let body: Cell | undefined;
            if (params.comment) {
                body = beginCell()
                    .storeUint(0, 32) // Text comment op code
                    .storeStringTail(params.comment)
                    .endCell();
            }

            await wallet.sendTransfer({
                secretKey: keyPair.secretKey,
                seqno,
                messages: [
                    internal({
                        to: Address.parse(params.to),
                        value: params.amount,
                        body,
                        bounce: params.bounce ?? false,
                    })
                ],
            });

            return {
                success: true,
                seqno,
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }

    /**
     * Send multiple transactions
     */
    async sendMultiple(
        client: TonClient,
        keyPair: KeyPair,
        transactions: TransactionParams[]
    ): Promise<TransactionResult> {
        try {
            const wallet = this.getOpenedContract(client, keyPair);
            const seqno = await this.getSeqno(client, keyPair);

            // V3R1 can only send up to 4 messages per transaction
            if (transactions.length > 4) {
                throw new Error('V3R1 wallet can only send up to 4 messages per transaction');
            }

            const messages = transactions.map(tx => {
                let body: Cell | undefined;
                if (tx.comment) {
                    body = beginCell()
                        .storeUint(0, 32)
                        .storeStringTail(tx.comment)
                        .endCell();
                }

                return internal({
                    to: Address.parse(tx.to),
                    value: tx.amount,
                    body,
                    bounce: tx.bounce ?? false,
                });
            });

            await wallet.sendTransfer({
                secretKey: keyPair.secretKey,
                seqno,
                messages,
            });

            return {
                success: true,
                seqno,
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }

    /**
     * Deploy wallet if not already deployed
     */
    async deploy(
        client: TonClient,
        keyPair: KeyPair,
        initialBalance: bigint = toNano('0.05')
    ): Promise<TransactionResult> {
        try {
            const wallet = this.getOpenedContract(client, keyPair);

            // Check if already deployed
            const balance = await client.getBalance(wallet.address);
            if (balance > 0n) {
                const seqno = await this.getSeqno(client, keyPair);
                if (seqno > 0) {
                    return {
                        success: true,
                        seqno,
                        error: 'Wallet already deployed',
                    };
                }
            }

            // Send initial transaction to deploy
            await wallet.sendTransfer({
                secretKey: keyPair.secretKey,
                seqno: 0,
                messages: [],
            });

            return {
                success: true,
                seqno: 0,
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }
}

export default V3R1WalletService;
