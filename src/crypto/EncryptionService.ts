/**
 * Encryption Service
 * 
 * Handles AES-256-GCM encryption for secure key storage.
 * Uses Web Crypto API for browser compatibility and PBKDF2 for key derivation.
 */

import type { EncryptedData, SecurityConfig } from '../types';

/**
 * Default security configuration
 */
const DEFAULT_SECURITY_CONFIG: SecurityConfig = {
    iterations: 100000,
    saltBytes: 16,
    algorithm: 'AES-GCM',
    keyLength: 256,
};

/**
 * Encryption Service
 */
export class EncryptionService {
    private readonly config: SecurityConfig;

    constructor(config?: Partial<SecurityConfig>) {
        this.config = { ...DEFAULT_SECURITY_CONFIG, ...config };
    }

    /**
     * Encrypt data with password using AES-256-GCM
     */
    async encrypt(data: string | object, password: string): Promise<EncryptedData> {
        const encoder = new TextEncoder();
        const dataString = typeof data === 'string' ? data : JSON.stringify(data);

        // Generate random salt and IV
        const salt = crypto.getRandomValues(new Uint8Array(this.config.saltBytes));
        const iv = crypto.getRandomValues(new Uint8Array(12)); // 96 bits for GCM

        // Derive key from password
        const key = await this.deriveKey(password, salt);

        // Encrypt
        const encrypted = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: iv as BufferSource },
            key,
            encoder.encode(dataString)
        );

        return {
            iv: this.bytesToHex(iv),
            data: this.bytesToHex(new Uint8Array(encrypted)),
            salt: this.bytesToHex(salt),
            version: 1,
        };
    }

    /**
     * Decrypt data with password
     */
    async decrypt(encryptedData: EncryptedData, password: string): Promise<string> {
        const decoder = new TextDecoder();

        const iv = this.hexToBytes(encryptedData.iv);
        const data = this.hexToBytes(encryptedData.data);
        const salt = this.hexToBytes(encryptedData.salt);

        // Derive key from password
        const key = await this.deriveKey(password, salt);

        // Decrypt
        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: iv as BufferSource },
            key,
            data as BufferSource
        );

        return decoder.decode(decrypted);
    }

    /**
     * Derive encryption key from password using PBKDF2
     */
    private async deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
        const encoder = new TextEncoder();

        // Import password as key material
        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            encoder.encode(password),
            'PBKDF2',
            false,
            ['deriveKey']
        );

        // Derive AES key
        return crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: salt as BufferSource,
                iterations: this.config.iterations,
                hash: 'SHA-256',
            },
            keyMaterial,
            { name: 'AES-GCM', length: this.config.keyLength },
            false,
            ['encrypt', 'decrypt']
        );
    }

    /**
     * Hash password for storage verification
     */
    async hashPassword(password: string, salt?: Uint8Array): Promise<{ hash: string; salt: string }> {
        const encoder = new TextEncoder();
        const passwordSalt = salt ?? crypto.getRandomValues(new Uint8Array(this.config.saltBytes));

        // Import password as key material
        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            encoder.encode(password),
            'PBKDF2',
            false,
            ['deriveBits']
        );

        // Derive bits
        const derivedBits = await crypto.subtle.deriveBits(
            {
                name: 'PBKDF2',
                salt: passwordSalt as BufferSource,
                iterations: this.config.iterations,
                hash: 'SHA-256',
            },
            keyMaterial,
            256
        );

        return {
            hash: this.bytesToHex(new Uint8Array(derivedBits)),
            salt: this.bytesToHex(passwordSalt),
        };
    }

    /**
     * Verify password against stored hash
     */
    async verifyPassword(password: string, storedHash: string, salt: string): Promise<boolean> {
        const saltBytes = this.hexToBytes(salt);
        const { hash } = await this.hashPassword(password, saltBytes);
        return hash === storedHash;
    }

    /**
     * Convert bytes to hex string
     */
    private bytesToHex(bytes: Uint8Array): string {
        return Array.from(bytes)
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }

    /**
     * Convert hex string to bytes
     */
    private hexToBytes(hex: string): Uint8Array {
        const bytes = new Uint8Array(hex.length / 2);
        for (let i = 0; i < bytes.length; i++) {
            bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
        }
        return bytes;
    }
}

/**
 * Create default encryption service
 */
export function createEncryptionService(config?: Partial<SecurityConfig>): EncryptionService {
    return new EncryptionService(config);
}

export default EncryptionService;
