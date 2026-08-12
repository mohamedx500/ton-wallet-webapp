import { DEX, pTON, routerFactory } from '@ston-fi/sdk';
import {
    Address,
    TupleReader,
    beginCell,
    openContract,
} from '@ton/core';
import type {
    Cell,
    Contract,
    ContractGetMethodResult,
    ContractProvider,
    OpenedContract,
    SenderArguments,
    TupleItem,
} from '@ton/core';
import { describe, expect, it } from 'vitest';

import { TON_ASSET } from '../../src/assets/fungible';
import type { FungibleAsset } from '../../src/assets/fungible';
import { addressKey, formatAddress, isSameAddress, parseAddress } from '../../src/core/address';
import type { ChainAccess, GetMethodResult, NetworkId } from '../../src/core/chain';
import { StonfiProvider } from '../../src/swap/providers/stonfi/StonfiProvider';
import { PINNED_ROUTERS } from '../../src/swap/providers/stonfi/routerRegistry';
import type { StonfiRouter } from '../../src/swap/providers/stonfi/routerRegistry';
import type { SwapBuildContext, SwapGasEstimate, SwapQuote } from '../../src/swap/types';
import { applySlippage } from '../../src/core/units';
import { NOT, NOW_MS, USDT, WALLET, testAddress } from './fixtures';

const QUERY_ID = 0x1234_5678_9abc_def0n;
const DEADLINE_SECONDS = 600;
const DEADLINE_UNIX = Math.floor(NOW_MS / 1000) + DEADLINE_SECONDS;
const POOL = testAddress('stonfi-parity-pool');
const RECEIVER = testAddress('stonfi-parity-receiver');
const USER_USDT_WALLET = testAddress('stonfi-parity-user-usdt-wallet');
const USER_NOT_WALLET = testAddress('stonfi-parity-user-not-wallet');
const ROUTER_USDT_WALLET_V1 = testAddress('stonfi-parity-router-usdt-wallet-v1');
const ROUTER_NOT_WALLET_V1 = testAddress('stonfi-parity-router-not-wallet-v1');
const ROUTER_USDT_WALLET_V2 = testAddress('stonfi-parity-router-usdt-wallet-v2');
const ROUTER_NOT_WALLET_V2 = testAddress('stonfi-parity-router-not-wallet-v2');

const V1 = asPinnedRouter(1, 0);
const V2 = asPinnedRouter(2, 2);

type Direction = 'jetton-to-jetton' | 'jetton-to-ton' | 'ton-to-jetton';

interface CaseDefinition {
    readonly name: string;
    readonly router: StonfiRouter;
    readonly direction: Direction;
    readonly from: FungibleAsset;
    readonly to: FungibleAsset;
    readonly offerUnits: bigint;
    readonly expectedOutUnits: bigint;
}

const CASES: readonly CaseDefinition[] = Object.freeze([
    {
        name: 'V1 jetton to jetton',
        router: V1,
        direction: 'jetton-to-jetton',
        from: USDT,
        to: NOT,
        offerUnits: 200_000n,
        expectedOutUnits: 500_000_000n,
    },
    {
        name: 'V1 jetton to TON',
        router: V1,
        direction: 'jetton-to-ton',
        from: USDT,
        to: TON_ASSET,
        offerUnits: 200_000n,
        expectedOutUnits: 1_000_000_000n,
    },
    {
        name: 'V1 TON to jetton',
        router: V1,
        direction: 'ton-to-jetton',
        from: TON_ASSET,
        to: USDT,
        offerUnits: 1_000_000_000n,
        expectedOutUnits: 990_000n,
    },
    {
        name: 'V2.2 jetton to jetton',
        router: V2,
        direction: 'jetton-to-jetton',
        from: USDT,
        to: NOT,
        offerUnits: 200_000n,
        expectedOutUnits: 500_000_000n,
    },
    {
        name: 'V2.2 jetton to TON',
        router: V2,
        direction: 'jetton-to-ton',
        from: USDT,
        to: TON_ASSET,
        offerUnits: 200_000n,
        expectedOutUnits: 1_000_000_000n,
    },
    {
        name: 'V2.2 TON to jetton',
        router: V2,
        direction: 'ton-to-jetton',
        from: TON_ASSET,
        to: USDT,
        offerUnits: 1_000_000_000n,
        expectedOutUnits: 990_000n,
    },
]);

