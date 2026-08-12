import { describe, expect, it } from 'vitest';

import {
    ApplicationConfigError,
    decodeApplicationConfig,
} from '../../src/config/application';

function expectConfigError(environment: Parameters<typeof decodeApplicationConfig>[0], code: string): void {
    let thrown: unknown;
    try {
        decodeApplicationConfig(environment);
    } catch (error) {
        thrown = error;
    }
    expect(thrown).toBeInstanceOf(ApplicationConfigError);
    expect((thrown as ApplicationConfigError).code).toBe(code);
}

describe('decodeApplicationConfig', () => {
    it.each([
        ['mainnet', 'https://toncenter.com/api/v2/jsonRPC'],
        ['testnet', 'https://testnet.toncenter.com/api/v2/jsonRPC'],
    ] as const)('binds %s to its fixed RPC endpoint', (network, endpoint) => {
        const config = decodeApplicationConfig({ VITE_TON_NETWORK: network });

        expect(config).toEqual({
            network,
            rpc: {
                provider: 'toncenter',
                endpoint,
                timeoutMs: 30_000,
            },
        });
        expect(Object.isFrozen(config)).toBe(true);
        expect(Object.isFrozen(config.rpc)).toBe(true);
    });

    it.each([
        {},
        { VITE_TON_NETWORK: undefined },
        { VITE_TON_NETWORK: null },
        { VITE_TON_NETWORK: '' },
    ])('defaults to mainnet when missing', (environment) => {
        expect(decodeApplicationConfig(environment).network).toBe('mainnet');
    });

    it.each([
        'MAINNET',
        ' testnet ',
        'sandbox',
        true,
        false,
        0,
    ])('rejects invalid network value %j without coercion or boolean inference', (network) => {
        expectConfigError(
            { VITE_TON_NETWORK: network },
            'APPLICATION_NETWORK_INVALID',
        );
    });

    it('normalizes an optional API key without exposing it through errors', () => {
        const config = decodeApplicationConfig({
            VITE_TON_NETWORK: 'mainnet',
            VITE_TONCENTER_API_KEY: '  api-key  ',
        });

        expect(config.rpc.apiKey).toBe('api-key');
    });

    it.each([
        { VITE_TON_NETWORK: 'mainnet', VITE_TONCENTER_API_KEY: 123 },
        { VITE_TON_NETWORK: 'mainnet', VITE_TONCENTER_API_KEY: 'bad\nkey' },
        { VITE_TON_NETWORK: 'mainnet', VITE_TONCENTER_API_KEY: 'x'.repeat(513) },
    ])('rejects malformed API keys without including raw values', (environment) => {
        let thrown: unknown;
        try {
            decodeApplicationConfig(environment);
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toBeInstanceOf(ApplicationConfigError);
        expect((thrown as ApplicationConfigError).code).toBe('APPLICATION_API_KEY_INVALID');
        expect((thrown as Error).message).not.toContain('bad');
        expect((thrown as Error).message).not.toContain('x'.repeat(20));
    });

    it.each([
        [undefined, 30_000],
        ['', 30_000],
        ['1000', 1_000],
        ['45000', 45_000],
        ['120000', 120_000],
    ] as const)('decodes timeout %j as %d', (value, expected) => {
        const config = decodeApplicationConfig({
            VITE_TON_NETWORK: 'testnet',
            VITE_TON_RPC_TIMEOUT_MS: value,
        });

        expect(config.rpc.timeoutMs).toBe(expected);
    });

    it.each([
        30_000,
        '999',
        '120001',
        '030000',
        '30000.5',
        '-30000',
        '3e4',
        ' 30000 ',
        'not-a-number',
    ])('rejects invalid timeout value %j without coercion', (timeout) => {
        expectConfigError(
            {
                VITE_TON_NETWORK: 'mainnet',
                VITE_TON_RPC_TIMEOUT_MS: timeout,
            },
            'APPLICATION_RPC_TIMEOUT_INVALID',
        );
    });

    it('ignores unrelated values rather than inferring TON network identity from them', () => {
        expect(decodeApplicationConfig({
            endpoint: 'https://testnet.toncenter.com/api/v2/jsonRPC',
            testnet: true,
            walletAddress: 'testnet-looking-address',
            isOnline: true,
        } as Parameters<typeof decodeApplicationConfig>[0]).network).toBe('mainnet');
    });
});
