import { Address } from '@ton/core';
import { describe, expect, it } from 'vitest';

import { buildNativeTonTransferMessage } from '../../src/transfer';
import { RECIPIENT, nativeIntent } from './fixtures';

describe('strict native TON message construction', () => {
    it('builds an exact bodyless native message', () => {
        const message = buildNativeTonTransferMessage(nativeIntent());

        expect(Address.parse(message.to).equals(Address.parse(RECIPIENT))).toBe(true);
        expect(message.value).toBe(1_250_000_000n);
        expect(message.body).toBeUndefined();
        expect(message.bounce).toBe(false);
        expect(message.purpose).toBe('Send 1.25 TON');
        expect(Object.isFrozen(message)).toBe(true);
        expect(message).not.toHaveProperty('password');
        expect(message).not.toHaveProperty('mnemonic');
        expect(message).not.toHaveProperty('secretKey');
    });

    it.each([true, false])('preserves an explicit bounce policy of %s', (bounce) => {
        expect(buildNativeTonTransferMessage(nativeIntent({ bounce })).bounce).toBe(bounce);
    });

    it('builds an exact opcode-zero comment body', () => {
        const message = buildNativeTonTransferMessage(nativeIntent({ comment: 'invoice-42' }));
        const slice = message.body?.beginParse();

        expect(slice?.loadUint(32)).toBe(0);
        expect(slice?.loadStringTail()).toBe('invoice-42');
    });

    it('accepts an equivalent non-bounceable recipient spelling and canonicalizes it', () => {
        const nonBounceable = Address.parse(RECIPIENT).toString({ bounceable: false });
        const message = buildNativeTonTransferMessage(nativeIntent({ recipient: nonBounceable }));

        expect(Address.parse(message.to).equals(Address.parse(RECIPIENT))).toBe(true);
    });

    it('rejects a friendly address whose test-only flag disagrees with mainnet', () => {
        const testOnly = Address.parse(RECIPIENT).toString({ testOnly: true });
        expect(() => buildNativeTonTransferMessage(nativeIntent({ recipient: testOnly }))).toThrow(
            expect.objectContaining({ code: 'INVALID_TRANSFER_INTENT' }),
        );
    });

    it('rejects a mismatch between the approved native amount and attached TON', () => {
        expect(() => buildNativeTonTransferMessage(nativeIntent({ attachedTon: 1n }))).toThrow(
            expect.objectContaining({ code: 'INVALID_TRANSFER_INTENT' }),
        );
    });
});
