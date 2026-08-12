import { beginCell, storeStateInit } from '@ton/core';
import { WalletContractV3R1, WalletContractV3R2, WalletContractV4, WalletContractV5R1 } from '@ton/ton';

import type { NetworkId } from '../../core/chain';
import { highloadTonConnectAddressPayload } from '../../wallet/highloadWalletContract';
import type { HighloadWalletDescriptor, StandardWalletDescriptor, WalletDescriptor } from '../../wallet/types';import { TonConnectWalletError } from './errors';
import { toTonConnectNetworkId } from './network';
import type { TonProofResult } from './types';

const WORKCHAIN = 0;
const MAINNET_GLOBAL_ID = -239;
const TESTNET_GLOBAL_ID = -3;
const DEFAULT_STANDARD_WALLET_ID = 698983191;
const DEFAULT_V5_SUBWALLET_NUMBER = 0;

export interface TonConnectDeviceInfo {
    readonly platform: 'browser';
    readonly appName: string;
    readonly appVersion: string;
    readonly maxProtocolVersion: 2;
    readonly features: readonly Readonly<{ readonly name: 'SendTransaction'; readonly maxMessages: 4 }>[];
}

export interface TonConnectConnectPayload {
    readonly items: readonly Record<string, unknown>[];
    readonly device: TonConnectDeviceInfo;
}

export function buildTonConnectDeviceInfo(): TonConnectDeviceInfo {
    return Object.freeze({
        platform: 'browser',
        appName: 'TON Wallet',
        appVersion: '2.0.0',
        maxProtocolVersion: 2,
        features: Object.freeze([
            Object.freeze({ name: 'SendTransaction', maxMessages: 4 as const }),
        ]),
    });
}

export function buildTonConnectConnectPayload(
    walletDescriptor: WalletDescriptor,
    network: NetworkId,
    publicKey: Buffer,
    proof?: TonProofResult,
): TonConnectConnectPayload {
    const tonAddr = walletDescriptor.kind === 'highload-v3'
        ? highloadTonConnectAddressPayload(walletDescriptor, publicKey)
        : buildStandardTonConnectAddress(walletDescriptor, network, publicKey);

    const items: Record<string, unknown>[] = [
        {
            name: 'ton_addr',
            address: tonAddr.address,
            network: toTonConnectNetworkId(network),
            publicKey: publicKey.toString('hex'),
            walletStateInit: tonAddr.walletStateInit,
        },
    ];

    if (proof) {
        items.push({ name: 'ton_proof', proof: proof.proof });
    }

    return Object.freeze({
        items: Object.freeze(items),
        device: buildTonConnectDeviceInfo(),
    });
}

function buildStandardTonConnectAddress(
    walletDescriptor: StandardWalletDescriptor,
    network: NetworkId,
    publicKey: Buffer,
): { readonly address: string; readonly walletStateInit: string } {
    const contract = createStandardWalletContract(walletDescriptor, network, publicKey);
    const walletStateInit = beginCell()
        .store(storeStateInit(contract.init))
        .endCell()
        .toBoc()
        .toString('base64');
    return Object.freeze({
        address: contract.address.toRawString(),
        walletStateInit,
    });
}

type StandardWalletContract =
    | WalletContractV3R1
    | WalletContractV3R2
    | WalletContractV4
    | WalletContractV5R1;

function createStandardWalletContract(
    wallet: StandardWalletDescriptor,
    network: NetworkId,
    publicKey: Buffer,
): StandardWalletContract {
    switch (wallet.version) {
        case 'v3r1':
            return WalletContractV3R1.create({
                publicKey,
                workchain: WORKCHAIN,
                walletId: wallet.subwalletId ?? DEFAULT_STANDARD_WALLET_ID,
            });
        case 'v3r2':
            return WalletContractV3R2.create({
                publicKey,
                workchain: WORKCHAIN,
                walletId: wallet.subwalletId ?? DEFAULT_STANDARD_WALLET_ID,
            });
        case 'v4r2':
            return WalletContractV4.create({
                publicKey,
                workchain: WORKCHAIN,
                walletId: wallet.subwalletId ?? DEFAULT_STANDARD_WALLET_ID,
            });
        case 'v5r1':
            return WalletContractV5R1.create({
                publicKey,
                walletId: {
                    networkGlobalId: network === 'mainnet' ? MAINNET_GLOBAL_ID : TESTNET_GLOBAL_ID,
                    context: {
                        walletVersion: 'v5r1',
                        workchain: WORKCHAIN,
                        subwalletNumber: wallet.subwalletId ?? DEFAULT_V5_SUBWALLET_NUMBER,
                    },
                },
            });
        default:
            throw new TonConnectWalletError(
                'INVALID_SESSION',
                `Unsupported wallet version for TON Connect: ${String(wallet.version)}.`,
            );
    }
}
