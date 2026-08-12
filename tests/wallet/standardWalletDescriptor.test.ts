import { WalletContractV4, WalletContractV5R1 } from '@ton/ton';
import { keyPairFromSeed } from '@ton/crypto';
import { describe, expect, it } from 'vitest';

import { assertStandardWalletAuthority } from '../../src/wallet/OfficialStandardWalletSigner';
import { standardWalletDescriptorForVersion, walletDescriptorForAccountType } from '../../src/wallet/standardWalletDescriptor';

describe('standardWalletDescriptorForVersion', () => {
    it('matches v4r2 importWallet parameters', () => {
        const keyPair = keyPairFromSeed(Buffer.alloc(32, 4));
        const contract = WalletContractV4.create({
            publicKey: keyPair.publicKey,
            workchain: 0,
            walletId: 698983191,
        });
        const descriptor = standardWalletDescriptorForVersion('v4r2', contract.address.toString());

        expect(() => assertStandardWalletAuthority(descriptor, 'mainnet', {
            publicKey: keyPair.publicKey,
            sign: async () => Buffer.alloc(64),
        })).not.toThrow();

        keyPair.secretKey.fill(0);
    });

    it('matches v5r1 importWallet parameters without a v4 subwallet id', () => {
        const keyPair = keyPairFromSeed(Buffer.alloc(32, 5));
        const contract = WalletContractV5R1.create({
            publicKey: keyPair.publicKey,
            workchain: 0,
        });
        const descriptor = standardWalletDescriptorForVersion('v5r1', contract.address.toString());

        expect(descriptor.subwalletId).toBeUndefined();
        expect(() => assertStandardWalletAuthority(descriptor, 'mainnet', {
            publicKey: keyPair.publicKey,
            sign: async () => Buffer.alloc(64),
        })).not.toThrow();

        keyPair.secretKey.fill(0);
    });

    it('matches highload-v3 import defaults', () => {
        const descriptor = walletDescriptorForAccountType('highload-v3', '0:' + 'aa'.repeat(32));
        expect(descriptor).toEqual({
            kind: 'highload-v3',
            version: 'highload-v3',
            address: '0:' + 'aa'.repeat(32),
            subwalletId: 0x10ad,
            timeoutSeconds: 3600,
        });
    });
});
