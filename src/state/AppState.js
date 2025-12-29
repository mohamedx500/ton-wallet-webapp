/**
 * AppState - Centralized application state management
 * Single source of truth for all app state
 */

const STORAGE_KEY = 'ton_wallet_state';

// Initial state
const initialState = {
    wallet: null,
    mnemonic: null,
    encryptedMnemonic: null,
    balance: 0,
    usdRate: 0,
    transactions: [],
    settings: {
        theme: 'dark',
        walletType: 'v4r2',
        network: 'mainnet',
    },
    isLoading: false,
    isAuthenticated: false,
};

// Current state
let state = { ...initialState };

// State change listeners
const listeners = [];

/**
 * Get current state
 */
export function getState() {
    return state;
}

/**
 * Update state
 */
export function setState(updates) {
    // Deep merge for nested objects like settings
    const newState = { ...state };
    for (const key in updates) {
        if (updates.hasOwnProperty(key)) {
            if (typeof updates[key] === 'object' && updates[key] !== null && !Array.isArray(updates[key]) && key in state && typeof state[key] === 'object' && state[key] !== null) {
                // Deep merge for nested objects
                newState[key] = { ...state[key], ...updates[key] };
            } else {
                // Direct assignment for primitives and arrays
                newState[key] = updates[key];
            }
        }
    }
    state = newState;
    notifyListeners();
}

/**
 * Reset state to initial
 */
export function resetState() {
    state = { ...initialState };
    notifyListeners();
}

/**
 * Subscribe to state changes
 */
export function subscribe(listener) {
    listeners.push(listener);
    return () => {
        const index = listeners.indexOf(listener);
        if (index > -1) listeners.splice(index, 1);
    };
}

/**
 * Notify all listeners of state change
 */
function notifyListeners() {
    listeners.forEach(listener => listener(state));
}

/**
 * Load state from localStorage
 */
export function loadState() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            state = {
                ...state,
                encryptedMnemonic: parsed.encryptedMnemonic || null,
                settings: { ...state.settings, ...parsed.settings },
            };
        }
    } catch (e) {
        console.warn('Could not load saved state:', e);
    }
    return state;
}

/**
 * Save state to localStorage
 */
export function saveState() {
    try {
        const toSave = {
            encryptedMnemonic: state.encryptedMnemonic,
            settings: state.settings,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    } catch (e) {
        console.warn('Could not save state:', e);
    }
}

/**
 * Clear saved state
 */
export function clearSavedState() {
    localStorage.removeItem(STORAGE_KEY);
    resetState();
}
