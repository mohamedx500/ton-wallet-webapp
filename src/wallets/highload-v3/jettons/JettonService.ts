/**
 * Highload V3 Jetton Service
 * 
 * Handles Jetton transfers for Highload Wallet V3.
 * Supports batch Jetton transfers.
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
import type {
    KeyPair,
    JettonTransferParams,
    TransactionResult,
    NetworkType
} from '../../../types';
import { JETTON_OP_CODES, DEFAULT_CONFIG, HIGHLOAD_CONSTANTS } from '../../../types';
import { HighloadWalletV3 } from '../HighloadWalletV3';
import { HighloadQueryId, QueryIdStore } from '../HighloadQueryId';

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
 * Highload V3 Jetton Service
 */
export class HighloadV3JettonService {
    private readonly network: NetworkType;
    private readonly subwalletId: number;
    private readonly timeout: number;

    constructor(
        network: NetworkType = 'mainnet',
        subwalletId: number = DEFAULT_CONFIG.SUBWALLET_ID,
        timeout: number = DEFAULT_CONFIG.HIGHLOAD_TIMEOUT
    ) {
        this.network = network;
        this.subwalletId = subwalletId;
        this.timeout = timeout;
    }

    /**
     * Build Jetton transfer body according to TEP-74
     */
    buildTransferBody(params: JettonTransferParams): Cell {
        const {
            to,
            amount,
            responseDestination,
            forwardAmount = toNano('0.01'),
            comment
        } = params;

        let forwardPayload = beginCell().endCell();
        if (comment) {
            forwardPayload = beginCell()
                .storeUint(0, 32)
                .storeStringTail(comment)
                .endCell();
        }

        return beginCell()
            .storeUint(JETTON_OP_CODES.TRANSFER, 32)
            .storeUint(0, 64) // query_id
            .storeCoins(amount)
            .storeAddress(Address.parse(to))
            .storeAddress(
                responseDestination
                    ? Address.parse(responseDestination)
                    : Address.parse(to)
            )
            .storeBit(0)
            .storeCoins(forwardAmount)
            .storeBit(1)
            .storeRef(forwardPayload)
            .endCell();
    }

    /**
     * Send single Jetton transfer
     */
    async sendTransfer(
        client: TonClient,
        keyPair: KeyPair,
        params: JettonTransferParams
    ): Promise<TransactionResult> {
        try {
            const wallet = HighloadWalletV3.createFromConfig({
                publicKey: keyPair.publicKey,
                subwalletId: this.subwalletId,
                timeout: this.timeout,
            }, HIGHLOAD_WALLET_V3_CODE, 0);

            const walletAddress = wallet.address.toString({
                bounceable: false,
                testOnly: this.network === 'testnet',
            });

            const queryIdStore = new QueryIdStore(walletAddress);
            const queryId = queryIdStore.getNext();

            const jettonBody = this.buildTransferBody(params);

            const internalMessage = internal({
                to: Address.parse(params.jettonWalletAddress),
                value: toNano('0.05'), // Gas for jetton transfer
                body: jettonBody,
                bounce: true,
            });

            const createdAt = Math.floor(Date.now() / 1000) - 60;
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
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }

    /**
     * Send batch of Jetton transfers
     */
    async sendBatchTransfer(
        client: TonClient,
        keyPair: KeyPair,
        transfers: JettonTransferParams[]
    ): Promise<TransactionResult> {
        try {
            if (transfers.length === 0) {
                throw new Error('No transfers to send');
            }

            if (transfers.length > HIGHLOAD_CONSTANTS.MAX_ACTIONS) {
                throw new Error(`Maximum ${HIGHLOAD_CONSTANTS.MAX_ACTIONS} transfers per batch`);
            }

            const wallet = HighloadWalletV3.createFromConfig({
                publicKey: keyPair.publicKey,
                subwalletId: this.subwalletId,
                timeout: this.timeout,
            }, HIGHLOAD_WALLET_V3_CODE, 0);

            const walletAddress = wallet.address.toString({
                bounceable: false,
                testOnly: this.network === 'testnet',
            });

            const queryIdStore = new QueryIdStore(walletAddress);
            const queryId = queryIdStore.getNext();

            // Build batch messages
            const messages: OutActionSendMsg[] = transfers.map(transfer => {
                const jettonBody = this.buildTransferBody(transfer);

                return {
                    type: 'sendMsg' as const,
                    mode: SendMode.PAY_GAS_SEPARATELY,
                    outMsg: internal({
                        to: Address.parse(transfer.jettonWalletAddress),
                        value: toNano('0.05'),
                        body: jettonBody,
                        bounce: true,
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
     * Get Jetton wallet address for owner
     */
    async getJettonWalletAddress(
        ownerAddress: string,
        jettonMasterAddress: string
    ): Promise<string | null> {
        try {
            const endpoint = this.network === 'testnet'
                ? 'https://testnet.tonapi.io/v2'
                : 'https://tonapi.io/v2';

            const response = await fetch(
                `${endpoint}/accounts/${encodeURIComponent(ownerAddress)}/jettons/${encodeURIComponent(jettonMasterAddress)}`
            );

            if (!response.ok) {
                return null;
            }

            const data = await response.json();
            return data.wallet_address?.address || null;
        } catch {
            return null;
        }
    }

    /**
     * Format jetton amount
     */
    formatJettonAmount(amount: bigint, decimals: number): string {
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
     * Parse jetton amount
     */
    parseJettonAmount(amount: string, decimals: number): bigint {
        const [whole, fraction = ''] = amount.split('.');
        const paddedFraction = fraction.padEnd(decimals, '0').slice(0, decimals);
        return BigInt(whole + paddedFraction);
    }
}

export default HighloadV3JettonService;
