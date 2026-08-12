import { describe, expect, it } from 'vitest';

import {
    VerifiedStandardWalletReplayReader,
    WalletExecutionError,
} from '../../src/wallet';
import type {
    StandardWalletDescriptor,
    WalletAccountSnapshot,
    WalletAccountStateSource,
} from '../../src/wallet';

const WALLET_ADDRESS = 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c';
const OTHER_ADDRESS = 'Ef8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAU';

const wallet: StandardWalletDescriptor = {
    kind: 'standard',
    version: 'v4r2',
    address: WALLET_ADDRESS,
    subwalletId: 698983191,
};

class FakeAccountStateSource implements WalletAccountStateSource {
    public readonly network: 'mainnet' | 'testnet';
    public account: WalletAccountSnapshot;
    public seqno = 12;
    public accountError: unknown;
    public seqnoError: unknown;
    public seqnoReads = 0;

    public constructor(
        state: WalletAccountSnapshot['state'],
        network: 'mainnet' | 'testnet' = 'mainnet',
    ) {
        this.network = network;
        this.account = {
            network,
            address: WALLET_ADDRESS,
            state,
            balance: 1_000_000_000n,
        };
    }

    public async getAccount(_address: string): Promise<WalletAccountSnapshot> {
        if (this.accountError !== undefined) throw this.accountError;
        return this.account;
    }

    public async getSeqno(_address: string): Promise<number> {
        this.seqnoReads += 1;
        if (this.seqnoError !== undefined) throw this.seqnoError;
        return this.seqno;
    }
}

async function expectCode(work: Promise<unknown>, code: string): Promise<void> {
    try {
        await work;
        throw new Error('Expected replay-state acquisition to fail.');
    } catch (error) {
        expect(error).toBeInstanceOf(WalletExecutionError);
        expect((error as WalletExecutionError).code).toBe(code);
    }
}

describe('verified standard-wallet replay reader', () => {
    it('reads seqno from a verified active wallet', async () => {
        const source = new FakeAccountStateSource('active');
        source.seqno = 44;
        const reader = new VerifiedStandardWalletReplayReader(source);

        await expect(reader.read(wallet)).resolves.toEqual({ kind: 'seqno', seqno: 44 });
        expect(source.seqnoReads).toBe(1);
    });

    it('returns zero only after an explicit uninitialized account state', async () => {
        const source = new FakeAccountStateSource('uninitialized');
        source.seqnoError = new Error('seqno must not be called');
        const reader = new VerifiedStandardWalletReplayReader(source);

        await expect(reader.read(wallet)).resolves.toEqual({ kind: 'seqno', seqno: 0 });
        expect(source.seqnoReads).toBe(0);
    });

    it('rejects frozen wallets without reading seqno', async () => {
        const source = new FakeAccountStateSource('frozen');
        const reader = new VerifiedStandardWalletReplayReader(source);

        await expectCode(reader.read(wallet), 'REPLAY_STATE_UNAVAILABLE');
        expect(source.seqnoReads).toBe(0);
    });

    it('does not convert account-state RPC failure into seqno zero', async () => {
        const source = new FakeAccountStateSource('active');
        source.accountError = new Error('RPC unavailable');
        const reader = new VerifiedStandardWalletReplayReader(source);

        await expectCode(reader.read(wallet), 'REPLAY_STATE_UNAVAILABLE');
        expect(source.seqnoReads).toBe(0);
    });

    it('does not convert active-wallet get-method failure into seqno zero', async () => {
        const source = new FakeAccountStateSource('active');
        source.seqnoError = new Error('get method unavailable');
        const reader = new VerifiedStandardWalletReplayReader(source);

        await expectCode(reader.read(wallet), 'REPLAY_STATE_UNAVAILABLE');
    });

    it('rejects a negative or out-of-range active seqno', async () => {
        const source = new FakeAccountStateSource('active');
        const reader = new VerifiedStandardWalletReplayReader(source);

        source.seqno = -1;
        await expectCode(reader.read(wallet), 'REPLAY_STATE_UNAVAILABLE');

        source.seqno = 0x1_0000_0000;
        await expectCode(reader.read(wallet), 'REPLAY_STATE_UNAVAILABLE');
    });

    it('rejects account data from another network', async () => {
        const source = new FakeAccountStateSource('active', 'mainnet');
        source.account = { ...source.account, network: 'testnet' };
        const reader = new VerifiedStandardWalletReplayReader(source);

        await expectCode(reader.read(wallet), 'WALLET_NETWORK_MISMATCH');
        expect(source.seqnoReads).toBe(0);
    });

    it('rejects account data for another address', async () => {
        const source = new FakeAccountStateSource('active');
        source.account = { ...source.account, address: OTHER_ADDRESS };
        const reader = new VerifiedStandardWalletReplayReader(source);

        await expectCode(reader.read(wallet), 'INVALID_WALLET_REQUEST');
        expect(source.seqnoReads).toBe(0);
    });

    it('rejects invalid negative balances in the account snapshot', async () => {
        const source = new FakeAccountStateSource('active');
        source.account = { ...source.account, balance: -1n };
        const reader = new VerifiedStandardWalletReplayReader(source);

        await expectCode(reader.read(wallet), 'REPLAY_STATE_UNAVAILABLE');
        expect(source.seqnoReads).toBe(0);
    });
});
