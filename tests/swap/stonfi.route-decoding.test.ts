import { describe, expect, it } from 'vitest';

import { __testables as providerTestables } from '../../src/swap/providers/stonfi/StonfiProvider';
import {
    PINNED_ROUTERS,
    __testables as registryTestables,
} from '../../src/swap/providers/stonfi/routerRegistry';
import { testAddress } from './fixtures';

const [pinnedRouter] = PINNED_ROUTERS;
if (pinnedRouter === undefined) {
    throw new Error('Expected at least one pinned STON.fi router fixture.');
}

const GAS = Object.freeze({
    messageValue: 300_000_000n,
    forwardValue: 240_000_000n,
    estimatedConsumption: 180_000_000n,
});

function quoteData(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
    return {
        kind: 'stonfi/quote@1',
        direction: 'jetton-to-ton',
        router: { ...pinnedRouter, trustSource: 'pinned' },
        poolAddress: testAddress('stonfi-pool'),
        gas: GAS,
        reportedOfferJettonWallet: testAddress('reported-offer-wallet'),
        reportedAskJettonWallet: pinnedRouter.ptonWalletAddress,
        ...overrides,
    };
}

function registryRouter(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
    return {
        address: testAddress('live-stonfi-router'),
        majorVersion: 2,
        minorVersion: 2,
        ptonMasterAddress: pinnedRouter.ptonMasterAddress,
        ptonVersion: '2.1',
        ptonWalletAddress: testAddress('live-stonfi-pton-wallet'),
        routerType: 'ConstantProduct',
        poolCreationEnabled: true,
        ...overrides,
    };
}

describe('STON.fi quote route decoding', () => {
    it('accepts and canonicalizes a complete supported quote-data object', () => {
        const decoded = providerTestables.decodeStonfiQuoteData(quoteData());

        expect(decoded).not.toBeNull();
        expect(decoded?.direction).toBe('jetton-to-ton');
        expect(decoded?.gas).toEqual(GAS);
        expect(Object.isFrozen(decoded)).toBe(true);
        expect(Object.isFrozen(decoded?.router)).toBe(true);
        expect(Object.isFrozen(decoded?.gas)).toBe(true);
    });

    it.each([
        ['missing route data', null],
        ['wrong discriminator', quoteData({ kind: 'stonfi/quote@0' })],
        ['unknown fields', quoteData({ signedPayload: 'must-not-be-accepted' })],
        ['invalid direction', quoteData({ direction: 'ton-to-ton' })],
        ['malformed pool address', quoteData({ poolAddress: 'not-an-address' })],
        ['non-bigint gas', quoteData({ gas: { ...GAS, forwardValue: '240000000' } })],
        ['forward gas equal to message value', quoteData({ gas: { ...GAS, forwardValue: GAS.messageValue } })],
        [
            'V1 router paired with pTON v2.1',
            quoteData({
                router: {
                    ...pinnedRouter,
                    ptonVersion: '2.1',
                    trustSource: 'pinned',
                },
            }),
        ],
        [
            'unsupported router version',
            quoteData({
                router: {
                    ...pinnedRouter,
                    majorVersion: 9,
                    minorVersion: 9,
                    trustSource: 'pinned',
                },
            }),
        ],
    ])('rejects %s', (_label, value) => {
        expect(providerTestables.decodeStonfiQuoteData(value)).toBeNull();
    });
});

describe('STON.fi live router registry decoding', () => {
    it('accepts a supported exact router record and assigns registry trust', () => {
        const decoded = registryTestables.decodeRegistryRouter(registryRouter());

        expect(decoded).not.toBeNull();
        expect(decoded?.trustSource).toBe('registry');
        expect(decoded?.majorVersion).toBe(2);
        expect(decoded?.minorVersion).toBe(2);
        expect(Object.isFrozen(decoded)).toBe(true);
    });

    it.each([
        ['unknown fields', registryRouter({ payload: 'unexpected' })],
        ['invalid address', registryRouter({ address: 'invalid' })],
        ['negative major version', registryRouter({ majorVersion: -1 })],
        ['fractional minor version', registryRouter({ minorVersion: 2.2 })],
        ['non-boolean pool flag', registryRouter({ poolCreationEnabled: 'true' })],
        ['unknown router type', registryRouter({ routerType: 'MaliciousPool' })],
        ['V2 router paired with pTON v1', registryRouter({ ptonVersion: '1.0' })],
        ['unsupported V2 minor version', registryRouter({ minorVersion: 9 })],
    ])('rejects %s', (_label, value) => {
        expect(registryTestables.decodeRegistryRouter(value)).toBeNull();
    });
});
