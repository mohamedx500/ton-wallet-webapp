/**
 * STON.fi router registry
 * ============================================================================
 *
 * The wallet's independent source of truth for which contracts belong to
 * STON.fi. Everything the swap flow signs for is checked against this registry.
 *
 * WHY A SEPARATE REGISTRY AT ALL
 * ------------------------------
 * The swap simulation response already contains a `router` object with all the
 * addresses needed to build a transaction. Using those directly is what the
 * audited implementation did, and it means the wallet signs whatever the HTTP
 * response says — a compromised endpoint, a hijacked DNS record or a
 * man-in-the-middle can substitute an address and the wallet forwards the user's
 * jettons to it without objection.
 *
 * The registry closes that hole with two independent layers:
 *
 *  1. **A pinned allow-list** ({@link PINNED_ROUTERS}), compiled into the build.
 *     These addresses are verified out-of-band against STON.fi's published
 *     contract list and cannot be changed at runtime by any network response.
 *  2. **The live registry** (`GET /v1/routers`), fetched separately from the
 *     quote. A router that appears here but not in the pinned set is usable, but
 *     only after passing an on-chain identity check: the wallet calls the
 *     contract's own `get_router_version` / `get_router_data` get-methods and
 *     requires them to answer consistently with the claimed version.
 *
 * A quote naming a router that satisfies neither layer is refused. Note the
 * asymmetry that makes this worth doing: an attacker who controls the API can
 * substitute an address in the *quote*, but the quote is never the thing that is
 * trusted — the registry entry is, and it is fetched over a different request
 * whose contents must agree.
 *
 * The pTON wallet address is deliberately *not* taken from either source and is
 * re-derived on-chain — see `StonfiProvider.verifyDestination`.
 */

import type { StonApi } from './client';

import { AddressSet, addressKey, formatAddress, isSameAddress } from '../../../core/address';
import type { ChainAccess } from '../../../core/chain';
import { ProviderProtocolError, SwapError, SwapErrorCode } from '../../errors';

/** A STON.fi router, normalised into wallet address conventions. */
export interface StonfiRouter {
    /** Router contract, bounceable friendly form. */
    readonly address: string;
    readonly majorVersion: number;
    readonly minorVersion: number;
    /** pTON jetton master this router uses to represent native TON. */
    readonly ptonMasterAddress: string;
    /**
     * Router-owned pTON wallet, as reported by the registry.
     *
     * Advisory only. The value actually used as a destination is re-derived
     * on-chain from `ptonMasterAddress`, and the two must match.
     */
    readonly ptonWalletAddress: string;
    /** pTON contract version, `'1.0'` or `'2.1'`. */
    readonly ptonVersion: string;
    /** Pool maths, e.g. `'ConstantProduct'` or `'StableSwap'`. */
    readonly routerType: string;
    readonly poolCreationEnabled: boolean;
    /** How this router earned trust. Recorded in the destination verdict. */
    readonly trustSource: RouterTrustSource;
}

/** Where a router's trust comes from. */
export type RouterTrustSource =
    /** Compiled into this build and verified out-of-band. Strongest. */
    | 'pinned'
    /** Published by the live registry and confirmed on-chain. */
    | 'registry';

/**
 * Routers pinned into the build.
 *
 * Captured from STON.fi's published router list and cross-checked against live
 * `GET /v1/routers` output. The V1 router address additionally matches the
 * constant compiled into `@ston-fi/sdk` (`RouterV1.address`), which is an
 * independent confirmation from the vendor's own package.
 *
 * A router missing from this list is not rejected outright — STON.fi deploys new
 * routers, and a wallet that hard-fails on every deployment is a wallet that
 * stops working. It is instead subjected to the on-chain identity check in
 * {@link verifyRouterOnChain}.
 */
