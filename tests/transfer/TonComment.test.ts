import { describe, expect, it } from 'vitest';

import { buildTonComment } from '../../src/transfer';

describe('TON text comments', () => {
    it('represents omitted and empty comments as no body', () => {
        expect(buildTonComment(undefined)).toBeUndefined();
        expect(buildTonComment('')).toBeUndefined();
    });

    it('encodes an opcode-zero UTF-8 text comment', () => {
        const body = buildTonComment('Hello, TON!');
        expect(body).toBeDefined();

        const slice = body?.beginParse();
        expect(slice?.loadUint(32)).toBe(0);
        expect(slice?.loadStringTail()).toBe('Hello, TON!');
        expect(slice?.remainingBits).toBe(0);
        expect(slice?.remainingRefs).toBe(0);
    });
});
