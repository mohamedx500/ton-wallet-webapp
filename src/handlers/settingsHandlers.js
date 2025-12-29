/**
 * Settings Handlers - Theme, network, wallet type, and logout
 */

import { getState, setState, saveState, clearSavedState } from '../state/AppState.js';
import { showImportScreen, closeModal, closeAllModals } from '../ui/screens.js';
import { showToast } from '../utils/helpers.js';
import { initializeWallet, updateWalletUI, stopAutoRefresh } from './walletHandlers.js';
import { updateSettingsUI, updateWalletHeader, resetBalanceCache } from '../ui/balance.js';

// Service instances
let securityService = null;

/**
 * Initialize handlers with service instances
 */
export function initSettingsHandlers(security) {
    securityService = security;
}

/**
 * Apply theme to document
 */
export function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
}

/**
 * Handle theme change
 */
export function handleThemeChange(theme) {
    const state = getState();
    setState({
        settings: { ...state.settings, theme }
    });
    applyTheme(theme);
    saveState();
    updateWalletUI();
}

/**
 * Handle network change
 */
export async function handleNetworkChange(network) {
    const state = getState();
    setState({
        settings: { ...state.settings, network }
    });
    saveState();
    await initializeWallet();
}

/**
 * Handle wallet type change
 */
export async function handleWalletTypeChange(walletType) {
    const state = getState();
    const toastContainer = document.getElementById('toastContainer');
    
    console.log('Changing wallet type from', state.settings.walletType, 'to', walletType);
    
    // Stop auto-refresh before changing wallet type
    stopAutoRefresh();
    
    // Clear current balance and transactions when switching wallet types
    setState({
        settings: { ...state.settings, walletType },
        balance: 0,
        transactions: [],
        jettons: []
    });
    saveState();
    
    // Reset balance cache to prevent showing old values
    resetBalanceCache();
    
    // Update UI immediately to show cleared balance
    updateWalletUI();
    
    // Verify state was updated
    const verifyState = getState();
    console.log('State after update:', verifyState.settings.walletType);
    
    if (verifyState.settings.walletType !== walletType) {
        console.error('State update failed! Expected:', walletType, 'Got:', verifyState.settings.walletType);
        showToast('Failed to update wallet type', 'error', toastContainer);
        return;
    }
    
    // Update the select dropdown immediately to reflect the change
    const walletTypeSelect = document.getElementById('walletTypeSelect');
    if (walletTypeSelect) {
        const oldValue = walletTypeSelect.value;
        walletTypeSelect.value = walletType;
        console.log('Select dropdown updated from', oldValue, 'to', walletTypeSelect.value);
        
        // Verify it was set correctly
        if (walletTypeSelect.value !== walletType) {
            console.error('Failed to set select value! Expected:', walletType, 'Got:', walletTypeSelect.value);
        }
    } else {
        console.error('walletTypeSelect element not found!');
    }
    
    // Reinitialize wallet with new type - get fresh state
    const freshState = getState();
    console.log('Initializing wallet with type:', freshState.settings.walletType);
    
    if (!freshState.mnemonic) {
        showToast('No mnemonic available. Please unlock your wallet first.', 'error', toastContainer);
        return;
    }
    
    await initializeWallet();
    
    // Force a complete UI refresh after wallet initialization
    const finalState = getState();
    console.log('Final state wallet type:', finalState.settings.walletType);
    console.log('Final wallet object type:', finalState.wallet?.type);
    
    // Update all UI components
    updateSettingsUI(finalState);
    updateWalletUI();
    
    // Force update the wallet header specifically
    updateWalletHeader(finalState);
    
    showToast(`Wallet type changed to ${walletType.toUpperCase()}`, 'success', toastContainer);
}

/**
 * Handle logout
 */
export function handleLogout() {
    const toastContainer = document.getElementById('toastContainer');
    const mnemonicInput = document.getElementById('mnemonicInput');

    console.log('Logging out...');

    // Stop auto-refresh
    stopAutoRefresh();

    // Clear all state
    clearSavedState();

    // Clear security data
    if (securityService) {
        securityService.clearSecurityData();
    }

    // Close all modals
    closeAllModals();

    // Show import screen
    showImportScreen();

    // Clear mnemonic input
    if (mnemonicInput) mnemonicInput.value = '';

    showToast('Logged out successfully', 'info', toastContainer);
}

