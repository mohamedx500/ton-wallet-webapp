import { Address, beginCell, type Contract, type OpenedContract, TupleReader } from '@ton/core';
import { describe, expect, it, vi } from 'vitest';

import type { ChainAccess } from '../../src/core/chain';
import {
    BlockchainDiagnostics,
    MemoryDiagnosticSink,
    ObservedChainAccess,
    type CorrelationIdSource,
} from '../../src/observability';

class FixedCorrelationIds implements CorrelationIdSource {
    public next(): string {
        return 'rpc-operation';
    }
}

function makeChain(): ChainAccess {
    return {
        network: 'testnet',
        open<T extends Contract>(contract: T): OpenedContract<T> {
            return contract as OpenedContract<T>;
        },
        getBalance: vi.fn(async () => 42n),
        isDeployed: vi.fn(async () => true),
        runGetMethod: vi.fn(async () => ({ gasUsed: 7, stack: new TupleReader([]) })),
    };
}

describe('ObservedChainAccess', () => {
    it('measures balance RPCs without recording an address', async () => {
        const sink = new MemoryDiagnosticSink();
        let now = 1_000;
        const diagnostics = new BlockchainDiagnostics({
            sink,
            clock: () => {
                const current = now;
                now += 25;
                return current;
            },
            correlationIds: new FixedCorrelationIds(),
        });
        const chain = makeChain();
        const observed = new ObservedChainAccess(chain, diagnostics);
        const address = Address.parse('EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c');

        await expect(observed.getBalance(address)).resolves.toBe(42n);
        expect(sink.events()[1]).toMatchObject({
            operation: 'rpc',
            stage: 'succeeded',
            durationMs: 25,
            attributes: { network: 'testnet', rpcMethod: 'getBalance' },
        });
        expect(JSON.stringify(sink.events())).not.toContain(address.toString());
    });

    it('records get-method identity and argument count but never stack values', async () => {
        const sink = new MemoryDiagnosticSink();
        const diagnostics = new BlockchainDiagnostics({
            sink,
            clock: () => 5_000,
            correlationIds: new FixedCorrelationIds(),
        });
        const observed = new ObservedChainAccess(makeChain(), diagnostics);
        const address = Address.parse('EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c');
        const cell = beginCell().storeBuffer(Buffer.from('sensitive stack value')).endCell();

        await observed.runGetMethod(address, 'get_wallet_address', [{ type: 'slice', cell }]);
        expect(sink.events()[0]?.attributes).toEqual({
            network: 'testnet',
            rpcMethod: 'runGetMethod',
            contractMethod: 'get_wallet_address',
            argumentCount: 1,
        });
        expect(JSON.stringify(sink.events())).not.toContain('sensitive stack value');
    });
});
