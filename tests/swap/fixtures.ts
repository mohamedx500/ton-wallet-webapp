/**
 * Swap test fixtures
 * ============================================================================
 *
 * Builders for the swap domain model, plus a fake {@link ChainAccess}. Shared by
 * the validation, engine and provider suites.
 *
 * Two deliberate choices:
 *
 *  - **Addresses are derived, not pasted.** `testAddress('seed')` hashes the seed
 *    into a 32-byte account id and lets `@ton/core` compute the checksum. A
 *    hand-typed base64 address with a wrong checksum fails to parse, and the
 *    resulting test failure looks like a bug in the code under test rather than
 *    in the fixture.
 *  - **Builders take overrides and are otherwise valid.** Every test that asserts
 *    a rejection changes exactly one field, so what the test is about is the
 *    field it names — not the twelve it also had to fill in.
 */

import { createHash } from 'node:crypto';

import { Address, TupleReader, beginCell } from '@ton/core';
import type { Cell, Contract, OpenedContract, TupleItem } from '@ton/core';

import { AddressSet } from '../../src/core/address';
import type { ChainAccess, GetMethodResult, NetworkId } from '../../src/core/chain';
import { TON_ASSET, createJettonAsset } from '../../src/assets/fungible';
import type { FungibleAsset, JettonAsset } from '../../src/assets/fungible';
import { applySlippage } from '../../src/core/units';
import type {
    DestinationRole,
    DestinationVerdict,
    OutgoingMessage,
    SwapGasEstimate,
    SwapPlan,
    SwapQuote,
    SwapReference,
} from '../../src/swap/types';

/** A deterministic, checksum-valid mainnet address for a given seed. */
export function testAddress(seed: string): string {
    const account = createHash('sha256').update(`ton-wallet-test:${seed}`).digest();
    return new Address(0, account).toString({ bounceable: true, urlSafe: true });
}

export const WALLET = testAddress('wallet');
export const ROUTER = testAddress('router');
export const OWN_JETTON_WALLET = testAddress('own-jetton-wallet');
export const PROXY_TON_WALLET = testAddress('proxy-ton-wallet');
export const ATTACKER = testAddress('attacker');

/** USDT-like jetton: 6 decimals, verified. The pair from the bug report. */
export const USDT: JettonAsset = createJettonAsset({
    master: testAddress('usdt-master'),
    symbol: 'USD₮',
    name: 'Tether USD',
    decimals: 6,
    trust: 'verified',
});

/** A 9-decimal jetton, for the jetton→jetton direction. */
export const NOT: JettonAsset = createJettonAsset({
    master: testAddress('not-master'),
    symbol: 'NOT',
    name: 'Notcoin',
    decimals: 9,
    trust: 'verified',
});

/** An asset with no provenance, for the warning tests. */
export const UNVERIFIED: JettonAsset = createJettonAsset({
    master: testAddress('unverified-master'),
    symbol: 'SCAM',
    name: 'Definitely Not USDT',
    decimals: 9,
    trust: 'unknown',
});

export const TON: FungibleAsset = TON_ASSET;

export const DEFAULT_GAS: SwapGasEstimate = Object.freeze({
    messageValue: 300_000_000n,
    forwardValue: 240_000_000n,
    estimatedConsumption: 180_000_000n,
});

/** Fixed clock. Tests that care about time pass explicit offsets from this. */
export const NOW_MS = 1_754_000_000_000;

/**
 * A valid quote.
 *
 * `minOutUnits` defaults to exactly the slippage floor, so `assertSlippageFloor`
 * passes by construction and a test can make it fail by lowering it by one unit —
 * the smallest possible violation, which is the interesting one.
 */
export function makeQuote(overrides: Partial<SwapQuote> = {}): SwapQuote {
    const from = overrides.from ?? USDT;
    const to = overrides.to ?? TON;
    const offerUnits = overrides.offerUnits ?? 200_000n; // 0.2 USDT
    const expectedOutUnits = overrides.expectedOutUnits ?? 1_000_000_000n; // 1 TON
    const slippageBps = overrides.slippageBps ?? 100; // 1%
    return {
        providerId: 'test-dex',
        from,
        to,
        offerUnits,
        expectedOutUnits,
        minOutUnits: applySlippage(expectedOutUnits, slippageBps),
        slippageBps,
        recommendedSlippageBps: null,
        priceImpactBps: 12,
        feeUnits: 600n,
        feeAsset: from,
        gas: DEFAULT_GAS,
        route: [{ label: 'Test DEX · constant product pool', contractAddress: testAddress('pool') }],
        createdAtMs: NOW_MS,
        providerData: { kind: 'test' },
        ...overrides,
    };
}

/** A valid outgoing message. */
export function makeMessage(overrides: Partial<OutgoingMessage> = {}): OutgoingMessage {
    return {
        to: OWN_JETTON_WALLET,
        value: DEFAULT_GAS.messageValue,
        body: beginCell().storeUint(0x0f8a7ea5, 32).endCell(),
        bounce: true,
        purpose: 'Transfer 0.2 USD₮ to Test DEX router',
        destinationRole: 'own-jetton-wallet',
        ...overrides,
    };
}

export function makeReference(overrides: Partial<SwapReference> = {}): SwapReference {
    return {
        providerId: 'test-dex',
        routerAddress: ROUTER,
        ownerAddress: WALLET,
        queryId: 0x1234_5678_9abc_def0n,
        deadlineUnix: Math.floor(NOW_MS / 1000) + 600,
        ...overrides,
    };
}

