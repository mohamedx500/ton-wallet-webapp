import { SendMode, beginCell, internal } from '@ton/core';
import type { Cell } from '@ton/core';
import { keyPairFromSeed, sign } from '@ton/crypto';
import { WalletContractV3R1, WalletContractV3R2, WalletContractV4, WalletContractV5R1 } from '@ton/ton';
import { describe, expect, it } from 'vitest';

import {
    OfficialStandardWalletSigner,
    WalletExecutionError,
} from '../../src/wallet';
import type {
    StandardWalletContractVersion,
    StandardWalletDescriptor,
    WalletExecutionRequest,
} from '../../src/wallet';

const MAINNET_GLOBAL_ID = -239;
const STANDARD_WALLET_ID = 698983191;
const VALID_UNTIL = 1_000_120;
const DESTINATION = 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c';
const SEQNO = 7;
const SEED = Buffer.alloc(32, 7);
const { publicKey, secretKey } = keyPairFromSeed(SEED);

const authority = {
    publicKey,
    async sign(message: Cell): Promise<Buffer> {
        return sign(message.hash(), secretKey);
    },
};

function contractFor(version: StandardWalletContractVersion) {
    switch (version) {
        case 'v3r1':
            return WalletContractV3R1.create({ publicKey, workchain: 0, walletId: STANDARD_WALLET_ID });
        case 'v3r2':
            return WalletContractV3R2.create({ publicKey, workchain: 0, walletId: STANDARD_WALLET_ID });
        case 'v4r2':
            return WalletContractV4.create({ publicKey, workchain: 0, walletId: STANDARD_WALLET_ID });
        case 'v5r1':
            return WalletContractV5R1.create({
                publicKey,
                walletId: {
                    networkGlobalId: MAINNET_GLOBAL_ID,
                    context: { walletVersion: 'v5r1', workchain: 0, subwalletNumber: 0 },
                },
            });
    }
}

function requestFor(version: StandardWalletContractVersion): WalletExecutionRequest {
    const contract = contractFor(version);
    const wallet: StandardWalletDescriptor = {
        kind: 'standard',
        version,
        address: contract.address.toString(),
        ...(version === 'v5r1' ? { subwalletId: 0 } : { subwalletId: STANDARD_WALLET_ID }),
    };

    return {
        network: 'mainnet',
        wallet,
        messages: [
            {
                to: DESTINATION,
                value: 150_000_000n,
                body: beginCell().storeUint(0x0f8a7ea5, 32).endCell(),
                bounce: true,
                purpose: 'Execute a deterministic parity transfer',
            },
        ],
        validUntilUnix: VALID_UNTIL,
        correlationId: `signer_${version}`,
    };
}

async function expectedOfficialBody(version: StandardWalletContractVersion, request: WalletExecutionRequest): Promise<Cell> {
    const contract = contractFor(version);
    const messages = request.messages.map((message) =>
        internal({
            to: message.to,
            value: message.value,
            ...(message.body === undefined ? {} : { body: message.body }),
            bounce: message.bounce,
        }),
    );

    switch (version) {
        case 'v3r1':
            if (!(contract instanceof WalletContractV3R1)) throw new Error('fixture mismatch');
            return contract.createTransfer({
                seqno: SEQNO,
                timeout: VALID_UNTIL,
                messages,
                sendMode: SendMode.PAY_GAS_SEPARATELY,
                secretKey,
            });
        case 'v3r2':
            if (!(contract instanceof WalletContractV3R2)) throw new Error('fixture mismatch');
            return contract.createTransfer({
                seqno: SEQNO,
                timeout: VALID_UNTIL,
                messages,
                sendMode: SendMode.PAY_GAS_SEPARATELY,
                secretKey,
            });
        case 'v4r2':
            if (!(contract instanceof WalletContractV4)) throw new Error('fixture mismatch');
            return contract.createTransfer({
                seqno: SEQNO,
                timeout: VALID_UNTIL,
                messages,
                sendMode: SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
                secretKey,
            });
        case 'v5r1':
            if (!(contract instanceof WalletContractV5R1)) throw new Error('fixture mismatch');
            return contract.createTransfer({
                seqno: SEQNO,
                timeout: VALID_UNTIL,
                messages,
                sendMode: SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
                authType: 'external',
                secretKey,
            });
    }
}

describe.each<StandardWalletContractVersion>(['v3r1', 'v3r2', 'v4r2', 'v5r1'])(
    'official %s standard-wallet signer',
    (version) => {
        it('matches the official SDK transfer byte for byte', async () => {
            const request = requestFor(version);
            const signer = new OfficialStandardWalletSigner({ authority, clock: () => 1_000_000 });

            const envelope = await signer.sign(request, { kind: 'seqno', seqno: SEQNO });
            const expected = await expectedOfficialBody(version, request);

            expect(envelope.signedBody.toBoc().equals(expected.toBoc())).toBe(true);
            expect(envelope.replayProtection).toEqual({ kind: 'seqno', seqno: SEQNO });
            expect(envelope.stateInit).toBeUndefined();
        });
    },
);

describe('standard-wallet signer safety', () => {
    it('includes official state init only for a verified zero seqno', async () => {
        const request = requestFor('v4r2');
        const signer = new OfficialStandardWalletSigner({ authority, clock: () => 1_000_000 });

        const envelope = await signer.sign(request, { kind: 'seqno', seqno: 0 });

        expect(envelope.stateInit?.code).toBeDefined();
        expect(envelope.stateInit?.data).toBeDefined();
    });

    it('rejects Highload replay protection instead of guessing a seqno', async () => {
        const signer = new OfficialStandardWalletSigner({ authority, clock: () => 1_000_000 });

        await expect(
            signer.sign(requestFor('v4r2'), {
                kind: 'highload-query',
                queryId: 1n,
                createdAtUnix: 1_000_000,
            }),
        ).rejects.toMatchObject({ code: 'INVALID_WALLET_REQUEST' });
    });

    it('rejects a descriptor address that does not match the signing public key', async () => {
        const signer = new OfficialStandardWalletSigner({ authority, clock: () => 1_000_000 });
        const request = requestFor('v4r2');
        const mismatched: WalletExecutionRequest = {
            ...request,
            wallet: { ...request.wallet, address: DESTINATION },
        };

        await expect(signer.sign(mismatched, { kind: 'seqno', seqno: SEQNO })).rejects.toMatchObject({
            code: 'INVALID_WALLET_REQUEST',
        });
    });

    it('does not expose signing authority in the envelope', async () => {
        const signer = new OfficialStandardWalletSigner({ authority, clock: () => 1_000_000 });
        const envelope = await signer.sign(requestFor('v3r2'), { kind: 'seqno', seqno: SEQNO });
        const keys = Object.keys(envelope).join(' ');

        expect(keys).not.toMatch(/secret|private|publicKey|signature|mnemonic|authority/i);
        expect(envelope).not.toBeInstanceOf(WalletExecutionError);
    });
});
