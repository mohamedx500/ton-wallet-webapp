import { describe, expect, it } from 'vitest';
import { classifyScanResult, SCAN_MAX_TEXT_BYTES } from '../../src/qr/classifier';
import type { TonTransferScanResult } from '../../src/qr/classifier';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Mainnet EQ address (bounceable, url-safe, isTestOnly=false). */
const MAINNET_ADDR = 'EQBvW8Z5hpZAwlh2fgEDOZKkzZLll_TX1vuVqfjJkHQDYEPq';
/** Testnet EQ address (bounceable, url-safe, isTestOnly=true). */
const TESTNET_ADDR = 'kQBvW8Z5hpZAwlh2fgEDOZKkzZLll_TX1vuVqfjJkHQDYPhg';

function tonTransfer(path: string): string {
    return `ton://transfer/${path}`;
}

// ---------------------------------------------------------------------------
// Non-URI / unknown input
// ---------------------------------------------------------------------------

describe('classifyScanResult — UNSUPPORTED inputs', () => {
    it('returns UNSUPPORTED for empty string', () => {
        expect(classifyScanResult('', 'mainnet').kind).toBe('UNSUPPORTED');
    });

    it('returns UNSUPPORTED for whitespace-only string', () => {
        expect(classifyScanResult('   ', 'mainnet').kind).toBe('UNSUPPORTED');
    });

    it('returns UNSUPPORTED for plain text', () => {
        expect(classifyScanResult('hello world', 'mainnet').kind).toBe('UNSUPPORTED');
    });

    it('returns UNSUPPORTED for https URL', () => {
        expect(classifyScanResult('https://example.com', 'mainnet').kind).toBe('UNSUPPORTED');
    });

    it('returns UNSUPPORTED for oversized input', () => {
        const big = 'a'.repeat(SCAN_MAX_TEXT_BYTES + 1);
        expect(classifyScanResult(big, 'mainnet').kind).toBe('UNSUPPORTED');
    });

    it('returns UNSUPPORTED for bitcoin URI', () => {
        expect(classifyScanResult('bitcoin:1A1zP1eP5QGefi2DMPTfTL5SLmv7Divf', 'mainnet').kind).toBe('UNSUPPORTED');
    });
});

// ---------------------------------------------------------------------------
// TON Connect links
// ---------------------------------------------------------------------------

describe('classifyScanResult — TON_CONNECT_LINK', () => {
    const VALID_TC = `tc://?v=2&id=${'a'.repeat(64)}&r=${encodeURIComponent(JSON.stringify({
        manifestUrl: 'https://app.example.com/tonconnect-manifest.json',
        items: [{ name: 'ton_addr' }],
    }))}`;

    it('classifies a valid tc:// link', () => {
        const result = classifyScanResult(VALID_TC, 'mainnet');
        expect(result.kind).toBe('TON_CONNECT_LINK');
    });

    it('returns a frozen result', () => {
        const result = classifyScanResult(VALID_TC, 'mainnet');
        expect(Object.isFrozen(result)).toBe(true);
    });

    it('exposes the decoded link', () => {
        const result = classifyScanResult(VALID_TC, 'mainnet');
        if (result.kind !== 'TON_CONNECT_LINK') throw new Error('wrong kind');
        expect(result.link.version).toBe(2);
        expect(result.link.appClientId).toBe('a'.repeat(64));
    });

    it('returns UNSUPPORTED for a tc:// link with missing id', () => {
        const bad = `tc://?v=2&r=${encodeURIComponent(JSON.stringify({
            manifestUrl: 'https://app.example.com/tonconnect-manifest.json',
            items: [{ name: 'ton_addr' }],
        }))}`;
        expect(classifyScanResult(bad, 'mainnet').kind).toBe('UNSUPPORTED');
    });

    it('returns UNSUPPORTED for a tc:// link with wrong protocol version', () => {
        const bad = `tc://?v=1&id=${'a'.repeat(64)}&r={}`;
        expect(classifyScanResult(bad, 'mainnet').kind).toBe('UNSUPPORTED');
    });

    it('returns UNSUPPORTED for a malformed tc:// link', () => {
        expect(classifyScanResult('tc://?garbage', 'mainnet').kind).toBe('UNSUPPORTED');
    });
});

// ---------------------------------------------------------------------------
// TON transfer links — valid cases
// ---------------------------------------------------------------------------

