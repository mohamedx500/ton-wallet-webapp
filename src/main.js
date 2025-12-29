/**
 * TON Wallet - Main Application
 * Modern UI with Tab Navigation
 */

import { Buffer } from 'buffer';
window.Buffer = Buffer;

import { WalletService } from './services/WalletService.js';
import { TonApiService } from './services/TonApiService.js';
import { SecurityService } from './services/SecurityService.js';

// ============================================================================
// Application State
// ============================================================================

const state = {
    mnemonic: null,
    walletType: 'v4r2',
    address: null,
    testnet: false,
    balances: {
        TON: 0,
        USDT: 0,
        NOT: 0,
    },
    tonPrice: 0,
    transactions: [],
    isLoading: false,
    currentTab: 'walletTab',
    encryptedMnemonic: null,
};

// Services
const walletService = new WalletService();
const tonApiService = new TonApiService();
const securityService = new SecurityService();

// ============================================================================
// DOM Elements
// ============================================================================

const $ = (id) => document.getElementById(id);
const $$ = (selector) => document.querySelectorAll(selector);

// Screens
const authScreen = $('importScreen'); // Now matches HTML id="importScreen"
const mainScreen = $('walletScreen'); // Now matches HTML id="walletScreen"

// Auth sections (modals)
const importSection = $('importScreen'); // Import screen = importScreen in HTML
const passwordSetupModal = $('passwordSetupModal');
const passwordVerifyModal = $('passwordVerifyModal');

// UI elements  
const walletTypeBadge = $('walletTypeLabel'); // HTML has walletTypeLabel
const balanceAmount = $('totalUsdBalance'); // HTML has totalUsdBalance
const walletAddress = $('walletAddress');
const tokenList = $('tokensList'); // HTML has tokensList
const transactionList = $('fullTransactionsList'); // HTML hasFullTransactionsList

// ============================================================================
// Utility Functions
// ============================================================================

function showToast(message, duration = 3000) {
    const toast = $('toast');
    const toastMessage = $('toastMessage');
    toastMessage.textContent = message;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), duration);
}

function showLoading(text = 'Loading...') {
    const overlay = $('loadingOverlay');
    const loadingText = $('loadingText');
    loadingText.textContent = text;
    overlay.classList.remove('hidden');
}

function hideLoading() {
    $('loadingOverlay').classList.add('hidden');
}

function formatAddress(address) {
    if (!address) return '';
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function formatAmount(amount, decimals = 2) {
    const num = parseFloat(amount) || 0;
    return num.toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    });
}

function formatUsd(amount, price) {
    const usd = (parseFloat(amount) || 0) * (parseFloat(price) || 0);
    return `$${usd.toFixed(2)}`;
}

function hideAllAuthSections() {
    // Hide screens
    authScreen?.classList.add('hidden');
    // We use modals now - they have their own show/hide logic
}

function showAuthSection(section) {
    // For the import screen, show it
    if (section === importSection || section === authScreen) {
        authScreen?.classList.remove('hidden');
        authScreen?.classList.add('active');
        mainScreen?.classList.remove('active');
    }
}

// ============================================================================
// Storage Functions
// ============================================================================

function saveState() {
    const toSave = {
        encryptedMnemonic: state.encryptedMnemonic,
        walletType: state.walletType,
        testnet: state.testnet,
    };
    localStorage.setItem('tonWalletState', JSON.stringify(toSave));
}

function loadState() {
    try {
        const saved = localStorage.getItem('tonWalletState');
        if (saved) {
            const data = JSON.parse(saved);
            state.encryptedMnemonic = data.encryptedMnemonic;
            state.walletType = data.walletType || 'v4r2';
            state.testnet = data.testnet || false;
            return true;
        }
    } catch (e) {
        console.error('Failed to load state:', e);
    }
    return false;
}

// ============================================================================
// Auth Functions
// ============================================================================

async function createNewWallet() {
    try {
        showLoading('Generating wallet...');
        state.mnemonic = await walletService.generateMnemonic();

        // Display mnemonic
        const mnemonicDisplay = $('mnemonicDisplay');
        mnemonicDisplay.innerHTML = state.mnemonic.map((word, i) =>
            `<div class="mnemonic-word"><span class="num">${i + 1}.</span>${word}</div>`
        ).join('');

        hideLoading();
        showAuthSection(showMnemonicSection);
    } catch (error) {
        hideLoading();
        showToast('Failed to create wallet: ' + error.message);
    }
}

