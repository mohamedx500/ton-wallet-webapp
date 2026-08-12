/**
 * STON.fi API client and response decoding
 * ============================================================================
 *
 * Wraps `@ston-fi/api` and converts its loosely-typed, string-valued responses
 * into the wallet's exact `bigint` domain types.
 *
 * WHY DECODE AT ALL WHEN THE SDK IS TYPED
 * ---------------------------------------
 * `@ston-fi/api` ships TypeScript declarations, but those describe the *intended*
 * shape at compile time. They are erased at runtime and enforce nothing: a
 * changed field, a null, a proxy injecting a value, or simply a new API version
 * all produce a value TypeScript believes is a `string` and JavaScript happily
 * carries forward as `undefined`. In a wallet, an `undefined` that reaches a
 * `BigInt()` call is a crash, and one that reaches a `min_out` field is a
 * silently unprotected trade.
 *
 * So every field this wallet acts on is decoded through an explicit check that
 * fails loudly with a {@link ProviderProtocolError}. The decoders are the only
 * place in the swap stack that touches raw API values.
 *
 * PRECISION
 * ---------
 * Unit amounts arrive as decimal strings and are parsed straight to `bigint` —
 * never through `Number`, which loses integer precision above 2^53 (about 9
 * million tokens at 9 decimals, a routine trade size). Rates and percentages
 * arrive as fractions like `"0.000000386"` and are converted to integer basis
 * points, so no float ever reaches a payload.
 */

import { StonApiClient } from '@ston-fi/api';

import { formatAddress, parseAddress } from '../../../core/address';
import { ProviderProtocolError } from '../../errors';

/** Default public API endpoint. */
export const STONFI_API_BASE_URL = 'https://api.ston.fi';

/**
 * The four endpoints this wallet uses, as a structural type.
 *
 * `StonApiClient` satisfies it, and so can a test double — which is the point.
 * The swap builder is a critical path and must be testable without reaching the
 * network; a test that depends on a live DEX endpoint is a test of the internet.
 *
 * Derived from the client with `Pick` rather than hand-written, so the parameter
 * and response types stay exactly the vendor's. A fake that drifts from the real
 * response shape fails to compile, which is the only way a hand-built fixture
 * stays honest.
 */
type StonApiMethods = Pick<StonApiClient, 'simulateSwap' | 'queryAssets' | 'getRouters'>;

/**
 * Runtime-facing API seam.
 *
 * The vendor's declarations describe the intended response, not the bytes that
 * arrive from HTTP. `getSwapStatus` therefore widens to `unknown` so callers
 * cannot read an unvalidated status field by accident. A real `StonApiClient`
 * remains assignable because a specific response is safely assignable to
 * `unknown`; tests can also inject malformed runtime values without casts.
 */
export interface StonApi extends StonApiMethods {
    getSwapStatus(query: Parameters<StonApiClient['getSwapStatus']>[0]): Promise<unknown>;
}

/**
 * Canonical address STON.fi uses to denote native TON in asset and simulation
 * requests.
 *
 * This is the zero address in workchain 0, published in the asset list with
 * `kind: "Ton"`. Passing it lets the API select the pTON master appropriate to
 * whichever router version wins the route, instead of the wallet having to guess
 * a pTON version up front and thereby pin itself to one router generation.
 *
 * Its `symbol` in the API is `GRAM`, which is a historical artefact of the
 * pre-rename Gram coin. Displaying that verbatim is where the existing token
 * registry's `symbol: 'Gram'` entry came from; the provider overrides it with
 * the wallet's own `TON_ASSET`.
 */
export const STONFI_NATIVE_ADDRESS = 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c';

/** A decoded, `bigint`-typed swap simulation. */
export interface StonfiSimulation {
    readonly offerAddress: string;
    readonly askAddress: string;
    readonly offerUnits: bigint;
    readonly askUnits: bigint;
    readonly minAskUnits: bigint;
    readonly recommendedMinAskUnits: bigint;
    readonly slippageBps: number;
    readonly recommendedSlippageBps: number;
    readonly priceImpactBps: number;
    readonly feeUnits: bigint;
    readonly feeAddress: string;
    readonly poolAddress: string;
    readonly routerAddress: string;
    readonly router: StonfiSimulationRouter;
    /** Forward gas the API expects the swap to need, in nanotons. */
    readonly forwardGas: bigint;
    /** Total gas budget the API suggests, in nanotons, when it provides one. */
    readonly gasBudget: bigint | null;
    readonly estimatedGasConsumption: bigint;
    /**
     * Jetton wallets the API believes are involved.
     *
     * Recorded for cross-checking and display only. These are **never** passed
     * to the transaction builder: the builder derives the addresses it sends to
     * from the jetton master the user selected. See the note in
     * `StonfiProvider.buildSwap`.
     */
    readonly reportedOfferJettonWallet: string;
    readonly reportedAskJettonWallet: string;
}

