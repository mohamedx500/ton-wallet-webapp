/**
 * Standard Wallet Service
 * 
 * Unified interface for all standard wallet versions (V3R1, V3R2, V4R2, V5R1).
 * Provides a simple API for common wallet operations.
 */

import { TonClient } from '@ton/ton';
import { toNano } from '@ton/core';
import type {
    WalletVersion,
    WalletInfo,
    KeyPair,
    TransactionParams,
    TransactionResult,
    NetworkType
} from '../types';

import { V3R1WalletService } from './v3r1';
import { V3R2WalletService } from './v3r2';
import { V4R2WalletService } from './v4r2';
import { V5R1WalletService } from './v5r1';
import { MnemonicService } from '../crypto';

/**
 * Standard wallet versions (non-highload)
 */
export type StandardWalletVersion = 'v3r1' | 'v3r2' | 'v4r2' | 'v5r1';

/**
 * Standard Wallet Service
 */
export class StandardWalletService {
    private readonly network: NetworkType;
    private readonly mnemonicService: MnemonicService;

    // Wallet services
    private readonly v3r1: V3R1WalletService;
    private readonly v3r2: V3R2WalletService;
    private readonly v4r2: V4R2WalletService;
    private readonly v5r1: V5R1WalletService;

    constructor(network: NetworkType = 'mainnet') {
        this.network = network;
        this.mnemonicService = new MnemonicService();

        this.v3r1 = new V3R1WalletService(network);
        this.v3r2 = new V3R2WalletService(network);
        this.v4r2 = new V4R2WalletService(network);
        this.v5r1 = new V5R1WalletService(network);
    }

    /**
     * Generate new mnemonic
     */
    async generateMnemonic(wordCount: 12 | 24 = 24): Promise<string[]> {
        return this.mnemonicService.generateMnemonic(wordCount);
    }

    /**
     * Validate mnemonic
     */
    async validateMnemonic(mnemonic: string[]): Promise<boolean> {
        return this.mnemonicService.validateMnemonic(mnemonic);
    }

    /**
     * Create wallet from mnemonic
     */
    async createFromMnemonic(
        mnemonic: string[],
        version: StandardWalletVersion = 'v4r2'
    ): Promise<WalletInfo> {
        switch (version) {
            case 'v3r1':
                return this.v3r1.createFromMnemonic(mnemonic);
            case 'v3r2':
                return this.v3r2.createFromMnemonic(mnemonic);
            case 'v4r2':
                return this.v4r2.createFromMnemonic(mnemonic);
            case 'v5r1':
                return this.v5r1.createFromMnemonic(mnemonic);
            default:
                throw new Error(`Unsupported wallet version: ${version}`);
        }
    }

    /**
     * Get all wallet addresses for a mnemonic
     */
    async getAllAddresses(mnemonic: string[]): Promise<Record<StandardWalletVersion, string>> {
        const [v3r1, v3r2, v4r2, v5r1] = await Promise.all([
            this.v3r1.createFromMnemonic(mnemonic),
            this.v3r2.createFromMnemonic(mnemonic),
            this.v4r2.createFromMnemonic(mnemonic),
            this.v5r1.createFromMnemonic(mnemonic),
        ]);

        return {
            v3r1: v3r1.address,
            v3r2: v3r2.address,
            v4r2: v4r2.address,
            v5r1: v5r1.address,
        };
    }

    /**
     * Send TON transaction
     */
    async sendTransaction(
        client: TonClient,
        keyPair: KeyPair,
        version: StandardWalletVersion,
        params: TransactionParams
    ): Promise<TransactionResult> {
        switch (version) {
            case 'v3r1':
                return this.v3r1.sendTransaction(client, keyPair, params);
            case 'v3r2':
                return this.v3r2.sendTransaction(client, keyPair, params);
            case 'v4r2':
                return this.v4r2.sendTransaction(client, keyPair, params);
            case 'v5r1':
                return this.v5r1.sendTransaction(client, keyPair, params);
            default:
                throw new Error(`Unsupported wallet version: ${version}`);
        }
    }

    /**
     * Send TON with simpler interface
     */
    async sendTon(
        client: TonClient,
        mnemonic: string[],
        version: StandardWalletVersion,
        to: string,
        amount: number | bigint,
        comment?: string
    ): Promise<TransactionResult> {
        const wallet = await this.createFromMnemonic(mnemonic, version);
        const amountNano = typeof amount === 'number' ? toNano(amount.toString()) : amount;

        return this.sendTransaction(client, wallet.keyPair, version, {
            to,
            amount: amountNano,
            comment,
        });
    }

    /**
     * Get seqno for wallet
     */
    async getSeqno(
        client: TonClient,
        keyPair: KeyPair,
        version: StandardWalletVersion
    ): Promise<number> {
        switch (version) {
            case 'v3r1':
                return this.v3r1.getSeqno(client, keyPair);
            case 'v3r2':
                return this.v3r2.getSeqno(client, keyPair);
            case 'v4r2':
                return this.v4r2.getSeqno(client, keyPair);
            default:
                throw new Error(`Unsupported wallet version for seqno: ${version}`);
        }
    }

    /**
     * Get network
     */
    getNetwork(): NetworkType {
        return this.network;
    }

    /**
     * Create service for different network
     */
    withNetwork(network: NetworkType): StandardWalletService {
        return new StandardWalletService(network);
    }
}

/**
 * Create default standard wallet service
 */
export function createStandardWalletService(network: NetworkType = 'mainnet'): StandardWalletService {
    return new StandardWalletService(network);
}

export default StandardWalletService;