describe('STON.fi official SDK transaction parity', () => {
    for (const definition of CASES) {
        it(`matches the official SDK byte-for-byte for ${definition.name}`, async () => {
            const chain = createParityChain(definition.router);
            const gas = gasFor(definition);
            const quote = quoteFor(definition, gas);
            const provider = new StonfiProvider(chain);
            const context: SwapBuildContext = {
                walletAddress: WALLET,
                ...(definition.router.majorVersion === 1 ? {} : { receiverAddress: RECEIVER }),
                queryId: QUERY_ID,
                nowMs: NOW_MS,
                deadlineSeconds: DEADLINE_SECONDS,
                chain,
            };

            const plan = await provider.buildSwap(quote, context);
            const expected = await buildDirectlyWithOfficialSdk(definition, quote, gas, chain);
            const [message] = plan.messages;

            expect(message).toBeDefined();
            expect(formatAddress(message?.to ?? '')).toBe(formatAddress(expected.to));
            expect(message?.value).toBe(expected.value);
            expect(message?.body.toBoc().toString('hex')).toBe(requireBody(expected).toBoc().toString('hex'));
            expect(message?.bounce).toBe(true);
            expect(plan.reference.queryId).toBe(QUERY_ID);
            expect(plan.reference.deadlineUnix).toBe(definition.router.majorVersion === 1 ? null : DEADLINE_UNIX);

            const decoded = decodeSwapEnvelope(requireBody(expected), definition);
            expect(decoded.queryId).toBe(QUERY_ID);
            expect(decoded.offerUnits).toBe(definition.offerUnits);
            if (decoded.forwardTonAmount !== null) {
                expect(decoded.forwardTonAmount).toBe(gas.forwardValue);
            } else {
                // pTON v2.1 carries the forward budget in the attached value,
                // not as a field in TON_TRANSFER. Exact value parity above and
                // this formula are the only byte-honest assertions available.
                expect(message?.value).toBe(
                    definition.offerUnits + gas.forwardValue + pTON.v2_1.gasConstants.tonTransfer,
                );
            }
            expect(decoded.swapOpcode).toBe(definition.router.majorVersion === 1 ? 0x25938561 : 0x6664de2a);
            expect(decoded.minOutUnits).toBe(quote.minOutUnits);
            expect(decoded.deadlineUnix).toBe(definition.router.majorVersion === 1 ? null : DEADLINE_UNIX);

            if (definition.direction === 'ton-to-jetton') {
                expect(formatAddress(message?.to ?? '')).toBe(definition.router.ptonWalletAddress);
                expect(isSameAddress(message?.to ?? '', definition.router.ptonMasterAddress)).toBe(false);
                expect(decoded.outerOpcode).toBe(definition.router.majorVersion === 1 ? 0x0f8a7ea5 : 0x01f3835d);
            } else {
                expect(decoded.outerOpcode).toBe(0x0f8a7ea5);
            }
        });
    }
});

function quoteFor(definition: CaseDefinition, gas: SwapGasEstimate): SwapQuote {
    const minOutUnits = applySlippage(definition.expectedOutUnits, 100);
    return Object.freeze({
        providerId: 'stonfi',
        from: definition.from,
        to: definition.to,
        offerUnits: definition.offerUnits,
        expectedOutUnits: definition.expectedOutUnits,
        minOutUnits,
        slippageBps: 100,
        recommendedSlippageBps: 100,
        priceImpactBps: 12,
        feeUnits: 0n,
        feeAsset: definition.to,
        gas,
        route: Object.freeze([
            Object.freeze({
                label: `STON.fi v${definition.router.majorVersion}.${definition.router.minorVersion}`,
                contractAddress: POOL,
            }),
        ]),
        createdAtMs: NOW_MS,
        providerData: Object.freeze({
            kind: 'stonfi/quote@1',
            direction: definition.direction,
            router: definition.router,
            poolAddress: POOL,
            gas,
            reportedOfferJettonWallet:
                definition.direction === 'ton-to-jetton'
                    ? definition.router.ptonWalletAddress
                    : userWalletFor(definition.from),
            reportedAskJettonWallet:
                definition.direction === 'jetton-to-ton'
                    ? definition.router.ptonWalletAddress
                    : routerWalletFor(definition.to, definition.router),
        }),
    });
}

