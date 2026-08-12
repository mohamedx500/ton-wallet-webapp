import type { Transaction } from '@ton/core';
import type { TonClient } from '@ton/ton';

import { parseAddress } from '../core/address';
import type { NetworkId } from '../core/chain';
import { WalletExecutionError } from './errors';
import { isNormalizedExternalMessageHash, normalizedExternalMessageHash } from './externalMessageHash';
import type {
    ConfirmationOptions,
    SubmissionReference,
    TransactionConfirmation,
    TransactionConfirmer,
} from './types';

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_HISTORY_LIMIT = 20;
const MAX_HISTORY_LIMIT = 100;

export interface StandardWalletTransactionRecord {
    readonly txHash: string;
    readonly lt: bigint;
    readonly nowUnix: number;
    readonly inboundExternalMessageHash: string | null;
    readonly aborted: boolean;
    readonly exitCode: string | null;
}

/** Narrow, network-bound chain surface used only for standard-wallet confirmation. */
export interface StandardWalletTransactionSource {
    readonly network: NetworkId;
    getRecentTransactions(address: string, limit: number): Promise<readonly StandardWalletTransactionRecord[]>;
    getSeqno(address: string): Promise<number>;
}

export interface StandardWalletTransactionConfirmerOptions {
    readonly source: StandardWalletTransactionSource;
    readonly clock?: () => number;
    readonly sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
    readonly historyLimit?: number;
}

/** Strict TonClient adapter that exposes only normalized, non-payload transaction metadata. */
export class TonClientStandardWalletTransactionSource implements StandardWalletTransactionSource {
    public readonly network: NetworkId;
    private readonly client: Pick<TonClient, 'getTransactions' | 'runMethod'>;

    public constructor(client: Pick<TonClient, 'getTransactions' | 'runMethod'>, network: NetworkId) {
        this.client = client;
        this.network = network;
    }

    public async getRecentTransactions(
        address: string,
        limit: number,
    ): Promise<readonly StandardWalletTransactionRecord[]> {
        const transactions = await this.client.getTransactions(parseAddress(address), {
            limit,
            archival: true,
        });
        return Object.freeze(transactions.map(toTransactionRecord));
    }

    public async getSeqno(address: string): Promise<number> {
        const result = await this.client.runMethod(parseAddress(address), 'seqno');
        return result.stack.readNumber();
    }
}

/**
 * Correlates a standard-wallet submission by its normalized external-in message
 * hash. Seqno progression is used only to detect an unresolved conflict after
 * the exact message cannot be found; it is never treated as intent success.
 */
export class StandardWalletTransactionConfirmer implements TransactionConfirmer {
    public readonly network: NetworkId;
    private readonly source: StandardWalletTransactionSource;
    private readonly clock: () => number;
    private readonly sleep: (delayMs: number, signal?: AbortSignal) => Promise<void>;
    private readonly historyLimit: number;

    public constructor(options: StandardWalletTransactionConfirmerOptions) {
        this.source = options.source;
        this.network = options.source.network;
        this.clock = options.clock ?? Date.now;
        this.sleep = options.sleep ?? abortableSleep;
        this.historyLimit = options.historyLimit ?? DEFAULT_HISTORY_LIMIT;

        if (!Number.isSafeInteger(this.historyLimit)
            || this.historyLimit < 1
            || this.historyLimit > MAX_HISTORY_LIMIT) {
            throw new WalletExecutionError(
                'INVALID_WALLET_REQUEST',
                'The transaction confirmation history limit is invalid.',
            );
        }
    }

    public async confirm(
        reference: SubmissionReference,
        options: ConfirmationOptions = {},
    ): Promise<TransactionConfirmation> {
        assertStandardReference(reference, this.network);
        const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
        assertConfirmationTiming(timeoutMs, pollIntervalMs);
        throwIfAborted(options.signal);

        const startedAtMs = this.readClock();
        const deadlineMs = startedAtMs + timeoutMs;

        while (true) {
            const observation = await this.observe(reference);
            if (observation !== null) return observation;

            const checkedAtMs = this.readClock();
            if (timeoutMs === 0) {
                return this.pending(reference, checkedAtMs);
            }
            if (checkedAtMs >= deadlineMs) {
                return await this.resolveTimeout(reference, checkedAtMs);
            }

            throwIfAborted(options.signal);
            const remainingMs = deadlineMs - checkedAtMs;
            await this.sleep(Math.min(pollIntervalMs, remainingMs), options.signal);
            throwIfAborted(options.signal);
        }
    }

    private async observe(reference: SubmissionReference): Promise<TransactionConfirmation | null> {
        let records: readonly StandardWalletTransactionRecord[];
        try {
            records = await this.source.getRecentTransactions(reference.walletAddress, this.historyLimit);
        } catch (cause) {
            throw new WalletExecutionError(
                'CONFIRMATION_FAILED',
                'The wallet transaction history could not be verified.',
                { retryable: true, cause },
            );
        }

        const matching = records.find(
            (record) => record.inboundExternalMessageHash === reference.transportId,
        );
        if (matching === undefined) return null;

        const checkedAtMs = this.readClock();
        return Object.freeze({
            state: matching.aborted ? 'failed' : 'confirmed',
            reference,
            checkedAtMs,
            txHash: matching.txHash,
            exitCode: matching.exitCode,
        });
    }

