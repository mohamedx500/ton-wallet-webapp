import { beginCell, external, storeMessage } from '@ton/core';
import { mnemonicToPrivateKey, sign, type KeyPair } from '@ton/crypto';
import { WalletContractV4 } from '@ton/ton';
import { describe, expect, it } from 'vitest';

import type { NetworkId } from '../../../src/core/chain';
import {
    PasswordConfirmedTransactionExecutor,
} from '../../../src/tonconnect/PasswordConfirmedTransactionExecutor';
import type {
    PasswordConfirmedTransactionAccount,
    TonConnectEncryptedMnemonic,
    TonConnectMnemonicDecryptor,
    TonConnectWalletCoordinatorFactory,
} from '../../../src/tonconnect/PasswordConfirmedTransactionExecutor';
import { TonConnectWalletError } from '../../../src/tonconnect/wallet';
import type {
    WalletDescriptor,
    WalletExecutionCoordinator,
    WalletExecutionOptions,
    WalletExecutionRequest,
    WalletExecutionResult,
} from '../../../src/wallet';
import { WalletExecutionError } from '../../../src/wallet';

const NOW = 1_800_000_000;
const PASSWORD = 'correct horse battery staple';
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
const ENCRYPTED: TonConnectEncryptedMnemonic = Object.freeze({
    iv: '00'.repeat(12),
    data: '11'.repeat(32),
});
const ACCOUNT: PasswordConfirmedTransactionAccount = Object.freeze({
    address: WALLET_ADDRESS,
    wallet: DESCRIPTOR,
    encryptedMnemonic: ENCRYPTED,
});
const EXTERNAL_MESSAGE_BOC = beginCell()
    .store(storeMessage(external({
        to: WALLET_ADDRESS,
        body: beginCell().storeUint(0x5443, 16).endCell(),
    })))
    .endCell()
    .toBoc()
    .toString('base64');
const TRANSACTION: WalletExecutionRequest = Object.freeze({
    network: 'mainnet',
    wallet: DESCRIPTOR,
    messages: Object.freeze([Object.freeze({
        to: `0:${'22'.repeat(32)}`,
        value: 1n,
        bounce: true,
        purpose: 'Approve raw TON Connect message',
    })]),
    validUntilUnix: NOW + 120,
    correlationId: 'tc_abababababababab_9',
});

class FakeDecryptor implements TonConnectMnemonicDecryptor {
    public calls = 0;
    public plaintext = MNEMONIC.join(' ');
    public error: unknown;

    public async decrypt(_encrypted: TonConnectEncryptedMnemonic, _password: string): Promise<string> {
        this.calls += 1;
        if (this.error !== undefined) throw this.error;
        return this.plaintext;
    }
}

class FakeCoordinator implements WalletExecutionCoordinator {
    public readonly network: NetworkId;
    public calls = 0;
    public request: WalletExecutionRequest | null = null;
    public options: WalletExecutionOptions | undefined;
    public captureValues: readonly string[] = Object.freeze([EXTERNAL_MESSAGE_BOC]);
    public result: WalletExecutionResult = Object.freeze({
        reference: Object.freeze({
            schemaVersion: 1,
            submissionId: 'tc_submission_1',
            network: 'mainnet',
            walletAddress: WALLET_ADDRESS,
            walletVersion: 'v4r2',
            correlationId: TRANSACTION.correlationId,
            submittedAtMs: NOW * 1_000,
            replayProtection: Object.freeze({ kind: 'seqno', seqno: 1 }),
            transportId: 'ab'.repeat(32),
        }),
        confirmation: Object.freeze({
            state: 'confirmed',
            reference: Object.freeze({
                schemaVersion: 1,
                submissionId: 'tc_submission_1',
                network: 'mainnet',
                walletAddress: WALLET_ADDRESS,
                walletVersion: 'v4r2',
                correlationId: TRANSACTION.correlationId,
                submittedAtMs: NOW * 1_000,
                replayProtection: Object.freeze({ kind: 'seqno', seqno: 1 }),
                transportId: 'ab'.repeat(32),
            }),
            checkedAtMs: NOW * 1_000 + 1,
            txHash: 'cd'.repeat(32),
            exitCode: null,
        }),
    });

    public constructor(network: NetworkId = 'mainnet') {
        this.network = network;
    }

