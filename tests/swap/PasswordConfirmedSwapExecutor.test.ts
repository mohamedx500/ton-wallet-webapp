import { beginCell } from '@ton/core';
import type { Cell } from '@ton/core';
import { mnemonicNew, mnemonicToPrivateKey, type KeyPair } from '@ton/crypto';
import { WalletContractV4 } from '@ton/ton';
import { describe, expect, it } from 'vitest';

import type { NetworkId } from '../../src/core/chain';
import {
    PasswordConfirmedSwapExecutor,
    SwapApplicationErrorCode,
} from '../../src/swap/application';
import type {
    ApprovedSwapCoordinator,
    ApprovedSwapCoordinatorFactory,
    LegacyEncryptedMnemonic,
    PasswordConfirmedSwapAccount,
    WalletCoordinatorFactory,
    SwapMnemonicDecryptor,
    SwapQuoteApproval,
} from '../../src/swap/application';
import type {
    ExecuteSwapOptions,
    ExecuteSwapRequest,
    PreparedSwap,
    SwapExecutionResult,
} from '../../src/swap';
import type {
    DexProvider,
    SwapOutcome,
    SwapReference,
} from '../../src/swap';
import type {
    OfficialStandardWalletSigner,
    WalletDescriptor,
    SubmissionReference,
    TransactionConfirmation,
    WalletExecutionCoordinator,
    WalletExecutionOptions,
    WalletExecutionRequest,
    WalletExecutionResult,
} from '../../src/wallet';
import { WalletExecutionError } from '../../src/wallet';
import {
    NOW_MS,
    ROUTER,
    TON,
    USDT,
    approvingVerdicts,
    makePlan,
    makeQuote,
} from './fixtures';

const PASSWORD = 'correct horse battery staple';
const ENCRYPTED: LegacyEncryptedMnemonic = Object.freeze({
    iv: '00'.repeat(12),
    data: '11'.repeat(32),
});

const MNEMONIC = Object.freeze([
    'champion', 'confirm', 'off', 'play', 'trouble', 'evidence',
    'glow', 'physical', 'glance', 'kite', 'hire', 'congress',
    'vicious', 'grid', 'present', 'mass', 'flock', 'ranch',
    'animal', 'disorder', 'interest', 'trumpet', 'garment', 'loyal',
]);
const KEY_PAIR = await mnemonicToPrivateKey([...MNEMONIC]);
const WALLET_ADDRESS = WalletContractV4.create({
    workchain: 0,
    publicKey: KEY_PAIR.publicKey,
    walletId: 698983191,
}).address.toRawString();
const DESCRIPTOR: WalletDescriptor = Object.freeze({
    kind: 'standard',
    version: 'v4r2',
    address: WALLET_ADDRESS,
});
const ACCOUNT: PasswordConfirmedSwapAccount = Object.freeze({
    address: WALLET_ADDRESS,
    wallet: DESCRIPTOR,
    encryptedMnemonic: ENCRYPTED,
});
const INTENT = Object.freeze({
    network: 'mainnet' as const,
    ownerAddress: WALLET_ADDRESS,
    wallet: DESCRIPTOR,
    from: USDT,
    to: TON,
    offerUnits: 200_000n,
    slippageBps: 100,
    correlationId: 'stage_c_swap_1',
});
const APPROVAL: SwapQuoteApproval = Object.freeze({
    intent: INTENT,
    request: Object.freeze({
        from: INTENT.from,
        to: INTENT.to,
        offerUnits: INTENT.offerUnits,
        slippageBps: INTENT.slippageBps,
        walletAddress: INTENT.ownerAddress,
        nowMs: NOW_MS,
    }),
    quote: makeQuote({
        providerId: 'stonfi',
        from: INTENT.from,
        to: INTENT.to,
        offerUnits: INTENT.offerUnits,
        slippageBps: INTENT.slippageBps,
        createdAtMs: NOW_MS,
    }),
    generation: 1,
});

class FakeDecryptor implements SwapMnemonicDecryptor {
    public calls = 0;
    public encrypted: LegacyEncryptedMnemonic | null = null;
    public suppliedPassword: string | null = null;
    public plaintext = '';
    public error: unknown;

