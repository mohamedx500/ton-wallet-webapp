/**
 * Highload V3 USDT Service
 * 
 * Specialized service for USDT transfers using Highload Wallet V3.
 * Supports single and batch USDT transfers.
 */

import { TonClient } from '@ton/ton';
import { toNano } from '@ton/core';
import type { KeyPair, TransactionResult, NetworkType } from '../../../../types';
import { DEFAULT_CONFIG } from '../../../../types';
import { HighloadV3JettonService } from '../JettonService';

/**
 * USDT Master Contract Addresses
 */
export const USDT_MASTER_ADDRESS = {
    mainnet: 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs',
    testnet: 'EQBynBO23ywHy_CgarY9NK9FTz0yDsG82PtcbSTQgGoXwiuA',
};

/**
 * USDT Transfer Parameters
 */
export interface UsdtTransferParams {
    recipientAddress: string;
    amount: number; // In USDT units (e.g., 10.5)
    comment?: string;
}

/**
 * Highload V3 USDT Service
 */
export class HighloadV3UsdtService {
    private readonly jettonService: HighloadV3JettonService;
    private readonly network: NetworkType;
    private readonly decimals = 6;

    constructor(
        network: NetworkType = 'mainnet',
        subwalletId: number = DEFAULT_CONFIG.SUBWALLET_ID,
        timeout: number = DEFAULT_CONFIG.HIGHLOAD_TIMEOUT
    ) {
        this.network = network;
        this.jettonService = new HighloadV3JettonService(network, subwalletId, timeout);
    }

    /**
     * Get USDT master address for current network
     */
    getMasterAddress(): string {
        return USDT_MASTER_ADDRESS[this.network];
    }

    /**
     * Get user's USDT wallet address
     */
    async getUsdtWalletAddress(ownerAddress: string): Promise<string | null> {
        return this.jettonService.getJettonWalletAddress(
            ownerAddress,
            this.getMasterAddress()
        );
    }

    /**
     * Get USDT balance
     */
    async getBalance(ownerAddress: string): Promise<{
        balance: bigint;
        formatted: string;
        walletAddress: string | null;
    }> {
        const walletAddress = await this.getUsdtWalletAddress(ownerAddress);

        if (!walletAddress) {
            return {
                balance: 0n,
                formatted: '0.00',
                walletAddress: null,
            };
        }

        try {
            const endpoint = this.network === 'testnet'
                ? 'https://testnet.tonapi.io/v2'
                : 'https://tonapi.io/v2';

            const response = await fetch(
                `${endpoint}/accounts/${encodeURIComponent(ownerAddress)}/jettons`
            );

            if (!response.ok) {
                return { balance: 0n, formatted: '0.00', walletAddress };
            }

            const data = await response.json();
            const usdtBalance = (data.balances || []).find(
                (b: any) => b.jetton?.address?.toLowerCase() === this.getMasterAddress().toLowerCase()
            );

            if (!usdtBalance) {
                return { balance: 0n, formatted: '0.00', walletAddress };
            }

            const balance = BigInt(usdtBalance.balance || '0');
            return {
                balance,
                formatted: this.formatAmount(balance),
                walletAddress,
            };
        } catch {
            return { balance: 0n, formatted: '0.00', walletAddress };
        }
    }

    /**
     * Send single USDT transfer
     */
    async sendUsdt(
        client: TonClient,
        keyPair: KeyPair,
        senderAddress: string,
        params: UsdtTransferParams
    ): Promise<TransactionResult> {
        const usdtWalletAddress = await this.getUsdtWalletAddress(senderAddress);

        if (!usdtWalletAddress) {
            return {
                success: false,
                error: 'USDT wallet not found. You may not have any USDT.',
            };
        }

        const amountInUnits = this.parseAmount(params.amount.toString());

        return this.jettonService.sendTransfer(client, keyPair, {
            to: params.recipientAddress,
            amount: amountInUnits,
            jettonWalletAddress: usdtWalletAddress,
            decimals: this.decimals,
            comment: params.comment,
        });
    }

    /**
     * Send batch USDT transfers
     */
    async sendBatchUsdt(
        client: TonClient,
        keyPair: KeyPair,
        senderAddress: string,
        transfers: UsdtTransferParams[]
    ): Promise<TransactionResult> {
        const usdtWalletAddress = await this.getUsdtWalletAddress(senderAddress);

        if (!usdtWalletAddress) {
            return {
                success: false,
                error: 'USDT wallet not found. You may not have any USDT.',
            };
        }

        const jettonTransfers = transfers.map(t => ({
            to: t.recipientAddress,
            amount: this.parseAmount(t.amount.toString()),
            jettonWalletAddress: usdtWalletAddress,
            decimals: this.decimals,
            comment: t.comment,
        }));

        return this.jettonService.sendBatchTransfer(client, keyPair, jettonTransfers);
    }

    /**
     * Format USDT amount for display
     */
    formatAmount(amountInUnits: bigint): string {
        return this.jettonService.formatJettonAmount(amountInUnits, this.decimals);
    }

    /**
     * Parse USDT amount from string
     */
    parseAmount(amount: string): bigint {
        return this.jettonService.parseJettonAmount(amount, this.decimals);
    }
}

export default HighloadV3UsdtService;
