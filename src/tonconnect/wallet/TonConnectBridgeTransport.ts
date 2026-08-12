/**
 * TonConnectBridgeTransport — Slice 7: TON Connect HTTP-bridge SSE transport.
 *
 * Connects to the TON Connect bridge as a wallet (listener role).
 * Maintains an SSE connection to receive push events from the DApp.
 * Decrypts incoming messages via TonConnectSessionCrypto (NaCl box).
 *
 * Bridge protocol: https://github.com/ton-connect/bridge
 *
 * Features:
 *   - Auto-reconnect with exponential backoff.
 *   - Heartbeat guard (detects stale connections).
 *   - Typed event emission.
 *   - Clean shutdown on `destroy()`.
 */

import { TonConnectSessionCrypto } from './TonConnectSessionCrypto';
import type { TonConnectAppRequest } from './types';
import { TonConnectWalletError } from './errors';

const DEFAULT_BRIDGE_URL = 'https://bridge.tonapi.io/bridge';
const RECONNECT_BASE_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 90_000; // 90 s without event = stale connection

export type BridgeEvent =
    | { readonly kind: 'request'; readonly request: TonConnectAppRequest; readonly from: string }
    | { readonly kind: 'connected' }
    | { readonly kind: 'disconnected'; readonly reason: string }
    | { readonly kind: 'error'; readonly message: string };

export type BridgeEventListener = (event: BridgeEvent) => void;

export interface TonConnectBridgeTransportOptions {
    readonly clientId: string;          // wallet client ID (public key hex)
    readonly sessionCrypto: TonConnectSessionCrypto;
    readonly bridgeUrl?: string;
    /** Event listener attached immediately (before `connect()`). */
    readonly onEvent?: BridgeEventListener;
    /** Last received SSE event ID for resumable connections. */
    readonly lastEventId?: string;
}

export class TonConnectBridgeTransport {
    private readonly clientId: string;
    private readonly sessionCrypto: TonConnectSessionCrypto;
    private readonly bridgeUrl: string;
    private readonly listeners = new Set<BridgeEventListener>();

    private eventSource: EventSource | null = null;
    private reconnectDelay = RECONNECT_BASE_DELAY_MS;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
    private destroyed = false;
    private lastEventId: string | null;
    private connected = false;

    public constructor(options: TonConnectBridgeTransportOptions) {
        this.clientId = options.clientId;
        this.sessionCrypto = options.sessionCrypto;
        this.bridgeUrl = options.bridgeUrl ?? DEFAULT_BRIDGE_URL;
        this.lastEventId = options.lastEventId ?? null;
        if (options.onEvent) this.listeners.add(options.onEvent);
    }

    public addListener(listener: BridgeEventListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    public connect(): void {
        if (this.destroyed) throw new TonConnectWalletError('INVALID_SESSION', 'Transport is destroyed.');
        this.openEventSource();
    }

    /**
     * Send an encrypted response back to the app via the bridge REST API.
     */
    public async send(
        appClientId: string,
        plaintext: Uint8Array,
    ): Promise<void> {
        const appPublicKey = fromHex(appClientId);
        const encrypted = this.sessionCrypto.encrypt(plaintext, appPublicKey);
        const b64 = bytesToBase64(encrypted);

        const url = new URL(`${this.bridgeUrl}/message`);
        url.searchParams.set('client_id', this.clientId);
        url.searchParams.set('to', appClientId);
        url.searchParams.set('ttl', '300');

        const response = await fetch(url.toString(), {
            method: 'POST',
            body: b64,
            headers: { 'Content-Type': 'text/plain' },
        });
        if (!response.ok) {
            throw new TonConnectWalletError(
                'TRANSACTION_EXECUTION_FAILED',
                `Bridge send returned HTTP ${response.status}`,
            );
        }
    }

    public destroy(): void {
        this.destroyed = true;
        this.closeEventSource();
        if (this.reconnectTimer !== null) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.emit({ kind: 'disconnected', reason: 'destroy' });
        this.listeners.clear();
    }

    // ─── Private ──────────────────────────────────────────────────────────────

    private openEventSource(): void {
        this.closeEventSource();

        const url = new URL(`${this.bridgeUrl}/events`);
        url.searchParams.set('client_id', this.clientId);
        if (this.lastEventId !== null) {
            url.searchParams.set('last_event_id', this.lastEventId);
        }

        const es = new EventSource(url.toString());
        this.eventSource = es;

        es.addEventListener('open', () => {
            this.connected = true;
            this.reconnectDelay = RECONNECT_BASE_DELAY_MS;
            this.resetHeartbeat();
            this.emit({ kind: 'connected' });
        });

        es.addEventListener('message', (ev: MessageEvent) => {
            this.lastEventId = ev.lastEventId ?? this.lastEventId;
            this.resetHeartbeat();
            this.handleRawMessage(ev.data as string);
        });

        es.addEventListener('error', () => {
            this.connected = false;
            this.closeEventSource();
            if (!this.destroyed) {
                this.scheduleReconnect();
            }
        });
    }

    private closeEventSource(): void {
        this.clearHeartbeat();
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }
    }

    private handleRawMessage(data: string): void {
        let envelope: Record<string, unknown>;
        try {
            envelope = JSON.parse(data) as Record<string, unknown>;
        } catch {
            return;
        }

        const from = String(envelope['from'] ?? '');
        const rawMessage = String(envelope['message'] ?? '');
        if (!from || !rawMessage) return;

        // Decrypt the message
        let plaintext: Uint8Array;
        try {
            const encrypted = Uint8Array.from(atob(rawMessage), (c) => c.charCodeAt(0));
            const appPublicKey = fromHex(from);
            plaintext = this.sessionCrypto.decrypt(encrypted, appPublicKey);
        } catch (err) {
            this.emit({ kind: 'error', message: `Decryption failed: ${String(err)}` });
            return;
        }

        let parsed: Record<string, unknown>;
        try {
            parsed = JSON.parse(new TextDecoder().decode(plaintext)) as Record<string, unknown>;
        } catch {
            return;
        }

        // Validate it looks like a JsonRPC request from the app
        const method = parsed['method'] as string | undefined;
        const params = parsed['params'];
        const id = parsed['id'] as string | undefined;
        if (!method || !id) return;

        const request: TonConnectAppRequest = {
            method: method as TonConnectAppRequest['method'],
            params: Array.isArray(params) ? (params as string[]) : [],
            id,
        };

        this.emit({ kind: 'request', request, from });
    }

    private scheduleReconnect(): void {
        this.emit({ kind: 'disconnected', reason: 'reconnecting' });
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (!this.destroyed) this.openEventSource();
        }, this.reconnectDelay);
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_DELAY_MS);
    }

    private resetHeartbeat(): void {
        this.clearHeartbeat();
        this.heartbeatTimer = setTimeout(() => {
            // Stale connection detected — reconnect
            if (!this.destroyed) {
                this.closeEventSource();
                this.scheduleReconnect();
            }
        }, HEARTBEAT_TIMEOUT_MS);
    }

    private clearHeartbeat(): void {
        if (this.heartbeatTimer !== null) {
            clearTimeout(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }

    private emit(event: BridgeEvent): void {
        for (const listener of this.listeners) {
            try { listener(event); } catch {/* isolated */}
        }
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fromHex(hex: string): Uint8Array {
    const clean = hex.replace(/^0x/i, '');
    const bytes = new Uint8Array(clean.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
}
