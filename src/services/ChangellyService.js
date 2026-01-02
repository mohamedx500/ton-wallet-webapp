/**
 * ChangellyService - Integration with Changelly for Buy and Swap functionality
 * 
 * Provides:
 * - Fiat-to-Crypto purchase (Buy TON)
 * - Crypto-to-Crypto exchange (Swap)
 * 
 * Note: For security, sensitive API calls should be made through a backend.
 * This service uses Changelly's widget/redirect approach for frontend safety.
 */

import { retryService } from './ApiRequestManager.js';

// Changelly API configuration
const CHANGELLY_API_URL = 'https://api.changelly.com/v2';
const CHANGELLY_WIDGET_URL = 'https://widget.changelly.com';
const CHANGELLY_PAY_URL = 'https://pay.changelly.com';

// API Keys from environment (for backend use) or widget configuration
const PUBLIC_KEY = import.meta.env.VITE_CHANGELLY_PUBLIC_KEY || '';
const PRIVATE_KEY = import.meta.env.VITE_CHANGELLY_PRIVATE_KEY || '';

// Supported currencies for the wallet
const SUPPORTED_CURRENCIES = {
    TON: { id: 'ton', name: 'Toncoin', network: 'ton' },
    USDT: { id: 'usdtton', name: 'Tether (TON)', network: 'ton' },
    BTC: { id: 'btc', name: 'Bitcoin', network: 'btc' },
    ETH: { id: 'eth', name: 'Ethereum', network: 'eth' },
};

export class ChangellyService {
    constructor() {
        this.apiUrl = CHANGELLY_API_URL;
        this.widgetUrl = CHANGELLY_WIDGET_URL;
        this.payUrl = CHANGELLY_PAY_URL;
        this.publicKey = PUBLIC_KEY;
    }

    /**
     * Generate Changelly Buy URL (Fiat to Crypto)
     * Opens Changelly's hosted payment page
     * 
     * @param {string} walletAddress - Destination wallet address
     * @param {string} cryptoCurrency - Target crypto (e.g., 'ton')
     * @param {string} fiatCurrency - Source fiat (e.g., 'usd')
     * @param {number} amount - Amount in fiat
     * @returns {string} - URL to redirect user to
     */
    getBuyUrl(walletAddress, cryptoCurrency = 'ton', fiatCurrency = 'usd', amount = 50) {
        const params = new URLSearchParams({
            from: fiatCurrency.toLowerCase(),
            to: cryptoCurrency.toLowerCase(),
            address: walletAddress,
            amount: amount.toString(),
            // Optional: Add affiliate ID for revenue
            // ref_id: 'your_affiliate_id',
        });

        return `${this.payUrl}?${params.toString()}`;
    }

    /**
     * Generate Changelly Widget URL for embedding
     * 
     * @param {string} walletAddress - Destination wallet address
     * @param {string} fromCurrency - Source currency
     * @param {string} toCurrency - Target currency
     * @param {number} amount - Amount to exchange
     * @returns {string} - Widget URL
     */
    getWidgetUrl(walletAddress, fromCurrency = 'btc', toCurrency = 'ton', amount = 0.01) {
        const params = new URLSearchParams({
            from: fromCurrency.toLowerCase(),
            to: toCurrency.toLowerCase(),
            address: walletAddress,
            amount: amount.toString(),
            // Theme matching
            theme: 'night', // or 'default'
        });

        return `${this.widgetUrl}?${params.toString()}`;
    }

    /**
     * Open Buy TON in new window/tab
     * 
     * @param {string} walletAddress - User's TON wallet address
     * @param {string} fiatCurrency - Fiat currency to pay with
     * @param {number} amount - Amount in fiat
     */
    openBuyTon(walletAddress, fiatCurrency = 'usd', amount = 50) {
        const url = this.getBuyUrl(walletAddress, 'ton', fiatCurrency, amount);
        window.open(url, '_blank', 'noopener,noreferrer');
    }

