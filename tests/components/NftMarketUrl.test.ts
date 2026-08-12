import { Address } from '@ton/core';
import { describe, expect, it } from 'vitest';

import { explorerNftUrl, marketNftUrl, toNftMarketAddress } from '../../src/components/NftDetailModal';

const RAW = '0:bccea57865ea86eb15b256f4deff0d1814e8ba0788b331a7f613f3f1ceb68873';

describe('NFT market / explorer URLs', () => {
    it('converts raw NFT addresses to bounceable EQ form for Getgems', () => {
        const friendly = toNftMarketAddress(RAW);
        expect(friendly.startsWith('EQ')).toBe(true);
        expect(friendly).not.toContain(':');
        expect(friendly).toBe(
            Address.parse(RAW).toString({ bounceable: true, urlSafe: true }),
        );
        expect(marketNftUrl(RAW, 'mainnet')).toBe(
            `https://getgems.io/nft/${friendly}`,
        );
        expect(marketNftUrl(RAW, 'mainnet')).not.toContain('0%3A');
        expect(marketNftUrl(RAW, 'mainnet')).not.toContain('0:');
    });

    it('uses friendly addresses for Tonviewer links', () => {
        const friendly = toNftMarketAddress(RAW);
        expect(explorerNftUrl(RAW, 'mainnet')).toBe(`https://tonviewer.com/${friendly}`);
    });
});
