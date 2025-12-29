/**
 * UI Tokens - Handles token list display on homepage
 */

import { getState, setState } from '../state/AppState.js';
import { formatTON } from '../utils/helpers.js';
import { openModal } from './screens.js';

// Token icons mapping
const TOKEN_ICONS = {
    'TON': '💎',
    'USDT': '💵',
    'USDC': '💵',
    'NOT': '🔔',
    'DOGS': '🐕',
    'JETTON': '🪙',
};

// Token colors for backgrounds
const TOKEN_CLASSES = {
    'TON': 'ton',
    'USDT': 'usdt',
    'USDC': 'usdt',
    'NOT': 'not',
    'DOGS': 'dogs',
};

// Track last displayed TON values
let lastTonBalance = null;
let lastTonUsd = null;

/**
 * Update TON token display
 */
export function updateTonBalance(balance, usdValue) {
    const amountEl = document.getElementById('tonTokenAmount');
    const usdEl = document.getElementById('tonTokenUsd');

    // Prevent showing 0 if we had a valid balance before (during refresh)
    const balanceNum = balance / 1e9;

    if (amountEl) {
        if (balanceNum === 0 && lastTonBalance !== null && lastTonBalance > 0) {
            // Keep the old value during refresh
        } else {
            amountEl.textContent = formatTON(balance);
            lastTonBalance = balanceNum;
        }
    }

    if (usdEl) {
        if (usdValue === 0 && lastTonUsd !== null && lastTonUsd > 0) {
            // Keep the old value during refresh
        } else {
            usdEl.textContent = `$${usdValue.toFixed(2)}`;
            lastTonUsd = usdValue;
        }
    }
}

/**
 * Render jetton tokens list
 */
export function renderJettonTokens(jettons) {
    const container = document.getElementById('tokensList');
    if (!container) return;

    // Keep TON token, remove old jettons
    const tonToken = document.getElementById('tonToken');
    const existingJettons = container.querySelectorAll('.token-item.jetton');
    existingJettons.forEach(el => el.remove());

    // Make TON token clickable
    if (tonToken) {
        tonToken.onclick = () => showTokenDetail('TON');
    }

    if (!jettons || jettons.length === 0) return;

    // Add jetton tokens
    jettons.forEach(jetton => {
        const symbol = jetton.jetton?.symbol || 'Token';
        const name = jetton.jetton?.name || 'Unknown Token';
        const decimals = jetton.jetton?.decimals || 9;
        const balance = parseInt(jetton.balance) || 0;
        const amount = balance / Math.pow(10, decimals);
        const formattedBalance = amount.toFixed(4);
        const jettonAddress = jetton.jetton?.address || '';

        // Calculate USD value (1:1 for stablecoins)
        let usdValue = '-';
        const upperSymbol = symbol.toUpperCase();
        if (upperSymbol === 'USDT' || upperSymbol === 'USDC') {
            usdValue = `$${amount.toFixed(2)}`;
        }

        // Determine icon and class
        const icon = TOKEN_ICONS[upperSymbol] || TOKEN_ICONS['JETTON'];
        const tokenClass = TOKEN_CLASSES[upperSymbol] || '';

        const tokenEl = document.createElement('div');
        tokenEl.className = `token-item jetton`;
        tokenEl.dataset.symbol = symbol;
        tokenEl.dataset.address = jettonAddress;
        tokenEl.dataset.balance = balance;
        tokenEl.dataset.decimals = decimals;
        tokenEl.dataset.name = name;
        tokenEl.innerHTML = `
            <div class="token-icon ${tokenClass}">${icon}</div>
            <div class="token-info">
                <div class="token-name">${symbol}</div>
                <div class="token-fullname">${name}</div>
            </div>
            <div class="token-balance">
                <div class="token-amount">${formattedBalance}</div>
                <div class="token-usd">${usdValue}</div>
            </div>
        `;

        // Add click handler
        tokenEl.onclick = () => showTokenDetail(symbol, jetton);

        container.appendChild(tokenEl);
    });
}

/**
 * Show token detail modal
 */
