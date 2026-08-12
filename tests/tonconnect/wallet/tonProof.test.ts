import { createHash } from 'node:crypto';

import { Address } from '@ton/core';
import { keyPairFromSeed, sign, signVerify } from '@ton/crypto';
import { describe, expect, it } from 'vitest';

import {
    TonConnectWalletError,
    TonProofService,
    prepareTonProof,
} from '../../../src/tonconnect/wallet';

const NOW = 1_800_000_000;
const ADDRESS = `0:${'11'.repeat(32)}`;

function independentHash(domain: string, payload: string, timestamp: number): Buffer {
    const address = Address.parse(ADDRESS);
    const addressBytes = Buffer.alloc(36);
    addressBytes.writeInt32BE(address.workChain, 0);
    address.hash.copy(addressBytes, 4);
    const domainBytes = Buffer.from(domain, 'utf8');
    const domainLength = Buffer.alloc(4);
    domainLength.writeUInt32LE(domainBytes.length, 0);
    const time = Buffer.alloc(8);
    time.writeBigUInt64LE(BigInt(timestamp));
    const message = Buffer.concat([
        Buffer.from('ton-proof-item-v2/', 'utf8'),
        addressBytes,
        domainLength,
        domainBytes,
        time,
        Buffer.from(payload, 'utf8'),
    ]);
    const inner = createHash('sha256').update(message).digest();
    return createHash('sha256')
        .update(Buffer.concat([Buffer.from([0xff, 0xff]), Buffer.from('ton-connect'), inner]))
        .digest();
}

describe('TON proof service', () => {
    it('matches an independent byte-layout oracle and returns a verifiable proof', async () => {
        const keyPair = keyPairFromSeed(Buffer.alloc(32, 7));
        const service = new TonProofService({ network: 'mainnet', clock: () => NOW });
        const result = await service.create({
            network: 'mainnet',
            walletAddress: ADDRESS,
            manifestUrl: 'https://dapp.example/tonconnect-manifest.json',
            payload: 'nonce-ä',
            timestamp: NOW,
        }, {
            walletAddress: ADDRESS,
            sign(messageHash) {
                return Promise.resolve(sign(Buffer.from(messageHash), keyPair.secretKey));
            },
        });
        const expectedHash = independentHash('dapp.example', 'nonce-ä', NOW);

        expect(result).toEqual({
            name: 'ton_proof',
            proof: {
                timestamp: NOW,
                domain: { lengthBytes: 12, value: 'dapp.example' },
                signature: expect.any(String),
                payload: 'nonce-ä',
            },
        });
        expect(signVerify(expectedHash, Buffer.from(result.proof.signature, 'base64'), keyPair.publicKey)).toBe(true);
        expect(Object.isFrozen(result)).toBe(true);
        expect(Object.isFrozen(result.proof)).toBe(true);
        keyPair.secretKey.fill(0);
    });

    it('exposes the exact prepared message for deterministic parity tests', () => {
        const prepared = prepareTonProof({
            network: 'testnet',
            walletAddress: ADDRESS,
            manifestUrl: 'https://login.example/path',
            payload: 'abc',
            timestamp: NOW,
        }, 'testnet', NOW, 300);

        expect(prepared.domain).toBe('login.example');
        expect(prepared.hash).toEqual(independentHash('login.example', 'abc', NOW));
        expect(prepared.message.subarray(0, 18).toString('utf8')).toBe('ton-proof-item-v2/');
    });

    it.each([
        ['network', { network: 'testnet' }],
        ['reserved domain', { manifestUrl: 'https://tonkeeper/manifest.json' }],
        ['stale timestamp', { timestamp: NOW - 301 }],
        ['future timestamp', { timestamp: NOW + 61 }],
        ['empty payload', { payload: '' }],
    ] as const)('rejects invalid %s before signing', async (_label, override) => {
        const service = new TonProofService({ network: 'mainnet', clock: () => NOW });
        let signed = false;
        await expect(service.create({
            network: 'mainnet',
            walletAddress: ADDRESS,
            manifestUrl: 'https://dapp.example/manifest.json',
            payload: 'nonce',
            timestamp: NOW,
            ...override,
        }, {
            walletAddress: ADDRESS,
            sign() {
                signed = true;
                return Promise.resolve(new Uint8Array(64));
            },
        })).rejects.toBeInstanceOf(TonConnectWalletError);
        expect(signed).toBe(false);
    });

    it('rejects a signing authority for a different wallet', async () => {
        const service = new TonProofService({ network: 'mainnet', clock: () => NOW });
        await expect(service.create({
            network: 'mainnet',
            walletAddress: ADDRESS,
            manifestUrl: 'https://dapp.example/manifest.json',
            payload: 'nonce',
            timestamp: NOW,
        }, {
            walletAddress: `0:${'22'.repeat(32)}`,
            sign: () => Promise.resolve(new Uint8Array(64)),
        })).rejects.toMatchObject({ code: 'INVALID_TON_PROOF_REQUEST' });
    });
});