/** Router block of a simulation response. */
export interface StonfiSimulationRouter {
    readonly address: string;
    readonly majorVersion: number;
    readonly minorVersion: number;
    readonly ptonMasterAddress: string;
    readonly ptonWalletAddress: string;
    readonly ptonVersion: string;
    readonly routerType: string;
}

/** A decoded asset entry from the asset query endpoint. */
export interface StonfiAsset {
    readonly contractAddress: string;
    readonly kind: 'Ton' | 'Wton' | 'Jetton' | 'NotAnAsset';
    readonly symbol: string | null;
    readonly displayName: string | null;
    readonly imageUrl: string | null;
    readonly decimals: number | null;
    readonly tags: readonly string[];
    readonly popularityIndex: number;
}

/** Outcome of a `getSwapStatus` lookup. */
export type StonfiSwapStatus =
    | { readonly found: false }
    | {
          readonly found: true;
          /** Wallet address echoed by the status result. */
          readonly walletAddress: string;
          readonly exitCode: string;
          readonly queryId: string;
          readonly txHash: string;
          readonly coins: string;
          readonly balanceDeltas: string;
          readonly logicalTime: string;
      };

/** Parameters for a swap simulation. */
export interface StonfiSimulateParams {
    readonly offerAddress: string;
    readonly askAddress: string;
    readonly offerUnits: bigint;
    readonly slippageBps: number;
    /** Restrict to a DEX major version. Omit to let the API choose. */
    readonly dexVersion?: 1 | 2;
}

/**
 * Thin, decoding wrapper over `@ston-fi/api`.
 *
 * Deliberately narrow: only the four endpoints the swap flow needs are exposed,
 * so the surface that has to be kept correct stays small.
 */
export class StonfiClient {
    private readonly api: StonApi;

    /**
     * @param options.api Pre-built API client. Supplied by tests; in production
     *        one is constructed from `baseUrl`.
     */
    public constructor(options: { readonly baseUrl?: string; readonly api?: StonApi } = {}) {
        this.api = options.api ?? new StonApiClient({ baseURL: options.baseUrl ?? STONFI_API_BASE_URL });
    }

    /** The underlying client, for the router registry's own calls. */
    public get raw(): StonApi {
        return this.api;
    }

    /**
     * Simulate a swap.
     *
     * `slippageTolerance` is sent as a decimal fraction because that is the wire
     * format; the value is produced from integer bps by string manipulation
     * rather than division, so no floating-point rounding enters the request.
     */
    public async simulate(params: StonfiSimulateParams): Promise<StonfiSimulation> {
        const response = await this.api.simulateSwap({
            offerAddress: params.offerAddress,
            askAddress: params.askAddress,
            offerUnits: params.offerUnits.toString(),
            slippageTolerance: bpsToFractionString(params.slippageBps),
            ...(params.dexVersion === undefined ? {} : { dexVersion: [params.dexVersion] }),
        });
        return decodeSimulation(response);
    }

    /** Look up the fate of a submitted swap by its `query_id`. */
    public async getSwapStatus(params: {
        readonly routerAddress: string;
        readonly ownerAddress: string;
        readonly queryId: bigint;
    }): Promise<StonfiSwapStatus> {
        const owner = parseAddress(params.ownerAddress);
        const ownerCandidates = uniqueOwnerAddressForms(owner);
        let notFound: StonfiSwapStatus = Object.freeze({ found: false });

        for (const ownerAddress of ownerCandidates) {
            const response = await this.api.getSwapStatus({
                routerAddress: params.routerAddress,
                ownerAddress,
                queryId: params.queryId.toString(),
            });
            const status = decodeSwapStatus(response);
            if (status.found) {
                return status;
            }
            notFound = status;
        }

        return notFound;
    }

