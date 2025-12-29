/**
 * Mnemonic Service
 * 
 * Handles BIP-39 mnemonic generation and key derivation.
 */

import { mnemonicNew, mnemonicValidate, mnemonicToPrivateKey } from '@ton/crypto';
import type { KeyPair } from '../types';

/**
 * Mnemonic word count
 */
export type MnemonicLength = 12 | 24;

/**
 * Mnemonic Service
 */
export class MnemonicService {
    /**
     * Generate new mnemonic phrase
     */
    async generateMnemonic(wordCount: MnemonicLength = 24): Promise<string[]> {
        return mnemonicNew(wordCount);
    }

    /**
     * Validate mnemonic phrase
     */
    async validateMnemonic(mnemonic: string[]): Promise<boolean> {
        try {
            return await mnemonicValidate(mnemonic);
        } catch {
            return false;
        }
    }

    /**
     * Convert mnemonic to key pair
     */
    async mnemonicToKeyPair(mnemonic: string[]): Promise<KeyPair> {
        const keyPair = await mnemonicToPrivateKey(mnemonic);
        return {
            publicKey: keyPair.publicKey,
            secretKey: keyPair.secretKey,
        };
    }

    /**
     * Parse mnemonic from string
     */
    parseMnemonic(mnemonicString: string): string[] {
        return mnemonicString.trim().split(/\s+/);
    }

    /**
     * Format mnemonic to string
     */
    formatMnemonic(mnemonic: string[]): string {
        return mnemonic.join(' ');
    }

    /**
     * Check if mnemonic has correct word count
     */
    isValidWordCount(mnemonic: string[]): boolean {
        return mnemonic.length === 12 || mnemonic.length === 24;
    }

    /**
     * Get public key from mnemonic
     */
    async getPublicKey(mnemonic: string[]): Promise<Buffer> {
        const keyPair = await this.mnemonicToKeyPair(mnemonic);
        return keyPair.publicKey;
    }

    /**
     * Get public key hex from mnemonic
     */
    async getPublicKeyHex(mnemonic: string[]): Promise<string> {
        const publicKey = await this.getPublicKey(mnemonic);
        return publicKey.toString('hex');
    }
}

/**
 * Create default mnemonic service
 */
export function createMnemonicService(): MnemonicService {
    return new MnemonicService();
}

export default MnemonicService;
