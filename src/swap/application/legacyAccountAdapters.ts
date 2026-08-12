import type {
    LegacyEncryptedMnemonic,
    PasswordConfirmedSwapAccount,
    SwapMnemonicDecryptor,
} from './PasswordConfirmedSwapExecutor';
import {
    SwapApplicationError,
    SwapApplicationErrorCode,
} from './errors';
import { toWalletDescriptor } from './legacyConversion';

const AES_GCM_IV_HEX_LENGTH = 24;
const AES_GCM_TAG_HEX_LENGTH = 32;
const ENCRYPTED_MNEMONIC_KEYS = Object.freeze(['data', 'iv']);

/** Minimum legacy service surface needed to retain AES-GCM account compatibility. */
export interface LegacySecurityDecryptor {
    decryptData(
        encryptedData: LegacyEncryptedMnemonic,
        password: string,
    ): Promise<unknown>;
}

/**
 * Decode an unsafe legacy account value into the exact Stage C account contract.
 *
 * Display fields and the legacy password hash are deliberately ignored. Wallet
 * kind and public address are validated before the ciphertext, so Highload V3
 * cannot reach decryption through this standard-wallet activation path.
 */
export function decodePasswordConfirmedSwapAccount(
    value: unknown,
): PasswordConfirmedSwapAccount {
    const account = requireRecord(value);
    const type = requireString(account['type']);
    const address = requireString(account['address']);
    const wallet = toWalletDescriptor({ type, address });
    const encryptedMnemonic = decodeEncryptedMnemonic(account['encryptedSeed']);

    return Object.freeze({
        address: wallet.address,
        wallet,
        encryptedMnemonic,
    });
}

/**
 * Narrow compatibility adapter over the existing `SecurityService.decryptData()`
 * implementation. It neither verifies `passwordHash` nor exposes any other
 * legacy security-service operation to the strict swap graph.
 */
export class LegacySecurityServiceSwapMnemonicDecryptor implements SwapMnemonicDecryptor {
    private readonly legacy: LegacySecurityDecryptor;

    public constructor(legacy: LegacySecurityDecryptor) {
        this.legacy = legacy;
    }

    public async decrypt(
        encryptedMnemonic: LegacyEncryptedMnemonic,
        password: string,
    ): Promise<string> {
        const ciphertext = decodeEncryptedMnemonic(encryptedMnemonic);
        const plaintext = await this.legacy.decryptData(ciphertext, password);
        if (typeof plaintext !== 'string') {
            throw new TypeError('The legacy wallet decryptor returned an invalid plaintext value.');
        }
        return plaintext;
    }
}

function decodeEncryptedMnemonic(value: unknown): LegacyEncryptedMnemonic {
    const encrypted = requireRecord(value);
    if (!hasExactKeys(encrypted, ENCRYPTED_MNEMONIC_KEYS)) {
        throw invalidEncryptedAccount();
    }

    const iv = canonicalHex(encrypted['iv'], AES_GCM_IV_HEX_LENGTH);
    const data = canonicalHex(encrypted['data']);
    if (data.length < AES_GCM_TAG_HEX_LENGTH) {
        throw invalidEncryptedAccount();
    }

    return Object.freeze({ iv, data });
}

function requireRecord(value: unknown): Readonly<Record<string, unknown>> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw invalidEncryptedAccount();
    }
    return value as Readonly<Record<string, unknown>>;
}

function requireString(value: unknown): string {
    if (typeof value !== 'string') {
        throw invalidEncryptedAccount();
    }
    return value;
}

function canonicalHex(value: unknown, exactLength?: number): string {
    if (
        typeof value !== 'string'
        || value.length === 0
        || value.length % 2 !== 0
        || (exactLength !== undefined && value.length !== exactLength)
        || !/^[0-9a-f]+$/iu.test(value)
    ) {
        throw invalidEncryptedAccount();
    }
    return value.toLowerCase();
}

function hasExactKeys(
    value: Readonly<Record<string, unknown>>,
    expected: readonly string[],
): boolean {
    const actual = Object.keys(value).sort();
    return actual.length === expected.length
        && actual.every((key, index) => key === expected[index]);
}

function invalidEncryptedAccount(): SwapApplicationError {
    return new SwapApplicationError(
        SwapApplicationErrorCode.EncryptedAccountInvalid,
        'The encrypted wallet record is malformed.',
    );
}