function gasFor(definition: CaseDefinition): SwapGasEstimate {
    const contract = officialRouter(definition.router);
    const constants = contract.gasConstants;
    const defaults =
        definition.direction === 'jetton-to-jetton'
            ? constants.swapJettonToJetton
            : definition.direction === 'jetton-to-ton'
              ? constants.swapJettonToTon
              : constants.swapTonToJetton;
    const forwardValue = defaults.forwardGasAmount;
    const messageValue =
        definition.direction === 'ton-to-jetton'
            ? definition.offerUnits +
              forwardValue +
              (definition.router.majorVersion === 1 ? 0n : pTON.v2_1.gasConstants.tonTransfer)
            : definition.direction === 'jetton-to-jetton'
              ? constants.swapJettonToJetton.gasAmount
              : constants.swapJettonToTon.gasAmount;
    return Object.freeze({
        messageValue,
        forwardValue,
        estimatedConsumption: messageValue - (definition.direction === 'ton-to-jetton' ? definition.offerUnits : 0n),
    });
}

async function buildDirectlyWithOfficialSdk(
    definition: CaseDefinition,
    quote: SwapQuote,
    gas: SwapGasEstimate,
    chain: ChainAccess,
): Promise<SenderArguments> {
    const contract = officialRouter(definition.router);
    const router = chain.open(contract);
    const walletAddress = parseAddress(WALLET);
    const receiverAddress = definition.router.majorVersion === 1 ? walletAddress : parseAddress(RECEIVER);
    const offerJettonWalletAddress = parseAddress(
        definition.direction === 'ton-to-jetton'
            ? definition.router.ptonWalletAddress
            : userWalletFor(definition.from),
    );
    const askJettonWalletAddress = parseAddress(
        definition.direction === 'jetton-to-ton'
            ? definition.router.ptonWalletAddress
            : routerWalletFor(definition.to, definition.router),
    );
    const proxyTon =
        definition.router.majorVersion === 1
            ? new pTON.v1(definition.router.ptonMasterAddress)
            : new pTON.v2_1(definition.router.ptonMasterAddress);

    if (contract instanceof DEX.v1.Router) {
        switch (definition.direction) {
            case 'jetton-to-jetton':
                return router.getSwapJettonToJettonTxParams({
                    userWalletAddress: walletAddress,
                    offerJettonAddress: requireJetton(definition.from),
                    offerJettonWalletAddress,
                    askJettonAddress: requireJetton(definition.to),
                    askJettonWalletAddress,
                    offerAmount: quote.offerUnits,
                    minAskAmount: quote.minOutUnits,
                    gasAmount: gas.messageValue,
                    forwardGasAmount: gas.forwardValue,
                    queryId: QUERY_ID,
                });
            case 'jetton-to-ton':
                return router.getSwapJettonToTonTxParams({
                    userWalletAddress: walletAddress,
                    offerJettonAddress: requireJetton(definition.from),
                    offerJettonWalletAddress,
                    proxyTon,
                    askJettonWalletAddress,
                    offerAmount: quote.offerUnits,
                    minAskAmount: quote.minOutUnits,
                    gasAmount: gas.messageValue,
                    forwardGasAmount: gas.forwardValue,
                    queryId: QUERY_ID,
                });
            case 'ton-to-jetton':
                return router.getSwapTonToJettonTxParams({
                    userWalletAddress: walletAddress,
                    proxyTon,
                    offerJettonWalletAddress,
                    askJettonAddress: requireJetton(definition.to),
                    askJettonWalletAddress,
                    offerAmount: quote.offerUnits,
                    minAskAmount: quote.minOutUnits,
                    forwardGasAmount: gas.forwardValue,
                    queryId: QUERY_ID,
                });
        }
    }

    const common = {
        userWalletAddress: walletAddress,
        receiverAddress,
        refundAddress: walletAddress,
        excessesAddress: walletAddress,
        askJettonWalletAddress,
        offerAmount: quote.offerUnits,
        minAskAmount: quote.minOutUnits,
        forwardGasAmount: gas.forwardValue,
        queryId: QUERY_ID,
        deadline: DEADLINE_UNIX,
    };
    switch (definition.direction) {
        case 'jetton-to-jetton':
            return router.getSwapJettonToJettonTxParams({
                ...common,
                offerJettonAddress: requireJetton(definition.from),
                offerJettonWalletAddress,
                askJettonAddress: requireJetton(definition.to),
                gasAmount: gas.messageValue,
            });
        case 'jetton-to-ton':
            return router.getSwapJettonToTonTxParams({
                ...common,
                offerJettonAddress: requireJetton(definition.from),
                offerJettonWalletAddress,
                proxyTon,
                gasAmount: gas.messageValue,
            });
        case 'ton-to-jetton':
            return router.getSwapTonToJettonTxParams({
                ...common,
                proxyTon,
                offerJettonWalletAddress,
                askJettonAddress: requireJetton(definition.to),
            });
    }
}