    /**
     * Query tradable assets.
     *
     * `condition` is the API's tag expression language, e.g.
     * `'asset:essential | asset:popular'`. The full unfiltered list runs to tens
     * of thousands of entries and is not usable in a picker.
     */
    public async queryAssets(params: {
        readonly condition: string;
        readonly searchTerms?: readonly string[];
        readonly walletAddress?: string;
        readonly limit?: number;
    }): Promise<readonly StonfiAsset[]> {
        const response = await this.api.queryAssets({
            condition: params.condition,
            ...(params.searchTerms === undefined ? {} : { searchTerms: [...params.searchTerms] }),
            ...(params.walletAddress === undefined ? {} : { walletAddress: params.walletAddress }),
            ...(params.limit === undefined ? {} : { limit: params.limit }),
        });
        const assets: StonfiAsset[] = [];
        for (const entry of response) {
            const decoded = tryDecodeAsset(entry);
            // One malformed asset must not empty the whole picker.
            if (decoded !== null) {
                assets.push(decoded);
            }
        }
        return assets;
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Decoders
// ────────────────────────────────────────────────────────────────────────────

/** Shape of the raw simulation response, before validation. */
type RawSimulation = Awaited<ReturnType<StonApiClient['simulateSwap']>>;
type RawAsset = Awaited<ReturnType<StonApiClient['queryAssets']>>[number];

const FOUND_STATUS_FIELDS: ReadonlySet<string> = new Set([
    '@type',
    'address',
    'exitCode',
    'queryId',
    'txHash',
    'coins',
    'balanceDeltas',
    'logicalTime',
]);

function uniqueOwnerAddressForms(owner: ReturnType<typeof parseAddress>): readonly string[] {
    const candidates = [
        formatAddress(owner, { bounceable: true }),
        formatAddress(owner, { bounceable: false }),
        owner.toRawString(),
    ];
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const candidate of candidates) {
        if (!seen.has(candidate)) {
            seen.add(candidate);
            unique.push(candidate);
        }
    }
    return Object.freeze(unique);
}

/** Decode a swap-status response from untrusted runtime data. */
function decodeSwapStatus(value: unknown): StonfiSwapStatus {
    const record = requireRecord(value, 'swapStatus');
    const kind = requireString(record['@type'], '@type');
    if (kind === 'NotFound') {
        requireExactKeys(record, new Set(['@type']), 'swapStatus');
        return Object.freeze({ found: false });
    }
    if (kind !== 'Found') {
        throw fieldError('@type', 'expected "Found" or "NotFound"');
    }

    requireExactKeys(record, FOUND_STATUS_FIELDS, 'swapStatus');
    return Object.freeze({
        found: true,
        walletAddress: requireAddress(record['address'], 'address'),
        exitCode: requireString(record['exitCode'], 'exitCode'),
        queryId: requireUnsignedIntegerString(record['queryId'], 'queryId'),
        txHash: requireString(record['txHash'], 'txHash'),
        coins: requireUnsignedIntegerString(record['coins'], 'coins'),
        balanceDeltas: requireString(record['balanceDeltas'], 'balanceDeltas'),
        logicalTime: requireUnsignedIntegerString(record['logicalTime'], 'logicalTime'),
    });
}

function decodeSimulation(raw: RawSimulation): StonfiSimulation {
    const router = raw.router as Partial<RawSimulation['router']> | undefined;
    if (router === undefined || router === null) {
        throw new ProviderProtocolError('stonfi', 'The swap simulation did not identify a router.');
    }
    return {
        offerAddress: requireAddress(raw.offerAddress, 'offerAddress'),
        askAddress: requireAddress(raw.askAddress, 'askAddress'),
        offerUnits: requireUnits(raw.offerUnits, 'offerUnits'),
        askUnits: requireUnits(raw.askUnits, 'askUnits'),
        minAskUnits: requireUnits(raw.minAskUnits, 'minAskUnits'),
        recommendedMinAskUnits: requireUnits(raw.recommendedMinAskUnits, 'recommendedMinAskUnits'),
        slippageBps: requireFractionAsBps(raw.slippageTolerance, 'slippageTolerance'),
        recommendedSlippageBps: requireFractionAsBps(
            raw.recommendedSlippageTolerance,
            'recommendedSlippageTolerance',
        ),
        priceImpactBps: requireFractionAsBps(raw.priceImpact, 'priceImpact'),
        feeUnits: requireUnits(raw.feeUnits, 'feeUnits'),
        feeAddress: requireAddress(raw.feeAddress, 'feeAddress'),
        poolAddress: requireAddress(raw.poolAddress, 'poolAddress'),
        routerAddress: requireAddress(raw.routerAddress, 'routerAddress'),
        router: decodeSimulationRouter(router),
        forwardGas: requireUnits(raw.gasParams?.forwardGas, 'gasParams.forwardGas'),
        gasBudget: raw.gasParams?.gasBudget === undefined ? null : requireUnits(raw.gasParams.gasBudget, 'gasParams.gasBudget'),
        estimatedGasConsumption: requireUnits(
            raw.gasParams?.estimatedGasConsumption,
            'gasParams.estimatedGasConsumption',
        ),
        reportedOfferJettonWallet: requireAddress(raw.offerJettonWallet, 'offerJettonWallet'),
        reportedAskJettonWallet: requireAddress(raw.askJettonWallet, 'askJettonWallet'),
    };
}

function decodeSimulationRouter(router: Partial<RawSimulation['router']>): StonfiSimulationRouter {
    const decoded = {
        address: requireAddress(router.address, 'router.address'),
        majorVersion: requireNonNegativeInteger(router.majorVersion, 'router.majorVersion'),
        minorVersion: requireNonNegativeInteger(router.minorVersion, 'router.minorVersion'),
        ptonMasterAddress: requireAddress(router.ptonMasterAddress, 'router.ptonMasterAddress'),
        ptonWalletAddress: requireAddress(router.ptonWalletAddress, 'router.ptonWalletAddress'),
        ptonVersion: requireString(router.ptonVersion, 'router.ptonVersion'),
        routerType: requireString(router.routerType, 'router.routerType'),
    };
    if (!isSupportedRouterCombination(decoded)) {
        throw fieldError('router', 'unsupported router, proxy-TON, or pool-type combination');
    }
    return decoded;
}

function tryDecodeAsset(raw: RawAsset): StonfiAsset | null {
    if (typeof raw?.contractAddress !== 'string') {
        return null;
    }
    let contractAddress: string;
    try {
        contractAddress = formatAddress(raw.contractAddress);
    } catch {
        return null;
    }
    const meta = raw.meta;
    // Widened to plain strings: the SDK types `tags` as a closed union of the
    // tags it knew about at publication, but the API adds new ones without a
    // package release. Treating them as opaque strings means an unrecognised tag
    // reaches `trustFromTags` — which is what must happen for a newly introduced
    // blacklist tag to be honoured by a wallet built before it existed.
    const tags = Array.isArray(raw.tags)
        ? raw.tags.flatMap<string>((tag) => (typeof tag === 'string' ? [tag] : []))
        : [];
    return {
        contractAddress,
        kind: raw.kind,
        symbol: typeof meta?.symbol === 'string' ? meta.symbol : null,
        displayName: typeof meta?.displayName === 'string' ? meta.displayName : null,
        imageUrl: typeof meta?.imageUrl === 'string' ? meta.imageUrl : null,
        decimals: typeof meta?.decimals === 'number' && Number.isInteger(meta.decimals) ? meta.decimals : null,
        tags,
        popularityIndex: typeof raw.popularityIndex === 'number' && Number.isFinite(raw.popularityIndex)
            ? raw.popularityIndex
            : 0,
    };
}

// ────────────────────────────────────────────────────────────────────────────
// Field validators
// ────────────────────────────────────────────────────────────────────────────

function fieldError(field: string, detail: string): ProviderProtocolError {
    return new ProviderProtocolError('stonfi', `Unexpected value for "${field}" in the API response (${detail}).`);
}

function requireString(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.length === 0) {
        throw fieldError(field, 'expected a non-empty string');
    }
    return value;
}

