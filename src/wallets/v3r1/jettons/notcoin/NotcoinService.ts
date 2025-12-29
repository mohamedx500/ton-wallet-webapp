/**
 * NOT Coin Service for V3R1 Wallets
 * 
 * Specialized service for handling NOT Coin transfers.
 * NOT Coin on TON uses 9 decimals.
 */

import { TonClient } from '@ton/ton';
import type { KeyPair, TransactionResult, NetworkType } from '../../../../types';
import { V3R1JettonService } from '../JettonService';

/**
 * NOT Coin Master Contract Address
 */
export const NOTCOIN_MASTER_ADDRESS = {
    mainnet: 'EQAvlWFDxGF2lXm67y4yzC17wYKD9A0guwPkMs1gOsM__NOT',
    testnet: '', // NOT coin typically not on testnet
};

/**
 * NOT Coin Service for V3R1 Wallets
 */
export class V3R1NotcoinService {
    private readonly jettonService: V3R1JettonService;
    private readonly network: NetworkType;
    private readonly decimals = 9;

    constructor(network: NetworkType = 'mainnet') {
        this.network = network;
        this.jettonService = new V3R1JettonService(network);
    }

    /**
     * Get NOT Coin master address for current network
     */
    getMasterAddress(): string {
        const address = NOTCOIN_MASTER_ADDRESS[this.network];
        if (!address) {
            throw new Error(`NOT Coin not available on ${this.network}`);
        }
        return address;
    }

    /**
     * Get user's NOT Coin wallet address
     */
    async getNotcoinWalletAddress(ownerAddress: string): Promise<string | null> {
        try {
            return this.jettonService.getJettonWalletAddress(
                ownerAddress,
                this.getMasterAddress()
            );
        } catch {
            return null;
        }
    }

    /**
     * Get NOT Coin balance
     */
    async getBalance(ownerAddress: string): Promise<{
        balance: bigint;
        formatted: string;
        walletAddress: string | null;
    }> {
        try {
            const walletAddress = await this.getNotcoinWalletAddress(ownerAddress);

            if (!walletAddress) {
                return {
                    balance: 0n,
                    formatted: '0',
                    walletAddress: null,
                };
            }

            const balances = await this.jettonService.getJettonBalances(ownerAddress);
            const notBalance = balances.find(
                b => b.jetton.symbol.toUpperCase() === 'NOT' ||
                    b.jetton.address.includes('NOT')
            );

            if (!notBalance) {
                return {
                    balance: 0n,
                    formatted: '0',
                    walletAddress,
                };
            }

            return {
                balance: notBalance.balance,
                formatted: notBalance.balanceFormatted,
                walletAddress,
            };
        } catch {
            return {
                balance: 0n,
                formatted: '0',
                walletAddress: null,
            };
        }
    }

    /**
     * Send NOT Coin transfer
     * @param amount - Amount in NOT (e.g., 1000 for 1000 NOT)
     */
    async sendNotcoin(
        client: TonClient,
        keyPair: KeyPair,
        senderAddress: string,
        recipientAddress: string,
        amount: number,
        comment?: string
    ): Promise<TransactionResult> {
        // Get sender's NOT Coin wallet address
        const notWalletAddress = await this.getNotcoinWalletAddress(senderAddress);

        if (!notWalletAddress) {
            return {
                success: false,
                error: 'NOT Coin wallet not found. You may not have any NOT.',
            };
        }

        // Convert amount to smallest units (9 decimals)
        const amountInUnits = this.jettonService.parseJettonAmount(
            amount.toString(),
            this.decimals
        );

        return this.jettonService.sendTransfer(client, keyPair, {
            to: recipientAddress,
            amount: amountInUnits,
            jettonWalletAddress: notWalletAddress,
            decimals: this.decimals,
            comment,
        });
    }

    /**
     * Format NOT Coin amount for display
     */
    formatAmount(amountInUnits: bigint): string {
        return this.jettonService.formatJettonAmount(amountInUnits, this.decimals);
    }

    /**
     * Parse NOT Coin amount from string
     */
    parseAmount(amount: string): bigint {
        return this.jettonService.parseJettonAmount(amount, this.decimals);
    }
}

export default V3R1NotcoinService;
