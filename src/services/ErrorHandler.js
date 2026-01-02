/**
 * Error Handler Service
 * 
 * Inspired by ton-wallet-api's error handling patterns.
 * Provides structured error handling, categorization, and user-friendly messages.
 * 
 * Features:
 * - Categorize errors by type (network, blockchain, validation, etc.)
 * - Map technical errors to user-friendly messages
 * - Log errors with context for debugging
 * - Support for error recovery suggestions
 */

/**
 * Error categories
 */
export const ErrorCategory = {
    NETWORK: 'network',
    BLOCKCHAIN: 'blockchain',
    VALIDATION: 'validation',
    WALLET: 'wallet',
    RATE_LIMIT: 'rate_limit',
    TIMEOUT: 'timeout',
    AUTHENTICATION: 'authentication',
    INSUFFICIENT_FUNDS: 'insufficient_funds',
    UNKNOWN: 'unknown',
};

/**
 * Error severity levels
 */
export const ErrorSeverity = {
    LOW: 'low',         // Informational, can be ignored
    MEDIUM: 'medium',   // May affect user, but recoverable
    HIGH: 'high',       // Significant issue, needs attention
    CRITICAL: 'critical', // System failure, immediate action needed
};

/**
 * Structured wallet error
 */
export class WalletError extends Error {
    constructor(message, options = {}) {
        super(message);
        this.name = 'WalletError';
        this.category = options.category || ErrorCategory.UNKNOWN;
        this.severity = options.severity || ErrorSeverity.MEDIUM;
        this.code = options.code || 'UNKNOWN_ERROR';
        this.userMessage = options.userMessage || message;
        this.recoverable = options.recoverable ?? true;
        this.suggestion = options.suggestion || null;
        this.context = options.context || {};
        this.timestamp = new Date().toISOString();
        this.originalError = options.originalError || null;
    }

    toJSON() {
        return {
            name: this.name,
            message: this.message,
            category: this.category,
            severity: this.severity,
            code: this.code,
            userMessage: this.userMessage,
            recoverable: this.recoverable,
            suggestion: this.suggestion,
            context: this.context,
            timestamp: this.timestamp,
        };
    }
}

/**
 * Error patterns for categorization
 */
const ERROR_PATTERNS = [
    {
        patterns: ['rate', '429', 'too many requests', 'throttl'],
        category: ErrorCategory.RATE_LIMIT,
        severity: ErrorSeverity.MEDIUM,
        code: 'RATE_LIMIT_EXCEEDED',
        userMessage: 'Too many requests. Please wait a moment and try again.',
        suggestion: 'Wait 30 seconds before retrying',
        recoverable: true,
    },
    {
        patterns: ['timeout', 'timed out', 'aborted', 'deadline'],
        category: ErrorCategory.TIMEOUT,
        severity: ErrorSeverity.MEDIUM,
        code: 'REQUEST_TIMEOUT',
        userMessage: 'Request timed out. The network may be slow.',
        suggestion: 'Check your internet connection and try again',
        recoverable: true,
    },
    {
        patterns: ['network', 'fetch', 'connection', 'econnreset', 'enotfound', 'offline'],
        category: ErrorCategory.NETWORK,
        severity: ErrorSeverity.HIGH,
        code: 'NETWORK_ERROR',
        userMessage: 'Network error. Please check your connection.',
        suggestion: 'Ensure you have an internet connection',
        recoverable: true,
    },
    {
        patterns: ['insufficient', 'not enough', 'balance', 'funds'],
        category: ErrorCategory.INSUFFICIENT_FUNDS,
        severity: ErrorSeverity.MEDIUM,
        code: 'INSUFFICIENT_FUNDS',
        userMessage: 'Insufficient balance for this transaction.',
        suggestion: 'Add more TON to your wallet',
        recoverable: false,
    },
    {
        patterns: ['invalid address', 'address format', 'parse address'],
        category: ErrorCategory.VALIDATION,
        severity: ErrorSeverity.MEDIUM,
        code: 'INVALID_ADDRESS',
        userMessage: 'Invalid wallet address format.',
        suggestion: 'Check the recipient address is correct',
        recoverable: false,
    },
    {
        patterns: ['invalid amount', 'amount must be', 'nan', 'not a number'],
        category: ErrorCategory.VALIDATION,
        severity: ErrorSeverity.LOW,
        code: 'INVALID_AMOUNT',
        userMessage: 'Please enter a valid amount.',
        suggestion: 'Enter a positive number',
        recoverable: false,
    },
    {
        patterns: ['invalid mnemonic', 'mnemonic', 'seed phrase', 'secret phrase'],
        category: ErrorCategory.VALIDATION,
        severity: ErrorSeverity.HIGH,
        code: 'INVALID_MNEMONIC',
        userMessage: 'Invalid recovery phrase.',
        suggestion: 'Check that all 24 words are correct',
        recoverable: false,
    },
    {
        patterns: ['password', 'incorrect password', 'wrong password', 'decrypt'],
        category: ErrorCategory.AUTHENTICATION,
        severity: ErrorSeverity.MEDIUM,
        code: 'INVALID_PASSWORD',
        userMessage: 'Incorrect password.',
        suggestion: 'Try entering your password again',
        recoverable: true,
    },
    {
        patterns: ['seqno', 'sequence', 'replay', 'duplicate'],
        category: ErrorCategory.BLOCKCHAIN,
        severity: ErrorSeverity.MEDIUM,
        code: 'SEQUENCE_ERROR',
        userMessage: 'Transaction sequence error. Please try again.',
        suggestion: 'Wait a moment and retry the transaction',
        recoverable: true,
    },
    {
        patterns: ['503', '504', 'service unavailable', 'gateway'],
        category: ErrorCategory.NETWORK,
        severity: ErrorSeverity.HIGH,
        code: 'SERVICE_UNAVAILABLE',
        userMessage: 'Service temporarily unavailable.',
        suggestion: 'The service is experiencing issues. Try again later.',
        recoverable: true,
    },
    {
        patterns: ['contract', 'execute', 'exit code', 'compute phase'],
        category: ErrorCategory.BLOCKCHAIN,
        severity: ErrorSeverity.HIGH,
        code: 'CONTRACT_ERROR',
        userMessage: 'Smart contract execution failed.',
        suggestion: 'The transaction may have invalid parameters',
        recoverable: false,
    },
    {
        patterns: ['circuit breaker', 'too many failures'],
        category: ErrorCategory.NETWORK,
        severity: ErrorSeverity.CRITICAL,
        code: 'CIRCUIT_OPEN',
        userMessage: 'Service temporarily unavailable due to network issues.',
        suggestion: 'Wait a minute and try again',
        recoverable: true,
    },
    {
        patterns: ['slow', 'weak connection', 'poor signal', 'low bandwidth', 'slow-2g', '2g', '3g'],
        category: ErrorCategory.NETWORK,
        severity: ErrorSeverity.MEDIUM,
        code: 'SLOW_CONNECTION',
        userMessage: 'Slow internet connection detected.',
        suggestion: 'Try connecting to a stronger network or wait for better signal',
        recoverable: true,
    },
];

