import {
    TON_ASSET,
    createJettonAsset,
    isSameAsset,
} from '../../assets/fungible';
import type { FungibleAsset } from '../../assets/fungible';
import { formatAddress, isSameAddress } from '../../core/address';
import type { NetworkId } from '../../core/chain';
import { InvalidAddressError, InvalidAmountError } from '../../core/errors';
import { TON_DECIMALS, parseUnits } from '../../core/units';
import type {
    StandardWalletContractVersion,
    StandardWalletDescriptor,
    WalletDescriptor,
} from '../../wallet/types';
import {
    SwapApplicationError,
    SwapApplicationErrorCode,
} from './errors';
import type {
    CreateSwapIntentInput,
    LegacySwapAssetInput,
    LegacyWalletAccountInput,
    SwapIntent,
} from './types';

const MAX_ASSET_DECIMALS = 30;
const MIN_SLIPPAGE_BPS = 10;
const MAX_SLIPPAGE_BPS = 2_000;
const MAX_CORRELATION_ID_LENGTH = 128;
const STANDARD_WALLET_VERSIONS: ReadonlySet<string> = new Set([
    'v3r1',
    'v3r2',
    'v4r2',
    'v5r1',
]);

/** Convert a legacy token-like value without using display metadata as identity. */
export function toFungibleAsset(input: LegacySwapAssetInput): FungibleAsset {
    assertAssetDecimals(input.decimals);

    if (input.contractAddress === 'native') {
        if (input.decimals !== TON_DECIMALS) {
            throw new SwapApplicationError(
                SwapApplicationErrorCode.InvalidDecimals,
                'Native TON must use the protocol-defined nine decimal places.',
                { decimals: String(input.decimals) },
            );
        }
        return TON_ASSET;
    }

    if (input.contractAddress.trim().length === 0) {
        throw new SwapApplicationError(
            SwapApplicationErrorCode.InvalidAssetIdentity,
            'A Jetton master address is required.',
        );
    }

    try {
        return Object.freeze(createJettonAsset({
            master: input.contractAddress,
            symbol: input.symbol,
            name: input.name,
            decimals: input.decimals,
            ...(input.imageUrl === undefined ? {} : { imageUrl: input.imageUrl }),
            ...(input.trust === undefined ? {} : { trust: input.trust }),
        }));
    } catch (cause) {
        if (cause instanceof InvalidAddressError) {
            throw new SwapApplicationError(
                SwapApplicationErrorCode.InvalidAssetIdentity,
                'This Jetton master address is invalid.',
                {},
                cause,
            );
        }
        throw cause;
    }
}

/** Parse a UI decimal string into a strictly positive exact unit count. */
export function parsePositiveOfferUnits(value: string, decimals: number): bigint {
    assertAssetDecimals(decimals);

    try {
        const units = parseUnits(value, decimals);
        if (units <= 0n) {
            throw new SwapApplicationError(
                SwapApplicationErrorCode.InvalidAmount,
                'Enter an amount greater than zero.',
            );
        }
        return units;
    } catch (cause) {
        if (cause instanceof SwapApplicationError) {
            throw cause;
        }
        if (cause instanceof InvalidAmountError) {
            throw new SwapApplicationError(
                SwapApplicationErrorCode.InvalidAmount,
                cause.message,
                cause.details,
                cause,
            );
        }
        throw cause;
    }
}

/** Map an unrestricted legacy wallet type to an audited standard or highload descriptor. */
export function toWalletDescriptor(
    input: LegacyWalletAccountInput,
): WalletDescriptor {
    if (input.type === 'highload-v3') {
        return {
            kind: 'highload-v3',
            version: 'highload-v3',
            address: formatAddress(input.address),
            subwalletId: 0x10ad, // 4269 — recommended HL3 subwallet id (matches wallet creation)
            timeoutSeconds: 3600,
        };
    }
    if (!STANDARD_WALLET_VERSIONS.has(input.type)) {
        throw new SwapApplicationError(
            SwapApplicationErrorCode.UnsupportedWalletVersion,
            'This wallet contract version is not supported by the safe swap path.',
            { walletVersion: input.type },
        );
    }

    let address: string;
    try {
        address = formatAddress(input.address);
    } catch (cause) {
        if (cause instanceof InvalidAddressError) {
            throw new SwapApplicationError(
                SwapApplicationErrorCode.InvalidWalletAddress,
                'The active wallet address is invalid.',
                {},
                cause,
            );
        }
        throw cause;
    }

    return Object.freeze({
        kind: 'standard',
        version: input.type as StandardWalletContractVersion,
        address,
    });
}

/** Build the immutable provider-neutral intent used by a later quote session. */
export function createSwapIntent(input: CreateSwapIntentInput): SwapIntent {
    assertNetwork(input.network);
    assertCorrelationId(input.correlationId);
    assertSlippage(input.slippageBps);

    const wallet = toWalletDescriptor(input.account);
    let ownerAddress: string;
    try {
        ownerAddress = formatAddress(input.ownerAddress);
    } catch (cause) {
        if (cause instanceof InvalidAddressError) {
            throw new SwapApplicationError(
                SwapApplicationErrorCode.InvalidWalletAddress,
                'The swap owner address is invalid.',
                {},
                cause,
            );
        }
        throw cause;
    }

    if (!isSameAddress(ownerAddress, wallet.address)) {
        throw new SwapApplicationError(
            SwapApplicationErrorCode.WalletAddressMismatch,
            'The selected wallet does not match the swap owner address.',
        );
    }

    const from = toFungibleAsset(input.from);
    const to = toFungibleAsset(input.to);
    if (isSameAsset(from, to)) {
        throw new SwapApplicationError(
            SwapApplicationErrorCode.IdenticalAssetPair,
            'Choose two different assets to swap between.',
        );
    }

    const offerUnits = parsePositiveOfferUnits(input.amount, from.decimals);
    return Object.freeze({
        network: input.network,
        ownerAddress,
        wallet,
        from,
        to,
        offerUnits,
        slippageBps: input.slippageBps,
        correlationId: input.correlationId,
    });
}

function assertAssetDecimals(decimals: number): void {
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > MAX_ASSET_DECIMALS) {
        throw new SwapApplicationError(
            SwapApplicationErrorCode.InvalidDecimals,
            'This asset reports an invalid decimal precision.',
            { decimals: String(decimals) },
        );
    }
}

function assertNetwork(network: NetworkId): void {
    if (network !== 'mainnet' && network !== 'testnet') {
        throw new SwapApplicationError(
            SwapApplicationErrorCode.InvalidNetwork,
            'An explicit supported TON network is required.',
        );
    }
}

function assertSlippage(slippageBps: number): void {
    if (
        !Number.isInteger(slippageBps)
        || slippageBps < MIN_SLIPPAGE_BPS
        || slippageBps > MAX_SLIPPAGE_BPS
    ) {
        throw new SwapApplicationError(
            SwapApplicationErrorCode.InvalidSlippage,
            'Slippage must be a whole number of basis points within the safe range.',
            { slippageBps: String(slippageBps) },
        );
    }
}

function assertCorrelationId(correlationId: string): void {
    if (
        !/^[A-Za-z0-9_-]+$/.test(correlationId)
        || correlationId.length > MAX_CORRELATION_ID_LENGTH
    ) {
        throw new SwapApplicationError(
            SwapApplicationErrorCode.InvalidCorrelationId,
            'The swap correlation identifier is invalid.',
        );
    }
}
