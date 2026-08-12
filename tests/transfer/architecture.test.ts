import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = join(process.cwd(), 'src', 'transfer');
const TS = /\.ts$/u;

function sourceFiles(): readonly string[] {
    return readdirSync(ROOT, { withFileTypes: true })
        .filter((entry) => entry.isFile() && TS.test(entry.name))
        .map((entry) => relative(process.cwd(), join(ROOT, entry.name)).split(sep).join('/'));
}

function withoutComments(file: string): string {
    return readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//gu, '')
        .replace(/(^|[^:])\/\/.*$/gmu, '$1');
}

function importsOf(file: string): readonly string[] {
    const source = withoutComments(file);
    const imports: string[] = [];
    for (const match of source.matchAll(/(?:import|export)\s+[\s\S]*?from\s*['"]([^'"]+)['"]/gu)) {
        if (match[1] !== undefined) imports.push(match[1]);
    }
    return imports;
}

const SOURCES = sourceFiles();

describe('strict transfer construction boundaries', () => {
    it('remains independent from UI, legacy services, feature code, RPC, crypto, storage, and Highload', () => {
        const forbidden = /(^|\/)(components|context|hooks|services|swap|wallets|network|crypto|state|ui)(\/|$)|react|highload|ston-fi|dedust/iu;
        const offenders = SOURCES.flatMap((file) => importsOf(file)
            .filter((specifier) => forbidden.test(specifier))
            .map((specifier) => ({ file, specifier })));

        expect(offenders).toEqual([]);
    });

    it('contains no floating-point or truncating protocol arithmetic', () => {
        const offenders = SOURCES.filter((file) => {
            const source = withoutComments(file);
            return /\b(?:Number|parseFloat|parseInt|Math\.pow|toFixed)\s*\(|\.slice\s*\(\s*0\s*,\s*decimals\s*\)|padEnd\s*\(\s*decimals/u.test(source);
        });

        expect(offenders).toEqual([]);
    });

    it('cannot sign, submit, retry, schedule, persist, or serialize payloads', () => {
        const forbidden = /mnemonicToPrivateKey|secretKey|\bsign\s*\(|sendTransfer|sendExternalMessage|\.submit\s*\(|\bwithRetry\b|setTimeout\s*\(|setInterval\s*\(|localStorage|sessionStorage|indexedDB|toBoc\s*\(|JSON\.stringify/u;
        const offenders = SOURCES.filter((file) => forbidden.test(withoutComments(file)));

        expect(offenders).toEqual([]);
    });

    it('uses the shared unsigned wallet message seam and never imports execution implementations', () => {
        const source = SOURCES.map((file) => withoutComments(file)).join('\n');

        expect(source).toMatch(/UnsignedWalletMessage/);
        expect(source).not.toMatch(/OfficialStandardWalletSigner|StandardWalletExecutionCoordinator|TransactionBroadcaster|TransactionConfirmer/);
    });
});
