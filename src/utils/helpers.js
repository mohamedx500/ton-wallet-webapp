/**
 * Utility functions for TON Wallet
 */

/**
 * Show toast notification
 */
export function showToast(message, type = 'info', container) {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'toastOut 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

/**
 * Copy to clipboard
 */
export async function copyToClipboard(text, toastContainer) {
    if (!text) return;

    try {
        await navigator.clipboard.writeText(text);
        showToast('Copied!', 'success', toastContainer);
    } catch (e) {
        showToast('Failed to copy', 'error', toastContainer);
    }
}

/**
 * Format TON amount from nanotons
 */
export function formatTON(nanotons) {
    const tons = Number(nanotons) / 1e9;

    if (tons === 0) return '0.00';
    if (tons < 0.01) return tons.toFixed(6);
    if (tons < 1) return tons.toFixed(4);
    if (tons < 1000) return tons.toFixed(2);

    return tons.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/**
 * Format address for display
 */
export function formatAddress(address, chars = 6) {
    if (!address) return '...';
    if (address.length <= chars * 2 + 3) return address;
    return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

/**
 * Generate QR code
 */
export async function generateQRCode(text, container) {
    // Use QR code API
    const size = 176;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(text)}&bgcolor=ffffff&color=000000&format=svg`;

    container.innerHTML = `<img src="${qrUrl}" alt="QR Code" style="width: 100%; height: 100%;">`;
}

/**
 * Debounce function
 */
export function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Validate TON address
 */
export function isValidAddress(address) {
    if (!address) return false;

    // Check for valid TON address format
    const patterns = [
        /^[EU]Q[A-Za-z0-9_-]{46}$/, // User-friendly
        /^0:[a-fA-F0-9]{64}$/,      // Raw format
    ];

    return patterns.some(p => p.test(address));
}

// Inject toast out animation
const style = document.createElement('style');
style.textContent = `
    @keyframes toastOut {
        from { opacity: 1; transform: translateY(0); }
        to { opacity: 0; transform: translateY(10px); }
    }
`;
document.head.appendChild(style);