function decodeSwapEnvelope(
    body: Cell,
    definition: CaseDefinition,
): {
    readonly outerOpcode: number;
    readonly queryId: bigint;
    readonly offerUnits: bigint;
    readonly forwardTonAmount: bigint | null;
    readonly swapOpcode: number;
    readonly minOutUnits: bigint;
    readonly deadlineUnix: number | null;
} {
    const outer = body.beginParse();
    const outerOpcode = outer.loadUint(32);
    const queryId = outer.loadUintBig(64);
    const offerUnits = outer.loadCoins();

    let forwardTonAmount: bigint | null;
    let swapPayload: Cell;
    if (definition.direction === 'ton-to-jetton' && definition.router.majorVersion !== 1) {
        outer.loadAddress();
        expect(outer.loadBit()).toBe(true);
        swapPayload = outer.loadRef();
        forwardTonAmount = null;
    } else {
        outer.loadAddress();
        outer.loadMaybeAddress();
        expect(outer.loadBit()).toBe(false);
        forwardTonAmount = outer.loadCoins();
        expect(outer.loadBit()).toBe(true);
        swapPayload = outer.loadRef();
    }

    const swap = swapPayload.beginParse();
    const swapOpcode = swap.loadUint(32);
    swap.loadAddress();
    if (definition.router.majorVersion === 1) {
        const minOutUnits = swap.loadCoins();
        return {
            outerOpcode,
            queryId,
            offerUnits,
            forwardTonAmount,
            swapOpcode,
            minOutUnits,
            deadlineUnix: null,
        };
    }

    swap.loadAddress();
    swap.loadAddress();
    const deadlineUnix = Number(swap.loadUintBig(64));
    const additional = swap.loadRef().beginParse();
    const minOutUnits = additional.loadCoins();
    return {
        outerOpcode,
        queryId,
        offerUnits,
        forwardTonAmount,
        swapOpcode,
        minOutUnits,
        deadlineUnix,
    };
}

function createParityChain(router: StonfiRouter): ChainAccess {
    const walletAddresses = new Map<string, string>();
    walletAddresses.set(walletKey(USDT.master, WALLET), USER_USDT_WALLET);
    walletAddresses.set(walletKey(NOT.master, WALLET), USER_NOT_WALLET);
    walletAddresses.set(walletKey(USDT.master, router.address), router.majorVersion === 1 ? ROUTER_USDT_WALLET_V1 : ROUTER_USDT_WALLET_V2);
    walletAddresses.set(walletKey(NOT.master, router.address), router.majorVersion === 1 ? ROUTER_NOT_WALLET_V1 : ROUTER_NOT_WALLET_V2);
    walletAddresses.set(walletKey(router.ptonMasterAddress, router.address), router.ptonWalletAddress);
    return new ParityChain(walletAddresses);
}

class ParityChain implements ChainAccess {
    public readonly network: NetworkId = 'mainnet';
    private readonly walletAddresses: ReadonlyMap<string, string>;

