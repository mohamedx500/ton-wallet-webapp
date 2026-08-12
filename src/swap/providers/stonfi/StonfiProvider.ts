/**
 * STON.fi DEX provider
 * ============================================================================
 *
 * The wallet's first production {@link DexProvider}. This is the **only**
 * directory in the codebase permitted to import `@ston-fi/*`; everything above
 * it works through `src/swap/types.ts`.
 *
 * WHAT THIS REPLACES, AND WHY
 * ---------------------------
 * The audited builder hand-assembled router payloads. It got four things wrong,
 * any one of which was sufficient to lose or bounce a trade (see
 * `docs/audit.md`):
 *
 *  A1  the V2 `tx_deadline` field was hardcoded to `0`, so every V2 swap was
 *      already expired when it arrived and the router refunded it — this is the
 *      reported "sent 0.2 USDT, got 0.2 USDT back";
 *  A2  the V1 swap opcode was emitted even when routing through a V2.2 router;
 *  A3  the proxy-TON body had nine fields where the schema has five, and was
 *      addressed to the pTON *master* rather than the router's pTON *wallet*;
 *  A4  `bounce: false`, which turns a recoverable rejection into permanent loss.
 *
 * No payload is assembled here. Every body and every gas figure comes from the
 * official `@ston-fi/sdk` contract classes, selected for the exact router
 * version the route resolves to. The deadline is supplied on every V2 call,
 * `bounce` is `true` on every message, and the destination the SDK produces is
 * checked against one this wallet derived itself.
 *
 * THE TRUST MODEL
 * ---------------
 * The API is a *price oracle only*. Nothing it returns is used as a destination:
 *
 *  - the router comes from {@link StonfiRouterRegistry} (a pinned allow-list, or
 *    the published registry plus an on-chain identity check);
 *  - the user's jetton wallet is derived by calling `get_wallet_address` on the
 *    jetton master the *user* selected;
 *  - the router's pTON wallet is derived by calling `get_wallet_address` on a
 *    pinned pTON master;
 *  - the SDK's own output is then checked against those derivations, and a
 *    mismatch aborts the build.
 *
 * The simulation's reported jetton-wallet fields are kept for display and
 * cross-checking, and are never sent to.
 *
 * @see docs/swap.md
 * @see https://docs.ston.fi/docs/developer-section/api-reference-v1
 */

import { DEX, pTON, routerFactory } from '@ston-fi/sdk';
import type { Address, SenderArguments } from '@ton/core';

import { TON_ASSET, assetLabel, createJettonAsset, isJettonAsset } from '../../../assets/fungible';
import type { FungibleAsset } from '../../../assets/fungible';
import { AddressSet, addressKey, formatAddress, isSameAddress, parseAddress } from '../../../core/address';
import type { ChainAccess } from '../../../core/chain';
import { getJettonWalletAddress } from '../../../core/jetton';
import { formatUnits, maxBigInt, minBigInt } from '../../../core/units';
import {
    InvalidSwapRequestError,
    MalformedTransactionError,
    NoRouteError,
    ProviderProtocolError,
    SwapError,
    SwapErrorCode,
    toSwapError,
} from '../../errors';
import type {
    DestinationCheck,
    DestinationVerdict,
    DexCapabilities,
    DexProvider,
    OutgoingMessage,
    QuoteRequest,
    SwapBuildContext,
    SwapGasEstimate,
    SwapOutcome,
    SwapPlan,
    SwapQuote,
    SwapReference,
    SwapRouteHop,
} from '../../types';
import { resolveMinOut } from '../../validation';

import { STONFI_NATIVE_ADDRESS, StonfiClient } from './client';
import type { StonfiAsset, StonfiSimulation, StonfiSwapStatus } from './client';
import { StonfiRouterRegistry } from './routerRegistry';
import type { StonfiRouter } from './routerRegistry';

/** Stable provider id. Persisted in transaction history — never change it. */
export const STONFI_PROVIDER_ID = 'stonfi';

const CAPABILITIES: DexCapabilities = Object.freeze({
    assetDiscovery: true,
    simulation: true,
    // True for V2 routers. V1 has no `tx_deadline` field at all, and routes
    // through it report `deadlineUnix: null` so the engine can warn.
    onChainDeadline: true,
    statusTracking: true,
    referrals: true,
    exactMinOut: true,
});

/**
 * Hard ceilings on the TON a swap may attach, in nanotons.
 *
 * The API suggests gas figures and this wallet will raise the SDK's defaults to
 * meet them — a stableswap pool genuinely costs more to traverse than a
 * constant-product one. It will not raise them without bound: a compromised
 * endpoint returning `forwardGas = "100000000000"` would otherwise move 100 TON
 * per swap into contracts that keep the excess.
 */
const MAX_FORWARD_GAS = 500_000_000n; // 0.5 TON
const MAX_SWAP_GAS = 1_000_000_000n; // 1 TON, excluding any offered TON amount

/** Tag expression for the token picker. The unfiltered list is ~30k entries. */
const DEFAULT_ASSET_CONDITION = 'asset:essential | asset:popular';

/** Asset tags that mean "do not let the user trade this". */
const BLACKLIST_TAGS: ReadonlySet<string> = new Set([
    'asset:blacklisted',
    'asset:honeypot',
    'asset:fake',
    'asset:suspicious',
    'asset:dmca_complaint',
]);

/** Which of the three SDK swap entry points a route needs. */
type StonfiDirection = 'jetton-to-jetton' | 'jetton-to-ton' | 'ton-to-jetton';

/** Discriminator for {@link StonfiQuoteData}. Bumped if the shape changes. */
const STONFI_QUOTE_KIND = 'stonfi/quote@1';

/**
 * The private state a STON.fi quote carries into `buildSwap`.
 *
 * Reachable only through `decodeStonfiQuoteData`, which is what makes
 * `SwapQuote.providerData: unknown` safe: a quote issued by another provider, or
 * one deserialised from storage after a format change, is rejected rather than
 * misread.
 */
interface StonfiQuoteData {
    readonly kind: typeof STONFI_QUOTE_KIND;
    readonly direction: StonfiDirection;
    /** The registry's router entry — not the simulation's. */
    readonly router: StonfiRouter;
    readonly poolAddress: string;
    /** Gas resolved at quote time; `buildSwap` must reproduce it exactly. */
    readonly gas: SwapGasEstimate;
    /** Recorded for the confirmation screen and for cross-checks only. */
    readonly reportedOfferJettonWallet: string;
    readonly reportedAskJettonWallet: string;
}

