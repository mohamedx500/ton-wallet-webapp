# Wallet App Scalability & Reliability Optimization Plan

## Executive Summary

This document outlines optimizations to ensure the TON wallet app can serve the largest possible number of users without lag, delays, or conflicts.

## Current Architecture

Your wallet is a **client-side application** where:
- Each user runs their own instance in their browser
- Each user has their own wallet/keys stored locally (localStorage)
- Transactions are sent independently to the blockchain

**Good News**: In this architecture, User 1's transaction CANNOT conflict with User 2's transaction because they are completely isolated (different wallets, different sessions).

---

## Issues & Solutions

### 1. 🔴 API Rate Limiting (HIGH PRIORITY)

**Problem**: All users share the same API key. TonAPI and Toncenter have rate limits (e.g., 1 request/second for free tier).

**Current Code**:
```javascript
// TonApiService.js
this.apiKey = import.meta.env.VITE_TONAPI_KEY;
```

**Solutions**:

#### Option A: Use RPC Provider Array (Load Balancing)
Rotate between multiple RPC endpoints to distribute load:

```javascript
// Recommended: Add to .env
VITE_TONAPI_KEY=your_key
VITE_TONCENTER_API_KEY=your_key
VITE_CHAINSTACK_API_KEY=your_key (optional)

// Use multiple endpoints with fallback
const RPC_ENDPOINTS = [
    { url: 'https://toncenter.com/api/v2/jsonRPC', key: VITE_TONCENTER_API_KEY },
    { url: 'https://tonapi.io/v2', key: VITE_TONAPI_KEY },
];
```

#### Option B: Implement Request Queue with Rate Limiting
Add a request queue that enforces rate limits:

```javascript
class RequestQueue {
    constructor(requestsPerSecond = 1) {
        this.queue = [];
        this.processing = false;
        this.interval = 1000 / requestsPerSecond;
    }

    async add(fn) {
        return new Promise((resolve, reject) => {
            this.queue.push({ fn, resolve, reject });
            this.process();
        });
    }

    async process() {
        if (this.processing || this.queue.length === 0) return;
        this.processing = true;
        
        const { fn, resolve, reject } = this.queue.shift();
        try {
            const result = await fn();
            resolve(result);
        } catch (error) {
            reject(error);
        }
        
        setTimeout(() => {
            this.processing = false;
            this.process();
        }, this.interval);
    }
}
```

#### Option C: Get Enterprise API Keys
- TonAPI Pro: https://tonconsole.com (higher limits)
- Toncenter: Contact @tonapibot on Telegram for enterprise access

---

### 2. 🟡 Highload Query ID Collisions (MEDIUM PRIORITY)

**Problem**: The current implementation uses timestamp-based query IDs. If two transactions happen in the same millisecond or after page refresh, there could be collisions.

**Current Code**:
```javascript
// sendHighloadTransaction in WalletService.js
const now = Date.now();
const shift = Math.floor(now / 1000) % 8192;
const bitNumber = now % 1023;
```

**Solution**: Use the `QueryIdStore` class which persists state to localStorage:

```javascript
// Instead of calculating fresh each time:
import { QueryIdStore } from '../wallets/highload-v3/HighloadQueryId';

// Create store per wallet address
const queryIdStore = new QueryIdStore(walletAddress);
const queryIdInstance = queryIdStore.getNext(); // Auto-persists to localStorage
```

**Benefits**:
- Query IDs are never reused (persisted to localStorage)
- Sequential incrementing prevents collisions
- Automatic cleanup/reset when needed

---

### 3. 🟡 Enhanced Retry Logic (MEDIUM PRIORITY)

**Problem**: Current retry logic only handles rate limiting with 3 retries. Network issues, temporary outages, and other errors need handling.

**Current Code**:
```javascript
async withRetry(fn, maxRetries = 3, baseDelay = 2000) {
    // Only retries on rate limit errors
}
```

**Solution**: Implement comprehensive retry with circuit breaker:

