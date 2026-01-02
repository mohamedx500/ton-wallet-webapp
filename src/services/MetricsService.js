/**
 * Metrics Service
 * 
 * Inspired by ton-wallet-api's Prometheus metrics exporter.
 * Tracks application metrics for monitoring and debugging.
 * 
 * Features:
 * - Track API request counts and latencies
 * - Track transaction counts by status
 * - Track error rates
 * - Export metrics for debugging
 * - Performance monitoring
 */

/**
 * Metric types
 */
export const MetricType = {
    COUNTER: 'counter',
    GAUGE: 'gauge',
    HISTOGRAM: 'histogram',
};

/**
 * Metrics Service
 */
export class MetricsService {
    constructor() {
        this.metrics = new Map();
        this.startTime = Date.now();

        // Initialize default metrics
        this._initializeDefaultMetrics();
    }

    /**
     * Initialize default application metrics
     */
    _initializeDefaultMetrics() {
        // API Metrics
        this.createCounter('api_requests_total', 'Total API requests');
        this.createCounter('api_requests_success', 'Successful API requests');
        this.createCounter('api_requests_failed', 'Failed API requests');
        this.createHistogram('api_request_duration_ms', 'API request duration in milliseconds');

        // Transaction Metrics
        this.createCounter('transactions_sent_total', 'Total transactions sent');
        this.createCounter('transactions_confirmed', 'Confirmed transactions');
        this.createCounter('transactions_failed', 'Failed transactions');
        this.createGauge('transactions_pending', 'Currently pending transactions');

        // Wallet Metrics
        this.createCounter('wallet_balance_refreshes', 'Balance refresh count');
        this.createGauge('wallet_balance_ton', 'Current TON balance');

        // Error Metrics
        this.createCounter('errors_total', 'Total errors');
        this.createCounter('errors_network', 'Network errors');
        this.createCounter('errors_rate_limit', 'Rate limit errors');
        this.createCounter('errors_timeout', 'Timeout errors');

        // Circuit Breaker Metrics
        this.createGauge('circuit_breaker_state', 'Circuit breaker state (0=closed, 1=open, 2=half-open)');
        this.createCounter('circuit_breaker_trips', 'Circuit breaker trip count');
    }

    /**
     * Create a counter metric
     */
    createCounter(name, description = '') {
        this.metrics.set(name, {
            type: MetricType.COUNTER,
            description,
            value: 0,
            createdAt: Date.now(),
        });
    }

    /**
     * Create a gauge metric
     */
    createGauge(name, description = '') {
        this.metrics.set(name, {
            type: MetricType.GAUGE,
            description,
            value: 0,
            createdAt: Date.now(),
        });
    }

    /**
     * Create a histogram metric
     */
    createHistogram(name, description = '', buckets = [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000]) {
        this.metrics.set(name, {
            type: MetricType.HISTOGRAM,
            description,
            buckets,
            values: [],
            sum: 0,
            count: 0,
            createdAt: Date.now(),
        });
    }

    /**
     * Increment a counter
     */
    increment(name, value = 1) {
        const metric = this.metrics.get(name);
        if (metric && metric.type === MetricType.COUNTER) {
            metric.value += value;
        }
    }

    /**
     * Set a gauge value
     */
    set(name, value) {
        const metric = this.metrics.get(name);
        if (metric && metric.type === MetricType.GAUGE) {
            metric.value = value;
        }
    }

    /**
     * Observe a value in a histogram
     */
    observe(name, value) {
        const metric = this.metrics.get(name);
        if (metric && metric.type === MetricType.HISTOGRAM) {
            metric.values.push(value);
            metric.sum += value;
            metric.count++;

            // Keep only last 1000 values to prevent memory issues
            if (metric.values.length > 1000) {
                metric.values = metric.values.slice(-1000);
            }
        }
    }

    /**
     * Time a function execution
     */
    async time(name, fn) {
        const start = performance.now();
        try {
            return await fn();
        } finally {
            const duration = performance.now() - start;
            this.observe(name, duration);
        }
    }

