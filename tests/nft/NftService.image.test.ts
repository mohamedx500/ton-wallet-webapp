import { describe, expect, it, vi } from 'vitest';

import { NftService } from '../../src/nft/NftService';

describe('NftService image resolution', () => {
    it('uses TonAPI previews when metadata.image is missing (DNS domains)', async () => {
        const previewUrl = 'https://cache.tonapi.io/imgproxy/example/rs:fill:500:500:1/dns.png.webp';
        vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: true,
            json: async () => ({
                nft_items: [
                    {
                        address: '0:' + 'ab'.repeat(32),
                        index: 1,
                        owner: { address: '0:' + 'cd'.repeat(32) },
                        collection: {
                            address: '0:b774d95eb20543f186c06b371ab88ad704f7e256130caf96189368a7d0cb6ccf',
                            name: 'TON DNS Domains',
                            description: '*.ton domains',
                        },
                        metadata: {
                            name: 'mohamedrabie.ton',
                            description: null,
                        },
                        previews: [
                            { resolution: '100x100', url: 'https://cache.tonapi.io/small.webp' },
                            { resolution: '500x500', url: previewUrl },
                        ],
                        approved_by: ['ton'],
                    },
                ],
            }),
        } as Response);

        const service = new NftService({ network: 'mainnet' });
        const items = await service.fetchAll('EQTestOwner');
        expect(items).toHaveLength(1);
        expect(items[0]?.kind).toBe('domain');
        expect(items[0]?.domainName).toBe('mohamedrabie.ton');
        expect(items[0]?.metadata.image).toBe(previewUrl);
        expect(items[0]?.collection?.name).toBe('TON DNS Domains');
    });
});
