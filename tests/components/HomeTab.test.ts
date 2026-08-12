import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..', '..');
const HOME_TAB = join(ROOT, 'src', 'components', 'HomeTab.tsx');

describe('HomeTab action labels', () => {
    it('shows Link instead of Scan', () => {
        const source = readFileSync(HOME_TAB, 'utf8');
        expect(source).toMatch(/labelEn: 'Link'/);
        expect(source).not.toMatch(/labelEn: 'Scan'/);
    });

    it('shows Bulk instead of Multi', () => {
        const source = readFileSync(HOME_TAB, 'utf8');
        expect(source).toMatch(/labelEn: 'Bulk'/);
        expect(source).not.toMatch(/labelEn: 'Multi'/);
    });
});
