import { Cell, loadMessage } from '@ton/core';
import { mnemonicToPrivateKey, mnemonicValidate, sign } from '@ton/crypto';

import { isSameAddress } from '../core/address';
import type { NetworkId } from '../core/chain';
import {
    OfficialStandardWalletSigner,
    WalletExecutionError,
    assertStandardWalletAuthority,
} from '../wallet';
import type {
    ConfirmationOptions,
    TransientExternalMessageCapture,
    WalletDescriptor,
    WalletExecutionCoordinator,
    WalletExecutionOptions,
    WalletExecutionRequest,
    WalletExecutionResult,
} from '../wallet';
import type { KeyPair } from '@ton/crypto';
import { TonConnectWalletError } from './wallet/errors';

const REQUIRED_MNEMONIC_WORDS = 24;

export interface TonConnectEncryptedMnemonic {
    readonly iv: string;
    readonly data: string;
}

export interface TonConnectMnemonicDecryptor {
    decrypt(
        encryptedMnemonic: TonConnectEncryptedMnemonic,
        password: string,
    ): Promise<string>;
}

export interface PasswordConfirmedTransactionAccount {
    readonly address: string;
    readonly wallet: WalletDescriptor;
    readonly encryptedMnemonic: TonConnectEncryptedMnemonic;
}

export interface TonConnectWalletCoordinatorFactory {
    readonly network: NetworkId;
    create(keyPair: KeyPair, wallet: WalletDescriptor): WalletExecutionCoordinator;
}

export interface PasswordConfirmedTransactionExecutorOptions {
    readonly network: NetworkId;
    readonly decryptor: TonConnectMnemonicDecryptor;
    readonly walletCoordinatorFactory: TonConnectWalletCoordinatorFactory;
    readonly signerClock: () => number;
}

export interface ExecutePasswordConfirmedTransactionRequest {
    readonly transaction: WalletExecutionRequest;
    readonly account: PasswordConfirmedTransactionAccount;
    readonly password: string;
    readonly confirmation?: ConfirmationOptions;
}

/** Metadata-only execution result for non-protocol callers. */
export interface PasswordConfirmedTransactionResult {
    readonly network: NetworkId;
    readonly walletAddress: string;
    readonly walletVersion: WalletDescriptor['version'];
    readonly correlationId: string;
    readonly submissionId: string;
    readonly confirmationState: WalletExecutionResult['confirmation']['state'];
    readonly txHash: string | null;
    readonly exitCode: string | null;
}

/** Immediate TON Connect protocol result. Never persist, diagnose, or place in React state. */
export interface PasswordConfirmedTonConnectTransactionResult
    extends PasswordConfirmedTransactionResult {
    readonly externalMessageBoc: string;
}

/** Inactive non-React password-confirmed execution boundary for approved raw TON Connect requests. */
export class PasswordConfirmedTransactionExecutor {
    public readonly network: NetworkId;
    private readonly decryptor: TonConnectMnemonicDecryptor;
    private readonly walletCoordinatorFactory: TonConnectWalletCoordinatorFactory;
    private readonly signerClock: () => number;

    public constructor(options: PasswordConfirmedTransactionExecutorOptions) {
        this.network = options.network;
        this.decryptor = options.decryptor;
        this.walletCoordinatorFactory = options.walletCoordinatorFactory;
        this.signerClock = options.signerClock;
        if (options.walletCoordinatorFactory.network !== this.network) {
            throw executionFailure('The TON Connect execution components belong to different TON networks.');
        }
    }

    public execute(
        request: ExecutePasswordConfirmedTransactionRequest,
    ): Promise<PasswordConfirmedTransactionResult> {
        return this.executeInternal(request, {});
    }

    public async executeForTonConnect(
        request: ExecutePasswordConfirmedTransactionRequest,
    ): Promise<PasswordConfirmedTonConnectTransactionResult> {
        let capturedBoc: string | null = null;
        const transientCapture: TransientExternalMessageCapture = Object.freeze({
            capture(base64Boc: string): void {
                if (capturedBoc !== null) {
                    throw executionFailure('The external message was captured more than once.');
                }
                assertCanonicalBase64(base64Boc);
                capturedBoc = base64Boc;
            },
        });
        const result = await this.executeInternal(request, { transientCapture });
        if (capturedBoc === null) {
            throw executionFailure('The submitted external message was not captured for the TON Connect response.');
        }
        return Object.freeze({
            ...result,
            externalMessageBoc: capturedBoc,
        });
    }

    private async executeInternal(
        request: ExecutePasswordConfirmedTransactionRequest,
        options: Pick<WalletExecutionOptions, 'transientCapture'>,
    ): Promise<PasswordConfirmedTransactionResult> {
        assertPassword(request.password);
        assertRequestCoherence(request, this.network);
        assertNotCancelled(request.confirmation?.signal);

        const mnemonicText = await this.decryptMnemonic(request.account.encryptedMnemonic, request.password);
        const mnemonic = normalizeMnemonic(mnemonicText);
        await assertMnemonic(mnemonic);
        assertNotCancelled(request.confirmation?.signal);

        const wallet = request.transaction.wallet;
        const keyPair = await mnemonicToPrivateKey([...mnemonic]);
        try {
            const coordinator = this.walletCoordinatorFactory.create(keyPair, wallet);
            if (coordinator.network !== this.network) {
                throw executionFailure('The TON Connect wallet coordinator belongs to a different TON network.');
            }
            const executionOptions: WalletExecutionOptions = Object.freeze({
                ...(request.confirmation === undefined ? {} : { confirmation: request.confirmation }),
                ...(options.transientCapture === undefined
                    ? {}
                    : { transientCapture: options.transientCapture }),
            });
            const result = await coordinator.execute(request.transaction, executionOptions);
            return toSafeResult(result, request.transaction);
        } finally {
            keyPair.secretKey.fill(0);
        }
    }

