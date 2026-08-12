import { describe, expect, it } from 'vitest';

import { createJettonAsset, TON_ASSET } from '../../src/assets/fungible';
import { InvalidAmountError } from '../../src/core/errors';
import {
    TransferConstructionError,
    createJettonTransferIntent,
    createNativeTonTransferIntent,
} from '../../src/transfer';
import {
    JETTON_MASTER,
    OWNER,
    QUERY_ID,
    RECIPIENT,
    SENDER_JETTON_WALLET,
    SIX_DECIMAL_JETTON,
} from './fixtures';

describe('strict transfer amount conversion', () => {
    it.each([
        ['.5', 500_000_000n],
        ['12.', 12_000_000_000n],
        ['1.0000000000', 1_000_000_000n],
    ])('parses native TON %s exactly', (amount, expected) => {
        const intent = createNativeTonTransferIntent({
            network: 'mainnet',
            asset: TON_ASSET,
            recipient: RECIPIENT,
            amount,
            bounce: false,
            purpose: 'Send TON',
        });

        expect(intent.amount).toBe(expected);
        expect(intent.attachedTon).toBe(expected);
        expect(Object.isFrozen(intent)).toBe(true);
    });

    it('parses six- and nine-decimal Jetton inputs without floating point', () => {
        const nineDecimalJetton = createJettonAsset({
            master: JETTON_MASTER,
            symbol: 'TEST9',
            name: 'Test Nine',
            decimals: 9,
        });

        expect(createJettonIntent('.5', SIX_DECIMAL_JETTON).amount).toBe(500_000n);
        expect(createJettonIntent('12.', nineDecimalJetton).amount).toBe(12_000_000_000n);
    });

    it.each(['', '.', '1e3', '-1', '+1', 'NaN', 'Infinity', '1.2.3']) (
        'rejects malformed amount %s',
        (amount) => {
            expect(() => createNativeTonTransferIntent({
                network: 'mainnet',
                asset: TON_ASSET,
                recipient: RECIPIENT,
                amount,
                bounce: false,
                purpose: 'Send TON',
            })).toThrow(InvalidAmountError);
        },
    );

    it('rejects zero and significant excess precision instead of truncating', () => {
        expect(() => createJettonIntent('0', SIX_DECIMAL_JETTON)).toThrow(TransferConstructionError);
        expect(() => createJettonIntent('1.0000001', SIX_DECIMAL_JETTON)).toThrow(InvalidAmountError);
        expect(createJettonIntent('1.0000000', SIX_DECIMAL_JETTON).amount).toBe(1_000_000n);
    });
});

function createJettonIntent(
    amount: string,
    asset: ReturnType<typeof createJettonAsset>,
) {
    return createJettonTransferIntent({
        network: 'mainnet',
        asset,
        recipient: RECIPIENT,
        amount,
        attachedTon: 50_000_000n,
        bounce: true,
        purpose: 'Send Jetton',
        ownerAddress: OWNER,
        senderJettonWalletAddress: SENDER_JETTON_WALLET,
        responseDestination: OWNER,
        queryId: QUERY_ID,
        forwardTonAmount: 10_000_000n,
    });
}
