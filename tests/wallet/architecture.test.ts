import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');
const TS = /\.(ts|tsx)$/;

function sourceFiles(root: string): readonly string[] {
    const found: string[] = [];
    const walk = (directory: string): void => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const full = join(directory, entry.name);
            if (entry.isDirectory()) {
                walk(full);
            } else if (TS.test(entry.name)) {
                found.push(relative(process.cwd(), full).split(sep).join('/'));
            }
        }
    };
    walk(root);
    return found;
}

function importsOf(file: string): readonly string[] {
    const source = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
    const specifiers: string[] = [];
    const patterns = [
        /(?:^|\n)\s*import\s+[\s\S]*?from\s*['"]([^'"]+)['"]/g,
        /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g,
        /(?:^|\n)\s*export\s+[\s\S]*?from\s*['"]([^'"]+)['"]/g,
        /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    ];
    for (const pattern of patterns) {
        for (const match of source.matchAll(pattern)) {
            const specifier = match[1];
            if (specifier !== undefined) {
                specifiers.push(specifier);
            }
        }
    }
    return specifiers;
}

const ALL_SOURCES = sourceFiles(SRC);
const WALLET_SOURCES = ALL_SOURCES.filter((file) => file.startsWith('src/wallet/'));

describe('wallet execution dependency boundaries', () => {
    it('keeps the wallet execution contracts independent of feature and UI modules', () => {
        const forbidden = /(^|\/)(swap|components|context|hooks|services|nft|dns|tonconnect)\//;
        const offenders = WALLET_SOURCES.flatMap((file) =>
            importsOf(file)
                .filter((specifier) => specifier.startsWith('.') && forbidden.test(specifier))
                .map((specifier) => ({ file, specifier })),
        );

        expect(offenders).toEqual([]);
    });

    it('keeps DEX SDKs out of the shared wallet execution contracts', () => {
        const offenders = WALLET_SOURCES.flatMap((file) =>
            importsOf(file)
                .filter((specifier) => specifier.startsWith('@ston-fi') || specifier.startsWith('@dedust'))
                .map((specifier) => ({ file, specifier })),
        );

        expect(offenders).toEqual([]);
    });

    it('keeps the swap adapter one-way: swap may import wallet, wallet may not import swap', () => {
        const walletImportsSwap = WALLET_SOURCES.filter((file) =>
            importsOf(file).some((specifier) => specifier.includes('swap')),
        );
        const adapterImportsWallet = importsOf('src/swap/walletAdapter.ts').some((specifier) =>
            specifier.includes('../wallet'),
        );

        expect(walletImportsSwap).toEqual([]);
        expect(adapterImportsWallet).toBe(true);
    });

    it('keeps broadcaster submission single-attempt with no retry loop', () => {
        const source = readFileSync('src/wallet/TonClientTransactionBroadcaster.ts', 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/(^|[^:])\/\/.*$/gm, '$1');

        expect(source.match(/this\.transport\.send\s*\(/g)).toHaveLength(1);
        expect(source.match(/transientCapture\?\.capture\s*\(/g)).toHaveLength(1);
        expect(source).toMatch(/sendFile/);
        expect(source).not.toMatch(/sendMessage/);
        expect(source).not.toMatch(/\bfor\s*\(|\bwhile\s*\(|setTimeout\s*\(/);
    });

    it('does not use balances or caught exceptions as deployment and seqno heuristics', () => {
        const source = readFileSync('src/wallet/VerifiedStandardWalletReplayReader.ts', 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/(^|[^:])\/\/.*$/gm, '$1');

        expect(source).toMatch(/account\.state\s*===\s*['"]uninitialized['"]/);
        expect(source).not.toMatch(/balance\s*>\s*0n/);
        expect(source).not.toMatch(/catch[\s\S]{0,160}seqno:\s*0/);
    });

    it('uses official wallet transfer builders instead of manual wallet body assembly', () => {
        const signerSource = readFileSync('src/wallet/OfficialStandardWalletSigner.ts', 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/(^|[^:])\/\/.*$/gm, '$1');

        expect(signerSource).toMatch(/\.createTransfer\s*\(/);
        expect(signerSource).not.toMatch(/storeUint\s*\(\s*0x(?:7369676e|73696e74)/i);
        expect(signerSource).not.toMatch(/storeBuffer\s*\(\s*signature/i);
    });

    it('requires exact normalized inbound-message correlation before standard-wallet confirmation', () => {
        const source = readFileSync('src/wallet/StandardWalletTransactionConfirmer.ts', 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/(^|[^:])\/\/.*$/gm, '$1');

        expect(source).toMatch(/record\.inboundExternalMessageHash\s*===\s*reference\.transportId/);
        expect(source).not.toMatch(/currentSeqno\s*>[\s\S]{0,180}state:\s*['"]confirmed['"]/);
        expect(source).not.toMatch(/signedBody|storeMessage\(|\.body\b/);
    });

    it('keeps execution orchestration ordered and prevents automatic ambiguous resubmission', () => {
        const source = readFileSync('src/wallet/StandardWalletExecutionCoordinator.ts', 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/(^|[^:])\/\/.*$/gm, '$1');

        const replay = source.indexOf('await this.readReplay');
        const sign = source.indexOf('await this.sign');
        const submit = source.indexOf('await this.submitOrRecover');
        const persist = source.indexOf('await this.persist');
        const featurePersist = source.indexOf('await this.notifySubmitted');
        const confirm = source.indexOf('await this.confirm');
        expect(replay).toBeGreaterThan(-1);
        expect(replay).toBeLessThan(sign);
        expect(sign).toBeLessThan(submit);
        expect(submit).toBeLessThan(persist);
        expect(persist).toBeLessThan(featurePersist);
        expect(featurePersist).toBeLessThan(confirm);
        expect(source.match(/this\.broadcaster\.submit\s*\(/g)).toHaveLength(1);
        expect(source).not.toMatch(/SignedWalletEnvelope[^\n]*(?:put|persist)|store\.put\s*\(\s*envelope/);
    });

    it('keeps submission persistence network-scoped and free of signing artifacts', () => {
        const source = readFileSync('src/wallet/BrowserSubmissionReferenceStore.ts', 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/(^|[^:])\/\/.*$/gm, '$1');

        expect(source).toMatch(/storageKey\(network:\s*NetworkId\)/);
        expect(source).toMatch(/decodeSubmissionReference/);
        expect(source).not.toMatch(/SignedWalletEnvelope|signedBody|stateInit|secretKey|mnemonic|password/);
        expect(source).not.toMatch(/console\.|localStorage/);
    });

    it('excludes secret material and signed envelopes from the persistence interface', () => {
        const source = readFileSync('src/wallet/types.ts', 'utf8');
        const store = source.match(/export interface SubmissionReferenceStore\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';

        expect(store).not.toMatch(/SignedWalletEnvelope|signedBody|signature|secretKey|mnemonic|password|boc/i);
        expect(store).toMatch(/SubmissionReference/);
    });
});