    public async decrypt(encrypted: LegacyEncryptedMnemonic, password: string): Promise<string> {
        this.calls += 1;
        this.encrypted = encrypted;
        this.suppliedPassword = password;
        if (this.error !== undefined) throw this.error;
        return this.plaintext;
    }
}

class FakeWalletCoordinator implements WalletExecutionCoordinator {
    public readonly network: NetworkId;
    public executeCalls = 0;

    public constructor(network: NetworkId) {
        this.network = network;
    }

    public execute(
        _request: WalletExecutionRequest,
        _options?: WalletExecutionOptions,
    ): Promise<WalletExecutionResult> {
        this.executeCalls += 1;
        throw new Error('The fake swap coordinator does not call this directly.');
    }
}

class FakeWalletFactory implements WalletCoordinatorFactory {
    public readonly network: NetworkId;
    public calls = 0;
    public keyPair: KeyPair | null = null;
    public walletDesc: WalletDescriptor | null = null;
    public readonly wallet: FakeWalletCoordinator;

    public constructor(network: NetworkId = 'mainnet', walletNetwork: NetworkId = network) {
        this.network = network;
        this.wallet = new FakeWalletCoordinator(walletNetwork);
    }

    public create(keyPair: KeyPair, walletDesc: WalletDescriptor): WalletExecutionCoordinator {
        this.calls += 1;
        this.keyPair = keyPair;
        this.walletDesc = walletDesc;
        return this.wallet;
    }
}

class FakeSwapCoordinator implements ApprovedSwapCoordinator {
    public readonly network: NetworkId;
    public calls = 0;
    public request: ExecuteSwapRequest | null = null;
    public options: ExecuteSwapOptions | undefined;
    public error: unknown;
    public result: SwapExecutionResult;

    public constructor(network: NetworkId = 'mainnet') {
        this.network = network;
        this.result = makeExecutionResult();
    }

    public execute(request: ExecuteSwapRequest, options?: ExecuteSwapOptions): Promise<SwapExecutionResult> {
        this.calls += 1;
        this.request = request;
        this.options = options;
        if (this.error !== undefined) return Promise.reject(this.error);
        return Promise.resolve(this.result);
    }
}

class FakeSwapFactory implements ApprovedSwapCoordinatorFactory {
    public readonly network: NetworkId;
    public calls = 0;
    public wallet: WalletExecutionCoordinator | null = null;
    public readonly coordinator: FakeSwapCoordinator;

    public constructor(network: NetworkId = 'mainnet', coordinatorNetwork: NetworkId = network) {
        this.network = network;
        this.coordinator = new FakeSwapCoordinator(coordinatorNetwork);
    }

    public create(wallet: WalletExecutionCoordinator): ApprovedSwapCoordinator {
        this.calls += 1;
        this.wallet = wallet;
        return this.coordinator;
    }
}

function makeExecutionResult(): SwapExecutionResult {
    const submission: SubmissionReference = Object.freeze({
        schemaVersion: 1,
        submissionId: 'submission_stage_c_1',
        network: 'mainnet',
        walletAddress: WALLET_ADDRESS,
        walletVersion: 'v4r2',
        correlationId: 'stage_c_swap_1',
        submittedAtMs: NOW_MS + 1_000,
        replayProtection: Object.freeze({ kind: 'seqno', seqno: 7 }),
        transportId: 'ab'.repeat(32),
    });
    const confirmation: TransactionConfirmation = Object.freeze({
        state: 'confirmed',
        reference: submission,
        checkedAtMs: NOW_MS + 2_000,
        txHash: 'cd'.repeat(32),
        exitCode: null,
    });
    const swapReference: SwapReference = Object.freeze({
        providerId: 'stonfi',
        routerAddress: ROUTER,
        ownerAddress: WALLET_ADDRESS,
        queryId: 123n,
        deadlineUnix: Math.floor(NOW_MS / 1_000) + 120,
    });
    const plan = makePlan({
        providerId: 'stonfi',
        quote: APPROVAL.quote,
        messages: Object.freeze([]),
        reference: swapReference,
        expiresAtMs: NOW_MS + 120_000,
    });
    const provider: DexProvider = Object.freeze({
        id: 'stonfi',
        displayName: 'STON.fi',
        website: 'https://ston.fi',
        capabilities: Object.freeze({
            assetDiscovery: true,
            simulation: true,
            onChainDeadline: true,
            statusTracking: true,
            referrals: true,
            exactMinOut: true,
        }),
        listAssets: () => Promise.resolve([]),
        supportsPair: () => Promise.resolve(true),
        quote: () => Promise.reject(new Error('unused')),
        buildSwap: () => Promise.reject(new Error('unused')),
        verifyDestination: () => Promise.reject(new Error('unused')),
        getOutcome: () => Promise.reject(new Error('unused')),
        explorerUrl: () => 'https://example.invalid',
    });
    const prepared: PreparedSwap = Object.freeze({
        plan,
        warnings: Object.freeze([]),
        verdicts: approvingVerdicts(plan),
        balances: Object.freeze({ tonUnits: 10_000_000_000n, offeredAssetUnits: 10_000_000_000n }),
        provider,
    });
    const wallet: WalletExecutionResult = Object.freeze({
        reference: submission,
        confirmation,
    });
    const outcome: SwapOutcome = Object.freeze({
        state: 'succeeded',
        exitCode: 'swap_ok',
        txHash: 'ef'.repeat(32),
        receivedUnits: 990_000_000n,
        explorerUrl: 'https://example.invalid/swap',
    });
    return Object.freeze({ state: 'succeeded', prepared, wallet, outcome });
}

