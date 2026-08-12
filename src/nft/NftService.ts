/**
 * NftService — Slice 4: Fetch and parse NFT/collectible items.
 *
 * Fetches NFT items owned by a wallet address via TonAPI v2 /accounts/{address}/nfts.
 * Handles:
 *   - Paginated fetch with configurable page size.
 *   - IPFS → HTTPS gateway URL resolution.
 *   - Domain NFT detection (TON DNS collection).
 *   - On-chain metadata fallback.
 *
 * Thread-safety: each `fetchAll()` call is independent. The service itself is
 * stateless and safe for concurrent invocations.
 */

import type { NetworkId } from '../core/chain';
import type { NftAttribute, NftCollection, NftItem, NftKind, NftMetadata } from './types';

const TONAPI_BASE: Record<NetworkId, string> = {
    mainnet: 'https://tonapi.io',
    testnet: 'https://testnet.tonapi.io',
};

// Known TON DNS collections (mainnet)
const TON_DNS_COLLECTION_ADDRESSES = new Set([
    '0:b774d95eb20543f186c06b371ab88ad704f7e256130caf96189368a7d0cb6ccf', // .ton
]);

const IPFS_GATEWAY = 'https://ipfs.io/ipfs/';
const DEFAULT_PAGE_LIMIT = 1000;

export interface NftServiceOptions {
    readonly network: NetworkId;
    readonly apiKey?: string;
}

export interface FetchNftOptions {
    readonly limit?: number;
    readonly signal?: AbortSignal;
}

export class NftService {
    private readonly network: NetworkId;
    private readonly apiKey: string | undefined;

    public constructor(options: NftServiceOptions) {
        this.network = options.network;
        this.apiKey = options.apiKey;
    }

    /**
     * Fetch all NFT items owned by a wallet address.
     * Paginates automatically until all items are fetched or signal is aborted.
     */
    public async fetchAll(
        ownerAddress: string,
        options: FetchNftOptions = {},
    ): Promise<NftItem[]> {
        const limit = Math.min(options.limit ?? DEFAULT_PAGE_LIMIT, 1000);
        const signal = options.signal;
        const base = TONAPI_BASE[this.network];
        const headers = this.buildHeaders();
        const items: NftItem[] = [];
        let offset = 0;

        while (true) {
            if (signal?.aborted) break;

            const url = `${base}/v2/accounts/${encodeURIComponent(ownerAddress)}/nfts?limit=${limit}&offset=${offset}&indirect_ownership=false`;
            const response = await fetch(url, { headers, signal: signal ?? AbortSignal.timeout(15000) });

            if (!response.ok) {
                if (response.status === 404) break;
                throw new Error(`NftService: TonAPI returned HTTP ${response.status}`);
            }

            const json = await response.json() as { nft_items?: unknown[] };
            const rawItems = json.nft_items ?? [];

            if (!Array.isArray(rawItems) || rawItems.length === 0) break;

            for (const raw of rawItems) {
                const parsed = this.parseNftItem(raw as Record<string, unknown>, ownerAddress);
                if (parsed) items.push(parsed);
            }

            if (rawItems.length < limit) break;
            offset += limit;
        }

        return items;
    }

    // ─── Private parsing ────────────────────────────────────────────────────────

    private parseNftItem(raw: Record<string, unknown>, ownerAddress: string): NftItem | null {
        try {
            const address = String((raw['address'] as string | undefined) ?? '');
            if (!address) return null;

            const collection = this.parseCollection(raw['collection'] as Record<string, unknown> | undefined);
            const metadata = this.parseMetadata(raw['metadata'] as Record<string, unknown> | undefined);

            const collectionAddress = collection?.address?.toLowerCase() ?? '';
            const isDomain =
                TON_DNS_COLLECTION_ADDRESSES.has(collectionAddress) ||
                (metadata.name?.endsWith('.ton') ?? false);

            const kind: NftKind = isDomain ? 'domain' : 'nft';

            const rawOwner = raw['owner'] as Record<string, unknown> | undefined;
            const itemOwnerAddress = (rawOwner?.['address'] as string | undefined) ?? ownerAddress;

            return Object.freeze({
                kind,
                network: this.network,
                address,
                index: raw['index'] != null ? BigInt(String(raw['index'])) : null,
                ownerAddress: itemOwnerAddress,
                collection,
                metadata,
                verified: Boolean(raw['approved_by'] != null),
                domainName: isDomain ? (metadata.name ?? null) : null,
                linkedAddress: null, // resolved lazily via DomainService
                domainExpiresAtUnix: null, // resolved lazily via DomainService
            } satisfies NftItem);
        } catch {
            return null;
        }
    }

    private parseCollection(raw: Record<string, unknown> | undefined): NftCollection | null {
        if (!raw) return null;
        const address = String((raw['address'] as string | undefined) ?? '');
        if (!address) return null;

        const meta = raw['metadata'] as Record<string, unknown> | undefined;
        return Object.freeze({
            address,
            name: (meta?.['name'] as string | undefined) ?? null,
            description: (meta?.['description'] as string | undefined) ?? null,
            image: this.resolveImageUrl((meta?.['image'] as string | undefined) ?? null),
            itemCount: typeof raw['next_item_index'] === 'number' ? (raw['next_item_index'] as number) : null,
        });
    }

    private parseMetadata(raw: Record<string, unknown> | undefined): NftMetadata {
        if (!raw) {
            return { name: null, description: null, image: null, attributes: [] };
        }
        const attributes: NftAttribute[] = [];
        const rawAttrs = raw['attributes'];
        if (Array.isArray(rawAttrs)) {
            for (const attr of rawAttrs) {
                if (
                    attr &&
                    typeof attr === 'object' &&
                    typeof (attr as Record<string, unknown>)['trait_type'] === 'string' &&
                    typeof (attr as Record<string, unknown>)['value'] === 'string'
                ) {
                    attributes.push({
                        trait_type: String((attr as Record<string, unknown>)['trait_type']),
                        value: String((attr as Record<string, unknown>)['value']),
                    });
                }
            }
        }
        return Object.freeze({
            name: (raw['name'] as string | undefined) ?? null,
            description: (raw['description'] as string | undefined) ?? null,
            image: this.resolveImageUrl((raw['image'] as string | undefined) ?? null),
            attributes,
        });
    }

    private resolveImageUrl(url: string | null): string | null {
        if (!url) return null;
        if (url.startsWith('ipfs://')) {
            return IPFS_GATEWAY + url.slice(7);
        }
        return url;
    }

    private buildHeaders(): Record<string, string> {
        const headers: Record<string, string> = { 'Accept': 'application/json' };
        if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;
        return headers;
    }
}