async function importWallet() {
    const mnemonicInput = $('mnemonicInput').value.trim();
    const walletType = $('importWalletType').value;

    if (!mnemonicInput) {
        showToast('Please enter your mnemonic phrase');
        return;
    }

    const words = mnemonicInput.toLowerCase().split(/\s+/).filter(w => w);
    if (words.length !== 24) {
        showToast('Please enter exactly 24 words');
        return;
    }

    try {
        showLoading('Importing wallet...');
        state.mnemonic = words;
        state.walletType = walletType;

        hideLoading();
        showAuthSection(passwordSetupSection);
    } catch (error) {
        hideLoading();
        showToast('Failed to import wallet: ' + error.message);
    }
}

async function setupPassword() {
    const password = $('newPasswordInput').value;
    const confirm = $('confirmPasswordInput').value;

    if (!password || password.length < 6) {
        showToast('Password must be at least 6 characters');
        return;
    }

    if (password !== confirm) {
        showToast('Passwords do not match');
        return;
    }

    try {
        showLoading('Securing wallet...');

        // Encrypt and save mnemonic
        state.encryptedMnemonic = await securityService.encryptData(
            state.mnemonic.join(' '),
            password
        );
        await securityService.setupPassword(password);

        // Initialize wallet
        await initializeWallet();

        saveState();
        hideLoading();

        // Switch to main screen
        authScreen.classList.remove('active');
        mainScreen.classList.remove('hidden');
        mainScreen.classList.add('active');

        await refreshData();
    } catch (error) {
        hideLoading();
        showToast('Failed to setup wallet: ' + error.message);
    }
}

async function unlockWallet() {
    const password = $('passwordInput').value;

    if (!password) {
        showToast('Please enter your password');
        return;
    }

    try {
        showLoading('Unlocking...');

        // Verify password
        const isValid = await securityService.verifyPassword(password);
        if (!isValid) {
            hideLoading();
            showToast('Incorrect password');
            return;
        }

        // Decrypt mnemonic
        const mnemonicStr = await securityService.decryptData(state.encryptedMnemonic, password);
        state.mnemonic = mnemonicStr.split(' ');

        // Initialize wallet
        await initializeWallet();

        hideLoading();

        // Switch to main screen
        authScreen.classList.remove('active');
        mainScreen.classList.remove('hidden');
        mainScreen.classList.add('active');

        await refreshData();
    } catch (error) {
        hideLoading();
        showToast('Failed to unlock: ' + error.message);
    }
}

// ============================================================================
// Wallet Functions
// ============================================================================

async function initializeWallet() {
    try {
        const walletInfo = await walletService.importWallet(
            state.mnemonic,
            state.walletType,
            state.testnet
        );
        state.address = walletInfo.address;

        // Update UI
        walletTypeBadge.textContent = state.walletType;
        walletAddress.textContent = formatAddress(state.address);
        $('currentWalletType').textContent = state.walletType;
        $('fullAddress').textContent = state.address;

        // Update wallet type selection
        $$('.wallet-type-option').forEach(btn => {
            btn.classList.toggle('selected', btn.dataset.type === state.walletType);
        });
    } catch (error) {
        console.error('Failed to initialize wallet:', error);
        throw error;
    }
}

async function refreshData() {
    if (!state.address) return;

    try {
        // Fetch TON balance
        const balance = await tonApiService.getBalance(state.address, state.testnet);
        state.balances.TON = balance;

        // Try to fetch TON price
        try {
            const priceData = await tonApiService.getTonPrice();
            state.tonPrice = priceData?.price || 2.5;
        } catch {
            state.tonPrice = 2.5;
        }

        // Try to fetch jetton balances
        try {
            const jettons = await tonApiService.getJettonBalances(state.address, state.testnet);
            state.balances.USDT = jettons.USDT || 0;
            state.balances.NOT = jettons.NOT || 0;
        } catch {
            // Keep zeros
        }

        // Fetch transactions
        try {
            const txs = await tonApiService.getTransactionHistory(state.address, state.testnet);
            state.transactions = txs || [];
        } catch {
            state.transactions = [];
        }

        updateUI();
    } catch (error) {
        console.error('Failed to refresh data:', error);
    }
}

function updateUI() {
    // Update balance
    balanceAmount.textContent = formatAmount(state.balances.TON);

    // Update token balances
    $('tonBalance').textContent = formatAmount(state.balances.TON);
    $('tonUsd').textContent = formatUsd(state.balances.TON, state.tonPrice);

    $('usdtBalance').textContent = formatAmount(state.balances.USDT);
    $('usdtUsd').textContent = formatUsd(state.balances.USDT, 1);

    $('notBalance').textContent = formatAmount(state.balances.NOT);
    $('notUsd').textContent = formatUsd(state.balances.NOT, 0.02);

    // Update transactions
    renderTransactions();
}