function fixture(options: {
    readonly executorNetwork?: NetworkId;
    readonly walletFactoryNetwork?: NetworkId;
    readonly walletNetwork?: NetworkId;
    readonly swapFactoryNetwork?: NetworkId;
    readonly swapCoordinatorNetwork?: NetworkId;
} = {}) {
    const decryptor = new FakeDecryptor();
    decryptor.plaintext = MNEMONIC.join(' ');
    const walletFactory = new FakeWalletFactory(
        options.walletFactoryNetwork ?? 'mainnet',
        options.walletNetwork ?? options.walletFactoryNetwork ?? 'mainnet',
    );
    const swapFactory = new FakeSwapFactory(
        options.swapFactoryNetwork ?? 'mainnet',
        options.swapCoordinatorNetwork ?? options.swapFactoryNetwork ?? 'mainnet',
    );
    const executor = new PasswordConfirmedSwapExecutor({
        network: options.executorNetwork ?? 'mainnet',
        decryptor,
        walletCoordinatorFactory: walletFactory,
        swapCoordinatorFactory: swapFactory,
        signerClock: () => Math.floor(NOW_MS / 1_000),
    });
    return { decryptor, walletFactory, swapFactory, executor };
}

function changedApproval(changes: Partial<SwapQuoteApproval>): SwapQuoteApproval {
    return Object.freeze({ ...APPROVAL, ...changes });
}

