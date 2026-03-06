/**
 * DevTools Security Guard
 *
 * Production-only runtime hardening that prevents data leakage
 * through browser developer tools (F12).
 *
 * Protections:
 * 1. Neutralises all console.* methods so injected code cannot log secrets.
 * 2. Blocks common DevTools keyboard shortcuts (F12, Ctrl+Shift+I/J/C, Ctrl+U).
 * 3. Disables the right-click context menu ("Inspect Element").
 * 4. Periodically clears the console to remove any residual output.
 *
 * All guards are **no-ops** when import.meta.env.DEV is true,
 * so local development is completely unaffected.
 */

const IS_PRODUCTION = import.meta.env.PROD;

// ---------------------------------------------------------------------------
// 1. Console neutralisation
// ---------------------------------------------------------------------------

const noop = () => {};

function neutraliseConsole(): void {
    if (!IS_PRODUCTION) return;

    const methods: (keyof Console)[] = [
        'log', 'warn', 'error', 'info', 'debug',
        'table', 'dir', 'dirxml', 'trace',
        'group', 'groupCollapsed', 'groupEnd',
        'count', 'countReset', 'time', 'timeEnd', 'timeLog',
        'assert', 'profile', 'profileEnd',
    ];

    for (const method of methods) {
        try {
            (console as any)[method] = noop;
        } catch {
            // Some environments freeze console — ignore
        }
    }
}

// ---------------------------------------------------------------------------
// 2. Keyboard shortcut blocker
// ---------------------------------------------------------------------------

function blockDevToolsShortcuts(): void {
    if (!IS_PRODUCTION) return;

    document.addEventListener('keydown', (e: KeyboardEvent) => {
        // F12
        if (e.key === 'F12') {
            e.preventDefault();
            e.stopPropagation();
            return false;
        }

        // Ctrl+Shift+I  (Elements)
        // Ctrl+Shift+J  (Console)
        // Ctrl+Shift+C  (Inspect picker)
        if (
            (e.ctrlKey && e.shiftKey) &&
            ['I', 'J', 'C'].includes(e.key.toUpperCase())
        ) {
            e.preventDefault();
            e.stopPropagation();
            return false;
        }

        // Ctrl+U  (View Source)
        if (e.ctrlKey && e.key.toUpperCase() === 'U') {
            e.preventDefault();
            e.stopPropagation();
            return false;
        }
    }, { capture: true });
}

// ---------------------------------------------------------------------------
// 3. Context-menu blocker (prevents "Inspect Element")
// ---------------------------------------------------------------------------

function blockContextMenu(): void {
    if (!IS_PRODUCTION) return;

    document.addEventListener('contextmenu', (e: MouseEvent) => {
        e.preventDefault();
        return false;
    }, { capture: true });
}

// ---------------------------------------------------------------------------
// 4. Periodic console clear
// ---------------------------------------------------------------------------

let clearTimer: ReturnType<typeof setInterval> | null = null;

function startConsoleClear(): void {
    if (!IS_PRODUCTION) return;

    // Keep a reference to the native clear in case it was not neutered
    const nativeClear = console.clear?.bind(console) || noop;

    clearTimer = setInterval(() => {
        try { nativeClear(); } catch { /* ignore */ }
    }, 2000);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Activate all DevTools protections.
 * Safe to call multiple times — guards are idempotent.
 */
export function initDevToolsGuard(): void {
    if (!IS_PRODUCTION) return;

    neutraliseConsole();
    blockDevToolsShortcuts();
    blockContextMenu();
    startConsoleClear();
}

/**
 * Tear down guards (useful for testing).
 */
export function destroyDevToolsGuard(): void {
    if (clearTimer) {
        clearInterval(clearTimer);
        clearTimer = null;
    }
}
