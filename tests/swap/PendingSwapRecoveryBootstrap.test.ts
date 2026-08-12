import { Address } from '@ton/core';
import { describe, expect, it } from 'vitest';

import type { NetworkId } from '../../src/core/chain';
import { PendingSwapRecoveryBootstrap } from '../../src/swap/application';
import type {
    RecoveredSwapLifecycle,
    WalletPendingSwapRecovery,
} from '../../src/swap/application';
import type {
    PendingSwapRecoveryResult,
    RecoverWalletSwapsOptions,
} from '../../src/swap';
import type {
    PendingSwapReference,
    SwapOutcome,
} from '../../src/swap';
import { WalletExecutionError } from '../../src/wallet';
import type {
    SubmissionReference,
    TransactionConfirmation,
} from '../../src/wallet';
import {
    NOW_MS,
    ROUTER,
    WALLET,
    testAddress,
} from './fixtures';

function submission(id = 'submission_001'): SubmissionReference {
    return Object.freeze({
        schemaVersion: 1,
        submissionId: id,
        network: 'mainnet',
        walletAddress: WALLET,
        walletVersion: 'v4r2',
        correlationId: `recovery_${id}`,
        submittedAtMs: NOW_MS,
        replayProtection: Object.freeze({ kind: 'seqno', seqno: 9 }),
        transportId: 'ab'.repeat(32),
    });
}

function reference(id = 'submission_001'): PendingSwapReference {
    return Object.freeze({
        schemaVersion: 1,
        network: 'mainnet',
        submission: submission(id),
        swap: Object.freeze({
            providerId: 'stonfi',
            routerAddress: ROUTER,
            ownerAddress: WALLET,
            queryId: id === 'submission_001' ? 1n : 2n,
            deadlineUnix: Math.floor(NOW_MS / 1_000) + 120,
        }),
    });
}

function wallet(
    ref: PendingSwapReference,
    state: TransactionConfirmation['state'] = 'confirmed',
): TransactionConfirmation {
    return Object.freeze({
        state,
        reference: ref.submission,
        checkedAtMs: NOW_MS + 1_000,
        txHash: state === 'confirmed' || state === 'failed' ? 'cd'.repeat(32) : null,
        exitCode: state === 'failed' ? '33' : null,
    });
}

function outcome(state: SwapOutcome['state'] = 'succeeded'): SwapOutcome {
    return Object.freeze({
        state,
        exitCode: state === 'succeeded' ? 'swap_ok' : state === 'failed' ? 'refund' : null,
        txHash: state === 'succeeded' || state === 'failed' ? 'ef'.repeat(32) : null,
        receivedUnits: state === 'succeeded' ? 99n : null,
        explorerUrl: 'https://example.invalid/recovery',
    });
}

function recovered(
    id = 'submission_001',
    state: PendingSwapRecoveryResult['state'] = 'succeeded',
    walletState: TransactionConfirmation['state'] = 'confirmed',
    dex: SwapOutcome | null = outcome(state),
): PendingSwapRecoveryResult {
    const ref = reference(id);
    return Object.freeze({
        reference: ref,
        state,
        wallet: wallet(ref, walletState),
        outcome: dex,
    });
}

class FakeRecovery implements WalletPendingSwapRecovery {
    public readonly network: NetworkId;
    public calls = 0;
    public ownerAddress: string | null = null;
    public options: RecoverWalletSwapsOptions | undefined;
    public settled: readonly PromiseSettledResult<PendingSwapRecoveryResult>[] = [
        { status: 'fulfilled', value: recovered() },
    ];
    public error: unknown;

    public constructor(network: NetworkId = 'mainnet') {
        this.network = network;
    }

    public recoverWallet(
        ownerAddress: string,
        options?: RecoverWalletSwapsOptions,
    ): Promise<readonly PromiseSettledResult<PendingSwapRecoveryResult>[]> {
        this.calls += 1;
        this.ownerAddress = ownerAddress;
        this.options = options;
        if (this.error !== undefined) return Promise.reject(this.error);
        return Promise.resolve(this.settled);
    }
}

function fixture() {
    const recovery = new FakeRecovery();
    const bootstrap = new PendingSwapRecoveryBootstrap(recovery);
    const events: RecoveredSwapLifecycle[] = [];
    return { recovery, bootstrap, events };
}