describe('classifyScanResult — TON_TRANSFER valid', () => {
    it('classifies a bare address', () => {
        const result = classifyScanResult(tonTransfer(MAINNET_ADDR), 'mainnet');
        expect(result.kind).toBe('TON_TRANSFER');
    });

    it('returns a frozen result', () => {
        const result = classifyScanResult(tonTransfer(MAINNET_ADDR), 'mainnet');
        expect(Object.isFrozen(result)).toBe(true);
    });

    it('produces null amountNano when amount is absent', () => {
        const result = classifyScanResult(tonTransfer(MAINNET_ADDR), 'mainnet') as TonTransferScanResult;
        expect(result.amountNano).toBeNull();
    });

    it('produces null comment when text is absent', () => {
        const result = classifyScanResult(tonTransfer(MAINNET_ADDR), 'mainnet') as TonTransferScanResult;
        expect(result.comment).toBeNull();
    });

    it('produces null expiry when exp is absent', () => {
        const result = classifyScanResult(tonTransfer(MAINNET_ADDR), 'mainnet') as TonTransferScanResult;
        expect(result.expiry).toBeNull();
    });

    it('parses a whole nanoton amount', () => {
        const url = `${tonTransfer(MAINNET_ADDR)}?amount=1000000000`;
        const result = classifyScanResult(url, 'mainnet') as TonTransferScanResult;
        expect(result.amountNano).toBe(1_000_000_000n);
    });

    it('parses a decimal amount without floating-point error', () => {
        const url = `${tonTransfer(MAINNET_ADDR)}?amount=1500000000`;
        const result = classifyScanResult(url, 'mainnet') as TonTransferScanResult;
        expect(result.amountNano).toBe(1_500_000_000n);
    });

    it('parses a comment', () => {
        const url = `${tonTransfer(MAINNET_ADDR)}?text=${encodeURIComponent('Hello TON')}`;
        const result = classifyScanResult(url, 'mainnet') as TonTransferScanResult;
        expect(result.comment).toBe('Hello TON');
    });

    it('parses an expiry timestamp', () => {
        const url = `${tonTransfer(MAINNET_ADDR)}?exp=1700000000`;
        const result = classifyScanResult(url, 'mainnet') as TonTransferScanResult;
        expect(result.expiry).toBe(1_700_000_000);
    });

    it('parses all three optional params together', () => {
        const url = `${tonTransfer(MAINNET_ADDR)}?amount=2000000000&text=${encodeURIComponent('pay')}&exp=9999999`;
        const result = classifyScanResult(url, 'mainnet') as TonTransferScanResult;
        expect(result.amountNano).toBe(2_000_000_000n);
        expect(result.comment).toBe('pay');
        expect(result.expiry).toBe(9_999_999);
    });

    it('accepts expiry of zero', () => {
        const url = `${tonTransfer(MAINNET_ADDR)}?exp=0`;
        const result = classifyScanResult(url, 'mainnet') as TonTransferScanResult;
        expect(result.expiry).toBe(0);
    });

    it('accepts a testnet address on testnet', () => {
        const result = classifyScanResult(tonTransfer(TESTNET_ADDR), 'testnet');
        expect(result.kind).toBe('TON_TRANSFER');
    });
});

// ---------------------------------------------------------------------------
// TON transfer links — invalid / rejected cases
// ---------------------------------------------------------------------------

describe('classifyScanResult — TON_TRANSFER invalid', () => {
    it('returns UNSUPPORTED for a mainnet address on testnet', () => {
        expect(classifyScanResult(tonTransfer(MAINNET_ADDR), 'testnet').kind).toBe('UNSUPPORTED');
    });

    it('returns UNSUPPORTED for a testnet address on mainnet', () => {
        expect(classifyScanResult(tonTransfer(TESTNET_ADDR), 'mainnet').kind).toBe('UNSUPPORTED');
    });

    it('returns UNSUPPORTED for an invalid address', () => {
        expect(classifyScanResult(tonTransfer('not-an-address'), 'mainnet').kind).toBe('UNSUPPORTED');
    });

    it('returns UNSUPPORTED for amount of zero', () => {
        const url = `${tonTransfer(MAINNET_ADDR)}?amount=0`;
        expect(classifyScanResult(url, 'mainnet').kind).toBe('UNSUPPORTED');
    });

    it('returns UNSUPPORTED for negative amount', () => {
        const url = `${tonTransfer(MAINNET_ADDR)}?amount=-1000000000`;
        expect(classifyScanResult(url, 'mainnet').kind).toBe('UNSUPPORTED');
    });

    it('returns UNSUPPORTED for non-numeric amount', () => {
        const url = `${tonTransfer(MAINNET_ADDR)}?amount=abc`;
        expect(classifyScanResult(url, 'mainnet').kind).toBe('UNSUPPORTED');
    });

    it('returns UNSUPPORTED for unknown query parameter', () => {
        const url = `${tonTransfer(MAINNET_ADDR)}?unknown=1`;
        expect(classifyScanResult(url, 'mainnet').kind).toBe('UNSUPPORTED');
    });

    it('returns UNSUPPORTED for duplicate query parameter', () => {
        const url = `${tonTransfer(MAINNET_ADDR)}?amount=1000000000&amount=2000000000`;
        expect(classifyScanResult(url, 'mainnet').kind).toBe('UNSUPPORTED');
    });

    it('returns UNSUPPORTED for a comment with control characters', () => {
        const url = `${tonTransfer(MAINNET_ADDR)}?text=${encodeURIComponent('Hello\x00World')}`;
        expect(classifyScanResult(url, 'mainnet').kind).toBe('UNSUPPORTED');
    });

    it('returns UNSUPPORTED for a non-integer expiry', () => {
        const url = `${tonTransfer(MAINNET_ADDR)}?exp=1.5`;
        expect(classifyScanResult(url, 'mainnet').kind).toBe('UNSUPPORTED');
    });

    it('returns UNSUPPORTED for a negative expiry', () => {
        const url = `${tonTransfer(MAINNET_ADDR)}?exp=-1`;
        expect(classifyScanResult(url, 'mainnet').kind).toBe('UNSUPPORTED');
    });

    it('returns UNSUPPORTED for extra path segments', () => {
        const url = `ton://transfer/${MAINNET_ADDR}/extra`;
        expect(classifyScanResult(url, 'mainnet').kind).toBe('UNSUPPORTED');
    });

    it('returns UNSUPPORTED for ton:// without transfer host', () => {
        expect(classifyScanResult(`ton://send/${MAINNET_ADDR}`, 'mainnet').kind).toBe('UNSUPPORTED');
    });
});