/** A valid, signable plan. */
export function makePlan(overrides: Partial<SwapPlan> = {}): SwapPlan {
    const quote = overrides.quote ?? makeQuote();
    const messages = overrides.messages ?? [makeMessage({ value: quote.gas.messageValue })];
    return {
        providerId: quote.providerId,
        quote,
        messages,
        reference: makeReference({ providerId: quote.providerId }),
        trustedDestinations: new AddressSet(messages.map((message) => message.to)),
        expiresAtMs: NOW_MS + 120_000,
        ...overrides,
    };
}

/**
 * Verdicts that approve every destination in a plan, with the role the plan
 * claims. The "everything checks out" baseline; tests degrade individual entries.
 */
export function approvingVerdicts(plan: SwapPlan): Map<string, DestinationVerdict> {
    const verdicts = new Map<string, DestinationVerdict>();
    for (const message of plan.messages) {
        verdicts.set(addressKeyOf(message.to), {
            trusted: true,
            role: message.destinationRole,
            reason: 'derived on-chain from the jetton master (test fixture)',
        });
    }
    return verdicts;
}

/** Local copy of the engine's keying, so fixtures need no import cycle. */
export function addressKeyOf(address: string): string {
    return Address.parse(address).toRawString().toLowerCase();
}

export function verdict(role: DestinationRole, trusted = true, reason = 'test fixture'): DestinationVerdict {
    return { trusted, role, reason };
}

// ────────────────────────────────────────────────────────────────────────────
// Fake chain
// ────────────────────────────────────────────────────────────────────────────

/** A get-method response, keyed by `<addressKey>/<method>`. */
export type GetMethodStub = (args: readonly TupleItem[]) => GetMethodResult;

export interface FakeChainOptions {
    readonly network?: NetworkId;
    readonly balances?: Readonly<Record<string, bigint>>;
    readonly deployed?: readonly string[];
    /** Keyed `<canonical address>/<method name>`. */
    readonly getMethods?: Readonly<Record<string, GetMethodStub>>;
    /** Contracts to hand back from `open`, keyed by constructor name. */
    readonly opened?: Readonly<Record<string, unknown>>;
}

/**
 * A {@link ChainAccess} with no network.
 *
 * Unstubbed reads throw rather than returning a zero value: a silent default is
 * how a test ends up asserting against a fixture instead of against the code.
 */
export class FakeChain implements ChainAccess {
    public readonly network: NetworkId;
    public readonly calls: string[] = [];

    private readonly balances: Map<string, bigint>;
    private readonly deployed: AddressSet;
    private readonly getMethods: Map<string, GetMethodStub>;
    private readonly opened: Map<string, unknown>;

    public constructor(options: FakeChainOptions = {}) {
        this.network = options.network ?? 'mainnet';
        this.balances = new Map(
            Object.entries(options.balances ?? {}).map(([address, value]) => [addressKeyOf(address), value]),
        );
        this.deployed = new AddressSet(options.deployed ?? []);
        this.getMethods = new Map(
            Object.entries(options.getMethods ?? {}).map(([key, stub]) => {
                const slash = key.lastIndexOf('/');
                const address = key.slice(0, slash);
                const method = key.slice(slash + 1);
                return [`${addressKeyOf(address)}/${method}`, stub];
            }),
        );
        this.opened = new Map(Object.entries(options.opened ?? {}));
    }

    public open<T extends Contract>(contract: T): OpenedContract<T> {
        const replacement = this.opened.get(contract.constructor.name);
        this.calls.push(`open:${contract.constructor.name}`);
        if (replacement === undefined) {
            throw new Error(`FakeChain: no stub registered for open(${contract.constructor.name})`);
        }
        return replacement as OpenedContract<T>;
    }

    public async getBalance(address: Address | string): Promise<bigint> {
        const key = addressKeyOf(address.toString());
        this.calls.push(`getBalance:${key}`);
        return this.balances.get(key) ?? 0n;
    }

    public async isDeployed(address: Address | string): Promise<boolean> {
        this.calls.push(`isDeployed:${addressKeyOf(address.toString())}`);
        return this.deployed.has(address);
    }

    public async runGetMethod(
        address: Address | string,
        method: string,
        args: readonly TupleItem[] = [],
    ): Promise<GetMethodResult> {
        const key = `${addressKeyOf(address.toString())}/${method}`;
        this.calls.push(`runGetMethod:${key}`);
        const stub = this.getMethods.get(key);
        if (stub === undefined) {
            throw new Error(`FakeChain: no stub for ${method} on ${address.toString()}`);
        }
        return stub(args);
    }
}

/** A `GetMethodResult` whose stack yields a single address slice. */
export function addressResult(address: string): GetMethodResult {
    return tupleResult([{ type: 'slice', cell: beginCell().storeAddress(Address.parse(address)).endCell() }]);
}

/** A `GetMethodResult` whose stack yields the given integers, in order. */
export function intResult(...values: readonly (number | bigint)[]): GetMethodResult {
    return tupleResult(values.map((value) => ({ type: 'int' as const, value: BigInt(value) })));
}

function tupleResult(items: readonly TupleItem[]): GetMethodResult {
    // `TupleReader` consumes the array it is given, so each call gets a fresh
    // copy — otherwise a stub would read empty the second time a test used it.
    return { gasUsed: 0, stack: new TupleReader([...items]) };
}

/** A cell, for tests that only need "some body". */
export function someCell(): Cell {
    return beginCell().storeUint(1, 8).endCell();
}
