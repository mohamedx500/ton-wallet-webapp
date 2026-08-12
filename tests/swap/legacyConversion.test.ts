import { describe, expect, it } from 'vitest';

import { TON_ASSET, assetKey } from '../../src/assets/fungible';
import { addressKey, formatAddress } from '../../src/core/address';
import {
    SwapApplicationError,
    SwapApplicationErrorCode,
    createSwapIntent,
    parsePositiveOfferUnits,
    toFungibleAsset,
    toWalletDescriptor,
} from '../../src/swap/application';
import type {
    CreateSwapIntentInput,
    LegacySwapAssetInput,
} from '../../src/swap/application';
import { testAddress } from './fixtures';

const WALLET = testAddress('stage-a-wallet');
const OTHER_WALLET = testAddress('stage-a-other-wallet');
const USDT_MASTER = testAddress('stage-a-usdt-master');
const OTHER_MASTER = testAddress('stage-a-other-master');

const NATIVE: LegacySwapAssetInput = Object.freeze({
    contractAddress: 'native',
    symbol: 'Gram',
    name: 'Gram',
    decimals: 9,
});

const USDT: LegacySwapAssetInput = Object.freeze({
    contractAddress: USDT_MASTER,
    symbol: 'USD₮',
    name: 'Tether USD',
    decimals: 6,
    trust: 'verified',
});

const OTHER: LegacySwapAssetInput = Object.freeze({
    contractAddress: OTHER_MASTER,
    symbol: 'OTHER',
    name: 'Other Token',
    decimals: 9,
});

const BASE_INTENT: CreateSwapIntentInput = Object.freeze({
    network: 'mainnet',
    ownerAddress: WALLET,
    account: Object.freeze({ type: 'v4r2', address: WALLET }),
    from: USDT,
    to: NATIVE,
    amount: '0.2',
    slippageBps: 100,
    correlationId: 'swap_stage_a_1',
});

function expectApplicationError(run: () => unknown, code: string): SwapApplicationError {
    let thrown: unknown;
    try {
        run();
    } catch (error) {
        thrown = error;
    }
    expect(thrown).toBeInstanceOf(SwapApplicationError);
    const applicationError = thrown as SwapApplicationError;
    expect(applicationError.code).toBe(code);
    return applicationError;
}

describe('toFungibleAsset', () => {
    it('maps only the explicit native sentinel to canonical TON', () => {
        expect(toFungibleAsset(NATIVE)).toBe(TON_ASSET);
        expect(toFungibleAsset({ ...NATIVE, symbol: 'Anything' })).toBe(TON_ASSET);
    });

    it('does not use TON-like display metadata as protocol identity', () => {
        const asset = toFungibleAsset({
            ...OTHER,
            symbol: 'TON',
            name: 'Toncoin',
        });
        expect(asset.kind).toBe('jetton');
        expect(assetKey(asset)).toBe(`jetton:${addressKey(OTHER_MASTER)}`);
    });

    it('treats USDT aliases as display-only metadata', () => {
        const first = toFungibleAsset({ ...USDT, symbol: 'USDT' });
        const second = toFungibleAsset({ ...USDT, symbol: 'USD₮' });
        expect(assetKey(first)).toBe(assetKey(second));
        expect(first.symbol).toBe('USDT');
        expect(second.symbol).toBe('USD₮');
    });

    it('canonicalizes Jetton masters and sanitizes metadata', () => {
        const asset = toFungibleAsset({
            ...USDT,
            contractAddress: `  ${USDT_MASTER}  `,
            symbol: 'USD\u202eT\n',
            name: '  Tether\n USD  ',
        });
        expect(asset.kind).toBe('jetton');
        if (asset.kind === 'jetton') {
            expect(asset.master).toBe(formatAddress(USDT_MASTER));
        }
        expect(asset.symbol).toBe('USDT');
        expect(asset.name).toBe('Tether USD');
        expect(Object.isFrozen(asset)).toBe(true);
    });

    it.each(['', ' ', 'not-an-address', 'Native'])('rejects invalid non-native identity %j', (contractAddress) => {
        expectApplicationError(
            () => toFungibleAsset({ ...USDT, contractAddress }),
            SwapApplicationErrorCode.InvalidAssetIdentity,
        );
    });

    it.each([-1, 31, 6.5, Number.NaN])('rejects invalid Jetton decimals %s', (decimals) => {
        expectApplicationError(
            () => toFungibleAsset({ ...USDT, decimals }),
            SwapApplicationErrorCode.InvalidDecimals,
        );
    });

    it('rejects native metadata that contradicts TON protocol precision', () => {
        expectApplicationError(
            () => toFungibleAsset({ ...NATIVE, decimals: 6 }),
            SwapApplicationErrorCode.InvalidDecimals,
        );
    });
});

