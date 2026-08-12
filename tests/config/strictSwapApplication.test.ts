import { describe, expect, it, vi } from 'vitest';
import type { TonClient } from '@ton/ton';

import { decodeApplicationConfig } from '../../src/config/application';
import {
    createStrictSwapApplication,
} from '../../src/config/strictSwapApplication';
import type {
    TonClientFactory,
} from '../../src/config/strictSwapApplication';
import type { SwapMnemonicDecryptor } from '../../src/swap';
import { OfficialStandardWalletSigner } from '../../src/wallet';
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
        getItem(key): string | null {
            return values.get(key) ?? null;
        },
        setItem(key, value): void {
            values.set(key, value);
        },
        removeItem(key): void {
            values.delete(key);
        },
    };
}

function decryptor(): SwapMnemonicDecryptor {
    return {
        decrypt: vi.fn(async () => {
            throw new Error('not invoked by composition');
        }),
    };
}

describe('createStrictSwapApplication', () => {
    it.each(['mainnet', 'testnet'] as const)('binds every public component to %s', (network) => {
        const client = fakeClient();
        const create = vi.fn(() => client);
        const graph = createStrictSwapApplication({
            config: decodeApplicationConfig({ VITE_TON_NETWORK: network }),
            storage: memoryStorage(),
            decryptor: decryptor(),
            clientFactory: { create },
            clockMs: () => 1_800_000_000_000,
        });

        expect(create).toHaveBeenCalledOnce();
        expect(graph.network).toBe(network);
        expect(graph.client).toBe(client);
        expect(graph.chain.network).toBe(network);
        expect(graph.engine.network).toBe(network);
        expect(graph.quoteSession.network).toBe(network);
        expect(graph.replayReader.network).toBe(network);
        expect(graph.broadcaster.network).toBe(network);
        expect(graph.confirmer.network).toBe(network);
        expect(graph.walletCoordinatorFactory.network).toBe(network);
        expect(graph.swapCoordinatorFactory.network).toBe(network);
        expect(graph.passwordExecutor.network).toBe(network);
        expect(graph.lifecycle.network).toBe(network);
        expect(graph.recoveryCoordinator.network).toBe(network);
        expect(graph.recovery.network).toBe(network);
        expect(graph.ui.network).toBe(network);
        expect(graph.ui.getSnapshot().network).toBe(network);
        expect(Object.isFrozen(graph)).toBe(true);
        expect(Object.isFrozen(graph.walletCoordinatorFactory)).toBe(true);
        expect(Object.isFrozen(graph.swapCoordinatorFactory)).toBe(true);
    });

    it('forwards only decoded RPC construction metadata to one client factory call', () => {
        const create = vi.fn(() => fakeClient());
        const config = decodeApplicationConfig({
            VITE_TON_NETWORK: 'testnet',
            VITE_TONCENTER_API_KEY: 'test-key',
            VITE_TON_RPC_TIMEOUT_MS: '45000',
        });

        createStrictSwapApplication({
            config,
            storage: memoryStorage(),
            decryptor: decryptor(),
            clientFactory: { create },
        });

        expect(create).toHaveBeenCalledOnce();
        expect(create).toHaveBeenCalledWith(config.rpc);
    });

    it('registers STON.fi as the only production provider', () => {
        const graph = createStrictSwapApplication({
            config: decodeApplicationConfig({ VITE_TON_NETWORK: 'mainnet' }),
            storage: memoryStorage(),
            decryptor: decryptor(),
            clientFactory: { create: () => fakeClient() },
        });

        expect(graph.registry.list().map((provider: any) => provider.id)).toEqual(['stonfi']);
        expect(graph.engine.providers.map((provider: any) => provider.id)).toEqual(['stonfi']);
        expect(graph.quoteSession.providerId).toBe('stonfi');
    });

    it('does not decrypt, read RPC, submit, confirm, or access storage during composition', () => {
        const client = fakeClient();
        const storage: SynchronousKeyValueStorage = {
            getItem: vi.fn(() => {
                throw new Error('storage read during composition');
            }),
            setItem: vi.fn(() => {
                throw new Error('storage write during composition');
            }),
            removeItem: vi.fn(() => {
                throw new Error('storage removal during composition');
            }),
        };
        const mnemonicDecryptor = decryptor();

        createStrictSwapApplication({
            config: decodeApplicationConfig({ VITE_TON_NETWORK: 'mainnet' }),
            storage,
            decryptor: mnemonicDecryptor,
            clientFactory: { create: () => client },
        });

        expect(mnemonicDecryptor.decrypt).not.toHaveBeenCalled();
        expect(storage.getItem).not.toHaveBeenCalled();
        expect(storage.setItem).not.toHaveBeenCalled();
        expect(storage.removeItem).not.toHaveBeenCalled();
        expect(client.getContractState).not.toHaveBeenCalled();
        expect(client.runMethod).not.toHaveBeenCalled();
        expect(client.sendMessage).not.toHaveBeenCalled();
        expect(client.getTransactions).not.toHaveBeenCalled();
    });

    it('creates transient wallet and swap coordinators without creating another client', () => {
        const client = fakeClient();
        const create = vi.fn(() => client);
        const graph = createStrictSwapApplication({
            config: decodeApplicationConfig({ VITE_TON_NETWORK: 'mainnet' }),
            storage: memoryStorage(),
            decryptor: decryptor(),
            clientFactory: { create },
        });
        const keyPair = { publicKey: Buffer.alloc(32), secretKey: Buffer.alloc(64) };
        const walletDesc: any = { kind: 'standard', version: 'v4r2', address: '0:123' };

        const firstWallet = graph.walletCoordinatorFactory.create(keyPair, walletDesc);
        const secondWallet = graph.walletCoordinatorFactory.create(keyPair, walletDesc);
        const firstSwap = graph.swapCoordinatorFactory.create(firstWallet);
        const secondSwap = graph.swapCoordinatorFactory.create(secondWallet);

        expect(firstWallet).not.toBe(secondWallet);
        expect(firstSwap).not.toBe(secondSwap);
        expect(firstWallet.network).toBe('mainnet');
        expect(firstSwap.network).toBe('mainnet');
        expect(create).toHaveBeenCalledOnce();
        expect(client.sendMessage).not.toHaveBeenCalled();
    });

    it('rejects a wallet coordinator from a different network before execution', () => {
        const graph = createStrictSwapApplication({
            config: decodeApplicationConfig({ VITE_TON_NETWORK: 'mainnet' }),
            storage: memoryStorage(),
            decryptor: decryptor(),
            clientFactory: { create: () => fakeClient() },
        });

        expect(() => graph.swapCoordinatorFactory.create({
            network: 'testnet',
            execute: vi.fn(),
        })).toThrow('same TON network');
    });

    it('does not reuse a graph implicitly across independent factory calls', () => {
        const clients = [fakeClient(), fakeClient()];
        let index = 0;
        const factory: TonClientFactory = {
            create(): TonClient {
                const client = clients[index];
                index += 1;
                if (client === undefined) throw new Error('unexpected client request');
                return client;
            },
        };
        const options = {
            config: decodeApplicationConfig({ VITE_TON_NETWORK: 'mainnet' }),
            storage: memoryStorage(),
            decryptor: decryptor(),
            clientFactory: factory,
        };

        const first = createStrictSwapApplication(options);
        const second = createStrictSwapApplication(options);

        expect(first).not.toBe(second);
        expect(first.client).toBe(clients[0]);
        expect(second.client).toBe(clients[1]);
    });
});