describe('password-confirmed swap executor', () => {
    it('decrypts internally and forwards the exact approved quote and wallet descriptor', async () => {
        const f = fixture();
        const walletSignal = new AbortController().signal;
        const result = await f.executor.execute(
            { approval: APPROVAL, account: ACCOUNT, password: PASSWORD },
            { wallet: { confirmation: { timeoutMs: 5_000, signal: walletSignal } } },
        );

        expect(f.decryptor.calls).toBe(1);
        expect(f.decryptor.encrypted).toBe(ENCRYPTED);
        expect(f.decryptor.suppliedPassword).toBe(PASSWORD);
        expect(f.walletFactory.calls).toBe(1);
        expect(f.swapFactory.calls).toBe(1);
        expect(f.swapFactory.coordinator.calls).toBe(1);
        expect(f.swapFactory.coordinator.request?.quote).toBe(APPROVAL.quote);
        expect(f.swapFactory.coordinator.request?.wallet).toBe(APPROVAL.intent.wallet);
        expect(f.swapFactory.coordinator.request?.correlationId).toBe(APPROVAL.intent.correlationId);
        expect(f.swapFactory.coordinator.options?.wallet?.confirmation).toEqual({ timeoutMs: 5_000, signal: walletSignal });
        expect(result).toEqual({
            state: 'succeeded',
            network: 'mainnet',
            providerId: 'stonfi',
            walletAddress: WALLET_ADDRESS,
            walletVersion: 'v4r2',
            correlationId: 'stage_c_swap_1',
            submissionId: 'submission_stage_c_1',
            walletConfirmationState: 'confirmed',
            dexExitCode: 'swap_ok',
            txHash: 'ef'.repeat(32),
            receivedUnits: 990_000_000n,
            explorerUrl: 'https://example.invalid/swap',
        });
        expect(Object.isFrozen(result)).toBe(true);
        expect(Object.keys(result).join(' ')).not.toMatch(
            /mnemonic|seed|password|key|signer|signed|signature|boc|cell|payload|prepared|providerData/i,
        );
    });

    it.each(['', '   '])('rejects empty password %j before decryption', async (password) => {
        const f = fixture();
        await expect(f.executor.execute({ approval: APPROVAL, account: ACCOUNT, password }))
            .rejects.toMatchObject({ code: SwapApplicationErrorCode.PasswordRequired });
        expect(f.decryptor.calls).toBe(0);
        expect(f.walletFactory.calls).toBe(0);
        expect(f.swapFactory.calls).toBe(0);
    });

    it('rejects cancellation before decryption or execution', async () => {
        const f = fixture();
        const controller = new AbortController();
        controller.abort();
        await expect(f.executor.execute(
            { approval: APPROVAL, account: ACCOUNT, password: PASSWORD },
            { outcome: { signal: controller.signal } },
        )).rejects.toMatchObject({ code: 'CONFIRMATION_CANCELLED' });
        expect(f.decryptor.calls).toBe(0);
        expect(f.walletFactory.calls).toBe(0);
        expect(f.swapFactory.calls).toBe(0);
    });

    it('maps wrong-password decryption failure to a stable safe error and performs no execution', async () => {
        const f = fixture();
        const raw = new DOMException('ciphertext and password mismatch', 'OperationError');
        f.decryptor.error = raw;
        await expect(f.executor.execute({ approval: APPROVAL, account: ACCOUNT, password: 'wrong' }))
            .rejects.toMatchObject({
                code: SwapApplicationErrorCode.DecryptionFailed,
                message: 'The wallet could not be unlocked with the supplied password.',
                cause: raw,
            });
        expect(f.walletFactory.calls).toBe(0);
        expect(f.swapFactory.calls).toBe(0);
    });

    it('rejects malformed encrypted records before calling the decryptor', async () => {
        const f = fixture();
        const malformed = Object.freeze({ ...ACCOUNT, encryptedMnemonic: { iv: 'zz', data: '11' } });
        await expect(f.executor.execute({ approval: APPROVAL, account: malformed, password: PASSWORD }))
            .rejects.toMatchObject({ code: SwapApplicationErrorCode.EncryptedAccountInvalid });
        expect(f.decryptor.calls).toBe(0);
        expect(f.walletFactory.calls).toBe(0);
    });

    it.each([
        [['not-a-mnemonic']],
        [Array.from({ length: 24 }, () => 'notaword')],
    ])('rejects malformed or checksum-invalid decrypted mnemonic before execution', async (words) => {
        const f = fixture();
        f.decryptor.plaintext = words.join(' ');
        await expect(f.executor.execute({ approval: APPROVAL, account: ACCOUNT, password: PASSWORD }))
            .rejects.toMatchObject({ code: SwapApplicationErrorCode.InvalidMnemonic });
        expect(f.walletFactory.calls).toBe(0);
        expect(f.swapFactory.calls).toBe(0);
    });

    it('normalizes harmless whitespace and Unicode form internally', async () => {
        const f = fixture();
        f.decryptor.plaintext = `  ${MNEMONIC.map((word) => word.toUpperCase()).join('  \n')}  `;
        await expect(f.executor.execute({ approval: APPROVAL, account: ACCOUNT, password: PASSWORD }))
            .resolves.toMatchObject({ state: 'succeeded' });
        expect(f.swapFactory.coordinator.calls).toBe(1);
    });



    it('rejects network mismatch before decryption', async () => {
        const f = fixture({ executorNetwork: 'testnet', walletFactoryNetwork: 'testnet', swapFactoryNetwork: 'testnet' });
        await expect(f.executor.execute({ approval: APPROVAL, account: ACCOUNT, password: PASSWORD }))
            .rejects.toMatchObject({ code: SwapApplicationErrorCode.ExecutionNetworkMismatch });
        expect(f.decryptor.calls).toBe(0);
    });

    it('rejects factory network mismatch at construction', () => {
        const decryptor = new FakeDecryptor();
        expect(() => new PasswordConfirmedSwapExecutor({
            network: 'mainnet',
            decryptor,
            walletCoordinatorFactory: new FakeWalletFactory('testnet'),
            swapCoordinatorFactory: new FakeSwapFactory('mainnet'),
            signerClock: () => 1,
        })).toThrowError(expect.objectContaining({ code: SwapApplicationErrorCode.ExecutionNetworkMismatch }));
    });

    it('rejects returned coordinator network mismatch before swap execution', async () => {
        const f = fixture({ walletNetwork: 'testnet' });
        await expect(f.executor.execute({ approval: APPROVAL, account: ACCOUNT, password: PASSWORD }))
            .rejects.toMatchObject({ code: SwapApplicationErrorCode.ExecutionNetworkMismatch });
        expect(f.swapFactory.calls).toBe(0);
    });

    it('rejects approval request or quote drift before decryption', async () => {
        const cases: SwapQuoteApproval[] = [
            changedApproval({ request: Object.freeze({ ...APPROVAL.request, offerUnits: 1n }) }),
            changedApproval({ quote: Object.freeze({ ...APPROVAL.quote, slippageBps: 200 }) }),
        ];
        for (const approval of cases) {
            const f = fixture();
            await expect(f.executor.execute({ approval, account: ACCOUNT, password: PASSWORD }))
                .rejects.toMatchObject({ code: SwapApplicationErrorCode.ApprovalMismatch });
            expect(f.decryptor.calls).toBe(0);
        }
    });

    it('rejects a separately reconstructed wallet descriptor even when its fields match', async () => {
        const f = fixture();
        const reconstructed = Object.freeze({ ...DESCRIPTOR });
        const account = Object.freeze({ ...ACCOUNT, wallet: reconstructed });
        await expect(f.executor.execute({ approval: APPROVAL, account, password: PASSWORD }))
            .rejects.toMatchObject({ code: SwapApplicationErrorCode.EncryptedAccountMismatch });
        expect(f.decryptor.calls).toBe(0);
    });

    it('propagates execution failures and calls execution exactly once', async () => {
        const f = fixture();
        f.swapFactory.coordinator.error = new WalletExecutionError('SUBMISSION_AMBIGUOUS', 'Submission outcome is uncertain.');
        await expect(f.executor.execute({ approval: APPROVAL, account: ACCOUNT, password: PASSWORD }))
            .rejects.toMatchObject({ code: 'SUBMISSION_AMBIGUOUS' });
        expect(f.decryptor.calls).toBe(1);
        expect(f.swapFactory.coordinator.calls).toBe(1);
    });

    it('uses the short-lived official signer and does not return its authority', async () => {
        const f = fixture();
        const result = await f.executor.execute({ approval: APPROVAL, account: ACCOUNT, password: PASSWORD });
        expect(f.walletFactory.keyPair).not.toBeNull();
        expect(JSON.stringify(result, (_key, value: unknown) => typeof value === 'bigint' ? value.toString() : value))
            .not.toContain(MNEMONIC[0]);
    });

    it('rechecks cancellation after decryption and before authority derivation', async () => {
        const controller = new AbortController();
        const f = fixture();
        f.decryptor.decrypt = async () => {
            f.decryptor.calls += 1;
            controller.abort();
            return MNEMONIC.join(' ');
        };
        await expect(f.executor.execute(
            { approval: APPROVAL, account: ACCOUNT, password: PASSWORD },
            { wallet: { confirmation: { signal: controller.signal } } },
        )).rejects.toMatchObject({ code: 'CONFIRMATION_CANCELLED' });
        expect(f.walletFactory.calls).toBe(0);
        expect(f.swapFactory.calls).toBe(0);
    });

    it('keeps signer artifacts behind the authority while producing an official signature', async () => {
        const f = fixture();
        await f.executor.execute({ approval: APPROVAL, account: ACCOUNT, password: PASSWORD });
        expect(f.walletFactory.keyPair).not.toBeNull();
        expect(f.walletFactory.keyPair?.secretKey.length).toBe(64);
        expect(Object.keys(f.walletFactory).join(' ')).not.toMatch(/mnemonic|password/i);
    });
});
