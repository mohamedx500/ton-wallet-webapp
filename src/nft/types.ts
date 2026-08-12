/**
 * NFT/Collectible/Domain types — Slice 4: Add NFT and collectible support.
 *
 * Aligned with TEP-62 (NFT standard) and TEP-64 (token metadata).
 */

import type { NetworkId } from '../core/chain';

// ─── Metadata ─────────────────────────────────────────────────────────────────

export interface NftAttribute {
    readonly trait_type: string;
    readonly value: string;
}

export interface NftMetadata {
    readonly name: string | null;
    readonly description: string | null;
    /** Full image URL (IPFS resolved). */
    readonly image: string | null;
    readonly attributes: readonly NftAttribute[];
}

// ─── Collection ───────────────────────────────────────────────────────────────

export interface NftCollection {
    readonly address: string;
    readonly name: string | null;
    readonly description: string | null;
    readonly image: string | null;
    readonly itemCount: number | null;
}

// ─── NFT Item ─────────────────────────────────────────────────────────────────

export type NftKind = 'nft' | 'domain' | 'collectible';

export interface NftItem {
    readonly kind: NftKind;
    readonly network: NetworkId;
    /** Canonical NFT item contract address. */
    readonly address: string;
    /** Index within the collection. */
    readonly index: bigint | null;
    /** Current owner address. */
    readonly ownerAddress: string;
    /** Collection this NFT belongs to (null for single-item contracts). */
    readonly collection: NftCollection | null;
    readonly metadata: NftMetadata;
    /** Whether the item is verified by the collection. */
    readonly verified: boolean;
    /** For domain NFTs: the .ton name. */
    readonly domainName: string | null;
    /** For domain NFTs: linked wallet address. */
    readonly linkedAddress: string | null;
    /** For domain NFTs: Unix timestamp of expiry. */
    readonly domainExpiresAtUnix: number | null;
}

// ─── Transfer intent ──────────────────────────────────────────────────────────

/**
 * Intent to transfer an NFT item to a new owner (TEP-62).
 * Does NOT include private keys or signatures.
 */
export interface NftTransferIntent {
    readonly kind: 'nft';
    readonly network: NetworkId;
    /** NFT item contract address. */
    readonly nftAddress: string;
    /** New owner address. */
    readonly recipient: string;
    /**
     * Where to send the excess TON after the transfer.
     * Should be the current owner's address.
     */
    readonly responseDestination: string;
    /** Forwarded TON amount (nanotons). Usually 0.05 TON. */
    readonly forwardAmount: bigint;
    /** Attached TON (nanotons). Usually 0.07 TON to cover fees. */
    readonly attachedTon: bigint;
    /** Human-readable purpose for the password prompt. */
    readonly purpose: string;
    /** Optional comment forwarded to the new owner. */
    readonly forwardPayload?: string;
}
