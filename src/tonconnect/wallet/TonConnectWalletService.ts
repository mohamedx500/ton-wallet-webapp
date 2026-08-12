/**
 * TonConnectWalletService — Slice 7: High-level TON Connect wallet orchestrator.
 *
 * Responsibilities:
 *   - Parses and validates incoming TonConnectLink (QR / deeplink).
 *   - Fetches the DApp manifest.
 *   - Manages sessions via TonConnectSessionStore (put/get/remove).
 *   - Owns one TonConnectBridgeTransport per active session.
 *   - Dispatches pending requests (sendTransaction, disconnect) to UI.
 *   - Sends encrypted JsonRPC responses back to the DApp via the bridge.
 *   - Handles ton_proof signing via TonProofService (instance, `create()` method).
 *
 * Usage:
 *   const tc = new TonConnectWalletService(options);
 *   tc.setRequestHandler(handler); // from UI
 *   await tc.handleConnectLink(link, accountId, address, proofAuthority);
 */

import type {
    TonConnectManifest,
    TonConnectLink,
    TonConnectAppRequest,
    TonConnectStoredSession,
    TonConnectSessionDescriptor,
    TonProofSigningAuthority,
} from './types';
import { TonConnectSessionStore } from './TonConnectSessionStore';
import { TonConnectSessionCrypto } from './TonConnectSessionCrypto';
import { TonConnectBridgeTransport } from './TonConnectBridgeTransport';
import { TonProofService } from './TonProofService';
import { TonConnectWalletError } from './errors';
import { decodeTonConnectManifest } from './decode';
import { buildTonConnectConnectPayload } from './buildConnectReply';
import { assertStandardWalletAuthority } from '../../wallet/OfficialStandardWalletSigner';
import { assertHighloadWalletAuthority } from '../../wallet/highloadWalletContract';
import type { WalletDescriptor } from '../../wallet/types';
import type { NetworkId } from '../../core/chain';

export interface TonConnectPendingRequest {
    readonly session: TonConnectSessionDescriptor;
    readonly request: TonConnectAppRequest;
    readonly manifest: TonConnectManifest;
    readonly from: string;
    approve(txHash?: string): Promise<void>;
    reject(code?: number, message?: string): Promise<void>;
}

export type TonConnectRequestHandler = (pending: TonConnectPendingRequest) => void;

export type ManifestTextFetcher = (manifestUrl: string) => Promise<string>;

export interface TonConnectWalletServiceOptions {
    readonly store?: TonConnectSessionStore;
    readonly bridgeUrl?: string;
    readonly network: NetworkId;
    /** Max sessions to maintain simultaneously. Defaults to 10. */
    readonly maxSessions?: number;
    /** Optional CORS proxy prefix for manifest fetch in browser wallets. */
    readonly manifestProxyPrefix?: string;
    /** Override manifest HTTP fetch (used by browser UI for proxy fallbacks). */
    readonly manifestTextFetcher?: ManifestTextFetcher;
}

const MAX_MANIFEST_SIZE = 100_000;
const DEFAULT_BRIDGE_URL = 'https://bridge.tonapi.io/bridge';
/** Fallback used by web wallets when a dApp manifest blocks browser CORS. */
const DEFAULT_MANIFEST_PROXY_PREFIX = 'https://walletbot.me/tonconnect-proxy/';
const MANIFEST_FETCH_TIMEOUT_MS = 15_000;

export class TonConnectWalletService {
    private readonly store: TonConnectSessionStore;
    private readonly bridgeUrl: string;
    private readonly network: NetworkId;
    private readonly maxSessions: number;
    private readonly manifestProxyPrefix: string;
    private readonly manifestTextFetcher: ManifestTextFetcher | null;
    /** manifest file URL → validated manifest */
    private readonly manifestByUrl = new Map<string, TonConnectManifest>();
    /** walletClientId → bridge transport */
    private readonly transports = new Map<string, TonConnectBridgeTransport>();
    /** walletClientId → in-memory session record */
    private readonly sessions = new Map<string, TonConnectStoredSession>();
    /** appClientId → manifest */
    private readonly manifests = new Map<string, TonConnectManifest>();
    private requestHandler: TonConnectRequestHandler | null = null;