    public execute(request: WalletExecutionRequest, options?: WalletExecutionOptions): Promise<WalletExecutionResult> {
        this.calls += 1;
        this.request = request;
        this.options = options;
        for (const value of this.captureValues) {
            options?.transientCapture?.capture(value);
        }
        return Promise.resolve(this.result);
    }
}

class FakeFactory implements TonConnectWalletCoordinatorFactory {
    public readonly network: NetworkId;
    public readonly coordinator: FakeCoordinator;
    public calls = 0;
    public keyPair: KeyPair | null = null;
    public wallet: WalletDescriptor | null = null;

    public constructor(network: NetworkId = 'mainnet', coordinatorNetwork: NetworkId = network) {
        this.network = network;
        this.coordinator = new FakeCoordinator(coordinatorNetwork);
    }

    public create(keyPair: KeyPair, wallet: WalletDescriptor): WalletExecutionCoordinator {
        this.calls += 1;
        this.keyPair = keyPair;
        this.wallet = wallet;
        return this.coordinator;
    }
}

function fixture(network: NetworkId = 'mainnet', factoryNetwork: NetworkId = network, coordinatorNetwork: NetworkId = factoryNetwork) {
    const decryptor = new FakeDecryptor();
    const factory = new FakeFactory(factoryNetwork, coordinatorNetwork);
    const executor = new PasswordConfirmedTransactionExecutor({
        network,
        decryptor,
        walletCoordinatorFactory: factory,
        signerClock: () => NOW,
    });
    return { decryptor, factory, executor };
}

async function expectExecutionFailure(work: Promise<unknown>): Promise<void> {
    await expect(work).rejects.toMatchObject({
        code: 'TRANSACTION_EXECUTION_FAILED',
    });
}

