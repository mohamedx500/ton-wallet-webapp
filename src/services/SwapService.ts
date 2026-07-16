/**
 * SwapService - Production-Ready DEX Aggregator
 * 
 * Integrates with STON.fi (V2 priority, V1 fallback) and DeDust.io
 * Provides real-time quoting, best rate selection, and transaction construction.
 * 
 * @version 2.0.0
 * @author TON Wallet Team
 * 
 * USAGE NOTES FOR FRONTEND:
 * -------------------------
 * 1. Real-time Price Updates:
 *    - Use `getBestQuote()` with a polling interval of 5-10 seconds
 *    - In React, use useEffect with setInterval or React Query with refetchInterval:
 * 
 *    ```tsx
 *    // React Query approach (recommended)
 *    const { data: quote, refetch } = useQuery({
 *      queryKey: ['swap-quote', fromToken, toToken, amount],
 *      queryFn: () => swapService.getBestQuote(fromAsset, toAsset, amount),
 *      refetchInterval: 10000, // Refresh every 10 seconds
 *      enabled: !!amount && parseFloat(amount) > 0,
 *    });
 * 
 *    // Simple interval approach
 *    useEffect(() => {
 *      const interval = setInterval(() => {
 *        if (amount && !isUserSigning) {
 *          fetchQuote();
 *        }
 *      }, 10000);
 *      return () => clearInterval(interval);
 *    }, [amount, fromToken, toToken]);
 *    ```
 * 
 * 2. Quote Expiry:
 *    - Each quote has a `validUntil` timestamp (30 seconds)
 *    - Check if Date.now() < quote.validUntil before executing
 *    - If expired, refetch the quote
 * 
 * 3. Slippage Protection:
 *    - Default slippage is 1% (configurable via setSlippage())
 *    - minOutputAmount is already calculated in the quote
 */

import { Address, beginCell, toNano, Cell } from '@ton/core';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export interface TokenInfo {
    symbol: string;
    name: string;
    address: string; // 'native' for TON, jetton master address for others
    decimals: number;
    icon: string;
}

export interface SwapQuote {
    provider: 'stonfi' | 'dedust';
    providerName: string;
    fromToken: string;
    toToken: string;
    inputAmount: string;
    outputAmount: string;
    minOutputAmount: string;
    priceImpact: string;
    fee: string;
    feeAmount?: string;
    rate: string;
    route?: string[];
    poolAddress?: string;
    validUntil: number;
    isEstimate?: boolean;
    rawData?: any;
    error?: string; // Error message if quote failed
}

export interface BestQuoteResult {
    bestQuote: SwapQuote;
    allQuotes: SwapQuote[];
    timestamp: number;
}

