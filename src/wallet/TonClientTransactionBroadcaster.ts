import { beginCell, external, storeMessage } from '@ton/core';
import type { Message } from '@ton/core';
import type { TonClient } from '@ton/ton';

import { parseAddress } from '../core/address';
import type { NetworkId } from '../core/chain';
import { WalletExecutionError } from './errors';
import { normalizedExternalMessageHash } from './externalMessageHash';
import type {
    SignedWalletEnvelope,
    SubmissionReference,
    TransactionBroadcaster,
    TransactionSubmissionOptions,
} from './types';

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const DEFINITE_REJECTION_CODE = /^(?:INVALID_ARGUMENT|BAD_REQUEST|MESSAGE_REJECTED|CONTRACT_REJECTED|UNSUPPORTED)$/;
const DEFINITE_REJECTION_STATUS = new Set([400, 403, 404, 409, 422]);

export interface ExternalMessageTransport {
    send(boc: Buffer): Promise<void>;
}

export interface TonClientTransactionBroadcasterOptions {
    readonly network: NetworkId;
    readonly transport: ExternalMessageTransport;
    readonly clock?: () => number;
    readonly submissionIds?: SubmissionIdSource;
}

export interface SubmissionIdSource {
    next(): string;
}

export class CryptoSubmissionIdSource implements SubmissionIdSource {
    public next(): string {
        const cryptoSource = globalThis.crypto;
        if (cryptoSource === undefined || typeof cryptoSource.getRandomValues !== 'function') {
            throw new WalletExecutionError(
                'SUBMISSION_REJECTED',
                'Secure randomness is required to identify this submission.',
            );
        }
        const bytes = cryptoSource.getRandomValues(new Uint8Array(16));
        return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    }
}

/** Exact one-attempt transport adapter over TonClient.sendFile(). */
export class TonClientExternalMessageTransport implements ExternalMessageTransport {
    private readonly client: Pick<TonClient, 'sendFile'>;

    public constructor(client: Pick<TonClient, 'sendFile'>) {
        this.client = client;
    }

    public async send(boc: Buffer): Promise<void> {
        await this.client.sendFile(boc);
    }
}

/**
 * Network-bound broadcaster with no retry loop.
 *
 * Once `transport.send()` begins, any transport or unknown failure is ambiguous:
 * the RPC node may have accepted the message before the response was lost. The
 * caller must confirm chain state; it must not automatically sign or submit a
 * replacement intent.
 */
export class TonClientTransactionBroadcaster implements TransactionBroadcaster {
    public readonly network: NetworkId;
    private readonly transport: ExternalMessageTransport;
    private readonly clock: () => number;
    private readonly submissionIds: SubmissionIdSource;

    public constructor(options: TonClientTransactionBroadcasterOptions) {
        this.network = options.network;
        this.transport = options.transport;
        this.clock = options.clock ?? Date.now;
        this.submissionIds = options.submissionIds ?? new CryptoSubmissionIdSource();
    }

    public async submit(
        envelope: SignedWalletEnvelope,
        options: TransactionSubmissionOptions = {},
    ): Promise<SubmissionReference> {
        const nowMs = this.clock();
        assertEnvelopeBeforeTransport(envelope, this.network, nowMs);

        let submissionId: string;
        try {
            submissionId = this.submissionIds.next();
        } catch (cause) {
            if (cause instanceof WalletExecutionError) throw cause;
            throw new WalletExecutionError('SUBMISSION_REJECTED', 'A submission identifier could not be created.', {
                cause,
            });
        }
        if (!SAFE_ID.test(submissionId)) {
            throw new WalletExecutionError('SUBMISSION_REJECTED', 'The generated submission identifier is invalid.');
        }

        const message = external({
            to: parseAddress(envelope.walletAddress),
            ...(envelope.stateInit === undefined ? {} : { init: envelope.stateInit }),
            body: envelope.signedBody,
        });
        const boc = beginCell().store(storeMessage(message)).endCell().toBoc();

        const reference: SubmissionReference = Object.freeze({
            schemaVersion: 1,
            submissionId,
            network: this.network,
            walletAddress: parseAddress(envelope.walletAddress).toString(),
            walletVersion: envelope.walletVersion,
            correlationId: envelope.correlationId,
            submittedAtMs: nowMs,
            replayProtection: envelope.replayProtection,
            transportId: normalizedExternalMessageHash(message),
        });

        try {
            options.transientCapture?.capture(boc.toString('base64'));
        } catch (cause) {
            throw new WalletExecutionError(
                'SUBMISSION_REJECTED',
                'The external message could not be prepared for its immediate protocol response.',
                { cause },
            );
        }

        try {
            await this.transport.send(boc);
        } catch (cause) {
            console.error('Transaction broadcast error:', cause);
            if (isDefinitePreAcceptanceRejection(cause)) {
                throw new WalletExecutionError(
                    'SUBMISSION_REJECTED',
                    'The RPC endpoint rejected the external message.',
                    { cause },
                );
            }
            throw new WalletExecutionError(
                'SUBMISSION_AMBIGUOUS',
                'The external message may have been accepted, but the RPC response was inconclusive.',
                { retryable: false, cause, submissionReference: reference },
            );
        }

        return reference;
    }
}

function assertEnvelopeBeforeTransport(
    envelope: SignedWalletEnvelope,
    network: NetworkId,
    nowMs: number,
): void {
    if (envelope.network !== network) {
        throw new WalletExecutionError(
            'WALLET_NETWORK_MISMATCH',
            'The signed message belongs to a different TON network.',
        );
    }
    parseAddress(envelope.walletAddress);
    if (!SAFE_ID.test(envelope.correlationId)) {
        throw new WalletExecutionError('SUBMISSION_REJECTED', 'The transaction correlation identifier is invalid.');
    }
    if (!Number.isFinite(nowMs)) {
        throw new WalletExecutionError('SUBMISSION_REJECTED', 'The submission clock is invalid.');
    }
    const nowUnix = Math.floor(nowMs / 1000);
    if (!Number.isSafeInteger(envelope.validUntilUnix) || envelope.validUntilUnix <= nowUnix) {
        throw new WalletExecutionError('REQUEST_EXPIRED', 'This signed transaction has expired.');
    }
}

interface StructuredTransportError {
    readonly code?: unknown;
    readonly status?: unknown;
    readonly response?: { readonly status?: unknown };
    readonly request?: unknown;
}

/** Only explicit local/HTTP rejection is safe to classify as definitely unsent. */
function isDefinitePreAcceptanceRejection(cause: unknown): boolean {
    if (typeof cause !== 'object' || cause === null) return false;
    const error = cause as StructuredTransportError;
    if (typeof error.code === 'string' && DEFINITE_REJECTION_CODE.test(error.code)) {
        return true;
    }
    const status = typeof error.status === 'number'
        ? error.status
        : typeof error.response?.status === 'number'
            ? error.response.status
            : null;
    return status !== null && DEFINITE_REJECTION_STATUS.has(status) && error.request === undefined;
}
