import {
    Address,
    beginCell,
    storeStateInit,
} from '@ton/core';
import { describe, expect, it } from 'vitest';

import {
    TonConnectWalletError,
    decodeRawSendTransaction,
} from '../../../src/tonconnect/wallet';
import type { StandardWalletDescriptor } from '../../../src/wallet';

const NOW = 1_800_000_000;
const APP_ID = 'ab'.repeat(32);
const WALLET_RAW = `0:${'11'.repeat(32)}`;
const DESTINATION = Address.parse(`0:${'22'.repeat(32)}`);
const WALLET: StandardWalletDescriptor = Object.freeze({
    kind: 'standard',
    version: 'v4r2',
    address: WALLET_RAW,
});

function context(network: 'mainnet' | 'testnet' = 'mainnet') {
    return Object.freeze({
        network,
        wallet: WALLET,
        requestId: '9007199254740993',
        appClientId: APP_ID,
        nowUnix: NOW,
    });
}

function friendly(network: 'mainnet' | 'testnet', bounceable: boolean): string {
    return DESTINATION.toString({
        bounceable,
        testOnly: network === 'testnet',
        urlSafe: true,
    });
}

function payload(overrides: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> {
    return {
        valid_until: NOW + 120,
        network: '-239',
        from: WALLET_RAW,
        messages: [{ address: friendly('mainnet', true), amount: '1000000000' }],
        ...overrides,
    };
}

function expectInvalid(action: () => unknown): void {
    let thrown: unknown;
    try {
        action();
    } catch (error) {
        thrown = error;
    }
    expect(thrown).toBeInstanceOf(TonConnectWalletError);
    expect((thrown as TonConnectWalletError).code).toBe('INVALID_SEND_TRANSACTION');
}

describe('raw TON Connect sendTransaction decoder', () => {
    it('creates a frozen standard-wallet request and preserves TEP-2 bounce flags', () => {
        const body = beginCell().storeUint(0, 32).storeStringTail('hello').endCell();
        const stateInit = beginCell().store(storeStateInit({ data: beginCell().storeUint(1, 1).endCell() })).endCell();
        const decoded = decodeRawSendTransaction(payload({
            messages: [
                {
                    address: friendly('mainnet', true),
                    amount: '1000000000',
                    payload: body.toBoc().toString('base64'),
                    stateInit: stateInit.toBoc().toString('base64'),
                },
                { address: friendly('mainnet', false), amount: '1' },
            ],
        }), context());

        expect(decoded).toMatchObject({
            network: 'mainnet',
            wallet: WALLET,
            validUntilUnix: NOW + 120,
            correlationId: 'tc_abababababababab_9007199254740993',
        });
        expect(decoded.messages).toHaveLength(2);
        expect(decoded.messages[0]).toMatchObject({
            to: DESTINATION.toRawString(),
            value: 1_000_000_000n,
            bounce: true,
        });
        expect(decoded.messages[0]?.body?.equals(body)).toBe(true);
        expect(decoded.messages[1]?.bounce).toBe(false);
        expect(Object.isFrozen(decoded)).toBe(true);
        expect(Object.isFrozen(decoded.messages)).toBe(true);
        expect(Object.isFrozen(decoded.messages[0])).toBe(true);
    });

    it('accepts explicit testnet requests only with test-only friendly addresses', () => {
        const decoded = decodeRawSendTransaction(payload({
            network: '-3',
            messages: [{ address: friendly('testnet', false), amount: '7' }],
        }), context('testnet'));
        expect(decoded.network).toBe('testnet');
        expect(decoded.messages[0]?.bounce).toBe(false);
    });

    it.each([
        payload({ network: '-3' }),
        payload({ from: `0:${'33'.repeat(32)}` }),
        payload({ valid_until: NOW }),
        payload({ valid_until: NOW + 301 }),
        payload({ messages: [] }),
        payload({ messages: Array.from({ length: 5 }, () => ({ address: friendly('mainnet', true), amount: '1' })) }),
        payload({ messages: [{ address: DESTINATION.toRawString(), amount: '1' }] }),
        payload({ messages: [{ address: friendly('testnet', true), amount: '1' }] }),
        payload({ messages: [{ address: friendly('mainnet', true), amount: '01' }] }),
        payload({ messages: [{ address: friendly('mainnet', true), amount: '0' }] }),
        payload({ messages: [{ address: friendly('mainnet', true), amount: String(1n << 64n) }] }),
        payload({ messages: [{ address: friendly('mainnet', true), amount: '1', extraCurrency: {} }] }),
        { ...payload(), items: [] },
    ])('rejects malformed, incoherent, or unsupported raw transactions', (value) => {
        expect(() => decodeRawSendTransaction(value, context())).toThrow(TonConnectWalletError);
    });

    it.each([
        'not-base64',
        Buffer.from('broken').toString('base64'),
        beginCell().endCell().toBoc().toString('base64').replace(/=$/u, ''),
    ])('rejects malformed or non-canonical payload BOCs', (boc) => {
        expectInvalid(() => decodeRawSendTransaction(payload({
            messages: [{ address: friendly('mainnet', true), amount: '1', payload: boc }],
        }), context()));
    });

    it('rejects a valid Cell that is not a StateInit encoding', () => {
        const notStateInit = beginCell().storeUint(0xffff, 16).endCell().toBoc().toString('base64');
        expectInvalid(() => decodeRawSendTransaction(payload({
            messages: [{ address: friendly('mainnet', true), amount: '1', stateInit: notStateInit }],
        }), context()));
    });

    it('rejects Highload before any raw transaction is decoded', () => {
        expectInvalid(() => decodeRawSendTransaction(payload(), {
            ...context(),
            wallet: {
                kind: 'highload-v3',
                version: 'highload-v3',
                address: WALLET_RAW,
                subwalletId: 0,
                timeoutSeconds: 60,
            } as never,
        }));
    });
});