export const PINNED_ROUTERS: readonly Omit<StonfiRouter, 'trustSource'>[] = Object.freeze([
    {
        // v1.0 — the original router. Still carries live liquidity.
        address: 'EQB3ncyBUTjZUA5EnFKR5_EnOMI9V1tTEAAPaiU71gc4TiUt',
        majorVersion: 1,
        minorVersion: 0,
        ptonMasterAddress: 'EQCM3B12QK1e4yZSf8GtBRT0aLMNyEsBc_DhVfRRtOEffLez',
        ptonWalletAddress: 'EQARULUYsmJq1RiZ-YiH-IJLcAZUVkVff-KBPwEmmaQGH6aC',
        ptonVersion: '1.0',
        routerType: 'ConstantProduct',
        poolCreationEnabled: false,
    },
    {
        // v2.2 constant-product — the router the API currently routes TON/USDT
        // through, and the one the audited builder was sending expired payloads
        // to.
        address: 'EQCS4UEa5UaJLzOyyKieqQOQ2P9M-7kXpkO5HnP3Bv250cN3',
        majorVersion: 2,
        minorVersion: 2,
        ptonMasterAddress: 'EQBnGWMCf3-FZZq1W4IWcWiGAc3PHuZ0_H-7sad2oY00o83S',
        ptonWalletAddress: 'EQCSIMGBps_qzRG3uPYhON8bucyCtu0mYdL1-u4gSz77IBa3',
        ptonVersion: '2.1',
        routerType: 'ConstantProduct',
        poolCreationEnabled: true,
    },
    {
        // v2.2 constant-product, pool creation enabled.
        address: 'EQAJG5pyZPWEiQiMVJdf7bDRgRLzg6QR57qKeRsOrMO-ncZN',
        majorVersion: 2,
        minorVersion: 2,
        ptonMasterAddress: 'EQBnGWMCf3-FZZq1W4IWcWiGAc3PHuZ0_H-7sad2oY00o83S',
        ptonWalletAddress: 'EQAIuYlddISZbBf7iymZ-WPP9zHaVj9Kg45OH-PgntVz9QbQ',
        ptonVersion: '2.1',
        routerType: 'ConstantProduct',
        poolCreationEnabled: false,
    },
    {
        // v2.2 stableswap — used for stable pairs such as USDT/USDC.
        address: 'EQBqgCTdrtSod76UrcOeALSiLCp3WuNIFQBQvyjjlQMvwLkc',
        majorVersion: 2,
        minorVersion: 2,
        ptonMasterAddress: 'EQBnGWMCf3-FZZq1W4IWcWiGAc3PHuZ0_H-7sad2oY00o83S',
        ptonWalletAddress: 'EQBvwdaM2LT9JPZGYdqYMCtIuLzjjAqHDSdaJW8fErAU7JUM',
        ptonVersion: '2.1',
        routerType: 'StableSwap',
        poolCreationEnabled: false,
    },
    {
        // v2.2 constant-product, pool creation enabled.
        address: 'EQDh5oHPvfRwPu2bORBGCoLEO4WQZKL4fk5DD1gydeNG9oEH',
        majorVersion: 2,
        minorVersion: 2,
        ptonMasterAddress: 'EQBnGWMCf3-FZZq1W4IWcWiGAc3PHuZ0_H-7sad2oY00o83S',
        ptonWalletAddress: 'EQDix2qMOc-QO05Nn9X7oKFnYTb3bvtxN7ySmzoGljrFv2bX',
        ptonVersion: '2.1',
        routerType: 'ConstantProduct',
        poolCreationEnabled: true,
    },
]);

/**
 * pTON jetton masters STON.fi is known to use.
 *
 * Pinned separately from the routers because pTON is the contract that holds
 * native TON on the user's behalf during a swap: substituting it is the single
 * most direct way to steal a TON-side trade. There are exactly two in
 * production, and a new one is a protocol-level event, not a routine deployment.
 */
export const PINNED_PTON_MASTERS: readonly string[] = Object.freeze([
    'EQCM3B12QK1e4yZSf8GtBRT0aLMNyEsBc_DhVfRRtOEffLez', // pTON v1.0
    'EQBnGWMCf3-FZZq1W4IWcWiGAc3PHuZ0_H-7sad2oY00o83S', // pTON v2.1
]);

/** How long a fetched registry is reused before being refreshed. */
const REGISTRY_TTL_MS = 10 * 60 * 1000;

/**
 * Loads, caches and vets STON.fi router metadata.
 *
 * One instance per provider. Safe to call concurrently: an in-flight refresh is
 * shared rather than duplicated, so a burst of quote requests produces one
 * registry fetch.
 */