export async function showTokenDetail(symbol, jettonData = null) {
    const state = getState();

    // Get token info
    let icon = TOKEN_ICONS[symbol.toUpperCase()] || TOKEN_ICONS['JETTON'];
    let name = 'Toncoin';
    let balance = 0;
    let decimals = 9;
    let usdValue = 0;
    let currentPrice = 0;

    if (symbol === 'TON') {
        name = 'Toncoin';
        balance = state.balance / 1e9;
        currentPrice = state.usdRate || 0;
        usdValue = balance * currentPrice;
    } else if (jettonData) {
        name = jettonData.jetton?.name || 'Token';
        decimals = jettonData.jetton?.decimals || 9;
        balance = (parseInt(jettonData.balance) || 0) / Math.pow(10, decimals);

        const upperSymbol = symbol.toUpperCase();
        if (upperSymbol === 'USDT' || upperSymbol === 'USDC') {
            currentPrice = 1.0;
            usdValue = balance;
        }
    }

    // Update modal elements
    document.getElementById('tokenDetailTitle').textContent = `${symbol} Details`;
    document.getElementById('tokenDetailIcon').textContent = icon;
    document.getElementById('tokenDetailName').textContent = symbol;
    document.getElementById('tokenDetailFullname').textContent = name;
    document.getElementById('tokenDetailAmount').textContent = balance.toFixed(4);
    document.getElementById('tokenDetailUsd').textContent = `$${usdValue.toFixed(2)}`;

    // Update price info
    document.getElementById('tokenCurrentPrice').textContent = `$${currentPrice.toFixed(2)}`;
    document.getElementById('tokenPriceChange').textContent = '-';

    // Filter and render transactions for this token
    renderTokenTransactions(symbol);

    // Open modal
    openModal('tokenDetailModal');

    // Fetch real-time price (async)
    fetchTokenPrice(symbol);
}

/**
 * Render transactions filtered by token
 */
function renderTokenTransactions(symbol) {
    const state = getState();
    const container = document.getElementById('tokenTransactionsList');

    if (!container) return;

    // Filter transactions by token
    const filteredTx = (state.transactions || []).filter(tx => {
        if (symbol === 'TON') {
            return !tx.jetton || tx.jetton === 'TON';
        }
        return tx.jetton === symbol;
    });

    if (filteredTx.length === 0) {
        container.innerHTML = '<div class="empty-state">No transactions for this token</div>';
        return;
    }

    // Render transactions
    container.innerHTML = filteredTx.slice(0, 10).map(tx => {
        const isIncoming = tx.type === 'incoming';
        const icon = isIncoming ? '📥' : '📤';
        const iconClass = isIncoming ? 'incoming' : 'outgoing';
        const amountClass = isIncoming ? 'positive' : 'negative';
        const sign = isIncoming ? '+' : '-';
        const address = isIncoming ? tx.from : tx.to;
        const shortAddr = address.length > 16 ? `${address.slice(0, 6)}...${address.slice(-6)}` : address;

        const isJetton = tx.jetton && tx.jetton !== 'TON';
        const currency = isJetton ? tx.jetton : 'TON';
        const decimals = tx.decimals || 9;
        const amount = isJetton
            ? (tx.amount / Math.pow(10, decimals)).toFixed(4)
            : formatTON(tx.amount);

        return `
            <div class="tx-item">
                <div class="tx-icon ${iconClass}">${icon}</div>
                <div class="tx-details">
                    <div class="tx-type">${isIncoming ? 'Received' : 'Sent'}</div>
                    <div class="tx-address">${shortAddr}</div>
                </div>
                <div class="tx-amount">
                    <div class="amount ${amountClass}">${sign}${amount} ${currency}</div>
                    <div class="time">${new Date(tx.timestamp * 1000).toLocaleDateString()}</div>
                </div>
            </div>
        `;
    }).join('');
}

/**
 * Fetch token price from CoinGecko
 */
async function fetchTokenPrice(symbol) {
    try {
        let coinId = null;

        if (symbol === 'TON') {
            coinId = 'the-open-network';
        } else if (symbol === 'NOT') {
            coinId = 'notcoin';
        } else if (symbol === 'DOGS') {
            coinId = 'dogs-2';
        }

        // USDT/USDC are stablecoins at $1
        if (symbol === 'USDT' || symbol === 'USDC') {
            document.getElementById('tokenCurrentPrice').textContent = '$1.00';
            document.getElementById('tokenPriceChange').textContent = '0.00%';
            return;
        }

        if (!coinId) return;

        const response = await fetch(
            `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true`
        );
        const data = await response.json();

        if (data[coinId]) {
            const price = data[coinId].usd || 0;
            const change24h = data[coinId].usd_24h_change || 0;

            document.getElementById('tokenCurrentPrice').textContent = `$${price.toFixed(4)}`;

            const changeEl = document.getElementById('tokenPriceChange');
            changeEl.textContent = `${change24h >= 0 ? '+' : ''}${change24h.toFixed(2)}%`;
            changeEl.className = `price-value ${change24h >= 0 ? 'positive' : 'negative'}`;

            // Update balance USD value
            const state = getState();
            if (symbol === 'TON' && state.balance) {
                const usdValue = (state.balance / 1e9) * price;
                document.getElementById('tokenDetailUsd').textContent = `$${usdValue.toFixed(2)}`;
            }
        }
    } catch (error) {
        console.warn('Error fetching token price:', error);
    }
}

/**
 * Clear all tokens except TON
 */
export function clearJettonTokens() {
    const container = document.getElementById('tokensList');
    if (!container) return;

    const existingJettons = container.querySelectorAll('.token-item.jetton');
    existingJettons.forEach(el => el.remove());
}

// Expose to window for direct calls
window.showTokenDetail = showTokenDetail;