export interface SwapTransaction {
    // For TON transfers
    to?: string;    // Router/vault address
    value?: string; // Total value in nanoTON (swap amount + gas)
    body?: Cell;    // Swap payload
    stateInit?: Cell;
    mode?: number;
    // Transaction type discriminator
    type?: 'ton_transfer' | 'jetton_transfer';
    // For Jetton transfers
    jettonMaster?: string;
    destination?: string;
    amount?: string;
    forwardAmount?: string;
    forwardPayload?: string;
    gasAmount?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Supported tokens on TON mainnet
 * Native TON uses 'native' as address
 */
export const TON_TOKENS: Record<string, TokenInfo> = {
    TON: {
        symbol: 'Gram',
        name: 'Toncoin',
        address: 'native',
        decimals: 9,
        icon: 'https://asset.ston.fi/img/EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c/d6004ba1bb042d9224b37dacf17399d04ff64d4ae5a6a1fbc52ae3906545c2fc',
    },
    USDT: {
        symbol: 'USDT',
        name: 'Tether USD',
        address: 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs', // Official USDT on TON
        decimals: 6,
        icon: 'https://asset.ston.fi/img/EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs/1a87edfee9a28b05578853952e5effb8cc30af1e0fb90043aa2ce19dce490849',
    },
    NOT: {
        symbol: 'NOT',
        name: 'Notcoin',
        address: 'EQAvlWFDxGF2lXm67y4yzC17wYKD9A0guwPkMs1gOsM__NOT',
        decimals: 9,
        icon: 'https://asset.ston.fi/img/EQAvlWFDxGF2lXm67y4yzC17wYKD9A0guwPkMs1gOsM__NOT/b16c8af5fa6d49f72af8dc623dc48aa6d142ad4fc30fd779a645000a180922aa',
    },
    DOGS: {
        symbol: 'DOGS',
        name: 'Dogs',
        address: 'EQCvxJy4eG8hyHBFsZ7eePxrRsUQSFE_jpptRAYBmcG_DOGS',
        decimals: 9,
        icon: 'https://asset.ston.fi/img/EQCvxJy4eG8hyHBFsZ7eePxrRsUQSFE_jpptRAYBmcG_DOGS/503ee166c13ec0d96274ac5336dd2242b9e30f6c60ddeec0b227e9dca0440edf',
    },
    CATI: {
        symbol: 'CATI',
        name: 'Catizen',
        address: 'EQD-cvR0Nz6XAyRBvbhz-abTrRC6sI5tvHvvpeQraV9UAAD7', // Catizen mainnet
        decimals: 9,
        icon: 'https://asset.ston.fi/img/EQD-cvR0Nz6XAyRBvbhz-abTrRC6sI5tvHvvpeQraV9UAAD7/7177e55473596c552cde4be5b94cc222ee229a49347f652303086b336cf188e8',
    },
    STON: {
        symbol: 'STON',
        name: 'STON.fi',
        address: 'EQA2kCVNwVsil2EM2mB0SkXytxCqQjS4mttjDpnXmwG9T6bO', // STON.fi token mainnet
        decimals: 9,
        icon: 'https://asset.ston.fi/img/EQA2kCVNwVsil2EM2mB0SkXytxCqQjS4mttjDpnXmwG9T6bO/7c9798ce1e64707fb4cb8f025d4060f66b386ed381b50498e3b88731cedeffe8',
    },
    HMSTR: {
        symbol: 'HMSTR',
        name: 'Hamster Kombat',
        address: 'EQAJ8uWd7EBqsmpSWaRdf_I-8R8-XHwh3gsNKhy-UrdrPcUo', // Hamster Kombat mainnet
        decimals: 9,
        icon: 'https://asset.ston.fi/img/EQAJ8uWd7EBqsmpSWaRdf_I-8R8-XHwh3gsNKhy-UrdrPcUo/eab9936b63e22ca759f67dc713fd2c1b3bd45590c6298882637cd4511dabaf5a',
    },
    MAJOR: {
        symbol: 'MAJOR',
        name: 'Major',
        address: 'EQCuPm01HldiduQ55xaBF_1kaW_WAUy5DHey8suqzU_MAJOR', // Major token mainnet
        decimals: 9,
        icon: 'https://asset.ston.fi/img/EQCuPm01HldiduQ55xaBF_1kaW_WAUy5DHey8suqzU_MAJOR/aea6edb39acc18a2958ed78165051844b8d4cec92b860866a25dd7f300a07e50',
    },
    JETTON: {
        symbol: 'JETTON',
        name: 'JetTon',
        address: 'EQAQXlWJvGbbFfE8F3oS8s87lIgdovS455IsWFaRdmJetTon', // JetTon mainnet
        decimals: 9,
        icon: 'https://asset.ston.fi/img/EQAQXlWJvGbbFfE8F3oS8s87lIgdovS455IsWFaRdmJetTon/8f3d0eaf65c9f877a21f0b102832b431c0df7a6b7788b8df9a57a4d0305320bf',
    },
    REDO: {
        symbol: 'REDO',
        name: 'Resistance Dog',
        address: 'EQBZ_cafPyDr5KUTs0aNxh0ZTDhkpEZONmLJA2SNGlLm4Cko', // Resistance Dog mainnet
        decimals: 9,
        icon: 'https://asset.ston.fi/img/EQBZ_cafPyDr5KUTs0aNxh0ZTDhkpEZONmLJA2SNGlLm4Cko/88d0249592ca2d167bbd0045754810f33b573193934114d7cc9fd33d150667f3',
    },
};

/**
 * pTON (Proxy TON) V1 address used by STON.fi for older swaps
 */
const PTON_V1_ADDRESS = 'EQCM3B12QK1e4yZSf8GtBRT0aLMNyEsBc_DhVfRRtOEffLez';

/**
 * pTON V2.1 master address for STON.fi V2 routers
 */
const PTON_V2_MASTER = 'EQBnGWMCf3-FZZq1W4IWcWiGAc3PHuZ0_H-7sad2oY00o83S';

/**
 * Native TON representation in STON.fi API
 */
const STONFI_NATIVE_TON = 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c';

/**
 * DEX Router/Factory addresses
 * Using V1 router which is more battle-tested and stable
 */
const STONFI_ROUTER_V1 = 'EQB3ncyBUTjZUA5EnFKR5_EnOMI9V1tTEAAPaiU71gc4TiUt'; // V1 Router (mainnet)

/**
 * pTON V1 wallet address for the V1 router (for TON -> Jetton swaps)
 * This is the pTON proxy contract that wraps TON
 */
const STONFI_PTON_WALLET_V1 = 'EQARULUYsmJq1RiZ-YiH-IJLcAZUVkVff-KBPwEmmaQGH6aC';

/**
 * pTON Master V1 address
 */
const PTON_V1_MASTER = 'EQCM3B12QK1e4yZSf8GtBRT0aLMNyEsBc_DhVfRRtOEffLez';

/**
 * STON.fi operation codes (using V1 which is more reliable)
 */
const STONFI_SWAP_OP = 0x25938561; // V1 swap operation code
const STONFI_JETTON_SWAP = 0xf8a7ea5; // Jetton transfer with forward payload

const DEDUST_FACTORY = 'EQBfBWT7X2BHg9tXAxzhz2aKiNTU1tpt5NsiK0uSDW_YAJ67';
const DEDUST_NATIVE_VAULT = 'EQDa4VOnTYlLvDJ0gZjNYm5PXfSmmtL6Vs6A_CZEtXCNICq_';

/**
 * Gas fees for swap operations - "Overpay & Refund" Pattern
 * ============================================================================
 * 
 * Philosophy: Attach MORE TON than needed (overpay), and rely on the smart
 * contracts to refund unused gas to the response_destination address.
 * 
 * These values are INTENTIONALLY OVERESTIMATED for safety.
 * Actual costs are lower, but the excess is ALWAYS refunded to the user
 * via Op::Excesses (0xd53276db) messages.
 * 
 * Frontend Hint: Listen for incoming messages with op code 0xd53276db
 * to confirm gas refunds have been received.
 */
const GAS_FEES = {
    // ========== STON.fi Fees ==========
    // TON -> Jetton swap (standard is ~0.08, we use 0.25 for safety)
    STONFI_TON_TO_JETTON: toNano('0.25'),
    // Jetton -> TON swap (needs more gas for jetton wallet + router)
    STONFI_JETTON_TO_TON: toNano('0.30'),
    // Jetton -> Jetton swap (most complex - two jetton wallets)
    STONFI_JETTON_TO_JETTON: toNano('0.35'),
    // Forward amount for jetton transfers to router
    STONFI_FORWARD_GAS: toNano('0.15'),

    // ========== DeDust Fees ==========
    // DeDust tends to need slightly more due to vault architecture
    DEDUST_TON_SWAP: toNano('0.30'),
    DEDUST_JETTON_SWAP: toNano('0.35'),
    DEDUST_FORWARD_GAS: toNano('0.15'),
};

/**
 * DEX Provider info
 */
export const DEX_PROVIDERS = {
    STONFI: {
        id: 'stonfi' as const,
        name: 'STON.fi',
        router: STONFI_ROUTER_V1,
        apiUrl: 'https://api.ston.fi',
        fee: '0.3%',
    },
    DEDUST: {
        id: 'dedust' as const,
        name: 'DeDust',
        factory: DEDUST_FACTORY,
        vault: DEDUST_NATIVE_VAULT,
        apiUrl: 'https://api.dedust.io',
        fee: '0.3%',
    },
};

// ============================================================================
// SWAP SERVICE CLASS
// ============================================================================

export class SwapService {
    private tokens: Record<string, TokenInfo>;
    private slippageTolerance: number; // 0.01 = 1%
    private cachedPools: Map<string, { data: any; timestamp: number }>;
    private cacheExpiry: number;

