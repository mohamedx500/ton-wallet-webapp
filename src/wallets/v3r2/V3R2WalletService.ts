/**
 * V3R2 Wallet Service
 * 
 * Implements the Wallet V3R2 contract.
 * V3R2 is an improved version of V3R1 with better gas efficiency.
 */

import {
    WalletContractV3R2,
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
import { TON_CONSTANTS } from '../../types';

/**
 * V3R2 Wallet Service
 */
export class V3R2WalletService {
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

        const wallet = WalletContractV3R2.create({
            publicKey: keyPair.publicKey,
            workchain: this.workchain,
        });

        const address = wallet.address.toString({
            bounceable: false,
            testOnly: this.network === 'testnet'
        });

        return {
            version: 'v3r2',
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
    createContract(publicKey: Buffer): WalletContractV3R2 {
        return WalletContractV3R2.create({
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
                throw new Error('V3R2 wallet can only send up to 4 messages per transaction');
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
}

export default V3R2WalletService;
