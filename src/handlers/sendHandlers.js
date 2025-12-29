/**
 * Send Handlers - Transaction sending with password verification
 * Supports TON and Jetton transfers
 */

import { getState, setState } from '../state/AppState.js';
import { closeModal, openModal } from '../ui/screens.js';
import { showToast, formatTON } from '../utils/helpers.js';
import { refreshWalletData } from './walletHandlers.js';
import { updateSendTokenSelector, updateSelectedTokenBalance } from '../ui/balance.js';

// Service instances
let walletService = null;
let securityService = null;

// Pending transaction data
let pendingTransaction = null;

/**
 * Initialize handlers with service instances
 */
export function initSendHandlers(wallet, security) {
    walletService = wallet;
    securityService = security;

    // Set up token selector change handler
    const tokenSelect = document.getElementById('sendTokenSelect');
    if (tokenSelect) {
        tokenSelect.addEventListener('change', () => {
            const state = getState();
            updateSelectedTokenBalance(state);
        });
    }
}

/**
 * Open send modal with token selector populated
 */
export function openSendModal() {
    const state = getState();

    // Update token selector with available tokens
    updateSendTokenSelector(state);

    // Open the modal
    openModal('sendModal');
}

/**
 * Handle send button click - verify password first
 */
export async function handleSendTransaction() {
    const recipientAddress = document.getElementById('recipientAddress');
    const sendAmount = document.getElementById('sendAmount');
    const sendComment = document.getElementById('sendComment');
    const tokenSelect = document.getElementById('sendTokenSelect');
    const toastContainer = document.getElementById('toastContainer');
    const state = getState();

    const recipient = recipientAddress?.value.trim();
    const amount = parseFloat(sendAmount?.value);
    const comment = sendComment?.value.trim() || '';
    const selectedToken = tokenSelect?.value || 'TON';
    const selectedOption = tokenSelect?.selectedOptions[0];

    // Validation
    if (!recipient) {
        showToast('Please enter recipient address', 'error', toastContainer);
        return;
    }

    if (!amount || amount <= 0) {
        showToast('Please enter valid amount', 'error', toastContainer);
        return;
    }

    // Check balance based on selected token
    if (selectedToken === 'TON') {
        if (amount * 1e9 > state.balance) {
            showToast('Insufficient TON balance', 'error', toastContainer);
            return;
        }
    } else {
        // Jetton token
        const tokenBalance = parseInt(selectedOption?.dataset.balance) || 0;
        const tokenDecimals = parseInt(selectedOption?.dataset.decimals) || 9;
        if (amount * Math.pow(10, tokenDecimals) > tokenBalance) {
            showToast('Insufficient token balance', 'error', toastContainer);
            return;
        }
    }

    // Store pending transaction
    pendingTransaction = {
        recipient,
        amount,
        comment,
        token: selectedToken,
        tokenSymbol: selectedOption?.dataset.symbol || 'TON',
        tokenDecimals: parseInt(selectedOption?.dataset.decimals) || 9
    };

    // Show password verification modal
    openModal('passwordConfirmModal');
}

/**
 * Execute send after password verification
 */
export async function executeSendTransaction(password) {
    const state = getState();
    const toastContainer = document.getElementById('toastContainer');
    const confirmSendBtn = document.getElementById('confirmSendBtn');

    try {
        // Verify password
        const isValid = await securityService.verifyPassword(password);
        if (!isValid) {
            showToast('Incorrect password', 'error', toastContainer);
            return false;
        }

        if (!pendingTransaction) {
            showToast('No pending transaction', 'error', toastContainer);
            return false;
        }

        // Close password modal
        closeModal('passwordConfirmModal');

        // Show loading on send button
        if (confirmSendBtn) {
            confirmSendBtn.disabled = true;
            confirmSendBtn.innerHTML = '<span>Sending...</span>';
        }

        showToast('Sending transaction...', 'info', toastContainer);

        console.log('Sending transaction:', {
            recipient: pendingTransaction.recipient,
            amount: pendingTransaction.amount,
            token: pendingTransaction.token,
            comment: pendingTransaction.comment,
            network: state.settings.network
        });

        // Execute transaction (currently only TON supported)
        if (pendingTransaction.token === 'TON') {
            const result = await walletService.sendTransaction(
                state.mnemonic,
                state.settings.walletType,
                pendingTransaction.recipient,
                pendingTransaction.amount,
                pendingTransaction.comment,
                state.settings.network === 'testnet'
            );

            console.log('Transaction sent:', result);
            showToast('Transaction sent successfully!', 'success', toastContainer);
        } else {
            // Jetton transfer
            // First, get the jetton wallet address for the sender
            const jettonMasterAddress = pendingTransaction.token; // This is the jetton contract address
            const jettonWalletAddress = await walletService.getJettonWalletAddress(
                state.wallet.address,
                jettonMasterAddress,
                state.settings.network === 'testnet'
            );

            if (!jettonWalletAddress) {
                showToast('Could not find your jetton wallet', 'error', toastContainer);
                return false;
            }

            console.log('Jetton wallet address:', jettonWalletAddress);

            const result = await walletService.sendJettonTransfer(
                state.mnemonic,
                state.settings.walletType,
                jettonWalletAddress,
                pendingTransaction.recipient,
                pendingTransaction.amount,
                pendingTransaction.tokenDecimals || 6,
                pendingTransaction.comment,
                state.settings.network === 'testnet'
            );

            console.log('Jetton transfer sent:', result);
            showToast(`${pendingTransaction.tokenSymbol} sent successfully!`, 'success', toastContainer);
        }

        // Close send modal
        closeModal('sendModal');

        // Clear form
        clearSendForm();

        // Clear pending transaction
        pendingTransaction = null;

        // Refresh data after delay
        setTimeout(() => refreshWalletData(), 3000);

        return true;

    } catch (error) {
        console.error('Error sending transaction:', error);
        showToast('Error: ' + error.message, 'error', toastContainer);
        return false;
    } finally {
        if (confirmSendBtn) {
            confirmSendBtn.disabled = false;
            confirmSendBtn.innerHTML = '<span>Send</span>';
        }
    }
}

/**
 * Clear send form inputs
 */
function clearSendForm() {
    const recipientAddress = document.getElementById('recipientAddress');
    const sendAmount = document.getElementById('sendAmount');
    const sendComment = document.getElementById('sendComment');
    const tokenSelect = document.getElementById('sendTokenSelect');

    if (recipientAddress) recipientAddress.value = '';
    if (sendAmount) sendAmount.value = '';
    if (sendComment) sendComment.value = '';
    if (tokenSelect) tokenSelect.selectedIndex = 0;
}

/**
 * Set max amount based on selected token
 */
export function handleMaxAmount() {
    const state = getState();
    const sendAmount = document.getElementById('sendAmount');
    const tokenSelect = document.getElementById('sendTokenSelect');
    const selectedOption = tokenSelect?.selectedOptions[0];
    const selectedToken = tokenSelect?.value || 'TON';

    let maxAmount = 0;

    if (selectedToken === 'TON') {
        // Leave 0.01 TON for fees
        maxAmount = Math.max(0, (state.balance / 1e9) - 0.01);
    } else {
        // Jetton - use full balance
        const tokenBalance = parseInt(selectedOption?.dataset.balance) || 0;
        const tokenDecimals = parseInt(selectedOption?.dataset.decimals) || 9;
        maxAmount = tokenBalance / Math.pow(10, tokenDecimals);
    }

    if (sendAmount) sendAmount.value = maxAmount.toFixed(4);
}
