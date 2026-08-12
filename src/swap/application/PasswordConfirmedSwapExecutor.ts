import type { Cell } from '@ton/core';
import { mnemonicToPrivateKey, mnemonicValidate, sign } from '@ton/crypto';

import type { NetworkId } from '../../core/chain';
import { isSameAddress } from '../../core/address';
import {
    WalletExecutionError,
} from '../../wallet';
import type {
    WalletDescriptor,
    WalletExecutionCoordinator,
} from '../../wallet';
import type {
    ExecuteSwapOptions,
    ExecuteSwapRequest,
    SwapExecutionResult,
} from '../SwapExecutionCoordinator';
import type { SwapOutcomeState } from '../types';
import {
    SwapApplicationError,
    SwapApplicationErrorCode,
} from './errors';
import type { SwapQuoteApproval } from './SwapQuoteSession';

const REQUIRED_MNEMONIC_WORDS = 24;

/** Legacy AES-GCM record accepted as opaque account ciphertext, without importing `WalletAccount`. */
export interface LegacyEncryptedMnemonic {
    readonly iv: string;
    readonly data: string;
}

/** Public account identity plus the minimum encrypted secret needed for one approval. */
export interface PasswordConfirmedSwapAccount {
    readonly address: string;
    readonly wallet: WalletDescriptor;
    readonly encryptedMnemonic: LegacyEncryptedMnemonic;
}

/** Authenticated decryption boundary compatible with the existing legacy AES-GCM account records. */
export interface SwapMnemonicDecryptor {
    decrypt(
        encryptedMnemonic: LegacyEncryptedMnemonic,
        password: string,
    ): Promise<string>;
}

import type { KeyPair } from '@ton/crypto';

/** Builds the audited network-bound wallet execution coordinator around one transient signer. */
export interface WalletCoordinatorFactory {
    readonly network: NetworkId;
    create(keyPair: KeyPair, wallet: WalletDescriptor): WalletExecutionCoordinator;
}

/** Narrow execution dependency implemented by the audited `SwapExecutionCoordinator`. */
export interface ApprovedSwapCoordinator {
    readonly network: NetworkId;
    execute(
        request: ExecuteSwapRequest,
        options?: ExecuteSwapOptions,
    ): Promise<SwapExecutionResult>;
}

/** Builds a swap coordinator around the short-lived wallet coordinator for this approval only. */
export interface ApprovedSwapCoordinatorFactory {
    readonly network: NetworkId;
    create(wallet: WalletExecutionCoordinator): ApprovedSwapCoordinator;
}

export interface PasswordConfirmedSwapExecutorOptions {
    readonly network: NetworkId;
    readonly decryptor: SwapMnemonicDecryptor;
    readonly walletCoordinatorFactory: WalletCoordinatorFactory;
    readonly swapCoordinatorFactory: ApprovedSwapCoordinatorFactory;
    /** Injected Unix clock passed to the official signer. */
    readonly signerClock: () => number;
}

export interface ExecutePasswordConfirmedSwapRequest {
    readonly approval: SwapQuoteApproval;
    readonly account: PasswordConfirmedSwapAccount;
    readonly password: string;
}

/** Secret-free application projection. Payload cells and signed envelopes remain internal. */
export interface PasswordConfirmedSwapResult {
    readonly state: SwapOutcomeState;
    readonly network: NetworkId;
    readonly providerId: string;
    readonly walletAddress: string;
    readonly walletVersion: WalletDescriptor['version'];
    readonly correlationId: string;
    readonly submissionId: string;
    readonly walletConfirmationState: SwapExecutionResult['wallet']['confirmation']['state'];
    readonly dexExitCode: string | null;
    readonly txHash: string | null;
    readonly receivedUnits: bigint | null;
    readonly explorerUrl: string | null;
}

/**
 * Inactive password-confirmed swap boundary.
 *
 * Password, decrypted words, key material, signer, payload cells, signatures and
 * signed envelopes are scoped to `execute()` and are never returned or persisted
 * here. Authenticated decryption is the password check. Cancellation and every
 * public coherence check run before decryption or wallet replay acquisition.
 */
