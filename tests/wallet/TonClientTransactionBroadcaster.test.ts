import { Address, Cell, beginCell, external, loadMessage } from '@ton/core';
import type { Message } from '@ton/core';
import { describe, expect, it } from 'vitest';

import {
    normalizedExternalMessageHash,
    TonClientTransactionBroadcaster,
    WalletExecutionError,
} from '../../src/wallet';
import type {
    ExternalMessageTransport,
    SignedWalletEnvelope,
    SubmissionIdSource,
} from '../../src/wallet';

const WALLET_ADDRESS = 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c';
const NOW_MS = 1_000_000_000;

class FixedSubmissionIds implements SubmissionIdSource {
    public constructor(private readonly value: string = 'submission_001') {}
    public next(): string {
        return this.value;
    }
}

class FakeTransport implements ExternalMessageTransport {
    public calls = 0;
    public boc: Buffer | null = null;
    public error: unknown;

    public async send(boc: Buffer): Promise<void> {
        this.calls += 1;
        this.boc = Buffer.from(boc);
        if (this.error !== undefined) throw this.error;
    }
}

function transportedMessage(transport: FakeTransport): Message {
    if (transport.boc === null) throw new Error('BOC not transported');
    const roots = Cell.fromBoc(transport.boc);
    if (roots.length !== 1 || roots[0] === undefined) throw new Error('invalid transported BOC');
    return loadMessage(roots[0].beginParse());
}

function envelope(overrides: Partial<SignedWalletEnvelope> = {}): SignedWalletEnvelope {
    return {
        network: 'mainnet',
        walletAddress: WALLET_ADDRESS,
        walletVersion: 'v4r2',
        correlationId: 'tx_001',
        validUntilUnix: Math.floor(NOW_MS / 1000) + 60,
        replayProtection: { kind: 'seqno', seqno: 9 },
        signedBody: beginCell().storeUint(123, 32).endCell(),
        ...overrides,
    };
}

function broadcaster(transport: FakeTransport, id = 'submission_001') {
    return new TonClientTransactionBroadcaster({
        network: 'mainnet',
        transport,
        clock: () => NOW_MS,
        submissionIds: new FixedSubmissionIds(id),
    });
}

async function expectCode(work: Promise<unknown>, code: string): Promise<WalletExecutionError> {
    try {
        await work;
        throw new Error('Expected submission to fail.');
    } catch (error) {
        expect(error).toBeInstanceOf(WalletExecutionError);
        expect((error as WalletExecutionError).code).toBe(code);
        return error as WalletExecutionError;
    }
}