const QUOTE_DATA_FIELDS = Object.freeze([
    'kind',
    'direction',
    'router',
    'poolAddress',
    'gas',
    'reportedOfferJettonWallet',
    'reportedAskJettonWallet',
] as const);

const ROUTER_FIELDS = Object.freeze([
    'address',
    'majorVersion',
    'minorVersion',
    'ptonMasterAddress',
    'ptonWalletAddress',
    'ptonVersion',
    'routerType',
    'poolCreationEnabled',
    'trustSource',
] as const);

const GAS_FIELDS = Object.freeze(['messageValue', 'forwardValue', 'estimatedConsumption'] as const);

const SUPPORTED_ROUTER_TYPES: ReadonlySet<string> = new Set([
    'ConstantProduct',
    'StableSwap',
    'WeightedConstProduct',
    'WeightedStableSwap',
]);

/**
 * Decode provider-private quote state from `unknown`.
 *
 * This is intentionally stricter than a TypeScript type predicate. Quotes can be
 * restored from browser storage or cross a worker boundary, so every field is
 * treated as attacker-controlled runtime data. Unknown fields are rejected as a
 * schema-version mismatch instead of silently accepted.
 */
function decodeStonfiQuoteData(value: unknown): StonfiQuoteData | null {
    if (!isExactRecord(value, QUOTE_DATA_FIELDS) || value['kind'] !== STONFI_QUOTE_KIND) {
        return null;
    }

    const direction = value['direction'];
    if (
        direction !== 'jetton-to-jetton' &&
        direction !== 'jetton-to-ton' &&
        direction !== 'ton-to-jetton'
    ) {
        return null;
    }

    const router = decodeQuoteRouter(value['router']);
    const gas = decodeQuoteGas(value['gas']);
    const poolAddress = decodeAddress(value['poolAddress']);
    const reportedOfferJettonWallet = decodeAddress(value['reportedOfferJettonWallet']);
    const reportedAskJettonWallet = decodeAddress(value['reportedAskJettonWallet']);
    if (
        router === null ||
        gas === null ||
        poolAddress === null ||
        reportedOfferJettonWallet === null ||
        reportedAskJettonWallet === null
    ) {
        return null;
    }

    return Object.freeze({
        kind: STONFI_QUOTE_KIND,
        direction,
        router,
        poolAddress,
        gas,
        reportedOfferJettonWallet,
        reportedAskJettonWallet,
    });
}

function decodeQuoteRouter(value: unknown): StonfiRouter | null {
    if (!isExactRecord(value, ROUTER_FIELDS)) {
        return null;
    }

    const address = decodeAddress(value['address']);
    const ptonMasterAddress = decodeAddress(value['ptonMasterAddress']);
    const ptonWalletAddress = decodeAddress(value['ptonWalletAddress']);
    const majorVersion = decodeNonNegativeInteger(value['majorVersion']);
    const minorVersion = decodeNonNegativeInteger(value['minorVersion']);
    const ptonVersion = value['ptonVersion'];
    const routerType = value['routerType'];
    const poolCreationEnabled = value['poolCreationEnabled'];
    const trustSource = value['trustSource'];

    if (
        address === null ||
        ptonMasterAddress === null ||
        ptonWalletAddress === null ||
        majorVersion === null ||
        minorVersion === null ||
        typeof ptonVersion !== 'string' ||
        !SUPPORTED_ROUTER_TYPES.has(typeof routerType === 'string' ? routerType : '') ||
        typeof poolCreationEnabled !== 'boolean' ||
        (trustSource !== 'pinned' && trustSource !== 'registry') ||
        !isSupportedRouterCombination(majorVersion, minorVersion, ptonVersion, routerType as string)
    ) {
        return null;
    }

    return Object.freeze({
        address,
        majorVersion,
        minorVersion,
        ptonMasterAddress,
        ptonWalletAddress,
        ptonVersion,
        routerType: routerType as string,
        poolCreationEnabled,
        trustSource,
    });
}

function decodeQuoteGas(value: unknown): SwapGasEstimate | null {
    if (!isExactRecord(value, GAS_FIELDS)) {
        return null;
    }
    const messageValue = value['messageValue'];
    const forwardValue = value['forwardValue'];
    const estimatedConsumption = value['estimatedConsumption'];
    if (
        typeof messageValue !== 'bigint' ||
        typeof forwardValue !== 'bigint' ||
        typeof estimatedConsumption !== 'bigint' ||
        messageValue <= 0n ||
        forwardValue <= 0n ||
        forwardValue >= messageValue ||
        estimatedConsumption < 0n ||
        estimatedConsumption > messageValue
    ) {
        return null;
    }
    return Object.freeze({ messageValue, forwardValue, estimatedConsumption });
}

function isExactRecord<const T extends readonly string[]>(value: unknown, fields: T): value is Record<T[number], unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }
    const keys = Reflect.ownKeys(value);
    return (
        keys.length === fields.length &&
        keys.every((key) => typeof key === 'string' && fields.some((field) => field === key))
    );
}

function decodeAddress(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }
    try {
        return formatAddress(value);
    } catch {
        return null;
    }
}