describe('password-confirmed TON Connect transaction executor', () => {
    it('passes the exact decoded request into the audited coordinator and returns secret-free metadata', async () => {
        const f = fixture();
        const signal = new AbortController().signal;
        const result = await f.executor.execute({
            transaction: TRANSACTION,
            account: ACCOUNT,
            password: PASSWORD,
            confirmation: { timeoutMs: 5_000, signal },
        });

        expect(f.decryptor.calls).toBe(1);
        expect(f.factory.calls).toBe(1);
        expect(f.factory.coordinator.calls).toBe(1);
        expect(f.factory.coordinator.request).toBe(TRANSACTION);
        expect(f.factory.coordinator.options?.confirmation).toEqual({ timeoutMs: 5_000, signal });
        expect(result).toEqual({
            network: 'mainnet',
            walletAddress: WALLET_ADDRESS,
            walletVersion: 'v4r2',
            correlationId: TRANSACTION.correlationId,
            submissionId: 'tc_submission_1',
            confirmationState: 'confirmed',
            txHash: 'cd'.repeat(32),
            exitCode: null,
        });
        expect(Object.isFrozen(result)).toBe(true);
        expect(Object.keys(result).join(' ')).not.toMatch(/mnemonic|seed|password|secret|key|signature|signed|boc|cell|payload/iu);
    });

    it('returns the exact transient external-message BOC only from the TON Connect protocol method', async () => {
        const f = fixture();
        const result = await f.executor.executeForTonConnect({
            transaction: TRANSACTION,
            account: ACCOUNT,
            password: PASSWORD,
        });

        expect(f.factory.coordinator.options?.transientCapture).toBeDefined();
        expect(result).toEqual({
            network: 'mainnet',
            walletAddress: WALLET_ADDRESS,
            walletVersion: 'v4r2',
            correlationId: TRANSACTION.correlationId,
            submissionId: 'tc_submission_1',
            confirmationState: 'confirmed',
            txHash: 'cd'.repeat(32),
            exitCode: null,
            externalMessageBoc: EXTERNAL_MESSAGE_BOC,
        });
        expect(Object.isFrozen(result)).toBe(true);
        expect(Buffer.from(result.externalMessageBoc, 'base64').toString('base64')).toBe(EXTERNAL_MESSAGE_BOC);
    });

    it('fails closed when the protocol method receives no external-message BOC', async () => {
        const f = fixture();
        f.factory.coordinator.captureValues = Object.freeze([]);

        await expectExecutionFailure(f.executor.executeForTonConnect({
            transaction: TRANSACTION,
            account: ACCOUNT,
            password: PASSWORD,
        }));
    });

    it('fails closed when the protocol method receives more than one BOC', async () => {
        const f = fixture();
        f.factory.coordinator.captureValues = Object.freeze([EXTERNAL_MESSAGE_BOC, EXTERNAL_MESSAGE_BOC]);

        await expectExecutionFailure(f.executor.executeForTonConnect({
            transaction: TRANSACTION,
            account: ACCOUNT,
            password: PASSWORD,
        }));
    });

    it.each([
        'not base64',
        beginCell().storeUint(0x5443, 16).endCell().toBoc().toString('base64'),
    ])('fails closed when the protocol method receives an invalid external-message BOC', async (value) => {
        const f = fixture();
        f.factory.coordinator.captureValues = Object.freeze([value]);

        await expectExecutionFailure(f.executor.executeForTonConnect({
            transaction: TRANSACTION,
            account: ACCOUNT,
            password: PASSWORD,
        }));
    });

    it.each([
        { password: '' },
        { transaction: Object.freeze({ ...TRANSACTION, network: 'testnet' as const }) },
        { account: Object.freeze({ ...ACCOUNT, address: `0:${'33'.repeat(32)}` }) },
        { account: Object.freeze({ ...ACCOUNT, wallet: Object.freeze({ ...DESCRIPTOR }) }) },
    ])('rejects public incoherence before decryption', async (changes) => {
        const f = fixture();
        f.factory.coordinator.captureValues = ['te6ccg=='];
        
        await expectExecutionFailure(
            f.executor.executeForTonConnect({
                transaction: { ...TRANSACTION, wallet: { kind: 'highload-v3', version: 'v3', subwalletId: 698983191, timeoutSeconds: 3600 } as any },
                account: { ...ACCOUNT, wallet: { kind: 'highload-v3', version: 'v3', subwalletId: 698983191, timeoutSeconds: 3600 } as any },
                password: PASSWORD,
            })
        );
        expect(f.factory.calls).toBe(0);
    });

    it('rejects Highload-shaped transaction identity before decryption', async () => {
        const f = fixture();
        await expectExecutionFailure(f.executor.execute({
            transaction: Object.freeze({
                ...TRANSACTION,
                wallet: {
                    kind: 'highload-v3',
                    version: 'highload-v3',
                    address: WALLET_ADDRESS,
                    subwalletId: 0,
                    timeoutSeconds: 60,
                },
            }) as never,
            account: ACCOUNT,
            password: PASSWORD,
        }));
        expect(f.decryptor.calls).toBe(0);
    });

    it('honors cancellation before decryption', async () => {
        const f = fixture();
        const controller = new AbortController();
        controller.abort();
        await expect(f.executor.execute({
            transaction: TRANSACTION,
            account: ACCOUNT,
            password: PASSWORD,
            confirmation: { signal: controller.signal },
        })).rejects.toBeInstanceOf(WalletExecutionError);
        expect(f.decryptor.calls).toBe(0);
    });

    it('maps decryption and mnemonic failures to stable TON Connect errors', async () => {
        const f = fixture();
        f.decryptor.error = new Error('raw decrypt detail');
        await expectExecutionFailure(f.executor.execute({
            transaction: TRANSACTION,
            account: ACCOUNT,
            password: PASSWORD,
        }));
        f.decryptor.error = undefined;
        f.decryptor.plaintext = 'not a mnemonic';
        await expectExecutionFailure(f.executor.execute({
            transaction: TRANSACTION,
            account: ACCOUNT,
            password: PASSWORD,
        }));
        expect(f.factory.calls).toBe(0);
    });

    it('rejects component network mismatches', () => {
        expect(() => fixture('mainnet', 'testnet')).toThrow(TonConnectWalletError);
    });

    it('rejects a coordinator network mismatch after authority verification', async () => {
        const f = fixture('mainnet', 'mainnet', 'testnet');
        await expectExecutionFailure(f.executor.execute({
            transaction: TRANSACTION,
            account: ACCOUNT,
            password: PASSWORD,
        }));
        expect(f.decryptor.calls).toBe(1);
        expect(f.factory.coordinator.calls).toBe(0);
    });
});
