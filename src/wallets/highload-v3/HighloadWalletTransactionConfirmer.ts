import type { TonClient } from '@ton/ton';

import { parseAddress } from '../../core/address';
import type { NetworkId } from '../../core/chain';
import { WalletExecutionError } from '../../wallet/errors';
import { isNormalizedExternalMessageHash, normalizedExternalMessageHash } from '../../wallet/externalMessageHash';
import type {
    StandardWalletTransactionRecord,
    StandardWalletTransactionSource,
} from '../../wallet/StandardWalletTransactionConfirmer';
import type {
    ConfirmationOptions,
    HighloadReplayProtection,
    SubmissionReference,
    TransactionConfirmation,
    TransactionConfirmer,
} from '../../wallet/types';
import { HighloadQueryId } from './HighloadQueryId';
import { HighloadWalletV3 } from './HighloadWalletV3';

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_HISTORY_LIMIT = 20;
const MAX_HISTORY_LIMIT = 100;

export interface HighloadWalletTransactionConfirmerOptions {
    readonly source: StandardWalletTransactionSource;
    readonly client: Pick<TonClient, 'open'>;
    readonly clock?: () => number;
    readonly sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
    readonly historyLimit?: number;
}

/**
 * Correlates a Highload V3 submission by its normalized external-in message hash.
 *
 * Query-id replay state is consulted only after timeout when the exact inbound
 * message cannot be found in recent history; it is never treated as intent success.
 */
export class HighloadWalletTransactionConfirmer implements TransactionConfirmer {
    public readonly network: NetworkId;
    private readonly source: StandardWalletTransactionSource;
    private readonly client: Pick<TonClient, 'open'>;
    private readonly clock: () => number;
    private readonly sleep: (delayMs: number, signal?: AbortSignal) => Promise<void>;
    private readonly historyLimit: number;

    public constructor(options: HighloadWalletTransactionConfirmerOptions) {
        this.source = options.source;
        this.client = options.client;
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
        assertHighloadReference(reference, this.network);
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
        const replayProtection = reference.replayProtection;
        if (replayProtection.kind !== 'highload-query') {
            throw new WalletExecutionError(
                'UNSUPPORTED_WALLET',
                'This confirmer supports Highload V3 query-id submissions only.',
            );
        }

        let processed: boolean;
        try {
            processed = await this.isQueryProcessed(reference.walletAddress, replayProtection);
        } catch (cause) {
            throw new WalletExecutionError(
                'CONFIRMATION_TIMEOUT',
                'The transaction was not found before timeout and Highload replay state could not be verified.',
                { retryable: true, cause },
            );
        }

        if (processed) {
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

    private async isQueryProcessed(
        walletAddress: string,
        replayProtection: HighloadReplayProtection,
    ): Promise<boolean> {
        const queryId = replayProtection.queryId;
        const queryIdObj = HighloadQueryId.fromShiftAndBitNumber(
            Number((queryId >> BigInt(10)) & BigInt(0x1FFF)),
            Number(queryId & BigInt(0x3FF)),
        );
        const wallet = this.client.open(
            HighloadWalletV3.createFromAddress(parseAddress(walletAddress)),
        );
        return wallet.getProcessed(queryIdObj, false);
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

function assertHighloadReference(reference: SubmissionReference, network: NetworkId): void {
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
    if (reference.walletVersion !== 'highload-v3' || reference.replayProtection.kind !== 'highload-query') {
        throw new WalletExecutionError(
            'UNSUPPORTED_WALLET',
            'This confirmer supports Highload V3 query-id submissions only.',
        );
    }
    assertHighloadQueryId(reference.replayProtection.queryId);
    if (reference.transportId === null || !isNormalizedExternalMessageHash(reference.transportId)) {
        throw new WalletExecutionError(
            'INVALID_WALLET_REQUEST',
            'An exact normalized external-message hash is required for safe confirmation.',
        );
    }
}

function assertHighloadQueryId(value: bigint): void {
    if (value < 0n || value > 0x7f_ffffn) {
        throw new WalletExecutionError('CONFIRMATION_FAILED', 'The submission reference contains an invalid query id.');
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