describe('safe TonClient transaction broadcaster', () => {
    it('submits exactly once and returns only secret-free reference metadata', async () => {
        const transport = new FakeTransport();
        const reference = await broadcaster(transport).submit(envelope());

        expect(transport.calls).toBe(1);
        const message = transportedMessage(transport);
        expect(message.info.type).toBe('external-in');
        if (message.info.type !== 'external-in') throw new Error('not external-in');
        expect(message.info.dest.equals(Address.parse(WALLET_ADDRESS))).toBe(true);
        expect(reference).toEqual({
            schemaVersion: 1,
            submissionId: 'submission_001',
            network: 'mainnet',
            walletAddress: Address.parse(WALLET_ADDRESS).toString(),
            walletVersion: 'v4r2',
            correlationId: 'tx_001',
            submittedAtMs: NOW_MS,
            replayProtection: { kind: 'seqno', seqno: 9 },
            transportId: normalizedExternalMessageHash(message),
        });
        expect(JSON.stringify(reference)).not.toMatch(/boc|payload|body|signature|signed|secret|mnemonic/i);
    });

    it('captures the exact BOC bytes submitted to transport once', async () => {
        const transport = new FakeTransport();
        const captures: string[] = [];

        await broadcaster(transport).submit(envelope(), {
            transientCapture: {
                capture(base64Boc): void {
                    captures.push(base64Boc);
                },
            },
        });

        expect(transport.calls).toBe(1);
        expect(captures).toHaveLength(1);
        expect(transport.boc?.equals(Buffer.from(captures[0] ?? '', 'base64'))).toBe(true);
    });

    it('rejects capture failure before transport begins', async () => {
        const transport = new FakeTransport();
        const captureError = new Error('capture failed');

        const error = await expectCode(broadcaster(transport).submit(envelope(), {
            transientCapture: {
                capture(): void {
                    throw captureError;
                },
            },
        }), 'SUBMISSION_REJECTED');

        expect(error.cause).toBe(captureError);
        expect(error.submissionReference).toBeNull();
        expect(transport.calls).toBe(0);
    });

    it('normalizes state init and import fee out of the safe correlation hash', async () => {
        const body = beginCell().storeUint(456, 32).endCell();
        const destination = Address.parse(WALLET_ADDRESS);
        const withStateInit = external({
            to: destination,
            init: {
                code: beginCell().storeUint(1, 1).endCell(),
                data: beginCell().storeUint(0, 1).endCell(),
            },
            body,
        });
        const importedRepresentation: Message = {
            info: {
                type: 'external-in',
                dest: destination,
                importFee: 999n,
            },
            init: null,
            body,
        };

        expect(normalizedExternalMessageHash(withStateInit)).toBe(
            normalizedExternalMessageHash(importedRepresentation),
        );
    });

    it('carries state init into an undeployed-wallet external message', async () => {
        const transport = new FakeTransport();
        const stateInit = {
            code: beginCell().storeUint(1, 1).endCell(),
            data: beginCell().storeUint(0, 1).endCell(),
        };

        await broadcaster(transport).submit(envelope({ stateInit }));

        const decodedInit = transportedMessage(transport).init;
        expect(decodedInit).not.toBeNull();
        expect(decodedInit?.code?.equals(stateInit.code)).toBe(true);
        expect(decodedInit?.data?.equals(stateInit.data)).toBe(true);
    });

    it('rejects network mismatch before transport', async () => {
        const transport = new FakeTransport();

        await expectCode(broadcaster(transport).submit(envelope({ network: 'testnet' })), 'WALLET_NETWORK_MISMATCH');
        expect(transport.calls).toBe(0);
    });

    it('rejects expired signed envelopes before transport', async () => {
        const transport = new FakeTransport();

        await expectCode(
            broadcaster(transport).submit(envelope({ validUntilUnix: Math.floor(NOW_MS / 1000) })),
            'REQUEST_EXPIRED',
        );
        expect(transport.calls).toBe(0);
    });

    it('rejects invalid submission identifiers before transport', async () => {
        const transport = new FakeTransport();

        await expectCode(broadcaster(transport, 'bad submission id').submit(envelope()), 'SUBMISSION_REJECTED');
        expect(transport.calls).toBe(0);
    });

    it('classifies explicit local rejection as SUBMISSION_REJECTED', async () => {
        const transport = new FakeTransport();
        transport.error = Object.assign(new Error('invalid request'), { code: 'INVALID_ARGUMENT' });

        const error = await expectCode(broadcaster(transport).submit(envelope()), 'SUBMISSION_REJECTED');

        expect(transport.calls).toBe(1);
        expect(error.retryable).toBe(false);
    });

    it('classifies a no-request HTTP 400 as a definite rejection', async () => {
        const transport = new FakeTransport();
        transport.error = { response: { status: 400 } };

        await expectCode(broadcaster(transport).submit(envelope()), 'SUBMISSION_REJECTED');
        expect(transport.calls).toBe(1);
    });

    it.each([
        new Error('network disconnected'),
        Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }),
        { response: { status: 500 }, request: {} },
        { response: { status: 400 }, request: {} },
        'unknown failure',
    ])('classifies inconclusive post-attempt failure as SUBMISSION_AMBIGUOUS', async (cause) => {
        const transport = new FakeTransport();
        transport.error = cause;

        const error = await expectCode(broadcaster(transport).submit(envelope()), 'SUBMISSION_AMBIGUOUS');

        expect(transport.calls).toBe(1);
        expect(error.retryable).toBe(false);
        expect(error.submissionReference).toMatchObject({
            network: 'mainnet',
            walletVersion: 'v4r2',
            correlationId: 'tx_001',
            replayProtection: { kind: 'seqno', seqno: 9 },
        });
        expect(error.submissionReference?.transportId).toMatch(/^[0-9a-f]{64}$/);
        expect(JSON.stringify(error.submissionReference)).not.toMatch(/signedBody|signature|boc|payload/i);
    });
});