function decodeNonNegativeInteger(value: unknown): number | null {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function isSupportedRouterCombination(
    majorVersion: number,
    minorVersion: number,
    ptonVersion: string,
    routerType: string,
): boolean {
    if (majorVersion === 1 && minorVersion === 0) {
        return (ptonVersion === '1.0' || ptonVersion === 'v1') && routerType === 'ConstantProduct';
    }
    if (majorVersion === 2 && (minorVersion === 1 || minorVersion === 2)) {
        return ptonVersion === '2.1' || ptonVersion === 'v2_1';
    }
    return false;
}

/** Optional tuning for {@link createStonfiProvider}. */
export interface StonfiProviderOptions {
    /** Override the API base URL (staging, or a self-hosted mirror). */
    readonly apiBaseUrl?: string;
    /** Tag expression used to populate the token picker. */
    readonly assetCondition?: string;
    /** Referral address recorded in the swap payload. */
    readonly referralAddress?: string;
    /**
     * Pre-built API client.
     *
     * The seam that makes the transaction builder testable offline: with a fake
     * client the whole quote → build → verify path runs without a network, so the
     * payload assertions in `tests/swap/stonfi.provider.test.ts` test this
     * wallet's code rather than STON.fi's uptime. Unused in production.
     */
    readonly client?: StonfiClient;
}

/**
 * STON.fi implementation of {@link DexProvider}.
 *
 * Stateless per swap. The only retained state is the router registry cache,
 * which holds immutable contract metadata.
 */
export class StonfiProvider implements DexProvider {
    public readonly id = STONFI_PROVIDER_ID;
    public readonly displayName = 'STON.fi';
    public readonly website = 'https://ston.fi';
    public readonly capabilities = CAPABILITIES;

    private readonly chain: ChainAccess;
    private readonly client: StonfiClient;
    private readonly registry: StonfiRouterRegistry;
    private readonly assetCondition: string;
    private readonly referralAddress: string | null;

    public constructor(chain: ChainAccess, options: StonfiProviderOptions = {}) {
        this.chain = chain;
        this.client =
            options.client ??
            new StonfiClient(options.apiBaseUrl === undefined ? {} : { baseUrl: options.apiBaseUrl });
        this.registry = new StonfiRouterRegistry(this.client.raw);
        this.assetCondition = options.assetCondition ?? DEFAULT_ASSET_CONDITION;
        this.referralAddress =
            options.referralAddress === undefined ? null : formatAddress(options.referralAddress);
    }

    // ────────────────────────────────────────────────────────────────────────
    // Assets
    // ────────────────────────────────────────────────────────────────────────

    /**
     * Tradable assets for the token picker.
     *
     * Metadata here is remote and attacker-influenced — anyone can mint a jetton
     * called `USDT`. Text is sanitised by `createJettonAsset` and the trust level
     * is derived from STON.fi's own tags, so the UI can mark anything that is not
     * on the curated list.
     */
    public async listAssets(): Promise<readonly FungibleAsset[]> {
        if (this.chain.network !== 'mainnet') {
            return [TON_ASSET];
        }

        let raw: readonly StonfiAsset[];
        try {
            raw = await this.client.queryAssets({ condition: this.assetCondition });
        } catch (cause) {
            throw toSwapError(cause, this.id, 'Could not load the STON.fi token list.');
        }

        const assets: FungibleAsset[] = [TON_ASSET];
        const seen = new Set<string>([addressKey(STONFI_NATIVE_ADDRESS)]);

        for (const entry of raw) {
            // `Ton` is this wallet's own native asset, already added above with
            // trusted metadata — note the API reports its symbol as the historical
            // "GRAM", which is exactly the mislabelling the old token registry
            // inherited. `Wton` and `NotAnAsset` are not user-tradable here.
            if (entry.kind !== 'Jetton' || entry.decimals === null || entry.symbol === null) {
                continue;
            }
            const key = addressKey(entry.contractAddress);
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);

            assets.push(
                createJettonAsset({
                    master: entry.contractAddress,
                    symbol: entry.symbol,
                    name: entry.displayName ?? entry.symbol,
                    decimals: entry.decimals,
                    ...(entry.imageUrl === null ? {} : { imageUrl: entry.imageUrl }),
                    trust: trustFromTags(entry.tags),
                }),
            );
        }
        return assets;
    }

    /**
     * Permissive pre-check. STON.fi lists tens of thousands of pairs, and pulling
     * the pair matrix to answer this would cost more than simply asking for a
     * quote — which reports `NoRoute` precisely.
     */
    public supportsPair(from: FungibleAsset, to: FungibleAsset): Promise<boolean> {
        if (this.chain.network !== 'mainnet') {
            return Promise.resolve(false);
        }
        const tradable = (asset: FungibleAsset): boolean =>
            asset.trust !== 'blacklisted' && (asset.kind === 'native' || asset.master.length > 0);
        return Promise.resolve(tradable(from) && tradable(to));
    }

    // ────────────────────────────────────────────────────────────────────────
    // Quoting
    // ────────────────────────────────────────────────────────────────────────

    public async quote(request: QuoteRequest): Promise<SwapQuote> {
        if (this.chain.network !== 'mainnet') {
            throw new NoRouteError(request.from.symbol, request.to.symbol);
        }

        const offerAddress = this.wireAddress(request.from);
        const askAddress = this.wireAddress(request.to);

        let simulation: StonfiSimulation;
        try {
            simulation = await this.client.simulate({
                offerAddress,
                askAddress,
                offerUnits: request.offerUnits,
                slippageBps: request.slippageBps,
            });
        } catch (cause) {
            throw this.asQuoteError(cause, request);
        }

        // The simulation must describe the trade that was asked for. A response
        // about a different pair or a different size means either an API fault or
        // a substitution in flight; in both cases the price is meaningless and the
        // min-out derived from it would protect nobody.
        if (
            !isSameAddress(simulation.offerAddress, offerAddress) ||
            !isSameAddress(simulation.askAddress, askAddress)
        ) {
            throw new ProviderProtocolError(
                this.id,
                'The price simulation came back for a different pair than the one requested.',
            );
        }
        if (simulation.offerUnits !== request.offerUnits) {
            throw new ProviderProtocolError(
                this.id,
                'The price simulation came back for a different amount than the one requested.',
            );
        }

        const router = await this.resolveRouter(simulation.routerAddress, request.nowMs);
        this.assertSimulationRouterCoherent(simulation, router);
        const direction = resolveDirection(request.from, request.to);

        // pTON holds the user's TON for the duration of a TON-side swap.
        // Substituting it is the most direct way to steal that leg, so it must be
        // one of the pinned production contracts — not merely whatever the route
        // claims.
        if (direction !== 'jetton-to-jetton' && !this.registry.isPinnedPtonMaster(router.ptonMasterAddress)) {
            throw new SwapError(
                SwapErrorCode.UntrustedDestination,
                `Refusing to route TON through ${router.ptonMasterAddress}: it is not a recognised STON.fi proxy-TON contract.`,
                {
                    severity: 'suspicious',
                    providerId: this.id,
                    details: { ptonMaster: router.ptonMasterAddress, router: router.address },
                },
            );
        }

        const gas = this.planGas(router, direction, request.offerUnits, simulation);
        const minOutUnits = resolveMinOut(simulation.askUnits, request.slippageBps, simulation.minAskUnits);

        const route: readonly SwapRouteHop[] = [
            {
                label: `STON.fi v${router.majorVersion}.${router.minorVersion} · ${describePool(router.routerType)}`,
                contractAddress: simulation.poolAddress,
            },
        ];

        const providerData: StonfiQuoteData = {
            kind: STONFI_QUOTE_KIND,
            direction,
            router,
            poolAddress: simulation.poolAddress,
            gas,
            reportedOfferJettonWallet: simulation.reportedOfferJettonWallet,
            reportedAskJettonWallet: simulation.reportedAskJettonWallet,
        };

        return {
            providerId: this.id,
            from: request.from,
            to: request.to,
            offerUnits: request.offerUnits,
            expectedOutUnits: simulation.askUnits,
            minOutUnits,
            slippageBps: request.slippageBps,
            recommendedSlippageBps: simulation.recommendedSlippageBps,
            priceImpactBps: simulation.priceImpactBps,
            ...resolveFee(simulation, request.from, request.to),
            gas,
            route,
            createdAtMs: request.nowMs,
            providerData,
        };
    }

    // ────────────────────────────────────────────────────────────────────────
    // Building
    // ────────────────────────────────────────────────────────────────────────

    public async buildSwap(quote: SwapQuote, context: SwapBuildContext): Promise<SwapPlan> {
        if (quote.providerId !== this.id) {
            throw new InvalidSwapRequestError('This quote was not issued by STON.fi.', {
                quoteProvider: quote.providerId,
            });
        }
        const data = decodeStonfiQuoteData(quote.providerData);
        if (data === null) {
            throw new InvalidSwapRequestError(
                'This quote is missing or has malformed routing information. Refresh the price.',
            );
        }
        this.assertQuoteDataCoherent(quote, data);

        // Re-resolve through the registry rather than trusting the router recorded
        // on the quote. The quote is an in-process object, but it may have been
        // held across a reload, and re-checking costs one cached lookup.
        const router = await this.resolveRouter(data.router.address, context.nowMs);
        this.assertStoredRouterCoherent(data.router, router);
        const walletAddress = parseAddress(context.walletAddress);
        const receiverAddress =
            context.receiverAddress === undefined ? walletAddress : parseAddress(context.receiverAddress);

        const deadlineUnix = Math.floor(context.nowMs / 1000) + context.deadlineSeconds;
        const contract = this.routerContract(router);
        const isV1 = contract instanceof DEX.v1.Router;

        if (isV1 && !isSameAddress(receiverAddress, walletAddress)) {
            // The V1 swap body has a single address field serving as both receiver
            // and refund target, so a distinct receiver cannot be expressed.
            // Silently paying the signer instead is worse than declining the route.
            throw new InvalidSwapRequestError(
                'This route runs through the STON.fi v1 router, which cannot deliver the swap to a different address.',
                { router: router.address },
            );
        }

        const addresses = await this.resolveBuildAddresses(quote, data, router, walletAddress, context.chain);
        const txParams = await this.callSdk({
            contract,
            direction: data.direction,
            router,
            quote,
            gas: data.gas,
            walletAddress,
            receiverAddress,
            askJettonWalletAddress: addresses.askJettonWallet,
            offerJettonWalletAddress: addresses.destination,
            queryId: context.queryId,
            deadlineUnix,
            chain: context.chain,
        });

        // ── The checks that make the SDK's output trustworthy ─────────────────
        //
        // Everything above derived the destination independently. Here the two are
        // compared: if the SDK — or a future version of it, or a tampered
        // dependency — would send anywhere other than the address this wallet
        // computed from the user's own inputs, the build aborts.
        if (!isSameAddress(txParams.to, addresses.destination)) {
            throw new MalformedTransactionError(
                'the swap would be sent to a different contract than the one derived from your token selection',
                { built: txParams.to.toString(), expected: addresses.destination.toString() },
            );
        }
        // `assertGasCoherent` requires the message values to sum to exactly
        // `quote.gas.messageValue`, so a drift here is caught before the user is
        // shown a figure the transaction would not honour.
        if (txParams.value !== data.gas.messageValue) {
            throw new MalformedTransactionError(
                'the TON attached to the swap does not match the amount quoted for it',
                { built: txParams.value.toString(), quoted: data.gas.messageValue.toString() },
            );
        }
        // `null` as well as `undefined`: `SenderArguments.body` is optional *and*
        // nullable, and a bodiless message to a jetton wallet is a plain TON
        // transfer — it would move the gas and swap nothing.
        const body = txParams.body;
        if (body === undefined || body === null) {
            throw new MalformedTransactionError('the swap transaction has no payload');
        }

        const destination = formatAddress(addresses.destination);
        const message: OutgoingMessage = {
            to: destination,
            value: txParams.value,
            body,
            // Always. A failed swap must return the funds — see docs/audit.md (A4).
            bounce: true,
            purpose: describeMessage(quote, data.direction, router),
            destinationRole: data.direction === 'ton-to-jetton' ? 'proxy-ton-wallet' : 'own-jetton-wallet',
        };

        const reference: SwapReference = {
            providerId: this.id,
            routerAddress: router.address,
            ownerAddress: formatAddress(walletAddress),
            queryId: context.queryId,
            deadlineUnix: isV1 ? null : deadlineUnix,
        };

        return {
            providerId: this.id,
            quote,
            messages: [message],
            reference,
            trustedDestinations: new AddressSet([destination]),
            // Deliberately shorter than the on-chain deadline: the client-side
            // window stops a *user* signing something stale, while the on-chain
            // deadline is the backstop for a message delayed in flight.
            expiresAtMs: context.nowMs + Math.min(context.deadlineSeconds * 1000, 120_000),
        };
    }

    // ────────────────────────────────────────────────────────────────────────
    // Destination verification
    // ────────────────────────────────────────────────────────────────────────

    /**
     * Independent verdict on a destination.
     *
     * "Independent" is the whole point: each branch recomputes the address it
     * expects from something the *user* chose (the jetton master they picked) or
     * something compiled into this build (a pinned pTON master), never from the
     * plan being checked.
     *
     * Failures are returned as an untrusted verdict rather than thrown, so a
     * network hiccup during verification reads as "could not verify" — which the
     * engine treats as a refusal — instead of escaping as an unrelated error.
     */
    public async verifyDestination(check: DestinationCheck): Promise<DestinationVerdict> {
        try {
            return await this.verifyDestinationInner(check);
        } catch (cause) {
            return {
                trusted: false,
                role: 'unknown',
                reason: cause instanceof SwapError ? cause.message : 'the contract could not be verified on chain',
            };
        }
    }

    private async verifyDestinationInner(check: DestinationCheck): Promise<DestinationVerdict> {
        const { quote, chain, nowMs } = check;
        const data = decodeStonfiQuoteData(quote.providerData);
        if (data === null) {
            return {
                trusted: false,
                role: 'unknown',
                reason: 'the quote carries malformed STON.fi routing information',
            };
        }
        this.assertQuoteDataCoherent(quote, data);

        switch (check.expectedRole) {
            case 'own-jetton-wallet': {
                if (!isJettonAsset(quote.from)) {
                    return {
                        trusted: false,
                        role: 'unknown',
                        reason: 'a jetton wallet was expected but the swap offers native TON',
                    };
                }
                const derived = await getJettonWalletAddress(
                    chain,
                    parseAddress(quote.from.master),
                    parseAddress(check.walletAddress),
                );
                if (!isSameAddress(derived, check.address)) {
                    return {
                        trusted: false,
                        role: 'unknown',
                        reason: `it is not the ${assetLabel(quote.from)} wallet that ${quote.from.master} reports for your address`,
                    };
                }
                return {
                    trusted: true,
                    role: 'own-jetton-wallet',
                    reason: `derived on chain from the ${assetLabel(quote.from)} master you selected`,
                };
            }

            case 'proxy-ton-wallet': {
                const router = await this.resolveRouter(data.router.address, nowMs);
                this.assertStoredRouterCoherent(data.router, router);
                if (!this.registry.isPinnedPtonMaster(router.ptonMasterAddress)) {
                    return {
                        trusted: false,
                        role: 'unknown',
                        reason: 'the proxy-TON contract for this route is not one this wallet recognises',
                    };
                }
                const derived = await getJettonWalletAddress(
                    chain,
                    parseAddress(router.ptonMasterAddress),
                    parseAddress(router.address),
                );
                if (!isSameAddress(derived, router.ptonWalletAddress)) {
                    return {
                        trusted: false,
                        role: 'unknown',
                        reason: "the router registry's proxy-TON wallet does not match the wallet derived on chain",
                    };
                }
                if (!isSameAddress(derived, check.address)) {
                    return {
                        trusted: false,
                        role: 'unknown',
                        reason: 'it is not the proxy-TON wallet that this router owns',
                    };
                }
                if (!(await chain.isDeployed(derived))) {
                    // A bounceable message to an uninitialised account is rejected
                    // outright, and this wallet will not send a non-bounceable one
                    // carrying value.
                    return {
                        trusted: false,
                        role: 'unknown',
                        reason: "the router's proxy-TON wallet is not deployed, so a swap sent to it could not be refunded",
                    };
                }
                return {
                    trusted: true,
                    role: 'proxy-ton-wallet',
                    reason: `derived on chain from the pinned proxy-TON master ${router.ptonMasterAddress}`,
                };
            }

            case 'dex-router': {
                const router = await this.registry.resolve(check.address, nowMs);
                if (router === null) {
                    return { trusted: false, role: 'unknown', reason: 'it is not a listed STON.fi router' };
                }
                await this.registry.verifyRouterOnChain(router, chain);
                return {
                    trusted: true,
                    role: 'dex-router',
                    reason:
                        router.trustSource === 'pinned'
                            ? "listed in this wallet's pinned STON.fi router set"
                            : 'listed in the STON.fi router registry and confirmed on chain',
                };
            }

            default:
                return {
                    trusted: false,
                    role: 'unknown',
                    reason: `STON.fi swaps never send to a ${check.expectedRole} contract`,
                };
        }
    }

    // ────────────────────────────────────────────────────────────────────────
    // Confirmation
    // ────────────────────────────────────────────────────────────────────────

    /**
     * Resolve what became of a submitted swap.
     *
     * Correlated by `query_id`, which is why the engine generates a unique one per
     * swap. The audited implementation sent `0` every time, so this lookup could
     * not distinguish one trade from another and confirmation was impossible.
     */
    public async getOutcome(reference: SwapReference): Promise<SwapOutcome> {
        let status: StonfiSwapStatus;
        try {
            status = await this.client.getSwapStatus({
                routerAddress: reference.routerAddress,
                ownerAddress: reference.ownerAddress,
                queryId: reference.queryId,
            });
        } catch (cause) {
            throw toSwapError(cause, this.id, 'Could not check the status of this swap.');
        }

        if (!status.found) {
            return Object.freeze({
                state: 'pending',
                exitCode: null,
                txHash: null,
                receivedUnits: null,
                explorerUrl: this.explorerUrl(reference),
            });
        }

        if (
            !isSameAddress(status.walletAddress, reference.ownerAddress) ||
            status.queryId !== reference.queryId.toString()
        ) {
            throw new ProviderProtocolError(
                this.id,
                'The swap status response does not match the wallet and query identifier that were requested.',
            );
        }

        return Object.freeze({
            state: classifyExitCode(status.exitCode),
            exitCode: status.exitCode,
            txHash: status.txHash,
            receivedUnits: BigInt(status.coins),
            explorerUrl: `${this.explorerBase()}/transaction/${status.txHash}`,
        });
    }

    /**
     * Account-level explorer link.
     *
     * There is no per-`query_id` explorer page, so this is the honest best
     * available before the transaction hash is known; `getOutcome` upgrades to a
     * direct transaction link once it is.
     */
    public explorerUrl(reference: SwapReference): string | null {
        return `${this.explorerBase()}/${reference.ownerAddress}`;
    }

    // ────────────────────────────────────────────────────────────────────────
    // Internals
    // ────────────────────────────────────────────────────────────────────────

    /** How STON.fi denotes an asset on the wire. */
    private wireAddress(asset: FungibleAsset): string {
        return asset.kind === 'native' ? STONFI_NATIVE_ADDRESS : asset.master;
    }

    /** Require simulation route metadata to agree with the independent registry. */
    private assertSimulationRouterCoherent(simulation: StonfiSimulation, router: StonfiRouter): void {
        const reported = simulation.router;
        const coherent =
            isSameAddress(simulation.routerAddress, reported.address) &&
            isSameAddress(reported.address, router.address) &&
            reported.majorVersion === router.majorVersion &&
            reported.minorVersion === router.minorVersion &&
            isSameAddress(reported.ptonMasterAddress, router.ptonMasterAddress) &&
            isSameAddress(reported.ptonWalletAddress, router.ptonWalletAddress) &&
            reported.ptonVersion === router.ptonVersion &&
            reported.routerType === router.routerType;
        if (!coherent) {
            throw new SwapError(
                SwapErrorCode.UntrustedDestination,
                'Refusing to use a STON.fi route whose simulation metadata disagrees with the independently resolved router.',
                {
                    severity: 'suspicious',
                    providerId: this.id,
                    details: { router: router.address },
                },
            );
        }
    }

    /** Require stored route data to still describe the resolved registry entry. */
    private assertStoredRouterCoherent(stored: StonfiRouter, resolved: StonfiRouter): void {
        const coherent =
            isSameAddress(stored.address, resolved.address) &&
            stored.majorVersion === resolved.majorVersion &&
            stored.minorVersion === resolved.minorVersion &&
            isSameAddress(stored.ptonMasterAddress, resolved.ptonMasterAddress) &&
            isSameAddress(stored.ptonWalletAddress, resolved.ptonWalletAddress) &&
            stored.ptonVersion === resolved.ptonVersion &&
            stored.routerType === resolved.routerType &&
            stored.poolCreationEnabled === resolved.poolCreationEnabled &&
            stored.trustSource === resolved.trustSource;
        if (!coherent) {
            throw new InvalidSwapRequestError(
                'The STON.fi route changed after this quote was issued. Refresh the price before signing.',
                { router: resolved.address },
            );
        }
    }

    /** Require quote-private direction, pool and gas fields to agree with the public quote. */
    private assertQuoteDataCoherent(quote: SwapQuote, data: StonfiQuoteData): void {
        if (data.direction !== resolveDirection(quote.from, quote.to)) {
            throw new InvalidSwapRequestError(
                'The STON.fi quote direction does not match the selected assets. Refresh the price.',
            );
        }
        if (quote.route.length !== 1 || !isSameAddress(quote.route[0]?.contractAddress ?? '', data.poolAddress)) {
            throw new InvalidSwapRequestError(
                'The STON.fi quote route does not match its pool metadata. Refresh the price.',
            );
        }
        if (
            quote.gas.messageValue !== data.gas.messageValue ||
            quote.gas.forwardValue !== data.gas.forwardValue ||
            quote.gas.estimatedConsumption !== data.gas.estimatedConsumption
        ) {
            throw new InvalidSwapRequestError(
                'The STON.fi quote gas budget changed after pricing. Refresh the price.',
            );
        }
    }

    /** Resolve and vet a router, or refuse the route. */
    private async resolveRouter(address: string, nowMs: number): Promise<StonfiRouter> {
        const router = await this.registry.resolve(address, nowMs);
        if (router === null) {
            throw new SwapError(
                SwapErrorCode.UntrustedDestination,
                `Refusing to swap through ${address}: it is not a router STON.fi lists.`,
                { severity: 'suspicious', providerId: this.id, details: { router: address } },
            );
        }
        await this.registry.verifyRouterOnChain(router, this.chain);
        return router;
    }

    /**
     * Instantiate the SDK contract class matching a router's exact version and
     * pool type.
     *
     * `routerFactory` is the SDK's own dispatch, so a new router generation is
     * supported as soon as the dependency is updated — and an unsupported one
     * fails here, loudly, rather than by silently emitting the wrong opcode the
     * way the audited builder did.
     */
    private routerContract(router: StonfiRouter): ReturnType<typeof routerFactory> {
        try {
            return routerFactory({
                address: router.address,
                majorVersion: router.majorVersion,
                minorVersion: router.minorVersion,
                routerType: router.routerType,
            });
        } catch (cause) {
            throw new SwapError(
                SwapErrorCode.NoRoute,
                `This route uses STON.fi router v${router.majorVersion}.${router.minorVersion} (${router.routerType}), which this version of the wallet does not support. Update the wallet to trade through it.`,
                {
                    severity: 'warning',
                    providerId: this.id,
                    details: { router: router.address, routerType: router.routerType },
                    cause,
                },
            );
        }
    }

    /**
     * The proxy-TON contract for a router.
     *
     * Selected from the registry's own `ptonVersion` rather than inferred from the
     * router version, so a future router that pairs with a different pTON
     * generation is handled by data rather than by an assumption baked into this
     * file. An unrecognised version fails closed.
     */
    private proxyTon(router: StonfiRouter): InstanceType<typeof pTON.v1> | InstanceType<typeof pTON.v2_1> {
        const master = parseAddress(router.ptonMasterAddress);
        switch (router.ptonVersion) {
            case '1.0':
            case 'v1':
                return new pTON.v1(master);
            case '2.1':
            case 'v2_1':
                return new pTON.v2_1(master);
            default:
                throw new SwapError(
                    SwapErrorCode.NoRoute,
                    `This route uses proxy-TON version ${router.ptonVersion}, which this version of the wallet does not support.`,
                    {
                        severity: 'warning',
                        providerId: this.id,
                        details: { router: router.address, ptonVersion: router.ptonVersion },
                    },
                );
        }
    }

    /**
     * Resolve, on chain, the address the swap will actually be sent to and the
     * ask-side jetton wallet the router will pay out through.
     *
     * Both come from `get_wallet_address` calls against masters that this wallet
     * either pinned or the user selected. Neither comes from the API.
     */
    private async resolveBuildAddresses(
        quote: SwapQuote,
        data: StonfiQuoteData,
        router: StonfiRouter,
        walletAddress: Address,
        chain: ChainAccess,
    ): Promise<{ readonly destination: Address; readonly askJettonWallet: Address }> {
        const routerAddress = parseAddress(router.address);
        const ptonMaster = parseAddress(router.ptonMasterAddress);

        // Offer side — where the message goes:
        //   offering a jetton → the user's own jetton wallet (a TEP-74 transfer)
        //   offering TON      → the router's proxy-TON wallet
        const destination =
            data.direction === 'ton-to-jetton'
                ? await getJettonWalletAddress(chain, ptonMaster, routerAddress)
                : await getJettonWalletAddress(chain, requireJettonMaster(quote.from), walletAddress);

        // Ask side — the router-owned wallet the swap body names as the payout
        // target. Passing it explicitly means the SDK does not re-derive it from
        // an address that arrived over the network.
        const askJettonWallet =
            data.direction === 'jetton-to-ton'
                ? await getJettonWalletAddress(chain, ptonMaster, routerAddress)
                : await getJettonWalletAddress(chain, requireJettonMaster(quote.to), routerAddress);

        const ptonWallet =
            data.direction === 'ton-to-jetton'
                ? destination
                : data.direction === 'jetton-to-ton'
                  ? askJettonWallet
                  : null;
        if (ptonWallet !== null && !isSameAddress(ptonWallet, router.ptonWalletAddress)) {
            throw new SwapError(
                SwapErrorCode.UntrustedDestination,
                'Refusing to swap: the router registry reports a different proxy-TON wallet than the pTON master derives on chain.',
                {
                    severity: 'suspicious',
                    providerId: this.id,
                    details: {
                        router: router.address,
                        reportedPtonWallet: router.ptonWalletAddress,
                        derivedPtonWallet: formatAddress(ptonWallet),
                    },
                },
            );
        }

        return { destination, askJettonWallet };
    }

    /**
     * Call the SDK entry point for this direction and router generation.
     *
     * The split mirrors the contracts: a jetton offer is a TEP-74 transfer
     * carrying a swap body, while a TON offer is a proxy-TON transfer. V1 and V2
     * are separated because their swap bodies are genuinely different messages —
     * conflating them is defect A2, where a V1 opcode was sent to a V2.2 router.
     */
    private async callSdk(args: {
        readonly contract: ReturnType<typeof routerFactory>;
        readonly direction: StonfiDirection;
        readonly router: StonfiRouter;
        readonly quote: SwapQuote;
        readonly gas: SwapGasEstimate;
        readonly walletAddress: Address;
        readonly receiverAddress: Address;
        readonly askJettonWalletAddress: Address;
        readonly offerJettonWalletAddress: Address;
        readonly queryId: bigint;
        readonly deadlineUnix: number;
        readonly chain: ChainAccess;
    }): Promise<SenderArguments> {
        const { quote, walletAddress, receiverAddress, askJettonWalletAddress, queryId } = args;
        const proxyTon = this.proxyTon(args.router);
        const minAskAmount = quote.minOutUnits;
        const forwardGasAmount = args.gas.forwardValue;
        // The jetton-offer entry points take the total attached value directly;
        // the TON-offer one computes it, and the caller verifies the result.
        const gasAmount = args.gas.messageValue;

        try {
            if (args.contract instanceof DEX.v1.Router) {
                const router = args.chain.open(args.contract);
                const referral = this.referral();
                switch (args.direction) {
                    case 'jetton-to-jetton':
                        return await router.getSwapJettonToJettonTxParams({
                            userWalletAddress: walletAddress,
                            offerJettonAddress: requireJettonMaster(quote.from),
                            offerJettonWalletAddress: args.offerJettonWalletAddress,
                            askJettonAddress: requireJettonMaster(quote.to),
                            askJettonWalletAddress,
                            offerAmount: quote.offerUnits,
                            minAskAmount,
                            gasAmount,
                            forwardGasAmount,
                            queryId,
                            ...referral,
                        });
                    case 'jetton-to-ton':
                        return await router.getSwapJettonToTonTxParams({
                            userWalletAddress: walletAddress,
                            offerJettonAddress: requireJettonMaster(quote.from),
                            offerJettonWalletAddress: args.offerJettonWalletAddress,
                            proxyTon,
                            askJettonWalletAddress,
                            offerAmount: quote.offerUnits,
                            minAskAmount,
                            gasAmount,
                            forwardGasAmount,
                            queryId,
                            ...referral,
                        });
                    case 'ton-to-jetton':
                        return await router.getSwapTonToJettonTxParams({
                            userWalletAddress: walletAddress,
                            proxyTon,
                            offerJettonWalletAddress: args.offerJettonWalletAddress,
                            askJettonAddress: requireJettonMaster(quote.to),
                            askJettonWalletAddress,
                            offerAmount: quote.offerUnits,
                            minAskAmount,
                            forwardGasAmount,
                            queryId,
                            ...referral,
                        });
                }
            }

            // V2.x. `deadline` is supplied on every call — its absence (a stored
            // `0`) is the defect that made every audited V2 swap expire on arrival.
            const router = args.chain.open(args.contract);
            const common = {
                userWalletAddress: walletAddress,
                receiverAddress,
                refundAddress: walletAddress,
                excessesAddress: walletAddress,
                askJettonWalletAddress,
                offerAmount: quote.offerUnits,
                minAskAmount,
                forwardGasAmount,
                queryId,
                deadline: args.deadlineUnix,
                ...this.referral(),
            };

            switch (args.direction) {
                case 'jetton-to-jetton':
                    return await router.getSwapJettonToJettonTxParams({
                        ...common,
                        offerJettonAddress: requireJettonMaster(quote.from),
                        offerJettonWalletAddress: args.offerJettonWalletAddress,
                        askJettonAddress: requireJettonMaster(quote.to),
                        gasAmount,
                    });
                case 'jetton-to-ton':
                    return await router.getSwapJettonToTonTxParams({
                        ...common,
                        offerJettonAddress: requireJettonMaster(quote.from),
                        offerJettonWalletAddress: args.offerJettonWalletAddress,
                        proxyTon,
                        gasAmount,
                    });
                case 'ton-to-jetton':
                    return await router.getSwapTonToJettonTxParams({
                        ...common,
                        proxyTon,
                        offerJettonWalletAddress: args.offerJettonWalletAddress,
                        askJettonAddress: requireJettonMaster(quote.to),
                    });
            }
        } catch (cause) {
            throw toSwapError(cause, this.id, 'STON.fi could not build this swap transaction.');
        }
    }

    /** Referral fields, present only when the wallet is configured with one. */
    private referral(): { readonly referralAddress?: string } {
        return this.referralAddress === null ? {} : { referralAddress: this.referralAddress };
    }

    /**
     * Resolve the TON attached to a swap and the portion forwarded onward.
     *
     * Starts from the SDK's constants for the exact router generation, raises them
     * to meet the API's own estimate where that is higher (a stableswap pool
     * genuinely costs more to traverse), and clamps the result. The clamp is what
     * stops a manipulated gas estimate from turning a swap into a donation.
     *
     * Pure and deterministic, and called once at quote time: `buildSwap` reuses
     * the stored figure rather than recomputing, because `assertGasCoherent`
     * requires the message values to equal `quote.gas.messageValue` exactly.
     */
    private planGas(
        router: StonfiRouter,
        direction: StonfiDirection,
        offerUnits: bigint,
        simulation: StonfiSimulation,
    ): SwapGasEstimate {
        const constants = this.routerContract(router).gasConstants;
        const defaults =
            direction === 'jetton-to-jetton'
                ? constants.swapJettonToJetton
                : direction === 'jetton-to-ton'
                  ? constants.swapJettonToTon
                  : { gasAmount: null, forwardGasAmount: constants.swapTonToJetton.forwardGasAmount };

        const forwardValue = minBigInt(maxBigInt(defaults.forwardGasAmount, simulation.forwardGas), MAX_FORWARD_GAS);

        let messageValue: bigint;
        if (direction === 'ton-to-jetton') {
            // The proxy-TON transfer carries the offered TON, the forwarded gas and
            // pTON's own processing fee. Reproduced here so the total can be
            // compared against what the SDK builds; v1 charges nothing extra.
            const ptonFee = router.ptonVersion.startsWith('1') ? 0n : pTON.v2_1.gasConstants.tonTransfer;
            messageValue = offerUnits + forwardValue + ptonFee;
        } else {
            // A jetton transfer must cover the forwarded amount plus its own
            // processing. The SDK's spread between the two is that overhead;
            // preserving it keeps the message payable when the forward amount is
            // raised, and keeps `forwardValue < messageValue` — the invariant whose
            // violation makes a transfer abort before it ever reaches the DEX.
            const overhead = defaults.gasAmount === null ? 0n : defaults.gasAmount - defaults.forwardGasAmount;
            messageValue = forwardValue + maxBigInt(overhead, 1n);
        }

        const gasOnly = direction === 'ton-to-jetton' ? messageValue - offerUnits : messageValue;
        if (gasOnly > MAX_SWAP_GAS) {
            throw new SwapError(
                SwapErrorCode.MalformedTransaction,
                `Refusing to attach ${formatUnits(gasOnly, 9)} TON in network fees to a swap.`,
                {
                    severity: 'suspicious',
                    providerId: this.id,
                    details: { gas: gasOnly.toString(), max: MAX_SWAP_GAS.toString() },
                },
            );
        }

        return {
            messageValue,
            forwardValue,
            estimatedConsumption: minBigInt(simulation.estimatedGasConsumption, gasOnly),
        };
    }

    /** Distinguish "no pool for this pair" from a genuine upstream failure. */
    private asQuoteError(cause: unknown, request: QuoteRequest): SwapError {
        const message = cause instanceof Error ? cause.message : String(cause);
        if (/no\s+(?:route|pool|pair|liquidity)|not\s+found|404/i.test(message)) {
            return new NoRouteError(assetLabel(request.from), assetLabel(request.to), cause);
        }
        return toSwapError(cause, this.id, 'STON.fi could not price this swap.');
    }

    private explorerBase(): string {
        return this.chain.network === 'testnet' ? 'https://testnet.tonviewer.com' : 'https://tonviewer.com';
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Free helpers
// ────────────────────────────────────────────────────────────────────────────

/** Factory used by the provider registry. */
export function createStonfiProvider(chain: ChainAccess, options?: StonfiProviderOptions): DexProvider {
    return new StonfiProvider(chain, options ?? {});
}

export const __testables = { decodeStonfiQuoteData, classifyExitCode };

function resolveDirection(from: FungibleAsset, to: FungibleAsset): StonfiDirection {
    if (from.kind === 'native') {
        return 'ton-to-jetton';
    }
    return to.kind === 'native' ? 'jetton-to-ton' : 'jetton-to-jetton';
}

/**
 * Narrow a jetton asset to its master address.
 *
 * Throwing rather than returning a sentinel keeps the direction dispatch honest:
 * every call site has already established which side is a jetton, so reaching
 * this failure means the direction and the assets disagree — a bug, not user
 * input, and one that must not be papered over on the way to a signature.
 */
function requireJettonMaster(asset: FungibleAsset): Address {
    if (asset.kind !== 'jetton') {
        throw new MalformedTransactionError('a jetton was expected but the swap leg is native TON', {
            asset: assetLabel(asset),
        });
    }
    return parseAddress(asset.master);
}

/** Confirmation-screen description of the single outgoing message. */
function describeMessage(quote: SwapQuote, direction: StonfiDirection, router: StonfiRouter): string {
    const amount = `${formatUnits(quote.offerUnits, quote.from.decimals)} ${assetLabel(quote.from)}`;
    const target = `STON.fi v${router.majorVersion}.${router.minorVersion} router`;
    return direction === 'ton-to-jetton'
        ? `Swap ${amount} for ${assetLabel(quote.to)} via the ${target} proxy-TON wallet`
        : `Swap ${amount} for ${assetLabel(quote.to)} via your ${assetLabel(quote.from)} wallet and the ${target}`;
}

/**
 * Which asset a protocol fee is denominated in.
 *
 * STON.fi charges the fee in one of the two traded assets. If the reported fee
 * address matches neither, the amount is reported as zero rather than rendered at
 * a guessed precision — showing "0.000000123 USDT" for a fee taken in an
 * unrelated token is worse than showing no fee at all.
 */
function resolveFee(
    simulation: StonfiSimulation,
    from: FungibleAsset,
    to: FungibleAsset,
): { readonly feeUnits: bigint; readonly feeAsset: FungibleAsset } {
    if (isSameAddress(simulation.feeAddress, simulation.offerAddress)) {
        return { feeUnits: simulation.feeUnits, feeAsset: from };
    }
    if (isSameAddress(simulation.feeAddress, simulation.askAddress)) {
        return { feeUnits: simulation.feeUnits, feeAsset: to };
    }
    return { feeUnits: 0n, feeAsset: to };
}

/** Map STON.fi asset tags onto the wallet's trust levels. */
function trustFromTags(tags: readonly string[]): 'verified' | 'community' | 'blacklisted' {
    for (const tag of tags) {
        if (BLACKLIST_TAGS.has(tag)) {
            return 'blacklisted';
        }
    }
    return tags.includes('asset:essential') ? 'verified' : 'community';
}

/** Human name for a pool's maths, for the route line. */
function describePool(routerType: string): string {
    switch (routerType) {
        case 'ConstantProduct':
        case 'constant_product':
            return 'constant-product pool';
        case 'StableSwap':
        case 'stableswap':
            return 'stable pool';
        case 'WeightedConstProduct':
        case 'weighted_const_product':
            return 'weighted constant-product pool';
        case 'WeightedStableSwap':
        case 'weighted_stableswap':
            return 'weighted stable pool';
        default:
            return 'liquidity pool';
    }
}

/**
 * Interpret a STON.fi swap exit code.
 *
 * The API reports symbolic codes (`swap_ok`, `swap_ok_ref`, `swap_refund_no_liq`,
 * …). Anything unrecognised is reported as `unknown` rather than assumed
 * successful: a wallet that claims a swap succeeded when it cannot tell is worse
 * than one that says so and offers an explorer link.
 */
function classifyExitCode(exitCode: string): SwapOutcome['state'] {
    if (exitCode === 'swap_ok' || exitCode === 'swap_ok_ref') {
        return 'succeeded';
    }
    if (
        exitCode === 'bounced' ||
        exitCode.startsWith('swap_refund') ||
        exitCode.startsWith('refund')
    ) {
        return 'failed';
    }
    return 'unknown';
}
