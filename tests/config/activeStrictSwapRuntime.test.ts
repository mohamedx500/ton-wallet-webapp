import type { TonClient } from '@ton/ton';
import { describe, expect, it, vi } from 'vitest';

import {
    createActiveStrictSwapRuntime,
    createStrictSwapRuntimeOwner,
} from '../../src/config/activeStrictSwapRuntime';
import type { SynchronousKeyValueStorage } from '../../src/wallet';

function fakeClient(): TonClient {
    return {
        open: vi.fn(),
        getBalance: vi.fn(),
        isContractDeployed: vi.fn(),
        runMethod: vi.fn(),
        getContractState: vi.fn(),
        sendMessage: vi.fn(),
        getTransactions: vi.fn(),
    } as unknown as TonClient;
}

function memoryStorage(): SynchronousKeyValueStorage {
    const values = new Map<string, string>();
    return {
        getItem: (key): string | null => values.get(key) ?? null,
        setItem: (key, value): void => {
            values.set(key, value);
        },
        removeItem: (key): void => {
            values.delete(key);
        },
    };
}

describe('active strict swap runtime', () => {
    it.each(['mainnet', 'testnet'] as const)(
        'exposes only the explicit %s network and metadata adapter',
        (network) => {
            const create = vi.fn(() => fakeClient());
            const decryptData = vi.fn(async () => 'not invoked by composition');

            const runtime = createActiveStrictSwapRuntime({
                environment: { VITE_TON_NETWORK: network },
                storage: memoryStorage(),
                security: { decryptData },
                clientFactory: { create },
            });

            expect(Object.keys(runtime).sort()).toEqual(['graph', 'network', 'ui']);
            expect(runtime.network).toBe(network);
            expect(runtime.ui.network).toBe(network);
            expect(create).toHaveBeenCalledOnce();
            expect(decryptData).not.toHaveBeenCalled();
            expect(Object.isFrozen(runtime)).toBe(true);
        },
    );

    it('caches one successful runtime across repeated Strict Mode-style reads', () => {
        const runtime = Object.freeze({
            network: 'mainnet' as const,
            ui: Object.freeze({ marker: 'ui' }),
        });
        const create = vi.fn(() => runtime as never);
        const owner = createStrictSwapRuntimeOwner(create);

        const first = owner.get();
        const second = owner.get();

        expect(first).toBe(second);
        expect(first.status).toBe('ready');
        expect(create).toHaveBeenCalledOnce();
    });

    it('caches a secret-free configuration failure without silently choosing a network', () => {
        const owner = createStrictSwapRuntimeOwner(() =>
            createActiveStrictSwapRuntime({
                environment: { VITE_TON_NETWORK: 'invalid' },
                storage: memoryStorage(),
                security: {
                    decryptData: vi.fn(),
                },
                clientFactory: {
                    create: vi.fn(() => fakeClient()),
                },
            })
        );

        const first = owner.get();
        const second = owner.get();

        expect(first).toBe(second);
        expect(first).toEqual({
            status: 'unavailable',
            network: null,
            ui: null,
            errorCode: 'APPLICATION_NETWORK_INVALID',
        });
    });

    it('redacts unexpected initialization failures to a stable code', () => {
        const owner = createStrictSwapRuntimeOwner(() => {
            throw new Error('https://rpc.example.invalid?api_key=secret');
        });

        expect(owner.get()).toEqual({
            status: 'unavailable',
            network: null,
            ui: null,
            errorCode: 'STRICT_SWAP_INITIALIZATION_FAILED',
        });
    });
});
