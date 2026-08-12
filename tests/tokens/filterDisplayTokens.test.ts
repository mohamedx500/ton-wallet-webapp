import { describe, expect, it } from 'vitest';
import {
    filterDisplayTokens,
    parseDiffPercent,
    primaryTokenSymbol,
    tokenIdentityKey,
    type DisplayTokenInput,
} from '../../src/tokens/filterDisplayTokens';

const USDT = 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs';
const USDT_RAW = '0:b113a994b5024a16719f69139328eb759596c38a25f59028b146fecdc3621dfe';
const SCAM = '0:1111111111111111111111111111111111111111111111111111111111111111';
const WAT = '0:2222222222222222222222222222222222222222222222222222222222222222';
const PUMP = '0:3333333333333333333333333333333333333333333333333333333333333333';

function token(partial: Partial<DisplayTokenInput> & Pick<DisplayTokenInput, 'id' | 'symbol' | 'name' | 'balance'>): DisplayTokenInput {
    return {
        priceUsd: null,
        verification: 'none',
        isNative: false,
        ...partial,
    };
}

describe('primaryTokenSymbol', () => {
    it('prefers short ticker over long name', () => {
        expect(primaryTokenSymbol('USDT', 'Tether USD')).toBe('USDT');
        expect(primaryTokenSymbol('$PX', 'Not Pixel')).toBe('$PX');
    });
});

describe('tokenIdentityKey', () => {
    it('collapses bounceable and raw spellings', () => {
        expect(tokenIdentityKey(USDT)).toBe(tokenIdentityKey(USDT_RAW));
    });

    it('maps native aliases', () => {
        expect(tokenIdentityKey('native', true)).toBe('native');
        expect(tokenIdentityKey('TON')).toBe('native');
    });
});

describe('filterDisplayTokens', () => {
    it('filters zero-balance jettons but keeps native', () => {
        const out = filterDisplayTokens([
            token({ id: 'native', symbol: 'Gram', name: 'Gram', balance: 0, isNative: true, priceUsd: 1.5, verification: 'whitelist' }),
            token({ id: USDT, symbol: 'USDT', name: 'Tether USD', balance: 0, priceUsd: 1 }),
        ]);
        expect(out).toHaveLength(1);
        expect(out[0].isNative).toBe(true);
        expect(out[0].displaySymbol).toBe('Gram');
    });

    it('filters blacklisted spam when trust metadata exists', () => {
        const out = filterDisplayTokens([
            token({ id: SCAM, symbol: 'LG', name: 'UNLOCK.TG', balance: 100, priceUsd: 0, verification: 'blacklist' }),
            token({ id: USDT, symbol: 'USDT', name: 'Tether USD', balance: 0.13, priceUsd: 1, verification: 'whitelist' }),
        ]);
        expect(out.map((t) => t.displaySymbol)).toEqual(['USDT']);
    });

    it('filters dust when a reliable USD value exists', () => {
        const out = filterDisplayTokens([
            token({ id: PUMP, symbol: 'PUMP', name: 'PUMP', balance: 0.99, priceUsd: 0.00000002, verification: 'none' }),
            token({ id: USDT, symbol: 'USDT', name: 'Tether USD', balance: 0.13, priceUsd: 1, verification: 'whitelist' }),
        ]);
        expect(out.map((t) => t.displaySymbol)).toEqual(['USDT']);
    });

    it('keeps legitimate tokens when market price is unavailable', () => {
        const out = filterDisplayTokens([
            token({ id: WAT, symbol: 'WAT', name: 'WATCoin', balance: 3165, priceUsd: null, verification: 'none' }),
        ]);
        expect(out).toHaveLength(1);
        expect(out[0].displaySymbol).toBe('WAT');
        expect(out[0].valueLabel).toBe('—');
    });

    it('dedupes by protocol address and keeps the better balance', () => {
        const out = filterDisplayTokens([
            token({ id: USDT, symbol: 'USDT', name: 'Tether USD', balance: 0.05, priceUsd: 1 }),
            token({ id: USDT_RAW, symbol: 'USDT', name: 'Tether USD', balance: 0.13, priceUsd: 1 }),
        ]);
        expect(out).toHaveLength(1);
        expect(out[0].balance).toBeCloseTo(0.13);
    });

    it('drops empty or malformed assets', () => {
        const out = filterDisplayTokens([
            token({ id: '', symbol: 'X', name: 'X', balance: 1 }),
            token({ id: USDT, symbol: '', name: '', balance: 1, priceUsd: 1 }),
            token({ id: USDT, symbol: 'USDT', name: 'Tether USD', balance: Number.NaN }),
        ]);
        expect(out).toHaveLength(0);
    });

    it('uses ticker as displaySymbol', () => {
        const out = filterDisplayTokens([
            token({ id: USDT, symbol: 'USDT', name: 'Tether USD', balance: 1, priceUsd: 1 }),
        ]);
        expect(out[0].displaySymbol).toBe('USDT');
        expect(out[0].name).toBe('Tether USD');
    });
});

describe('parseDiffPercent', () => {
    it('parses unicode minus and signs', () => {
        expect(parseDiffPercent('−0.03%')).toBeCloseTo(-0.03);
        expect(parseDiffPercent('+1.61%')).toBeCloseTo(1.61);
        expect(parseDiffPercent(null)).toBeNull();
    });
});