    /**
     * Open Swap/Exchange in new window
     * 
     * @param {string} walletAddress - Destination wallet address
     * @param {string} fromCurrency - Currency to swap from
     * @param {string} toCurrency - Currency to swap to
     * @param {number} amount - Amount to swap
     */
    openSwap(walletAddress, fromCurrency, toCurrency, amount) {
        const url = this.getWidgetUrl(walletAddress, fromCurrency, toCurrency, amount);
        window.open(url, '_blank', 'noopener,noreferrer');
    }

    /**
     * Get estimated exchange rate (for display purposes)
     * Note: This requires backend for secure API calls
     * For now, we'll use a simplified approach
     * 
     * @param {string} from - Source currency
     * @param {string} to - Target currency
     * @param {number} amount - Amount
     * @returns {Promise<object>} - Rate information
     */
    async getExchangeRate(from, to, amount = 1) {
        // For frontend, we'll estimate based on market rates
        // In production, this should go through a backend
        try {
            // Use CoinGecko free API for rate estimation
            const response = await fetch(
                `https://api.coingecko.com/api/v3/simple/price?ids=the-open-network,tether,bitcoin,ethereum&vs_currencies=usd`
            );

            if (!response.ok) {
                throw new Error('Failed to fetch rates');
            }

            const data = await response.json();

            const prices = {
                ton: data['the-open-network']?.usd || 1.5,
                usdt: data['tether']?.usd || 1,
                btc: data['bitcoin']?.usd || 45000,
                eth: data['ethereum']?.usd || 2500,
            };

            const fromPrice = prices[from.toLowerCase()] || 1;
            const toPrice = prices[to.toLowerCase()] || 1;

            const rate = fromPrice / toPrice;
            const estimatedAmount = amount * rate;

            return {
                from,
                to,
                amount,
                rate,
                estimatedAmount: estimatedAmount.toFixed(6),
                priceImpact: '~0.5%', // Estimated
                networkFee: '0.01 TON', // Estimated
            };
        } catch (error) {
            console.error('[ChangellyService] Rate fetch error:', error);
            return {
                from,
                to,
                amount,
                rate: null,
                estimatedAmount: null,
                error: 'Unable to fetch rates',
            };
        }
    }

    /**
     * Get list of supported currencies for swap
     * @returns {Array} - List of currencies
     */
    getSupportedCurrencies() {
        return [
            { symbol: 'TON', name: 'Toncoin', icon: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ton/info/logo.png' },
            { symbol: 'USDT', name: 'Tether', icon: 'https://tether.to/images/logoCircle.png' },
            { symbol: 'BTC', name: 'Bitcoin', icon: 'https://assets.coingecko.com/coins/images/1/small/bitcoin.png' },
            { symbol: 'ETH', name: 'Ethereum', icon: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png' },
            { symbol: 'USDC', name: 'USD Coin', icon: 'https://assets.coingecko.com/coins/images/6319/small/usdc.png' },
            { symbol: 'SOL', name: 'Solana', icon: 'https://assets.coingecko.com/coins/images/4128/small/solana.png' },
        ];
    }

    /**
     * Get fiat currencies for buy
     * @returns {Array} - List of fiat currencies
     */
    getFiatCurrencies() {
        return [
            { code: 'USD', name: 'US Dollar', symbol: '$' },
            { code: 'EUR', name: 'Euro', symbol: '€' },
            { code: 'GBP', name: 'British Pound', symbol: '£' },
            { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ' },
            { code: 'SAR', name: 'Saudi Riyal', symbol: '﷼' },
            { code: 'EGP', name: 'Egyptian Pound', symbol: 'E£' },
        ];
    }

    /**
     * Validate if minimum amount is met for exchange
     * @param {string} currency - Currency symbol
     * @param {number} amount - Amount to validate
     * @returns {object} - Validation result
     */
    validateMinAmount(currency, amount) {
        const minimums = {
            TON: 1,
            USDT: 10,
            BTC: 0.0001,
            ETH: 0.01,
            SOL: 0.1,
        };

        const min = minimums[currency.toUpperCase()] || 0.01;
        const isValid = amount >= min;

        return {
            isValid,
            minimum: min,
            message: isValid ? null : `Minimum amount is ${min} ${currency}`,
        };
    }
}

// Export singleton instance
export const changellyService = new ChangellyService();