export class PasswordConfirmedSwapExecutor {
    public readonly network: NetworkId;
    private readonly decryptor: SwapMnemonicDecryptor;
    private readonly walletCoordinatorFactory: WalletCoordinatorFactory;
    private readonly swapCoordinatorFactory: ApprovedSwapCoordinatorFactory;
    private readonly signerClock: () => number;

    public constructor(options: PasswordConfirmedSwapExecutorOptions) {
        this.network = options.network;
        this.decryptor = options.decryptor;
        this.walletCoordinatorFactory = options.walletCoordinatorFactory;
        this.swapCoordinatorFactory = options.swapCoordinatorFactory;
        this.signerClock = options.signerClock;

        if (
            options.walletCoordinatorFactory.network !== this.network
            || options.swapCoordinatorFactory.network !== this.network
        ) {
            throw new SwapApplicationError(
                SwapApplicationErrorCode.ExecutionNetworkMismatch,
                'Password-confirmed swap components must use the same TON network.',
            );
        }
    }

    public async execute(
        request: ExecutePasswordConfirmedSwapRequest,
        options: ExecuteSwapOptions = {},
    ): Promise<PasswordConfirmedSwapResult> {
        assertNotCancelled(options);
        assertPassword(request.password);
        assertRequestCoherence(request, this.network);

        const mnemonicText = await this.decryptMnemonic(request.account.encryptedMnemonic, request.password);
        const mnemonic = normalizeMnemonic(mnemonicText);
        await assertMnemonic(mnemonic);
        assertNotCancelled(options);

        const keyPair = await mnemonicToPrivateKey([...mnemonic]);
        try {
            const walletCoordinator = this.walletCoordinatorFactory.create(keyPair, request.approval.intent.wallet);
            if (walletCoordinator.network !== this.network) {
                throw new SwapApplicationError(
                    SwapApplicationErrorCode.ExecutionNetworkMismatch,
                    'The wallet execution coordinator belongs to a different TON network.',
                );
            }
            const coordinator = this.swapCoordinatorFactory.create(walletCoordinator);
            if (coordinator.network !== this.network) {
                throw new SwapApplicationError(
                    SwapApplicationErrorCode.ExecutionNetworkMismatch,
                    'The swap execution coordinator belongs to a different TON network.',
                );
            }

            const result = await coordinator.execute(
                Object.freeze({
                    quote: request.approval.quote,
                    wallet: request.approval.intent.wallet,
                    correlationId: request.approval.intent.correlationId,
                }),
                options,
            );
            return toSafeResult(result, request.approval, this.network);
        } finally {
            keyPair.secretKey.fill(0);
        }
    }

    private async decryptMnemonic(
        encryptedMnemonic: LegacyEncryptedMnemonic,
        password: string,
    ): Promise<string> {
        assertEncryptedMnemonic(encryptedMnemonic);
        try {
            return await this.decryptor.decrypt(encryptedMnemonic, password);
        } catch (cause) {
            throw new SwapApplicationError(
                SwapApplicationErrorCode.DecryptionFailed,
                'The wallet could not be unlocked with the supplied password.',
                {},
                cause,
            );
        }
    }
}

function assertPassword(password: string): void {
    if (password.trim().length === 0) {
        throw new SwapApplicationError(
            SwapApplicationErrorCode.PasswordRequired,
            'Enter the wallet password before approving this swap.',
        );
    }
}

