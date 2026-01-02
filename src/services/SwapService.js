/**
 * SwapService - On-chain DEX Integration
 * 
 * Integrates with STON.fi and DeDust for real on-chain swaps.
 * Supports TON ↔ Jetton and Jetton ↔ Jetton swaps.
 */

import { Address, beginCell, toNano } from '@ton/core';

// TON Token Addresses (Mainnet)
export const TON_TOKENS = {
    TON: {
        symbol: 'TON',
        name: 'Toncoin',
        address: 'native', // Native TON
        decimals: 9,
        icon: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ton/info/logo.png',
    },
    USDT: {
        symbol: 'USDT',
        name: 'Tether USD',
        address: 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs',
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

// STON.fi DEX Router (Mainnet)
const STONFI_ROUTER = 'EQB3ncyBUTjZUA5EnFKR5_EnOMI9V1tTEAAPaiU71gc4TiUt';

// DeDust Factory (Mainnet)
const DEDUST_FACTORY = 'EQBfBWT7X2BHg9tXAxzhz2aKiNTU1tpt5NsiK0uSDW_YAJ67';
const DEDUST_NATIVE_VAULT = 'EQDa4VOnTYlLvDJ0gZjNYm5PXfSmmtL6Vs6A_CZEtXCNICq_';

// DEX Providers
export const DEX_PROVIDERS = {
    STONFI: {
        id: 'stonfi',
        name: 'STON.fi',
        router: STONFI_ROUTER,
        apiUrl: 'https://api.ston.fi',
    },
    DEDUST: {
        id: 'dedust',
        name: 'DeDust',
        factory: DEDUST_FACTORY,
        vault: DEDUST_NATIVE_VAULT,
        apiUrl: 'https://api.dedust.io',
    },
};

export class SwapService {
    constructor() {
        this.tokens = TON_TOKENS;
        this.providers = DEX_PROVIDERS;
        this.cachedPools = new Map();
        this.cacheExpiry = 60000; // 1 minute cache
    }

    /**
     * Get available tokens for swapping
     */
    getAvailableTokens() {
        return Object.values(this.tokens);
    }

    /**
     * Get token by symbol
     */
    getToken(symbol) {
        return this.tokens[symbol.toUpperCase()] || null;
    }

    /**
     * Get swap quote from STON.fi API
     * @param {string} fromSymbol - Source token symbol
     * @param {string} toSymbol - Target token symbol  
     * @param {string} amount - Amount to swap (in human readable format)
     * @returns {Promise<object>} Quote with estimated output
     */
    async getQuote(fromSymbol, toSymbol, amount, provider = 'stonfi') {
        try {
            const fromToken = this.getToken(fromSymbol);
            const toToken = this.getToken(toSymbol);

            if (!fromToken || !toToken) {
                throw new Error('Invalid token pair');
            }

            const amountInUnits = this.toUnits(amount, fromToken.decimals);

            if (provider === 'stonfi') {
                return await this.getStonfiQuote(fromToken, toToken, amountInUnits);
            } else {
                return await this.getDedustQuote(fromToken, toToken, amountInUnits);
            }
        } catch (error) {
            console.error('[SwapService] Quote error:', error);
            return {
                error: error.message,
                fromSymbol,
                toSymbol,
                amount,
            };
        }
    }

    /**
     * Get quote from STON.fi
     */
    async getStonfiQuote(fromToken, toToken, amountUnits) {
        try {
            // STON.fi simulate swap endpoint
            const fromAddress = fromToken.address === 'native'
                ? 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c'
                : fromToken.address;
            const toAddress = toToken.address === 'native'
                ? 'EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c'
                : toToken.address;

            const response = await fetch(
                `https://api.ston.fi/v1/swap/simulate?` +
                `offer_address=${fromAddress}&` +
                `ask_address=${toAddress}&` +
                `units=${amountUnits}&` +
                `slippage_tolerance=0.01`
            );

            if (!response.ok) {
                throw new Error(`STON.fi API error: ${response.status}`);
            }

            const data = await response.json();

            const outputAmount = this.fromUnits(data.ask_units, toToken.decimals);
            const minOutput = this.fromUnits(data.min_ask_units, toToken.decimals);

            return {
                provider: 'stonfi',
                fromToken: fromToken.symbol,
                toToken: toToken.symbol,
                inputAmount: this.fromUnits(amountUnits, fromToken.decimals),
                outputAmount,
                minOutputAmount: minOutput,
                priceImpact: data.price_impact || 0,
                route: data.route || [],
                fee: data.fee_units ? this.fromUnits(data.fee_units, fromToken.decimals) : '0',
                validUntil: Date.now() + 30000, // 30 seconds
                rawData: data,
            };
        } catch (error) {
            console.error('[SwapService] STON.fi quote error:', error);
            // Return estimated quote if API fails
            return this.getEstimatedQuote(fromToken, toToken, amountUnits, 'stonfi');
        }
    }

    /**
     * Get quote from DeDust
     */
    async getDedustQuote(fromToken, toToken, amountUnits) {
        try {
            // DeDust pools endpoint
            const response = await fetch('https://api.dedust.io/v2/pools');

            if (!response.ok) {
                throw new Error(`DeDust API error: ${response.status}`);
            }

            const pools = await response.json();

            // Find relevant pool
            const fromAddr = fromToken.address === 'native' ? 'native' : fromToken.address;
            const toAddr = toToken.address === 'native' ? 'native' : toToken.address;

            const pool = pools.find(p => {
                const assets = p.assets.map(a => a.address || 'native');
                return assets.includes(fromAddr) && assets.includes(toAddr);
            });

            if (!pool) {
                return this.getEstimatedQuote(fromToken, toToken, amountUnits, 'dedust');
            }

            // Calculate output based on pool reserves (simplified AMM formula)
            const reserves = pool.reserves;
            const fromIndex = pool.assets.findIndex(a =>
                (a.address || 'native') === fromAddr
            );
            const toIndex = fromIndex === 0 ? 1 : 0;

            const reserveIn = BigInt(reserves[fromIndex]);
            const reserveOut = BigInt(reserves[toIndex]);
            const amountIn = BigInt(amountUnits);

            // AMM formula: outputAmount = (amountIn * reserveOut) / (reserveIn + amountIn)
            // With 0.3% fee
            const amountInWithFee = amountIn * 997n;
            const numerator = amountInWithFee * reserveOut;
            const denominator = (reserveIn * 1000n) + amountInWithFee;
            const outputUnits = numerator / denominator;

            const outputAmount = this.fromUnits(outputUnits.toString(), toToken.decimals);
            const minOutput = (parseFloat(outputAmount) * 0.99).toFixed(toToken.decimals); // 1% slippage

            return {
                provider: 'dedust',
                fromToken: fromToken.symbol,
                toToken: toToken.symbol,
                inputAmount: this.fromUnits(amountUnits, fromToken.decimals),
                outputAmount,
                minOutputAmount: minOutput,
                priceImpact: this.calculatePriceImpact(amountIn, reserveIn),
                poolAddress: pool.address,
                fee: '0.3%',
                validUntil: Date.now() + 30000,
                rawData: pool,
            };
        } catch (error) {
            console.error('[SwapService] DeDust quote error:', error);
            return this.getEstimatedQuote(fromToken, toToken, amountUnits, 'dedust');
        }
    }

    /**
     * Get estimated quote (fallback when API fails)
     */
    getEstimatedQuote(fromToken, toToken, amountUnits, provider) {
        // Rough price estimates (would come from price oracle in production)
        const prices = {
            TON: 5.5,
            USDT: 1.0,
            USDC: 1.0,
            NOT: 0.007,
            DOGS: 0.0005,
        };

        const fromPrice = prices[fromToken.symbol] || 1;
        const toPrice = prices[toToken.symbol] || 1;
        const inputAmount = parseFloat(this.fromUnits(amountUnits, fromToken.decimals));
        const outputAmount = (inputAmount * fromPrice / toPrice).toFixed(toToken.decimals);

        return {
            provider,
            fromToken: fromToken.symbol,
            toToken: toToken.symbol,
            inputAmount: inputAmount.toString(),
            outputAmount,
            minOutputAmount: (parseFloat(outputAmount) * 0.98).toFixed(toToken.decimals),
            priceImpact: 0,
            isEstimate: true,
            fee: '~0.3%',
            validUntil: Date.now() + 30000,
        };
    }

    /**
     * Build swap transaction for STON.fi
     * Returns message parameters that can be sent via wallet
     */
    async buildStonfiSwapTransaction(senderAddress, fromToken, toToken, amount, minOutput) {
        console.log('[SwapService] Building STON.fi swap:', { senderAddress, fromToken, toToken, amount, minOutput });

        if (!senderAddress || !fromToken || !toToken) {
            throw new Error('Missing required parameters for swap');
        }

        if (!amount || parseFloat(amount) <= 0) {
            throw new Error('Invalid swap amount');
        }

        const fromTokenData = this.getToken(fromToken);
        const toTokenData = this.getToken(toToken);

        if (!fromTokenData || !toTokenData) {
            throw new Error('Invalid token pair');
        }

        const amountUnits = this.toUnits(amount, fromTokenData.decimals);
        const minOutputUnits = this.toUnits(minOutput || '0', toTokenData.decimals);

        console.log('[SwapService] Units:', { amountUnits, minOutputUnits });

        if (fromTokenData.address === 'native') {
            // Swap TON -> Jetton
            return this.buildStonfiTonToJettonSwap(
                senderAddress,
                toTokenData.address,
                amountUnits,
                minOutputUnits
            );
        } else if (toTokenData.address === 'native') {
            // Swap Jetton -> TON
            return this.buildStonfiJettonToTonSwap(
                senderAddress,
                fromTokenData.address,
                amountUnits,
                minOutputUnits
            );
        } else {
            // Swap Jetton -> Jetton
            return this.buildStonfiJettonToJettonSwap(
                senderAddress,
                fromTokenData.address,
                toTokenData.address,
                amountUnits,
                minOutputUnits
            );
        }
    }

    /**
     * Build STON.fi TON -> Jetton swap message
     */
    buildStonfiTonToJettonSwap(senderAddress, askJettonAddress, offerUnits, minAskUnits) {
        // STON.fi swap operation code
        const SWAP_OP = 0x25938561;

        const forwardPayload = beginCell()
            .storeUint(SWAP_OP, 32)
            .storeAddress(Address.parse(askJettonAddress))
            .storeCoins(BigInt(minAskUnits))
            .storeAddress(Address.parse(senderAddress)) // Receiver
            .endCell();

        return {
            to: STONFI_ROUTER,
            value: (BigInt(offerUnits) + toNano('0.3')).toString(), // Amount + gas
            body: forwardPayload,
            mode: 3,
        };
    }

    /**
     * Build STON.fi Jetton -> TON swap (requires jetton transfer)
     */
    async buildStonfiJettonToTonSwap(senderAddress, offerJettonAddress, offerUnits, minAskUnits) {
        // For Jetton swaps, we need to transfer jettons to the router
        // with a specific forward payload
        const SWAP_OP = 0x25938561;

        const forwardPayload = beginCell()
            .storeUint(SWAP_OP, 32)
            .storeAddress(Address.parse('EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c')) // Native TON
            .storeCoins(BigInt(minAskUnits))
            .storeAddress(Address.parse(senderAddress))
            .endCell();

        return {
            type: 'jetton_transfer',
            jettonMaster: offerJettonAddress,
            destination: STONFI_ROUTER,
            amount: offerUnits,
            forwardAmount: toNano('0.25').toString(),
            forwardPayload: forwardPayload.toBoc().toString('base64'),
            gasAmount: toNano('0.35').toString(),
        };
    }

    /**
     * Build STON.fi Jetton -> Jetton swap
     */
    async buildStonfiJettonToJettonSwap(senderAddress, offerJettonAddress, askJettonAddress, offerUnits, minAskUnits) {
        const SWAP_OP = 0x25938561;

        const forwardPayload = beginCell()
            .storeUint(SWAP_OP, 32)
            .storeAddress(Address.parse(askJettonAddress))
            .storeCoins(BigInt(minAskUnits))
            .storeAddress(Address.parse(senderAddress))
            .endCell();

        return {
            type: 'jetton_transfer',
            jettonMaster: offerJettonAddress,
            destination: STONFI_ROUTER,
            amount: offerUnits,
            forwardAmount: toNano('0.3').toString(),
            forwardPayload: forwardPayload.toBoc().toString('base64'),
            gasAmount: toNano('0.4').toString(),
        };
    }

    /**
     * Build DeDust swap transaction
     */
    async buildDedustSwapTransaction(senderAddress, fromToken, toToken, amount, minOutput, poolAddress) {
        const fromTokenData = this.getToken(fromToken);
        const toTokenData = this.getToken(toToken);

        const amountUnits = this.toUnits(amount, fromTokenData.decimals);
        const minOutputUnits = this.toUnits(minOutput, toTokenData.decimals);

        if (fromTokenData.address === 'native') {
            // Swap TON -> Jetton via DeDust
            return this.buildDedustTonSwap(senderAddress, poolAddress, amountUnits, minOutputUnits);
        } else {
            // Swap Jetton via DeDust
            return this.buildDedustJettonSwap(
                senderAddress,
                fromTokenData.address,
                poolAddress,
                amountUnits,
                minOutputUnits
            );
        }
    }

    /**
     * Build DeDust TON swap
     */
    buildDedustTonSwap(senderAddress, poolAddress, amountUnits, minOutputUnits) {
        // DeDust swap op code
        const SWAP_OP = 0xea06185d;

        const swapPayload = beginCell()
            .storeUint(SWAP_OP, 32)
            .storeAddress(Address.parse(poolAddress))
            .storeUint(0, 1) // swap kind: 0 = exact in
            .storeCoins(BigInt(minOutputUnits)) // limit
            .storeMaybeRef(null) // next step (none)
            .storeRef(
                beginCell()
                    .storeAddress(Address.parse(senderAddress)) // recipient
                    .storeAddress(Address.parse(senderAddress)) // referral
                    .storeMaybeRef(null) // fulfill payload
                    .storeMaybeRef(null) // reject payload
                    .endCell()
            )
            .endCell();

        return {
            to: DEDUST_NATIVE_VAULT,
            value: (BigInt(amountUnits) + toNano('0.25')).toString(),
            body: swapPayload,
            mode: 3,
        };
    }

    /**
     * Build DeDust Jetton swap (requires jetton transfer to vault)
     */
    buildDedustJettonSwap(senderAddress, jettonAddress, poolAddress, amountUnits, minOutputUnits) {
        const SWAP_OP = 0xea06185d;

        const swapPayload = beginCell()
            .storeUint(SWAP_OP, 32)
            .storeAddress(Address.parse(poolAddress))
            .storeUint(0, 1)
            .storeCoins(BigInt(minOutputUnits))
            .storeMaybeRef(null)
            .storeRef(
                beginCell()
                    .storeAddress(Address.parse(senderAddress))
                    .storeAddress(Address.parse(senderAddress))
                    .storeMaybeRef(null)
                    .storeMaybeRef(null)
                    .endCell()
            )
            .endCell();

        return {
            type: 'jetton_transfer',
            jettonMaster: jettonAddress,
            destination: this.getDedustJettonVault(jettonAddress),
            amount: amountUnits,
            forwardAmount: toNano('0.25').toString(),
            forwardPayload: swapPayload.toBoc().toString('base64'),
            gasAmount: toNano('0.35').toString(),
        };
    }

    /**
     * Get DeDust jetton vault address (simplified - would use factory in production)
     */
    getDedustJettonVault(jettonAddress) {
        // In production, this would query the DeDust factory
        // For now, return the factory address
        return DEDUST_FACTORY;
    }

    // Helper functions
    toUnits(amount, decimals) {
        // Handle null/undefined/empty amounts
        if (amount === undefined || amount === null || amount === '') {
            return '0';
        }

        const parts = amount.toString().split('.');
        let whole = parts[0] || '0';
        let fraction = parts[1] || '';

        // Pad or trim fraction to match decimals
        fraction = fraction.padEnd(decimals, '0').slice(0, decimals);

        return whole + fraction;
    }

    fromUnits(units, decimals) {
        const str = units.toString().padStart(decimals + 1, '0');
        const whole = str.slice(0, -decimals) || '0';
        const fraction = str.slice(-decimals);

        // Trim trailing zeros from fraction
        const trimmedFraction = fraction.replace(/0+$/, '');

        return trimmedFraction ? `${whole}.${trimmedFraction}` : whole;
    }

    calculatePriceImpact(amountIn, reserveIn) {
        const impact = Number(amountIn) / Number(reserveIn) * 100;
        return Math.min(impact, 100).toFixed(2);
    }
}

// Export singleton
export const swapService = new SwapService();