export class StonfiRouterRegistry {
    private readonly api: StonApi;
    private readonly pinned: ReadonlyMap<string, StonfiRouter>;
    private readonly pinnedPtonMasters: AddressSet;

    private cache: ReadonlyMap<string, StonfiRouter> | null = null;
    private cachedAtMs = 0;
    private inFlight: Promise<ReadonlyMap<string, StonfiRouter>> | null = null;
    /** Routers that passed the on-chain identity check, by canonical key. */
    private readonly onChainVerified = new Set<string>();

    public constructor(api: StonApi) {
        this.api = api;
        const pinned = new Map<string, StonfiRouter>();
        for (const router of PINNED_ROUTERS) {
            pinned.set(addressKey(router.address), { ...router, trustSource: 'pinned' });
        }
        this.pinned = pinned;
        this.pinnedPtonMasters = new AddressSet(PINNED_PTON_MASTERS);
    }

    /**
     * Resolve a router by address.
     *
     * Checks the pinned set first so that the common case needs no network call
     * and cannot be influenced by a response at all. Falls back to the live
     * registry for routers deployed after this build.
     *
     * @returns the router, or `null` if STON.fi does not acknowledge it.
     */
    public async resolve(address: string, nowMs: number): Promise<StonfiRouter | null> {
        const key = addressKey(address);
        const pinned = this.pinned.get(key);
        if (pinned !== undefined) {
            return pinned;
        }
        const live = await this.load(nowMs);
        return live.get(key) ?? null;
    }

    /** Every router STON.fi acknowledges, pinned entries taking precedence. */
    public async list(nowMs: number): Promise<readonly StonfiRouter[]> {
        const live = await this.load(nowMs);
        return [...live.values()];
    }

    /** Whether a pTON master is one of the two pinned production contracts. */
    public isPinnedPtonMaster(address: string): boolean {
        return this.pinnedPtonMasters.has(address);
    }

    /**
     * Confirm on-chain that a router really is a STON.fi router of the claimed
     * version, for routers that are not pinned.
     *
     * The check calls the router's own `get_router_version` get-method and
     * requires the major/minor version to match what the registry claims. This
     * is not proof of honesty — a malicious contract can return any numbers it
     * likes — but it is proof of *existence and shape*: an address that is an
     * ordinary wallet, an undeployed account, or an unrelated contract cannot
     * answer, which eliminates the realistic substitution attacks (typo-squatted
     * addresses, an attacker's own wallet, a stale address from another network).
     *
     * Combined with the address having been independently published by the
     * registry endpoint, this is the strongest statement a client can make about
     * a contract it did not compile in.
     *
     * The result is memoised: a router that has answered once is not re-queried.
     */
    public async verifyRouterOnChain(router: StonfiRouter, chain: ChainAccess): Promise<void> {
        if (router.trustSource === 'pinned') {
            return;
        }
        const key = addressKey(router.address);
        if (this.onChainVerified.has(key)) {
            return;
        }

        if (!(await chain.isDeployed(router.address))) {
            throw new SwapError(
                SwapErrorCode.UntrustedDestination,
                `Refusing to swap: ${router.address} is not a deployed contract.`,
                { severity: 'suspicious', providerId: 'stonfi', details: { router: router.address } },
            );
        }

        let major: number;
        let minor: number;
        try {
            const result = await chain.runGetMethod(router.address, 'get_router_version');
            major = result.stack.readNumber();
            minor = result.stack.readNumber();
        } catch (cause) {
            throw new SwapError(
                SwapErrorCode.UntrustedDestination,
                `Refusing to swap: ${router.address} does not behave like a STON.fi router.`,
                {
                    severity: 'suspicious',
                    providerId: 'stonfi',
                    details: { router: router.address },
                    cause,
                },
            );
        }

        if (major !== router.majorVersion || minor !== router.minorVersion) {
            throw new SwapError(
                SwapErrorCode.UntrustedDestination,
                `Refusing to swap: ${router.address} reports version ${major}.${minor} ` +
                    `but is listed as ${router.majorVersion}.${router.minorVersion}.`,
                {
                    severity: 'suspicious',
                    providerId: 'stonfi',
                    details: {
                        router: router.address,
                        onChainVersion: `${major}.${minor}`,
                        listedVersion: `${router.majorVersion}.${router.minorVersion}`,
                    },
                },
            );
        }

        this.onChainVerified.add(key);
    }

