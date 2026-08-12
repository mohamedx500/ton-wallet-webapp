/**
 * TransferExecutor — Slice 1: Centralize transfer construction and signing.
 *
 * This is the single entry point for native TON and Jetton transfers.
 * Composes typed builders with the audited PasswordConfirmedTransactionExecutor
 * so no inline `beginCell`/`toNano` arithmetic lives in React components,
 * and decrypted mnemonics never enter React state for the transfer path.
 */

import { v4 as uuidv4 } from 'uuid';
import { buildNativeTonTransferMessage } from './NativeTonTransferBuilder';
import { buildJettonTransferMessage } from './JettonTransferBuilder';
import { buildNftTransferMessage } from '../nft/NftTransferBuilder';
import type { NativeTonTransferIntent, JettonTransferIntent, TransferIntent } from './types';
import type { NftTransferIntent } from '../nft/types';
import { TransferConstructionError } from './errors';
import type { NetworkId } from '../core/chain';
import type { StandardWalletDescriptor } from '../wallet/types';
import type {
    PasswordConfirmedTransactionAccount,
    PasswordConfirmedTransactionResult,
    TonConnectEncryptedMnemonic,
    TonConnectMnemonicDecryptor,
    TonConnectWalletCoordinatorFactory,
} from '../tonconnect/PasswordConfirmedTransactionExecutor';
import { PasswordConfirmedTransactionExecutor } from '../tonconnect/PasswordConfirmedTransactionExecutor';

// ─── Public input shape ────────────────────────────────────────────────────────

/**
 * Simple account reference used only by the executor.
 * Carries no mnemonic, key, or signature.
 */
export interface TransferAccount {
    readonly address: string;
    readonly wallet: StandardWalletDescriptor;
    readonly encryptedMnemonic: TonConnectEncryptedMnemonic;
}

export interface TransferExecutorOptions {
    readonly network: NetworkId;
    readonly decryptor: TonConnectMnemonicDecryptor;
    readonly walletCoordinatorFactory: TonConnectWalletCoordinatorFactory;
    readonly signerClock?: () => number;
}

export type TransferResult = PasswordConfirmedTransactionResult;

// ─── Executor ─────────────────────────────────────────────────────────────────

export class TransferExecutor {
    private readonly inner: PasswordConfirmedTransactionExecutor;
    private readonly network: NetworkId;

    public constructor(options: TransferExecutorOptions) {
        this.network = options.network;
        this.inner = new PasswordConfirmedTransactionExecutor({
            network: options.network,
            decryptor: options.decryptor,
            walletCoordinatorFactory: options.walletCoordinatorFactory,
            signerClock: options.signerClock ?? (() => Date.now()),
        });
    }

    /**
     * Build, sign, submit, and confirm a single transfer (native TON or Jetton).
     */
    public async send(
        intent: TransferIntent | NftTransferIntent,
        account: TransferAccount,
        password: string,
    ): Promise<TransferResult> {
        if (intent.network !== this.network) {
            throw new TransferConstructionError(
                'INVALID_TRANSFER_INTENT',
                `Transfer network '${intent.network}' does not match executor network '${this.network}'.`,
            );
        }

        const message =
            intent.kind === 'native-ton'
                ? buildNativeTonTransferMessage(intent as NativeTonTransferIntent)
                : intent.kind === 'jetton'
                    ? buildJettonTransferMessage(intent as JettonTransferIntent)
                    : buildNftTransferMessage(intent as NftTransferIntent);

        const executorAccount: PasswordConfirmedTransactionAccount = {
            address: account.address,
            wallet: account.wallet,
            encryptedMnemonic: account.encryptedMnemonic,
        };

        const validUntilUnix = Math.floor(Date.now() / 1000) + 120;

        return this.inner.execute({
            transaction: {
                network: this.network,
                wallet: account.wallet,
                messages: [message],
                validUntilUnix,
                correlationId: `transfer:${uuidv4()}`,
            },
            account: executorAccount,
            password,
        });
    }

    /**
     * Build, sign, submit, and confirm a batch of transfers (Highload V3).
     * Capped at 254 messages per the Highload V3 specification.
     */
    public async sendBatch(
        intents: readonly TransferIntent[],
        account: TransferAccount,
        password: string,
    ): Promise<TransferResult> {
        if (intents.length === 0) {
            throw new TransferConstructionError(
                'INVALID_TRANSFER_INTENT',
                'A batch transfer must contain at least one intent.',
            );
        }
        if (intents.length > 254) {
            throw new TransferConstructionError(
                'INVALID_TRANSFER_INTENT',
                `Highload V3 is limited to 254 messages; received ${intents.length}.`,
            );
        }
        for (const intent of intents) {
            if (intent.network !== this.network) {
                throw new TransferConstructionError(
                    'INVALID_TRANSFER_INTENT',
                    `Batch intent network '${intent.network}' does not match executor network '${this.network}'.`,
                );
            }
        }

        const messages = intents.map((intent) =>
            intent.kind === 'native-ton'
                ? buildNativeTonTransferMessage(intent as NativeTonTransferIntent)
                : buildJettonTransferMessage(intent as JettonTransferIntent),
        );

        const executorAccount: PasswordConfirmedTransactionAccount = {
            address: account.address,
            wallet: account.wallet,
            encryptedMnemonic: account.encryptedMnemonic,
        };

        const validUntilUnix = Math.floor(Date.now() / 1000) + 120;

        return this.inner.execute({
            transaction: {
                network: this.network,
                wallet: account.wallet,
                messages,
                validUntilUnix,
                correlationId: `batch:${uuidv4()}`,
            },
            account: executorAccount,
            password,
        });
    }
}
