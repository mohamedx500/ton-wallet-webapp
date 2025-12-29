# Universal TON Wallet System

A production-ready, modular TypeScript wallet system for The Open Network (TON). Supports all major wallet versions including enterprise-grade Highload V3 for batch transactions.

## 🌟 Features

- **Multiple Wallet Versions**: V3R1, V3R2, V4R2, V5R1, Highload V3
- **Jetton Support**: USDT, NOT Coin, and any TEP-74 compatible token
- **Batch Transactions**: Up to 254 messages per transaction with Highload V3
- **Secure Storage**: AES-256-GCM encryption for private keys
- **Offline Signing**: Air-gapped transaction signing support
- **Gasless Transactions**: V5R1 gasless transaction support
- **Multi-Network**: Mainnet and Testnet support

## 📁 Project Structure

```
src/
├── types/
│   └── index.ts              # Core type definitions
├── wallets/
│   ├── v3r1/
│   │   ├── V3R1WalletService.ts
│   │   ├── jettons/
│   │   │   ├── JettonService.ts
│   │   │   ├── usdt/
│   │   │   │   └── UsdtService.ts
│   │   │   └── notcoin/
│   │   │       └── NotcoinService.ts
│   │   └── index.ts
│   ├── v3r2/
│   │   ├── V3R2WalletService.ts
│   │   └── index.ts
│   ├── v4r2/
│   │   ├── V4R2WalletService.ts
│   │   └── index.ts
│   ├── v5r1/
│   │   ├── V5R1WalletService.ts
│   │   └── index.ts
│   ├── highload-v3/
│   │   ├── HighloadQueryId.ts    # Composite QueryID iterator
│   │   ├── HighloadWalletV3.ts   # Contract wrapper
│   │   ├── HighloadService.ts    # High-level service
│   │   ├── jettons/
│   │   │   ├── JettonService.ts
│   │   │   └── usdt/
│   │   │       └── UsdtService.ts
│   │   └── index.ts
│   ├── StandardWallet.ts         # Unified standard wallet API
│   └── index.ts
├── network/
│   ├── RpcClient.ts              # TON RPC client
│   ├── TonApiClient.ts           # TonAPI indexer client
│   └── index.ts
├── crypto/
│   ├── MnemonicService.ts        # BIP-39 mnemonic handling
│   ├── EncryptionService.ts      # AES-256-GCM encryption
│   ├── OfflineSigningService.ts  # Offline transaction signing
│   └── index.ts
└── index.ts                      # Main exports

tests/
└── highload-batch-test.ts        # Highload V3 batch test
```

## 🚀 Quick Start

### Installation

```bash
npm install
```

### Basic Usage

```typescript
import { 
    createWallet, 
    generateNewWallet, 
    importWallet 
} from './src';

// Generate a new wallet
const { wallet, mnemonic, tonClient } = await generateNewWallet('v4r2', 'mainnet');
console.log('Address:', wallet.address);
console.log('Mnemonic:', mnemonic.join(' '));

// Import existing wallet
const imported = await importWallet(
    'word1 word2 word3 ... word24',
    'v4r2',
    'mainnet'
);

// Send TON
const result = await imported.service.sendTon(
    imported.tonClient,
    mnemonic,
    'v4r2',
    'UQrecipi3nt...addr3ss',
    1.5, // TON amount
    'Payment for services'
);
```

### Highload V3 Batch Transactions

```typescript
import { 
    HighloadWalletV3Service,
    HighloadQueryId,
    createRpcClient
} from './src';

const rpcClient = createRpcClient('mainnet');
const tonClient = rpcClient.getClient();

const highloadService = new HighloadWalletV3Service('mainnet');
const wallet = await highloadService.createFromMnemonic(mnemonic);

// Send batch of up to 254 transactions
const transactions = [
    { to: 'UQaddr1...', amount: toNano('1'), comment: 'Payment 1' },
    { to: 'UQaddr2...', amount: toNano('2'), comment: 'Payment 2' },
    // ... up to 254 transactions
];

const result = await highloadService.sendBatch(
    tonClient,
    wallet.keyPair,
    transactions
);
```

### USDT Transfers

```typescript
import { HighloadV3UsdtService } from './src/wallets/highload-v3';

const usdtService = new HighloadV3UsdtService('mainnet');

// Single transfer
await usdtService.sendUsdt(
    tonClient,
    wallet.keyPair,
    wallet.address,
    {
        recipientAddress: 'UQrecipi3nt...',
        amount: 100.50, // USDT
        comment: 'USDT payment'
    }
);

// Batch USDT transfers
await usdtService.sendBatchUsdt(
    tonClient,
    wallet.keyPair,
    wallet.address,
    [
        { recipientAddress: 'UQaddr1...', amount: 50.00 },
        { recipientAddress: 'UQaddr2...', amount: 75.00 },
    ]
);
```

## 🔒 Security

### Key Encryption

```typescript
import { EncryptionService } from './src/crypto';

const encryption = new EncryptionService();

// Encrypt mnemonic
const encrypted = await encryption.encrypt(mnemonic, userPassword);

// Decrypt
const decrypted = await encryption.decrypt(encrypted, userPassword);
```

### Offline Signing

```typescript
import { OfflineSigningService } from './src/crypto';

const offlineSigning = new OfflineSigningService();

// Prepare transaction for offline signing
const unsigned = offlineSigning.prepareForSigning(
    { to: 'UQaddr...', amount: toNano('1') },
    wallet.address,
    'v4r2',
    seqno
);

// Sign offline (can be done on air-gapped device)
const signed = offlineSigning.createSignedTransaction(
    unsigned,
    wallet.keyPair.secretKey
);

// Broadcast later
// signed.signedBody contains the BOC to broadcast
```

## ⚡ Highload V3 QueryID

The Highload V3 wallet uses a **composite QueryID** pattern:

```
QueryID = (Shift << 10) + BitNumber
```

- **Shift** (13 bits): 0-8191, represents time window
- **BitNumber** (10 bits): 0-1022, sequence within window

This ensures proper cleanup of the contract's dictionary and prevents replay attacks.

```typescript
import { HighloadQueryId, QueryIdStore } from './src/wallets/highload-v3';

// Manual iteration
const queryId = HighloadQueryId.fromTimestamp();
const next = queryId.getNext();
console.log('QueryID:', next.getQueryId());

// Persistent store (recommended)
const store = new QueryIdStore(walletAddress);
const persistentId = store.getNext(); // Automatically saved
```

## 🧪 Testing

```bash
# Run Highload V3 batch test
npm test

# Type check
npm run type-check
```

## 📚 API Reference

### Wallet Versions

| Version | Type | Max Messages | Features |
|---------|------|--------------|----------|
| V3R1 | Standard | 4 | Basic wallet |
| V3R2 | Standard | 4 | Improved gas efficiency |
| V4R2 | Standard | 4 | Plugin support (recommended) |
| V5R1 | Standard | 4 | Gasless, extensions |
| Highload V3 | Enterprise | 254 | Batch transactions |

### Supported Tokens

| Token | Decimals | Network |
|-------|----------|---------|
| USDT | 6 | Mainnet/Testnet |
| NOT | 9 | Mainnet |

## 📄 License

MIT License

## 🔗 References

- [@ton/ton SDK](https://github.com/ton-org/ton)
- [Highload Wallet V3](https://github.com/ton-blockchain/highload-wallet-contract-v3)
- [Wallet V5 Spec](https://docs.ton.org/standard/wallets/v5)
- [TonAPI](https://tonapi.io)
