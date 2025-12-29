/**
 * SecurityService - Handles password encryption and verification
 * Uses Web Crypto API for secure password hashing
 */

export class SecurityService {
    constructor() {
        this.STORAGE_KEY = 'ton_wallet_security';
    }

    /**
     * Hash password using PBKDF2
     */
    async hashPassword(password, salt = null) {
        const encoder = new TextEncoder();

        // Generate salt if not provided
        if (!salt) {
            salt = crypto.getRandomValues(new Uint8Array(16));
        } else if (typeof salt === 'string') {
            salt = this._hexToBytes(salt);
        }

        // Import password as key material
        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            encoder.encode(password),
            'PBKDF2',
            false,
            ['deriveBits']
        );

        // Derive key using PBKDF2
        const derivedBits = await crypto.subtle.deriveBits(
            {
                name: 'PBKDF2',
                salt: salt,
                iterations: 100000,
                hash: 'SHA-256'
            },
            keyMaterial,
            256
        );

        const hash = this._bytesToHex(new Uint8Array(derivedBits));
        const saltHex = this._bytesToHex(salt);

        return { hash, salt: saltHex };
    }

    /**
     * Set up password for the wallet
     */
    async setupPassword(password) {
        const { hash, salt } = await this.hashPassword(password);

        const securityData = {
            passwordHash: hash,
            salt: salt,
            setupDate: Date.now()
        };

        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(securityData));
        return true;
    }

    /**
     * Verify password
     */
    async verifyPassword(password) {
        const securityData = this.getSecurityData();
        if (!securityData) {
            return false;
        }

        const { hash } = await this.hashPassword(password, securityData.salt);
        return hash === securityData.passwordHash;
    }

    /**
     * Check if password is set up
     */
    hasPassword() {
        const data = this.getSecurityData();
        return data && data.passwordHash;
    }

    /**
     * Get security data from storage
     */
    getSecurityData() {
        try {
            const data = localStorage.getItem(this.STORAGE_KEY);
            return data ? JSON.parse(data) : null;
        } catch (e) {
            console.error('Error reading security data:', e);
            return null;
        }
    }

    /**
     * Clear security data (on logout)
     */
    clearSecurityData() {
        localStorage.removeItem(this.STORAGE_KEY);
    }

    /**
     * Encrypt data with password
     */
    async encryptData(data, password) {
        const encoder = new TextEncoder();
        const dataString = typeof data === 'string' ? data : JSON.stringify(data);

        // Generate IV
        const iv = crypto.getRandomValues(new Uint8Array(12));

        // Derive key from password
        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            encoder.encode(password),
            'PBKDF2',
            false,
            ['deriveKey']
        );

        const key = await crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: encoder.encode('ton-wallet-salt'),
                iterations: 100000,
                hash: 'SHA-256'
            },
            keyMaterial,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt']
        );

        // Encrypt
        const encrypted = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            key,
            encoder.encode(dataString)
        );

        return {
            iv: this._bytesToHex(iv),
            data: this._bytesToHex(new Uint8Array(encrypted))
        };
    }

    /**
     * Decrypt data with password
     */
    async decryptData(encryptedData, password) {
        const encoder = new TextEncoder();
        const decoder = new TextDecoder();

        const iv = this._hexToBytes(encryptedData.iv);
        const data = this._hexToBytes(encryptedData.data);

        // Derive key from password
        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            encoder.encode(password),
            'PBKDF2',
            false,
            ['deriveKey']
        );

        const key = await crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: encoder.encode('ton-wallet-salt'),
                iterations: 100000,
                hash: 'SHA-256'
            },
            keyMaterial,
            { name: 'AES-GCM', length: 256 },
            false,
            ['decrypt']
        );

        // Decrypt
        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            key,
            data
        );

        return decoder.decode(decrypted);
    }

    // Helper: bytes to hex
    _bytesToHex(bytes) {
        return Array.from(bytes)
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }

    // Helper: hex to bytes
    _hexToBytes(hex) {
        const bytes = new Uint8Array(hex.length / 2);
        for (let i = 0; i < bytes.length; i++) {
            bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
        }
        return bytes;
    }
}
