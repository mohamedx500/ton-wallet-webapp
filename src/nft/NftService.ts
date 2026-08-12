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
            const metadata = this.parseMetadata(
                raw['metadata'] as Record<string, unknown> | undefined,
                raw['previews'],
                collection?.image ?? null,
            );

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
        const name = (meta?.['name'] as string | undefined)
            ?? (raw['name'] as string | undefined)
            ?? null;
        const description = (meta?.['description'] as string | undefined)
            ?? (raw['description'] as string | undefined)
            ?? null;
        return Object.freeze({
            address,
            name,
            description,
            image: this.resolveImageUrl(
                (meta?.['image'] as string | undefined)
                ?? (raw['image'] as string | undefined)
                ?? null,
            ),
            itemCount: typeof raw['next_item_index'] === 'number' ? (raw['next_item_index'] as number) : null,
        });
    }

    private parseMetadata(
        raw: Record<string, unknown> | undefined,
        previews: unknown,
        collectionImage: string | null,
    ): NftMetadata {
        if (!raw) {
            return Object.freeze({
                name: null,
                description: null,
                image: this.pickPreviewImage(previews) ?? collectionImage,
                attributes: [],
            });
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
        const metadataImage = this.resolveImageUrl((raw['image'] as string | undefined) ?? null);
        return Object.freeze({
            name: (raw['name'] as string | undefined) ?? null,
            description: (raw['description'] as string | undefined) ?? null,
            image: metadataImage ?? this.pickPreviewImage(previews) ?? collectionImage,
            attributes,
        });
    }

    /**
     * TonAPI serves DNS / many NFT images via `previews` (imgproxy) rather than
     * `metadata.image`. Prefer a mid/high resolution preview for gallery cards.
     */
    private pickPreviewImage(previews: unknown): string | null {
        if (!Array.isArray(previews) || previews.length === 0) return null;
        const scored = previews
            .map((entry) => {
                if (!entry || typeof entry !== 'object') return null;
                const record = entry as Record<string, unknown>;
                const url = typeof record['url'] === 'string' ? record['url'] : null;
                if (!url) return null;
                const resolution = typeof record['resolution'] === 'string' ? record['resolution'] : '';
                const match = /^(\d+)x(\d+)$/u.exec(resolution);
                const size = match ? Number(match[1]) * Number(match[2]) : 0;
                return { url, size };
            })
            .filter((entry): entry is { url: string; size: number } => entry !== null);
        if (scored.length === 0) return null;
        scored.sort((a, b) => b.size - a.size);
        // Prefer ~500px when available; otherwise the largest preview.
        const preferred = scored.find((entry) => entry.size >= 500 * 500 && entry.size <= 600 * 600);
        return this.resolveImageUrl((preferred ?? scored[0])!.url);
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