```javascript
class RetryService {
    constructor() {
        this.failureCount = 0;
        this.circuitOpen = false;
        this.circuitOpenTime = null;
        this.circuitResetTimeout = 30000; // 30 seconds
    }

    async withRetry(fn, options = {}) {
        const {
            maxRetries = 5,
            baseDelay = 1000,
            maxDelay = 30000,
            retryableErrors = ['rate', '429', '503', '504', 'timeout', 'ECONNRESET']
        } = options;

        // Circuit breaker check
        if (this.circuitOpen) {
            if (Date.now() - this.circuitOpenTime > this.circuitResetTimeout) {
                this.circuitOpen = false;
                this.failureCount = 0;
            } else {
                throw new Error('Circuit breaker open - too many failures');
            }
        }

        let lastError;
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const result = await fn();
                this.failureCount = 0; // Reset on success
                return result;
            } catch (error) {
                lastError = error;
                const errorStr = (error.message || '').toLowerCase();
                
                // Check if error is retryable
                const isRetryable = retryableErrors.some(e => errorStr.includes(e));
                
                if (!isRetryable) {
                    throw error; // Non-retryable, fail fast
                }

                // Exponential backoff with jitter
                const delay = Math.min(
                    baseDelay * Math.pow(2, attempt) + Math.random() * 1000,
                    maxDelay
                );
                
                console.log(`Retry ${attempt + 1}/${maxRetries} in ${delay}ms...`);
                await this.sleep(delay);
            }
        }

        // Track failures for circuit breaker
        this.failureCount++;
        if (this.failureCount >= 5) {
            this.circuitOpen = true;
            this.circuitOpenTime = Date.now();
        }

        throw lastError;
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
```

---

### 4. 🟢 Transaction Deduplication (LOW PRIORITY - ALREADY HANDLED)

**Status**: ✅ Already handled by TON blockchain

The TON blockchain uses `seqno` (sequence number) for standard wallets and `query_id` for Highload wallets to prevent duplicate transactions. Your implementation correctly:
- Gets `seqno` before sending
- Uses unique `query_id` for Highload transactions

---

### 5. 🟢 Optimistic UI Updates (ENHANCEMENT)

**Problem**: Users wait for blockchain confirmation before seeing updates.

**Solution**: Show pending transactions immediately:

```javascript
// Add to state
const pendingTransactions = new Map();

async function sendTransaction(...) {
    const txId = generateTemporaryId();
    
    // Optimistically add to UI
    pendingTransactions.set(txId, {
        status: 'pending',
        amount,
        recipient,
        timestamp: Date.now(),
    });
    updateUI();
    
    try {
        const result = await walletService.sendTransaction(...);
        
        // Update with real hash
        pendingTransactions.set(txId, {
            ...pendingTransactions.get(txId),
            status: 'confirmed',
            hash: result.hash,
        });
        
        // Refresh actual data after delay
        setTimeout(refreshData, 5000);
        
    } catch (error) {
        pendingTransactions.set(txId, {
            ...pendingTransactions.get(txId),
            status: 'failed',
            error: error.message,
        });
    }
    
    updateUI();
}
```

---

## Implementation Priority

| Priority | Task | Effort | Impact |
|----------|------|--------|--------|
| 1 | Add multiple API endpoints with fallback | 2h | 🔴 High |
| 2 | Use QueryIdStore for Highload wallets | 1h | 🟡 Medium |
| 3 | Implement enhanced retry with circuit breaker | 2h | 🟡 Medium |
| 4 | Add request rate limiting | 2h | 🟡 Medium |
| 5 | Implement optimistic UI updates | 3h | 🟢 Enhancement |

---

## Quick Wins (Implement Now)

### 1. Add Additional API Keys to .env
```env
# Multiple providers for redundancy
VITE_TONAPI_KEY=your_tonapi_key
VITE_TONCENTER_API_KEY=your_toncenter_key

# Optional: Get these from respective providers
VITE_TONAPI_KEY_2=backup_tonapi_key
VITE_TONCENTER_API_KEY_2=backup_toncenter_key
```

### 2. Increase Retry Count & Timeout
In `WalletService.js`, change:
```javascript
async withRetry(fn, maxRetries = 5, baseDelay = 1000) {  // Was 3, 2000
```

### 3. Add Request Timeout
```javascript
// In TonApiService constructor
this.timeout = 30000; // 30 seconds

// Add to fetch calls
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), this.timeout);
const response = await fetch(url, { ...options, signal: controller.signal });
clearTimeout(timeout);
```

---

## Conclusion

Your wallet app's client-side architecture naturally prevents user-to-user conflicts. The main optimization areas are:

1. **API reliability** - Add multiple providers and fallback logic
2. **Error resilience** - Better retry logic and circuit breakers
3. **Query ID management** - Use persistent QueryIdStore for Highload wallets
4. **User experience** - Optimistic updates while transactions confirm

Implementing these changes will ensure your wallet can serve a large number of users reliably.
