/**
 * Wallet Service
 *
 * Main wallet service providing transaction sending functionality
 * for all wallet types (v3r1, v3r2, v4r2, v5r1, highload-v3).
 * Also provides mnemonic generation, wallet import, and key export.
 */

import { mnemonicNew, mnemonicToPrivateKey } from '@ton/crypto';
import { V3R1WalletService } from '../wallets/v3r1/V3R1WalletService';
import { V3R2WalletService } from '../wallets/v3r2/V3R2WalletService';
import { V4R2WalletService } from '../wallets/v4r2/V4R2WalletService';
import { V5R1WalletService } from '../wallets/v5r1/V5R1WalletService';
import { HighloadWalletV3Service } from '../wallets/highload-v3';
import type { NetworkType } from '../types';

/** Convert the legacy boolean `testnet` param to a NetworkType string */
function toNetwork(testnet: boolean): NetworkType {
    return testnet ? 'testnet' : 'mainnet';
}

export class WalletService {
    /**
     * Generate a new 24-word mnemonic
     */
    async generateMnemonic(): Promise<string[]> {
        return mnemonicNew(24);
    }

    /**
     * Import wallet from mnemonic and wallet type.
     * Returns the wallet address.
     */
    async importWallet(
        mnemonic: string[],
        walletType: string
    ): Promise<{ address: string }> {
        let walletService: any;

        switch (walletType) {
            case 'v3r1':
                walletService = new V3R1WalletService();
                break;
            case 'v3r2':
                walletService = new V3R2WalletService();
                break;
            case 'v4r2':
                walletService = new V4R2WalletService();
                break;
            case 'v5r1':
                walletService = new V5R1WalletService();
                break;
            case 'highload-v3':
                walletService = new HighloadWalletV3Service();
                break;
            default:
                throw new Error(`Unsupported wallet type: ${walletType}`);
        }

        const walletInfo = await walletService.createFromMnemonic(mnemonic);
        return { address: walletInfo.address };
    }

    /**
     * Get the private key as a hex string from a mnemonic
     */
    async getPrivateKey(mnemonic: string[]): Promise<string> {
        const keyPair = await mnemonicToPrivateKey(mnemonic);
        return keyPair.secretKey.toString('hex');
    }

    /**
     * Send TON transfer
     */
    async sendTransaction(
        mnemonic: string[],
        walletType: string,
        recipient: string,
        amount: string,
        comment: string = '',
        testnet: boolean = false
    ): Promise<{ success: boolean; seqno: number | string }> {
        try {
            const keyPair = await mnemonicToPrivateKey(mnemonic);
            let walletService: any;
            const network = toNetwork(testnet);

            switch (walletType) {
                case 'v3r1':
                    walletService = new V3R1WalletService(network);
                    break;
                case 'v3r2':
                    walletService = new V3R2WalletService(network);
                    break;
                case 'v4r2':
                    walletService = new V4R2WalletService(network);
                    break;
                case 'v5r1':
                    walletService = new V5R1WalletService(network);
                    break;
                case 'highload-v3':
                    walletService = new HighloadWalletV3Service(network);
                    break;
                default:
                    throw new Error(`Unsupported wallet type: ${walletType}`);
            }

            const result = await walletService.sendTransaction(keyPair, recipient, amount, comment);
            return { success: true, seqno: result.seqno || result.queryId || 0 };
        } catch (error) {
            console.error('WalletService.sendTransaction error:', error);
            return { success: false, seqno: 0 };
        }
    }

    /**
     * Send jetton transfer
     */
    async sendJettonTransfer(
        mnemonic: string[],
        walletType: string,
        jettonWalletAddress: string,
        recipient: string,
        amount: number,
        decimals: number,
        comment: string = '',
        testnet: boolean = false
    ): Promise<{ success: boolean; seqno: number | string }> {
        try {
            const keyPair = await mnemonicToPrivateKey(mnemonic);
            let walletService: any;
            const network = toNetwork(testnet);

            switch (walletType) {
                case 'v3r1':
                    walletService = new V3R1WalletService(network);
                    break;
                case 'v3r2':
                    walletService = new V3R2WalletService(network);
                    break;
                case 'v4r2':
                    walletService = new V4R2WalletService(network);
                    break;
                case 'v5r1':
                    walletService = new V5R1WalletService(network);
                    break;
                case 'highload-v3':
                    walletService = new HighloadWalletV3Service(network);
                    break;
                default:
                    throw new Error(`Unsupported wallet type: ${walletType}`);
            }

            const result = await walletService.sendJettonTransfer(
                keyPair,
                jettonWalletAddress,
                recipient,
                amount,
                decimals,
                comment
            );
            return { success: true, seqno: result.seqno || result.queryId || 0 };
        } catch (error) {
            console.error('WalletService.sendJettonTransfer error:', error);
            return { success: false, seqno: 0 };
        }
    }
}

export default WalletService;