    private async resolveTimeout(
        reference: SubmissionReference,
        checkedAtMs: number,
    ): Promise<TransactionConfirmation> {
        let currentSeqno: number;
        try {
            currentSeqno = await this.source.getSeqno(reference.walletAddress);
        } catch (cause) {
            throw new WalletExecutionError(
                'CONFIRMATION_TIMEOUT',
                'The transaction was not found before timeout and wallet replay state could not be verified.',
                { retryable: true, cause },
            );
        }
        assertSeqno(currentSeqno, 'The confirmation source returned an invalid wallet seqno.');

        const expectedSeqno = reference.replayProtection;
        if (expectedSeqno.kind !== 'seqno') {
            throw new WalletExecutionError(
                'UNSUPPORTED_WALLET',
                'This confirmer supports standard-wallet seqno submissions only.',
            );
        }

        if (currentSeqno > expectedSeqno.seqno) {
            return Object.freeze({
                state: 'unknown',
                reference,
                checkedAtMs,
                txHash: null,
                exitCode: null,
            });
        }

        throw new WalletExecutionError(
            'CONFIRMATION_TIMEOUT',
            'The transaction was not found before the confirmation timeout.',
            { retryable: true },
        );
    }

    private pending(reference: SubmissionReference, checkedAtMs: number): TransactionConfirmation {
        return Object.freeze({
            state: 'pending',
            reference,
            checkedAtMs,
            txHash: null,
            exitCode: null,
        });
    }

    private readClock(): number {
        const nowMs = this.clock();
        if (!Number.isFinite(nowMs)) {
            throw new WalletExecutionError('CONFIRMATION_FAILED', 'The transaction confirmation clock is invalid.');
        }
        return nowMs;
    }
}

function toTransactionRecord(transaction: Transaction): StandardWalletTransactionRecord {
    const inMessage = transaction.inMessage;
    const inboundExternalMessageHash = inMessage?.info.type === 'external-in'
        ? normalizedExternalMessageHash(inMessage)
        : null;
    const outcome = transactionOutcome(transaction);

    return Object.freeze({
        txHash: transaction.hash().toString('hex'),
        lt: transaction.lt,
        nowUnix: transaction.now,
        inboundExternalMessageHash,
        aborted: outcome.aborted,
        exitCode: outcome.exitCode,
    });
}

function transactionOutcome(transaction: Transaction): { readonly aborted: boolean; readonly exitCode: string | null } {
    const description = transaction.description;
    if (description.type === 'storage') {
        return { aborted: false, exitCode: null };
    }
    if (description.type === 'split-install') {
        return { aborted: !description.installed, exitCode: description.installed ? null : 'split-install-failed' };
    }

    const computePhase = 'computePhase' in description ? description.computePhase : undefined;
    if (computePhase?.type === 'skipped') {
        return { aborted: true, exitCode: `compute-skipped:${computePhase.reason}` };
    }
    if (computePhase?.type === 'vm' && !computePhase.success) {
        return { aborted: true, exitCode: String(computePhase.exitCode) };
    }

    const actionPhase = 'actionPhase' in description ? description.actionPhase : undefined;
    if (actionPhase !== undefined
        && actionPhase !== null
        && (!actionPhase.success || !actionPhase.valid)) {
        return { aborted: true, exitCode: String(actionPhase.resultCode) };
    }

    const aborted = 'aborted' in description && description.aborted;
    return { aborted, exitCode: aborted ? 'aborted' : null };
}

function assertStandardReference(reference: SubmissionReference, network: NetworkId): void {
    if (reference.schemaVersion !== 1) {
        throw new WalletExecutionError('INVALID_WALLET_REQUEST', 'The submission reference schema is unsupported.');
    }
    if (reference.network !== network) {
        throw new WalletExecutionError(
            'WALLET_NETWORK_MISMATCH',
            'The submission reference belongs to a different TON network.',
        );
    }
    parseAddress(reference.walletAddress);
    if (reference.walletVersion === 'highload-v3' || reference.replayProtection.kind !== 'seqno') {
        throw new WalletExecutionError(
            'UNSUPPORTED_WALLET',
            'This confirmer supports standard-wallet seqno submissions only.',
        );
    }
    assertSeqno(reference.replayProtection.seqno, 'The submission reference contains an invalid wallet seqno.');
    if (reference.transportId === null || !isNormalizedExternalMessageHash(reference.transportId)) {
        throw new WalletExecutionError(
            'INVALID_WALLET_REQUEST',
            'An exact normalized external-message hash is required for safe confirmation.',
        );
    }
}

function assertSeqno(value: number, message: string): void {
    if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
        throw new WalletExecutionError('CONFIRMATION_FAILED', message);
    }
}

function assertConfirmationTiming(timeoutMs: number, pollIntervalMs: number): void {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0) {
        throw new WalletExecutionError('INVALID_WALLET_REQUEST', 'The transaction confirmation timeout is invalid.');
    }
    if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 1) {
        throw new WalletExecutionError('INVALID_WALLET_REQUEST', 'The transaction confirmation poll interval is invalid.');
    }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
    if (signal?.aborted === true) {
        throw new WalletExecutionError(
            'CONFIRMATION_CANCELLED',
            'Transaction confirmation was cancelled.',
        );
    }
}

function abortableSleep(delayMs: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted === true) {
            reject(new WalletExecutionError('CONFIRMATION_CANCELLED', 'Transaction confirmation was cancelled.'));
            return;
        }

        const timeout = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, delayMs);
        const onAbort = (): void => {
            clearTimeout(timeout);
            signal?.removeEventListener('abort', onAbort);
            reject(new WalletExecutionError('CONFIRMATION_CANCELLED', 'Transaction confirmation was cancelled.'));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}
