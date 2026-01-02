/**
 * Services Index
 * 
 * Central export for all wallet services.
 * Provides singleton instances for consistent state across the app.
 */

// Core Services
export { WalletService } from './WalletService.js';
export { TonApiService } from './TonApiService.js';
export { SecurityService } from './SecurityService.js';

// Infrastructure Services
export {
    RequestQueue,
    CircuitBreaker,
    RetryService,
    MultiProviderFetch,
    createReliableApiClient,
    retryService,
    requestQueue,
} from './ApiRequestManager.js';

// Transaction Tracking
export {
    TransactionTracker,
    TransactionStatus,
    TransactionEvent,
    transactionTracker,
} from './TransactionTracker.js';

// Metrics & Monitoring
export {
    MetricsService,
    MetricType,
    metrics,
} from './MetricsService.js';

// Error Handling
export {
    ErrorHandler,
    WalletError,
    ErrorCategory,
    ErrorSeverity,
    errorHandler,
} from './ErrorHandler.js';

/**
 * Initialize all services
 * Call this once at app startup
 */
export function initializeServices() {
    console.log('[Services] Initializing...');

    // Set up error handler callback for metrics
    const { errorHandler } = require('./ErrorHandler.js');
    const { metrics } = require('./MetricsService.js');

    errorHandler.setOnError((error) => {
        metrics.recordError(error.category);
    });

    console.log('[Services] Initialized successfully');
}

/**
 * Get service health status
 */
export function getServicesHealth() {
    const { metrics } = require('./MetricsService.js');
    const { transactionTracker } = require('./TransactionTracker.js');
    const { errorHandler } = require('./ErrorHandler.js');
    const { retryService } = require('./ApiRequestManager.js');

    return {
        uptime: metrics.get('uptime') || (Date.now() - metrics.startTime) / 1000,
        pendingTransactions: transactionTracker.getPending().length,
        circuitBreakerState: retryService.getCircuitState(),
        errorStats: errorHandler.getStats(),
        apiMetrics: {
            totalRequests: metrics.get('api_requests_total'),
            successRate: metrics.get('api_requests_total') > 0
                ? (metrics.get('api_requests_success') / metrics.get('api_requests_total') * 100).toFixed(2) + '%'
                : 'N/A',
            avgLatency: metrics.get('api_request_duration_ms')?.avg?.toFixed(0) + 'ms' || 'N/A',
        },
    };
}
