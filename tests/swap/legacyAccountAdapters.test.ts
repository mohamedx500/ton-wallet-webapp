import { describe, expect, it, vi } from 'vitest';

import {
    LegacySecurityServiceSwapMnemonicDecryptor,
    SwapApplicationError,
    SwapApplicationErrorCode,
    decodePasswordConfirmedSwapAccount,
} from '../../src/swap/application';
import type {
    LegacyEncryptedMnemonic,
    LegacySecurityDecryptor,
} from '../../src/swap/application';
import { formatAddress } from '../../src/core/address';
import { SecurityService } from '../../src/services/SecurityService.js';
import { testAddress } from './fixtures';

const WALLET = testAddress('legacy-swap-account');
const ENCRYPTED = Object.freeze({
    iv: 'A1'.repeat(12),
    data: 'B2'.repeat(16),
});

function account(overrides: Readonly<Record<string, unknown>> = {}): unknown {
    return {
        id: 'legacy-account-id',
        name: 'Display-only wallet name',
        type: 'v4r2',
        encryptedSeed: ENCRYPTED,
        passwordHash: 'untrusted-display-boundary-value',
        address: WALLET,
        color: 'blue',
        ...overrides,
    };
}

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

describe('decodePasswordConfirmedSwapAccount', () => {
    it.each(['v3r1', 'v3r2', 'v4r2', 'v5r1'] as const)(
        'maps a valid legacy %s account to the frozen Stage C contract',
        (version) => {
            const decoded = decodePasswordConfirmedSwapAccount(account({ type: version }));

            expect(decoded).toEqual({
                address: formatAddress(WALLET),
                wallet: {
                    kind: 'standard',
                    version,
                    address: formatAddress(WALLET),
                },
                encryptedMnemonic: {
                    iv: ENCRYPTED.iv.toLowerCase(),
                    data: ENCRYPTED.data.toLowerCase(),
                },
            });
            expect(Object.isFrozen(decoded)).toBe(true);
            expect(Object.isFrozen(decoded.wallet)).toBe(true);
            expect(Object.isFrozen(decoded.encryptedMnemonic)).toBe(true);
        },
    );

    it('ignores display fields and passwordHash as sources of signing authority', () => {
        const first = decodePasswordConfirmedSwapAccount(account());
        const second = decodePasswordConfirmedSwapAccount(account({
            id: 123,
            name: { hostile: true },
            passwordHash: null,
            color: ['red'],
        }));

        expect(second).toEqual(first);
        expect(Object.keys(second)).toEqual(['address', 'wallet', 'encryptedMnemonic']);
    });


    it.each([
        null,
        undefined,
        [],
        'wallet',
        {},
        { type: 'v4r2', address: WALLET },
        { type: 4, address: WALLET, encryptedSeed: ENCRYPTED },
        { type: 'v4r2', address: 4, encryptedSeed: ENCRYPTED },
    ])('rejects malformed legacy account value %#', (value) => {
        expectApplicationError(
            () => decodePasswordConfirmedSwapAccount(value),
            SwapApplicationErrorCode.EncryptedAccountInvalid,
        );
    });

    it.each([
        null,
        [],
        {},
        { iv: '', data: ENCRYPTED.data },
        { iv: '0'.repeat(23), data: ENCRYPTED.data },
        { iv: '0'.repeat(26), data: ENCRYPTED.data },
        { iv: 'zz'.repeat(12), data: ENCRYPTED.data },
        { iv: ENCRYPTED.iv, data: '' },
        { iv: ENCRYPTED.iv, data: '0' },
        { iv: ENCRYPTED.iv, data: 'zz'.repeat(16) },
        { iv: ENCRYPTED.iv, data: '00'.repeat(15) },
        { iv: ENCRYPTED.iv, data: ENCRYPTED.data, extra: true },
    ])('rejects malformed or non-canonical AES-GCM record %#', (encryptedSeed) => {
        expectApplicationError(
            () => decodePasswordConfirmedSwapAccount(account({ encryptedSeed })),
            SwapApplicationErrorCode.EncryptedAccountInvalid,
        );
    });

    it('preserves exact wallet-version and address errors from the audited public converter', () => {
        expectApplicationError(
            () => decodePasswordConfirmedSwapAccount(account({ type: 'V4R2' })),
            SwapApplicationErrorCode.UnsupportedWalletVersion,
        );
        expectApplicationError(
            () => decodePasswordConfirmedSwapAccount(account({ address: 'invalid' })),
            SwapApplicationErrorCode.InvalidWalletAddress,
        );
    });
});

describe('LegacySecurityServiceSwapMnemonicDecryptor', () => {
    it('round-trips the active legacy SecurityService AES-GCM record', async () => {
        const password = 'legacy-compatible-password';
        const mnemonic = 'word '.repeat(24).trim();
        const legacy = new SecurityService();
        const encrypted = await legacy.encryptData(mnemonic, password) as LegacyEncryptedMnemonic;
        const accountValue = decodePasswordConfirmedSwapAccount(account({ encryptedSeed: encrypted }));
        const decryptor = new LegacySecurityServiceSwapMnemonicDecryptor(legacy);

        await expect(decryptor.decrypt(accountValue.encryptedMnemonic, password)).resolves.toBe(mnemonic);
        await expect(decryptor.decrypt(accountValue.encryptedMnemonic, 'wrong password')).rejects.toBeInstanceOf(Error);
    });

    it('delegates only the validated ciphertext and password to legacy decryptData', async () => {
        const decryptData = vi.fn(async () => 'word '.repeat(24).trim());
        const service: LegacySecurityDecryptor = { decryptData };
        const decryptor = new LegacySecurityServiceSwapMnemonicDecryptor(service);
        const ciphertext: LegacyEncryptedMnemonic = {
            iv: ENCRYPTED.iv,
            data: ENCRYPTED.data,
        };

        await expect(decryptor.decrypt(ciphertext, 'password')).resolves.toBe('word '.repeat(24).trim());
        expect(decryptData).toHaveBeenCalledOnce();
        expect(decryptData).toHaveBeenCalledWith(
            { iv: ENCRYPTED.iv.toLowerCase(), data: ENCRYPTED.data.toLowerCase() },
            'password',
        );
    });

    it('does not call legacy decryption for malformed ciphertext', async () => {
        const decryptData = vi.fn(async () => 'unused');
        const decryptor = new LegacySecurityServiceSwapMnemonicDecryptor({ decryptData });

        await expect(decryptor.decrypt({ iv: '', data: '00' }, 'password')).rejects.toMatchObject({
            code: SwapApplicationErrorCode.EncryptedAccountInvalid,
        });
        expect(decryptData).not.toHaveBeenCalled();
    });

    it('propagates legacy authentication failures for Stage C to classify', async () => {
        const failure = new DOMException('Authentication failed', 'OperationError');
        const decryptData = vi.fn(async () => Promise.reject(failure));
        const decryptor = new LegacySecurityServiceSwapMnemonicDecryptor({ decryptData });

        await expect(decryptor.decrypt(ENCRYPTED, 'wrong password')).rejects.toBe(failure);
        expect(decryptData).toHaveBeenCalledOnce();
    });

    it.each([null, undefined, 24, [], {}])(
        'rejects non-string plaintext %# from the unsafe legacy boundary',
        async (plaintext) => {
            const decryptData = vi.fn(async () => plaintext);
            const decryptor = new LegacySecurityServiceSwapMnemonicDecryptor({ decryptData });

            await expect(decryptor.decrypt(ENCRYPTED, 'password')).rejects.toBeInstanceOf(TypeError);
        },
    );
});
