/**
 * V3R1 Jetton Service
 * 
 * Handles Jetton (token) transfers for V3R1 wallets.
 * Supports USDT, NOT, and other standard TEP-74 tokens.
 */

import { TonClient, internal } from '@ton/ton';
import {
    Address,
    beginCell,
    toNano,
    Cell
} from '@ton/core';
import type {
    KeyPair,
    JettonTransferParams,
    TransactionResult,
    JettonBalance,
    NetworkType
} from '../../../types';
import { JETTON_OP_CODES } from '../../../types';
import { V3R1WalletService } from '../V3R1WalletService';

/**
 * Base Jetton Service for V3R1 wallets
 */
export class V3R1JettonService {
    private readonly walletService: V3R1WalletService;
    private readonly network: NetworkType;

    constructor(network: NetworkType = 'mainnet') {
        this.network = network;
        this.walletService = new V3R1WalletService(network);
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

        // Build forward payload if comment exists
        let forwardPayload = beginCell().endCell();
        if (comment) {
            forwardPayload = beginCell()
                .storeUint(0, 32) // Text comment op code
                .storeStringTail(comment)
                .endCell();
        }

        // Build TEP-74 transfer body
        return beginCell()
            .storeUint(JETTON_OP_CODES.TRANSFER, 32)    // op::transfer
            .storeUint(0, 64)                            // query_id
            .storeCoins(amount)                          // amount
            .storeAddress(Address.parse(to))             // destination
            .storeAddress(
                responseDestination
                    ? Address.parse(responseDestination)
                    : Address.parse(to)
            )                                            // response_destination
            .storeBit(0)                                 // no custom payload
            .storeCoins(forwardAmount)                   // forward_ton_amount
            .storeBit(1)                                 // store forward payload as ref
            .storeRef(forwardPayload)
            .endCell();
    }

    /**
     * Send Jetton transfer
     */
    async sendTransfer(
        client: TonClient,
        keyPair: KeyPair,
        params: JettonTransferParams
    ): Promise<TransactionResult> {
        try {
            const wallet = this.walletService.getOpenedContract(client, keyPair);
            const seqno = await this.walletService.getSeqno(client, keyPair);

            const jettonBody = this.buildTransferBody(params);

            await wallet.sendTransfer({
                secretKey: keyPair.secretKey,
                seqno,
                messages: [
                    internal({
                        to: Address.parse(params.jettonWalletAddress),
                        value: toNano('0.05'), // Gas for jetton transfer
                        body: jettonBody,
                        bounce: true,
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
        } catch (error) {
            console.error('Error getting jetton wallet address:', error);
            return null;
        }
    }

    /**
     * Get all jetton balances for owner
     */
    async getJettonBalances(ownerAddress: string): Promise<JettonBalance[]> {
        try {
            const endpoint = this.network === 'testnet'
                ? 'https://testnet.tonapi.io/v2'
                : 'https://tonapi.io/v2';

            const response = await fetch(
                `${endpoint}/accounts/${encodeURIComponent(ownerAddress)}/jettons`
            );

            if (!response.ok) {
                return [];
            }

            const data = await response.json();
            const balances: JettonBalance[] = [];

            for (const item of data.balances || []) {
                const balance = BigInt(item.balance || '0');
                const decimals = item.jetton?.decimals || 9;
                const formatted = this.formatJettonAmount(balance, decimals);

                balances.push({
                    jetton: {
                        address: item.jetton?.address || '',
                        symbol: item.jetton?.symbol || 'TOKEN',
                        name: item.jetton?.name || 'Unknown Token',
                        decimals,
                        image: item.jetton?.image || undefined,
                        verified: item.jetton?.verification === 'whitelist',
                    },
                    walletAddress: item.wallet_address?.address || '',
                    balance,
                    balanceFormatted: formatted,
                });
            }

            return balances;
        } catch (error) {
            console.error('Error getting jetton balances:', error);
            return [];
        }
    }

    /**
     * Format jetton amount with decimals
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
     * Parse jetton amount from string
     */
    parseJettonAmount(amount: string, decimals: number): bigint {
        const [whole, fraction = ''] = amount.split('.');
        const paddedFraction = fraction.padEnd(decimals, '0').slice(0, decimals);
        return BigInt(whole + paddedFraction);
    }
}

export default V3R1JettonService;