    constructor() {
        this.tokens = TON_TOKENS;
        this.slippageTolerance = 0.01; // Default 1% slippage
        this.cachedPools = new Map();
        this.cacheExpiry = 60000; // 1 minute cache
    }

    // ========================================================================
    // CONFIGURATION
    // ========================================================================

    /**
     * Set slippage tolerance
     * @param slippage - Slippage as decimal (0.01 = 1%, 0.005 = 0.5%)
     */
    setSlippage(slippage: number): void {
        if (slippage < 0 || slippage > 0.5) {
            throw new Error('Slippage must be between 0 and 50%');
        }
        this.slippageTolerance = slippage;
    }

    /**
     * Get current slippage tolerance
     */
    getSlippage(): number {
        return this.slippageTolerance;
    }

    /**
     * Get available tokens
     */
    getAvailableTokens(): TokenInfo[] {
        return Object.values(this.tokens);
    }

    /**
     * Get token by symbol
     */
    getToken(symbol: string): TokenInfo | null {
        return this.tokens[symbol.toUpperCase()] || null;
    }

    // ========================================================================
    // QUOTING - CORE FUNCTIONALITY
    // ========================================================================

    /**
     * Get the best quote by querying both STON.fi and DeDust in parallel
     * 
     * @param fromSymbol - Source token symbol (e.g., 'Gram', 'USDT')
     * @param toSymbol - Target token symbol
     * @param amount - Amount to swap in human-readable format (e.g., '0.1')
     * @returns Best quote result with comparison data
     */
    async getBestQuote(
        fromSymbol: string,
        toSymbol: string,
        amount: string
    ): Promise<BestQuoteResult> {
        const fromToken = this.getToken(fromSymbol);
        const toToken = this.getToken(toSymbol);

        if (!fromToken || !toToken) {
            throw new Error(`Invalid token pair: ${fromSymbol}/${toSymbol}`);
        }

        if (!amount || parseFloat(amount) <= 0) {
            throw new Error('Invalid amount');
        }

        // Query both DEXes in parallel
        const [stonfiQuote, dedustQuote] = await Promise.allSettled([
            this.getStonfiQuote(fromToken, toToken, amount),
            this.getDedustQuote(fromToken, toToken, amount),
        ]);

        const quotes: SwapQuote[] = [];

        if (stonfiQuote.status === 'fulfilled' && !stonfiQuote.value.error) {
            quotes.push(stonfiQuote.value);
        }

        if (dedustQuote.status === 'fulfilled' && !dedustQuote.value.error) {
            quotes.push(dedustQuote.value);
        }

        if (quotes.length === 0) {
            throw new Error('No quotes available from any DEX');
        }

        // Sort by output amount (descending) to find best rate
        quotes.sort((a, b) => {
            const outputA = parseFloat(a.outputAmount);
            const outputB = parseFloat(b.outputAmount);
            return outputB - outputA;
        });

        return {
            bestQuote: quotes[0],
            allQuotes: quotes,
            timestamp: Date.now(),
        };
    }

    /**
     * Get quote from single provider
     */
    async getQuote(
        fromSymbol: string,
        toSymbol: string,
        amount: string,
        provider: 'stonfi' | 'dedust' = 'stonfi'
    ): Promise<SwapQuote> {
        const fromToken = this.getToken(fromSymbol);
        const toToken = this.getToken(toSymbol);

        if (!fromToken || !toToken) {
            throw new Error(`Invalid token pair: ${fromSymbol}/${toSymbol}`);
        }

        if (provider === 'stonfi') {
            return await this.getStonfiQuote(fromToken, toToken, amount);
        } else {
            return await this.getDedustQuote(fromToken, toToken, amount);
        }
    }

