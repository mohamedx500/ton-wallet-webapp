/**
 * Security Handlers - Mnemonic/key extraction with password verification
 */

import { getState } from '../state/AppState.js';
import { closeModal, openModal } from '../ui/screens.js';
import { showToast, copyToClipboard } from '../utils/helpers.js';

// Service instances
let securityService = null;

// Pending action after password verification
let pendingSecurityAction = null;

/**
 * Initialize handlers with service instances
 */
export function initSecurityHandlers(security) {
    securityService = security;
}

/**
 * Request to show mnemonic (requires password)
 */
export function requestShowMnemonic() {
    pendingSecurityAction = 'showMnemonic';
    openModal('passwordConfirmModal');
}

/**
 * Request to show private key (requires password)
 */
export function requestShowPrivateKey() {
    pendingSecurityAction = 'showPrivateKey';
    openModal('passwordConfirmModal');
}

/**
 * Request to copy mnemonic (requires password)
 */
export function requestCopyMnemonic() {
    pendingSecurityAction = 'copyMnemonic';
    openModal('passwordConfirmModal');
}

/**
 * Request to copy private key (requires password)
 */
export function requestCopyPrivateKey() {
    pendingSecurityAction = 'copyPrivateKey';
    openModal('passwordConfirmModal');
}

/**
 * Execute security action after password verification
 */
export async function executeSecurityAction(password) {
    const state = getState();
    const toastContainer = document.getElementById('toastContainer');

    try {
        // Verify password
        const isValid = await securityService.verifyPassword(password);
        if (!isValid) {
            showToast('Incorrect password', 'error', toastContainer);
            return false;
        }

        closeModal('passwordConfirmModal');

        const action = pendingSecurityAction;
        pendingSecurityAction = null;

        switch (action) {
            case 'showMnemonic':
                showMnemonicModal(state.mnemonic);
                break;
            case 'showPrivateKey':
                showPrivateKeyModal(state.wallet?.keyPair);
                break;
            case 'copyMnemonic':
                copyMnemonicToClipboard(state.mnemonic);
                break;
            case 'copyPrivateKey':
                copyPrivateKeyToClipboard(state.wallet?.keyPair);
                break;
            default:
                // If no security action, it might be a send transaction
                return 'continue';
        }

        return true;

    } catch (error) {
        console.error('Error executing security action:', error);
        showToast('Error: ' + error.message, 'error', toastContainer);
        return false;
    }
}

/**
 * Check if there's a pending security action
 */
export function hasPendingSecurityAction() {
    return pendingSecurityAction !== null;
}

/**
 * Clear pending security action
 */
export function clearPendingSecurityAction() {
    pendingSecurityAction = null;
}

/**
 * Show mnemonic in modal
 */
function showMnemonicModal(mnemonic) {
    const mnemonicDisplay = document.getElementById('mnemonicDisplay');
    const toastContainer = document.getElementById('toastContainer');

    if (!mnemonic) {
        showToast('Mnemonic not available', 'error', toastContainer);
        return;
    }

    if (mnemonicDisplay) {
        mnemonicDisplay.textContent = Array.isArray(mnemonic) ? mnemonic.join(' ') : mnemonic;
    }

    // Close settings modal first, then open export modal
    closeModal('settingsModal');
    openModal('exportMnemonicModal');
}

/**
 * Show private key in modal
 */
function showPrivateKeyModal(keyPair) {
    const privateKeyDisplay = document.getElementById('privateKeyDisplay');
    const toastContainer = document.getElementById('toastContainer');

    if (!keyPair) {
        showToast('Private key not available', 'error', toastContainer);
        return;
    }

    if (privateKeyDisplay) {
        const privateKeyHex = Buffer.from(keyPair.secretKey).toString('hex');
        privateKeyDisplay.textContent = privateKeyHex;
    }

    // Close settings modal first, then open export modal
    closeModal('settingsModal');
    openModal('exportPrivateKeyModal');
}

/**
 * Copy mnemonic to clipboard
 */
function copyMnemonicToClipboard(mnemonic) {
    const toastContainer = document.getElementById('toastContainer');

    if (!mnemonic) {
        showToast('Mnemonic not available', 'error', toastContainer);
        return;
    }

    const mnemonicStr = Array.isArray(mnemonic) ? mnemonic.join(' ') : mnemonic;
    copyToClipboard(mnemonicStr, toastContainer);
}

/**
 * Copy private key to clipboard
 */
function copyPrivateKeyToClipboard(keyPair) {
    const toastContainer = document.getElementById('toastContainer');

    if (!keyPair) {
        showToast('Private key not available', 'error', toastContainer);
        return;
    }

    const privateKeyHex = Buffer.from(keyPair.secretKey).toString('hex');
    copyToClipboard(privateKeyHex, toastContainer);
}