function requireRecord(value: unknown, field: string): Readonly<Record<string, unknown>> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw fieldError(field, 'expected an object');
    }
    return value as Readonly<Record<string, unknown>>;
}

function requireExactKeys(
    record: Readonly<Record<string, unknown>>,
    expected: ReadonlySet<string>,
    field: string,
): void {
    const keys = Reflect.ownKeys(record);
    if (
        keys.length !== expected.size ||
        !keys.every((key) => typeof key === 'string' && expected.has(key))
    ) {
        throw fieldError(field, 'unexpected or missing fields');
    }
}

function requireUnsignedIntegerString(value: unknown, field: string): string {
    const raw = requireString(value, field);
    if (!/^\d+$/.test(raw)) {
        throw fieldError(field, 'expected an unsigned whole-number string');
    }
    return raw;
}

function requireNonNegativeInteger(value: unknown, field: string): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        throw fieldError(field, 'expected a non-negative safe integer');
    }
    return value;
}

function isSupportedRouterCombination(router: StonfiSimulationRouter): boolean {
    if (router.majorVersion === 1 && router.minorVersion === 0) {
        return (
            (router.ptonVersion === '1.0' || router.ptonVersion === 'v1') &&
            router.routerType === 'ConstantProduct'
        );
    }
    if (router.majorVersion === 2 && (router.minorVersion === 1 || router.minorVersion === 2)) {
        return (
            (router.ptonVersion === '2.1' || router.ptonVersion === 'v2_1') &&
            ['ConstantProduct', 'StableSwap', 'WeightedConstProduct', 'WeightedStableSwap'].includes(
                router.routerType,
            )
        );
    }
    return false;
}

