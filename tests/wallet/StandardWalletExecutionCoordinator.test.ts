import { beginCell } from '@ton/core';
import { describe, expect, it } from 'vitest';

import { BlockchainDiagnostics, MemoryDiagnosticSink } from '../../src/observability';
import {
    StandardWalletExecutionCoordinator,
    WalletExecutionError,
} from '../../src/wallet';
import type {
    ConfirmationOptions,
    ReplayProtection,
    SignedWalletEnvelope,
    StandardWalletDescriptor,
    StandardWalletReplayReader,
    SubmissionReference,
    SubmissionReferenceStore,
    TransactionBroadcaster,
    TransactionConfirmation,
    TransactionConfirmer,
    TransactionSubmissionOptions,
    WalletDescriptor,
    WalletExecutionRequest,
    WalletSigner,
} from '../../src/wallet';

const WALLET_ADDRESS = 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c';
const DESTINATION = WALLET_ADDRESS;
const HASH = 'ab'.repeat(32);
const NOW_UNIX = 1_000_000;

function request(overrides: Partial<WalletExecutionRequest> = {}): WalletExecutionRequest {
    return {
        network: 'mainnet',
        wallet: {
            kind: 'standard',
            version: 'v4r2',
            address: WALLET_ADDRESS,
        },
        messages: [{
            to: DESTINATION,
            value: 1n,
            bounce: true,
            purpose: 'Execute an audited wallet message',
        }],
        validUntilUnix: NOW_UNIX + 120,
        correlationId: 'tx_001',
        ...overrides,
    };
}

function envelope(): SignedWalletEnvelope {
    return {
        network: 'mainnet',
        walletAddress: WALLET_ADDRESS,
        walletVersion: 'v4r2',
        correlationId: 'tx_001',
        validUntilUnix: NOW_UNIX + 120,
        replayProtection: { kind: 'seqno', seqno: 9 },
        signedBody: beginCell().storeUint(1, 1).endCell(),
    };
}

function reference(): SubmissionReference {
    return {
        schemaVersion: 1,
        submissionId: 'submission_001',
        network: 'mainnet',
        walletAddress: WALLET_ADDRESS,
        walletVersion: 'v4r2',
        correlationId: 'tx_001',
        submittedAtMs: NOW_UNIX * 1_000,
        replayProtection: { kind: 'seqno', seqno: 9 },
        transportId: HASH,
    };
}

function confirmation(state: TransactionConfirmation['state'] = 'confirmed'): TransactionConfirmation {
    return {
        state,
        reference: reference(),
        checkedAtMs: NOW_UNIX * 1_000 + 1_000,
        txHash: state === 'confirmed' || state === 'failed' ? 'cd'.repeat(32) : null,
        exitCode: state === 'failed' ? '33' : null,
    };
}

class FakeReplayReader implements StandardWalletReplayReader {
    public readonly network = 'mainnet' as const;
    public calls = 0;
    public error: unknown;
    public async read(_wallet: StandardWalletDescriptor) {
        this.calls += 1;
        if (this.error !== undefined) throw this.error;
        return { kind: 'seqno' as const, seqno: 9 };
    }
}

class FakeSigner implements WalletSigner {
    public calls = 0;
    public supported = true;
    public error: unknown;
    public replay: ReplayProtection | null = null;
    public supports(_wallet: WalletDescriptor): boolean {
        return this.supported;
    }
    public async sign(_request: WalletExecutionRequest, replay: ReplayProtection): Promise<SignedWalletEnvelope> {
        this.calls += 1;
        this.replay = replay;
        if (this.error !== undefined) throw this.error;
        return envelope();
    }
}

class FakeBroadcaster implements TransactionBroadcaster {
    public readonly network = 'mainnet' as const;
    public calls = 0;
    public options: TransactionSubmissionOptions | undefined;
    public error: unknown;
    public async submit(
        _envelope: SignedWalletEnvelope,
        options?: TransactionSubmissionOptions,
    ): Promise<SubmissionReference> {
        this.calls += 1;
        this.options = options;
        if (this.error !== undefined) throw this.error;
        return reference();
    }
}

