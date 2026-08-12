import { Address, TupleReader } from '@ton/core';
import { describe, expect, it } from 'vitest';

import { TonClientWalletAccountStateSource } from '../../src/wallet';

const WALLET_ADDRESS = 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c';

function blockState(state: 'active' | 'uninitialized' | 'frozen') {
    return {
        balance: 123n,
        extra_currencies: undefined,
        state,
        code: null,
        data: null,
        lastTransaction: null,
        blockId: { workchain: 0, shard: '0', seqno: 1 },
        timestampt: 1,
    };
}

describe('TonClient wallet account-state adapter', () => {
    it('maps the canonical TonClient uninitialized state without balance heuristics', async () => {
        let requestedRaw: string | null = null;
        const client = {
            async getContractState(address: Address) {
                requestedRaw = address.toRawString();
                return blockState('uninitialized');
            },
            async runMethod() {
                throw new Error('not used');
            },
        };
        const source = new TonClientWalletAccountStateSource(client, 'testnet');

        const snapshot = await source.getAccount(WALLET_ADDRESS);

        expect(snapshot).toMatchObject({ network: 'testnet', state: 'uninitialized', balance: 123n });
        expect(requestedRaw).toBe(Address.parse(WALLET_ADDRESS).toRawString());
    });

    it('reads seqno from the canonical get-method result', async () => {
        const client = {
            async getContractState() {
                return blockState('active');
            },
            async runMethod(_address: Address, method: string) {
                expect(method).toBe('seqno');
                return {
                    gas_used: 1,
                    stack: new TupleReader([{ type: 'int', value: 77n }]),
                };
            },
        };
        const source = new TonClientWalletAccountStateSource(client, 'mainnet');

        await expect(source.getSeqno(WALLET_ADDRESS)).resolves.toBe(77);
    });
});
