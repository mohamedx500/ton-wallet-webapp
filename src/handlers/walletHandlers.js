/**
 * Wallet Handlers - Import, generate, and initialize wallet operations
 */

import { getState, setState, saveState } from '../state/AppState.js';
import { showWalletScreen, showPasswordSetup, closeModal, openModal } from '../ui/screens.js';
import { updateBalanceUI, updateWalletHeader, updateSettingsUI } from '../ui/balance.js';
import { renderTransactions } from '../ui/transactions.js';
import { updateTonBalance, renderJettonTokens } from '../ui/tokens.js';
import { showToast } from '../utils/helpers.js';

// Service instances (will be set from main)
let walletService = null;
let tonApiService = null;
let securityService = null;

// Auto-refresh interval (15 seconds)
const AUTO_REFRESH_INTERVAL = 15000;
let autoRefreshTimer = null;

/**
 * Initialize handlers with service instances
 */
export function initWalletHandlers(wallet, tonApi, security) {
    walletService = wallet;
    tonApiService = tonApi;
    securityService = security;
}

/**
 * Generate new wallet
 */
export async function handleGenerateWallet() {
    const generateBtn = document.getElementById('generateBtn');
    const mnemonicInput = document.getElementById('mnemonicInput');
    const toastContainer = document.getElementById('toastContainer');

    try {
        console.log('Generate button clicked');
        if (generateBtn) {
            generateBtn.disabled = true;
            generateBtn.innerHTML = '<span>Generating...</span>';
        }

        console.log('Generating mnemonic...');
        const mnemonic = await walletService.generateMnemonic();
        console.log('Mnemonic generated:', mnemonic.length, 'words');

        // Store mnemonic temporarily
        setState({ mnemonic });

        // Show mnemonic to user
        if (mnemonicInput) mnemonicInput.value = mnemonic.join(' ');
        showToast('Wallet generated! Please set a password to secure it.', 'success', toastContainer);

        // Show password setup modal
        showPasswordSetup();

    } catch (error) {
        console.error('Error generating wallet:', error);
        showToast('Error: ' + error.message, 'error', toastContainer);
    } finally {
        if (generateBtn) {
            generateBtn.disabled = false;
            generateBtn.innerHTML = '<span>Generate New Wallet</span>';
        }
    }
}

/**
 * Import wallet from mnemonic
 */
export async function handleImportWallet() {
    const mnemonicInput = document.getElementById('mnemonicInput');
    const toastContainer = document.getElementById('toastContainer');

    const mnemonicText = mnemonicInput?.value.trim();
    const mnemonic = mnemonicText.split(/\s+/);

    if (!mnemonic || mnemonic.length !== 24) {
        showToast('Mnemonic must be 24 words', 'error', toastContainer);
        return;
    }

    // Store mnemonic temporarily
    setState({ mnemonic });

    // Show password setup modal
    showPasswordSetup();
    showToast('Please set a password to secure your wallet.', 'info', toastContainer);
}

/**
 * Complete wallet setup after password is set
 */
export async function completeWalletSetup(password) {
    const state = getState();
    const toastContainer = document.getElementById('toastContainer');

    try {
        // Set up password
        await securityService.setupPassword(password);

        // Encrypt and store mnemonic
        const encrypted = await securityService.encryptData(state.mnemonic, password);
        setState({ encryptedMnemonic: encrypted, isAuthenticated: true });
        saveState();

        // Initialize wallet
        await initializeWallet();

        closeModal('passwordSetupModal');
        showToast('Wallet secured with password!', 'success', toastContainer);

    } catch (error) {
        console.error('Error setting up wallet:', error);
        showToast('Error: ' + error.message, 'error', toastContainer);
    }
}

/**
 * Unlock wallet with password
 */
export async function unlockWallet(password) {
    const state = getState();
    const toastContainer = document.getElementById('toastContainer');

    try {
        // Verify password
        const isValid = await securityService.verifyPassword(password);
        if (!isValid) {
            showToast('Incorrect password', 'error', toastContainer);
            return false;
        }

        // Decrypt mnemonic
        const decrypted = await securityService.decryptData(state.encryptedMnemonic, password);
        const mnemonic = JSON.parse(decrypted);

        setState({ mnemonic, isAuthenticated: true });

        // Initialize wallet
        await initializeWallet();

        closeModal('passwordVerifyModal');
        showToast('Wallet unlocked!', 'success', toastContainer);
        return true;

    } catch (error) {
        console.error('Error unlocking wallet:', error);
        showToast('Error: ' + error.message, 'error', toastContainer);
        return false;
    }
}

/**
 * Initialize wallet from mnemonic
 */
