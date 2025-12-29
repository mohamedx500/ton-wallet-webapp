/**
 * UI Balance - Handles balance display updates
 */

import { formatTON, formatAddress, generateQRCode } from '../utils/helpers.js';

// Track last displayed values to prevent flickering
let lastDisplayedUsd = null;
let lastDisplayedTokenCount = null;

/**
 * Reset cached display values (used when switching wallets)
 */
export function resetBalanceCache() {
    lastDisplayedUsd = null;
    lastDisplayedTokenCount = null;
}

/**
 * Update all balance-related UI elements
 */
export function updateBalanceUI(state) {
    if (!state.wallet) return;

    const totalUsdBalance = document.getElementById('totalUsdBalance');
    const tokenCount = document.getElementById('tokenCount');
    const walletAddress = document.getElementById('walletAddress');
    const receiveAddress = document.getElementById('receiveAddress');
    const qrCode = document.getElementById('qrCode');

    // Calculate total USD value (TON + Jettons)
    const tonUsdValue = (state.balance / 1e9) * (state.usdRate || 0);
    let totalUsd = tonUsdValue;

    // Count tokens (TON + jettons)
    let numTokens = 1; // TON always counts

    if (state.jettons && state.jettons.length > 0) {
        numTokens += state.jettons.length;

        // Add jetton USD values (USDT is 1:1)
        state.jettons.forEach(jetton => {
            const symbol = jetton.jetton?.symbol?.toUpperCase() || '';
            const decimals = jetton.jetton?.decimals || 9;
            const balance = parseInt(jetton.balance) || 0;
            const amount = balance / Math.pow(10, decimals);

            if (symbol === 'USDT' || symbol === 'USDC') {
                totalUsd += amount;
            }
        });
    }

    // Update total USD balance - always update when balance is explicitly reset
    if (totalUsdBalance) {
        // If we just reset the cache (lastDisplayedUsd is null), update immediately
        // Otherwise, if balance is 0 but we had a previous value, keep showing the previous value
        // This prevents flickering during normal refresh
        if (lastDisplayedUsd === null || totalUsd !== 0) {
            totalUsdBalance.textContent = `$${totalUsd.toFixed(2)}`;
            lastDisplayedUsd = totalUsd;
        }
    }

    // Update token count - same logic
    if (tokenCount) {
        if (lastDisplayedTokenCount === null || numTokens !== 1) {
            tokenCount.textContent = `${numTokens} token${numTokens !== 1 ? 's' : ''}`;
            lastDisplayedTokenCount = numTokens;
        }
    }

    // Update address display
    if (walletAddress) {
        walletAddress.textContent = formatAddress(state.wallet.address, 6);
    }

    if (receiveAddress) {
        receiveAddress.textContent = state.wallet.address;
    }

    // Generate QR code
    if (qrCode) {
        generateQRCode(state.wallet.address, qrCode);
    }
}

/**
 * Update wallet header (type label, network badge)
 */
export function updateWalletHeader(state) {
    const walletTypeLabel = document.getElementById('walletTypeLabel');
    const networkBadge = document.getElementById('networkBadge');

    const typeLabels = {
        'v3r2': 'V3R2',
        'v4r2': 'V4R2',
        'v5r1': 'V5R1',
        'highload-v3': 'HLW3',
    };

    if (walletTypeLabel) {
        walletTypeLabel.textContent = typeLabels[state.settings.walletType] || state.settings.walletType.toUpperCase();
    }

    if (networkBadge) {
        networkBadge.textContent = state.settings.network === 'testnet' ? 'Testnet' : 'Mainnet';
        networkBadge.classList.toggle('testnet', state.settings.network === 'testnet');
    }
}

/**
 * Update settings UI to match current state
 */
export function updateSettingsUI(state) {
    const walletTypeSelect = document.getElementById('walletTypeSelect');

    if (walletTypeSelect) {
        const currentValue = walletTypeSelect.value;
        const newValue = state.settings.walletType;
        
        if (currentValue !== newValue) {
            console.log('Updating select from', currentValue, 'to', newValue);
            walletTypeSelect.value = newValue;
        }
    }

    // Update theme buttons
    document.querySelectorAll('.theme-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.theme === state.settings.theme);
    });

    // Update network buttons
    document.querySelectorAll('.network-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.network === state.settings.network);
    });
}

/**
 * Update send modal token selector
 */
export function updateSendTokenSelector(state) {
    const tokenSelect = document.getElementById('sendTokenSelect');
    const availableBalance = document.getElementById('availableBalance');

    if (!tokenSelect) return;

    // Clear existing options except TON
    tokenSelect.innerHTML = `<option value="TON" data-icon="💎" data-decimals="9">💎 TON - Toncoin</option>`;

    // Add jetton options
    if (state.jettons && state.jettons.length > 0) {
        state.jettons.forEach(jetton => {
            const symbol = jetton.jetton?.symbol || 'Token';
            const name = jetton.jetton?.name || 'Unknown';
            const decimals = jetton.jetton?.decimals || 9;
            const balance = parseInt(jetton.balance) || 0;
            const jettonAddress = jetton.jetton?.address || '';

            // Icon based on symbol
            let icon = '🪙';
            if (symbol === 'USDT') icon = '💵';
            else if (symbol === 'NOT') icon = '🔔';
            else if (symbol === 'DOGS') icon = '🐕';

            const option = document.createElement('option');
            option.value = jettonAddress;
            option.dataset.symbol = symbol;
            option.dataset.decimals = decimals;
            option.dataset.balance = balance;
            option.textContent = `${icon} ${symbol} - ${name}`;

            tokenSelect.appendChild(option);
        });
    }

    // Update available balance for selected token
    updateSelectedTokenBalance(state);
}

/**
 * Update available balance display based on selected token
 */
export function updateSelectedTokenBalance(state) {
    const tokenSelect = document.getElementById('sendTokenSelect');
    const availableBalance = document.getElementById('availableBalance');

    if (!tokenSelect || !availableBalance) return;

    const selectedOption = tokenSelect.selectedOptions[0];
    const value = tokenSelect.value;

    if (value === 'TON') {
        const tonAmount = formatTON(state.balance);
        availableBalance.textContent = `${tonAmount} TON`;
    } else {
        const symbol = selectedOption.dataset.symbol || 'Token';
        const decimals = parseInt(selectedOption.dataset.decimals) || 9;
        const balance = parseInt(selectedOption.dataset.balance) || 0;
        const amount = (balance / Math.pow(10, decimals)).toFixed(4);
        availableBalance.textContent = `${amount} ${symbol}`;
    }
}