    private async decryptMnemonic(
        encryptedMnemonic: TonConnectEncryptedMnemonic,
        password: string,
    ): Promise<string> {
        assertEncryptedMnemonic(encryptedMnemonic);
        try {
            return await this.decryptor.decrypt(encryptedMnemonic, password);
        } catch (cause) {
            throw new TonConnectWalletError(
                'TRANSACTION_EXECUTION_FAILED',
                'The wallet could not be unlocked with the supplied password.',
                {},
                { cause },
            );
        }
    }
}

function assertRequestCoherence(
    request: ExecutePasswordConfirmedTransactionRequest,
    network: NetworkId,
): void {
    const { account, transaction } = request;
    if (transaction.network !== network) {
        throw executionFailure('The approved TON Connect transaction belongs to a different TON network.');
    }
    if (
        transaction.wallet.kind !== 'standard'
        || account.wallet.kind !== 'standard'
        || account.wallet !== transaction.wallet
        || !isSameAddress(account.address, transaction.wallet.address)
        || !isSameAddress(account.wallet.address, transaction.wallet.address)
    ) {
        throw executionFailure('The encrypted account does not match the wallet that approved this transaction.');
    }
}

function assertPassword(password: string): void {
    if (password.trim().length === 0) {
        throw executionFailure('Enter the wallet password before approving this TON Connect transaction.');
    }
}

function assertEncryptedMnemonic(value: TonConnectEncryptedMnemonic): void {
    if (!isHex(value.iv, 24) || !isHex(value.data) || value.data.length < 32) {
        throw executionFailure('The encrypted wallet record is malformed.');
    }
}

function isHex(value: string, exactLength?: number): boolean {
    return (
        (exactLength === undefined || value.length === exactLength)
        && value.length > 0
        && value.length % 2 === 0
        && /^[0-9a-f]+$/iu.test(value)
    );
}

function normalizeMnemonic(value: string): readonly string[] {
    return Object.freeze(value
        .split(/\s+/u)
        .map((word) => word
            .normalize('NFKD')
            .toLowerCase()
            .replace(/[\u200B-\u200D\uFEFF]/gu, '')
            .trim())
        .filter((word) => word.length > 0));
}

async function assertMnemonic(words: readonly string[]): Promise<void> {
    if (words.length !== REQUIRED_MNEMONIC_WORDS) {
        throw executionFailure('The decrypted wallet mnemonic must contain exactly 24 words.');
    }
    try {
        if (!await mnemonicValidate([...words])) {
            throw executionFailure('The decrypted wallet mnemonic is invalid.');
        }
    } catch (cause) {
        if (cause instanceof TonConnectWalletError) throw cause;
        throw new TonConnectWalletError(
            'TRANSACTION_EXECUTION_FAILED',
            'The decrypted wallet mnemonic is invalid.',
            {},
            { cause },
        );
    }
}

function assertNotCancelled(signal: AbortSignal | undefined): void {
    if (signal?.aborted === true) {
        throw new WalletExecutionError(
            'CONFIRMATION_CANCELLED',
            'The password-confirmed TON Connect transaction was cancelled before signing.',
        );
    }
}

function toSafeResult(
    result: WalletExecutionResult,
    request: WalletExecutionRequest,
): PasswordConfirmedTransactionResult {
    if (request.wallet.kind !== 'standard') {
        throw executionFailure('Highload Wallet V3 is not supported by this TON Connect transaction executor.');
    }
    return Object.freeze({
        network: request.network,
        walletAddress: request.wallet.address,
        walletVersion: request.wallet.version,
        correlationId: request.correlationId,
        submissionId: result.reference.submissionId,
        confirmationState: result.confirmation.state,
        txHash: result.confirmation.txHash,
        exitCode: result.confirmation.exitCode,
    });
}

function assertCanonicalBase64(value: string): void {
    if (value.length === 0 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(value)) {
        throw executionFailure('The captured external-message BOC is not canonical base64.');
    }
    const bytes = Buffer.from(value, 'base64');
    if (bytes.length === 0 || bytes.toString('base64') !== value) {
        throw executionFailure('The captured external-message BOC is not canonical base64.');
    }
    try {
        const roots = Cell.fromBoc(bytes);
        if (roots.length !== 1 || roots[0] === undefined) {
            throw executionFailure('The captured external-message BOC must contain exactly one root.');
        }
        const message = loadMessage(roots[0].beginParse());
        if (message.info.type !== 'external-in') {
            throw executionFailure('The captured TON Connect response must contain an external-in message.');
        }
    } catch (cause) {
        if (cause instanceof TonConnectWalletError) throw cause;
        throw new TonConnectWalletError(
            'TRANSACTION_EXECUTION_FAILED',
            'The captured external-message BOC is invalid.',
            {},
            { cause },
        );
    }
}

function executionFailure(message: string): TonConnectWalletError {
    return new TonConnectWalletError('TRANSACTION_EXECUTION_FAILED', message);
}
