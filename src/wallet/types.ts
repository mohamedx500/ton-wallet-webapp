import type { Cell, StateInit } from '@ton/core';

import type { NetworkId } from '../core/chain';

/** Wallet contracts supported by the execution boundary. */
export type WalletContractVersion = 'v3r1' | 'v3r2' | 'v4r2' | 'v5r1' | 'highload-v3';

export type StandardWalletContractVersion = Exclude<WalletContractVersion, 'highload-v3'>;

/**
 * Public wallet identity and protocol configuration.
 *
 * This descriptor is safe to persist. It deliberately contains no mnemonic,
 * private key, password, signature, signed body, or session credential.
 */
export type WalletDescriptor = StandardWalletDescriptor | HighloadWalletDescriptor;

export interface StandardWalletDescriptor {
    readonly kind: 'standard';
    readonly version: StandardWalletContractVersion;
    readonly address: string;
    /** Wallet-contract subwallet id, when that version/configuration uses one. */
    readonly subwalletId?: number;
}

export interface HighloadWalletDescriptor {
    readonly kind: 'highload-v3';
    readonly version: 'highload-v3';
    readonly address: string;
    readonly subwalletId: number;
    readonly timeoutSeconds: number;
}

/**
 * One exact internal message for a wallet contract to authorize.
 *
 * `bounce` is mandatory. Callers must make an explicit decision instead of
 * inheriting the unsafe legacy default of `false` for contract destinations.
 */
export interface UnsignedWalletMessage {
    readonly to: string;
    /** Attached TON in nanotons. Must be greater than zero. */
    readonly value: bigint;
    /** Omitted for an empty body; never represented as `body: undefined`. */
    readonly body?: Cell;
    readonly bounce: boolean;
    /** Non-sensitive explanation shown to the user before approval. */
    readonly purpose: string;
}

/**
 * Immutable, network-bound user intent handed to a wallet signer.
 *
 * A request is unsigned and safe to retain only while the approval flow is
 * active. Payload cells must not be written to ordinary application storage or
 * diagnostics even though they do not contain the private key.
 */
export interface WalletExecutionRequest {
    readonly network: NetworkId;
    readonly wallet: WalletDescriptor;
    readonly messages: readonly UnsignedWalletMessage[];
    /** Unix timestamp in seconds after which signing/submission must stop. */
    readonly validUntilUnix: number;
    /** Opaque safe identifier shared by diagnostics; never derived from secrets. */
    readonly correlationId: string;
}

/** Standard-wallet replay protection obtained before signing. */
export interface SeqnoReplayProtection {
    readonly kind: 'seqno';
    readonly seqno: number;
}

/** Highload Wallet V3 replay protection reserved before signing. */
export interface HighloadReplayProtection {
    readonly kind: 'highload-query';
    readonly queryId: bigint;
    readonly createdAtUnix: number;
}

export type ReplayProtection = SeqnoReplayProtection | HighloadReplayProtection;

export type WalletAccountState = 'active' | 'uninitialized' | 'frozen';

export interface WalletAccountSnapshot {
    readonly network: NetworkId;
    readonly address: string;
    readonly state: WalletAccountState;
    readonly balance: bigint;
}

/** Narrow read-only source used to acquire standard-wallet replay state. */
export interface WalletAccountStateSource {
    readonly network: NetworkId;
    getAccount(address: string): Promise<WalletAccountSnapshot>;
    getSeqno(address: string): Promise<number>;
}

/** Reads verified replay state without signing or submitting. */
export interface StandardWalletReplayReader {
    readonly network: NetworkId;
    read(wallet: StandardWalletDescriptor): Promise<SeqnoReplayProtection>;
}

/**
 * Sensitive transient result of signing.
 *
 * Implementations must keep this object in memory only. It must never be logged,
 * serialized into diagnostics, or placed in local/session storage.
 */
export interface SignedWalletEnvelope {
    readonly network: NetworkId;
    readonly walletAddress: string;
    readonly walletVersion: WalletContractVersion;
    readonly correlationId: string;
    readonly validUntilUnix: number;
    readonly replayProtection: ReplayProtection;
    readonly signedBody: Cell;
    readonly stateInit?: StateInit;
}

