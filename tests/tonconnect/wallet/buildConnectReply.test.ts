import { Address } from '@ton/core';
import { keyPairFromSeed } from '@ton/crypto';
import { describe, expect, it } from 'vitest';

import {
    buildTonConnectConnectPayload,
    buildTonConnectDeviceInfo,
} from '../../../src/tonconnect/wallet/buildConnectReply';
import { createHighloadWalletContract } from '../../../src/wallet/highloadWalletContract';

describe('buildTonConnectConnectPayload', () => {
    it('builds a spec-compliant ton_addr reply with device info', () => {
        const keyPair = keyPairFromSeed(Buffer.alloc(32, 9));
        const wallet = {
            kind: 'standard' as const,
            version: 'v4r2' as const,
            address: 'unused',
            subwalletId: 698983191,
        };

        const payload = buildTonConnectConnectPayload(wallet, 'mainnet', keyPair.publicKey);

        expect(payload.device).toEqual(buildTonConnectDeviceInfo());
        expect(payload.items).toHaveLength(1);

        const tonAddr = payload.items[0] as Record<string, string>;
        expect(tonAddr.name).toBe('ton_addr');
        expect(tonAddr.network).toBe('-239');
        expect(tonAddr.publicKey).toBe(keyPair.publicKey.toString('hex'));
        expect(tonAddr.walletStateInit.length).toBeGreaterThan(0);

        const contract = Address.parse(tonAddr.address);
        expect(contract.toRawString()).toBe(tonAddr.address);

        keyPair.secretKey.fill(0);
    });

    it('includes ton_proof when provided', () => {
        const keyPair = keyPairFromSeed(Buffer.alloc(32, 3));
        const wallet = {
            kind: 'standard' as const,
            version: 'v4r2' as const,
            address: 'unused',
            subwalletId: 698983191,
        };
        const proof = {
            name: 'ton_proof' as const,
            proof: {
                timestamp: 1_800_000_000,
                domain: { lengthBytes: 12, value: 'fragment.com' },
                signature: 'abc',
                payload: 'nonce',
            },
        };

        const payload = buildTonConnectConnectPayload(wallet, 'mainnet', keyPair.publicKey, proof);

        expect(payload.items).toHaveLength(2);
        expect(payload.items[1]).toEqual({ name: 'ton_proof', proof: proof.proof });

        keyPair.secretKey.fill(0);
    });

    it('builds ton_addr for highload-v3 wallets', () => {
        const keyPair = keyPairFromSeed(Buffer.alloc(32, 8));
        const contract = createHighloadWalletContract(
            {
                kind: 'highload-v3',
                version: 'highload-v3',
                address: 'unused',
                subwalletId: 0x10ad,
                timeoutSeconds: 3600,
            },
            keyPair.publicKey,
        );
        const wallet = {
            kind: 'highload-v3' as const,
            version: 'highload-v3' as const,
            address: contract.address.toString(),
            subwalletId: 0x10ad,
            timeoutSeconds: 3600,
        };

        const payload = buildTonConnectConnectPayload(wallet, 'mainnet', keyPair.publicKey);

        expect(payload.items).toHaveLength(1);
        const tonAddr = payload.items[0] as Record<string, string>;
        expect(tonAddr.name).toBe('ton_addr');
        expect(tonAddr.address).toBe(contract.address.toRawString());
        expect(tonAddr.walletStateInit.length).toBeGreaterThan(0);

        keyPair.secretKey.fill(0);
    });
});
