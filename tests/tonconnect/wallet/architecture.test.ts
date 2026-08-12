import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ROOT = join(PROJECT_ROOT, 'src', 'tonconnect', 'wallet');
const EXECUTION_BOUNDARY = join(
    PROJECT_ROOT,
    'src',
    'tonconnect',
    'PasswordConfirmedTransactionExecutor.ts',
);
const TS = /\.ts$/u;

function sourceFiles(): readonly string[] {
    return readdirSync(ROOT, { withFileTypes: true })
        .filter((entry) => entry.isFile() && TS.test(entry.name))
        .map((entry) => relative(PROJECT_ROOT, join(ROOT, entry.name)).split(sep).join('/'));
}

function source(file: string): string {
    return readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//gu, '')
        .replace(/(^|[^:])\/\/.*$/gmu, '$1');
}

function imports(file: string): readonly string[] {
    const found: string[] = [];
    for (const match of source(file).matchAll(/(?:import|export)\s+[\s\S]*?from\s*['"]([^'"]+)['"]/gu)) {
        if (match[1] !== undefined) found.push(match[1]);
    }
    return found;
}

const FILES = sourceFiles();

describe('wallet-side TON Connect architecture', () => {
    it('remains independent from React, UI, legacy services, swaps, DEXes, and concrete RPC clients', () => {
        const forbidden = /(^|\/)(components|context|hooks|services|swap|wallets|ui)(\/|$)|react|ston-fi|dedust|TonClient/iu;
        const offenders = FILES.flatMap((file) => imports(file)
            .filter((specifier) => forbidden.test(specifier))
            .map((specifier) => ({ file, specifier })));
        expect(offenders).toEqual([]);
    });

    it('does not sign with mnemonic material, submit transactions, retry, or schedule blind timers', () => {
        const forbidden = /mnemonicToPrivateKey|secretKey\s*:\s*keyPair\.secretKey|sendTransfer|sendExternalMessage|\.submit\s*\(|\bwithRetry\b|setTimeout\s*\(|setInterval\s*\(/u;
        expect(FILES.filter((file) => !file.includes('TonConnectBridgeTransport.ts') && forbidden.test(source(file)))).toEqual([]);
    });

    it('contains no floating-point protocol arithmetic or default-mainnet inference', () => {
        const forbidden = /parseFloat\s*\(|toFixed\s*\(|Math\.pow\s*\(|\?\?\s*['"]mainnet['"]|\|\|\s*['"]mainnet['"]/u;
        expect(FILES.filter((file) => forbidden.test(source(file)))).toEqual([]);
    });

    it('does not advertise structured transaction items or unsupported signing features', () => {
        const combined = FILES.map((file) => source(file)).join('\n');
        expect(combined).not.toMatch(/itemTypes\s*:|name\s*:\s*['"](?:SignData|SignMessage|EmbeddedRequest)['"]/u);
    });
});

describe('password-confirmed TON Connect execution architecture', () => {
    it('remains outside React, UI, legacy services, swaps, DEXes, and concrete RPC clients', () => {
        const forbidden = /(^|\/)(components|context|hooks|services|swap|wallets|ui)(\/|$)|react|ston-fi|dedust|TonClient/iu;
        const offenders = imports(EXECUTION_BOUNDARY)
            .filter((specifier) => forbidden.test(specifier));
        expect(offenders).toEqual([]);
    });

    it('does not retry, schedule blind timers, or submit through a concrete RPC client', () => {
        const forbidden = /\bwithRetry\b|setTimeout\s*\(|setInterval\s*\(|sendExternalMessage|\.submit\s*\(/u;
        expect(source(EXECUTION_BOUNDARY)).not.toMatch(forbidden);
    });

    it('zeroizes transient Ed25519 secret-key material', () => {
        expect(source(EXECUTION_BOUNDARY)).toMatch(/keyPair\.secretKey\.fill\(0\)/u);
    });

    it('keeps the ordinary result metadata-only and isolates BOC output to the protocol result', () => {
        const executionSource = source(EXECUTION_BOUNDARY);
        const ordinaryResult = executionSource.match(
            /export interface PasswordConfirmedTransactionResult\s*\{([\s\S]*?)\}/u,
        )?.[1];
        const protocolResult = executionSource.match(
            /export interface PasswordConfirmedTonConnectTransactionResult[\s\S]*?\{([\s\S]*?)\}/u,
        )?.[1];
        expect(ordinaryResult).toBeDefined();
        expect(ordinaryResult).not.toMatch(
            /\b(?:boc|payload|mnemonic|password|secretKey|signature|signedEnvelope)\b/iu,
        );
        expect(protocolResult).toMatch(/readonly externalMessageBoc:\s*string/u);
    });

    it('does not persist, diagnose, log, or place the transient BOC in React state', () => {
        const executionSource = source(EXECUTION_BOUNDARY);
        expect(executionSource).not.toMatch(/localStorage|sessionStorage|console\.|useState|diagnostics/u);
        expect(executionSource.match(/externalMessageBoc/gmu)).toHaveLength(2);
    });
});
