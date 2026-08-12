import { isSameAddress } from '../../core/address';
import type { NetworkId } from '../../core/chain';
import { tryParseUnits } from '../../core/units';
import type {
    CreateSwapIntentInput,
    LegacySwapAssetInput,
    LegacyWalletAccountInput,
} from './types';

const TON_ICON = 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ton/info/logo.png';
const MAX_DISCOVERED_ASSETS = 1_000;

export interface ActiveSwapAsset {
    readonly contractAddress: string;
    readonly symbol: string;
    readonly name: string;
    readonly decimals: number;
    readonly imageUrl: string;
}

export interface ActiveWalletTokenBalance {
    readonly symbol?: unknown;
    readonly rawBalance?: unknown;
    readonly masterAddress?: unknown;
}

export interface ActiveQuoteIntentInput {
    readonly network: NetworkId;
    readonly ownerAddress: string;
    readonly account: LegacyWalletAccountInput;
    readonly from: ActiveSwapAsset;
    readonly to: ActiveSwapAsset;
    readonly amount: string;
    readonly slippageBps: number;
    readonly correlationId: string;
}

export const ACTIVE_TON_ASSET: ActiveSwapAsset = Object.freeze({
    contractAddress: 'native',
    symbol: 'TON',
    name: 'Toncoin',
    decimals: 9,
    imageUrl: TON_ICON,
});

/** Strictly decode STON.fi asset discovery without trusting display text as identity. */
export function decodeStonfiAssets(value: unknown): readonly ActiveSwapAsset[] {
    const response = record(value);
    const assetList = response['asset_list'];
    if (!Array.isArray(assetList)) throw new TypeError('STON.fi returned an invalid asset list.');

    const assets = assetList
        .map(decodeAsset)
        .filter((asset): asset is ActiveSwapAsset & { readonly popularity: number } => asset !== null)
        .sort((left, right) => right.popularity - left.popularity)
        .slice(0, MAX_DISCOVERED_ASSETS)
        .map(({ popularity: _popularity, ...asset }) => Object.freeze(asset));

    const withoutNativeAliases = assets.filter((asset) => asset.contractAddress !== 'native');
    return Object.freeze([ACTIVE_TON_ASSET, ...withoutNativeAliases]);
}

/** Create the exact Stage A input. Asset identity is always contract-based. */
export function createActiveQuoteIntent(input: ActiveQuoteIntentInput): CreateSwapIntentInput {
    return Object.freeze({
        network: input.network,
        ownerAddress: input.ownerAddress,
        account: Object.freeze({ ...input.account }),
        from: toLegacyAsset(input.from),
        to: toLegacyAsset(input.to),
        amount: input.amount,
        slippageBps: input.slippageBps,
        correlationId: input.correlationId,
    });
}

export function hasPositiveExactAmount(value: string, decimals: number): boolean {
    const units = tryParseUnits(value, decimals);
    return units !== null && units > 0n;
}

/** Display-only balance lookup keyed by native identity or Jetton master. */
export function findActiveAssetBalance(
    asset: ActiveSwapAsset,
    tokens: readonly ActiveWalletTokenBalance[],
): number {
    const token = asset.contractAddress === 'native'
        ? tokens.find(isNativeBalance)
        : tokens.find((candidate) => sameMaster(candidate.masterAddress, asset.contractAddress));
    return finiteBalance(token?.rawBalance);
}

function decodeAsset(value: unknown): (ActiveSwapAsset & { readonly popularity: number }) | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const asset = value as Readonly<Record<string, unknown>>;
    if (asset['blacklisted'] === true || asset['deprecated'] === true) return null;

    const contractAddress = nonEmptyString(asset['contract_address']);
    const symbol = nonEmptyString(asset['symbol']);
    if (contractAddress === null || symbol === null) return null;

    const decimals = asset['decimals'];
    if (!Number.isInteger(decimals) || (decimals as number) < 0 || (decimals as number) > 30) return null;
    const imageUrl = safeImageUrl(asset['image_url']);
    const name = nonEmptyString(asset['display_name']) ?? symbol;
    const popularity = finiteNumber(asset['popularity_index']) ?? 0;

    return {
        contractAddress,
        symbol,
        name,
        decimals: decimals as number,
        imageUrl,
        popularity,
    };
}

function toLegacyAsset(asset: ActiveSwapAsset): LegacySwapAssetInput {
    return Object.freeze({
        contractAddress: asset.contractAddress,
        symbol: asset.symbol,
        name: asset.name,
        decimals: asset.decimals,
        imageUrl: asset.imageUrl,
        trust: asset.contractAddress === 'native' ? 'builtin' : 'verified',
    });
}

function isNativeBalance(token: ActiveWalletTokenBalance): boolean {
    return token.masterAddress === undefined
        && (token.symbol === 'TON' || token.symbol === 'Gram');
}

function sameMaster(value: unknown, expected: string): boolean {
    if (typeof value !== 'string') return false;
    try {
        return isSameAddress(value, expected);
    } catch {
        return false;
    }
}

function finiteBalance(raw: unknown): number {
    if (typeof raw === 'number') {
        return Number.isFinite(raw) && raw >= 0 ? raw : 0;
    }
    if (typeof raw !== 'string' || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(raw)) return 0;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new TypeError('STON.fi returned an invalid asset response.');
    }
    return value as Readonly<Record<string, unknown>>;
}

function nonEmptyString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    return text.length === 0 ? null : text;
}

function safeImageUrl(value: unknown): string {
    const url = nonEmptyString(value);
    if (url === null) return TON_ICON;
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'https:' ? url : TON_ICON;
    } catch {
        return TON_ICON;
    }
}

function finiteNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
