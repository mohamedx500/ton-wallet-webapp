# TON Universal Wallet — Final Project Documentation

**Project:** Decentralized Wallet System for The Open Network (TON)  
**Version:** 2.0.0  
**Stack:** React 19 · TypeScript · Vite · TailwindCSS · @ton/ton SDK  
**License:** MIT

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture](#2-architecture)
3. [Technology Stack](#3-technology-stack)
4. [Project Structure](#4-project-structure)
5. [Core Modules](#5-core-modules)
   - [5.1 Wallet Layer](#51-wallet-layer)
   - [5.2 Crypto Layer](#52-crypto-layer)
   - [5.3 Network Layer](#53-network-layer)
   - [5.4 Services Layer](#54-services-layer)
   - [5.5 UI Layer](#55-ui-layer)
6. [Type System](#6-type-system)
7. [Security Architecture](#7-security-architecture)
8. [Fee Configuration](#8-fee-configuration)
9. [DEX Swap Integration](#9-dex-swap-integration)
10. [Configuration & Environment](#10-configuration--environment)
11. [API Reference](#11-api-reference)
12. [Getting Started](#12-getting-started)
13. [Testing](#13-testing)
14. [File Index](#14-file-index)

---

## 1. Project Overview

A **production-ready, modular TypeScript wallet system** for The Open Network (TON). It provides a complete client-side decentralized wallet experience in the browser — from mnemonic generation and encrypted key storage, through multi-version wallet support, to DEX swaps and batch enterprise transactions.

### Key Features

| Feature | Description |
|---|---|
| **Multi-Wallet Versions** | V3R1, V3R2, V4R2 (recommended), V5R1 (gasless), Highload V3 (enterprise) |
| **Jetton Support** | USDT, NOT Coin, DOGS, CATI, MAJOR, SCALE, JETTON, HMSTR — any TEP-74 token |
| **Batch Transactions** | Up to 254 messages per transaction via Highload V3 |
| **Secure Storage** | AES-256-GCM encryption with PBKDF2 key derivation (100k iterations) |
| **Offline Signing** | Air-gapped transaction signing for cold storage |
| **Gasless Transactions** | V5R1 gasless transaction support |
| **DEX Aggregation** | STON.fi (V1 + V2) and DeDust.io with best-rate selection |
| **Multi-Network** | Mainnet and Testnet with seamless switching |
| **Multi-Account** | Create, import, rename, switch, and delete multiple wallet accounts |
| **Resilient Networking** | Circuit breaker, failover, load balancing, health checking |
| **Rate Limiting** | Token bucket algorithm, per-user sliding window, connection pooling |
| **Deposit Monitoring** | Polling-based deposit detection with confirmation tracking |

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     UI Layer (React)                     │
│  LoginScreen · HomeTab · ActivityTab · SettingsTab       │
│  WalletModals · AccountModals · WalletHeader             │
├─────────────────────────────────────────────────────────┤
│                Context Layer (React Context)             │
│           WalletContext · NetworkContext                  │
├──────────┬──────────┬──────────┬────────────────────────┤
│ Services │ Wallets  │ Network  │       Crypto            │
│          │          │          │                          │
│ WalletCore│Standard │Resilient │ MnemonicService         │
│ Service   │Wallet   │RpcClient │ EncryptionService       │
│          │Service   │          │ OfflineSigningService   │
│ Swap     │          │TonApi   │                          │
│ Service   │Highload │Client    │                          │
│          │V3Service │          │                          │
│ Jetton   │          │RpcClient │                          │
│ Service   │V3R1/R2  │          │                          │
│          │V4R2/V5R1│          │                          │
│ State    │          │          │                          │
│ Manager  │          │          │                          │
│          │          │          │                          │
│Concurrency│         │          │                          │
│Manager   │          │          │                          │
│          │          │          │                          │
│ Deposit  │          │          │                          │
│ Monitor  │          │          │                          │
│          │          │          │                          │
│ Queue    │          │          │                          │
│ Manager  │          │          │                          │
├──────────┴──────────┴──────────┴────────────────────────┤
│           Types Layer (src/types/index.ts)               │
├─────────────────────────────────────────────────────────┤
│           Config Layer (fees.ts · knownTokens.ts)        │
└─────────────────────────────────────────────────────────┘
```

### Design Principles

- **Singleton Pattern** — All services use singletons for consistent state
- **Factory Functions** — `createWallet()`, `generateNewWallet()`, `importWallet()` for convenience
- **Dependency Injection** — Services accept configuration objects
- **Multi-Layer Caching** — L1 (in-memory LRU) + L2 (LocalStorage)
- **Overpay & Refund** — Transactions attach more TON than needed; contracts refund excess

---

## 3. Technology Stack

| Category | Technology | Purpose |
|---|---|---|
| **Frontend** | React 19 | UI framework |
| **Language** | TypeScript (ES2022) | Type-safe development |
| **Bundler** | Vite 5 | Dev server & build |
| **Styling** | TailwindCSS 3.4 | Utility-first CSS |
| **Animations** | Framer Motion 12 | UI animations |
| **Icons** | Lucide React | Icon library |
| **Blockchain** | @ton/ton 16, @ton/core 0.63, @ton/crypto 3.3 | TON SDK |
| **Testing** | Vitest | Unit testing |
| **Node Polyfills** | vite-plugin-node-polyfills | Buffer/Process in browser |

---

## 4. Project Structure

```
wallet-app/
├── src/
│   ├── index.ts                  # Main entry — exports & factory functions
│   ├── main.tsx                  # React entry point
│   ├── App.tsx                   # Root component (462 lines)
│   ├── index.css                 # Global styles
│   ├── types/
│   │   └── index.ts              # 354 lines — all shared TypeScript types
│   ├── wallets/
│   │   ├── StandardWallet.ts     # Unified standard wallet API
│   │   ├── WalletManager.js      # Wallet management utilities
│   │   ├── v3r1/                 # V3R1 wallet + jetton services
│   │   ├── v3r2/                 # V3R2 wallet service
│   │   ├── v4r2/                 # V4R2 wallet service
│   │   ├── v5r1/                 # V5R1 wallet service (gasless)
│   │   ├── highload-v3/          # Highload V3 (batch transactions)
│   │   │   ├── HighloadQueryId.ts
│   │   │   ├── HighloadWalletV3.ts
│   │   │   ├── HighloadService.ts
│   │   │   └── jettons/
│   │   └── index.ts
│   ├── network/
│   │   ├── RpcClient.ts          # Basic TON RPC client
│   │   ├── ResilientRpcClient.ts # 662 lines — circuit breaker + failover
│   │   ├── TonApiClient.ts       # TonAPI indexer client
│   │   └── index.ts
│   ├── crypto/
│   │   ├── MnemonicService.ts    # BIP-39 mnemonic handling
│   │   ├── EncryptionService.ts  # AES-256-GCM encryption
│   │   ├── OfflineSigningService.ts # Air-gapped signing
│   │   └── index.ts
│   ├── services/
│   │   ├── WalletCoreService.ts  # 680 lines — unified interface
│   │   ├── WalletService.js      # 948 lines — wallet ops
│   │   ├── SwapService.ts        # 1229 lines — DEX aggregation
│   │   ├── ConcurrencyManager.ts # 754 lines — rate limiting + pooling
│   │   ├── WalletStateManager.ts # 745 lines — caching + state
│   │   ├── DepositMonitoringService.ts # 579 lines
│   │   ├── ProductionJettonService.ts  # 684 lines
│   │   ├── AccountManager.ts     # Multi-account management
│   │   ├── TransactionTracker.js # Transaction tracking
│   │   ├── ErrorHandler.js       # Error categorization
│   │   ├── MetricsService.js     # Metrics collection
│   │   ├── NetworkService.js     # Network status
│   │   ├── SecurityService.js    # Security utilities
│   │   ├── TonApiService.js      # TonAPI integration
│   │   ├── TokenDiscoveryService.ts # Token discovery
│   │   ├── ChangellyService.js   # Buy/Fiat integration
│   │   ├── ApiRequestManager.js  # API request management
│   │   └── queue/
│   │       └── TransactionQueueManager.ts
│   ├── components/
│   │   ├── LoginScreen.tsx       # Authentication UI
│   │   ├── HomeTab.tsx           # Balance & quick actions
│   │   ├── ActivityTab.tsx       # Transaction history
│   │   ├── SettingsTab.tsx       # Settings management
│   │   ├── WalletModals.tsx      # Send/Receive/Swap modals
│   │   ├── AccountModals.tsx     # Account management UI
│   │   ├── WalletHeader.tsx      # Header with address
│   │   ├── BottomNavigation.tsx  # Tab navigation
│   │   ├── NetworkBanner.tsx     # Network status banner
│   │   ├── effects/              # Animated effects
│   │   └── ui/                   # Reusable UI primitives
│   ├── context/
│   │   ├── WalletContext.tsx     # 632 lines — global wallet state
│   │   └── NetworkContext.tsx    # Network state
│   ├── config/
│   │   ├── fees.ts               # Transaction fee constants
│   │   └── knownTokens.ts       # Known token registry
│   ├── handlers/                 # Event handlers
│   ├── state/                    # Application state
│   ├── utils/                    # Utility functions
│   └── ui/                       # UI utilities
├── tests/
│   └── highload-batch-test.ts    # Highload V3 batch test
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.js
└── .env.example
```

---

## 5. Core Modules

### 5.1 Wallet Layer

The wallet layer implements a **Strategy pattern** — a unified `StandardWalletService` delegates to version-specific implementations.

#### Supported Wallet Versions

| Version | Class | Max Messages | Special Features |
|---|---|---|---|
| **V3R1** | `V3R1WalletService` | 4 | Basic wallet, jetton support |
| **V3R2** | `V3R2WalletService` | 4 | Improved gas efficiency |
| **V4R2** | `V4R2WalletService` | 4 | Plugin support *(recommended)* |
| **V5R1** | `V5R1WalletService` | 4 | Gasless transactions, extensions |
| **Highload V3** | `HighloadWalletV3Service` | 254 | Enterprise batch transactions |

#### StandardWalletService

Unified API for V3R1/V3R2/V4R2/V5R1:

```typescript
const service = new StandardWalletService('mainnet');
const wallet = await service.createFromMnemonic(mnemonic, 'v4r2');
const allAddresses = await service.getAllAddresses(mnemonic);
const result = await service.sendTon(client, mnemonic, 'v4r2', recipientAddr, 1.5);
```

#### Highload V3 — Batch Transactions

The Highload V3 wallet uses a **composite QueryID** system for batch transaction management:

```
QueryID = (Shift << 10) + BitNumber
```

- **Shift** (13 bits): 0–8191, represents time window
- **BitNumber** (10 bits): 0–1022, sequence within window

Key classes:
- `HighloadQueryId` — composite QueryID iterator
- `QueryIdStore` — persistent QueryID storage
- `HighloadWalletV3` — contract wrapper
- `HighloadWalletV3Service` — high-level service

```typescript
const highloadService = new HighloadWalletV3Service('mainnet');
const wallet = await highloadService.createFromMnemonic(mnemonic);

// Batch of up to 254 transactions
const result = await highloadService.sendBatch(tonClient, wallet.keyPair, [
    { to: 'UQaddr1...', amount: toNano('1'), comment: 'Payment 1' },
    { to: 'UQaddr2...', amount: toNano('2'), comment: 'Payment 2' },
]);
```

---

### 5.2 Crypto Layer

Three services handle all cryptographic operations:

#### MnemonicService
- Generate 12/24-word BIP-39 mnemonics via `@ton/crypto`
- Validate, parse, and format mnemonic phrases
- Derive key pairs from mnemonics

#### EncryptionService
- **AES-256-GCM** encryption via Web Crypto API
- **PBKDF2** key derivation (100,000 iterations, SHA-256)
- Random 16-byte salt, 96-bit IV
- Password hashing and verification

```typescript
const encryption = new EncryptionService();
const encrypted = await encryption.encrypt(mnemonic, password);
const decrypted = await encryption.decrypt(encrypted, password);
```

#### OfflineSigningService
- Create unsigned transaction bodies per wallet version
- Sign transactions offline (air-gapped)
- BOC serialization for broadcast

```typescript
const offline = new OfflineSigningService();
const unsigned = offline.prepareForSigning(params, walletAddr, 'v4r2', seqno);
const signed = offline.createSignedTransaction(unsigned, secretKey);
```

---

### 5.3 Network Layer

#### RpcClient
Basic TON RPC client with network-aware endpoint configuration.

#### ResilientRpcClient (662 lines)
Production-grade client with:

| Feature | Implementation |
|---|---|
| **Failover** | Multiple endpoints, auto-switch on failure |
| **Circuit Breaker** | 3 states: closed → open → half-open |
| **Load Balancing** | Weighted round-robin based on latency |
| **Health Checking** | Every 30 seconds per endpoint |
| **Retry Logic** | Exponential backoff with configurable max retries |
| **Metrics** | Total/successful/failed requests, average latency |

Default endpoints per network:
- **Mainnet**: `toncenter.com`, `tonapi.io`
- **Testnet**: `testnet.toncenter.com`, `testnet.tonapi.io`

#### TonApiClient
TonAPI indexer client for balance queries, transaction history, and jetton lookups.

---

### 5.4 Services Layer

#### WalletCoreService — Unified Interface (680 lines)

The **main entry point** integrating all subsystems:

```typescript
const wallet = getWalletCoreService('mainnet');
await wallet.initialize();

const txId = await wallet.sendTon({ fromAddress, toAddress, amount, comment, priority: 'high' });
const txId2 = await wallet.sendJetton({ fromAddress, toAddress, jettonAddress, amount, decimals });
const balance = await wallet.getFullBalance(address);
const status = wallet.getStatus();
```

Integrates: `TransactionQueueManager`, `ResilientRpcClient`, `ConcurrencyManager`, `WalletStateManager`, `DepositMonitoringService`, `ProductionJettonService`.

#### TransactionQueueManager
- Priority-based queue (high, normal, low)
- In-memory distributed locking (prevents seqno collisions)
- Exponential backoff retry (1s → 2s → 4s)
- Status tracking: `queued → processing → sent → confirming → confirmed/failed`
- Configurable concurrency limit (default: 10)
- 10-minute transaction expiration

#### ConcurrencyManager (754 lines)
- **Token Bucket Rate Limiter** — capacity: 100, fill rate: 10/s
- **Per-User Sliding Window** — 60 requests/minute
- **Connection Pool** — configurable min/max sizes, idle timeout
- **Adaptive Backoff** — exponential with configurable multiplier

#### WalletStateManager (745 lines)
- **LRU Cache** — 1000 items max
- **Balance Cache** — 30-second TTL
- **Jetton Balance Cache** — 60-second TTL
- **Transaction History** — indexed by address
- **LocalStorage Persistence** — survives page reloads
- **Event Subscriptions** — balance change notifications

#### ProductionJettonService (684 lines)
- Pre-transfer validation (address, balance, gas)
- Jetton wallet existence verification
- Metadata caching (1-hour TTL)
- Transfer confirmation tracking
- Known jettons database (USDT, NOT, SCALE, DOGS)

#### DepositMonitoringService (579 lines)
- Polling-based detection (5-second interval)
- 3 confirmations required
- Event-driven notifications (`onDepositDetected`, `onDepositConfirmed`, `onMonitorError`)
- Multi-address monitoring
- Transaction deduplication
- Jetton deposit support

#### AccountManager
Multi-account management with:
- UUID-based account identification
- LocalStorage persistence
- Legacy wallet migration
- CRUD operations (add, rename, delete, select)

#### SwapService — see [Section 9](#9-dex-swap-integration)

---

### 5.5 UI Layer

Built with **React 19** + **TailwindCSS** + **Framer Motion**:

| Component | Purpose |
|---|---|
| `LoginScreen` | Create/Import wallet, password setup |
| `HomeTab` | Balance display, quick send/receive |
| `ActivityTab` | Transaction history with filtering |
| `SettingsTab` | Network, wallet type, security settings |
| `WalletModals` | Send, Receive, Swap, Buy modals |
| `AccountModals` | Multi-account management UI |
| `WalletHeader` | Address display with copy |
| `BottomNavigation` | Tab switching |
| `NetworkBanner` | Network connectivity status |

#### Reusable UI Primitives (`components/ui/`)
`Button`, `Card`, `Dialog`, `Input`, `Switch`

#### Visual Effects (`components/effects/`)
`AnimatedCounter`, `Animations`, `BackgroundGradient`, `GlowingCard`

#### State Management
- `WalletContext` — Global wallet state (authentication, balance, transactions, tokens, multi-account)
- `NetworkContext` — Network selection and connectivity

---

## 6. Type System

All types defined in `src/types/index.ts` (354 lines):

### Wallet Types
- `WalletVersion` = `'v3r1' | 'v3r2' | 'v4r2' | 'v5r1' | 'highload-v3'`
- `NetworkType` = `'mainnet' | 'testnet'`
- `KeyPair` = `{ publicKey: Buffer; secretKey: Buffer }`
- `WalletConfig`, `WalletInfo`, `BalanceInfo`

### Transaction Types
- `TransactionDirection` = `'incoming' | 'outgoing'`
- `TransactionStatus` = `'pending' | 'confirmed' | 'failed'`
- `TransactionParams`, `JettonTransferParams`, `BatchTransaction`
- `TransactionResult`, `TransactionHistoryItem`

### Jetton Types
- `JettonInfo` — token metadata
- `JettonBalance` — balance with USD value

### Highload Types
- `QueryIdState` — shift/bitNumber composite
- `HighloadBatchOptions`, `HighloadExternalMessageOptions`

### Security Types
- `EncryptedData` = `{ iv, data, salt, version }`
- `SecurityConfig` = `{ iterations, saltBytes, algorithm, keyLength }`

### UI/State Types
- `AppSettings`, `AppState`

### Constants
- `DEFAULT_CONFIG` — subwallet IDs, timeouts, retry settings
- `JETTON_OP_CODES` — transfer (0xf8a7ea5), burn, notification
- `HIGHLOAD_CONSTANTS` — max 254 actions, QueryID limits
- `TON_CONSTANTS` — workchain 0, nano factor

---

## 7. Security Architecture

| Layer | Mechanism | Details |
|---|---|---|
| **Key Storage** | AES-256-GCM | Mnemonic encrypted with user password |
| **Key Derivation** | PBKDF2 | 100,000 iterations, SHA-256, 16-byte salt |
| **Password Verification** | PBKDF2 hash | Stored hash compared on unlock |
| **Private Keys** | Never persisted | Derived from mnemonic on demand |
| **Offline Signing** | BOC serialization | Sign on air-gapped device, broadcast later |
| **DevTools Guard** | `devtoolsGuard.ts` | Protection against browser dev tools |
| **Rate Limiting** | Token bucket + per-user | Prevents API abuse |

### Encryption Flow
```
Password → PBKDF2 (100k iterations, salt) → AES-256-GCM key
Mnemonic → AES-GCM encrypt with IV → { iv, data, salt, version }
```

---

## 8. Fee Configuration

All fees use the **"Overpay & Refund"** pattern — transactions attach excess TON, and smart contracts return unused gas via `Op::Excesses (0xd53276db)`.

| Operation | Fee (TON) | Notes |
|---|---|---|
| Jetton Transfer | 0.05 | Standard + safety margin |
| Jetton Forward Amount | 0.01 | Transfer notification to recipient |
| TON → Jetton Swap | 0.25 | STON.fi |
| Jetton → TON Swap | 0.30 | Extra for jetton wallet interaction |
| Jetton → Jetton Swap | 0.35 | Two jetton wallets involved |
| DeDust TON Swap | 0.30 | Vault architecture overhead |
| DeDust Jetton Swap | 0.35 | Vault architecture overhead |
| Highload Jetton | 0.06 | Higher for Highload message structure |
| Highload Swap | 0.30 | Highload V3 specific |

---

## 9. DEX Swap Integration

The `SwapService` (1229 lines) is a **DEX aggregator** supporting:

### Supported DEXes

| DEX | Protocol | Router | Fee |
|---|---|---|---|
| **STON.fi** | V1 + V2 (priority) | `EQB3nc...` / `EQC_O...` | 0.3% |
| **DeDust** | Fallback | Factory-based | 0.3% |

### Supported Tokens
TON, USDT, NOT, DOGS, CATI, MAJOR, JETTON, HMSTR

### Swap Flow
1. **Get Quote** — Fetch quotes from both DEXes in parallel
2. **Best Rate Selection** — Compare output amounts
3. **Slippage Protection** — Default 1%, configurable
4. **Build Transaction** — Construct swap Cell payload
5. **Execute** — Send via wallet service
6. **Refund** — Excess gas returned automatically

### Swap Types
- TON → Jetton
- Jetton → TON
- Jetton → Jetton (most complex, two wallets)

---

## 10. Configuration & Environment

### Environment Variables (`.env`)

| Variable | Required | Description |
|---|---|---|
| `VITE_TONAPI_KEY` | Yes | TonAPI key from [tonconsole.com](https://tonconsole.com) |
| `VITE_TONCENTER_API_KEY` | Yes | Toncenter key from @tonapibot on Telegram |
| `VITE_TONAPI_KEY_2` | No | Backup TonAPI key for load balancing |
| `VITE_TONCENTER_API_KEY_2` | No | Backup Toncenter key for load balancing |
| `VITE_CHANGELLY_PUBLIC_KEY` | No | Changelly fiat on-ramp |
| `VITE_CHANGELLY_PRIVATE_KEY` | No | Changelly fiat on-ramp |

### TypeScript Configuration
- Target: **ES2022**
- Module: **ESNext** with bundler resolution
- Strict mode enabled
- Path aliases: `@/*`, `@wallets/*`, `@services/*`, `@network/*`, `@crypto/*`, `@types/*`

### Vite Configuration
- React plugin with fast refresh
- Node polyfills (Buffer, process, util, stream)
- Console/debugger drops in production
- Relative base path (`./`)

---

## 11. API Reference

### Factory Functions (Main Entry)

```typescript
// Generate a brand-new wallet
const { wallet, mnemonic, service, tonClient } = await generateNewWallet('v4r2', 'mainnet');

// Import from existing mnemonic
const setup = await importWallet('word1 word2 ... word24', 'v4r2', 'mainnet');

// Create wallet from mnemonic array
const setup = await createWallet(mnemonicArray, 'highload-v3', 'mainnet');
```

### WalletCoreService API

| Method | Description |
|---|---|
| `initialize()` | Start all subsystems |
| `shutdown()` | Stop all subsystems |
| `sendTon(params)` | Send TON with queuing |
| `sendJetton(params)` | Send jettons with validation |
| `getBalance(address)` | Get TON balance |
| `getFullBalance(address)` | Get TON + jetton balances |
| `getTransactionStatus(txId)` | Check transaction status |
| `getTransactionHistory(address)` | Paginated history |
| `cancelTransaction(txId)` | Cancel pending transaction |
| `startDepositMonitoring(address)` | Monitor for deposits |
| `onDeposit(callback)` | Subscribe to deposit events |
| `onTransactionChange(callback)` | Subscribe to tx updates |
| `getStatus()` | System health report |

### WalletContext (React)

| Property/Method | Description |
|---|---|
| `isLoggedIn` | Authentication state |
| `walletAddress` | Current active address |
| `balance` | TON balance string |
| `tokens` | Jetton balances array |
| `transactions` | Transaction history |
| `createWallet(password)` | Create new wallet |
| `importWallet(mnemonic, password)` | Import existing wallet |
| `unlockWallet(password)` | Unlock encrypted wallet |
| `sendTransaction(to, amount, password)` | Send transaction |
| `switchWalletType(type, password)` | Change wallet version |
| `selectAccount(id)` | Switch active account |
| `addAccount(name, mnemonic, password)` | Add new account |

---

## 12. Getting Started

### Prerequisites
- Node.js ≥ 18
- npm

### Installation
```bash
npm install
```

### Environment Setup
```bash
cp .env.example .env
# Edit .env with your API keys
```

### Development
```bash
npm run dev      # Start Vite dev server
```

### Build
```bash
npm run build    # TypeScript check + Vite production build
```

### Type Checking
```bash
npm run type-check   # tsc --noEmit
```

---

## 13. Testing

```bash
npm test           # Run Vitest suite
npm run test:watch # Watch mode
```

Test file: `tests/highload-batch-test.ts` — validates Highload V3 batch transaction functionality.

---

## 14. File Index

### Source Files — Total: ~90 files

| File | Lines | Purpose |
|---|---|---|
| `src/App.tsx` | 462 | Main application component |
| `src/index.ts` | 186 | Exports & factory functions |
| `src/types/index.ts` | 354 | All TypeScript type definitions |
| `src/wallets/StandardWallet.ts` | 194 | Unified standard wallet API |
| `src/wallets/WalletManager.js` | 12K | Wallet management utilities |
| `src/wallets/highload-v3/HighloadService.ts` | 13K | Highload V3 service |
| `src/wallets/highload-v3/HighloadQueryId.ts` | 6.6K | Composite QueryID system |
| `src/wallets/highload-v3/HighloadWalletV3.ts` | 7.9K | Contract wrapper |
| `src/wallets/v3r1/V3R1WalletService.ts` | 6.9K | V3R1 implementation |
| `src/network/ResilientRpcClient.ts` | 662 | Circuit breaker + failover |
| `src/network/RpcClient.ts` | 5.4K | Basic RPC client |
| `src/network/TonApiClient.ts` | 10K | TonAPI indexer client |
| `src/crypto/EncryptionService.ts` | 184 | AES-256-GCM encryption |
| `src/crypto/MnemonicService.ts` | 94 | BIP-39 mnemonic handling |
| `src/crypto/OfflineSigningService.ts` | 216 | Offline signing |
| `src/services/WalletCoreService.ts` | 680 | Unified service interface |
| `src/services/WalletService.js` | 948 | Core wallet operations |
| `src/services/SwapService.ts` | 1229 | DEX aggregator |
| `src/services/ConcurrencyManager.ts` | 754 | Rate limiting + pooling |
| `src/services/WalletStateManager.ts` | 745 | State management + caching |
| `src/services/DepositMonitoringService.ts` | 579 | Deposit detection |
| `src/services/ProductionJettonService.ts` | 684 | Jetton operations |
| `src/services/AccountManager.ts` | 100 | Multi-account management |
| `src/services/queue/TransactionQueueManager.ts` | — | Priority queue |
| `src/services/ErrorHandler.js` | 12K | Error categorization |
| `src/services/MetricsService.js` | 9.5K | Metrics collection |
| `src/services/NetworkService.js` | 12K | Network status |
| `src/services/TonApiService.js` | 18K | TonAPI integration |
| `src/services/TokenDiscoveryService.ts` | 9.8K | Token discovery |
| `src/services/SwapService.ts` | 48K | DEX aggregation |
| `src/services/ChangellyService.js` | 8.5K | Fiat on-ramp |
| `src/context/WalletContext.tsx` | 632 | Global wallet state |
| `src/context/NetworkContext.tsx` | 3.7K | Network state |
| `src/components/LoginScreen.tsx` | 18K | Auth UI |
| `src/components/WalletModals.tsx` | 113K | All wallet modals |
| `src/components/HomeTab.tsx` | 5.8K | Home screen |
| `src/components/ActivityTab.tsx` | 13K | Transaction history |
| `src/components/SettingsTab.tsx` | 7.4K | Settings |
| `src/config/fees.ts` | 164 | Fee constants |
| `src/config/knownTokens.ts` | 4.9K | Token registry |

---

> **Generated:** March 4, 2026  
> **Total Source Lines:** ~12,000+ (TypeScript/JavaScript)  
> **Architecture:** Client-side decentralized — no backend server required
