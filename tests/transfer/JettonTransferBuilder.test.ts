import { createRequire } from 'node:module';

import { Address, beginCell } from '@ton/core';
import type { Cell } from '@ton/core';
import { describe, expect, it } from 'vitest';

import {
    JETTON_TRANSFER_OPCODE,
    buildJettonTransferBody,
    buildJettonTransferMessage,
} from '../../src/transfer';
import {
    JETTON_MASTER,
    OWNER,
    QUERY_ID,
    RECIPIENT,
    SENDER_JETTON_WALLET,
    jettonIntent,
} from './fixtures';

interface OfficialJettonTransferParams {
    readonly queryId: bigint;
    readonly amount: bigint;
    readonly destination: string;
    readonly responseDestination: string;
    readonly forwardTonAmount: bigint;
    readonly forwardPayload?: Cell;
}

type OfficialJettonTransferBuilder = (params: OfficialJettonTransferParams) => Cell;

const require = createRequire(import.meta.url);
const sdkRoot = require.resolve('@ston-fi/sdk/package.json');
const sdkBuilderPath = sdkRoot.replace(
    /package\.json$/u,
    'dist/utils/createJettonTransferMessage.cjs',
);
const { createJettonTransferMessage } = require(sdkBuilderPath) as {
    readonly createJettonTransferMessage: OfficialJettonTransferBuilder;
};

describe('strict TEP-74 message construction', () => {
    it('encodes every TEP-74 field and keeps attached TON separate', () => {
        const intent = jettonIntent();
        const message = buildJettonTransferMessage(intent);
        const body = message.body;
        expect(body).toBeDefined();

        const slice = body?.beginParse();
        expect(slice?.loadUint(32)).toBe(JETTON_TRANSFER_OPCODE);
        expect(slice?.loadUintBig(64)).toBe(QUERY_ID);
        expect(slice?.loadCoins()).toBe(1_250_000n);
        expect(slice?.loadAddress().equals(Address.parse(RECIPIENT))).toBe(true);
        expect(slice?.loadAddress().equals(Address.parse(OWNER))).toBe(true);
        expect(slice?.loadBit()).toBe(false);
        expect(slice?.loadCoins()).toBe(10_000_000n);
        expect(slice?.loadBit()).toBe(false);
        expect(slice?.remainingBits).toBe(0);
        expect(slice?.remainingRefs).toBe(0);

        expect(Address.parse(message.to).equals(Address.parse(SENDER_JETTON_WALLET))).toBe(true);
        expect(Address.parse(message.to).equals(Address.parse(JETTON_MASTER))).toBe(false);
        expect(Address.parse(message.to).equals(Address.parse(RECIPIENT))).toBe(false);
        expect(message.value).toBe(50_000_000n);
        expect(message.bounce).toBe(true);
        expect(Object.isFrozen(message)).toBe(true);
    });

    it.each([true, false])('preserves an explicit Jetton bounce policy of %s', (bounce) => {
        expect(buildJettonTransferMessage(jettonIntent({ bounce })).bounce).toBe(bounce);
    });

    it.each([
        { name: 'no forward payload', intent: jettonIntent() },
        { name: 'referenced comment payload', intent: jettonIntent({ comment: 'memo-7' }) },
    ])('matches the installed SDK byte-for-byte for $name', ({ intent }) => {
        const body = buildJettonTransferBody(intent);
        const forwardPayload = intent.comment === undefined
            ? undefined
            : buildCommentOracle(intent.comment);
        const expected = createJettonTransferMessage({
            queryId: intent.queryId,
            amount: intent.amount,
            destination: intent.recipient,
            responseDestination: intent.responseDestination,
            forwardTonAmount: intent.forwardTonAmount,
            ...(forwardPayload === undefined ? {} : { forwardPayload }),
        });

        expect(body.toBoc().equals(expected.toBoc())).toBe(true);
    });

    it('encodes a comment as the referenced branch of Either Cell ^Cell', () => {
        const body = buildJettonTransferBody(jettonIntent({ comment: 'memo-7' }));
        const slice = body.beginParse();
        slice.loadUint(32);
        slice.loadUintBig(64);
        slice.loadCoins();
        slice.loadAddress();
        slice.loadAddress();
        expect(slice.loadBit()).toBe(false);
        slice.loadCoins();
        expect(slice.loadBit()).toBe(true);
        const comment = slice.loadRef().beginParse();
        expect(comment.loadUint(32)).toBe(0);
        expect(comment.loadStringTail()).toBe('memo-7');
        expect(slice.remainingRefs).toBe(0);
    });

    it.each([0n, -1n, 1n << 64n])('rejects invalid query_id %s', (queryId) => {
        expect(() => buildJettonTransferBody(jettonIntent({ queryId }))).toThrow(
            expect.objectContaining({ code: 'INVALID_JETTON_QUERY_ID' }),
        );
    });

    it('rejects response destinations outside the sending owner', () => {
        expect(() => buildJettonTransferBody(jettonIntent({ responseDestination: RECIPIENT }))).toThrow(
            expect.objectContaining({ code: 'INVALID_TRANSFER_INTENT' }),
        );
    });

    it('rejects the Jetton master as the outgoing message destination', () => {
        expect(() => buildJettonTransferMessage(jettonIntent({
            senderJettonWalletAddress: JETTON_MASTER,
        }))).toThrow(expect.objectContaining({ code: 'INVALID_TRANSFER_INTENT' }));
    });
});

function buildCommentOracle(comment: string): Cell {
    return beginCell()
        .storeUint(0, 32)
        .storeStringTail(comment)
        .endCell();
}
