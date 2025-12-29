/**
 * V4R2 Wallet Service
 * 
 * Implements the Wallet V4R2 contract with plugin support.
 * V4R2 is the recommended standard wallet version.
 */

import {
    WalletContractV4,
    TonClient,
    internal
} from '@ton/ton';
import {
    Address,
    beginCell,
    toNano,
    Cell
} from '@ton/core';
import { mnemonicToPrivateKey } from '@ton/crypto';
import type {
    WalletInfo,
    KeyPair,
    TransactionParams,
    TransactionResult,
    NetworkType
} from '../../types';
import { TON_CONSTANTS, DEFAULT_CONFIG } from '../../types';

/**
 * V4R2 Wallet Service
 */
export class V4R2WalletService {
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

        const wallet = WalletContractV4.create({
            publicKey: keyPair.publicKey,
            workchain: this.workchain,
        });

        const address = wallet.address.toString({
            bounceable: false,
            testOnly: this.network === 'testnet'
        });

        return {
            version: 'v4r2',
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
    createContract(publicKey: Buffer): WalletContractV4 {
        return WalletContractV4.create({
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
     * Check if wallet is deployed
     */
    async isDeployed(client: TonClient, keyPair: KeyPair): Promise<boolean> {
        const wallet = this.getOpenedContract(client, keyPair);
        try {
            const seqno = await wallet.getSeqno();
            return seqno > 0;
        } catch {
            return false;
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

            let body: Cell | undefined;
            if (params.comment) {
                body = beginCell()
                    .storeUint(0, 32)
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
     * Send multiple transactions (up to 4)
     */
    async sendMultiple(
        client: TonClient,
        keyPair: KeyPair,
        transactions: TransactionParams[]
    ): Promise<TransactionResult> {
        try {
            const wallet = this.getOpenedContract(client, keyPair);
            const seqno = await this.getSeqno(client, keyPair);

            if (transactions.length > 4) {
                throw new Error('V4R2 wallet can only send up to 4 messages per transaction');
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
     * Get wallet plugins (V4 feature)
     */
    async getPlugins(client: TonClient, keyPair: KeyPair): Promise<Address[]> {
        // This would require contract-specific get method
        // For now, return empty array
        return [];
    }
}

export default V4R2WalletService;