function renderTransactions(filter = 'all') {
    const list = $('transactionList');
    const empty = $('emptyTransactions');

    let filtered = state.transactions;
    if (filter === 'sent') {
        filtered = state.transactions.filter(tx => tx.type === 'sent');
    } else if (filter === 'received') {
        filtered = state.transactions.filter(tx => tx.type === 'received');
    }

    if (filtered.length === 0) {
        list.innerHTML = '';
        list.appendChild(empty);
        empty.classList.remove('hidden');
        return;
    }

    empty.classList.add('hidden');
    list.innerHTML = filtered.map(tx => `
        <div class="transaction-item">
            <div class="tx-left">
                <span class="tx-amount ${tx.type === 'received' ? 'incoming' : 'outgoing'}">
                    ${tx.type === 'received' ? '+' : '-'}${formatAmount(tx.amount)}
                </span>
                <span class="tx-currency">${tx.currency || 'TON'}</span>
                <span class="tx-status">Completed</span>
            </div>
            <div class="tx-right">
                <span class="tx-type">${tx.type === 'received' ? 'Receive' : 'Send'} TON</span>
                <span class="tx-time">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                    </svg>
                    ${tx.time || 'Recently'}
                </span>
                <span class="tx-from">From: ${formatAddress(tx.from || tx.to)}</span>
            </div>
            <div class="tx-icon ${tx.type === 'received' ? 'incoming' : 'outgoing'}">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="${tx.type === 'received' ? 'M12 3v12M5 12l7 7 7-7' : 'M12 19V7M5 12l7-7 7 7'}"/>
                </svg>
            </div>
        </div>
    `).join('');
}

// ============================================================================
// Send Functions
// ============================================================================

async function sendTransaction() {
    const token = $('sendTokenSelect').value;
    const recipient = $('recipientAddress').value.trim();
    const amount = parseFloat($('sendAmount').value);
    const comment = $('sendComment').value.trim();

    if (!recipient) {
        showToast('Please enter recipient address');
        return;
    }

    if (!amount || amount <= 0) {
        showToast('Please enter a valid amount');
        return;
    }

    try {
        showLoading('Sending...');

        if (token === 'TON') {
            await walletService.sendTransaction(
                state.mnemonic,
                state.walletType,
                recipient,
                amount,
                comment,
                state.testnet
            );
        } else {
            // TODO: Handle jetton transfers
            showToast('Jetton transfers coming soon');
            hideLoading();
            return;
        }

        hideLoading();
        closeModal('sendModal');
        showToast('Transaction sent successfully!');

        // Refresh after delay
        setTimeout(() => refreshData(), 3000);
    } catch (error) {
        hideLoading();
        showToast('Transaction failed: ' + error.message);
    }
}

// ============================================================================
// Modal Functions
// ============================================================================

function openModal(modalId) {
    const modal = $(modalId);
    modal.classList.remove('hidden');
}

function closeModal(modalId) {
    const modal = $(modalId);
    modal.classList.add('hidden');
}

// ============================================================================
// Tab Navigation
// ============================================================================

function switchTab(tabId) {
    // Hide all tabs
    $$('.tab-pane').forEach(tab => tab.classList.remove('active'));
    $$('.nav-item').forEach(nav => nav.classList.remove('active'));

    // Show selected tab
    $(tabId).classList.add('active');
    document.querySelector(`[data-tab="${tabId}"]`).classList.add('active');

    state.currentTab = tabId;
}

// ============================================================================
// Wallet Type Change
// ============================================================================

async function changeWalletType(newType) {
    if (newType === state.walletType) return;

    try {
        showLoading('Switching wallet...');
        state.walletType = newType;

        await initializeWallet();
        saveState();

        hideLoading();
        closeModal('walletTypeModal');
        showToast(`Switched to ${newType}`);

        await refreshData();
    } catch (error) {
        hideLoading();
        showToast('Failed to switch wallet: ' + error.message);
    }
}

// ============================================================================
// Show Secret Phrase
// ============================================================================

async function showSecretPhrase() {
    const password = $('phrasePasswordInput').value;

    if (!password) {
        showToast('Please enter your password');
        return;
    }

    try {
        const isValid = await securityService.verifyPassword(password);
        if (!isValid) {
            showToast('Incorrect password');
            return;
        }

        const mnemonicStr = await securityService.decryptData(state.encryptedMnemonic, password);
        const words = mnemonicStr.split(' ');

        const phraseDisplay = $('phraseDisplay');
        phraseDisplay.innerHTML = words.map((word, i) =>
            `<div class="mnemonic-word"><span class="num">${i + 1}.</span>${word}</div>`
        ).join('');
        phraseDisplay.classList.remove('hidden');
    } catch (error) {
        showToast('Failed to show phrase: ' + error.message);
    }
}

