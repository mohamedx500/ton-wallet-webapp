/**
 * UI Transactions - Handles transaction list and details display
 */

import { formatTON } from '../utils/helpers.js';
import { getState } from '../state/AppState.js';
import { openModal } from './screens.js';

// Current filter state
let currentFilter = 'all';

/**
 * Check if a string is a domain name (.ton, .t.me, etc)
 */
function isDomainName(str) {
    if (!str) return false;
    return str.endsWith('.ton') || str.endsWith('.t.me') || str.includes('.near');
}

/**
 * Format address for display
 * - Domain names: show in full
 * - Addresses: show shortened version
 */
function formatAddressDisplay(address, rawAddress = null) {
    if (!address) return 'Unknown';

    // If it's a domain name, show in full
    if (isDomainName(address)) {
        return address;
    }

    // For regular addresses, shorten them
    if (address.length > 16) {
        return `${address.slice(0, 6)}...${address.slice(-6)}`;
    }

    return address;
}

/**
 * Get the raw address for linking (prefer fromRaw/toRaw if available)
 */
function getLinkAddress(tx, field) {
    if (field === 'from') {
        return tx.fromRaw || tx.from;
    }
    return tx.toRaw || tx.to;
}

/**
 * Get explorer base URL
 */
function getExplorerBaseUrl() {
    const state = getState();
    return state.settings.network === 'testnet'
        ? 'https://testnet.tonviewer.com'
        : 'https://tonviewer.com';
}

/**
 * Filter transactions based on current filter
 */
function filterTransactions(transactions, filter) {
    if (filter === 'all') return transactions;
    return transactions.filter(tx => tx.type === filter);
}

/**
 * Render transactions to the history list
 */
export function renderTransactions(transactions, filter = null) {
    const fullContainer = document.getElementById('fullTransactionsList');

    if (!fullContainer) return;

    // Use provided filter or current filter
    const activeFilter = filter || currentFilter;

    // Filter transactions
    const filteredTx = filterTransactions(transactions || [], activeFilter);

    if (!filteredTx || filteredTx.length === 0) {
        const filterText = activeFilter === 'incoming' ? 'received' : activeFilter === 'outgoing' ? 'sent' : '';
        const emptyHtml = `<div class="empty-state">No ${filterText} transactions yet</div>`;
        fullContainer.innerHTML = emptyHtml;
        return;
    }

    // Full transactions list - use original index for detail view
    const allTx = getState().transactions || [];
    fullContainer.innerHTML = filteredTx.map((tx) => {
        const originalIndex = allTx.indexOf(tx);
        return renderTxItem(tx, originalIndex);
    }).join('');
}

/**
 * Set filter and re-render
 */
export function setTransactionFilter(filter) {
    currentFilter = filter;

    // Update active tab
    const tabs = document.querySelectorAll('.tx-filter-tab');
    tabs.forEach(tab => {
        if (tab.dataset.filter === filter) {
            tab.classList.add('active');
        } else {
            tab.classList.remove('active');
        }
    });

    // Re-render with filter
    const state = getState();
    renderTransactions(state.transactions, filter);
}

/**
 * Initialize filter tab listeners
 */
export function initTransactionFilters() {
    const tabs = document.querySelectorAll('.tx-filter-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const filter = tab.dataset.filter;
            setTransactionFilter(filter);
        });
    });
}

/**
 * Render single transaction item
 */