describe('parsePositiveOfferUnits', () => {
    it('converts exact TON and Jetton decimal strings to bigint', () => {
        expect(parsePositiveOfferUnits('1.5', 9)).toBe(1_500_000_000n);
        expect(parsePositiveOfferUnits('0.2', 6)).toBe(200_000n);
    });

    it('preserves the confirmed UI-friendly decimal grammar', () => {
        expect(parsePositiveOfferUnits('.5', 9)).toBe(500_000_000n);
        expect(parsePositiveOfferUnits('12.', 6)).toBe(12_000_000n);
    });

    it('accepts only insignificant extra trailing-zero precision', () => {
        expect(parsePositiveOfferUnits('1.2300', 2)).toBe(123n);
        expectApplicationError(
            () => parsePositiveOfferUnits('1.2301', 2),
            SwapApplicationErrorCode.InvalidAmount,
        );
    });

    it.each(['', '0', '0.000000', '-1', '+1', '1e3', '1..2', '.'])('rejects unsafe amount %j', (value) => {
        expectApplicationError(
            () => parsePositiveOfferUnits(value, 6),
            SwapApplicationErrorCode.InvalidAmount,
        );
    });
});

describe('toWalletDescriptor', () => {
    it.each(['v3r1', 'v3r2', 'v4r2', 'v5r1'] as const)('maps %s exactly', (version) => {
        const descriptor = toWalletDescriptor({ type: version, address: WALLET });
        expect(descriptor).toEqual({
            kind: 'standard',
            version,
            address: WALLET,
        });
    });

    it('maps highload-v3 exactly', () => {
        const descriptor = toWalletDescriptor({ type: 'highload-v3', address: WALLET });
        expect(descriptor).toEqual({
            kind: 'highload-v3',
            version: 'highload-v3',
            address: WALLET,
            subwalletId: 0x10ad,
            timeoutSeconds: 3600,
        });
    });

    it.each(['', 'V4R2', 'unknown', 'v4'])('rejects unknown versions instead of falling back', (type) => {
        expectApplicationError(
            () => toWalletDescriptor({ type, address: WALLET }),
            SwapApplicationErrorCode.UnsupportedWalletVersion,
        );
    });

    it('rejects an invalid wallet address', () => {
        expectApplicationError(
            () => toWalletDescriptor({ type: 'v4r2', address: 'invalid' }),
            SwapApplicationErrorCode.InvalidWalletAddress,
        );
    });
});

describe('createSwapIntent', () => {
    it.each(['mainnet', 'testnet'] as const)('preserves explicit %s binding and exact units', (network) => {
        const intent = createSwapIntent({ ...BASE_INTENT, network });
        expect(intent.network).toBe(network);
        expect(intent.ownerAddress).toBe(formatAddress(WALLET));
        expect(intent.offerUnits).toBe(200_000n);
        expect(intent.wallet.version).toBe('v4r2');
        expect(Object.isFrozen(intent)).toBe(true);
        expect(Object.isFrozen(intent.wallet)).toBe(true);
    });

    it('rejects unsupported runtime network values', () => {
        expectApplicationError(
            () => createSwapIntent({ ...BASE_INTENT, network: 'devnet' as 'mainnet' }),
            SwapApplicationErrorCode.InvalidNetwork,
        );
    });

    it('rejects a wallet/owner mismatch', () => {
        expectApplicationError(
            () => createSwapIntent({
                ...BASE_INTENT,
                account: { type: 'v4r2', address: OTHER_WALLET },
            }),
            SwapApplicationErrorCode.WalletAddressMismatch,
        );
    });

    it('rejects identical native and canonically identical Jetton pairs', () => {
        expectApplicationError(
            () => createSwapIntent({ ...BASE_INTENT, from: NATIVE, to: { ...NATIVE, symbol: 'TON' } }),
            SwapApplicationErrorCode.IdenticalAssetPair,
        );
        expectApplicationError(
            () => createSwapIntent({ ...BASE_INTENT, from: USDT, to: { ...USDT, symbol: 'USDT' } }),
            SwapApplicationErrorCode.IdenticalAssetPair,
        );
    });

    it.each([0, 9, 2_001, 50.5, Number.NaN])('rejects unsafe slippage %s', (slippageBps) => {
        expectApplicationError(
            () => createSwapIntent({ ...BASE_INTENT, slippageBps }),
            SwapApplicationErrorCode.InvalidSlippage,
        );
    });

    it.each(['', 'has space', 'slash/value', 'a'.repeat(129)])('rejects unsafe correlation id %j', (correlationId) => {
        expectApplicationError(
            () => createSwapIntent({ ...BASE_INTENT, correlationId }),
            SwapApplicationErrorCode.InvalidCorrelationId,
        );
    });

    it('returns no secret or transaction-artifact fields', () => {
        const intent = createSwapIntent(BASE_INTENT);
        const fieldNames = [
            ...Object.keys(intent),
            ...Object.keys(intent.wallet),
            ...Object.keys(intent.from),
            ...Object.keys(intent.to),
        ].join(' ');
        expect(fieldNames).not.toMatch(
            /mnemonic|seed|privateKey|secretKey|password|signer|signed|signature|boc|cell|payload|providerData|rawData/i,
        );
    });
});