describe('pending swap recovery bootstrap', () => {
    it('canonicalizes the owner, forwards bounded recovery options, and projects success', async () => {
        const f = fixture();
        const friendly = Address.parse(WALLET).toString({ bounceable: false, urlSafe: false });
        const walletSignal = new AbortController().signal;
        const outcomeSignal = new AbortController().signal;
        const results = await f.bootstrap.recoverWallet('mainnet', friendly, {
            concurrency: 3,
            wallet: { timeoutMs: 5_000, signal: walletSignal },
            outcome: { timeoutMs: 8_000, pollIntervalMs: 20, signal: outcomeSignal },
            onLifecycle: (event) => f.events.push(event),
        });

        expect(f.recovery.calls).toBe(1);
        expect(Address.parse(f.recovery.ownerAddress ?? '').equals(Address.parse(WALLET))).toBe(true);
        expect(f.recovery.options).toEqual({
            concurrency: 3,
            wallet: { timeoutMs: 5_000, signal: walletSignal },
            outcome: { timeoutMs: 8_000, pollIntervalMs: 20, signal: outcomeSignal },
        });
        expect(results).toEqual([{
            status: 'fulfilled',
            stage: 'succeeded',
            network: 'mainnet',
            providerId: 'stonfi',
            correlationId: 'recovery_submission_001',
            submissionId: 'submission_001',
            walletConfirmationState: 'confirmed',
            dexExitCode: 'swap_ok',
            txHash: 'ef'.repeat(32),
            explorerUrl: 'https://example.invalid/recovery',
            errorCode: null,
        }]);
        expect(f.events).toEqual(results);
        expect(Object.isFrozen(results)).toBe(true);
        expect(results.every(Object.isFrozen)).toBe(true);
    });

    it('rejects explicit network mismatch before recovery access', async () => {
        const f = fixture();
        await expect(f.bootstrap.recoverWallet('testnet', WALLET))
            .rejects.toMatchObject({ code: 'WALLET_NETWORK_MISMATCH' });
        expect(f.recovery.calls).toBe(0);
    });

    it('rejects an invalid owner before recovery access', async () => {
        const f = fixture();
        await expect(f.bootstrap.recoverWallet('mainnet', 'not-an-address')).rejects.toBeDefined();
        expect(f.recovery.calls).toBe(0);
    });

    it('preserves deterministic settled ordering and isolates rejected records', async () => {
        const f = fixture();
        f.recovery.settled = Object.freeze([
            { status: 'fulfilled', value: recovered('submission_001') },
            { status: 'rejected', reason: new WalletExecutionError('CONFIRMATION_TIMEOUT', 'Timed out.') },
            {
                status: 'fulfilled',
                value: recovered('submission_002', 'failed', 'confirmed', outcome('failed')),
            },
        ]);
        const results = await f.bootstrap.recoverWallet('mainnet', WALLET);
        expect(results.map((item) => item.submissionId)).toEqual([
            'submission_001',
            null,
            'submission_002',
        ]);
        expect(results.map((item) => item.stage)).toEqual(['succeeded', 'unknown', 'failed']);
        expect(results[1]?.errorCode).toBe('CONFIRMATION_TIMEOUT');
    });

    it.each([
        ['pending', 'pending', null, 'wallet-pending'],
        ['unknown', 'unknown', null, 'wallet-pending'],
        ['failed', 'failed', null, 'failed'],
        ['pending', 'confirmed', 'pending', 'dex-pending'],
        ['unknown', 'confirmed', 'unknown', 'unknown'],
        ['failed', 'confirmed', 'failed', 'failed'],
    ] as const)(
        'classifies recovered state %s with wallet %s and DEX %s as %s',
        async (state, walletState, dexState, expected) => {
            const f = fixture();
            f.recovery.settled = [{
                status: 'fulfilled',
                value: recovered(
                    'submission_001',
                    state,
                    walletState,
                    dexState === null ? null : outcome(dexState),
                ),
            }];
            const results = await f.bootstrap.recoverWallet('mainnet', WALLET);
            expect(results[0]?.stage).toBe(expected);
            expect(results[0]?.walletConfirmationState).toBe(walletState);
        },
    );

    it('classifies cancellation without exposing the reason or raw error', async () => {
        const f = fixture();
        f.recovery.settled = [{
            status: 'rejected',
            reason: new WalletExecutionError('CONFIRMATION_CANCELLED', 'User navigation contained secret text.'),
        }];
        const results = await f.bootstrap.recoverWallet('mainnet', WALLET);
        expect(results).toEqual([{
            status: 'rejected',
            stage: 'cancelled',
            network: 'mainnet',
            providerId: null,
            correlationId: null,
            submissionId: null,
            walletConfirmationState: null,
            dexExitCode: null,
            txHash: null,
            explorerUrl: null,
            errorCode: 'CONFIRMATION_CANCELLED',
        }]);
        expect(JSON.stringify(results)).not.toContain('secret text');
    });

    it('rejects fulfilled metadata for another owner instead of displaying it', async () => {
        const f = fixture();
        const other = testAddress('other-owner');
        const bad = recovered();
        f.recovery.settled = [{
            status: 'fulfilled',
            value: Object.freeze({
                ...bad,
                reference: Object.freeze({
                    ...bad.reference,
                    swap: Object.freeze({ ...bad.reference.swap, ownerAddress: other }),
                }),
            }),
        }];
        await expect(f.bootstrap.recoverWallet('mainnet', WALLET))
            .rejects.toMatchObject({ code: 'INVALID_WALLET_REQUEST' });
    });

    it('ignores lifecycle observer failures and does not repeat recovery', async () => {
        const f = fixture();
        const results = await f.bootstrap.recoverWallet('mainnet', WALLET, {
            onLifecycle: () => { throw new Error('UI observer failed'); },
        });
        expect(results[0]?.stage).toBe('succeeded');
        expect(f.recovery.calls).toBe(1);
    });

    it('returns only immutable metadata and accepts no signing or submission input', async () => {
        const f = fixture();
        const results = await f.bootstrap.recoverWallet('mainnet', WALLET);
        const keys = Object.keys(results[0] ?? {}).join(' ');
        expect(keys).not.toMatch(
            /password|mnemonic|seed|key|signer|signed|signature|boc|cell|payload|prepared|providerData|queryId|receivedUnits/i,
        );
        expect(JSON.stringify(results)).not.toMatch(
            /password|mnemonic|secretKey|signedBody|payload|queryId/i,
        );
    });
});
