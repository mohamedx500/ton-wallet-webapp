import { describe, expect, it } from 'vitest';

import { formatAddress, parseAddress } from '../../src/core/address';
import { SwapErrorCode } from '../../src/swap/errors';
import { StonfiProvider, __testables as providerTestables } from '../../src/swap/providers/stonfi/StonfiProvider';
import { StonfiClient, __testables as clientTestables } from '../../src/swap/providers/stonfi/client';
import type { StonApi } from '../../src/swap/providers/stonfi/client';
import type { SwapReference } from '../../src/swap/types';
import { FakeChain, ROUTER, WALLET, testAddress } from './fixtures';

const QUERY_ID = 0x1234_5678_9abc_def0n;
const TX_HASH = 'ab'.repeat(32);

function foundStatus(overrides: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> {
    return {
        '@type': 'Found',
        address: WALLET,
        exitCode: 'swap_ok',
        queryId: QUERY_ID.toString(),
        txHash: TX_HASH,
        coins: '990000000',
        balanceDeltas: '[]',
        logicalTime: '123456789',
        ...overrides,
    };
}

function statusApi(response: unknown): StonApi {
    return {
        getSwapStatus: async () => response,
        simulateSwap: async () => {
            throw new Error('unused');
        },
        queryAssets: async () => {
            throw new Error('unused');
        },
        getRouters: async () => {
            throw new Error('unused');
        },
    };
}

function reference(overrides: Partial<SwapReference> = {}): SwapReference {
    return {
        providerId: 'stonfi',
        routerAddress: ROUTER,
        ownerAddress: WALLET,
        queryId: QUERY_ID,
        deadlineUnix: 1_754_000_600,
        ...overrides,
    };
}

function providerFor(response: unknown): StonfiProvider {
    return new StonfiProvider(new FakeChain(), {
        client: new StonfiClient({ api: statusApi(response) }),
    });
}

async function expectProviderProtocolError(work: Promise<unknown>): Promise<void> {
    await expect(work).rejects.toMatchObject({
        code: SwapErrorCode.ProviderProtocolError,
        providerId: 'stonfi',
    });
}

describe('STON.fi swap-status runtime decoding', () => {
    it('retries swap status with alternate owner address encodings', async () => {
        const bounceable = formatAddress(parseAddress(WALLET), { bounceable: true });
        const nonBounceable = formatAddress(parseAddress(WALLET), { bounceable: false });
        let calls = 0;
        const client = new StonfiClient({
            api: {
                getSwapStatus: async ({ ownerAddress }) => {
                    calls += 1;
                    if (ownerAddress === bounceable) {
                        return { '@type': 'NotFound' };
                    }
                    if (ownerAddress === nonBounceable) {
                        return foundStatus();
                    }
                    throw new Error(`unexpected owner ${ownerAddress}`);
                },
                simulateSwap: async () => { throw new Error('unused'); },
                queryAssets: async () => { throw new Error('unused'); },
                getRouters: async () => { throw new Error('unused'); },
            },
        });

        const status = await client.getSwapStatus({
            routerAddress: ROUTER,
            ownerAddress: bounceable,
            queryId: QUERY_ID,
        });

        expect(status.found).toBe(true);
        expect(calls).toBe(2);
    });

    it('accepts the exact documented Found response', () => {
        expect(clientTestables.decodeSwapStatus(foundStatus())).toEqual({
            found: true,
            walletAddress: WALLET,
            exitCode: 'swap_ok',
            queryId: QUERY_ID.toString(),
            txHash: TX_HASH,
            coins: '990000000',
            balanceDeltas: '[]',
            logicalTime: '123456789',
        });
    });

    it('accepts only the exact NotFound discriminator', () => {
        expect(clientTestables.decodeSwapStatus({ '@type': 'NotFound' })).toEqual({ found: false });
        expect(() => clientTestables.decodeSwapStatus({ '@type': 'NotFound', queryId: '1' }))
            .toThrowError(/unexpected or missing fields/i);
    });

    it.each([
        ['unknown discriminator', foundStatus({ '@type': 'Pending' })],
        ['unknown field', foundStatus({ extra: 'unexpected' })],
        ['malformed wallet address', foundStatus({ address: 'not-an-address' })],
        ['non-decimal query id', foundStatus({ queryId: '1e6' })],
        ['negative coin amount', foundStatus({ coins: '-1' })],
        ['non-decimal logical time', foundStatus({ logicalTime: '1.5' })],
        ['missing transaction hash', (() => {
            const value: Record<string, unknown> = { ...foundStatus() };
            delete value['txHash'];
            return value;
        })()],
    ])('rejects %s', (_label, value) => {
        expect(() => clientTestables.decodeSwapStatus(value)).toThrowError();
    });
});

describe('STON.fi outcome correlation and classification', () => {
    it('returns pending when STON.fi has not indexed the requested operation', async () => {
        await expect(providerFor({ '@type': 'NotFound' }).getOutcome(reference())).resolves.toMatchObject({
            state: 'pending',
            exitCode: null,
            txHash: null,
            receivedUnits: null,
        });
    });

    it('reports documented successful swap outcomes with exact received units', async () => {
        const outcome = await providerFor(foundStatus()).getOutcome(reference());

        expect(outcome).toMatchObject({
            state: 'succeeded',
            exitCode: 'swap_ok',
            txHash: TX_HASH,
            receivedUnits: 990000000n,
        });
        expect(Object.isFrozen(outcome)).toBe(true);
    });

    it('reports documented refund and bounce outcomes as failures', async () => {
        await expect(providerFor(foundStatus({ exitCode: 'swap_refund_slippage' })).getOutcome(reference()))
            .resolves.toMatchObject({ state: 'failed', exitCode: 'swap_refund_slippage' });
        await expect(providerFor(foundStatus({ exitCode: 'bounced' })).getOutcome(reference()))
            .resolves.toMatchObject({ state: 'failed', exitCode: 'bounced' });
    });

    it('never treats undocumented numeric zero or unknown swap-like codes as success', async () => {
        expect(providerTestables.classifyExitCode('0')).toBe('unknown');
        expect(providerTestables.classifyExitCode('swap_ok_future')).toBe('unknown');
        await expect(providerFor(foundStatus({ exitCode: '0' })).getOutcome(reference()))
            .resolves.toMatchObject({ state: 'unknown', exitCode: '0' });
    });

    it('rejects a Found response correlated to a different wallet', async () => {
        await expectProviderProtocolError(
            providerFor(foundStatus({ address: testAddress('different-owner') })).getOutcome(reference()),
        );
    });

    it('rejects a Found response correlated to a different query id', async () => {
        await expectProviderProtocolError(
            providerFor(foundStatus({ queryId: (QUERY_ID + 1n).toString() })).getOutcome(reference()),
        );
    });
});