function assertRequestCoherence(
    request: ExecutePasswordConfirmedSwapRequest,
    network: NetworkId,
): void {
    const { approval, account } = request;
    if (approval.intent.network !== network) {
        throw new SwapApplicationError(
            SwapApplicationErrorCode.ExecutionNetworkMismatch,
            'The approved swap belongs to a different TON network.',
        );
    }
    if (
        approval.request.from !== approval.intent.from
        || approval.request.to !== approval.intent.to
        || approval.request.offerUnits !== approval.intent.offerUnits
        || approval.request.slippageBps !== approval.intent.slippageBps
        || !isSameAddress(approval.request.walletAddress, approval.intent.ownerAddress)
        || approval.quote.from !== approval.intent.from
        || approval.quote.to !== approval.intent.to
        || approval.quote.offerUnits !== approval.intent.offerUnits
        || approval.quote.slippageBps !== approval.intent.slippageBps
    ) {
        throw new SwapApplicationError(
            SwapApplicationErrorCode.ApprovalMismatch,
            'The approved quote no longer matches the exact swap intent.',
        );
    }
    if (
        (account.wallet.kind !== 'standard' && account.wallet.kind !== 'highload-v3')
        || account.wallet.kind !== approval.intent.wallet.kind
        || account.wallet.version !== approval.intent.wallet.version
        || ('subwalletId' in account.wallet && 'subwalletId' in approval.intent.wallet && account.wallet.subwalletId !== approval.intent.wallet.subwalletId)
        || !isSameAddress(account.address, approval.intent.ownerAddress)
        || !isSameAddress(account.wallet.address, approval.intent.ownerAddress)
        || account.wallet !== approval.intent.wallet
    ) {
        throw new SwapApplicationError(
            SwapApplicationErrorCode.EncryptedAccountMismatch,
            'The encrypted account does not match the wallet that approved this swap.',
        );
    }
}

function assertEncryptedMnemonic(value: LegacyEncryptedMnemonic): void {
    if (!isHex(value.iv, 24) || !isHex(value.data)) {
        throw new SwapApplicationError(
            SwapApplicationErrorCode.EncryptedAccountInvalid,
            'The encrypted wallet record is malformed.',
        );
    }
}

function isHex(value: string, exactLength?: number): boolean {
    return (
        (exactLength === undefined || value.length === exactLength)
        && value.length > 0
        && value.length % 2 === 0
        && /^[0-9a-f]+$/i.test(value)
    );
}

function normalizeMnemonic(value: string): readonly string[] {
    return Object.freeze(
        value
            .split(/\s+/u)
            .map((word) => word
                .normalize('NFKD')
                .toLowerCase()
                .replace(/[\u200B-\u200D\uFEFF]/gu, '')
                .trim())
            .filter((word) => word.length > 0),
    );
}

async function assertMnemonic(mnemonic: readonly string[]): Promise<void> {
    if (mnemonic.length !== REQUIRED_MNEMONIC_WORDS) {
        throw new SwapApplicationError(
            SwapApplicationErrorCode.InvalidMnemonic,
            'The decrypted wallet mnemonic must contain exactly 24 words.',
        );
    }
    try {
        if (!await mnemonicValidate([...mnemonic])) {
            throw new SwapApplicationError(
                SwapApplicationErrorCode.InvalidMnemonic,
                'The decrypted wallet mnemonic is invalid.',
            );
        }
    } catch (cause) {
        if (cause instanceof SwapApplicationError) throw cause;
        throw new SwapApplicationError(
            SwapApplicationErrorCode.InvalidMnemonic,
            'The decrypted wallet mnemonic is invalid.',
            {},
            cause,
        );
    }
}

function assertNotCancelled(options: ExecuteSwapOptions): void {
    const signals = [options.wallet?.confirmation?.signal, options.outcome?.signal];
    const aborted = signals.find((signal) => signal?.aborted === true);
    if (aborted !== undefined) {
        throw new WalletExecutionError(
            'CONFIRMATION_CANCELLED',
            'The password-confirmed swap was cancelled before signing.',
        );
    }
}

function toSafeResult(
    result: SwapExecutionResult,
    approval: SwapQuoteApproval,
    network: NetworkId,
): PasswordConfirmedSwapResult {
    const txHash = result.outcome?.txHash ?? result.wallet.confirmation.txHash;
    return Object.freeze({
        state: result.state,
        network,
        providerId: approval.quote.providerId,
        walletAddress: approval.intent.wallet.address,
        walletVersion: approval.intent.wallet.version,
        correlationId: approval.intent.correlationId,
        submissionId: result.wallet.reference.submissionId,
        walletConfirmationState: result.wallet.confirmation.state,
        dexExitCode: result.outcome?.exitCode ?? null,
        txHash,
        receivedUnits: result.outcome?.receivedUnits ?? null,
        explorerUrl: result.outcome?.explorerUrl ?? null,
    });
}