    /** Fetch the live registry, honouring the cache and de-duplicating refreshes. */
    private async load(nowMs: number): Promise<ReadonlyMap<string, StonfiRouter>> {
        const cache = this.cache;
        if (cache !== null && nowMs - this.cachedAtMs < REGISTRY_TTL_MS) {
            return cache;
        }
        // Share one in-flight refresh across concurrent callers.
        this.inFlight ??= this.fetch()
            .then((loaded) => {
                this.cache = loaded;
                this.cachedAtMs = nowMs;
                return loaded;
            })
            .finally(() => {
                this.inFlight = null;
            });
        try {
            return await this.inFlight;
        } catch (cause) {
            // Degrade to the pinned set rather than blocking all swaps on a
            // registry outage: pinned routers carry the bulk of liquidity and
            // need no network call to be trusted.
            if (cache !== null) {
                return cache;
            }
            if (this.pinned.size > 0) {
                return this.pinned;
            }
            throw new ProviderProtocolError('stonfi', 'Could not load the STON.fi router list.', cause);
        }
    }

    private async fetch(): Promise<ReadonlyMap<string, StonfiRouter>> {
        const response: unknown = await this.api.getRouters({ dexV2: true });
        if (!Array.isArray(response)) {
            throw new ProviderProtocolError('stonfi', 'The router registry response is not a list.');
        }

        const routers = new Map<string, StonfiRouter>(this.pinned);
        for (const entry of response) {
            const normalised = decodeRegistryRouter(entry);
            if (normalised === null) {
                // One malformed entry must not disable every other trusted router.
                continue;
            }
            const key = addressKey(normalised.address);
            const pinned = this.pinned.get(key);
            if (pinned !== undefined) {
                // A live response cannot overwrite a pin. If it names a pinned
                // address with conflicting metadata, ignore it completely rather
                // than blending trusted and untrusted fields.
                if (!sameRouterIdentity(pinned, normalised)) {
                    continue;
                }
                continue;
            }
            routers.set(key, normalised);
        }
        return routers;
    }
}

const REGISTRY_FIELDS = Object.freeze([
    'address',
    'majorVersion',
    'minorVersion',
    'ptonMasterAddress',
    'ptonVersion',
    'ptonWalletAddress',
    'routerType',
    'poolCreationEnabled',
] as const);

const SUPPORTED_ROUTER_TYPES: ReadonlySet<string> = new Set([
    'ConstantProduct',
    'StableSwap',
    'WeightedConstProduct',
    'WeightedStableSwap',
]);

function decodeRegistryRouter(value: unknown): StonfiRouter | null {
    if (!isExactRecord(value, REGISTRY_FIELDS)) {
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

    if (
        address === null ||
        ptonMasterAddress === null ||
        ptonWalletAddress === null ||
        majorVersion === null ||
        minorVersion === null ||
        typeof ptonVersion !== 'string' ||
        typeof routerType !== 'string' ||
        !SUPPORTED_ROUTER_TYPES.has(routerType) ||
        typeof poolCreationEnabled !== 'boolean' ||
        !isSupportedCombination(majorVersion, minorVersion, ptonVersion, routerType)
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
        routerType,
        poolCreationEnabled,
        trustSource: 'registry',
    });
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

function isSupportedCombination(
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

function sameRouterIdentity(left: StonfiRouter, right: StonfiRouter): boolean {
    return (
        isSameAddress(left.address, right.address) &&
        left.majorVersion === right.majorVersion &&
        left.minorVersion === right.minorVersion &&
        isSameAddress(left.ptonMasterAddress, right.ptonMasterAddress) &&
        isSameAddress(left.ptonWalletAddress, right.ptonWalletAddress) &&
        left.ptonVersion === right.ptonVersion &&
        left.routerType === right.routerType &&
        left.poolCreationEnabled === right.poolCreationEnabled
    );
}

export const __testables = { decodeRegistryRouter };
