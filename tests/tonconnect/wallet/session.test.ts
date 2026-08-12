import nacl from 'tweetnacl';
import { describe, expect, it } from 'vitest';

import {
    TonConnectSessionCrypto,
    TonConnectSessionStore,
    TonConnectWalletError,
} from '../../../src/tonconnect/wallet';
import type {
    TonConnectStoredSession,
    TonConnectSynchronousStorage,
} from '../../../src/tonconnect/wallet';

class MemoryStorage implements TonConnectSynchronousStorage {
    public readonly values = new Map<string, string>();

    public getItem(key: string): string | null {
        return this.values.get(key) ?? null;
    }

    public setItem(key: string, value: string): void {
        this.values.set(key, value);
    }

    public removeItem(key: string): void {
        this.values.delete(key);
    }

    public get length(): number {
        return this.values.size;
    }

    public key(index: number): string | null {
        return Array.from(this.values.keys())[index] ?? null;
    }
}

function fixture(): TonConnectStoredSession {
    return Object.freeze({
        schemaVersion: 1,
        network: 'mainnet',
        accountId: 'account-1',
        accountAddress: `0:${'11'.repeat(32)}`,
        appClientId: '22'.repeat(32),
        walletClientId: '33'.repeat(32),
        walletSecretKey: '44'.repeat(32),
        walletDescriptor: {
            kind: 'standard',
            version: 'v4r2',
            address: `0:${'11'.repeat(32)}`,
            subwalletId: 698983191,
        } as any,
        manifestUrl: 'https://app.example/tonconnect-manifest.json',
        manifestOrigin: 'https://app.example',
        appName: 'Example App',
        appIconUrl: 'https://app.example/icon.png',
        bridgeUrl: 'https://connect.ton.org/bridge/',
        createdAtMs: 1_700_000_000_000,
        lastRequestId: null,
        nextEventId: 0,
    });
}

describe('wallet-side TON Connect session crypto', () => {
    it('interoperates with NaCl box using nonce-prefixed ciphertext', () => {
        const peer = nacl.box.keyPair();
        const wallet = new TonConnectSessionCrypto({
            randomBytes: (length) => Uint8Array.from({ length }, (_, index) => index + 1),
        });
        const plaintext = new TextEncoder().encode('{"method":"disconnect"}');
        const encrypted = wallet.encrypt(plaintext, peer.publicKey);
        const walletKeyPair = wallet.exportKeyPair();

        expect(encrypted.slice(0, 24)).toEqual(Uint8Array.from({ length: 24 }, (_, index) => index + 1));
        const opened = nacl.box.open(
            encrypted.slice(24),
            encrypted.slice(0, 24),
            walletKeyPair.publicKey,
            peer.secretKey,
        );
        expect(new TextDecoder().decode(opened ?? new Uint8Array())).toBe('{"method":"disconnect"}');
        walletKeyPair.secretKey.fill(0);
        peer.secretKey.fill(0);
        wallet.destroy();
    });

    it('decrypts peer messages and rejects tampering', () => {
        const peer = nacl.box.keyPair();
        const wallet = new TonConnectSessionCrypto();
        const walletKeys = wallet.exportKeyPair();
        const nonce = nacl.randomBytes(24);
        const body = new TextEncoder().encode('secret request');
        const encrypted = nacl.box(body, nonce, walletKeys.publicKey, peer.secretKey);
        const message = new Uint8Array(nonce.length + encrypted.length);
        message.set(nonce);
        message.set(encrypted, nonce.length);

        expect(new TextDecoder().decode(wallet.decrypt(message, peer.publicKey))).toBe('secret request');
        message[message.length - 1] = (message[message.length - 1] ?? 0) ^ 1;
        expect(() => wallet.decrypt(message, peer.publicKey)).toThrow(TonConnectWalletError);
        walletKeys.secretKey.fill(0);
        peer.secretKey.fill(0);
        wallet.destroy();
    });

    it('refuses operations after key destruction', () => {
        const wallet = new TonConnectSessionCrypto();
        wallet.destroy();
        expect(() => wallet.clientId).toThrow(TonConnectWalletError);
        expect(() => wallet.exportKeyPair()).toThrow(TonConnectWalletError);
    });
});

describe('wallet-side TON Connect session storage', () => {
    it('round-trips an exact network/account/app-scoped session', () => {
        const storage = new MemoryStorage();
        const store = new TonConnectSessionStore({ storage });
        const session = fixture();
        store.put(session);

        const restored = store.get('mainnet', 'account-1', session.appClientId);
        expect(restored).toEqual(session);
        expect(Object.isFrozen(restored)).toBe(true);
        expect([...storage.values.keys()][0]).toContain(':mainnet:account-1:');

        store.remove('mainnet', 'account-1', session.appClientId);
        expect(store.get('mainnet', 'account-1', session.appClientId)).toBeNull();
    });

    it('lists and clears all sessions for an account', () => {
        const storage = new MemoryStorage();
        const store = new TonConnectSessionStore({ storage });
        const first = fixture();
        const second = Object.freeze({
            ...first,
            appClientId: '55'.repeat(32),
            walletClientId: '66'.repeat(32),
            walletSecretKey: '77'.repeat(32),
            appName: null,
            appIconUrl: null,
        });
        store.put(first);
        store.put(second);
        expect(store.listForAccount('mainnet', 'account-1')).toHaveLength(2);
        store.removeAllForAccount('mainnet', 'account-1');
        expect(store.listForAccount('mainnet', 'account-1')).toHaveLength(0);
    });

    it('accepts legacy sessions without appName/appIconUrl', () => {
        const storage = new MemoryStorage();
        const store = new TonConnectSessionStore({ storage });
        const session = fixture();
        const { appName: _n, appIconUrl: _i, ...legacy } = session as any;
        storage.setItem(
            `ton-wallet:tonconnect:sessions:v1:mainnet:account-1:${session.appClientId}`,
            JSON.stringify(legacy),
        );
        const loaded = store.get('mainnet', 'account-1', session.appClientId);
        expect(loaded?.appName).toBeNull();
        expect(loaded?.appIconUrl).toBeNull();
    });

    it('fails closed on unknown fields, malformed secrets, and cross-schema records', () => {
        const storage = new MemoryStorage();
        const store = new TonConnectSessionStore({ storage });
        const session = fixture();
        const key = `ton-wallet:tonconnect:sessions:v1:mainnet:account-1:${session.appClientId}`;
        storage.values.set(key, JSON.stringify({ ...session, unknown: true }));
        expect(() => store.get('mainnet', 'account-1', session.appClientId)).toThrow(TonConnectWalletError);
        storage.values.set(key, JSON.stringify({ ...session, walletSecretKey: 'bad' }));
        expect(() => store.get('mainnet', 'account-1', session.appClientId)).toThrow(TonConnectWalletError);
        storage.values.set(key, JSON.stringify({ ...session, schemaVersion: 2 }));
        expect(() => store.get('mainnet', 'account-1', session.appClientId)).toThrow(TonConnectWalletError);
    });
});
