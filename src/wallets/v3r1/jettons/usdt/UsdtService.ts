/**
 * USDT Token Service for V3R1 Wallets
 * 
 * Specialized service for handling USDT (Tether) transfers.
 * USDT on TON uses 6 decimals.
 */

import { TonClient } from '@ton/ton';
import { toNano } from '@ton/core';
import type { KeyPair, TransactionResult, NetworkType } from '../../../../types';
import { V3R1JettonService } from '../JettonService';

/**
 * USDT Master Contract Addresses
 */
export const USDT_MASTER_ADDRESS = {
    mainnet: 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs',
    testnet: 'EQBynBO23ywHy_CgarY9NK9FTz0yDsG82PtcbSTQgGoXwiuA',
};

/**
 * USDT Service for V3R1 Wallets
 */
export class V3R1UsdtService {
    private readonly jettonService: V3R1JettonService;
    private readonly network: NetworkType;
    private readonly decimals = 6;

    constructor(network: NetworkType = 'mainnet') {
        this.network = network;
        this.jettonService = new V3R1JettonService(network);
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

        const balances = await this.jettonService.getJettonBalances(ownerAddress);
        const usdtBalance = balances.find(
            b => b.jetton.address.toLowerCase() === this.getMasterAddress().toLowerCase()
        );

        if (!usdtBalance) {
            return {
                balance: 0n,
                formatted: '0.00',
                walletAddress,
            };
        }

        return {
            balance: usdtBalance.balance,
            formatted: usdtBalance.balanceFormatted,
            walletAddress,
        };
    }

    /**
     * Send USDT transfer
     * @param amount - Amount in USDT (e.g., 10.5 for 10.5 USDT)
     */
    async sendUsdt(
        client: TonClient,
        keyPair: KeyPair,
        senderAddress: string,
        recipientAddress: string,
        amount: number,
        comment?: string
    ): Promise<TransactionResult> {
        // Get sender's USDT wallet address
        const usdtWalletAddress = await this.getUsdtWalletAddress(senderAddress);

        if (!usdtWalletAddress) {
            return {
                success: false,
                error: 'USDT wallet not found. You may not have any USDT.',
            };
        }

        // Convert amount to smallest units (6 decimals)
        const amountInUnits = this.jettonService.parseJettonAmount(
            amount.toString(),
            this.decimals
        );

        return this.jettonService.sendTransfer(client, keyPair, {
            to: recipientAddress,
            amount: amountInUnits,
            jettonWalletAddress: usdtWalletAddress,
            decimals: this.decimals,
            comment,
        });
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

export default V3R1UsdtService;
