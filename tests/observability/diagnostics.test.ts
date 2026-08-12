import { describe, expect, it } from 'vitest';

import { InvalidAmountError } from '../../src/core/errors';
import {
    BlockchainDiagnostics,
    MemoryDiagnosticSink,
    normalizeFailure,
    sanitizeAttributes,
    type CorrelationIdSource,
} from '../../src/observability';

class FixedCorrelationIds implements CorrelationIdSource {
    public next(): string {
        return 'operation-0001';
    }
}

describe('structured blockchain diagnostics', () => {
    it('records a correlated lifecycle and duration without recording payload data', () => {
        const sink = new MemoryDiagnosticSink();
        let now = 1_000;
        const diagnostics = new BlockchainDiagnostics({
            sink,
            clock: () => now,
            correlationIds: new FixedCorrelationIds(),
        });

        const context = diagnostics.start('submission', {
            network: 'mainnet',
            messageCount: 1,
            payloadBoc: 'te6cckEBAQEA...',
        });
        now = 1_075;
        diagnostics.succeed(context, { txHash: 'abc123' });

        expect(sink.events()).toEqual([
            {
                schemaVersion: 1,
                timestamp: '1970-01-01T00:00:01.000Z',
                level: 'info',
                operation: 'submission',
                stage: 'started',
                correlationId: 'operation-0001',
                attributes: { network: 'mainnet', messageCount: 1 },
            },
            {
                schemaVersion: 1,
                timestamp: '1970-01-01T00:00:01.075Z',
                level: 'info',
                operation: 'submission',
                stage: 'succeeded',
                correlationId: 'operation-0001',
                durationMs: 75,
                attributes: { network: 'mainnet', messageCount: 1, txHash: 'abc123' },
            },
        ]);
    });

    it('drops every sensitive key and refuses nested objects and arrays', () => {
        const safe = sanitizeAttributes({
            network: 'testnet',
            rpcMethod: 'getBalance',
            mnemonic: 'one two three',
            seedPhrase: 'one two three',
            privateKey: 'deadbeef',
            password: 'hunter2',
            sessionSecret: 'secret',
            authorization: 'Bearer token',
            signature: 'signature',
            payload: 'payload',
            bodyCell: 'cell',
            boc: 'te6cc...',
            vendorResponse: { payload: 'hidden' },
            messages: [{ body: 'hidden' }],
        });

        expect(safe).toEqual({ network: 'testnet', rpcMethod: 'getBalance' });
    });

    it('drops sensitive-looking string values even under an innocent key', () => {
        expect(sanitizeAttributes({ note: 'password=do-not-log', provider: 'stonfi' })).toEqual({ provider: 'stonfi' });
        expect(sanitizeAttributes({ header: 'Bearer abc.def.ghi', provider: 'stonfi' })).toEqual({ provider: 'stonfi' });
    });

    it('normalizes structured failures without copying messages, details, causes, or stacks', () => {
        const error = new InvalidAmountError('The password and amount were invalid.', {
            value: 'sensitive-value',
        });
        const normalized = normalizeFailure(error);

        expect(normalized).toEqual({
            type: 'InvalidAmountError',
            code: 'INVALID_AMOUNT',
            category: 'validation',
            retryable: false,
        });
        expect(JSON.stringify(normalized)).not.toContain('password');
        expect(JSON.stringify(normalized)).not.toContain('sensitive-value');
    });

    it('measures RPC latency and records a normalized failure reason', async () => {
        const sink = new MemoryDiagnosticSink();
        let now = 10_000;
        const diagnostics = new BlockchainDiagnostics({
            sink,
            clock: () => now,
            correlationIds: new FixedCorrelationIds(),
        });

        const work = diagnostics.measure('rpc', { network: 'mainnet', rpcMethod: 'runGetMethod' }, async () => {
            now = 10_240;
            throw Object.assign(new Error('Bearer secret must not appear'), { name: 'NetworkError' });
        });

        await expect(work).rejects.toThrow();
        const failed = sink.events()[1];
        expect(failed).toMatchObject({
            operation: 'rpc',
            stage: 'failed',
            durationMs: 240,
            error: {
                type: 'NetworkError',
                code: 'NETWORK_ERROR',
                category: 'network',
                retryable: true,
            },
        });
        expect(JSON.stringify(failed)).not.toContain('Bearer secret');
    });
});
