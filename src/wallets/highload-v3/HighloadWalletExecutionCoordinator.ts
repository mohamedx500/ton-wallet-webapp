/**
 * HighloadWalletExecutionCoordinator — Slice 2: Highload V3 execution boundary.
 *
 * Analogous to StandardWalletExecutionCoordinator (N10) but for Highload V3.
 * Uses HighloadQueryId for replay protection instead of seqno.
 *
 * Enforced order:
 *   1. Validate request (network, expiry, wallet kind, message count).
 *   2. Allocate a fresh Highload query ID (replay protection).
 *   3. Sign via HighloadWalletSigner.signWithKey().
 *   4. Zero the secret key in `finally`.
 *   5. Submit once via TonClientTransactionBroadcaster.
 *   7. Persist the secret-free SubmissionReference.
 *   8. Invoke onSubmitted hook if provided.
 *   9. Confirm on-chain via HighloadWalletTransactionConfirmer.
 *
 * The signed envelope is transient between signer and broadcaster.
 */

import { Buffer } from 'buffer';
import { KeyPair } from '@ton/crypto';
import { v4 as uuidv4 } from 'uuid';

import type {
    HighloadReplayProtection,
    HighloadWalletDescriptor,
    WalletExecutionCoordinator,
    WalletExecutionOptions,
    WalletExecutionRequest,
    WalletExecutionResult,
    TransactionBroadcaster,
    TransactionConfirmer,
    SubmissionReferenceStore,
} from '../../wallet/types';
import { WalletExecutionError } from '../../wallet/errors';
import type { HighloadWalletSigner } from './HighloadWalletSigner';
import { HighloadQueryId } from './HighloadQueryId';

export interface HighloadWalletExecutionCoordinatorOptions {
    readonly signer: HighloadWalletSigner;
    readonly broadcaster: TransactionBroadcaster;
    readonly confirmer: TransactionConfirmer;
    readonly referenceStore: SubmissionReferenceStore;
    readonly keyPair: KeyPair;
    /** Clock — defaults to Math.floor(Date.now()/1000). */
    readonly clock?: () => number;
}

export class HighloadWalletExecutionCoordinator implements WalletExecutionCoordinator {
    public readonly network;
    private readonly signer: HighloadWalletSigner;
    private readonly broadcaster: TransactionBroadcaster;
    private readonly confirmer: TransactionConfirmer;
    private readonly referenceStore: SubmissionReferenceStore;
    private readonly keyPair: KeyPair;
    private readonly clock: () => number;

    public constructor(options: HighloadWalletExecutionCoordinatorOptions) {
        this.network = options.broadcaster.network;
        this.signer = options.signer;
        this.broadcaster = options.broadcaster;
        this.confirmer = options.confirmer;
        this.referenceStore = options.referenceStore;
        this.keyPair = options.keyPair;
        this.clock = options.clock ?? (() => Math.floor(Date.now() / 1000));

        if (this.broadcaster.network !== this.confirmer.network) {
            throw new WalletExecutionError(
                'UNSUPPORTED_WALLET',
                'Broadcaster and confirmer must be bound to the same network.',
            );
        }
    }

    public async execute(
        request: WalletExecutionRequest,
        options?: WalletExecutionOptions,
    ): Promise<WalletExecutionResult> {
        // ── 1. Validate ───────────────────────────────────────────────────────
        if (request.network !== this.network) {
            throw new WalletExecutionError(
                'INVALID_WALLET_REQUEST',
                `Request network '${request.network}' does not match coordinator network '${this.network}'.`,
            );
        }
        if (request.wallet.kind !== 'highload-v3') {
            throw new WalletExecutionError(
                'INVALID_WALLET_REQUEST',
                `HighloadWalletExecutionCoordinator requires a 'highload-v3' descriptor, got '${request.wallet.kind}'.`,
            );
        }
        if (request.messages.length === 0) {
            throw new WalletExecutionError(
                'INVALID_WALLET_REQUEST',
                'A Highload V3 execution request must contain at least one message.',
            );
        }
        if (request.messages.length > 254) {
            throw new WalletExecutionError(
                'INVALID_WALLET_REQUEST',
                `Highload V3 supports up to 254 messages per request, got ${request.messages.length}.`,
            );
        }
        const nowUnix = this.clock();
        if (request.validUntilUnix <= nowUnix) {
            throw new WalletExecutionError(
                'REQUEST_EXPIRED',
                'The execution request has already expired.',
            );
        }

        const descriptor = request.wallet as HighloadWalletDescriptor;

        // ── 2. Allocate query ID ──────────────────────────────────────────────
        const queryIdObj = HighloadQueryId.fromTimestamp(); // fresh time-based allocation
        const replayProtection: HighloadReplayProtection = {
            kind: 'highload-query',
            queryId: queryIdObj.getQueryId(),
            createdAtUnix: nowUnix,
        };

        // ── 3–5. Derive key, sign, zero ────────────────────────────────────────
        let secretKey: Buffer | null = null;
        let envelope;
        try {
            secretKey = Buffer.from(this.keyPair.secretKey);
            envelope = await this.signer.signWithKey(request, replayProtection, secretKey);
        } finally {
            if (secretKey !== null) {
                secretKey.fill(0);
                secretKey = null;
            }
        }

        // ── 6. Submit once ────────────────────────────────────────────────────
        const reference = await this.broadcaster.submit(envelope, {
            ...(options?.transientCapture ? { transientCapture: options.transientCapture } : {})
        });

        // ── 7. Persist reference ──────────────────────────────────────────────
        await this.referenceStore.put(reference);

        // ── 8. Post-submission hook ───────────────────────────────────────────
        if (options?.onSubmitted) {
            try {
                await options.onSubmitted(reference);
            } catch {
                // Hook failure does not abort confirmation; caller has the reference
            }
        }

        // ── 9. Confirm on-chain ────────────────────────────────────────────────
        const confirmation = await this.confirmer.confirm(reference, options?.confirmation);

        return Object.freeze({ reference, confirmation });
    }
}
