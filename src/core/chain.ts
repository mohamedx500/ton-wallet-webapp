/**
 * Chain access abstraction
 * ============================================================================
 *
 * A narrow, injectable interface over the RPC layer. Everything above
 * `src/core` — the swap engine, DEX providers, the NFT indexer, the DNS
 * resolver — depends on this interface rather than on a concrete `TonClient`.
 *
 * WHY
 * ---
 * 1. **Testability.** The critical paths (payload construction, allow-list
 *    enforcement, slippage maths) must be unit-testable without a network. A
 *    fake `ChainAccess` makes that a three-line stub instead of an HTTP mock.
 * 2. **Failover.** The concrete implementation can transparently rotate
 *    endpoints without any caller knowing.
 * 3. **Surface control.** `TonClient` exposes dozens of methods; the feature
 *    layers need five. Narrowing the surface makes it obvious what the wallet
 *    actually asks the chain for.
 *
 * The interface is intentionally read-only. Signing and broadcasting live in the
 * wallet layer: a module that can build a message must not also be able to send
 * one without passing through validation.
 */

import type { Address, Contract, OpenedContract, TupleItem, TupleReader } from '@ton/core';
import type { TonClient } from '@ton/ton';

import { parseAddress } from './address';

/** Which TON network a client is bound to. */
export type NetworkId = 'mainnet' | 'testnet';

/** Result of a get-method invocation. */
export interface GetMethodResult {
    readonly gasUsed: number;
    readonly stack: TupleReader;
}

/** Read-only access to chain state. */
export interface ChainAccess {
    /** Network this instance is bound to. */
    readonly network: NetworkId;

    /**
     * Bind a `@ton/core` contract wrapper to this provider, so its methods can
     * be called without threading a `ContractProvider` through every call.
     *
     * This is how the official STON.fi contract classes are used:
     * `chain.open(router).getSwapJettonToJettonTxParams({ … })`.
     */
    open<T extends Contract>(contract: T): OpenedContract<T>;

    /** Account balance in nanotons. Returns `0n` for uninitialised accounts. */
    getBalance(address: Address | string): Promise<bigint>;

    /**
     * Whether the account has deployed code.
     *
     * Used before sending: a bounceable message to an *uninitialised* account is
     * rejected by the network, so the wallet must know which case it is in.
     */
    isDeployed(address: Address | string): Promise<boolean>;

    /** Invoke a get-method on a contract. */
    runGetMethod(address: Address | string, method: string, args?: readonly TupleItem[]): Promise<GetMethodResult>;
}

/** {@link ChainAccess} backed by a `@ton/ton` `TonClient`. */
export class TonClientChainAccess implements ChainAccess {
    public readonly network: NetworkId;
    private readonly client: TonClient;

    public constructor(client: TonClient, network: NetworkId) {
        this.client = client;
        this.network = network;
    }

    /** The underlying client, for the rare case a caller needs the full surface. */
    public get raw(): TonClient {
        return this.client;
    }

    public open<T extends Contract>(contract: T): OpenedContract<T> {
        return this.client.open(contract);
    }

    public async getBalance(address: Address | string): Promise<bigint> {
        return this.client.getBalance(parseAddress(address));
    }

    public async isDeployed(address: Address | string): Promise<boolean> {
        return this.client.isContractDeployed(parseAddress(address));
    }

    public async runGetMethod(
        address: Address | string,
        method: string,
        args: readonly TupleItem[] = [],
    ): Promise<GetMethodResult> {
        const result = await this.client.runMethod(parseAddress(address), method, [...args]);
        return { gasUsed: result.gas_used, stack: result.stack };
    }
}