    public constructor(options: TonConnectWalletServiceOptions) {
        this.store = options.store ?? new TonConnectSessionStore({ storage: localStorage });
        this.bridgeUrl = options.bridgeUrl ?? DEFAULT_BRIDGE_URL;
        this.network = options.network;
        this.maxSessions = options.maxSessions ?? 10;
        this.manifestProxyPrefix = options.manifestProxyPrefix ?? DEFAULT_MANIFEST_PROXY_PREFIX;
        this.manifestTextFetcher = options.manifestTextFetcher ?? null;
    }

    // ─── Public API ───────────────────────────────────────────────────────────

    public setRequestHandler(handler: TonConnectRequestHandler | null): void {
        this.requestHandler = handler;
    }

    public getSessions(): readonly TonConnectSessionDescriptor[] {
        return Array.from(this.sessions.values());
    }

    /** Sessions for one account (in-memory first, otherwise loaded from persistence). */
    public getSessionsForAccount(accountId: string): readonly TonConnectSessionDescriptor[] {
        const live = Array.from(this.sessions.values()).filter((session) => session.accountId === accountId);
        if (live.length > 0) return live;
        return this.store.listForAccount(this.network, accountId);
    }

    /**
     * Re-open bridge transport for a previously persisted session.
     * Call on app startup for each session loaded from storage.
     */
    public async restoreSession(session: TonConnectStoredSession): Promise<void> {
        this.sessions.set(session.walletClientId, session);
        if (session.appName && session.appIconUrl) {
            this.manifests.set(session.appClientId, Object.freeze({
                url: session.manifestOrigin,
                origin: session.manifestOrigin,
                name: session.appName,
                iconUrl: session.appIconUrl,
                termsOfUseUrl: null,
                privacyPolicyUrl: null,
            }));
        }
        await this.openTransport(session);
    }

    /** Restore every persisted session for the active account and reopen bridge transports. */
    public async restoreSessionsForAccount(accountId: string): Promise<readonly TonConnectSessionDescriptor[]> {
        const stored = this.store.listForAccount(this.network, accountId);
        for (const session of stored) {
            if (this.sessions.has(session.walletClientId)) continue;
            await this.restoreSession(session);
        }
        return this.getSessionsForAccount(accountId);
    }

    public getExistingSession(accountId: string, appClientId: string): TonConnectSessionDescriptor | null {
        for (const session of this.sessions.values()) {
            if (session.accountId === accountId && session.appClientId === appClientId) {
                return session;
            }
        }
        try {
            return this.store.get(this.network, accountId, appClientId);
        } catch {
            try {
                this.store.remove(this.network, accountId, appClientId);
            } catch {
                /* ignore */
            }
            return null;
        }
    }

    /** Clear every TON Connect session for the active wallet account. */
    public clearSessionsForAccount(accountId: string): void {
        this.store.removeAllForAccount(this.network, accountId);
        for (const [walletClientId, session] of [...this.sessions.entries()]) {
            if (session.accountId !== accountId) continue;
            this.transports.get(walletClientId)?.destroy();
            this.transports.delete(walletClientId);
            this.sessions.delete(walletClientId);
            this.manifests.delete(session.appClientId);
        }
    }

    /** Fetch and validate the DApp manifest without creating a session. */
    public async previewConnectLink(link: TonConnectLink): Promise<TonConnectManifest> {
        return this.fetchManifest(link.request.manifestUrl);
    }

