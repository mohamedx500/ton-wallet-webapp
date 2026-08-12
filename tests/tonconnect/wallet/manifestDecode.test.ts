import { describe, expect, it } from 'vitest';
import { decodeTonConnectManifest } from '../../../src/tonconnect/wallet/decode';

describe('tonviewer manifest decode', () => {
    it('accepts the live tonviewer manifest shape', () => {
        const manifest = decodeTonConnectManifest({
            url: 'https://tonviewer.com/',
            name: 'Tonviewer',
            iconUrl: 'https://tonviewer.com/tonconnect.png',
        }, 'https://tonviewer.com/tc-manifest.json');

        expect(manifest.name).toBe('Tonviewer');
        expect(manifest.origin).toBe('https://tonviewer.com');
    });
});