    /**
     * Get a metric value
     */
    get(name) {
        const metric = this.metrics.get(name);
        if (!metric) return null;

        if (metric.type === MetricType.HISTOGRAM) {
            return {
                count: metric.count,
                sum: metric.sum,
                avg: metric.count > 0 ? metric.sum / metric.count : 0,
                min: metric.values.length > 0 ? Math.min(...metric.values) : 0,
                max: metric.values.length > 0 ? Math.max(...metric.values) : 0,
                p50: this._percentile(metric.values, 50),
                p95: this._percentile(metric.values, 95),
                p99: this._percentile(metric.values, 99),
            };
        }

        return metric.value;
    }

    /**
     * Calculate percentile
     */
    _percentile(values, percentile) {
        if (values.length === 0) return 0;
        const sorted = [...values].sort((a, b) => a - b);
        const index = Math.ceil((percentile / 100) * sorted.length) - 1;
        return sorted[Math.max(0, index)];
    }

    /**
     * Get all metrics
     */
    getAll() {
        const result = {};
        for (const [name, metric] of this.metrics) {
            result[name] = this.get(name);
        }
        return result;
    }

    /**
     * Export metrics in Prometheus-like format
     */
    exportPrometheus() {
        const lines = [];
        const uptime = (Date.now() - this.startTime) / 1000;

        lines.push(`# Uptime: ${uptime.toFixed(0)} seconds`);
        lines.push('');

        for (const [name, metric] of this.metrics) {
            if (metric.description) {
                lines.push(`# HELP ${name} ${metric.description}`);
            }
            lines.push(`# TYPE ${name} ${metric.type}`);

            if (metric.type === MetricType.HISTOGRAM) {
                const stats = this.get(name);
                lines.push(`${name}_count ${stats.count}`);
                lines.push(`${name}_sum ${stats.sum.toFixed(2)}`);
                lines.push(`${name}_avg ${stats.avg.toFixed(2)}`);
            } else {
                lines.push(`${name} ${metric.value}`);
            }
            lines.push('');
        }

        return lines.join('\n');
    }

    /**
     * Export metrics as JSON
     */
    exportJSON() {
        return {
            uptime: (Date.now() - this.startTime) / 1000,
            timestamp: new Date().toISOString(),
            metrics: this.getAll(),
        };
    }

    /**
     * Log metrics to console
     */
    logSummary() {
        console.log('=== Wallet Metrics Summary ===');
        console.log(this.exportPrometheus());
    }

    /**
     * Reset all metrics
     */
    reset() {
        for (const metric of this.metrics.values()) {
            if (metric.type === MetricType.COUNTER || metric.type === MetricType.GAUGE) {
                metric.value = 0;
            } else if (metric.type === MetricType.HISTOGRAM) {
                metric.values = [];
                metric.sum = 0;
                metric.count = 0;
            }
        }
    }

    // =========================================================================
    // Convenience methods for common operations
    // =========================================================================

    /**
     * Record an API request
     */
    recordApiRequest(success = true, durationMs = 0) {
        this.increment('api_requests_total');
        if (success) {
            this.increment('api_requests_success');
        } else {
            this.increment('api_requests_failed');
        }
        if (durationMs > 0) {
            this.observe('api_request_duration_ms', durationMs);
        }
    }

    /**
     * Record a transaction
     */
    recordTransaction(status) {
        this.increment('transactions_sent_total');
        if (status === 'confirmed') {
            this.increment('transactions_confirmed');
        } else if (status === 'failed') {
            this.increment('transactions_failed');
        }
    }

    /**
     * Record an error
     */
    recordError(type = 'unknown') {
        this.increment('errors_total');
        if (type === 'network') {
            this.increment('errors_network');
        } else if (type === 'rate_limit') {
            this.increment('errors_rate_limit');
        } else if (type === 'timeout') {
            this.increment('errors_timeout');
        }
    }

    /**
     * Update pending transaction count
     */
    setPendingTransactions(count) {
        this.set('transactions_pending', count);
    }

    /**
     * Update balance
     */
    setBalance(balance) {
        this.set('wallet_balance_ton', balance);
        this.increment('wallet_balance_refreshes');
    }
}

// Export singleton instance
export const metrics = new MetricsService();

export default MetricsService;