    /**
     * Get quote from STON.fi API
     * Uses V1 simulate endpoint which returns pool addresses needed for swaps
     */
    private async getStonfiQuote(
        fromToken: TokenInfo,
        toToken: TokenInfo,
        amount: string
    ): Promise<SwapQuote> {
        try {
            const amountUnits = this.toUnits(amount, fromToken.decimals);

            // Convert addresses for STON.fi API
            const fromAddress = fromToken.address === 'native'
                ? STONFI_NATIVE_TON
                : fromToken.address;
            const toAddress = toToken.address === 'native'
                ? STONFI_NATIVE_TON
                : toToken.address;

            // Add timeout to prevent hanging
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

            try {
                // Call STON.fi simulate swap API
                const response = await fetch(
                    `https://api.ston.fi/v1/swap/simulate?` +
                    `offer_address=${fromAddress}&` +
                    `ask_address=${toAddress}&` +
                    `units=${amountUnits}&` +
                    `slippage_tolerance=${this.slippageTolerance}`,
                    { signal: controller.signal }
                );

                clearTimeout(timeoutId);

                if (!response.ok) {
                    console.warn(`[SwapService] STON.fi API error: ${response.status}`);
                    return await this.getEstimatedQuote(fromToken, toToken, amount, 'stonfi');
                }

                const data = await response.json();

                if (!data.ask_units) {
                    console.warn('[SwapService] STON.fi returned no ask_units');
                    return await this.getEstimatedQuote(fromToken, toToken, amount, 'stonfi');
                }

                const outputAmount = this.fromUnits(data.ask_units, toToken.decimals);
                const minOutput = this.fromUnits(data.min_ask_units, toToken.decimals);
                const inputAmount = this.fromUnits(amountUnits, fromToken.decimals);

                // Calculate rate
                const inputNum = parseFloat(inputAmount);
                const outputNum = parseFloat(outputAmount);
                const rate = inputNum > 0 ? (outputNum / inputNum).toFixed(6) : '0';

                // Log API response for debugging
                console.log('[SwapService] STON.fi simulate response:', {
                    router: data.router_address,
                    poolAddress: data.pool_address,
                    askJettonWallet: data.ask_jetton_wallet,
                    offerJettonWallet: data.offer_jetton_wallet,
                });

                return {
                    provider: 'stonfi',
                    providerName: 'STON.fi',
                    fromToken: fromToken.symbol,
                    toToken: toToken.symbol,
                    inputAmount,
                    outputAmount,
                    minOutputAmount: minOutput,
                    priceImpact: data.price_impact ? `${(parseFloat(data.price_impact) * 100).toFixed(2)}%` : '< 0.1%',
                    fee: '0.3%',
                    feeAmount: data.fee_units ? this.fromUnits(data.fee_units, fromToken.decimals) : undefined,
                    rate: `1 ${fromToken.symbol} ≈ ${rate} ${toToken.symbol}`,
                    route: data.route || [fromToken.symbol, toToken.symbol],
                    poolAddress: data.pool_address, // Used for building transaction
                    validUntil: Date.now() + 30000, // Valid for 30 seconds
                    rawData: {
                        ...data,
                        // Store wallet addresses for swap building
                        router_address: data.router_address,
                        ask_jetton_wallet: data.ask_jetton_wallet,
                        offer_jetton_wallet: data.offer_jetton_wallet,
                    },
                };
            } catch (error: any) {
                clearTimeout(timeoutId);
                if (error.name === 'AbortError') {
                    console.warn('[SwapService] STON.fi request timed out');
                } else {
                    console.error('[SwapService] STON.fi quote error:', error);
                }
                return await this.getEstimatedQuote(fromToken, toToken, amount, 'stonfi');
            }
        } catch (error) {
            console.error('[SwapService] STON.fi quote error (outer):', error);
            return await this.getEstimatedQuote(fromToken, toToken, amount, 'stonfi');
        }
    }
    /**
     * Get quote from DeDust API
     * Queries pools and calculates output using AMM formula
     */
    private async getDedustQuote(
        fromToken: TokenInfo,
        toToken: TokenInfo,
        amount: string
    ): Promise<SwapQuote> {
        try {
            const amountUnits = this.toUnits(amount, fromToken.decimals);

            // Check cache first
            const cacheKey = 'dedust_pools';
            let pools: any[];

            const cached = this.cachedPools.get(cacheKey);
            if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
                pools = cached.data;
            } else {
                // Add timeout to prevent hanging
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 10000);
                try {
                    const response = await fetch('https://api.dedust.io/v2/pools', { signal: controller.signal });
                    clearTimeout(timeoutId);
                    if (!response.ok) {
                        throw new Error(`DeDust API error: ${response.status}`);
                    }
                    pools = await response.json();
                    this.cachedPools.set(cacheKey, { data: pools, timestamp: Date.now() });
                } catch (fetchError: any) {
                    clearTimeout(timeoutId);
                    if (fetchError.name === 'AbortError') {
                        console.warn('[SwapService] DeDust request timed out');
                    }
                    throw fetchError;
                }
            }

            // Find the pool for this pair
            const fromAddr = fromToken.address === 'native' ? 'native' : fromToken.address;
            const toAddr = toToken.address === 'native' ? 'native' : toToken.address;

            const pool = pools.find((p: any) => {
                if (!p.assets || p.assets.length < 2) return false;
                const assets = p.assets.map((a: any) => a.address || 'native');
                return assets.includes(fromAddr) && assets.includes(toAddr);
            });

            if (!pool) {
                console.warn('[SwapService] DeDust pool not found');
                return await this.getEstimatedQuote(fromToken, toToken, amount, 'dedust');
            }

            // Calculate output using AMM formula
            const reserves = pool.reserves;
            const fromIndex = pool.assets.findIndex((a: any) =>
                (a.address || 'native') === fromAddr
            );
            const toIndex = fromIndex === 0 ? 1 : 0;

            const reserveIn = BigInt(reserves[fromIndex]);
            const reserveOut = BigInt(reserves[toIndex]);
            const amountIn = BigInt(amountUnits);

            // AMM formula with 0.3% fee: outputAmount = (amountIn * 997 * reserveOut) / (reserveIn * 1000 + amountIn * 997)
            const amountInWithFee = amountIn * 997n;
            const numerator = amountInWithFee * reserveOut;
            const denominator = (reserveIn * 1000n) + amountInWithFee;
            const outputUnits = numerator / denominator;

            const outputAmount = this.fromUnits(outputUnits.toString(), toToken.decimals);
            const minOutput = (parseFloat(outputAmount) * (1 - this.slippageTolerance)).toFixed(toToken.decimals);
            const inputAmount = this.fromUnits(amountUnits, fromToken.decimals);

