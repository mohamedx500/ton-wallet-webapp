/**
 * Display-token filtering — deterministic, network-aware, identity by address.
 *
 * Filters before render so spam / dust / zero / duplicate assets never hit the UI.
 * Does not hide legitimate holdings merely because a USD price is missing.
 */

import { addressKey } from '../core/address';

/** Configurable thresholds for wallet asset display. */
export const TOKEN_DISPLAY_CONFIG = Object.freeze({
    /** Hide jettons whose USD value is below this when a reliable price exists. */
    dustUsdThreshold: 0.01,
    /** Absolute amount below this counts as zero (float dust). */
    zeroBalanceEpsilon: 1e-12,
});

export type TokenVerification = 'whitelist' | 'blacklist' | 'none' | string | null | undefined;

export interface DisplayTokenInput {
    /** Protocol identity — jetton master, or `native` for TON. */
    id: string;
    symbol: string;
    name: string;
    /** Human balance (already decimal-adjusted). */
    balance: number;
    /** Unit USD price when known; `null` / `undefined` means unknown (do not treat as zero). */
    priceUsd: number | null | undefined;
    /** Precomputed USD value when known. */
    valueUsd?: number | null;
    verification?: TokenVerification;
    /** True for native TON / Gram. */
    isNative?: boolean;
    network?: 'mainnet' | 'testnet';
    /** Optional 24h change string from rates API. */
    diff24h?: string | null;
    icon?: string | null;
    decimals?: number;
    walletAddress?: string;
    sparkline?: readonly number[];
}

export interface DisplayToken extends DisplayTokenInput {
    /** Short ticker used as the primary UI title. */
    displaySymbol: string;
    /** Formatted balance string for the row. */
    balanceLabel: string;
    /** Formatted USD value for the row (`—` when unknown). */
    valueLabel: string;
    valueUsd: number | null;
}

export interface FilterDisplayTokensOptions {
    dustUsdThreshold?: number;
    zeroBalanceEpsilon?: number;
    /** Keep native asset even at zero balance. Default true. */
    keepNativeWhenZero?: boolean;
}

function isFiniteNumber(n: unknown): n is number {
    return typeof n === 'number' && Number.isFinite(n);
}

/** Normalize jetton / native identity for dedupe comparisons. */
export function tokenIdentityKey(id: string, isNative?: boolean): string {
    const trimmed = (id ?? '').trim();
    if (isNative || trimmed === '' || trimmed.toLowerCase() === 'native' || trimmed.toLowerCase() === 'ton') {
        return 'native';
    }
    try {
        return addressKey(trimmed);
    } catch {
        return trimmed.toLowerCase();
    }
}

/** Prefer the short market ticker; fall back to name only when symbol is empty. */
export function primaryTokenSymbol(symbol: string | null | undefined, name: string | null | undefined): string {
    const sym = (symbol ?? '').trim();
    if (sym.length > 0) return sym;
    const n = (name ?? '').trim();
    return n.length > 0 ? n : 'TOKEN';
}

function isBlacklisted(verification: TokenVerification): boolean {
    if (verification == null) return false;
    const v = String(verification).toLowerCase();
    return v === 'blacklist' || v === 'blacklisted' || v === 'scam';
}

function isMalformed(token: DisplayTokenInput): boolean {
    if (!token) return true;
    if (!isFiniteNumber(token.balance)) return true;
    if (token.balance < 0) return true;
    const id = (token.id ?? '').trim();
    if (!token.isNative && id.length === 0) return true;
    const sym = (token.symbol ?? '').trim();
    const name = (token.name ?? '').trim();
    if (sym.length === 0 && name.length === 0) return true;
    return false;
}

function resolveValueUsd(token: DisplayTokenInput): number | null {
    if (isFiniteNumber(token.valueUsd)) return token.valueUsd;
    if (isFiniteNumber(token.priceUsd) && token.priceUsd > 0) {
        return token.balance * token.priceUsd;
    }
    return null;
}

