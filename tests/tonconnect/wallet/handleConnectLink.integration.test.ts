import { describe, expect, it, vi, beforeEach } from 'vitest';
import { WalletContractV4 } from '@ton/ton';
import { keyPairFromSeed, sign } from '@ton/crypto';

import { TonConnectWalletService } from '../../../src/tonconnect/wallet/TonConnectWalletService';
import { TonConnectSessionStore } from '../../../src/tonconnect/wallet/TonConnectSessionStore';
import type { TonConnectLink, TonConnectSynchronousStorage } from '../../../src/tonconnect/wallet/types';
import { classifyScanResult } from '../../../src/qr/classifier';

const FRAGMENT_MANIFEST = {
    url: 'https://fragment.com',
    name: 'Fragment',
    iconUrl: 'https://fragment.com/img/fragment_tonconnect_icon.png',
};

const FRAGMENT_URI =
    'tc://?v=2&id=cac658bb2653b86ba26f485f753f6d08b34d20ddbe17ac03e9186dd314d3bc0c'
    + '&r=%7B%22manifestUrl%22%3A%22https%3A%2F%2Ffragment.com%2Ftonconnect-manifest.json%22%2C%22items%22%3A%5B%7B%22name%22%3A%22ton_addr%22%7D%2C%7B%22name%22%3A%22ton_proof%22%2C%22payload%22%3A%22ed78500d3124c43f1f012fa04334267a63b86003fef0d432939eb8cb993597a5%22%7D%5D%7D'
    + '&ret=none';

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

function fragmentLink(): TonConnectLink {
    const result = classifyScanResult(FRAGMENT_URI, 'mainnet');
    if (result.kind !== 'TON_CONNECT_LINK') throw new Error('fixture invalid');
    return result.link;
}

describe('handleConnectLink integration', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        class MockEventSource {
            public onopen: (() => void) | null = null;
            public onmessage: ((event: MessageEvent) => void) | null = null;
            public onerror: (() => void) | null = null;
            public close = vi.fn();
            public addEventListener = vi.fn((event: string, handler: () => void) => {
                if (event === 'open') queueMicrotask(() => handler());
            });
            public constructor(_url: string) {}
        }
        vi.stubGlobal('EventSource', MockEventSource);
    });

    it('completes a Fragment-like connect flow with ton_proof', async () => {
        const storage = new MemoryStorage();
        const service = new TonConnectWalletService({
            network: 'mainnet',
            store: new TonConnectSessionStore({ storage }),
        });
        const link = fragmentLink();
        const keyPair = keyPairFromSeed(Buffer.alloc(32, 11));
        const walletAddress = WalletContractV4.create({
            publicKey: keyPair.publicKey,
            workchain: 0,
            walletId: 698983191,
        }).address.toRawString();

        const sendSpy = vi.fn().mockResolvedValue(undefined);
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
            const url = String(input);
            if (url.includes('/tonconnect-manifest.json') || url.includes('tonconnect-proxy')) {
                return { ok: true, text: async () => JSON.stringify(FRAGMENT_MANIFEST) } as Response;
            }
            if (url.includes('/bridge/message') && init?.method === 'POST') {
                sendSpy(init.body);
                return { ok: true } as Response;
            }
            throw new Error(`Unexpected fetch: ${url}`);
        });

        await service.handleConnectLink(
            link,
            'account-1',
            walletAddress,
            {
                kind: 'standard',
                version: 'v4r2',
                address: walletAddress,
                subwalletId: 698983191,
            },
            keyPair.publicKey,
            {
                walletAddress,
                sign: async (hash) => new Uint8Array(sign(Buffer.from(hash), keyPair.secretKey)),
            },
        );

        expect(sendSpy).toHaveBeenCalledOnce();
        expect(service.getSessions()).toHaveLength(1);

        keyPair.secretKey.fill(0);
    });
});
