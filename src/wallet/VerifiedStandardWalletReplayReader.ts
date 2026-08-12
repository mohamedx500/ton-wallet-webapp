import type { TonClient } from '@ton/ton';

import { parseAddress } from '../core/address';
import type { NetworkId } from '../core/chain';
import { WalletExecutionError } from './errors';
import type {
    SeqnoReplayProtection,
    StandardWalletDescriptor,
    StandardWalletReplayReader,
    WalletAccountSnapshot,
    WalletAccountStateSource,
} from './types';
import { assertWalletDescriptor } from './validation';

/** Strict adapter over the account-state and get-method surfaces of TonClient. */
export class TonClientWalletAccountStateSource implements WalletAccountStateSource {
    public readonly network: NetworkId;
    private readonly client: Pick<TonClient, 'getContractState' | 'runMethod'>;

    public constructor(client: Pick<TonClient, 'getContractState' | 'runMethod'>, network: NetworkId) {
        this.client = client;
        this.network = network;
    }

    public async getAccount(address: string): Promise<WalletAccountSnapshot> {
        const parsed = parseAddress(address);
        const state = await this.client.getContractState(parsed);
        return Object.freeze({
            network: this.network,
            address: parsed.toString(),
            state: state.state,
            balance: state.balance,
        });
    }

    public async getSeqno(address: string): Promise<number> {
        const result = await this.client.runMethod(parseAddress(address), 'seqno');
        return result.stack.readNumber();
    }
}

/**
 * Acquires standard-wallet replay state without treating an RPC failure as zero.
 *
 * `0` is returned only after the account source explicitly reports
 * `uninitialized`. Active accounts must successfully return a valid `seqno`;
 * frozen accounts are rejected because they cannot authorize an ordinary wallet
 * transfer.
 */
export class VerifiedStandardWalletReplayReader implements StandardWalletReplayReader {
    public readonly network: NetworkId;
    private readonly source: WalletAccountStateSource;

    public constructor(source: WalletAccountStateSource) {
        this.source = source;
        this.network = source.network;
    }

    public async read(wallet: StandardWalletDescriptor): Promise<SeqnoReplayProtection> {
        assertWalletDescriptor(wallet);
        const canonicalAddress = parseAddress(wallet.address).toString();

        let account: WalletAccountSnapshot;
        try {
            account = await this.source.getAccount(canonicalAddress);
        } catch (cause) {
            throw new WalletExecutionError(
                'REPLAY_STATE_UNAVAILABLE',
                'The wallet account state could not be verified.',
                { retryable: true, cause },
            );
        }

        if (account.network !== this.network) {
            throw new WalletExecutionError(
                'WALLET_NETWORK_MISMATCH',
                'The account-state source returned data for a different TON network.',
            );
        }
        if (!parseAddress(account.address).equals(parseAddress(canonicalAddress))) {
            throw new WalletExecutionError(
                'INVALID_WALLET_REQUEST',
                'The account-state source returned data for a different wallet.',
            );
        }
        if (account.balance < 0n) {
            throw new WalletExecutionError(
                'REPLAY_STATE_UNAVAILABLE',
                'The account-state source returned an invalid wallet balance.',
            );
        }

        if (account.state === 'uninitialized') {
            return Object.freeze({ kind: 'seqno', seqno: 0 });
        }
        if (account.state === 'frozen') {
            throw new WalletExecutionError(
                'REPLAY_STATE_UNAVAILABLE',
                'This wallet account is frozen and cannot send a standard transfer.',
            );
        }

        let seqno: number;
        try {
            seqno = await this.source.getSeqno(canonicalAddress);
        } catch (cause) {
            throw new WalletExecutionError(
                'REPLAY_STATE_UNAVAILABLE',
                'The active wallet seqno could not be verified.',
                { retryable: true, cause },
            );
        }

        if (!Number.isSafeInteger(seqno) || seqno < 0 || seqno > 0xffff_ffff) {
            throw new WalletExecutionError(
                'REPLAY_STATE_UNAVAILABLE',
                'The active wallet returned an invalid seqno.',
            );
        }

        return Object.freeze({ kind: 'seqno', seqno });
    }
}