class FakeStore implements SubmissionReferenceStore {
    public calls = 0;
    public persisted: SubmissionReference | null = null;
    public error: unknown;
    public async put(item: SubmissionReference): Promise<void> {
        this.calls += 1;
        this.persisted = item;
        if (this.error !== undefined) throw this.error;
    }
    public async get(): Promise<SubmissionReference | null> { return null; }
    public async list(): Promise<readonly SubmissionReference[]> { return []; }
    public async remove(): Promise<void> { /* unused */ }
}

class FakeConfirmer implements TransactionConfirmer {
    public readonly network = 'mainnet' as const;
    public calls = 0;
    public received: SubmissionReference | null = null;
    public options: ConfirmationOptions | undefined;
    public error: unknown;
    public result: TransactionConfirmation = confirmation();
    public async confirm(item: SubmissionReference, options?: ConfirmationOptions): Promise<TransactionConfirmation> {
        this.calls += 1;
        this.received = item;
        this.options = options;
        if (this.error !== undefined) throw this.error;
        return { ...this.result, reference: item };
    }
}

function fixture() {
    const replayReader = new FakeReplayReader();
    const signer = new FakeSigner();
    const broadcaster = new FakeBroadcaster();
    const store = new FakeStore();
    const confirmer = new FakeConfirmer();
    const sink = new MemoryDiagnosticSink();
    const diagnostics = new BlockchainDiagnostics({ sink, clock: () => NOW_UNIX * 1_000 });
    const coordinator = new StandardWalletExecutionCoordinator({
        network: 'mainnet',
        replayReader,
        signer,
        broadcaster,
        store,
        confirmer,
        diagnostics,
        clock: () => NOW_UNIX,
    });
    return { coordinator, replayReader, signer, broadcaster, store, confirmer, sink };
}

async function expectCode(work: Promise<unknown>, code: string): Promise<WalletExecutionError> {
    try {
        await work;
        throw new Error('Expected execution to fail.');
    } catch (error) {
        expect(error).toBeInstanceOf(WalletExecutionError);
        expect((error as WalletExecutionError).code).toBe(code);
        return error as WalletExecutionError;
    }
}