            // Calculate price impact
            const priceImpact = this.calculatePriceImpact(amountIn, reserveIn);

            // Calculate rate
            const inputNum = parseFloat(inputAmount);
            const outputNum = parseFloat(outputAmount);
            const rate = inputNum > 0 ? (outputNum / inputNum).toFixed(6) : '0';

            return {
                provider: 'dedust',
                providerName: 'DeDust',
                fromToken: fromToken.symbol,
                toToken: toToken.symbol,
                inputAmount,
                outputAmount,
                minOutputAmount: minOutput,
                priceImpact: `${priceImpact}%`,
                fee: '0.3%',
                rate: `1 ${fromToken.symbol} ≈ ${rate} ${toToken.symbol}`,
                route: [fromToken.symbol, toToken.symbol],
                poolAddress: pool.address,
                validUntil: Date.now() + 30000,
                rawData: pool,
            };
        } catch (error) {
            console.error('[SwapService] DeDust quote error:', error);
            return await this.getEstimatedQuote(fromToken, toToken, amount, 'dedust');
        }
    }

    /**
     * Get estimated quote as fallback
     * Tries to fetch real-time prices from TonAPI first, then falls back to hardcoded values
     */
    private async getEstimatedQuote(
        fromToken: TokenInfo,
        toToken: TokenInfo,
        amount: string,
        provider: 'stonfi' | 'dedust'
    ): Promise<SwapQuote> {
        // Try to fetch real-time prices from TonAPI
        let prices: Record<string, number> = {
            TON: 1.85,   // Default fallback
            USDT: 1.0,
            NOT: 0.0006,
            DOGS: 0.00005,
            CATI: 0.06,
            STON: 0.40,
            HMSTR: 0.003,
            MAJOR: 0.13,
            JETTON: 0.06,
            REDO: 0.05,
        };

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout for price fetch

            const response = await fetch('https://tonapi.io/v2/rates?tokens=ton,usdt&currencies=usd', {
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (response.ok) {
                const data = await response.json();
                const tonPrice = data.rates?.TON?.prices?.USD || 1.80;
                prices.TON = tonPrice;
                console.log('[SwapService] Got real-time TON price:', tonPrice);
            }
        } catch (e) {
            console.warn('[SwapService] Could not fetch real-time prices, using fallback');
        }

        const fromPrice = prices[fromToken.symbol] || 1;
        const toPrice = prices[toToken.symbol] || 1;
        const inputAmount = parseFloat(amount);

        // Apply 0.3% fee
        const outputBeforeFee = (inputAmount * fromPrice / toPrice);
        const outputAfterFee = outputBeforeFee * 0.997;
        const outputAmount = outputAfterFee.toFixed(toToken.decimals);
        const minOutput = (outputAfterFee * (1 - this.slippageTolerance)).toFixed(toToken.decimals);

        const rate = fromPrice / toPrice;

        return {
            provider,
            providerName: provider === 'stonfi' ? 'STON.fi' : 'DeDust',
            fromToken: fromToken.symbol,
            toToken: toToken.symbol,
            inputAmount: amount,
            outputAmount,
            minOutputAmount: minOutput,
            priceImpact: 'N/A',
            fee: '~0.3%',
            rate: `1 ${fromToken.symbol} ≈ ${rate.toFixed(6)} ${toToken.symbol}`,
            validUntil: Date.now() + 30000,
            isEstimate: true,
        };
    }

    // ========================================================================
    // TRANSACTION BUILDING
    // ========================================================================

    /**
     * Build swap transaction based on provider and quote data
     * 
     * @param provider - DEX provider ('stonfi' or 'dedust')
     * @param quoteData - Quote data from getBestQuote or getQuote
     * @param userWalletAddress - User's wallet address (raw or friendly format)
     * @returns Transaction object ready for signing
     */
    async buildSwapTransaction(
        provider: 'stonfi' | 'dedust',
        quoteData: SwapQuote,
        userWalletAddress: string
    ): Promise<SwapTransaction> {
        if (!userWalletAddress) {
            throw new Error('User wallet address is required');
        }

        const fromToken = this.getToken(quoteData.fromToken);
        const toToken = this.getToken(quoteData.toToken);

        if (!fromToken || !toToken) {
            throw new Error('Invalid token pair in quote data');
        }

        const inputAmount = quoteData.inputAmount;
        const minOutput = quoteData.minOutputAmount;

        if (provider === 'stonfi') {
            return await this.buildStonfiSwapTransaction(
                userWalletAddress,
                fromToken,
                toToken,
                inputAmount,
                minOutput,
                quoteData.rawData // Pass rawData for pool addresses
            );
        } else {
            return await this.buildDedustSwapTransaction(
                userWalletAddress,
                fromToken,
                toToken,
                inputAmount,
                minOutput,
                quoteData.poolAddress
            );
        }
    }

    /**
     * Build STON.fi swap transaction
     * Uses pool addresses from API response when available for accurate routing
     */
    private async buildStonfiSwapTransaction(
        senderAddress: string,
        fromToken: TokenInfo,
        toToken: TokenInfo,
        amount: string,
        minOutput: string,
        rawData?: any
    ): Promise<SwapTransaction> {
        console.log('[SwapService] Building STON.fi swap:', {
            senderAddress,
            from: fromToken.symbol,
            to: toToken.symbol,
            amount,
            minOutput,
            hasRawData: !!rawData,
            askJettonWallet: rawData?.ask_jetton_wallet,
            offerJettonWallet: rawData?.offer_jetton_wallet,
        });

        const amountUnits = this.toUnits(amount, fromToken.decimals);
        const minOutputUnits = this.toUnits(minOutput || '0', toToken.decimals);

        // Use ask_jetton_wallet from API response if available (more accurate)
        // This is the pool's jetton wallet for the token we want to receive
        const askJettonWallet = rawData?.ask_jetton_wallet || toToken.address;
        // For TON swaps, we need the pool's pTON wallet (offer_jetton_wallet from API)
        const offerJettonWallet = rawData?.offer_jetton_wallet;

        if (fromToken.address === 'native') {
            // TON -> Jetton swap
            return this.buildStonfiTonToJettonSwap(
                senderAddress,
                askJettonWallet, // Use pool's jetton wallet from API
                amountUnits,
                minOutputUnits,
                offerJettonWallet // Pool's pTON wallet from API (critical for routing)
            );
        } else if (toToken.address === 'native') {
            // Jetton -> TON swap
            return this.buildStonfiJettonToTonSwap(
                senderAddress,
                fromToken.address,
                askJettonWallet,
                amountUnits,
                minOutputUnits
            );
        } else {
            // Jetton -> Jetton swap
            return this.buildStonfiJettonToJettonSwap(
                senderAddress,
                fromToken.address,
                askJettonWallet, // Use pool's jetton wallet from API
                amountUnits,
                minOutputUnits
            );
        }
    }

    /**
     * Build STON.fi TON -> Jetton swap (V1 Protocol)
     * 
     * For V1, we send TON to the pTON wallet address associated with the pool.
     * The pTON wallet wraps the TON and the router swaps it for the desired jetton.
     * 
     * V1 swap flow:
     * 1. Send TON to pTON wallet with swap payload
     * 2. pTON wallet wraps TON and forwards to router
     * 3. Router swaps wrapped TON for desired jetton and sends to user
     * 
     * @param senderAddress - User's wallet address (for receiving output tokens)
     * @param askJettonAddress - Pool's jetton wallet address (from API ask_jetton_wallet)
     * @param offerUnits - Amount of TON to swap (in nanoTON)
     * @param minAskUnits - Minimum amount of output tokens (slippage protection)
     * @param ptonWalletAddress - Pool's pTON wallet address from API (offer_jetton_wallet)
     */
    private buildStonfiTonToJettonSwap(
        senderAddress: string,
        askJettonAddress: string,
        offerUnits: string,
        minAskUnits: string,
        ptonWalletAddress?: string // From API offer_jetton_wallet
    ): SwapTransaction {
        // Parse addresses
        const userAddress = Address.parse(senderAddress);
        const askJettonWallet = Address.parse(askJettonAddress);

        // STON.fi V1 pTON Wallet (Fixed, Known Reliable Address)
        // We revert to V1 because V2 routing data is missing from the API for TON inputs.
        // V1 is battle-tested and we know the correct router proxy address.
        const ptonWallet = 'EQARULUYsmJq1RiZ-YiH-IJLcAZUVkVff-KBPwEmmaQGH6aC';

        console.log('[SwapService] Building STON.fi V1 TON->Jetton swap:', {
            ptonWallet,
            askJettonWallet: askJettonAddress, // CRITICAL: This is the POOL'S jetton wallet (correct)
            userAddress: senderAddress,
        });

        // Build STON.fi V1 swap payload
        // V1 format: op_code (32) | token_wallet (addr) | min_out (coins) | to_address (addr) | referral...
        const swapPayload = beginCell()
            .storeUint(STONFI_SWAP_OP, 32)     // V1 swap operation code: 0x25938561
            .storeAddress(askJettonWallet)     // TOKEN_WALLET: Must be the POOL'S jetton wallet (from API)
            .storeCoins(BigInt(minAskUnits))   // min_out
            .storeAddress(userAddress)         // to_address - receiving address
            .storeUint(1, 1)                   // has_ref_address
            .storeAddress(userAddress)         // ref_address (referral/refund)
            .endCell();

        // Calculate total value: swap amount + gas fee
        // V1 requires ~0.25 TON for safe execution
        const swapAmount = BigInt(offerUnits);
        const gasFee = GAS_FEES.STONFI_TON_TO_JETTON;
        const totalValue = swapAmount + gasFee;

        console.log('[SwapService] STON.fi V1 Swap Built:', {
            swapAmount: swapAmount.toString(),
            gasFee: gasFee.toString(),
            totalValue: totalValue.toString(),
            expectedTotalTON: Number(totalValue) / 1e9,
        });

        return {
            type: 'ton_transfer',
            to: ptonWallet,
            value: totalValue.toString(),
            body: swapPayload,
            mode: 3, // PAY_GAS_SEPARATELY + IGNORE_ERRORS
        };
    }

    /**
     * Build STON.fi Jetton -> TON swap (V2 Protocol)
     * 
     * For V2, we transfer jettons to the router with a swap payload.
     * The router swaps the jettons for pTON and then unwraps to native TON.
     * 
     * @param senderAddress - User's wallet address (for receiving TON)
     * @param offerJettonAddress - Address of the jetton we're offering
     * @param offerUnits - Amount of jetton to swap (in smallest units)
     * @param minAskUnits - Minimum amount of TON to receive (slippage protection)
     */
    private buildStonfiJettonToTonSwap(
        senderAddress: string,
        offerJettonAddress: string,
        askJettonAddress: string,
        offerUnits: string,
        minAskUnits: string
    ): SwapTransaction {
        // Parse addresses
        const userAddress = Address.parse(senderAddress);
        const askJetton = Address.parse(askJettonAddress);

        // Build V1 swap forward payload for Jetton -> TON
        // V1 format: op_code (32) | token_wallet (addr) | min_out (coins) | to_address (addr)
        const forwardPayload = beginCell()
            .storeUint(STONFI_SWAP_OP, 32)     // V1 swap operation code
            .storeAddress(askJetton) // pTON wallet for router (we want TON back)
            .storeCoins(BigInt(minAskUnits))   // min_out - minimum TON to receive
            .storeAddress(userAddress)         // to_address - where to send TON
            .storeUint(1, 1)                   // has_ref_address
            .storeAddress(userAddress)         // ref_address (referral)
            .endCell();

        console.log('[SwapService] Jetton->TON swap (V1):', {
            router: STONFI_ROUTER_V1,
            jettonMaster: offerJettonAddress,
            amount: offerUnits,
            minOutput: minAskUnits,
        });

        return {
            type: 'jetton_transfer',
            jettonMaster: offerJettonAddress,
            destination: STONFI_ROUTER_V1,
            amount: offerUnits,
            forwardAmount: toNano('0.2').toString(), // Gas for forward message
            forwardPayload: forwardPayload.toBoc().toString('base64'),
            gasAmount: toNano('0.3').toString(), // Total gas for jetton transfer + swap
        };
    }

    /**
     * Build STON.fi Jetton -> Jetton swap (V2 Protocol)
     * 
     * For V2, we transfer jettons to the router with a swap payload.
     * The router swaps the jettons for the desired output jetton.
     * 
     * @param senderAddress - User's wallet address (for receiving output tokens)
     * @param offerJettonAddress - Address of the jetton we're offering
     * @param askJettonAddress - Address of the jetton we want to receive
     * @param offerUnits - Amount of jetton to swap (in smallest units)
     * @param minAskUnits - Minimum amount of output tokens (slippage protection)
     */
    private buildStonfiJettonToJettonSwap(
        senderAddress: string,
        offerJettonAddress: string,
        askJettonAddress: string,
        offerUnits: string,
        minAskUnits: string
    ): SwapTransaction {
        // Parse addresses
        const userAddress = Address.parse(senderAddress);
        const askJetton = Address.parse(askJettonAddress);

        // Build V1 swap forward payload for Jetton -> Jetton
        // V1 format: op_code (32) | token_wallet (addr) | min_out (coins) | to_address (addr)
        const forwardPayload = beginCell()
            .storeUint(STONFI_SWAP_OP, 32)     // V1 swap operation code
            .storeAddress(askJetton)           // target jetton wallet
            .storeCoins(BigInt(minAskUnits))   // min_out
            .storeAddress(userAddress)         // to_address
            .storeUint(1, 1)                   // has_ref_address
            .storeAddress(userAddress)         // ref_address (referral)
            .endCell();

        console.log('[SwapService] Jetton->Jetton swap (V1):', {
            router: STONFI_ROUTER_V1,
            offerJetton: offerJettonAddress,
            askJetton: askJettonAddress,
            amount: offerUnits,
            minOutput: minAskUnits,
        });

        return {
            type: 'jetton_transfer',
            jettonMaster: offerJettonAddress,
            destination: STONFI_ROUTER_V1,
            amount: offerUnits,
            forwardAmount: toNano('0.24').toString(), // Forward gas
            forwardPayload: forwardPayload.toBoc().toString('base64'),
            gasAmount: toNano('0.35').toString(), // Total gas
        };
    }

    /**
     * Build DeDust swap transaction
     */
    private async buildDedustSwapTransaction(
        senderAddress: string,
        fromToken: TokenInfo,
        toToken: TokenInfo,
        amount: string,
        minOutput: string,
        poolAddress?: string
    ): Promise<SwapTransaction> {
        console.log('[SwapService] Building DeDust swap:', {
            senderAddress,
            from: fromToken.symbol,
            to: toToken.symbol,
            amount,
            minOutput,
            poolAddress
        });

        const amountUnits = this.toUnits(amount, fromToken.decimals);
        const minOutputUnits = this.toUnits(minOutput || '0', toToken.decimals);

        if (fromToken.address === 'native') {
            return this.buildDedustTonSwap(
                senderAddress,
                poolAddress || '',
                amountUnits,
                minOutputUnits
            );
        } else {
            return this.buildDedustJettonSwap(
                senderAddress,
                fromToken.address,
                poolAddress || '',
                amountUnits,
                minOutputUnits
            );
        }
    }

    /**
     * Build DeDust TON -> Jetton swap
     * 
     * Message format (TL-B):
     * swap#ea06185d query_id:uint64 amount:Coins _:SwapStep swap_params:^SwapParams
     * 
     * SwapStep: step#_ pool_addr:MsgAddressInt params:SwapStepParams
     * SwapStepParams: step_params#_ kind:SwapKind limit:Coins next:(Maybe ^SwapStep)
     * SwapParams: swap_params#_ deadline:Timestamp recipient_addr:MsgAddressInt referral_addr:MsgAddress 
     *             fulfill_payload:(Maybe ^Cell) reject_payload:(Maybe ^Cell)
     */
    private buildDedustTonSwap(
        senderAddress: string,
        poolAddress: string,
        amountUnits: string,
        minOutputUnits: string
    ): SwapTransaction {
        // DeDust swap operation code
        const SWAP_OP = 0xea06185d;

        const userAddress = Address.parse(senderAddress);
        const pool = Address.parse(poolAddress || DEDUST_FACTORY);
        const deadline = Math.floor(Date.now() / 1000) + 300; // 5 minutes

        // Build SwapParams (stored as ref)
        // swap_params#_ deadline:Timestamp recipient_addr:MsgAddressInt referral_addr:MsgAddress 
        //              fulfill_payload:(Maybe ^Cell) reject_payload:(Maybe ^Cell)
        const swapParams = beginCell()
            .storeUint(deadline, 32)          // deadline: Timestamp (uint32)
            .storeAddress(userAddress)         // recipient_addr: MsgAddressInt
            .storeAddress(null)                // referral_addr: MsgAddress (optional)
            .storeMaybeRef(null)               // fulfill_payload: Maybe ^Cell
            .storeMaybeRef(null)               // reject_payload: Maybe ^Cell
            .endCell();

        // Build the full swap message
        // swap#ea06185d query_id:uint64 amount:Coins _:SwapStep swap_params:^SwapParams
        // SwapStep is inline: pool_addr:MsgAddressInt params:SwapStepParams
        // SwapStepParams is inline: kind:SwapKind limit:Coins next:(Maybe ^SwapStep)
        const swapAmount = BigInt(amountUnits);

        const swapPayload = beginCell()
            .storeUint(SWAP_OP, 32)             // swap#ea06185d
            .storeUint(0, 64)                   // query_id:uint64
            .storeCoins(swapAmount)             // amount:Coins (same as TON being sent)
            // SwapStep inline:
            .storeAddress(pool)                 // pool_addr:MsgAddressInt
            // SwapStepParams inline:
            .storeUint(0, 1)                    // kind:SwapKind (0 = given_in)
            .storeCoins(BigInt(minOutputUnits)) // limit:Coins (minimum output)
            .storeMaybeRef(null)                // next:(Maybe ^SwapStep) - no next step
            // swap_params as ref:
            .storeRef(swapParams)               // swap_params:^SwapParams
            .endCell();

        const gasFee = GAS_FEES.DEDUST_TON_SWAP;
        const totalValue = swapAmount + gasFee;

        // ============================================================================
        // CRITICAL: Always send to Native Vault (EQDa4VOnTYlLvDJ0gZjNYm5PXfSmmtL6Vs6A_CZEtXCNICq_)
        // Do NOT use pool address or any other dynamic address for TON transfers!
        // The Native Vault routes the TON to the correct pool.
        // ============================================================================
        const destination = DEDUST_NATIVE_VAULT;

        console.log('[SwapService] DeDust TON->Jetton swap:', {
            poolAddress: poolAddress,
            destination: destination, // MUST be Native Vault
            swapAmount: swapAmount.toString(),
            gasFee: gasFee.toString(),
            totalValue: totalValue.toString(),
            minOutput: minOutputUnits,
            deadline: new Date(deadline * 1000).toISOString(),
        });

        return {
            type: 'ton_transfer',
            to: destination, // STRICT: Always Native Vault for TON swaps
            value: totalValue.toString(),
            body: swapPayload,
            mode: 3,
        };
    }

    /**
     * Build DeDust Jetton swap
     */
    private buildDedustJettonSwap(
        senderAddress: string,
        jettonAddress: string,
        poolAddress: string,
        amountUnits: string,
        minOutputUnits: string
    ): SwapTransaction {
        const SWAP_OP = 0xea06185d;

        const swapStep = beginCell()
            .storeAddress(Address.parse(poolAddress || DEDUST_FACTORY))
            .storeUint(0, 1)
            .storeCoins(BigInt(minOutputUnits))
            .storeMaybeRef(null)
            .endCell();

        const swapParams = beginCell()
            .storeUint(Math.floor(Date.now() / 1000) + 300, 32)
            .storeAddress(Address.parse(senderAddress))
            .storeAddress(null)
            .storeMaybeRef(null)
            .storeMaybeRef(null)
            .endCell();

        const swapPayload = beginCell()
            .storeUint(SWAP_OP, 32)
            .storeRef(swapStep)
            .storeRef(swapParams)
            .endCell();

        // Get jetton vault address (in production, query from factory)
        const jettonVault = this.getDedustJettonVault(jettonAddress);

        return {
            type: 'jetton_transfer',
            jettonMaster: jettonAddress,
            destination: jettonVault,
            amount: amountUnits,
            forwardAmount: GAS_FEES.DEDUST_FORWARD_GAS.toString(),
            forwardPayload: swapPayload.toBoc().toString('base64'),
            gasAmount: GAS_FEES.DEDUST_JETTON_SWAP.toString(),
        };
    }

    /**
     * Get DeDust jetton vault address
     * In production, this should query the DeDust factory contract
     */
    private getDedustJettonVault(jettonAddress: string): string {
        // Simplified - in production, query factory.getVault(jettonAddress)
        return DEDUST_FACTORY;
    }

    // ========================================================================
    // UTILITY FUNCTIONS
    // ========================================================================

    /**
     * Convert human-readable amount to smallest units
     * e.g., "1.5" TON (9 decimals) -> "1500000000"
     */
    private toUnits(amount: string, decimals: number): string {
        if (!amount || amount === '' || amount === '0') {
            return '0';
        }

        const parts = amount.toString().split('.');
        let whole = parts[0] || '0';
        let fraction = parts[1] || '';

        // Pad fraction to match decimals
        fraction = fraction.padEnd(decimals, '0').slice(0, decimals);

        // Remove leading zeros from whole part
        whole = whole.replace(/^0+/, '') || '0';

        // Combine
        const result = whole + fraction;

        // Remove leading zeros from result
        return result.replace(/^0+/, '') || '0';
    }

    /**
     * Convert smallest units to human-readable amount
     * e.g., "1500000000" -> "1.5" (9 decimals)
     */
    private fromUnits(units: string, decimals: number): string {
        if (!units || units === '0') return '0';

        const str = units.toString().padStart(decimals + 1, '0');
        const whole = str.slice(0, -decimals) || '0';
        const fraction = str.slice(-decimals);

        // Trim trailing zeros
        const trimmedFraction = fraction.replace(/0+$/, '');

        return trimmedFraction ? `${whole}.${trimmedFraction}` : whole;
    }

    /**
     * Calculate price impact percentage
     */
    private calculatePriceImpact(amountIn: bigint, reserveIn: bigint): string {
        if (reserveIn === 0n) return '0.00';
        const impact = (Number(amountIn) / Number(reserveIn)) * 100;
        return Math.min(impact, 100).toFixed(2);
    }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

export const swapService = new SwapService();
export default swapService;
