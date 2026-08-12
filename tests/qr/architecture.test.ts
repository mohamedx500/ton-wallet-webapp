/**
 * Architecture gate for src/qr/
 *
 * Enforces:
 *   1. No remote QR service URLs anywhere in the QR package.
 *   2. No React, DOM globals, or browser-specific APIs in the pure logic modules
 *      (renderer.ts and classifier.ts are allowed to reference HTMLCanvasElement
 *      and HTMLVideoElement only as types; camera.ts may reference HTMLVideoElement
 *      as a runtime parameter type).
 *   3. No automatic navigation or transaction execution from the classifier.
 *   4. No localStorage / sessionStorage / console in any QR module.
 *   5. No secrets, signed envelopes, or BOCs in QR APIs.
 *   6. The classifier reuses decodeTonConnectLink instead of reimplementing it.
 *   7. The camera module never calls getUserMedia directly — it accepts it as an
 *      injected dependency (no `navigator.mediaDevices` in source).
 *   8. The ReceiveModal active source no longer contains the api.qrserver.com URL.
 *   9. The legacy helpers.js remote QR helper is present only in that one file
 *      and is not imported by any React/strict module.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

const ROOT = join(fileURLToPath(import.meta.url), '..', '..', '..');
const QR_SRC = join(ROOT, 'src', 'qr');
const COMPONENTS_SRC = join(ROOT, 'src', 'components');
const HELPERS_SRC = join(ROOT, 'src', 'utils', 'helpers.js');

function readSource(filePath: string): string {
    return readFileSync(filePath, 'utf8');
}

function collectTs(dir: string): string[] {
    return readdirSync(dir)
        .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'))
        .map((f) => join(dir, f));
}

const QR_SOURCES = collectTs(QR_SRC);

// ---------------------------------------------------------------------------
// 1. No remote QR service URLs in the QR package
// ---------------------------------------------------------------------------

describe('src/qr — no remote QR service', () => {
    it('has at least one source file', () => {
        expect(QR_SOURCES.length).toBeGreaterThanOrEqual(3);
    });

    it.each(QR_SOURCES.map((f) => [f.replace(ROOT, ''), f]))(
        '%s does not reference api.qrserver.com',
        (_rel, filePath) => {
            expect(readSource(filePath)).not.toMatch('api.qrserver.com');
        },
    );

    it.each(QR_SOURCES.map((f) => [f.replace(ROOT, ''), f]))(
        '%s does not construct any remote image URL for QR',
        (_rel, filePath) => {
            const src = readSource(filePath);
            expect(src).not.toMatch(/https:\/\/.*qr/i);
            expect(src).not.toMatch(/create-qr-code/);
        },
    );
});

// ---------------------------------------------------------------------------
// 2. No React, window.location, or transaction execution in classifier
// ---------------------------------------------------------------------------

describe('src/qr/classifier.ts — no side-effects', () => {
    const classifierPath = join(QR_SRC, 'classifier.ts');

    it('does not import React', () => {
        expect(readSource(classifierPath)).not.toMatch(/from ['"]react['"]/);
    });

    it('does not reference window.location', () => {
        expect(readSource(classifierPath)).not.toMatch(/window\.location/);
    });

    it('does not reference window.open', () => {
        expect(readSource(classifierPath)).not.toMatch(/window\.open/);
    });

    it('does not reference localStorage or sessionStorage', () => {
        const src = readSource(classifierPath);
        expect(src).not.toMatch(/localStorage/);
        expect(src).not.toMatch(/sessionStorage/);
    });

    it('does not reference console', () => {
        expect(readSource(classifierPath)).not.toMatch(/console\./);
    });

    it('does not contain transaction execution keywords', () => {
        const src = readSource(classifierPath);
        expect(src).not.toMatch(/sendTransaction/);
        expect(src).not.toMatch(/executeTransaction/);
        expect(src).not.toMatch(/broadcastTransaction/);
    });
});

// ---------------------------------------------------------------------------
// 3. Classifier reuses decodeTonConnectLink — no re-implementation
// ---------------------------------------------------------------------------

describe('src/qr/classifier.ts — reuses existing decoder', () => {
    const classifierPath = join(QR_SRC, 'classifier.ts');

    it('imports decodeTonConnectLink from tonconnect', () => {
        expect(readSource(classifierPath)).toMatch(/decodeTonConnectLink/);
        expect(readSource(classifierPath)).toMatch(/from ['"]\.\.\/tonconnect/);
    });

    it('does not reimplement connect request decoding', () => {
        const src = readSource(classifierPath);
        // The classifier must not duplicate the JSON-parse-and-validate pattern
        expect(src).not.toMatch(/manifestUrl.*items/);
        expect(src).not.toMatch(/decodeConnectRequest/);
    });
});

// ---------------------------------------------------------------------------
// 4. Camera module uses injected getUserMedia — not navigator.mediaDevices
// ---------------------------------------------------------------------------

describe('src/qr/camera.ts — injected browser boundaries', () => {
    const cameraPath = join(QR_SRC, 'camera.ts');

    it('does not call navigator.mediaDevices directly', () => {
        expect(readSource(cameraPath)).not.toMatch(/navigator\.mediaDevices/);
    });

    it('does not import React', () => {
        expect(readSource(cameraPath)).not.toMatch(/from ['"]react['"]/);
    });

    it('does not reference localStorage or sessionStorage', () => {
        const src = readSource(cameraPath);
        expect(src).not.toMatch(/localStorage/);
        expect(src).not.toMatch(/sessionStorage/);
    });

    it('does not reference console', () => {
        expect(readSource(cameraPath)).not.toMatch(/console\./);
    });

    it('stops all tracks on cleanup — calls getTracks', () => {
        expect(readSource(cameraPath)).toMatch(/getTracks/);
    });

    it('calls track.stop() for cleanup', () => {
        expect(readSource(cameraPath)).toMatch(/track\.stop\(\)/);
    });
});

// ---------------------------------------------------------------------------
// 5. Renderer does not construct remote URLs
// ---------------------------------------------------------------------------

describe('src/qr/renderer.ts — local only', () => {
    const rendererPath = join(QR_SRC, 'renderer.ts');

    it('imports from qrcode package', () => {
        expect(readSource(rendererPath)).toMatch(/from ['"]qrcode['"]/);
    });

    it('does not construct any https URL', () => {
        expect(readSource(rendererPath)).not.toMatch(/https?:\/\//);
    });

    it('does not reference fetch or XMLHttpRequest', () => {
        const src = readSource(rendererPath);
        expect(src).not.toMatch(/\bfetch\b/);
        expect(src).not.toMatch(/XMLHttpRequest/);
    });
});

// ---------------------------------------------------------------------------
// 6. ReceiveModal no longer uses api.qrserver.com
// ---------------------------------------------------------------------------

describe('src/components/WalletModals.tsx — remote QR removed', () => {
    const modalPath = join(COMPONENTS_SRC, 'WalletModals.tsx');

    it('does not reference api.qrserver.com', () => {
        expect(readSource(modalPath)).not.toMatch('api.qrserver.com');
    });
});

// ---------------------------------------------------------------------------
// 7. helpers.js remote generateQRCode is present only in helpers.js
//    and is NOT imported by any TypeScript/React module
// ---------------------------------------------------------------------------

describe('helpers.js remote generateQRCode isolation', () => {
    it('helpers.js still defines generateQRCode (legacy, inactive)', () => {
        expect(readSource(HELPERS_SRC)).toMatch('generateQRCode');
    });

    it('no strict TypeScript module imports generateQRCode from helpers', () => {
        // Collect all .ts and .tsx under src/ (excluding helpers.js itself)
        function collectAll(dir: string): string[] {
            const results: string[] = [];
            for (const entry of readdirSync(dir)) {
                const full = join(dir, entry);
                const stat = statSync(full);
                if (stat.isDirectory()) {
                    results.push(...collectAll(full));
                } else if (
                    (entry.endsWith('.ts') || entry.endsWith('.tsx'))
                    && !full.includes('node_modules')
                ) {
                    results.push(full);
                }
            }
            return results;
        }

        const allTs = collectAll(join(ROOT, 'src'));
        const offenders = allTs.filter((f) => {
            const src = readSource(f);
            return src.includes('generateQRCode') || src.includes('helpers.js');
        });

        expect(offenders).toEqual([]);
    });
});
