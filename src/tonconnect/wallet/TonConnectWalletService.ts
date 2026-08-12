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

export interface TonConnectWalletServiceOptions {
    readonly store?: TonConnectSessionStore;
    readonly bridgeUrl?: string;
    readonly network: NetworkId;
    /** Max sessions to maintain simultaneously. Defaults to 10. */
    readonly maxSessions?: number;
}

const MAX_MANIFEST_SIZE = 100_000;
const DEFAULT_BRIDGE_URL = 'https://bridge.tonapi.io/bridge';

export class TonConnectWalletService {
    private readonly store: TonConnectSessionStore;
    private readonly bridgeUrl: string;
    private readonly network: NetworkId;
    private readonly maxSessions: number;
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
    }

    // ─── Public API ───────────────────────────────────────────────────────────

    public setRequestHandler(handler: TonConnectRequestHandler | null): void {
        this.requestHandler = handler;
    }

    public getSessions(): readonly TonConnectSessionDescriptor[] {
        return Array.from(this.sessions.values());
    }

    /**
     * Re-open bridge transport for a previously persisted session.
     * Call on app startup for each session loaded from storage.
     */
    public async restoreSession(session: TonConnectStoredSession): Promise<void> {
        this.sessions.set(session.walletClientId, session);
        await this.openTransport(session);
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
        proofAuthority: TonProofSigningAuthority,
    ): Promise<TonConnectSessionDescriptor> {
        if (this.sessions.size >= this.maxSessions) {
            throw new TonConnectWalletError(
                'INVALID_SESSION',
                `Maximum ${this.maxSessions} simultaneous sessions are supported.`,
            );
        }

        const manifest = await this.fetchManifest(link.request.manifestUrl);
        const sessionCrypto = new TonConnectSessionCrypto();
        const walletClientId = sessionCrypto.clientId;

        // Build ton_proof if requested by the DApp
        const proofItem = link.request.items.find((i) => i.name === 'ton_proof');
        let proofResult: Record<string, unknown> | undefined;
        if (proofItem && proofItem.name === 'ton_proof') {
            const proofService = new TonProofService({
                network: this.network,
                clock: () => Math.floor(Date.now() / 1000),
            });
            const proof = await proofService.create(
                {
                    network: this.network,
                    walletAddress: accountAddress,
                    manifestUrl: link.request.manifestUrl,
                    payload: proofItem.payload,
                    timestamp: Math.floor(Date.now() / 1000),
                },
                proofAuthority,
            );
            proofResult = { name: 'ton_proof', proof: proof.proof };
        }

        // Build connect response
        const networkId = this.network === 'mainnet' ? '-239' : '-3';
        const items: Array<Record<string, unknown>> = [
            {
                name: 'ton_addr',
                address: accountAddress,
                network: networkId,
                publicKey: accountAddress,
                walletStateInit: '',
            },
        ];
        if (proofResult) items.push(proofResult);

        const responsePayload = JSON.stringify({
            event: 'connect',
            id: Date.now(),
            payload: { items },
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
            bridgeUrl: this.bridgeUrl,
            createdAtMs: Date.now(),
            lastRequestId: null,
            nextEventId: 0,
        });

        this.store.put(session);
        this.sessions.set(walletClientId, session);

        // Open the SSE transport and send connect response
        await this.openTransport(session, sessionCrypto);
        const transport = this.transports.get(walletClientId);
        if (transport) {
            await transport.send(link.appClientId, new TextEncoder().encode(responsePayload));
        }

        this.manifests.set(link.appClientId, manifest);
        return session;
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

    private async fetchManifest(url: string): Promise<TonConnectManifest> {
        const cached = [...this.manifests.values()].find((m) => m.url === url);
        if (cached) return cached;

        const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
        if (!response.ok) {
            throw new TonConnectWalletError(
                'MANIFEST_UNAVAILABLE',
                `Failed to fetch DApp manifest from ${url}: HTTP ${response.status}`,
            );
        }
        const text = await response.text();
        if (text.length > MAX_MANIFEST_SIZE) {
            throw new TonConnectWalletError(
                'INVALID_MANIFEST',
                'DApp manifest exceeds the maximum allowed size.',
            );
        }
        const json = JSON.parse(text) as Record<string, unknown>;
        const origin = new URL(url).origin;
        const manifest: TonConnectManifest = {
            url,
            origin,
            name: String(json['name'] ?? origin),
            iconUrl: String(json['iconUrl'] ?? ''),
            termsOfUseUrl: (json['termsOfUseUrl'] as string | undefined) ?? null,
            privacyPolicyUrl: (json['privacyPolicyUrl'] as string | undefined) ?? null,
        };
        this.manifests.set(url, manifest);
        return manifest;
    }
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
