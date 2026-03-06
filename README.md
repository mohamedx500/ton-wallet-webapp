# 🪙 TON Universal Wallet

A production-ready, modular TypeScript wallet system for **The Open Network (TON)**. Full client-side decentralized wallet with multi-version support, DEX aggregation, enterprise batch transactions, and encrypted key storage — no backend required.

[![Version](https://img.shields.io/badge/version-2.0.0-blue)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)]()
[![React](https://img.shields.io/badge/React-19-61dafb)]()
[![Vite](https://img.shields.io/badge/Vite-5-646cff)]()
[![License](https://img.shields.io/badge/license-MIT-green)]()

---

## ✨ Features

| Feature                   | Description                                                                    |
| ------------------------- | ------------------------------------------------------------------------------ |
| **Multi-Wallet Versions** | V3R1, V3R2, V4R2 *(recommended)*, V5R1 *(gasless)*, Highload V3 *(enterprise)* |
| **Jetton Support**        | USDT, NOT, DOGS, CATI, MAJOR, SCALE, HMSTR — any TEP-74 token                  |
| **Batch Transactions**    | Up to 254 messages per transaction via Highload V3                             |
| **DEX Aggregation**       | STON.fi (V1 + V2) and DeDust.io with best-rate selection                       |
| **Secure Storage**        | AES-256-GCM encryption, PBKDF2 (100k iterations)                               |
| **Offline Signing**       | Air-gapped transaction signing for cold storage                                |
| **Gasless Transactions**  | V5R1 gasless support with relayer                                              |
| **Multi-Account**         | Create, import, rename, and switch between wallets                             |
| **Multi-Network**         | Mainnet / Testnet with seamless switching                                      |
| **Resilient Networking**  | Circuit breaker, failover, load balancing, health checks                       |
| **Rate Limiting**         | Token bucket + per-user sliding window + connection pooling                    |
| **Deposit Monitoring**    | Real-time deposit detection with confirmation tracking                         |
| **Token Swaps**           | Best-rate DEX aggregation with slippage protection                             |

---

## 📁 Project Structure

```
src/
├── index.ts                       # Main exports & factory functions
├── App.tsx                        # Root React component
├── types/index.ts                 # Core TypeScript types & constants
│
├── wallets/                       # Wallet implementations
│   ├── StandardWallet.ts          # Unified API (V3R1/V3R2/V4R2/V5R1)
│   ├── v3r1/                      # V3R1 + jetton services (USDT, NOT)
│   ├── v3r2/                      # V3R2 wallet
│   ├── v4r2/                      # V4R2 wallet (recommended)
│   ├── v5r1/                      # V5R1 wallet (gasless)
│   └── highload-v3/               # Enterprise batch wallet
│       ├── HighloadQueryId.ts     # Composite QueryID iterator
│       ├── HighloadWalletV3.ts    # Contract wrapper
│       ├── HighloadService.ts     # High-level service
│       └── jettons/               # Highload jetton support
│
├── network/                       # Network layer
│   ├── RpcClient.ts               # Basic TON RPC client
│   ├── ResilientRpcClient.ts      # Circuit breaker + failover + load balancing
│   └── TonApiClient.ts            # TonAPI indexer client
│
├── crypto/                        # Cryptographic services
│   ├── MnemonicService.ts         # BIP-39 mnemonic generation
│   ├── EncryptionService.ts       # AES-256-GCM encryption
│   └── OfflineSigningService.ts   # Air-gapped transaction signing
│
├── services/                      # Business logic
│   ├── WalletCoreService.ts       # Unified interface (main entry point)
│   ├── WalletService.js           # Core wallet operations
│   ├── SwapService.ts             # DEX aggregator (STON.fi + DeDust)
│   ├── ConcurrencyManager.ts      # Rate limiting + connection pooling
│   ├── WalletStateManager.ts      # Multi-layer caching + state
│   ├── DepositMonitoringService.ts # Deposit detection
│   ├── ProductionJettonService.ts # Jetton validation & transfers
│   ├── AccountManager.ts          # Multi-account management
│   ├── queue/TransactionQueueManager.ts # Priority transaction queue
│   └── ...                        # Error handling, metrics, etc.
│
├── components/                    # React UI components
│   ├── LoginScreen.tsx            # Wallet creation & import
│   ├── HomeTab.tsx                # Balance & quick actions
│   ├── ActivityTab.tsx            # Transaction history
│   ├── SettingsTab.tsx            # Settings management
│   ├── WalletModals.tsx           # Send / Receive / Swap / Buy
│   ├── AccountModals.tsx          # Multi-account UI
│   ├── effects/                   # Animations & visual effects
│   └── ui/                        # Button, Card, Dialog, Input, Switch
│
├── context/                       # React Context providers
│   ├── WalletContext.tsx           # Global wallet state
│   └── NetworkContext.tsx          # Network state
│
└── config/                        # Configuration
    ├── fees.ts                    # Transaction fee constants
    └── knownTokens.ts             # Token registry
```

---

## 🚀 Quick Start

### Installation

```bash
npm install
```

### Environment Setup

```bash
cp .env.example .env
# Add your API keys (see .env.example for instructions)
```

### Development

```bash
npm run dev        # Start Vite dev server
```

### Build

```bash
npm run build      # TypeScript check + production build
```

---

## 💡 Usage Examples

### Generate a New Wallet

```typescript
import { generateNewWallet } from './src';

const { wallet, mnemonic, tonClient } = await generateNewWallet('v4r2', 'mainnet');
console.log('Address:', wallet.address);
console.log('Mnemonic:', mnemonic.join(' '));
```

### Import Existing Wallet

```typescript
import { importWallet } from './src';

const { wallet, service, tonClient } = await importWallet(
    'word1 word2 word3 ... word24',
    'v4r2',
    'mainnet'
);
```

### Send TON

```typescript
const result = await service.sendTon(
    tonClient, mnemonic, 'v4r2',
    'UQrecipi3nt...addr3ss',
    1.5,
    'Payment for services'
);
```

### Highload V3 — Batch Transactions (up to 254)

```typescript
import { HighloadWalletV3Service } from './src/wallets/highload-v3';
import { toNano } from '@ton/core';

const highloadService = new HighloadWalletV3Service('mainnet');
const wallet = await highloadService.createFromMnemonic(mnemonic);

const result = await highloadService.sendBatch(tonClient, wallet.keyPair, [
    { to: 'UQaddr1...', amount: toNano('1'), comment: 'Payment 1' },
    { to: 'UQaddr2...', amount: toNano('2'), comment: 'Payment 2' },
    // ... up to 254 transactions
]);
```

### USDT Transfer

```typescript
import { HighloadV3UsdtService } from './src/wallets/highload-v3';

const usdtService = new HighloadV3UsdtService('mainnet');

// Single transfer
await usdtService.sendUsdt(tonClient, wallet.keyPair, wallet.address, {
    recipientAddress: 'UQrecipi3nt...',
    amount: 100.50,
    comment: 'USDT payment'
});

// Batch USDT transfers
await usdtService.sendBatchUsdt(tonClient, wallet.keyPair, wallet.address, [
    { recipientAddress: 'UQaddr1...', amount: 50.00 },
    { recipientAddress: 'UQaddr2...', amount: 75.00 },
]);
```

### Production Wallet Service

```typescript
import { getWalletCoreService } from './src/services';

const wallet = getWalletCoreService('mainnet');
await wallet.initialize();

// Send with queue management & rate limiting
const txId = await wallet.sendTon({
    fromAddress: 'EQ...', toAddress: 'EQ...',
    amount: '1.5', comment: 'Payment', priority: 'high',
});

// Track transactions
wallet.onTransactionChange((tx) => {
    console.log(`${tx.id}: ${tx.status}`);
});

// Monitor deposits
wallet.startDepositMonitoring('EQ...');
wallet.onDeposit((deposit) => {
    console.log(`Received ${deposit.amount} from ${deposit.fromAddress}`);
});

// Health check
const status = wallet.getStatus();
// { network, isReady, queueStats, rpcHealth, depositMonitor }
```

### Encryption & Offline Signing

```typescript
import { EncryptionService, OfflineSigningService } from './src/crypto';

// Encrypt mnemonic
const encryption = new EncryptionService();
const encrypted = await encryption.encrypt(mnemonic, password);
const decrypted = await encryption.decrypt(encrypted, password);

// Sign offline (air-gapped device)
const offline = new OfflineSigningService();
const unsigned = offline.prepareForSigning(params, walletAddr, 'v4r2', seqno);
const signed = offline.createSignedTransaction(unsigned, secretKey);
// signed.signedBody → ready to broadcast
```

---

## 🔒 Security

| Layer           | Mechanism                                          |
| --------------- | -------------------------------------------------- |
| Key Storage     | AES-256-GCM with PBKDF2 (100k iterations, SHA-256) |
| Private Keys    | Never persisted — derived from mnemonic on demand  |
| Password        | PBKDF2 hash stored for verification                |
| Offline Signing | BOC serialization for air-gapped devices           |
| Rate Limiting   | Token bucket + per-user sliding window             |

---

## ⚡ Wallet Versions

| Version     | Max Messages | Key Feature          | Use Case                  |
| ----------- | ------------ | -------------------- | ------------------------- |
| V3R1        | 4            | Basic wallet         | Simple transfers          |
| V3R2        | 4            | Gas efficiency       | Cost-optimized            |
| **V4R2**    | 4            | Plugin support       | **Recommended default**   |
| V5R1        | 4            | Gasless + extensions | Sponsored transactions    |
| Highload V3 | **254**      | Batch transactions   | Enterprise / mass payouts |

---

## 🔄 Supported Tokens

| Token  | Decimals | Network           |
| ------ | -------- | ----------------- |
| USDT   | 6        | Mainnet / Testnet |
| NOT    | 9        | Mainnet           |
| DOGS   | 9        | Mainnet           |
| CATI   | 9        | Mainnet           |
| MAJOR  | 9        | Mainnet           |
| HMSTR  | 9        | Mainnet           |
| SCALE  | 9        | Mainnet           |
| JETTON | 9        | Mainnet           |

---

## 🧪 Testing

```bash
npm test             # Run all tests
npm run test:watch   # Watch mode
npm run type-check   # TypeScript validation
```

---

## 🛠 Tech Stack

| Technology       | Purpose                  |
| ---------------- | ------------------------ |
| React 19         | UI framework             |
| TypeScript 5.3   | Type safety              |
| Vite 5           | Build & dev server       |
| TailwindCSS 3.4  | Styling                  |
| Framer Motion 12 | Animations               |
| @ton/ton 16      | TON blockchain SDK       |
| @ton/crypto 3.3  | Cryptographic operations |
| Vitest           | Testing framework        |

---

## 📄 License

MIT License

## 🔗 References

- [@ton/ton SDK](https://github.com/ton-org/ton)
- [Highload Wallet V3](https://github.com/ton-blockchain/highload-wallet-contract-v3)
- [Wallet V5 Spec](https://docs.ton.org/standard/wallets/v5)
- [TonAPI](https://tonapi.io)
- [STON.fi](https://ston.fi)
- [DeDust](https://dedust.io)
