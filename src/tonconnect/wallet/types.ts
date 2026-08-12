import type { NetworkId } from '../../core/chain';
import type { WalletDescriptor } from '../../wallet/types';

export const TON_CONNECT_PROTOCOL_VERSION = 2;
export const TON_CONNECT_MAX_LINK_LENGTH = 16_384;
export const TON_CONNECT_MAX_MANIFEST_URL_LENGTH = 2_048;
export const TON_CONNECT_MAX_PROOF_PAYLOAD_BYTES = 1_024;
export const TON_CONNECT_MAX_RPC_PARAMETER_BYTES = 65_536;

export interface TonAddressConnectItem {
    readonly name: 'ton_addr';
    readonly network?: string;
}

export interface TonProofConnectItem {
    readonly name: 'ton_proof';
    readonly payload: string;
}

export type TonConnectItem = TonAddressConnectItem | TonProofConnectItem;

export interface TonConnectRequest {
    readonly manifestUrl: string;
    readonly items: readonly TonConnectItem[];
}

export type TonConnectReturnStrategy =
    | { readonly kind: 'back' }
    | { readonly kind: 'none' }
    | { readonly kind: 'url'; readonly url: string };

export interface TonConnectLink {
    readonly version: 2;
    readonly appClientId: string;
    readonly request: TonConnectRequest;
    readonly returnStrategy: TonConnectReturnStrategy;
    readonly traceId: string | null;
}

export interface TonConnectManifest {
    readonly url: string;
    readonly origin: string;
    readonly name: string;
    readonly iconUrl: string;
    readonly termsOfUseUrl: string | null;
    readonly privacyPolicyUrl: string | null;
}

export interface TonConnectAppRequest {
    readonly method: 'sendTransaction' | 'signMessage' | 'signData' | 'disconnect';
    readonly params: readonly string[];
    readonly id: string;
}

/** Public session identity. It contains no private session key or decrypted message. */
export interface TonConnectSessionDescriptor {
    readonly schemaVersion: 1;
    readonly network: NetworkId;
    readonly accountId: string;
    readonly accountAddress: string;
    readonly appClientId: string;
    readonly walletClientId: string;
    readonly walletDescriptor: WalletDescriptor;
    readonly manifestUrl: string;
    readonly manifestOrigin: string;
    readonly bridgeUrl: string;
    readonly createdAtMs: number;
    readonly lastRequestId: string | null;
    readonly nextEventId: number;
}

/** Sensitive record required to restore one encrypted HTTP-bridge session. */
export interface TonConnectStoredSession extends TonConnectSessionDescriptor {
    readonly walletSecretKey: string;
}

export interface TonConnectSessionKeyPair {
    readonly publicKey: Uint8Array;
    readonly secretKey: Uint8Array;
}

export interface TonProofSigningAuthority {
    readonly walletAddress: string;
    sign(messageHash: Uint8Array): Promise<Uint8Array>;
}

export interface TonProofRequest {
    readonly network: NetworkId;
    readonly walletAddress: string;
    readonly manifestUrl: string;
    readonly payload: string;
    readonly timestamp: number;
}

export interface TonProofResult {
    readonly name: 'ton_proof';
    readonly proof: {
        readonly timestamp: number;
        readonly domain: {
            readonly lengthBytes: number;
            readonly value: string;
        };
        readonly signature: string;
        readonly payload: string;
    };
}

export interface TonConnectSynchronousStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}
