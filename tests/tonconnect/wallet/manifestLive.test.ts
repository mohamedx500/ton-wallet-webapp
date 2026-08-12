import { describe, expect, it } from 'vitest';
import { classifyScanResult } from '../../../src/qr/classifier';
import { TonConnectWalletService } from '../../../src/tonconnect/wallet/TonConnectWalletService';
import { TonConnectSessionStore } from '../../../src/tonconnect/wallet/TonConnectSessionStore';
import type { TonConnectSynchronousStorage } from '../../../src/tonconnect/wallet/types';
import { SAMPLE_TON_CONNECT_URI } from '../fixtures';

class MemoryStorage implements TonConnectSynchronousStorage {
    public readonly values = new Map<string, string>();
    public getItem(key: string): string | null { return this.values.get(key) ?? null; }
    public setItem(key: string, value: string): void { this.values.set(key, value); }
    public removeItem(key: string): void { this.values.delete(key); }
}

describe('live TON Connect manifest fetch', () => {
    it('loads the tonviewer manifest through the wallet proxy fallback', async () => {
        const service = new TonConnectWalletService({
            network: 'mainnet',
            store: new TonConnectSessionStore({ storage: new MemoryStorage() }),
        });
        const result = classifyScanResult(SAMPLE_TON_CONNECT_URI, 'mainnet');
        if (result.kind !== 'TON_CONNECT_LINK') throw new Error('fixture invalid');

        const manifest = await service.previewConnectLink(result.link);
        expect(manifest.name).toBe('Tonviewer');
        expect(manifest.origin).toBe('https://tonviewer.com');
    });
});
