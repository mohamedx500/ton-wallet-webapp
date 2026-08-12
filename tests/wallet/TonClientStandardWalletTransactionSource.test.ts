import { Address, beginCell, Dictionary, external } from '@ton/core';
import type { Transaction } from '@ton/core';
import { describe, expect, it } from 'vitest';

import {
    normalizedExternalMessageHash,
    TonClientStandardWalletTransactionSource,
} from '../../src/wallet';

const WALLET_ADDRESS = 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c';

function genericDescription(aborted: boolean, exitCode: number): Transaction['description'] {
    return {
        type: 'generic',
        creditFirst: false,
        computePhase: {
            type: 'vm',
            success: exitCode === 0,
            messageStateUsed: false,
            accountActivated: false,
            gasFees: 1n,
            gasUsed: 1n,
            gasLimit: 1n,
            mode: 0,
            exitCode,
            vmSteps: 1,
            vmInitStateHash: 0n,
            vmFinalStateHash: 0n,
        },
        aborted,
        destroyed: false,
    };
}

function transaction(inMessage: Transaction['inMessage'], aborted = false, exitCode = 0): Transaction {
    return {
        address: 0n,
        lt: 99n,
        prevTransactionHash: 0n,
        prevTransactionLt: 0n,
        now: 1234,
        outMessagesCount: 0,
        oldStatus: 'active',
        endStatus: 'active',
        inMessage,
        outMessages: Dictionary.empty(),
        totalFees: { coins: 1n },
        stateUpdate: { oldHash: Buffer.alloc(32), newHash: Buffer.alloc(32) },
        description: genericDescription(aborted, exitCode),
        raw: beginCell().endCell(),
        hash: () => Buffer.alloc(32, 7),
    };
}

describe('TonClient standard-wallet transaction source', () => {
    it('returns normalized metadata without exposing transaction messages or raw cells', async () => {
        const message = external({
            to: Address.parse(WALLET_ADDRESS),
            body: beginCell().storeUint(42, 32).endCell(),
        });
        let requestedLimit: number | null = null;
        let archival: boolean | null = null;
        const client = {
            async getTransactions(_address: Address, options: { limit: number; archival?: boolean }) {
                requestedLimit = options.limit;
                archival = options.archival ?? null;
                return [transaction(message, true, 35)];
            },
            async runMethod() {
                throw new Error('not used');
            },
        };

        const source = new TonClientStandardWalletTransactionSource(client as never, 'mainnet');
        const records = await source.getRecentTransactions(WALLET_ADDRESS, 12);

        expect(requestedLimit).toBe(12);
        expect(archival).toBe(true);
        expect(records).toEqual([{
            txHash: Buffer.alloc(32, 7).toString('hex'),
            lt: 99n,
            nowUnix: 1234,
            inboundExternalMessageHash: normalizedExternalMessageHash(message),
            aborted: true,
            exitCode: '35',
        }]);
        expect(JSON.stringify(records, (_key, value) => typeof value === 'bigint' ? value.toString() : value))
            .not.toMatch(/body|payload|boc|signature|raw/i);
    });

    it('reads the current standard-wallet seqno through the canonical get method', async () => {
        let requestedRaw: string | null = null;
        const client = {
            async getTransactions() {
                return [];
            },
            async runMethod(address: Address, method: string) {
                requestedRaw = address.toRawString();
                expect(method).toBe('seqno');
                return { stack: { readNumber: () => 17 } };
            },
        };

        const source = new TonClientStandardWalletTransactionSource(client as never, 'testnet');

        await expect(source.getSeqno(WALLET_ADDRESS)).resolves.toBe(17);
        expect(requestedRaw).toBe(Address.parse(WALLET_ADDRESS).toRawString());
    });
});
