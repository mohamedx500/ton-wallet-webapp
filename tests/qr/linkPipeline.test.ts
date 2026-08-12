import { describe, expect, it } from 'vitest';
import { classifyScanResult } from '../../src/qr/classifier';
import { decodeTonConnectLink } from '../../src/tonconnect/wallet/decode';
import { SAMPLE_TON_CONNECT_URI } from '../tonconnect/fixtures';

describe('TON Connect link pipeline parity', () => {
    it('classifies the sample URI as TON_CONNECT_LINK', () => {
        const result = classifyScanResult(SAMPLE_TON_CONNECT_URI, 'mainnet');
        expect(result.kind).toBe('TON_CONNECT_LINK');
    });

    it('produces identical decoded links from camera-style and pasted input', () => {
        const scanned = classifyScanResult(SAMPLE_TON_CONNECT_URI, 'mainnet');
        const pasted = classifyScanResult(SAMPLE_TON_CONNECT_URI.trim(), 'mainnet');

        if (scanned.kind !== 'TON_CONNECT_LINK' || pasted.kind !== 'TON_CONNECT_LINK') {
            throw new Error('expected TON_CONNECT_LINK');
        }

        expect(scanned.link).toEqual(pasted.link);
        expect(decodeTonConnectLink(SAMPLE_TON_CONNECT_URI)).toEqual(scanned.link);
    });

    it('includes ton_addr and ton_proof items from the sample URI', () => {
        const result = classifyScanResult(SAMPLE_TON_CONNECT_URI, 'mainnet');
        if (result.kind !== 'TON_CONNECT_LINK') throw new Error('wrong kind');

        const names = result.link.request.items.map((item) => item.name);
        expect(names).toContain('ton_addr');
        expect(names).toContain('ton_proof');
    });

    it('rejects tampered protocol version consistently', () => {
        const tampered = SAMPLE_TON_CONNECT_URI.replace('v=2', 'v=3');
        expect(classifyScanResult(tampered, 'mainnet').kind).toBe('UNSUPPORTED');
        expect(() => decodeTonConnectLink(tampered)).toThrow();
    });

    it('does not classify plain TON addresses as TON Connect sessions', () => {
        const address = 'EQBvW8Z5hpZAwlh2fgEDOZKkzZLll_TX1vuVqfjJkHQDYEPq';
        expect(classifyScanResult(address, 'mainnet').kind).toBe('UNSUPPORTED');
    });

    it('classifies ton://transfer separately from TON Connect', () => {
        const transfer = `ton://transfer/EQBvW8Z5hpZAwlh2fgEDOZKkzZLll_TX1vuVqfjJkHQDYEPq`;
        const result = classifyScanResult(transfer, 'mainnet');
        expect(result.kind).toBe('TON_TRANSFER');
        expect(result.kind).not.toBe('TON_CONNECT_LINK');
    });
});