function renderTxItem(tx, index) {
    const isIncoming = tx.type === 'incoming';
    const icon = isIncoming ? '📥' : '📤';
    const iconClass = isIncoming ? 'incoming' : 'outgoing';
    const amountClass = isIncoming ? 'positive' : 'negative';
    const sign = isIncoming ? '+' : '-';
    const address = isIncoming ? tx.from : tx.to;
    const displayAddr = formatAddressDisplay(address);
    const comment = tx.comment ? `<div class="tx-comment">${escapeHtml(tx.comment)}</div>` : '';

    // Determine currency and format amount
    const isJetton = tx.jetton && tx.jetton !== 'TON';
    const currency = isJetton ? tx.jetton : 'TON';
    const decimals = tx.decimals || 9;
    const amount = isJetton
        ? (tx.amount / Math.pow(10, decimals)).toFixed(4)
        : formatTON(tx.amount);

    // Currency icon
    let currencyIcon = '💎';
    if (currency === 'USDT' || currency === 'USDC') currencyIcon = '💵';
    else if (currency === 'NOT') currencyIcon = '🔔';
    else if (currency === 'DOGS') currencyIcon = '🐕';
    else if (isJetton) currencyIcon = '🪙';

    return `
        <div class="tx-item" data-index="${index}" data-type="${tx.type}" data-currency="${currency}" onclick="window.showTxDetail(${index})">
            <div class="tx-icon ${iconClass}">${icon}</div>
            <div class="tx-details">
                <div class="tx-type">${isIncoming ? 'Received' : 'Sent'}</div>
                <div class="tx-address">${displayAddr}</div>
                ${comment}
            </div>
            <div class="tx-amount">
                <div class="amount ${amountClass}">${sign}${amount} ${currency}</div>
                <div class="time">${new Date(tx.timestamp * 1000).toLocaleDateString()}</div>
            </div>
        </div>
    `;
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Show transaction detail modal
 */
export function showTransactionDetail(index) {
    const state = getState();
    const tx = state.transactions[index];
    if (!tx) return;

    const isIncoming = tx.type === 'incoming';
    const sign = isIncoming ? '+' : '-';
    const amountClass = isIncoming ? 'positive' : 'negative';
    const baseUrl = getExplorerBaseUrl();

    // Get display and link addresses
    const fromDisplay = formatAddressDisplay(tx.from);
    const toDisplay = formatAddressDisplay(tx.to);
    const fromLink = getLinkAddress(tx, 'from');
    const toLink = getLinkAddress(tx, 'to');

    // Update modal elements
    const elements = {
        icon: document.getElementById('txDetailIcon'),
        amount: document.getElementById('txDetailAmount'),
        type: document.getElementById('txDetailType'),
        date: document.getElementById('txDetailDate'),
        from: document.getElementById('txDetailFrom'),
        to: document.getElementById('txDetailTo'),
        comment: document.getElementById('txDetailComment'),
        hash: document.getElementById('txDetailHash'),
        explorer: document.getElementById('viewExplorerBtn'),
        commentRow: document.getElementById('txCommentRow'),
    };

    if (elements.icon) elements.icon.textContent = isIncoming ? '📥' : '📤';

    if (elements.amount) {
        elements.amount.textContent = `${sign}${formatTON(tx.amount)} TON`;
        elements.amount.className = `tx-detail-amount ${amountClass}`;
    }

    if (elements.type) elements.type.textContent = isIncoming ? 'Received' : 'Sent';
    if (elements.date) elements.date.textContent = new Date(tx.timestamp * 1000).toLocaleString();

    // Set From address as clickable link
    if (elements.from) {
        elements.from.innerHTML = `<a href="${baseUrl}/${encodeURIComponent(fromLink)}" target="_blank" class="address-link">${fromDisplay}</a>`;
    }

    // Set To address as clickable link
    if (elements.to) {
        elements.to.innerHTML = `<a href="${baseUrl}/${encodeURIComponent(toLink)}" target="_blank" class="address-link">${toDisplay}</a>`;
    }

    if (tx.comment) {
        if (elements.commentRow) elements.commentRow.style.display = 'flex';
        if (elements.comment) elements.comment.textContent = tx.comment;
    } else {
        if (elements.commentRow) elements.commentRow.style.display = 'none';
    }

    if (elements.hash) elements.hash.textContent = tx.hash || 'N/A';

    // Set explorer link for transaction
    if (elements.explorer) elements.explorer.href = `${baseUrl}/transaction/${tx.hash}`;

    openModal('txDetailModal');
}

// Expose to window for onclick handlers
window.showTxDetail = showTransactionDetail;
