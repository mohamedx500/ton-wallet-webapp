/**
 * Browser-side TON Connect manifest fetch with same-origin and proxy fallbacks.
 *
 * Web wallets cannot read most dApp manifests directly because of CORS.
 * This helper tries, in order:
 *   1. Same-origin dev/preview proxy (/api/tonconnect-manifest)
 *   2. Public TON Connect manifest proxy (walletbot.me)
 *   3. Direct HTTPS fetch (for dApps that allow cross-origin access)
 */

import { TonConnectWalletError } from '../wallet/errors';

const WALLETBOT_PROXY_PREFIX = 'https://walletbot.me/tonconnect-proxy/';
const SAME_ORIGIN_PROXY_PATH = '/api/tonconnect-manifest';
const MANIFEST_FETCH_TIMEOUT_MS = 15_000;

async function fetchManifestResponse(url: string): Promise<Response> {
    const init: RequestInit = {};
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
        init.signal = AbortSignal.timeout(MANIFEST_FETCH_TIMEOUT_MS);
    }
    return fetch(url, init);
}

async function fetchManifestBody(url: string): Promise<string> {
    let response: Response;
    try {
        response = await fetchManifestResponse(url);
    } catch (cause) {
        throw new TonConnectWalletError(
            'MANIFEST_UNAVAILABLE',
            'Application manifest is unavailable.',
            {},
            { cause },
        );
    }

    if (!response.ok) {
        throw new TonConnectWalletError(
            'MANIFEST_UNAVAILABLE',
            'Application manifest is unavailable.',
        );
    }

    return response.text();
}

/** Resolve a same-origin manifest proxy URL when running in a browser. */
export function resolveSameOriginManifestProxyUrl(manifestUrl: string): string | null {
    if (typeof window === 'undefined' || !window.location?.origin) return null;
    const base = new URL(SAME_ORIGIN_PROXY_PATH, window.location.origin);
    base.searchParams.set('url', manifestUrl);
    return base.href;
}

/** Fetch manifest JSON text in browser environments. */
export async function browserFetchManifestText(manifestUrl: string): Promise<string> {
    const candidates: string[] = [];
    const sameOrigin = resolveSameOriginManifestProxyUrl(manifestUrl);
    if (sameOrigin) candidates.push(sameOrigin);
    candidates.push(`${WALLETBOT_PROXY_PREFIX}${manifestUrl}`);
    candidates.push(manifestUrl);

    let lastError: unknown;
    for (const url of candidates) {
        try {
            return await fetchManifestBody(url);
        } catch (error) {
            lastError = error;
        }
    }

    if (lastError instanceof TonConnectWalletError) throw lastError;
    throw new TonConnectWalletError(
        'MANIFEST_UNAVAILABLE',
        'Application manifest is unavailable.',
        {},
        lastError === undefined ? undefined : { cause: lastError },
    );
}
