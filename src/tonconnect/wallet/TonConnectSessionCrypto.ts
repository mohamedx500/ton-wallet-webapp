import nacl from 'tweetnacl';

import { TonConnectWalletError } from './errors';
import type { TonConnectSessionKeyPair } from './types';

const PUBLIC_KEY_BYTES = 32;
const SECRET_KEY_BYTES = 32;
const NONCE_BYTES = 24;
const MIN_ENCRYPTED_BYTES = NONCE_BYTES + 16;

export interface TonConnectSessionCryptoOptions {
    readonly keyPair?: TonConnectSessionKeyPair;
    readonly randomBytes?: (length: number) => Uint8Array;
}

/**
 * In-memory X25519/NaCl box boundary for one wallet-side HTTP-bridge session.
 * Secret-key bytes are copied on construction and erased by `destroy()`.
 */
export class TonConnectSessionCrypto {
    private readonly publicKeyBytes: Uint8Array;
    private readonly secretKeyBytes: Uint8Array;
    private readonly randomBytes: (length: number) => Uint8Array;
    private destroyed = false;

    public constructor(options: TonConnectSessionCryptoOptions = {}) {
        const keyPair = options.keyPair === undefined
            ? nacl.box.keyPair()
            : decodeKeyPair(options.keyPair);
        this.publicKeyBytes = Uint8Array.from(keyPair.publicKey);
        this.secretKeyBytes = Uint8Array.from(keyPair.secretKey);
        this.randomBytes = options.randomBytes ?? ((length) => nacl.randomBytes(length));
    }

    public get clientId(): string {
        this.assertActive();
        return toHex(this.publicKeyBytes);
    }

    public exportKeyPair(): TonConnectSessionKeyPair {
        this.assertActive();
        return Object.freeze({
            publicKey: Uint8Array.from(this.publicKeyBytes),
            secretKey: Uint8Array.from(this.secretKeyBytes),
        });
    }

    public encrypt(plaintext: Uint8Array, peerPublicKey: Uint8Array): Uint8Array {
        this.assertActive();
        assertPeerKey(peerPublicKey);
        const nonce = this.randomBytes(NONCE_BYTES);
        if (nonce.byteLength !== NONCE_BYTES) {
            throw cryptoFailure('The TON Connect nonce source returned an invalid length.');
        }
        const ciphertext = nacl.box(plaintext, nonce, peerPublicKey, this.secretKeyBytes);
        const message = new Uint8Array(NONCE_BYTES + ciphertext.byteLength);
        message.set(nonce, 0);
        message.set(ciphertext, NONCE_BYTES);
        nonce.fill(0);
        return message;
    }

    public decrypt(message: Uint8Array, peerPublicKey: Uint8Array): Uint8Array {
        this.assertActive();
        assertPeerKey(peerPublicKey);
        if (message.byteLength < MIN_ENCRYPTED_BYTES) {
            throw cryptoFailure('The TON Connect encrypted message is truncated.');
        }
        const nonce = message.slice(0, NONCE_BYTES);
        const ciphertext = message.slice(NONCE_BYTES);
        const plaintext = nacl.box.open(ciphertext, nonce, peerPublicKey, this.secretKeyBytes);
        nonce.fill(0);
        ciphertext.fill(0);
        if (plaintext === null) {
            throw cryptoFailure('The TON Connect encrypted message failed authentication.');
        }
        return Uint8Array.from(plaintext);
    }

    public destroy(): void {
        if (this.destroyed) return;
        this.secretKeyBytes.fill(0);
        this.destroyed = true;
    }

    private assertActive(): void {
        if (this.destroyed) {
            throw cryptoFailure('The TON Connect session cryptography has been destroyed.');
        }
    }
}

function decodeKeyPair(value: TonConnectSessionKeyPair): TonConnectSessionKeyPair {
    if (value.publicKey.byteLength !== PUBLIC_KEY_BYTES || value.secretKey.byteLength !== SECRET_KEY_BYTES) {
        throw cryptoFailure('The TON Connect session keypair is invalid.');
    }
    const derived = nacl.box.keyPair.fromSecretKey(value.secretKey);
    if (!nacl.verify(derived.publicKey, value.publicKey)) {
        derived.secretKey.fill(0);
        throw cryptoFailure('The TON Connect session public and secret keys do not match.');
    }
    derived.secretKey.fill(0);
    return value;
}

function assertPeerKey(value: Uint8Array): void {
    if (value.byteLength !== PUBLIC_KEY_BYTES) {
        throw cryptoFailure('The TON Connect peer public key is invalid.');
    }
}

function toHex(value: Uint8Array): string {
    let result = '';
    for (const byte of value) result += byte.toString(16).padStart(2, '0');
    return result;
}

function cryptoFailure(message: string): TonConnectWalletError {
    return new TonConnectWalletError('SESSION_CRYPTO_FAILED', message);
}