/** Persistable, secret-free evidence that a broadcaster accepted a submission. */
export interface SubmissionReference {
    readonly schemaVersion: 1;
    readonly submissionId: string;
    readonly network: NetworkId;
    readonly walletAddress: string;
    readonly walletVersion: WalletContractVersion;
    readonly correlationId: string;
    readonly submittedAtMs: number;
    readonly replayProtection: ReplayProtection;
    /**
     * TEP-467 normalized external-in message hash, when the transport can
     * derive it before submission. This is safe correlation metadata, never a
     * BOC, signature, payload, or provider response.
     */
    readonly transportId: string | null;
}

export type ConfirmationState = 'pending' | 'confirmed' | 'failed' | 'unknown';

/** Result of chain confirmation, distinct from transport acceptance. */
export interface TransactionConfirmation {
    readonly state: ConfirmationState;
    readonly reference: SubmissionReference;
    readonly checkedAtMs: number;
    readonly txHash: string | null;
    readonly exitCode: string | null;
}

export interface ConfirmationOptions {
    readonly timeoutMs?: number;
    readonly pollIntervalMs?: number;
    readonly signal?: AbortSignal;
}

/** Wallet-version adapter. The implementation owns access to signing authority. */
export interface WalletSigner {
    supports(wallet: WalletDescriptor): boolean;
    sign(request: WalletExecutionRequest, replayProtection: ReplayProtection): Promise<SignedWalletEnvelope>;
}

/** Synchronous in-memory capture used only by immediate protocol response boundaries. */
export interface TransientExternalMessageCapture {
    capture(base64Boc: string): void;
}

export interface TransactionSubmissionOptions {
    /** Runs once before transport begins. The BOC must remain memory-only and short-lived. */
    readonly transientCapture?: TransientExternalMessageCapture;
}

/** Network-bound transport. It cannot construct or modify a signed envelope. */
export interface TransactionBroadcaster {
    readonly network: NetworkId;
    submit(
        envelope: SignedWalletEnvelope,
        options?: TransactionSubmissionOptions,
    ): Promise<SubmissionReference>;
}

/** Resolves on-chain inclusion/failure after submission was accepted. */
export interface TransactionConfirmer {
    readonly network: NetworkId;
    confirm(reference: SubmissionReference, options?: ConfirmationOptions): Promise<TransactionConfirmation>;
}

export interface WalletExecutionOptions {
    readonly confirmation?: ConfirmationOptions;
    /** In-memory only. Forwarded to the broadcaster and never persisted or diagnosed. */
    readonly transientCapture?: TransientExternalMessageCapture;
    /**
     * Runs after the secret-free submission reference is durably persisted and
     * before confirmation begins. Feature coordinators may use this to persist
     * additional correlation metadata without receiving a signed envelope.
     */
    readonly onSubmitted?: (
        reference: SubmissionReference
    ) => void | Promise<void>;
}

/** Completed standard-wallet lifecycle after safe reference persistence. */
export interface WalletExecutionResult {
    readonly reference: SubmissionReference;
    readonly confirmation: TransactionConfirmation;
}

export interface WalletExecutionCoordinator {
    readonly network: NetworkId;
    execute(request: WalletExecutionRequest, options?: WalletExecutionOptions): Promise<WalletExecutionResult>;
}

/**
 * Persistence boundary for safe submission metadata only.
 *
 * SignedWalletEnvelope is intentionally absent from this API, preventing a
 * conforming store from accepting signatures, signed bodies, BOCs, or state init.
 */
export interface SubmissionReferenceStore {
    put(reference: SubmissionReference): Promise<void>;
    get(network: NetworkId, submissionId: string): Promise<SubmissionReference | null>;
    list(network: NetworkId, walletAddress: string): Promise<readonly SubmissionReference[]>;
    remove(network: NetworkId, submissionId: string): Promise<void>;
}