    /**
     * Handle a parsed TonConnect link (from QR scan or deeplink).
     * Creates a new session, fetches the manifest, sends the connect response.
     */
    public async handleConnectLink(
        link: TonConnectLink,
        accountId: string,
        accountAddress: string,
        walletDescriptor: WalletDescriptor,
        walletPublicKey: Buffer,
        proofAuthority: TonProofSigningAuthority,
    ): Promise<TonConnectSessionDescriptor> {
        const existing = this.getExistingSession(accountId, link.appClientId);
        if (existing) {
            await this.clearSession(accountId, link.appClientId, existing.walletClientId);
        }

        if (this.sessions.size >= this.maxSessions) {
            throw new TonConnectWalletError(
                'INVALID_SESSION',
                `Maximum ${this.maxSessions} simultaneous sessions are supported.`,
            );
        }

        const manifest = await this.fetchManifest(link.request.manifestUrl);
        if (walletDescriptor.kind === 'standard') {
            assertStandardWalletAuthority(walletDescriptor, this.network, {
                publicKey: walletPublicKey,
                sign: async () => Buffer.alloc(64),
            });
        } else if (walletDescriptor.kind === 'highload-v3') {
            assertHighloadWalletAuthority(walletDescriptor, walletPublicKey);
        } else {
            throw new TonConnectWalletError(
                'INVALID_SESSION',
                'This wallet type is not supported for TON Connect.',
            );
        }

        const sessionCrypto = new TonConnectSessionCrypto();
        const walletClientId = sessionCrypto.clientId;

        // Build ton_proof when requested by the dApp
        const proofItem = link.request.items.find((i) => i.name === 'ton_proof');
        let proofResult: Awaited<ReturnType<TonProofService['create']>> | undefined;
        if (proofItem && proofItem.name === 'ton_proof') {
            const proofService = new TonProofService({
                network: this.network,
                clock: () => Math.floor(Date.now() / 1000),
            });
            proofResult = await proofService.create(
                {
                    network: this.network,
                    walletAddress: accountAddress,
                    manifestUrl: link.request.manifestUrl,
                    payload: proofItem.payload,
                    timestamp: Math.floor(Date.now() / 1000),
                },
                proofAuthority,
            );
        }

        const connectPayload = buildTonConnectConnectPayload(
            walletDescriptor,
            this.network,
            walletPublicKey,
            proofResult,
        );

        const eventId = 0;
        const responsePayload = JSON.stringify({
            event: 'connect',
            id: eventId,
            payload: connectPayload,
        });

        // Build and persist the session record
        const keyPair = sessionCrypto.exportKeyPair();
        const session: TonConnectStoredSession = Object.freeze({
            schemaVersion: 1 as const,
            network: this.network,
            accountId,
            accountAddress,
            appClientId: link.appClientId,
            walletClientId,
            walletDescriptor,
            walletSecretKey: Buffer.from(keyPair.secretKey).toString('hex'),
            manifestUrl: link.request.manifestUrl,
            manifestOrigin: manifest.origin,
            appName: manifest.name,
            appIconUrl: manifest.iconUrl,
            bridgeUrl: this.bridgeUrl,
            createdAtMs: Date.now(),
            lastRequestId: null,
            nextEventId: 0,
        });

        this.sessions.set(walletClientId, session);

        try {
            await this.openTransport(session, sessionCrypto);
            const transport = this.transports.get(walletClientId);
            if (!transport) {
                throw new TonConnectWalletError('INVALID_SESSION', 'The TON Connect bridge transport is unavailable.');
            }
            await transport.send(link.appClientId, new TextEncoder().encode(responsePayload));

            this.store.put(session);
            this.manifests.set(link.appClientId, manifest);
            return session;
        } catch (error) {
            await this.clearSession(accountId, link.appClientId, walletClientId);
            throw error;
        }
    }

    /**
     * Disconnect a session by its walletClientId.
     * Sends a disconnect event to the DApp and clears local state.
     */
    public async disconnectSession(walletClientId: string): Promise<void> {
        const session = this.sessions.get(walletClientId);
        if (!session) return;

        const transport = this.transports.get(walletClientId);
        if (transport) {
            try {
                const payload = JSON.stringify({ event: 'disconnect', id: Date.now(), payload: {} });
                await transport.send(session.appClientId, new TextEncoder().encode(payload));
            } catch {/* best effort — DApp may already be gone */}
            transport.destroy();
            this.transports.delete(walletClientId);
        }

        try {
            this.store.remove(session.network, session.accountId, session.appClientId);
        } catch {/* ignore if already removed */}
        this.sessions.delete(walletClientId);
        this.manifests.delete(session.appClientId);
    }

    private async clearSession(
        accountId: string,
        appClientId: string,
        walletClientId: string,
    ): Promise<void> {
        const transport = this.transports.get(walletClientId);
        if (transport) {
            transport.destroy();
            this.transports.delete(walletClientId);
        }
        this.sessions.delete(walletClientId);
        this.manifests.delete(appClientId);
        try {
            this.store.remove(this.network, accountId, appClientId);
        } catch {
            /* already removed */
        }
    }

    // ─── Private ──────────────────────────────────────────────────────────────