/** Parse and normalise an address, so downstream comparisons are canonical. */
function requireAddress(value: unknown, field: string): string {
    const raw = requireString(value, field);
    try {
        return formatAddress(raw);
    } catch {
        throw fieldError(field, 'not a valid TON address');
    }
}

/**
 * Parse a non-negative integer token amount.
 *
 * Rejects anything that is not a plain digit string. In particular it rejects
 * exponential notation (`"1e9"`) and decimal points, both of which `BigInt()`
 * would throw on anyway but with an opaque message, and both of which would
 * indicate the API changed representation in a way the wallet must not guess at.
 */
function requireUnits(value: unknown, field: string): bigint {
    const raw = requireString(value, field);
    if (!/^\d+$/.test(raw)) {
        throw fieldError(field, 'expected a whole number of token units');
    }
    return BigInt(raw);
}

/**
 * Convert a decimal fraction string to integer basis points.
 *
 * `"0.01"` → `100`. Done by digit manipulation rather than
 * `Math.round(parseFloat(x) * 10000)` so that a value like `"0.00005"` cannot be
 * silently rounded to a different bucket by binary floating point, and so the
 * function has no precision ceiling.
 *
 * Fractional basis points are truncated: bps is the resolution the protocol and
 * the UI work in, and rounding *down* a tolerance is the conservative direction.
 * Price impact is rounded down for the same reason it is displayed at all —
 * consistency with the tolerance it is compared against.
 */
function requireFractionAsBps(value: unknown, field: string): number {
    const raw = requireString(value, field).trim();
    const match = /^(-?)(\d+)(?:\.(\d*))?$/.exec(raw);
    if (match === null) {
        throw fieldError(field, 'expected a decimal fraction');
    }
    const isNegative = match[1] === '-';
    const whole = match[2] ?? '0';
    const fraction = match[3] ?? '';
    // Multiply by 10 000 by shifting the decimal point four places right.
    const shifted = `${whole}${fraction.padEnd(4, '0').slice(0, 4)}`;
    let bps = Number(shifted);
    if (isNegative) {
        bps = -bps;
    }
    if (!Number.isSafeInteger(bps)) {
        throw fieldError(field, 'value is out of range');
    }
    return bps;
}

/**
 * Render integer basis points as the decimal fraction the API expects.
 *
 * `100` → `"0.0100"`. String construction, not division, for the same reason as
 * above: the request must carry exactly the tolerance the user chose.
 */
export function bpsToFractionString(bps: number): string {
    if (!Number.isInteger(bps) || bps < 0) {
        throw new ProviderProtocolError('stonfi', `Slippage must be a non-negative integer in basis points, got ${bps}.`);
    }
    const padded = bps.toString().padStart(5, '0');
    const whole = padded.slice(0, -4);
    const fraction = padded.slice(-4);
    return `${whole}.${fraction}`;
}

/** Exposed for unit tests, which assert the precision behaviour directly. */
export const __testables = {
    requireFractionAsBps,
    requireUnits,
    bpsToFractionString,
    decodeSwapStatus,
};
