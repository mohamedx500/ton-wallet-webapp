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
            });

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
            });

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