describe('standard-wallet execution coordinator', () => {
    it('executes replay, signing, one submission, persistence, and confirmation in order', async () => {
        const f = fixture();
        const signal = new AbortController().signal;

        const result = await f.coordinator.execute(request(), {
            confirmation: { timeoutMs: 5_000, signal },
        });

        expect(result).toEqual({ reference: reference(), confirmation: confirmation() });
        expect(f.replayReader.calls).toBe(1);
        expect(f.signer.calls).toBe(1);
        expect(f.signer.replay).toEqual({ kind: 'seqno', seqno: 9 });
        expect(f.broadcaster.calls).toBe(1);
        expect(f.store.calls).toBe(1);
        expect(f.store.persisted).toEqual(reference());
        expect(f.confirmer.calls).toBe(1);
        expect(f.confirmer.received).toEqual(reference());
        expect(f.confirmer.options).toEqual({ timeoutMs: 5_000, signal });
    });

    it('forwards transient capture only to the broadcaster and keeps it out of persistence and diagnostics', async () => {
        const f = fixture();
        const transientCapture = Object.freeze({ capture(_base64Boc: string): void { /* test seam */ } });

        const result = await f.coordinator.execute(request(), { transientCapture });

        expect(f.broadcaster.options).toEqual({ transientCapture });
        expect(f.broadcaster.options?.transientCapture).toBe(transientCapture);
        expect(f.store.persisted).toEqual(reference());
        expect(f.confirmer.received).toEqual(reference());
        expect(result).toEqual({ reference: reference(), confirmation: confirmation() });
        expect(JSON.stringify(f.store.persisted)).not.toMatch(/boc|payload|signed|capture/iu);
        expect(JSON.stringify(f.sink.events())).not.toMatch(/boc|payload|signed|capture/iu);
    });

    it('runs the post-submission hook after safe persistence and before confirmation', async () => {
        const f = fixture();
        const order: string[] = [];
        const originalPut = f.store.put.bind(f.store);
        f.store.put = async (item) => {
            await originalPut(item);
            order.push('wallet-persisted');
        };
        const originalConfirm = f.confirmer.confirm.bind(f.confirmer);
        f.confirmer.confirm = async (item, options) => {
            order.push('confirmation');
            return originalConfirm(item, options);
        };

        await f.coordinator.execute(request(), {
            onSubmitted: (item) => {
                order.push('feature-persisted');
                expect(item).toEqual(reference());
            },
        });

        expect(order).toEqual(['wallet-persisted', 'feature-persisted', 'confirmation']);
        expect(f.broadcaster.calls).toBe(1);
    });

    it('exposes only the safe submission reference when the post-submission hook fails', async () => {
        const f = fixture();
        const hookError = new Error('feature store unavailable');

        const error = await expectCode(f.coordinator.execute(request(), {
            onSubmitted: () => {
                throw hookError;
            },
        }), 'POST_SUBMISSION_HOOK_FAILED');

        expect(error.retryable).toBe(true);
        expect(error.submissionReference).toEqual(reference());
        expect(error.cause).toBe(hookError);
        expect(f.broadcaster.calls).toBe(1);
        expect(f.store.persisted).toEqual(reference());
        expect(f.confirmer.calls).toBe(0);
    });

    it('rejects invalid requests before replay, signing, submission, or persistence', async () => {
        const f = fixture();

        await expectCode(
            f.coordinator.execute(request({ validUntilUnix: NOW_UNIX })),
            'REQUEST_EXPIRED',
        );

        expect(f.replayReader.calls).toBe(0);
        expect(f.signer.calls).toBe(0);
        expect(f.broadcaster.calls).toBe(0);
        expect(f.store.calls).toBe(0);
        expect(f.confirmer.calls).toBe(0);
    });

    it('rejects unsupported wallets before replay acquisition', async () => {
        const f = fixture();
        const highloadRequest = request({
            wallet: {
                kind: 'highload-v3',
                version: 'highload-v3',
                address: WALLET_ADDRESS,
                subwalletId: 1,
                timeoutSeconds: 60,
            },
        });

        await expectCode(f.coordinator.execute(highloadRequest), 'UNSUPPORTED_WALLET');
        expect(f.replayReader.calls).toBe(0);
    });

    it('stops before signing when replay acquisition fails', async () => {
        const f = fixture();
        f.replayReader.error = new WalletExecutionError('REPLAY_STATE_UNAVAILABLE', 'unavailable');

        await expectCode(f.coordinator.execute(request()), 'REPLAY_STATE_UNAVAILABLE');
        expect(f.signer.calls).toBe(0);
        expect(f.broadcaster.calls).toBe(0);
    });

    it('stops before submission when signing fails', async () => {
        const f = fixture();
        f.signer.error = new WalletExecutionError('SIGNING_FAILED', 'failed');

        await expectCode(f.coordinator.execute(request()), 'SIGNING_FAILED');
        expect(f.broadcaster.calls).toBe(0);
        expect(f.store.calls).toBe(0);
    });

    it('does not persist or confirm a definite submission rejection', async () => {
        const f = fixture();
        f.broadcaster.error = new WalletExecutionError('SUBMISSION_REJECTED', 'rejected');

        await expectCode(f.coordinator.execute(request()), 'SUBMISSION_REJECTED');
        expect(f.broadcaster.calls).toBe(1);
        expect(f.store.calls).toBe(0);
        expect(f.confirmer.calls).toBe(0);
    });

    it('persists and confirms an ambiguous submission without retrying transport', async () => {
        const f = fixture();
        f.broadcaster.error = new WalletExecutionError(
            'SUBMISSION_AMBIGUOUS',
            'ambiguous',
            { submissionReference: reference() },
        );

        const result = await f.coordinator.execute(request());

        expect(result.confirmation.state).toBe('confirmed');
        expect(f.broadcaster.calls).toBe(1);
        expect(f.store.persisted).toEqual(reference());
        expect(f.confirmer.received).toEqual(reference());
        const submissionStages = f.sink.events()
            .filter((event) => event.operation === 'submission')
            .map((event) => event.stage);
        expect(submissionStages).toEqual(['started', 'pending']);
    });

    it('refuses unsafe ambiguous errors that omit recovery correlation metadata', async () => {
        const f = fixture();
        f.broadcaster.error = new WalletExecutionError('SUBMISSION_AMBIGUOUS', 'ambiguous');

        await expectCode(f.coordinator.execute(request()), 'SUBMISSION_AMBIGUOUS');
        expect(f.store.calls).toBe(0);
        expect(f.confirmer.calls).toBe(0);
    });

    it('attaches the safe reference when persistence fails after submission', async () => {
        const f = fixture();
        f.store.error = new Error('quota');

        const error = await expectCode(f.coordinator.execute(request()), 'REFERENCE_STORE_FAILED');

        expect(error.retryable).toBe(true);
        expect(error.submissionReference).toEqual(reference());
        expect(f.broadcaster.calls).toBe(1);
        expect(f.confirmer.calls).toBe(0);
        expect(JSON.stringify(error.submissionReference)).not.toMatch(/signedBody|signature|boc|payload/i);
    });

    it('propagates confirmation cancellation after persistence without resubmission', async () => {
        const f = fixture();
        f.confirmer.error = new WalletExecutionError('CONFIRMATION_CANCELLED', 'cancelled');

        await expectCode(f.coordinator.execute(request()), 'CONFIRMATION_CANCELLED');
        expect(f.store.calls).toBe(1);
        expect(f.broadcaster.calls).toBe(1);
        expect(f.confirmer.calls).toBe(1);
    });

    it('returns failed on-chain confirmation as a completed lifecycle result', async () => {
        const f = fixture();
        f.confirmer.result = confirmation('failed');

        const result = await f.coordinator.execute(request());

        expect(result.confirmation.state).toBe('failed');
        expect(result.confirmation.exitCode).toBe('33');
        expect(f.store.calls).toBe(1);
    });

    it('emits correlated metadata-only lifecycle diagnostics', async () => {
        const f = fixture();

        await f.coordinator.execute(request());

        const events = f.sink.events();
        expect(events.length).toBeGreaterThan(8);
        expect(new Set(events.map((event) => event.correlationId))).toEqual(new Set(['tx_001']));
        expect(events.some((event) => event.operation === 'signing' && event.stage === 'succeeded')).toBe(true);
        expect(events.some((event) => event.operation === 'confirmation' && event.stage === 'succeeded')).toBe(true);
        expect(JSON.stringify(events)).not.toMatch(/signedBody|signature|boc|payload|mnemonic|password|bodyCell/i);
    });

    it('rejects component network mismatch at construction', () => {
        const f = fixture();
        const testnetBroadcaster: TransactionBroadcaster = {
            network: 'testnet',
            submit: f.broadcaster.submit.bind(f.broadcaster),
        };

        expect(() => new StandardWalletExecutionCoordinator({
            network: 'mainnet',
            replayReader: f.replayReader,
            signer: f.signer,
            broadcaster: testnetBroadcaster,
            store: f.store,
            confirmer: f.confirmer,
        })).toThrowError(WalletExecutionError);
    });
});
