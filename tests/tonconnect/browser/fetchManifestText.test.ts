import { describe, expect, it, vi, beforeEach } from 'vitest';
import { browserFetchManifestText, resolveSameOriginManifestProxyUrl } from '../../../src/tonconnect/browser/fetchManifestText';
import { TonConnectWalletError } from '../../../src/tonconnect/wallet/errors';

const MANIFEST_URL = 'https://tonviewer.com/tc-manifest.json';
const MANIFEST_BODY = JSON.stringify({
    url: 'https://tonviewer.com',
    name: 'Tonviewer',
    iconUrl: 'https://tonviewer.com/tonconnect.png',
});

describe('browserFetchManifestText', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('builds a same-origin proxy URL from window.location', () => {
        vi.stubGlobal('window', {
            location: { origin: 'http://localhost:5173' },
        });

        expect(resolveSameOriginManifestProxyUrl(MANIFEST_URL)).toBe(
            `http://localhost:5173/api/tonconnect-manifest?url=${encodeURIComponent(MANIFEST_URL)}`,
        );
    });

    it('falls back from same-origin proxy to walletbot proxy', async () => {
        vi.stubGlobal('window', {
            location: { origin: 'http://localhost:5173' },
        });

        const fetchMock = vi.fn()
            .mockRejectedValueOnce(new TypeError('Failed to fetch'))
            .mockResolvedValueOnce({
                ok: true,
                text: async () => MANIFEST_BODY,
            } as Response);
        vi.stubGlobal('fetch', fetchMock);

        await expect(browserFetchManifestText(MANIFEST_URL)).resolves.toBe(MANIFEST_BODY);
        expect(fetchMock.mock.calls[0]?.[0]).toContain('/api/tonconnect-manifest?url=');
        expect(fetchMock.mock.calls[1]?.[0]).toBe(`https://walletbot.me/tonconnect-proxy/${MANIFEST_URL}`);
    });

    it('throws MANIFEST_UNAVAILABLE when every fetch attempt fails', async () => {
        vi.stubGlobal('window', {
            location: { origin: 'http://localhost:5173' },
        });
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

        await expect(browserFetchManifestText(MANIFEST_URL)).rejects.toSatisfy(
            (error: unknown) => error instanceof TonConnectWalletError && error.code === 'MANIFEST_UNAVAILABLE',
        );
    });
});