    private async openTransport(
        session: TonConnectStoredSession,
        crypto?: TonConnectSessionCrypto,
    ): Promise<void> {
        if (this.transports.has(session.walletClientId)) return;

        const sessionCrypto = crypto ?? new TonConnectSessionCrypto({
            keyPair: {
                publicKey: hexToBytes(session.walletClientId),
                secretKey: hexToBytes(session.walletSecretKey),
            },
        });

        const transport = new TonConnectBridgeTransport({
            clientId: session.walletClientId,
            sessionCrypto,
            bridgeUrl: session.bridgeUrl,
            onEvent: (event) => {
                if (event.kind === 'request') {
                    void this.handleIncomingRequest(session, event.request, event.from);
                }
            },
        });

        this.transports.set(session.walletClientId, transport);
        transport.connect();
    }

    private async handleIncomingRequest(
        session: TonConnectStoredSession,
        request: TonConnectAppRequest,
        from: string,
    ): Promise<void> {
        if (!this.requestHandler) return;

        const manifest = this.manifests.get(session.appClientId)
            ?? await this.fetchManifest(session.manifestUrl).catch(() => null);
        if (!manifest) return;

        const transport = this.transports.get(session.walletClientId);
        if (!transport) return;

        const sendResponse = async (
            result: unknown,
            error?: { code: number; message: string },
        ) => {
            const payload = error
                ? JSON.stringify({ id: request.id, error })
                : JSON.stringify({ id: request.id, result });
            await transport.send(from, new TextEncoder().encode(payload));
        };

        // disconnect is handled automatically — no UI confirmation needed
        if (request.method === 'disconnect') {
            await this.disconnectSession(session.walletClientId);
            return;
        }

        const pending: TonConnectPendingRequest = {
            session,
            request,
            manifest,
            from,
            approve: async (txHash?: string) => {
                await sendResponse({ boc: txHash ?? '' });
                // Persist updated lastRequestId
                const updated: TonConnectStoredSession = Object.freeze({
                    ...session,
                    lastRequestId: request.id,
                });
                this.sessions.set(session.walletClientId, updated);
                this.store.put(updated);
            },
            reject: async (code = 300, message = 'User rejected the request') => {
                await sendResponse(null, { code, message });
            },
        };

        this.requestHandler(pending);
    }

    private async fetchManifest(manifestUrl: string): Promise<TonConnectManifest> {
        const cached = this.manifestByUrl.get(manifestUrl);
        if (cached) return cached;

        let text: string;
        try {
            text = await this.fetchManifestText(manifestUrl);
        } catch (cause) {
            if (cause instanceof TonConnectWalletError) throw cause;
            throw new TonConnectWalletError(
                'MANIFEST_UNAVAILABLE',
                'Application manifest is unavailable.',
                {},
                { cause },
            );
        }

        if (text.length > MAX_MANIFEST_SIZE) {
            throw new TonConnectWalletError(
                'INVALID_MANIFEST',
                'DApp manifest exceeds the maximum allowed size.',
            );
        }

        let json: unknown;
        try {
            json = JSON.parse(text) as unknown;
        } catch (cause) {
            throw new TonConnectWalletError(
                'INVALID_MANIFEST',
                'The application manifest is invalid.',
                {},
                { cause },
            );
        }

        const manifest = decodeTonConnectManifest(json, manifestUrl);
        this.manifestByUrl.set(manifestUrl, manifest);
        return manifest;
    }

    private async fetchManifestText(manifestUrl: string): Promise<string> {
        if (this.manifestTextFetcher) {
            return this.manifestTextFetcher(manifestUrl);
        }

        try {
            return await this.fetchManifestTextFrom(manifestUrl);
        } catch {
            if (!this.manifestProxyPrefix) {
                throw new TonConnectWalletError(
                    'MANIFEST_UNAVAILABLE',
                    'Application manifest is unavailable.',
                );
            }
            const proxyUrl = `${this.manifestProxyPrefix}${manifestUrl}`;
            return this.fetchManifestTextFrom(proxyUrl);
        }
    }

    private async fetchManifestTextFrom(url: string): Promise<string> {
        let response: Response;
        try {
            response = await fetchWithTimeout(url, MANIFEST_FETCH_TIMEOUT_MS);
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
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
        return fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    }
    return fetch(url);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
    const clean = hex.replace(/^0x/i, '');
    const bytes = new Uint8Array(clean.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
}
