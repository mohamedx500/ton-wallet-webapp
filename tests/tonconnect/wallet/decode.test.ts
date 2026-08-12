import { describe, expect, it } from 'vitest';

import {
    TonConnectWalletError,
    compareTonConnectRequestIds,
    decodeTonConnectAppRequest,
    decodeTonConnectLink,
    decodeTonConnectManifest,
} from '../../../src/tonconnect/wallet';

const CLIENT_ID = 'ab'.repeat(32);
const REQUEST = Object.freeze({
    manifestUrl: 'https://app.example/tonconnect-manifest.json',
    items: [
        { name: 'ton_addr', network: '-239' },
        { name: 'ton_proof', payload: 'nonce-123' },
    ],
});

function link(request: unknown = REQUEST): string {
    return `tc://?v=2&id=${CLIENT_ID}&r=${encodeURIComponent(JSON.stringify(request))}&ret=back`;
}

function expectCode(action: () => unknown, code: string): void {
    let thrown: unknown;
    try {
        action();
    } catch (error) {
        thrown = error;
    }
    expect(thrown).toBeInstanceOf(TonConnectWalletError);
    expect((thrown as TonConnectWalletError).code).toBe(code);
}

describe('wallet-side TON Connect decoders', () => {
    it('decodes and freezes an exact v2 tc connect link', () => {
        const decoded = decodeTonConnectLink(link());

        expect(decoded).toEqual({
            version: 2,
            appClientId: CLIENT_ID,
            request: REQUEST,
            returnStrategy: { kind: 'back' },
            traceId: null,
        });
        expect(Object.isFrozen(decoded)).toBe(true);
        expect(Object.isFrozen(decoded.request)).toBe(true);
        expect(Object.isFrozen(decoded.request.items)).toBe(true);
    });

    it('accepts only explicitly configured HTTPS wallet hosts', () => {
        const https = link().replace('tc://', 'https://connect.wallet.example/');
        expect(decodeTonConnectLink(https, { acceptedHttpsHosts: ['connect.wallet.example'] }).appClientId)
            .toBe(CLIENT_ID);
        expectCode(() => decodeTonConnectLink(https), 'INVALID_CONNECT_LINK');
    });

    it.each([
        link().replace('v=2', 'v=3'),
        link().replace(CLIENT_ID, CLIENT_ID.toUpperCase()),
        `${link()}&unknown=true`,
        `${link()}&id=${CLIENT_ID}`,
        link({ manifestUrl: 'https://app.example/tonconnect-manifest.json', items: [{ name: 'ton_proof', payload: 'x' }] }),
        link({ manifestUrl: 'https://app.example/tonconnect-manifest.json', items: [{ name: 'ton_addr' }, { name: 'ton_addr' }] }),
        link({ manifestUrl: 'https://app.example/tonconnect-manifest.json', items: [{ name: 'ton_addr' }], extra: true }),
        link({ manifestUrl: 'http://app.example/tonconnect-manifest.json', items: [{ name: 'ton_addr' }] }),
    ])('rejects malformed, unsupported, duplicate, or over-specified links', (value) => {
        expect(() => decodeTonConnectLink(value)).toThrow(TonConnectWalletError);
    });

    it('uses link-specific errors for unsafe return URLs', () => {
        const unsafe = link().replace('ret=back', `ret=${encodeURIComponent('http://app.example/return')}`);
        expectCode(() => decodeTonConnectLink(unsafe), 'INVALID_CONNECT_LINK');
    });

    it('decodes strict RPC envelopes and preserves IDs as decimal strings', () => {
        expect(decodeTonConnectAppRequest({
            method: 'sendTransaction',
            params: ['{"network":"-239"}'],
            id: '9007199254740993',
        })).toEqual({
            method: 'sendTransaction',
            params: ['{"network":"-239"}'],
            id: '9007199254740993',
        });
        expect(decodeTonConnectAppRequest({ method: 'disconnect', params: [], id: '7' }))
            .toEqual({ method: 'disconnect', params: [], id: '7' });
    });

    it.each([
        { method: 'sendTransaction', params: [], id: '1' },
        { method: 'disconnect', params: ['x'], id: '1' },
        { method: 'unknown', params: [], id: '1' },
        { method: 'disconnect', params: [], id: '01' },
        { method: 'disconnect', params: [], id: '1', extra: true },
    ])('rejects invalid RPC envelopes', (request) => {
        expectCode(() => decodeTonConnectAppRequest(request), 'INVALID_APP_REQUEST');
    });

    it('enforces strictly increasing arbitrary-size request IDs', () => {
        expect(() => compareTonConnectRequestIds(null, '999999999999999999999999')).not.toThrow();
        expect(() => compareTonConnectRequestIds('999999999999999999999999', '1000000000000000000000000')).not.toThrow();
        expectCode(
            () => compareTonConnectRequestIds('1000000000000000000000000', '1000000000000000000000000'),
            'REPLAYED_APP_REQUEST',
        );
        expectCode(() => compareTonConnectRequestIds('10', '9'), 'REPLAYED_APP_REQUEST');
    });

    it('decodes a same-origin HTTPS manifest with PNG metadata', () => {
        const manifest = decodeTonConnectManifest({
            url: 'https://app.example',
            name: 'Example App',
            iconUrl: 'https://cdn.example/icon.png',
            privacyPolicyUrl: 'https://app.example/privacy',
        }, 'https://app.example/tonconnect-manifest.json');

        expect(manifest).toEqual({
            url: 'https://app.example',
            origin: 'https://app.example',
            name: 'Example App',
            iconUrl: 'https://cdn.example/icon.png',
            termsOfUseUrl: null,
            privacyPolicyUrl: 'https://app.example/privacy',
        });
        expect(Object.isFrozen(manifest)).toBe(true);
    });

    it.each([
        [{ url: 'https://app.example', name: 'App', iconUrl: 'https://app.example/icon.svg' }, 'https://app.example/tonconnect-manifest.json'],
        [{ url: 'https://other.example', name: 'App', iconUrl: 'https://app.example/icon.png' }, 'https://app.example/tonconnect-manifest.json'],
        [{ url: 'http://app.example', name: 'App', iconUrl: 'https://app.example/icon.png' }, 'https://app.example/tonconnect-manifest.json'],
        [{ url: 'https://app.example', name: 'App', iconUrl: 'https://app.example/icon.png', unknown: true }, 'https://app.example/tonconnect-manifest.json'],
    ] as const)('rejects unsafe or over-specified manifests', (manifest, url) => {
        expectCode(() => decodeTonConnectManifest(manifest, url), 'INVALID_MANIFEST');
    });
});
