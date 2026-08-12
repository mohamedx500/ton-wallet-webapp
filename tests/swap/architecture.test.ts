/**
 * Architecture boundary tests
 * ============================================================================
 *
 * The swap engine is only DEX-agnostic if nothing above a provider directory
 * knows which DEX it is talking to. That property is invisible in a type
 * signature and easy to break with a single convenient import, so it is asserted
 * mechanically here.
 *
 * These tests read source text rather than exercising behaviour. That is
 * deliberate: the rule is about *dependencies*, and a dependency violation is
 * still a violation when the code happens to work.
 *
 * @see docs/swap.md#adding-a-provider
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');
const TS = /\.(ts|tsx)$/;

/** Every TypeScript/TSX file under a directory, as repo-relative POSIX paths. */
function sourceFiles(root: string): readonly string[] {
    const found: string[] = [];
    const walk = (dir: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, entry.name);
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

/**
 * Module specifiers a file imports.
 *
 * Matches `import … from '…'`, bare `import '…'`, `export … from '…'` and
 * dynamic `import('…')`. Comments are stripped first, so the rule *stated* in a
 * doc comment does not itself count as a violation of the rule.
 */
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

describe('DEX SDK containment', () => {
    it('finds source files to check', () => {
        // Guards the suite itself: a broken walker would make every rule below
        // pass vacuously, which is worse than no test at all.
        expect(ALL_SOURCES.length).toBeGreaterThan(20);
    });

    it('confines @ston-fi imports to the STON.fi provider directory', () => {
        const offenders = ALL_SOURCES.filter(
            (file) =>
                !file.startsWith('src/swap/providers/stonfi/') &&
                importsOf(file).some((specifier) => specifier.startsWith('@ston-fi')),
        );
        expect(offenders).toEqual([]);
    });

    it('has no DeDust SDK imports anywhere', () => {
        // DeDust was removed rather than ported: its SDK is not maintained to the
        // standard this wallet requires. The abstraction is what allows it back
        // later, as a provider directory, with no change above it.
        const offenders = ALL_SOURCES.filter((file) =>
            importsOf(file).some((specifier) => specifier.startsWith('@dedust')),
        );
        expect(offenders).toEqual([]);
    });

    it('keeps the engine, domain model and validation free of provider imports', () => {
        // These three are the abstraction. If any of them reaches into a provider
        // directory, adding a DEX stops being additive.
        const core = ['src/swap/SwapEngine.ts', 'src/swap/types.ts', 'src/swap/validation.ts', 'src/swap/errors.ts'];
        for (const file of core) {
            const reaching = importsOf(file).filter((specifier) => specifier.includes('providers/'));
            expect({ file, reaching }).toEqual({ file, reaching: [] });
        }
    });

    it('names a concrete DEX in exactly one place: the default registry', () => {
        // `createDefaultRegistry` is the single line that has to change to add or
        // remove an exchange. Anything else importing a provider directly would
        // be a second such place.
        const importers = ALL_SOURCES.filter(
            (file) =>
                !file.startsWith('src/swap/providers/') &&
                importsOf(file).some((specifier) => /providers\/stonfi/.test(specifier)),
        );
        expect(importers).toEqual([]);
    });
});

describe('layering', () => {
    it('keeps src/core free of feature-module imports', () => {
        // The dependency arrow points one way: core → nothing. A core module that
        // imported the swap engine would make the primitives untestable in
        // isolation and invite a cycle.
        const features = /(^|\/)(swap|nft|dns|tonconnect|components|services|hooks)\//;
        for (const file of ALL_SOURCES.filter((candidate) => candidate.startsWith('src/core/'))) {
            const reaching = importsOf(file).filter(
                (specifier) => specifier.startsWith('.') && features.test(specifier),
            );
            expect({ file, reaching }).toEqual({ file, reaching: [] });
        }
    });

    it('keeps src/assets free of swap imports', () => {
        for (const file of ALL_SOURCES.filter((candidate) => candidate.startsWith('src/assets/'))) {
            const reaching = importsOf(file).filter((specifier) => specifier.includes('swap/'));
            expect({ file, reaching }).toEqual({ file, reaching: [] });
        }
    });
});

describe('inactive swap application boundary', () => {
    const applicationFiles = ALL_SOURCES.filter((file) => file.startsWith('src/swap/application/'));

    it('finds the application conversion sources to check', () => {
        expect(applicationFiles.length).toBeGreaterThanOrEqual(4);
    });

    it('does not depend on React, legacy services, or concrete DEX implementations', () => {
        const forbidden = /(?:^|\/)(?:components|context|services)(?:\/|$)|providers\/stonfi|@ston-fi|dedust/i;
        const offenders = applicationFiles.flatMap((file) =>
            importsOf(file)
                .filter((specifier) => forbidden.test(specifier))
                .map((specifier) => ({ file, specifier })),
        );
        expect(offenders).toEqual([]);
    });

    it('contains no signing, submission, storage, clock, or floating-point amount operation', () => {
        const offenders: { readonly file: string; readonly pattern: string }[] = [];
        const forbiddenPatterns: readonly (readonly [string, RegExp])[] = [
            ['parseFloat', /\bparseFloat\s*\(/],
            ['amount Number conversion', /\bNumber\s*\(\s*(?:amount|offer|value|units)/i],
            ['wall clock', /\bDate\.now\s*\(|\bnew\s+Date\s*\(\s*\)/],
            ['signing', /\.sign\s*\(/],
            ['submission', /\.(?:submit|broadcast|sendTransfer|sendTransaction)\s*\(/],
            ['storage', /\b(?:localStorage|sessionStorage)\b/],
            ['console', /\bconsole\./],
            ['network boolean', /\btestnet\s*=\s*(?:true|false)|\bmainnet\s*=\s*(?:true|false)/],
            ['fabricated quote marker', /\bisEstimate\b|\bestimat(?:e|ed)Quote\b/i],
        ];
        for (const file of applicationFiles) {
            const source = readFileSync(file, 'utf8')
                .replace(/\/\*[\s\S]*?\*\//g, '')
                .replace(/(^|[^:])\/\/.*$/gm, '$1');
            for (const [name, pattern] of forbiddenPatterns) {
                if (pattern.test(source)) {
                    offenders.push({ file, pattern: name });
                }
            }
        }
        expect(offenders).toEqual([]);
    });

    it('keeps application intent and quote types free of secrets and transaction artifacts', () => {
        const source = readFileSync('src/swap/application/types.ts', 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/(^|[^:])\/\/.*$/gm, '$1');
        expect(source).not.toMatch(
            /mnemonic|encryptedSeed|password|passwordHash|privateKey|secretKey|WalletSigner|SignedWalletEnvelope|signature|signedBody|stateInit|\bBOC\b|\bCell\b|payload|providerData|rawData/i,
        );
    });

    it('keeps Stage C React-facing results free of secrets and transaction artifacts', () => {
        const source = readFileSync('src/swap/application/PasswordConfirmedSwapExecutor.ts', 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/(^|[^:])\/\/.*$/gm, '$1');
        const resultType = source.match(
            /export interface PasswordConfirmedSwapResult\s*\{[\s\S]*?\n\}/,
        )?.[0].replace(/PasswordConfirmedSwapResult/g, '') ?? '';

        expect(resultType.length).toBeGreaterThan(0);
        expect(resultType).not.toMatch(
            /mnemonic|seed|password|privateKey|secretKey|authority|WalletSigner|SignedWalletEnvelope|signature|signedBody|stateInit|\bBOC\b|\bCell\b|payload|prepared|providerData|rawData/i,
        );
    });

    it('keeps explicit application configuration inactive and independent of React and legacy runtime state', () => {
        const source = readFileSync('src/config/application.ts', 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/(^|[^:])\/\/.*$/gm, '$1');
        const activeFiles = [
            'src/main.tsx',
            'src/App.tsx',
            'src/components/WalletModals.tsx',
            'src/context/WalletContext.tsx',
            'src/context/NetworkContext.tsx',
        ];
        const importers = activeFiles.filter((file) =>
            /config\/application|decodeApplicationConfig|ApplicationConfig/.test(readFileSync(file, 'utf8')),
        );

        expect(importers).toEqual([]);
        expect(source).not.toMatch(/React|useContext|useNetwork|NetworkContext|WalletContext|localStorage|sessionStorage/);
        expect(source).not.toMatch(/import\.meta\.env|process\.env|window\.|document\.|navigator\./);
        expect(source).not.toMatch(/walletAddress|endpoint\.includes|testnet\s*\?|Boolean\(|!!/);
        expect(source).toMatch(/value !== 'mainnet' && value !== 'testnet'/);
    });

    it('keeps the strict swap composition root inactive and out of React and legacy runtime modules', () => {
        const compositionFile = 'src/config/strictSwapApplication.ts';
        const source = readFileSync(compositionFile, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/(^|[^:])\/\/.*$/gm, '$1');
        const activeFiles = [
            'src/main.tsx',
            'src/App.tsx',
            'src/components/WalletModals.tsx',
            'src/context/WalletContext.tsx',
            'src/context/NetworkContext.tsx',
            'src/services/SwapService.ts',
            'src/services/WalletService.js',
        ];
        const importers = activeFiles.filter((file) =>
            /strictSwapApplication|createStrictSwapApplication/.test(readFileSync(file, 'utf8')),
        );

        expect(importers).toEqual([]);
        expect(source).not.toMatch(/React|useContext|WalletContext|NetworkContext/);
        expect(source).not.toMatch(/import\.meta\.env|process\.env|window\.|document\.|navigator\.|localStorage|sessionStorage/);
        expect(source).not.toMatch(/ResilientRpcClient|RpcClient|SwapService|WalletService|getDecryptedSeed/);
        expect(source).not.toMatch(/withRetry|retryCount|maxRetries/);
        expect(source).toMatch(/TonClientExternalMessageTransport/);
        expect(source).toMatch(/TonClientTransactionBroadcaster/);
        expect(source).toMatch(/createDefaultRegistry\(chain\)/);
    });

    it('activates Stage E only through the narrow strict recovery bootstrap', () => {
        const bootstrapFile = 'src/StrictSwapRecoveryBootstrap.tsx';
        const bootstrapSource = readFileSync(bootstrapFile, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/(^|[^:])\/\/.*$/gm, '$1');
        const directRecoveryFiles = [
            'src/App.tsx',
            'src/components/WalletModals.tsx',
            'src/context/WalletContext.tsx',
            'src/services/SwapService.ts',
            'src/services/WalletService.js',
        ].filter((file) => /\.recover\s*\(/.test(readFileSync(file, 'utf8')));
        const directExecutionImporters = [
            bootstrapFile,
            'src/App.tsx',
            'src/context/WalletContext.tsx',
        ].filter((file) => /PasswordConfirmedSwapExecutor|SwapLifecycleService/.test(readFileSync(file, 'utf8')));

        expect(directRecoveryFiles).toEqual([]);
        expect(directExecutionImporters).toEqual([]);
        expect(importsOf(bootstrapFile)).toEqual([
            'react',
            './config/activeStrictSwapRuntime',
            './core/address',
        ]);
        expect(bootstrapSource).toMatch(/runtime\.ui\.recover\s*\(\s*accountAddress/);
        expect(bootstrapSource).toMatch(/addressKey\s*\(\s*accountAddress\s*\)/);
        expect(bootstrapSource).toMatch(/addressKey\s*\(\s*walletAddress\s*\)/);
        expect(bootstrapSource).toMatch(/runtime\.status !== 'ready'/);
        expect(bootstrapSource).toMatch(/concurrency:\s*RECOVERY_CONCURRENCY/);
        expect(bootstrapSource).not.toMatch(/AbortController|signal\s*:/);
        expect(bootstrapSource).not.toMatch(
            /activeAccount|encrypted|password|mnemonic|seed|privateKey|secretKey|\.sign\s*\(|\.submit\s*\(|\.broadcast\s*\(|\.execute\s*\(|payload|\bBOC\b|\bCell\b/i,
        );
    });

    it('keeps the pre-cutover integration parity suite inactive and aligned with the audited gates', () => {
        const parityFile = 'tests/swap/StrictSwapIntegrationParity.test.ts';
        const source = readFileSync(parityFile, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/(^|[^:])\/\/.*$/gm, '$1');
        const executionFiles = [
            'src/context/WalletContext.tsx',
        ];
        const importers = executionFiles.filter((file) =>
            /StrictSwapIntegrationParity|StrictSwapUiAdapter|StrictSwapReact|useStrictSwap/.test(
                readFileSync(file, 'utf8'),
            ),
        );

        expect(importers).toEqual([]);
        expect(source).toMatch(/providerIds: \['stonfi'\]/);
        expect(source).not.toMatch(/providerIds: \['dedust'\]|new\s+Dedust|@dedust/i);
        expect(source).toMatch(/does not fabricate an estimated approval/);
        expect(source).not.toMatch(/isEstimate\s*:\s*true|estimatedQuote\s*:/i);
        expect(source).toMatch(/\.5/);
        expect(source).toMatch(/12\./);
        expect(source).toMatch(/exact Stage B approval and quote instance/);
        expect(source).toMatch(/toBe\(issuedQuote\)/);
        expect(source).toMatch(/display metadata claims TON/);
        expect(source).toMatch(/invalidates an in-flight real quote session/);

        expect(source).toMatch(/never reports success at wallet inclusion/);
        expect(source).toMatch(/runs Stage E recovery only/);
        expect(source).toMatch(/expect\(f\.operation\.calls\)\.toBe\(0\)/);
    });

    it('activates strict STON.fi quoting without reconnecting the legacy swap execution path', () => {
        const modalFile = 'src/components/WalletModals.tsx';
        const appFile = 'src/App.tsx';
        const modalSource = readFileSync(modalFile, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/(^|[^:])\/\/.*$/gm, '$1');
        const appSource = readFileSync(appFile, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/(^|[^:])\/\/.*$/gm, '$1');
        const swapModalProps = modalSource.match(
            /interface SwapModalProps[\s\S]*?\n\}/,
        )?.[0] ?? '';
        const swapModalStart = modalSource.indexOf('export function SwapModal');
        const swapModalEnd = modalSource.indexOf('interface BackupModalProps', swapModalStart);
        const swapModalSection = swapModalStart >= 0 && swapModalEnd > swapModalStart
            ? modalSource.slice(swapModalStart, swapModalEnd)
            : '';
        const swapModalInvocation = appSource.match(
            /<SwapModal[\s\S]*?\/>/,
        )?.[0] ?? '';

        expect(importsOf(modalFile)).toContain('../swap/StrictSwapReact');
        expect(importsOf(modalFile)).toContain('../swap/application');
        expect(swapModalSection.length).toBeGreaterThan(0);
        expect(swapModalSection).toMatch(/useOptionalStrictSwap\s*\(/);
        expect(swapModalSection).toMatch(/strictRuntime\.ui\.quote\s*\(\s*createActiveQuoteIntent\s*\(/);
        expect(swapModalSection).toMatch(/strictRuntime\.ui\.invalidate\s*\(\s*\)/);
        expect(swapModalSection).toMatch(/const data:\s*unknown\s*=\s*await response\.json\(\)/);
        expect(swapModalSection).toMatch(/decodeStonfiAssets\s*\(\s*data\s*\)/);
        expect(swapModalSection).toMatch(/assetDiscoveryStarted\.current/);

        expect(swapModalSection).toMatch(/strictRuntime\.ui\.execute\s*\(\s*activeAccount\s*,\s*password\s*\)/);
        expect(swapModalSection).toMatch(/executionAvailable/);
        expect(swapModalSection).toMatch(/Confirm and execute/);
        expect(swapModalSection).toMatch(/onTerminalRefresh\s*\(\s*\)/);
        expect(swapModalSection.match(/onTerminalRefresh\s*\(\s*\)/g)).toHaveLength(1);
        expect(swapModalSection).not.toMatch(/data\.asset_list|console\.|SwapService|WalletService|getDecryptedSeed|beginCell|Cell\.fromBase64|getBestQuote|dedust|DeDust|isEstimate|estimatedQuote|allQuotes|rawData/);
        expect(swapModalProps.length).toBeGreaterThan(0);
        expect(swapModalProps).not.toMatch(/onSwapInitiated/);
        expect(swapModalProps).toMatch(/activeAccount:\s*unknown/);
        expect(swapModalProps).toMatch(/onTerminalRefresh:\s*\(\)\s*=>\s*Promise<void>/);
        expect(swapModalInvocation.length).toBeGreaterThan(0);
        expect(swapModalInvocation).not.toMatch(/onSwapInitiated/);
        expect(swapModalInvocation).toMatch(/activeAccount=\{activeAccount as unknown\}/);
        expect(swapModalInvocation).toMatch(/onTerminalRefresh=\{refreshData\}/);
        expect(appSource).not.toMatch(/pendingSwap|handleSwapInitiated|passwordAction === 'swap'|SwapService|sendTransactionWithPayload|beginCell|query_id|DeDust|dedust/);
        expect(importsOf(appFile)).toContain('./StrictSwapRecoveryBootstrap');
        expect(appSource.indexOf("if (!isLoggedIn)"))
            .toBeLessThan(appSource.indexOf('<StrictSwapRecoveryBootstrap'));
        expect(appSource).toMatch(/<StrictSwapRecoveryBootstrap[\s\S]*?runtime=\{strictSwapRuntime\}[\s\S]*?accountId=\{activeAccount\.id\}[\s\S]*?accountAddress=\{activeAccount\.address\}[\s\S]*?walletAddress=\{walletAddress\}/);
    });

    it('keeps the strict UI adapter and hook metadata-only and out of active execution', () => {
        const adapterFile = 'src/swap/application/StrictSwapUiAdapter.ts';
        const hookFile = 'src/swap/StrictSwapReact.ts';
        const adapterSource = readFileSync(adapterFile, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/(^|[^:])\/\/.*$/gm, '$1');
        const hookSource = readFileSync(hookFile, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/(^|[^:])\/\/.*$/gm, '$1');
        const activeExecutionFiles: string[] = [];
        const importers = activeExecutionFiles.filter((file) =>
            /StrictSwapUiAdapter|useStrictSwap|StrictSwapReact/.test(readFileSync(file, 'utf8')),
        );
        const snapshotType = adapterSource.match(
            /export interface StrictSwapUiSnapshot\s*\{[\s\S]*?\n\}/,
        )?.[0] ?? '';
        const quoteType = adapterSource.match(
            /export interface StrictSwapQuoteView\s*\{[\s\S]*?\n\}/,
        )?.[0] ?? '';

        expect(importers).toEqual([]);
        expect(importsOf(adapterFile)).not.toContain('react');
        expect(importsOf(hookFile)).toEqual(['react', './application']);
        expect(hookSource).toMatch(/useSyncExternalStore/);
        expect(hookSource).not.toMatch(/createStrictSwapApplication|new\s+StrictSwapUiAdapter|useEffect|useState/);
        expect(adapterSource).not.toMatch(/TonClient|createStrictSwapApplication|localStorage|sessionStorage|import\.meta\.env/);
        expect(snapshotType.length).toBeGreaterThan(0);
        expect(quoteType.length).toBeGreaterThan(0);
        expect(`${snapshotType}\n${quoteType}`).not.toMatch(
            /password|mnemonic|seed|encrypted|privateKey|secretKey|signature|signedBody|stateInit|\bBOC\b|\bCell\b|payload|providerData|rawData|approval/i,
        );
        expect(snapshotType).toMatch(/executionAvailable:\s*boolean/);
        expect(adapterSource).toMatch(/if \(this\.executionPromise !== null\) return this\.executionPromise/);
        expect(adapterSource).toMatch(/if \(this\.executionPromise !== null\) return;/);
        expect(adapterSource).toMatch(/const inFlight = this\.recoveryPromises\.get\(key\)/);
        expect(adapterSource).toMatch(/const completed = this\.recoveredByOwner\.get\(key\)/);
        expect(adapterSource).toMatch(/this\.isCurrentRecovery\(ownerKey, generation\)/);
        expect(adapterSource).toMatch(/if \(this\.quotePromise !== null && this\.quoteKey === key\)/);
    });

    it('keeps the strict legacy account adapters inactive and isolated from unsafe account types', () => {
        const adapterFile = 'src/swap/application/legacyAccountAdapters.ts';
        const source = readFileSync(adapterFile, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/(^|[^:])\/\/.*$/gm, '$1');
        const activeFiles = [
            'src/main.tsx',
            'src/App.tsx',
            'src/components/WalletModals.tsx',
            'src/context/WalletContext.tsx',
            'src/services/AccountManager.ts',
            'src/services/SecurityService.js',
        ];
        const importers = activeFiles.filter((file) =>
            /legacyAccountAdapters|decodePasswordConfirmedSwapAccount|LegacySecurityServiceSwapMnemonicDecryptor/.test(
                readFileSync(file, 'utf8'),
            ),
        );

        expect(importers).toEqual([]);
        expect(importsOf(adapterFile)).not.toContain('../../services/AccountManager');
        expect(importsOf(adapterFile)).not.toContain('../../services/SecurityService');
        expect(source).not.toMatch(/\bWalletAccount\b|\bany\b|passwordHash|localStorage|sessionStorage|getDecryptedSeed/);
        expect(source).not.toMatch(/React|useContext|WalletContext|AccountManager|new\s+SecurityService/);
        expect(source).toMatch(/toWalletDescriptor\(\{ type, address \}\)/);
        expect(source.indexOf('toWalletDescriptor({ type, address })'))
            .toBeLessThan(source.indexOf("account['encryptedSeed']"));
    });

    it('keeps Stage D lifecycle events metadata-only', () => {
        const source = readFileSync('src/swap/application/SwapLifecycleService.ts', 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/(^|[^:])\/\/.*$/gm, '$1');
        const eventType = source.match(
            /export interface SwapLifecycleEvent\s*\{[\s\S]*?\n\}/,
        )?.[0].replace(/SwapLifecycleEvent/g, '') ?? '';

        expect(eventType.length).toBeGreaterThan(0);
        expect(eventType).not.toMatch(
            /password|mnemonic|seed|privateKey|secretKey|authority|WalletSigner|SignedWalletEnvelope|signature|signedBody|stateInit|\bBOC\b|\bCell\b|payload|prepared|providerData|rawData|receivedUnits/i,
        );
    });

    it('keeps Stage E recovery results free of signing and transaction artifacts', () => {
        const source = readFileSync('src/swap/application/PendingSwapRecoveryBootstrap.ts', 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/(^|[^:])\/\/.*$/gm, '$1');
        const resultType = source.match(
            /export interface RecoveredSwapLifecycle\s*\{[\s\S]*?\n\}/,
        )?.[0].replace(/RecoveredSwapLifecycle/g, '') ?? '';

        expect(resultType.length).toBeGreaterThan(0);
        expect(resultType).not.toMatch(
            /password|mnemonic|seed|privateKey|secretKey|authority|WalletSigner|SignedWalletEnvelope|signature|signedBody|stateInit|\bBOC\b|\bCell\b|payload|prepared|providerData|rawData|queryId|receivedUnits/i,
        );
        expect(source).toMatch(/recovery\.recoverWallet\s*\(/);
        expect(source).not.toMatch(/\.sign\s*\(|\.submit\s*\(|\.broadcast\s*\(|\.execute\s*\(/);
    });
});

describe('swap module hygiene', () => {
    it('never calls Date.now() below the engine', () => {
        // Rule 2 of the provider contract. A provider that reads the wall clock
        // makes its deadline untestable — and a deadline that was never tested is
        // exactly how `tx_deadline: 0` shipped and refunded every V2 swap.
        const belowEngine = ALL_SOURCES.filter(
            (file) => file.startsWith('src/swap/') && file !== 'src/swap/SwapEngine.ts',
        );
        const offenders = belowEngine.filter((file) => {
            const source = readFileSync(file, 'utf8')
                .replace(/\/\*[\s\S]*?\*\//g, '')
                .replace(/(^|[^:])\/\/.*$/gm, '$1');
            return /\bDate\.now\s*\(/.test(source) || /\bnew\s+Date\s*\(\s*\)/.test(source);
        });
        expect(offenders).toEqual([]);
    });

    it('keeps pending swap recovery persistence network-scoped and free of transaction artifacts', () => {
        const source = readFileSync('src/swap/BrowserPendingSwapReferenceStore.ts', 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/(^|[^:])\/\/.*$/gm, '$1');

        expect(source).toMatch(/storageKey\(network:\s*NetworkId\)/);
        expect(source).toMatch(/decodePendingSwapReference/);
        expect(source).not.toMatch(
            /SignedWalletEnvelope|signedBody|stateInit|secretKey|mnemonic|password|providerData|SwapQuote/,
        );
        expect(source).not.toMatch(/console\.|localStorage|sessionStorage/);
    });

    it('keeps reload recovery free of signing and submission operations', () => {
        const source = readFileSync('src/swap/PendingSwapRecoveryCoordinator.ts', 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/(^|[^:])\/\/.*$/gm, '$1');

        expect(source).toMatch(/walletConfirmer\.confirm\s*\(/);
        expect(source).toMatch(/engine\.waitForOutcome\s*\(/);
        expect(source).not.toMatch(/\.sign\s*\(|\.submit\s*\(|\.broadcast\s*\(|SignedWalletEnvelope/);
        expect(source).not.toMatch(/console\.|localStorage|sessionStorage/);
    });

    it('never uses parseFloat or Number() arithmetic on amounts', () => {
        // Rule 3. Amounts are `bigint` end to end; `Number` silently loses integer
        // precision above 2^53, which is roughly 9 million tokens at 9 decimals —
        // an ordinary trade, not an edge case.
        const offenders: string[] = [];
        for (const file of ALL_SOURCES.filter((candidate) => candidate.startsWith('src/swap/'))) {
            const source = readFileSync(file, 'utf8')
                .replace(/\/\*[\s\S]*?\*\//g, '')
                .replace(/(^|[^:])\/\/.*$/gm, '$1');
            if (/\bparseFloat\s*\(/.test(source)) {
                offenders.push(file);
            }
        }
        expect(offenders).toEqual([]);
    });
});