    public constructor(walletAddresses: ReadonlyMap<string, string>) {
        this.walletAddresses = walletAddresses;
    }

    public open<T extends Contract>(contract: T): OpenedContract<T> {
        return openContract(contract, () => dummyProvider());
    }

    public getBalance(): Promise<bigint> {
        return Promise.resolve(0n);
    }

    public isDeployed(): Promise<boolean> {
        return Promise.resolve(true);
    }

    public runGetMethod(address: Address | string, method: string, args: readonly TupleItem[] = []): Promise<GetMethodResult> {
        if (method !== 'get_wallet_address') {
            return Promise.reject(new Error(`Unexpected get method: ${method}`));
        }
        const [ownerArgument] = args;
        if (ownerArgument?.type !== 'slice') {
            return Promise.reject(new Error('Expected owner slice for get_wallet_address.'));
        }
        const owner = ownerArgument.cell.beginParse().loadAddress();
        const wallet = this.walletAddresses.get(walletKey(address.toString(), owner.toString()));
        if (wallet === undefined) {
            return Promise.reject(new Error(`No wallet fixture for ${address.toString()} / ${owner.toString()}`));
        }
        return Promise.resolve({
            gasUsed: 0,
            stack: new TupleReader([
                { type: 'slice', cell: addressCell(wallet) },
            ]),
        });
    }
}

function dummyProvider(): ContractProvider {
    const unsupported = (): never => {
        throw new Error('The parity fixture supplied every derived address; RPC must not be used by the SDK builder.');
    };
    const provider: ContractProvider = {
        getState: async () => unsupported(),
        get: async (): Promise<ContractGetMethodResult> => unsupported(),
        external: async () => unsupported(),
        internal: async () => unsupported(),
        open: <T extends Contract>(contract: T): OpenedContract<T> => openContract(contract, () => provider),
        getTransactions: async () => unsupported(),
    };
    return provider;
}

function addressCell(address: string): Cell {
    return beginCell().storeAddress(parseAddress(address)).endCell();
}

function officialRouter(router: StonfiRouter): ReturnType<typeof routerFactory> {
    return routerFactory({
        address: router.address,
        majorVersion: router.majorVersion,
        minorVersion: router.minorVersion,
        routerType: router.routerType,
    });
}

function asPinnedRouter(majorVersion: number, minorVersion: number): StonfiRouter {
    const router = PINNED_ROUTERS.find(
        (candidate) => candidate.majorVersion === majorVersion && candidate.minorVersion === minorVersion,
    );
    if (router === undefined) {
        throw new Error(`Missing pinned STON.fi v${majorVersion}.${minorVersion} fixture.`);
    }
    return Object.freeze({ ...router, trustSource: 'pinned' });
}

function userWalletFor(asset: FungibleAsset): string {
    if (asset.kind !== 'jetton') {
        throw new Error('Expected a jetton offer.');
    }
    return isSameAddress(asset.master, USDT.master) ? USER_USDT_WALLET : USER_NOT_WALLET;
}

function routerWalletFor(asset: FungibleAsset, router: StonfiRouter): string {
    if (asset.kind !== 'jetton') {
        return router.ptonWalletAddress;
    }
    if (isSameAddress(asset.master, USDT.master)) {
        return router.majorVersion === 1 ? ROUTER_USDT_WALLET_V1 : ROUTER_USDT_WALLET_V2;
    }
    return router.majorVersion === 1 ? ROUTER_NOT_WALLET_V1 : ROUTER_NOT_WALLET_V2;
}

function requireJetton(asset: FungibleAsset): Address {
    if (asset.kind !== 'jetton') {
        throw new Error('Expected jetton asset.');
    }
    return parseAddress(asset.master);
}

function requireBody(arguments_: SenderArguments): Cell {
    if (arguments_.body === null || arguments_.body === undefined || typeof arguments_.body === 'string') {
        throw new Error('The official STON.fi swap builder returned no cell body.');
    }
    return arguments_.body;
}

function walletKey(master: string, owner: string): string {
    return `${addressKey(master)}/${addressKey(owner)}`;
}
