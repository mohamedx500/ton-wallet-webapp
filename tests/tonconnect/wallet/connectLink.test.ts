import { describe, expect, it, vi, beforeEach } from 'vitest';
import { WalletContractV4 } from '@ton/ton';
import { keyPairFromSeed } from '@ton/crypto';
import { TonConnectWalletService } from '../../../src/tonconnect/wallet/TonConnectWalletService';
import { TonConnectSessionStore } from '../../../src/tonconnect/wallet/TonConnectSessionStore';
import type { TonConnectLink, TonConnectSynchronousStorage } from '../../../src/tonconnect/wallet/types';
import { SAMPLE_TON_CONNECT_URI } from '../fixtures';
import { classifyScanResult } from '../../../src/qr/classifier';

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

function linkFromSample(): TonConnectLink {
    const result = classifyScanResult(SAMPLE_TON_CONNECT_URI, 'mainnet');
    if (result.kind !== 'TON_CONNECT_LINK') throw new Error('fixture invalid');
    return result.link;
}

const VALID_MANIFEST = {
    url: 'https://tonviewer.com',
    name: 'Tonviewer',
    iconUrl: 'https://tonviewer.com/tonconnect.png',
};

describe('TonConnectWalletService connect link handling', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('previewConnectLink fetches manifest without creating a session', async () => {
        const storage = new MemoryStorage();
        const service = new TonConnectWalletService({
            network: 'mainnet',
            store: new TonConnectSessionStore({ storage }),
        });

        vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: true,
            text: async () => JSON.stringify(VALID_MANIFEST),
        } as Response);

        const link = linkFromSample();
        const manifest = await service.previewConnectLink(link);

        expect(manifest.name).toBe('Tonviewer');
        expect(service.getSessions()).toHaveLength(0);
    });

    it('falls back to the manifest proxy when direct fetch is blocked', async () => {
        const storage = new MemoryStorage();
        const service = new TonConnectWalletService({
            network: 'mainnet',
            store: new TonConnectSessionStore({ storage }),
        });
        const link = linkFromSample();

        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
            const url = String(input);
            if (url.startsWith('https://walletbot.me/tonconnect-proxy/')) {
                return {
                    ok: true,
                    text: async () => JSON.stringify(VALID_MANIFEST),
                } as Response;
            }
            throw new TypeError('Failed to fetch');
        });

        const manifest = await service.previewConnectLink(link);
        expect(manifest.name).toBe('Tonviewer');
    });

    it('reconnects when a stale session already exists for the same wallet/app pair', async () => {
        const storage = new MemoryStorage();
        const service = new TonConnectWalletService({
            network: 'mainnet',
            store: new TonConnectSessionStore({ storage }),
        });
        const link = linkFromSample();
        const keyPair = keyPairFromSeed(Buffer.alloc(32, 7));
        const walletAddress = WalletContractV4.create({
            publicKey: keyPair.publicKey,
            workchain: 0,
            walletId: 698983191,
        }).address.toRawString();

        storage.setItem(
            'ton-wallet:tonconnect:sessions:v1:mainnet:account-1:' + link.appClientId,
            JSON.stringify({
                schemaVersion: 1,
                network: 'mainnet',
                accountId: 'account-1',
                accountAddress: walletAddress,
                appClientId: link.appClientId,
                walletClientId: '33'.repeat(32),
                walletSecretKey: '44'.repeat(32),
                walletDescriptor: {
                    kind: 'standard',
                    version: 'v4r2',
                    address: walletAddress,
                    subwalletId: 698983191,
                },
                manifestUrl: link.request.manifestUrl,
                manifestOrigin: 'https://tonviewer.com',
                bridgeUrl: 'https://bridge.tonapi.io/bridge',
                createdAtMs: 1,
                lastRequestId: null,
                nextEventId: 0,
            }),
        );

        expect(service.getExistingSession('account-1', link.appClientId)).not.toBeNull();

        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
            const url = String(input);
            if (url.includes('tonconnect-manifest') || url.includes('tonconnect-proxy')) {
                return { ok: true, text: async () => JSON.stringify(VALID_MANIFEST) } as Response;
            }
            if (url.includes('/bridge/message') && init?.method === 'POST') {
                return { ok: true } as Response;
            }
            return { ok: true } as Response;
        });

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

        await service.handleConnectLink(
            link,
            'account-1',
            walletAddress,
            {
                kind: 'standard',
                version: 'v4r2',
                address: walletAddress,
                subwalletId: 698983191,
            } as any,
            keyPair.publicKey,
            { walletAddress, sign: async () => new Uint8Array(64) },
        );

        expect(service.getSessions()).toHaveLength(1);
        expect(service.getExistingSession('account-1', link.appClientId)?.walletClientId).not.toBe('33'.repeat(32));
        keyPair.secretKey.fill(0);
    });
});