// ============================================================================
// Logout
// ============================================================================

function logout() {
    if (!confirm('Are you sure you want to logout?')) return;

    // Clear state
    state.mnemonic = null;
    state.address = null;
    state.balances = { TON: 0, USDT: 0, NOT: 0 };
    state.transactions = [];

    localStorage.removeItem('tonWalletState');
    securityService.clearSecurityData();

    // Switch to auth screen
    mainScreen.classList.remove('active');
    mainScreen.classList.add('hidden');
    authScreen.classList.add('active');
    showAuthSection(importSection);

    showToast('Logged out successfully');
}

// ============================================================================
// Event Listeners
// ============================================================================

function setupEventListeners() {
    // Auth buttons
    $('createWalletBtn').addEventListener('click', createNewWallet);
    $('importWalletBtn').addEventListener('click', () => showAuthSection(importMnemonicSection));
    $('backToWelcomeBtn').addEventListener('click', () => showAuthSection(importSection));
    $('confirmImportBtn').addEventListener('click', importWallet);
    $('createPasswordBtn').addEventListener('click', setupPassword);
    $('unlockBtn').addEventListener('click', unlockWallet);

    // Mnemonic confirmation
    $('savedMnemonicCheck').addEventListener('change', (e) => {
        $('continueToPasswordBtn').disabled = !e.target.checked;
    });
    $('continueToPasswordBtn').addEventListener('click', () => showAuthSection(passwordSetupSection));

    // Copy address
    $('copyAddressBtn').addEventListener('click', () => {
        navigator.clipboard.writeText(state.address);
        showToast('Address copied!');
    });

    // Action buttons
    $('receiveBtn').addEventListener('click', () => openModal('receiveModal'));
    $('sendBtn').addEventListener('click', () => openModal('sendModal'));
    $('confirmSendBtn').addEventListener('click', sendTransaction);

    // Copy full address
    $('copyFullAddressBtn').addEventListener('click', () => {
        navigator.clipboard.writeText(state.address);
        showToast('Address copied!');
    });

    // Tab navigation
    $$('.nav-item').forEach(navItem => {
        navItem.addEventListener('click', () => {
            switchTab(navItem.dataset.tab);
        });
    });

    // Transaction filters
    $$('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            $$('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderTransactions(btn.dataset.filter);
        });
    });

    // Settings
    $('showPhraseBtn').addEventListener('click', () => openModal('phraseModal'));
    $('viewPhraseBtn').addEventListener('click', showSecretPhrase);
    $('walletTypeBtn').addEventListener('click', () => openModal('walletTypeModal'));
    $('logoutBtn').addEventListener('click', logout);

    // Wallet type selection
    $$('.wallet-type-option').forEach(btn => {
        btn.addEventListener('click', () => changeWalletType(btn.dataset.type));
    });

    // Modal close buttons
    $$('.modal-close').forEach(btn => {
        btn.addEventListener('click', () => closeModal(btn.dataset.close));
    });

    // Close modal on backdrop click
    $$('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.add('hidden');
            }
        });
    });

    // Dark mode toggle
    $('darkModeToggle').addEventListener('change', (e) => {
        document.documentElement.setAttribute('data-theme', e.target.checked ? 'dark' : 'light');
        localStorage.setItem('theme', e.target.checked ? 'dark' : 'light');
    });

    // Enter key handlers
    $('passwordInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') unlockWallet();
    });

    $('newPasswordInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') $('confirmPasswordInput').focus();
    });

    $('confirmPasswordInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') setupPassword();
    });
}

// ============================================================================
// Initialization
// ============================================================================

async function init() {
    // Load saved theme
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    $('darkModeToggle').checked = savedTheme === 'dark';

    // Setup event listeners
    setupEventListeners();

    // Check for existing wallet
    const hasState = loadState();

    if (hasState && state.encryptedMnemonic && securityService.hasPassword()) {
        // Show password verify modal
        passwordVerifyModal?.classList.remove('hidden');
    } else {
        // Show import screen
        authScreen?.classList.add('active');
        authScreen?.classList.remove('hidden');
        mainScreen?.classList.remove('active');
    }

    // Auto-refresh every 30 seconds when on main screen
    setInterval(() => {
        if (mainScreen.classList.contains('active') && state.address) {
            refreshData();
        }
    }, 30000);
}

// Start the app
init();
