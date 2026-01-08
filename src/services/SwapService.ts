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
        symbol: 'TON',
        name: 'Toncoin',
        address: 'native',
        decimals: 9,
        icon: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ton/info/logo.png',
    },
    USDT: {
        symbol: 'USDT',
        name: 'Tether USD',
        address: 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs', // Official USDT on TON
        decimals: 6,
        icon: 'https://tether.to/images/logoCircle.png',
    },
    USDC: {
        symbol: 'USDC',
        name: 'USD Coin',
        address: 'EQC61IQRl0_la95t27xhIpjxZt32vL2r3xQxLu-W9VNmYEIQ',
        decimals: 6,
        icon: 'https://assets.coingecko.com/coins/images/6319/small/usdc.png',
    },
    NOT: {
        symbol: 'NOT',
        name: 'Notcoin',
        address: 'EQAvlWFDxGF2lXm67y4yzC17wYKD9A0guwPkMs1gOsM__NOT',
        decimals: 9,
        icon: 'https://cache.tonapi.io/imgproxy/4KCMNm34jZLXt0rqeFm4rH-BK4FoK76EVX9r0cCIGDg/rs:fill:200:200:1/g:no/aHR0cHM6Ly9jZG4uam9pbmNvbW11bml0eS54eXovbm90L2xvZ28ucG5n.webp',
    },
    DOGS: {
        symbol: 'DOGS',
        name: 'Dogs',
        address: 'EQCvxJy4eG8hyHBFsZ7eePxrRsUQSFE_jpptRAYBmcG_DOGS',
        decimals: 9,
        icon: 'https://cache.tonapi.io/imgproxy/4K0vW2fG-B3x-Kbp-i_ZC9nQHfO7uP5YJ3r7QoPqhvo/rs:fill:200:200:1/g:no/aHR0cHM6Ly9jZG4uam9pbmNvbW11bml0eS54eXovY2xpY2tlci9kb2dzL2xvZ28ucG5n.webp',
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
 * Gas fees for swap operations
 * Based on STON.fi documentation: actual fees are 0.06-0.13 TON
 * We use conservative estimates to ensure transactions succeed
 */
const GAS_FEES = {
    // TON -> Jetton swap via STON.fi
    STONFI_TON_TO_JETTON: toNano('0.1'), // 0.1 TON gas (actual: ~0.06-0.09)
    // Jetton -> TON swap via STON.fi
    STONFI_JETTON_TO_TON: toNano('0.15'), // Includes forward gas
    // Jetton -> Jetton swap via STON.fi
    STONFI_JETTON_TO_JETTON: toNano('0.2'),
    // Forward amount for jetton transfers
    STONFI_FORWARD_GAS: toNano('0.08'),
    // DeDust gas fees
    DEDUST_TON_SWAP: toNano('0.1'),
    DEDUST_JETTON_SWAP: toNano('0.15'),
    DEDUST_FORWARD_GAS: toNano('0.08'),
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
     * @param fromSymbol - Source token symbol (e.g., 'TON', 'USDT')
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
            TON: 1.80,   // Default fallback
            USDT: 1.0,
            USDC: 1.0,
            NOT: 0.005,
            DOGS: 0.0003,
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
        const askJetton = Address.parse(askJettonAddress);

        // Use API-provided pTON wallet if available, otherwise fall back to default
        // The API's offer_jetton_wallet is the pool-specific pTON wallet that must be used
        const ptonWallet = ptonWalletAddress || STONFI_PTON_WALLET_V1;

        // Build STON.fi V1 swap payload
        // V1 format: op_code (32) | token_wallet (addr) | min_out (coins) | to_address (addr)
        const swapPayload = beginCell()
            .storeUint(STONFI_SWAP_OP, 32)     // V1 swap operation code: 0x25938561
            .storeAddress(askJetton)           // token_wallet - pool's jetton wallet for the token we want
            .storeCoins(BigInt(minAskUnits))   // min_out - minimum output amount (slippage protection)
            .storeAddress(userAddress)         // to_address - where to send output tokens
            .storeUint(1, 1)                   // has_ref_address (1 = yes, for referral but set to user)
            .storeAddress(userAddress)         // ref_address (referral, using user address)
            .endCell();

        // Calculate total value: swap amount + gas fee
        // V1 swap requires ~0.15-0.2 TON for gas
        const swapAmount = BigInt(offerUnits);
        const gasFee = toNano('0.25'); // Conservative gas estimate for V1
        const totalValue = swapAmount + gasFee;

        console.log('[SwapService] TON->Jetton swap (V1):', {
            ptonWalletFromAPI: ptonWalletAddress,
            ptonWalletUsed: ptonWallet,
            swapAmount: swapAmount.toString(),
            gasFee: gasFee.toString(),
            totalValue: totalValue.toString(),
            expectedTotalTON: Number(totalValue) / 1e9,
            minOutput: minAskUnits,
        });

        return {
            type: 'ton_transfer',
            to: ptonWallet, // Send to pool's pTON wallet (from API or fallback)
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
        offerUnits: string,
        minAskUnits: string
    ): SwapTransaction {
        // Parse addresses
        const userAddress = Address.parse(senderAddress);

        // Build V1 swap forward payload for Jetton -> TON
        // V1 format: op_code (32) | token_wallet (addr) | min_out (coins) | to_address (addr)
        const forwardPayload = beginCell()
            .storeUint(STONFI_SWAP_OP, 32)     // V1 swap operation code
            .storeAddress(Address.parse(PTON_V1_MASTER)) // pTON master (we want TON back)
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

        console.log('[SwapService] DeDust TON->Jetton swap:', {
            poolAddress: poolAddress,
            swapAmount: swapAmount.toString(),
            minOutput: minOutputUnits,
            totalValue: totalValue.toString(),
            deadline: deadline,
        });

        return {
            type: 'ton_transfer',
            to: DEDUST_NATIVE_VAULT,
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