function formatBalance(balance: number): string {
    if (!isFiniteNumber(balance)) return '0';
    if (balance === 0) return '0';
    if (balance > 0 && balance < 0.01) {
        return balance.toFixed(Math.min(6, Math.max(2, -Math.floor(Math.log10(balance)) + 1)));
    }
    if (balance >= 1000) {
        return balance.toLocaleString('en-US', { maximumFractionDigits: 2 });
    }
    return balance.toFixed(2);
}

function formatUsd(value: number | null): string {
    if (value == null || !Number.isFinite(value)) return '—';
    if (value > 0 && value < 0.01) return `$${value.toFixed(6)}`;
    return `$${value.toFixed(2)}`;
}

/**
 * Filter and normalize tokens for the wallet asset list.
 * Order: drop malformed → spam → zero → dust (when priced) → dedupe by identity → format.
 */
export function filterDisplayTokens(
    tokens: readonly DisplayTokenInput[],
    options: FilterDisplayTokensOptions = {},
): DisplayToken[] {
    const dustUsdThreshold = options.dustUsdThreshold ?? TOKEN_DISPLAY_CONFIG.dustUsdThreshold;
    const zeroEps = options.zeroBalanceEpsilon ?? TOKEN_DISPLAY_CONFIG.zeroBalanceEpsilon;
    const keepNativeWhenZero = options.keepNativeWhenZero ?? true;

    const bestById = new Map<string, DisplayTokenInput>();

    for (const token of tokens) {
        if (isMalformed(token)) continue;
        if (isBlacklisted(token.verification)) continue;

        const isNative = Boolean(token.isNative) || tokenIdentityKey(token.id, token.isNative) === 'native';
        const balance = token.balance;

        if (balance <= zeroEps) {
            if (!(isNative && keepNativeWhenZero)) continue;
        }

        const valueUsd = resolveValueUsd(token);
        // Dust only when a reliable price/value exists — never hide for missing market data.
        if (!isNative && valueUsd != null && valueUsd < dustUsdThreshold) {
            continue;
        }

        const key = tokenIdentityKey(token.id, isNative);
        const existing = bestById.get(key);
        if (!existing) {
            bestById.set(key, { ...token, isNative, valueUsd });
            continue;
        }

        // Prefer higher balance; then whitelisted; then known price.
        const existingValue = resolveValueUsd(existing) ?? -1;
        const nextValue = valueUsd ?? -1;
        const existingRank =
            existing.balance * 1e9
            + (String(existing.verification).toLowerCase() === 'whitelist' ? 1e6 : 0)
            + (existingValue >= 0 ? 1e3 : 0);
        const nextRank =
            balance * 1e9
            + (String(token.verification).toLowerCase() === 'whitelist' ? 1e6 : 0)
            + (nextValue >= 0 ? 1e3 : 0);

        if (nextRank > existingRank) {
            bestById.set(key, { ...token, isNative, valueUsd });
        }
    }

    const result: DisplayToken[] = [];
    for (const token of bestById.values()) {
        const displaySymbol = primaryTokenSymbol(token.symbol, token.name);
        const valueUsd = resolveValueUsd(token);
        result.push({
            ...token,
            displaySymbol,
            balanceLabel: formatBalance(token.balance),
            valueLabel: formatUsd(valueUsd),
            valueUsd,
        });
    }

    // Native first, then by USD value desc, then symbol.
    result.sort((a, b) => {
        if (a.isNative && !b.isNative) return -1;
        if (!a.isNative && b.isNative) return 1;
        const av = a.valueUsd ?? -1;
        const bv = b.valueUsd ?? -1;
        if (av !== bv) return bv - av;
        return a.displaySymbol.localeCompare(b.displaySymbol);
    });

    return result;
}

/** Parse a rates-style diff string into a signed number (percent). */
export function parseDiffPercent(diff: string | null | undefined): number | null {
    if (diff == null) return null;
    const normalized = String(diff).replace('−', '-').replace('%', '').trim();
    if (!normalized) return null;
    const n = Number(normalized);
    return Number.isFinite(n) ? n : null;
}
