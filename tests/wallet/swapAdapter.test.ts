import { beginCell } from '@ton/core';
import { describe, expect, it } from 'vitest';

import { toUnsignedWalletMessages } from '../../src/swap';
import type { OutgoingMessage } from '../../src/swap';

const DESTINATION_ADDRESS = 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c';

describe('swap to wallet execution adapter', () => {
    it('preserves the exact validated cell and signing fields', () => {
        const body = beginCell().storeUint(0x6664de2a, 32).storeUint(123n, 64).endCell();
        const swapMessage: OutgoingMessage = {
            to: DESTINATION_ADDRESS,
            value: 300_000_000n,
            body,
            bounce: true,
            purpose: 'Swap TON for a jetton through an audited router',
            destinationRole: 'proxy-ton-wallet',
        };

        const [walletMessage] = toUnsignedWalletMessages([swapMessage]);

        expect(walletMessage).toEqual({
            to: swapMessage.to,
            value: swapMessage.value,
            body,
            bounce: true,
            purpose: swapMessage.purpose,
        });
        expect(walletMessage?.body).toBe(body);
    });

    it('returns frozen data so the post-validation message cannot be mutated', () => {
        const swapMessage: OutgoingMessage = {
            to: DESTINATION_ADDRESS,
            value: 1n,
            body: beginCell().endCell(),
            bounce: true,
            purpose: 'Validated contract call',
            destinationRole: 'dex-router',
        };

        const messages = toUnsignedWalletMessages([swapMessage]);

        expect(Object.isFrozen(messages)).toBe(true);
        expect(Object.isFrozen(messages[0])).toBe(true);
    });

    it('does not leak swap-specific destination roles into the wallet model', () => {
        const [walletMessage] = toUnsignedWalletMessages([
            {
                to: DESTINATION_ADDRESS,
                value: 1n,
                body: beginCell().endCell(),
                bounce: true,
                purpose: 'Validated router call',
                destinationRole: 'dex-router',
            },
        ]);

        expect(walletMessage).not.toHaveProperty('destinationRole');
    });
});
