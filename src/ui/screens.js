/**
 * UI Screens - Handles screen navigation and visibility
 */

/**
 * Show import screen, hide wallet screen
 */
export function showImportScreen() {
    const importScreen = document.getElementById('importScreen');
    const walletScreen = document.getElementById('walletScreen');

    if (importScreen) importScreen.classList.remove('hidden');
    if (walletScreen) walletScreen.classList.add('hidden');
}

/**
 * Show wallet screen, hide import screen
 */
export function showWalletScreen() {
    const importScreen = document.getElementById('importScreen');
    const walletScreen = document.getElementById('walletScreen');

    if (importScreen) importScreen.classList.add('hidden');
    if (walletScreen) walletScreen.classList.remove('hidden');
}

/**
 * Show password setup screen
 */
export function showPasswordSetup() {
    openModal('passwordSetupModal');
}

/**
 * Show password verify screen
 */
export function showPasswordVerify() {
    openModal('passwordVerifyModal');
}

/**
 * Open modal by ID
 */
export function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('hidden');
        // Focus first input if exists
        const input = modal.querySelector('input');
        if (input) setTimeout(() => input.focus(), 100);
    }
}

/**
 * Close modal by ID
 */
export function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('hidden');
        // Clear any password inputs
        const inputs = modal.querySelectorAll('input[type="password"]');
        inputs.forEach(input => input.value = '');
    }
}

/**
 * Close all modals
 */
export function closeAllModals() {
    document.querySelectorAll('.modal').forEach(modal => {
        modal.classList.add('hidden');
    });
}