export async function initializeWallet() {
    const toastContainer = document.getElementById('toastContainer');

    try {
        setState({ isLoading: true });

        // Get fresh state right before creating wallet to ensure we have latest settings
        const state = getState();
        
        if (!state.mnemonic) {
            throw new Error('No mnemonic available');
        }

        console.log('Initializing wallet with type:', state.settings.walletType, 'network:', state.settings.network);

        // Create wallet from mnemonic
        const wallet = await walletService.importWallet(
            state.mnemonic,
            state.settings.walletType,
            state.settings.network === 'testnet'
        );

        console.log('Wallet created:', {
            type: wallet.type,
            address: wallet.address,
            expectedType: state.settings.walletType,
            match: wallet.type === state.settings.walletType
        });

        // Ensure wallet type matches settings
        if (wallet.type !== state.settings.walletType) {
            console.warn('Wallet type mismatch! Expected:', state.settings.walletType, 'Got:', wallet.type);
            
            // Check if this is a fallback situation
            if (wallet.originalType && wallet.fallbackReason) {
                showToast(`Warning: ${wallet.originalType.toUpperCase()} wallet not available, using V4R2 instead. Reason: ${wallet.fallbackReason}`, 'warning', toastContainer);
            } else {
                showToast(`Warning: Wallet type mismatch. Expected ${state.settings.walletType}, got ${wallet.type}`, 'warning', toastContainer);
            }
        }

        // Check for fallback wallet
        if (wallet.originalType) {
            console.warn(`Wallet created as fallback: Original type ${wallet.originalType}, actual type ${wallet.type}, reason: ${wallet.fallbackReason}`);
        }

        setState({ wallet });
        
        // Verify the wallet was set correctly
        const verifyState = getState();
        console.log('Wallet set in state. Type:', verifyState.wallet?.type, 'Address:', verifyState.wallet?.address);

        // Show wallet screen
        showWalletScreen();

        // Update all UI
        updateWalletUI();

        // Fetch balance and transactions
        await refreshWalletData();

        // Start auto-refresh
        startAutoRefresh();

    } catch (error) {
        console.error('Error initializing wallet:', error);
        showToast('Error loading wallet: ' + error.message, 'error', toastContainer);
    } finally {
        setState({ isLoading: false });
    }
}

/**
 * Update all wallet UI elements
 */
export function updateWalletUI() {
    const state = getState();
    updateBalanceUI(state);
    updateWalletHeader(state);
    updateSettingsUI(state);
}

/**
 * Start auto-refresh timer
 */
export function startAutoRefresh() {
    stopAutoRefresh();

    autoRefreshTimer = setInterval(async () => {
        const state = getState();
        if (state.wallet && state.isAuthenticated) {
            console.log('Auto-refreshing wallet data...');
            await refreshWalletDataSilent();
        }
    }, AUTO_REFRESH_INTERVAL);

    console.log('Auto-refresh started (every 15s)');
}

/**
 * Stop auto-refresh timer
 */
export function stopAutoRefresh() {
    if (autoRefreshTimer) {
        clearInterval(autoRefreshTimer);
        autoRefreshTimer = null;
    }
}

/**
 * Refresh wallet balance and transactions (with UI feedback)
 */
export async function refreshWalletData() {
    const state = getState();
    const toastContainer = document.getElementById('toastContainer');

    if (!state.wallet) return;

    try {
        const refreshBtn = document.getElementById('refreshBtn');
        const refreshIcon = refreshBtn?.querySelector('.action-icon');
        if (refreshIcon) refreshIcon.textContent = '⏳';

        // Fetch all data in parallel
        const [balance, transactions, jettons] = await Promise.all([
            tonApiService.getBalance(
                state.wallet.address,
                state.settings.network === 'testnet'
            ),
            tonApiService.getTransactions(
                state.wallet.address,
                state.settings.network === 'testnet'
            ),
            tonApiService.getJettonBalances(
                state.wallet.address,
                state.settings.network === 'testnet'
            )
        ]);

        setState({ balance, transactions, jettons });

        // Update all UI
        updateBalanceUI(getState());
        renderTransactions(transactions);

        // Update tokens on homepage
        const usdValue = (balance / 1e9) * (state.usdRate || 0);
        updateTonBalance(balance, usdValue);
        renderJettonTokens(jettons);

    } catch (error) {
        console.error('Error refreshing wallet data:', error);
        showToast('Error fetching data', 'error', toastContainer);
    } finally {
        const refreshBtn = document.getElementById('refreshBtn');
        const refreshIcon = refreshBtn?.querySelector('.action-icon');
        if (refreshIcon) refreshIcon.textContent = '🔄';
    }
}

/**
 * Silent refresh (no toast, no loading indicator)
 */
async function refreshWalletDataSilent() {
    const state = getState();
    if (!state.wallet) return;

    try {
        // Fetch all data in parallel
        const [balance, transactions, jettons] = await Promise.all([
            tonApiService.getBalance(
                state.wallet.address,
                state.settings.network === 'testnet'
            ),
            tonApiService.getTransactions(
                state.wallet.address,
                state.settings.network === 'testnet'
            ),
            tonApiService.getJettonBalances(
                state.wallet.address,
                state.settings.network === 'testnet'
            )
        ]);

        // Only update if data changed
        if (balance !== state.balance) {
            setState({ balance });
            updateBalanceUI(getState());

            const usdValue = (balance / 1e9) * (state.usdRate || 0);
            updateTonBalance(balance, usdValue);
        }

        if (JSON.stringify(transactions) !== JSON.stringify(state.transactions)) {
            setState({ transactions });
            renderTransactions(transactions);
        }

        if (JSON.stringify(jettons) !== JSON.stringify(state.jettons)) {
            setState({ jettons });
            renderJettonTokens(jettons);
        }

    } catch (error) {
        // Silent error - don't disturb user
        console.warn('Silent refresh error:', error.message);
    }
}

/**
 * Fetch TON price from CoinGecko
 */
export async function fetchTonPrice() {
    try {
        const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd');
        const data = await response.json();
        const usdRate = data['the-open-network']?.usd || 0;
        setState({ usdRate });
        updateBalanceUI(getState());

        // Also update tokens display
        const state = getState();
        if (state.balance) {
            const usdValue = (state.balance / 1e9) * usdRate;
            updateTonBalance(state.balance, usdValue);
        }
    } catch (e) {
        console.warn('Could not fetch TON price:', e);
    }
}

/**
 * Handle logout - stop auto-refresh
 */
export function handleLogout() {
    stopAutoRefresh();

    // Clear all state
    setState({
        wallet: null,
        mnemonic: null,
        balance: 0,
        transactions: [],
        jettons: [],
        isAuthenticated: false,
    });

    // Clear local storage
    localStorage.removeItem('walletState');

    // Clear security data
    securityService.clearSecurityData();
}
