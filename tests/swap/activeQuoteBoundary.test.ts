import { Address } from '@ton/core';
import { describe, expect, it } from 'vitest';

import {
    ACTIVE_TON_ASSET,
    createActiveQuoteIntent,
    decodeStonfiAssets,
    findActiveAssetBalance,
    hasPositiveExactAmount,
} from '../../src/swap/application';

const MASTER = Address.parseRaw(`0:${'11'.repeat(32)}`).toString();
const OTHER_MASTER = Address.parseRaw(`0:${'22'.repeat(32)}`).toString();

describe('active strict quote boundary', () => {
    it('decodes contract-address identity and excludes blacklisted assets', () => {
        const assets = decodeStonfiAssets({
            asset_list: [
                {
                    contract_address: MASTER,
                    symbol: 'TON',
                    display_name: 'Deceptive TON Jetton',
                    decimals: 6,
                    image_url: 'https://example.com/token.png',
                    popularity_index: 10,
                },
                {
                    contract_address: OTHER_MASTER,
                    symbol: 'BAD',
                    display_name: 'Blacklisted',
                    decimals: 9,
                    image_url: 'https://example.com/bad.png',
                    blacklisted: true,
                },
            ],
        });

        expect(assets).toHaveLength(2);
        expect(assets[0]).toBe(ACTIVE_TON_ASSET);
        expect(assets[1]).toMatchObject({
            contractAddress: MASTER,
            symbol: 'TON',
            decimals: 6,
        });
        expect(assets[1]?.contractAddress).not.toBe('native');
    });

    it.each(['.5', '12.'])(
        'accepts the existing UI amount form %s with exact parsing',
        (amount) => {
            expect(hasPositiveExactAmount(amount, 9)).toBe(true);
        },
    );

    it('rejects imprecise, non-positive, and exponent amount syntax', () => {
        expect(hasPositiveExactAmount('0', 9)).toBe(false);
        expect(hasPositiveExactAmount('1e2', 9)).toBe(false);
        expect(hasPositiveExactAmount('1.0000001', 6)).toBe(false);
    });

    it('creates a contract-bound Stage A input without using symbols as identity', () => {
        const deceptiveJetton = Object.freeze({
            contractAddress: MASTER,
            symbol: 'TON',
            name: 'Deceptive TON Jetton',
            decimals: 6,
            imageUrl: 'https://example.com/token.png',
        });
        const input = createActiveQuoteIntent({
            network: 'mainnet',
            ownerAddress: Address.parseRaw(`0:${'33'.repeat(32)}`).toString(),
            account: {
                type: 'v4r2',
                address: Address.parseRaw(`0:${'33'.repeat(32)}`).toString(),
            },
            from: deceptiveJetton,
            to: ACTIVE_TON_ASSET,
            amount: '.5',
            slippageBps: 100,
            correlationId: 'swap_test',
        });

        expect(input.from.contractAddress).toBe(MASTER);
        expect(input.to.contractAddress).toBe('native');
        expect(input.amount).toBe('.5');
        expect(Object.isFrozen(input)).toBe(true);
    });

    it('rejects malformed asset envelopes at the strict boundary', () => {
        expect(() => decodeStonfiAssets([])).toThrow('invalid asset response');
        expect(() => decodeStonfiAssets({ assets: [] })).toThrow('invalid asset list');
    });

    it('decodes validated decimal display balances without floating-point parser calls', () => {
        expect(findActiveAssetBalance(ACTIVE_TON_ASSET, [
            { symbol: 'Gram', rawBalance: '12.5' },
        ])).toBe(12.5);
        expect(findActiveAssetBalance(ACTIVE_TON_ASSET, [
            { symbol: 'Gram', rawBalance: '1e2' },
        ])).toBe(0);
    });

    it('matches balances by Jetton master rather than display symbol or wallet address', () => {
        const asset = Object.freeze({
            contractAddress: MASTER,
            symbol: 'USDT',
            name: 'Token',
            decimals: 6,
            imageUrl: 'https://example.com/token.png',
        });
        const tokens = [
            {
                symbol: 'USDT',
                masterAddress: OTHER_MASTER,
                walletAddress: MASTER,
                rawBalance: 999,
            },
            {
                symbol: 'DECEPTIVE',
                masterAddress: MASTER,
                walletAddress: OTHER_MASTER,
                rawBalance: 12.5,
            },
        ];

        expect(findActiveAssetBalance(asset, tokens)).toBe(12.5);
    });
});
