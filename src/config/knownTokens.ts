/**
 * Known Token Configurations
 * ============================================================================
 * 
 * This module provides HARDCODED decimal configurations for known tokens
 * to prevent Exit Code 47 errors caused by decimal mismatches.
 * 
 * CRITICAL: Never rely on UI/API decimals for these tokens.
 * Always use the values defined here.
 */

/**
 * Token decimal configuration
 */
export interface TokenConfig {
    symbol: string;
    name: string;
    decimals: number;
    masterAddress: string;
    // Optional: common wallet addresses for quick lookup
    knownWallets?: string[];
}

/**
 * KNOWN_TOKENS - Hardcoded token configurations
 * 
 * These values are AUTHORITATIVE and should NEVER be overridden by UI/API data.
 * Using wrong decimals causes Exit Code 47 (insufficient balance) because
 * amounts get multiplied incorrectly (e.g., 0.19 USDT becomes 190,000,000 instead of 190,000).
 */
export const KNOWN_TOKENS: Record<string, TokenConfig> = {
    // ============================================================================
    // STABLECOINS (6 decimals)
    // ============================================================================

    'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs': {
        symbol: 'USDT',
        name: 'Tether USD',
        decimals: 6,
        masterAddress: 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs',
    },

    'EQB-MPwrd1G6WKNkLz_VnV6WqBDd142KMQv-g1O-8QUA3728': {
        symbol: 'USDC',
        name: 'USD Coin',
        decimals: 6,
        masterAddress: 'EQB-MPwrd1G6WKNkLz_VnV6WqBDd142KMQv-g1O-8QUA3728',
    },

    // ============================================================================
    // MEME TOKENS (9 decimals - TON standard)
    // ============================================================================

    'EQDvRFMYLdxmvY3Tk-cfWMLqDnXF_EclO2Fp4wwj33WhlNFT': {
        symbol: 'DOGS',
        name: 'Dogs',
        decimals: 9,
        masterAddress: 'EQDvRFMYLdxmvY3Tk-cfWMLqDnXF_EclO2Fp4wwj33WhlNFT',
    },

    'EQAvlWFDxGF2lXm67y4yzC17wYKD9A0guwPkMs1gOsM__NOT': {
        symbol: 'NOT',
        name: 'Notcoin',
        decimals: 9,
        masterAddress: 'EQAvlWFDxGF2lXm67y4yzC17wYKD9A0guwPkMs1gOsM__NOT',
    },

    // ============================================================================
    // NATIVE TON (9 decimals)
    // ============================================================================

    'native': {
        symbol: 'Gram',
        name: 'Gram',
        decimals: 9,
        masterAddress: 'native',
    },
};

/**
 * Symbol-based lookup for quick access
 */
export const KNOWN_TOKENS_BY_SYMBOL: Record<string, TokenConfig> = {
    'USDT': KNOWN_TOKENS['EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs'],
    'USDC': KNOWN_TOKENS['EQB-MPwrd1G6WKNkLz_VnV6WqBDd142KMQv-g1O-8QUA3728'],
    'DOGS': KNOWN_TOKENS['EQDvRFMYLdxmvY3Tk-cfWMLqDnXF_EclO2Fp4wwj33WhlNFT'],
    'NOT': KNOWN_TOKENS['EQAvlWFDxGF2lXm67y4yzC17wYKD9A0guwPkMs1gOsM__NOT'],
    'Gram': KNOWN_TOKENS['native'],
};

/**
 * Get token decimals with STRICT enforcement
 * 
 * @param addressOrSymbol - Token master address or symbol
 * @param fallbackDecimals - ONLY used if token is not in KNOWN_TOKENS
 * @returns Number of decimals (6 for USDT/USDC, 9 for others)
 */
export function getTokenDecimals(addressOrSymbol: string, fallbackDecimals: number = 9): number {
    // Check by address first
    if (KNOWN_TOKENS[addressOrSymbol]) {
        return KNOWN_TOKENS[addressOrSymbol].decimals;
    }

    // Check by symbol
    const upperSymbol = addressOrSymbol.toUpperCase();
    if (KNOWN_TOKENS_BY_SYMBOL[upperSymbol]) {
        return KNOWN_TOKENS_BY_SYMBOL[upperSymbol].decimals;
    }

    // Log warning for unknown tokens
    console.warn(`[KNOWN_TOKENS] Unknown token: ${addressOrSymbol}, using fallback decimals: ${fallbackDecimals}`);
    return fallbackDecimals;
}

/**
 * Check if a token address is USDT
 */
export function isUSDT(address: string): boolean {
    return address === 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs';
}

/**
 * Check if a token address is USDC
 */
export function isUSDC(address: string): boolean {
    return address === 'EQB-MPwrd1G6WKNkLz_VnV6WqBDd142KMQv-g1O-8QUA3728';
}

/**
 * Check if a token is a 6-decimal stablecoin
 */
export function isStablecoin(address: string): boolean {
    return isUSDT(address) || isUSDC(address);
}

/**
 * Get stricty-enforced decimals for stablecoins
 * Returns 6 for USDT/USDC, otherwise uses provided fallback
 */
export function getStrictDecimals(address: string, fallback: number = 9): number {
    if (isStablecoin(address)) {
        return 6; // ALWAYS 6 for stablecoins
    }
    return getTokenDecimals(address, fallback);
}

export default KNOWN_TOKENS;
