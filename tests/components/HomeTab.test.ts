import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..', '..');
const HOME_TAB = join(ROOT, 'src', 'components', 'HomeTab.tsx');
const BOTTOM_NAV = join(ROOT, 'src', 'components', 'BottomNavigation.tsx');

describe('HomeTab action labels', () => {
    it('shows Link instead of Scan', () => {
        const source = readFileSync(HOME_TAB, 'utf8');
        expect(source).toMatch(/labelEn: 'Link'/);
        expect(source).not.toMatch(/labelEn: 'Scan'/);
    });

    it('keeps Bulk out of home quick actions', () => {
        const source = readFileSync(HOME_TAB, 'utf8');
        expect(source).not.toMatch(/labelEn: 'Bulk'/);
        expect(source).toMatch(/Tokens/);
        expect(source).toMatch(/Collectibles/);
    });
});

describe('BottomNavigation Bulk placement', () => {
    it('places Bulk where NFTs used to be', () => {
        const source = readFileSync(BOTTOM_NAV, 'utf8');
        expect(source).toMatch(/labelEn: 'Bulk'/);
        expect(source).not.toMatch(/labelEn: 'NFTs'/);
        expect(source).toMatch(/onBulkClick/);
    });
});
