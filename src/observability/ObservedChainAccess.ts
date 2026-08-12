import type { Address, Contract, OpenedContract, TupleItem } from '@ton/core';

import type { ChainAccess, GetMethodResult, NetworkId } from '../core/chain';
import { BlockchainDiagnostics } from './diagnostics';

/**
 * Read-only chain decorator that records RPC latency without request bodies.
 *
 * It intentionally logs only the network, operation name, get-method name, and
 * argument count. Addresses, stack values, provider responses, API keys, and
 * endpoint URLs are excluded from the diagnostic contract.
 */
export class ObservedChainAccess implements ChainAccess {
    public readonly network: NetworkId;
    private readonly chain: ChainAccess;
    private readonly diagnostics: BlockchainDiagnostics;

    public constructor(chain: ChainAccess, diagnostics: BlockchainDiagnostics) {
        this.chain = chain;
        this.network = chain.network;
        this.diagnostics = diagnostics;
    }

    public open<T extends Contract>(contract: T): OpenedContract<T> {
        // Contract wrappers issue calls through their provider internally. This
        // synchronous binding step has no RPC latency to measure.
        return this.chain.open(contract);
    }

    public getBalance(address: Address | string): Promise<bigint> {
        return this.diagnostics.measure(
            'rpc',
            { network: this.network, rpcMethod: 'getBalance' },
            () => this.chain.getBalance(address),
        );
    }

    public isDeployed(address: Address | string): Promise<boolean> {
        return this.diagnostics.measure(
            'rpc',
            { network: this.network, rpcMethod: 'isDeployed' },
            () => this.chain.isDeployed(address),
        );
    }

    public runGetMethod(
        address: Address | string,
        method: string,
        args: readonly TupleItem[] = [],
    ): Promise<GetMethodResult> {
        return this.diagnostics.measure(
            'rpc',
            {
                network: this.network,
                rpcMethod: 'runGetMethod',
                contractMethod: method,
                argumentCount: args.length,
            },
            () => this.chain.runGetMethod(address, method, args),
        );
    }
}