/**
 * Error Handler Service
 */
export class ErrorHandler {
    constructor() {
        this.errorLog = [];
        this.maxLogSize = 100;
        this.onError = null; // Callback for error notifications
    }

    /**
     * Categorize an error based on its message
     */
    categorize(error) {
        const message = (error?.message || String(error)).toLowerCase();

        for (const pattern of ERROR_PATTERNS) {
            const matches = pattern.patterns.some(p => message.includes(p.toLowerCase()));
            if (matches) {
                return pattern;
            }
        }

        return {
            category: ErrorCategory.UNKNOWN,
            severity: ErrorSeverity.MEDIUM,
            code: 'UNKNOWN_ERROR',
            userMessage: 'An unexpected error occurred.',
            suggestion: 'Please try again or contact support',
            recoverable: true,
        };
    }

    /**
     * Handle an error - categorize, log, and return structured error
     */
    handle(error, context = {}) {
        // If already a WalletError, just log and return
        if (error instanceof WalletError) {
            this._log(error);
            return error;
        }

        // Categorize the error
        const category = this.categorize(error);

        // Create structured error
        const walletError = new WalletError(error?.message || String(error), {
            category: category.category,
            severity: category.severity,
            code: category.code,
            userMessage: category.userMessage,
            suggestion: category.suggestion,
            recoverable: category.recoverable,
            context,
            originalError: error,
        });

        // Log the error
        this._log(walletError);

        // Call error callback if set
        if (this.onError) {
            try {
                this.onError(walletError);
            } catch (e) {
                console.error('Error in error callback:', e);
            }
        }

        return walletError;
    }

    /**
     * Log an error
     */
    _log(error) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            error: error instanceof WalletError ? error.toJSON() : {
                message: error?.message || String(error),
                stack: error?.stack,
            },
        };

        this.errorLog.unshift(logEntry);

        // Keep log size manageable
        if (this.errorLog.length > this.maxLogSize) {
            this.errorLog = this.errorLog.slice(0, this.maxLogSize);
        }

        // Console log for debugging
        const severity = error.severity || ErrorSeverity.MEDIUM;
        if (severity === ErrorSeverity.CRITICAL || severity === ErrorSeverity.HIGH) {
            console.error('[ErrorHandler]', error);
        } else {
            console.warn('[ErrorHandler]', error.message || error);
        }
    }

    /**
     * Get error log
     */
    getLog() {
        return [...this.errorLog];
    }

    /**
     * Get errors by category
     */
    getByCategory(category) {
        return this.errorLog.filter(e => e.error.category === category);
    }

    /**
     * Get error statistics
     */
    getStats() {
        const stats = {
            total: this.errorLog.length,
            byCategory: {},
            bySeverity: {},
            last24h: 0,
        };

        const dayAgo = Date.now() - 24 * 60 * 60 * 1000;

        for (const entry of this.errorLog) {
            const category = entry.error.category || ErrorCategory.UNKNOWN;
            const severity = entry.error.severity || ErrorSeverity.MEDIUM;

            stats.byCategory[category] = (stats.byCategory[category] || 0) + 1;
            stats.bySeverity[severity] = (stats.bySeverity[severity] || 0) + 1;

            if (new Date(entry.timestamp).getTime() > dayAgo) {
                stats.last24h++;
            }
        }

        return stats;
    }

    /**
     * Clear error log
     */
    clear() {
        this.errorLog = [];
    }

    /**
     * Set error callback
     */
    setOnError(callback) {
        this.onError = callback;
    }

    /**
     * Create a user-friendly error message
     */
    getUserMessage(error) {
        if (error instanceof WalletError) {
            return {
                message: error.userMessage,
                suggestion: error.suggestion,
                recoverable: error.recoverable,
            };
        }

        const category = this.categorize(error);
        return {
            message: category.userMessage,
            suggestion: category.suggestion,
            recoverable: category.recoverable,
        };
    }
}

// Export singleton instance
export const errorHandler = new ErrorHandler();

export default ErrorHandler;
