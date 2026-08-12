import { beginCell } from '@ton/core';
import { describe, expect, it } from 'vitest';

import type { WalletExecutionRequest } from '../../src/wallet';
import { WalletExecutionError, assertWalletExecutionRequest } from '../../src/wallet';

const WALLET_ADDRESS = 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c';
const DESTINATION_ADDRESS = 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c';

function standardRequest(overrides: Partial<WalletExecutionRequest> = {}): WalletExecutionRequest {
    return {
        network: 'mainnet',
        wallet: {
            kind: 'standard',
            version: 'v4r2',
            address: WALLET_ADDRESS,
            subwalletId: 698983191,
        },
        messages: [
            {
                to: DESTINATION_ADDRESS,
                value: 1n,
                bounce: true,
                purpose: 'Send an audited contract message',
            },
        ],
        validUntilUnix: 1_000_120,
        correlationId: 'tx_01HZZZ',
        ...overrides,
    };
}

function expectCode(work: () => void, code: string): void {
    try {
        work();
        throw new Error('Expected validation to throw.');
    } catch (error) {
        expect(error).toBeInstanceOf(WalletExecutionError);
        expect((error as WalletExecutionError).code).toBe(code);
    }
}

describe('wallet execution request validation', () => {
    it('accepts an explicit, exact-unit, network-bound request', () => {
        expect(() => assertWalletExecutionRequest(standardRequest(), { nowUnix: 1_000_000 })).not.toThrow();
    });

    it('accepts a payload cell without serializing or inspecting it', () => {
        const body = beginCell().storeUint(0x0f8a7ea5, 32).endCell();
        const request = standardRequest({
            messages: [
                {
                    to: DESTINATION_ADDRESS,
                    value: 100_000_000n,
                    body,
                    bounce: true,
                    purpose: 'Transfer a jetton',
                },
            ],
        });

        expect(() => assertWalletExecutionRequest(request, { nowUnix: 1_000_000 })).not.toThrow();
        expect(request.messages[0]?.body).toBe(body);
    });

    it('rejects an expired request before signing', () => {
        expectCode(
            () => assertWalletExecutionRequest(standardRequest({ validUntilUnix: 1_000_000 }), { nowUnix: 1_000_000 }),
            'REQUEST_EXPIRED',
        );
    });

    it('rejects a suspiciously long validity window', () => {
        expectCode(
            () => assertWalletExecutionRequest(standardRequest({ validUntilUnix: 1_001_000 }), { nowUnix: 1_000_000 }),
            'INVALID_WALLET_REQUEST',
        );
    });

    it('rejects empty batches', () => {
        expectCode(
            () => assertWalletExecutionRequest(standardRequest({ messages: [] }), { nowUnix: 1_000_000 }),
            'INVALID_WALLET_REQUEST',
        );
    });

    it('rejects non-positive message values', () => {
        const request = standardRequest({
            messages: [
                {
                    to: DESTINATION_ADDRESS,
                    value: 0n,
                    bounce: true,
                    purpose: 'Invalid transfer',
                },
            ],
        });

        expectCode(
            () => assertWalletExecutionRequest(request, { nowUnix: 1_000_000 }),
            'INVALID_WALLET_REQUEST',
        );
    });

    it('rejects a missing approval description', () => {
        const request = standardRequest({
            messages: [
                {
                    to: DESTINATION_ADDRESS,
                    value: 1n,
                    bounce: true,
                    purpose: '   ',
                },
            ],
        });

        expectCode(
            () => assertWalletExecutionRequest(request, { nowUnix: 1_000_000 }),
            'INVALID_WALLET_REQUEST',
        );
    });

    it('rejects correlation identifiers that are unsafe for structured diagnostics', () => {
        expectCode(
            () =>
                assertWalletExecutionRequest(standardRequest({ correlationId: 'seed=should-not-appear' }), {
                    nowUnix: 1_000_000,
                }),
            'INVALID_WALLET_REQUEST',
        );
    });

    it('limits standard wallets to four messages', () => {
        const message = {
            to: DESTINATION_ADDRESS,
            value: 1n,
            bounce: true,
            purpose: 'Batch item',
        } as const;

        expectCode(
            () =>
                assertWalletExecutionRequest(standardRequest({ messages: [message, message, message, message, message] }), {
                    nowUnix: 1_000_000,
                }),
            'INVALID_WALLET_REQUEST',
        );
    });

    it('validates Highload V3 replay configuration fields', () => {
        const request = standardRequest({
            wallet: {
                kind: 'highload-v3',
                version: 'highload-v3',
                address: WALLET_ADDRESS,
                subwalletId: 4269,
                timeoutSeconds: 3600,
            },
        });

        expect(() => assertWalletExecutionRequest(request, { nowUnix: 1_000_000 })).not.toThrow();
    });

    it('rejects a Highload V3 timeout that does not fit the contract field', () => {
        const request = standardRequest({
            wallet: {
                kind: 'highload-v3',
                version: 'highload-v3',
                address: WALLET_ADDRESS,
                subwalletId: 4269,
                timeoutSeconds: 1 << 22,
            },
        });

        expectCode(
            () => assertWalletExecutionRequest(request, { nowUnix: 1_000_000 }),
            'INVALID_WALLET_REQUEST',
        );
    });
});
