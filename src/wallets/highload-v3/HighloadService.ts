/**
 * Highload Wallet V3 Service
 * 
 * High-level service for Highload Wallet V3 operations.
 * Supports batch transactions up to 254 messages per external message.
 *
 * CRITICAL ARCHITECTURE:
 * - sendBatch() accepts pre-built OutActionSendMsg[] directly.
 * - sendTransaction() accepts a single OutActionSendMsg for individual dispatch.
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
    NetworkType
} from '../../types';
import { DEFAULT_CONFIG, HIGHLOAD_CONSTANTS, TON_CONSTANTS } from '../../types';
import { HighloadWalletV3 } from './HighloadWalletV3';
import { HighloadQueryId, QueryIdStore } from './HighloadQueryId';

/**
 * Official Highload Wallet V3 contract code (BOC)
 */
const HIGHLOAD_WALLET_V3_CODE = Cell.fromBoc(
    Buffer.from(
        'b5ee9c7241021001000228000114ff00f4a413f4bcf2c80b01020120020d02014803040078d020d74bc00101c060b0915be101d0d3030171b0915be0fa4030f828c705b39130e0d31f018210ae42e5a4ba9d8040d721d74cf82a01ed55fb04e030020120050a02027306070011adce76a2686b85ffc00201200809001aabb6ed44d0810122d721d70b3f0018aa3bed44d08307d721d70b1f0201200b0c001bb9a6eed44d0810162d721d70b15800e5b8bf2eda2edfb21ab09028409b0ed44d0810120d721f404f404d33fd315d1058e1bf82325a15210b99f326df82305aa0015a112b992306dde923033e2923033e25230800df40f6fa19ed021d721d70a00955f037fdb31e09130e259800df40f6fa19cd001d721d70a00937fdb31e0915be270801f6f2d48308d718d121f900ed44d0d3ffd31ff404f404d33fd315d1f82321a15220b98e12336df82324aa00a112b9926d32de58f82301de541675f910f2a106d0d31fd4d307d30cd309d33fd315d15168baf2a2515abaf2a6f8232aa15250bcf2a304f823bbf2a35304800df40f6fa199d024d721d70a00f2649130e20e01fe5309800df40f6fa18e13d05004d718d20001f264c858cf16cf8301cf168e1030c824cf40cf8384095005a1a514cf40e2f800c94039800df41704c8cbff13cb1ff40012f40012cb3f12cb15c9ed54f80f21d0d30001f265d3020171b0925f03e0fa4001d70b01c000f2a5fa4031fa0031f401fa0031fa00318060d721d300010f0020f265d2000193d431d19130e272b1fb00b585bf03',
        'hex'
    )
)[0];

export class HighloadWalletV3Service {
    private readonly network: NetworkType;
    private readonly workchain: number;
    private readonly subwalletId: number;
    private readonly timeout: number;
    private queryIdStore: QueryIdStore | null = null;

    constructor(
        network: NetworkType = 'mainnet',
        subwalletId: number = DEFAULT_CONFIG.SUBWALLET_ID_HIGHLOAD_V3,
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

    private getQueryIdStore(walletAddress: string): QueryIdStore {
        if (!this.queryIdStore) {
            this.queryIdStore = new QueryIdStore(walletAddress);
        }
        return this.queryIdStore;
    }

    /**
     * Send single TON or Jetton transaction (BURST OPTIMIZED)
     */
    async sendTransaction(
        client: TonClient,
        keyPair: KeyPair,
        message: OutActionSendMsg
    ): Promise<TransactionResult> {
        try {
            const wallet = HighloadWalletV3.createFromConfig({
                publicKey: keyPair.publicKey,
                subwalletId: this.subwalletId,
                timeout: this.timeout,
            }, HIGHLOAD_WALLET_V3_CODE, this.workchain);

            const provider = client.provider(wallet.address, wallet.init ?? undefined);
            const queryIdStore = this.getQueryIdStore(wallet.address.toString());
            const queryId = queryIdStore.getNext();
            const createdAt = Math.floor(Date.now() / 1000) - 60;

            // Key change: Send individual messages directly without packaging in batches
            // This prevents the use of mode 128, so no "received" messages will be returned
            // It also allows 100 transactions per second without the balance being locked
            await wallet.sendExternalMessage(
                provider,
                keyPair.secretKey,
                {
                    message: message.outMsg as any,
                    mode: message.mode !== undefined ? message.mode : SendMode.PAY_GAS_SEPARATELY,
                    query_id: queryId,
                    createdAt: createdAt,
                    subwalletId: this.subwalletId,
                    timeout: this.timeout,
                }
            );

            return { success: true, queryId: queryId.getQueryId() };
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
    }

    /**
     * Send batch of transactions (up to 254 per external message)
     */
    async sendBatch(
        client: TonClient,
        keyPair: KeyPair,
        messages: OutActionSendMsg[]
    ): Promise<TransactionResult> {
        try {
            if (!messages || messages.length === 0) throw new Error('No transactions to send');

            if (messages.length > HIGHLOAD_CONSTANTS.MAX_ACTIONS) {
                throw new Error(`Maximum ${HIGHLOAD_CONSTANTS.MAX_ACTIONS} transactions per batch`);
            }

            // 1. Calculate the total TON required to execute all transfers in the batch
            let totalValueRequired = toNano('0.02'); // Basic fees for unpacking the batch

            const safeMessages: OutActionSendMsg[] = messages.map(m => {
                if (!m.outMsg) throw new Error('Missing outMsg in transfer payload');

                // Add the value of each internal transfer to the required balance
                if ((m.outMsg as any).info?.type === 'internal') {
                    totalValueRequired += (m.outMsg as any).info.value.coins;
                }

                return {
                    type: 'sendMsg' as const,
                    mode: m.mode !== undefined ? m.mode : SendMode.PAY_GAS_SEPARATELY,
                    outMsg: m.outMsg
                };
            });

            const wallet = HighloadWalletV3.createFromConfig({
                publicKey: keyPair.publicKey,
                subwalletId: this.subwalletId,
                timeout: this.timeout,
            }, HIGHLOAD_WALLET_V3_CODE, this.workchain);

            const provider = client.provider(wallet.address, wallet.init ?? undefined);
            const queryIdStore = this.getQueryIdStore(wallet.address.toString());
            const queryId = queryIdStore.getNext();
            const createdAt = Math.floor(Date.now() / 1000) - 60;

            await wallet.sendBatch(
                provider,
                keyPair.secretKey,
                safeMessages,
                this.subwalletId,
                queryId,
                this.timeout,
                createdAt,
                totalValueRequired // 2. Pay in millimes to avoid full withdrawals and failure
            );

            return { success: true, queryId: queryId.getQueryId() };
        } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
    }

    /**
     * Legacy support for simple transactions
     */
    async sendSimpleTransaction(
        client: TonClient,
        keyPair: KeyPair,
        params: TransactionParams
    ): Promise<TransactionResult> {
        const body = params.comment ? beginCell().storeUint(0, 32).storeStringTail(params.comment).endCell() : undefined;
        const message: OutActionSendMsg = {
            type: 'sendMsg',
            mode: SendMode.PAY_GAS_SEPARATELY,
            outMsg: internal({
                to: Address.parse(params.to),
                value: params.amount,
                body,
                bounce: params.bounce ?? false,
            }),
        };
        return this.sendTransaction(client, keyPair, message);
    }
}

export default HighloadWalletV3Service;
