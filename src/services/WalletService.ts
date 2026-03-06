/**
 * Wallet Service
 *
 * Main wallet service providing transaction sending functionality
 * for all wallet types (v3r1, v3r2, v4r2, v5r1, highload-v3).
 */

import { mnemonicToPrivateKey } from '@ton/crypto';
import { WalletContractV3R1 } from '../wallets/v3r1/V3R1WalletService';
import { WalletContractV3R2 } from '../wallets/v3r2/V3R2WalletService';
import { WalletContractV4R2 } from '../wallets/v4r2/V4R2WalletService';
import { WalletContractV5R1 } from '../wallets/v5r1/V5R1WalletService';
import { HighloadWalletV3Service } from '../wallets/v3r2/HighloadWalletV3Service';

export class WalletService {
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

            switch (walletType) {
                case 'v3r1':
                    walletService = new WalletContractV3R1(testnet);
                    break;
                case 'v3r2':
                    walletService = new WalletContractV3R2(testnet);
                    break;
                case 'v4r2':
                    walletService = new WalletContractV4R2(testnet);
                    break;
                case 'v5r1':
                    walletService = new WalletContractV5R1(testnet);
                    break;
                case 'highload-v3':
                    walletService = new HighloadWalletV3Service(testnet);
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

            switch (walletType) {
                case 'v3r1':
                    walletService = new WalletContractV3R1(testnet);
                    break;
                case 'v3r2':
                    walletService = new WalletContractV3R2(testnet);
                    break;
                case 'v4r2':
                    walletService = new WalletContractV4R2(testnet);
                    break;
                case 'v5r1':
                    walletService = new WalletContractV5R1(testnet);
                    break;
                case 'highload-v3':
                    walletService = new HighloadWalletV3Service(testnet);
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