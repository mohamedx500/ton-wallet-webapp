# TON Universal Wallet

A production-ready, fully client-side decentralized wallet for **The Open Network (TON)**. Built with React, TypeScript, and the official TON SDK, it delivers a modern mobile-first experience with multi-version wallet support, enterprise-grade batch transactions, DEX aggregation, and encrypted key storage — no backend required.

[![Version](https://img.shields.io/badge/version-2.0.0-blue)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)]()
[![React](https://img.shields.io/badge/React-19-61dafb)]()
[![Vite](https://img.shields.io/badge/Vite-5-646cff)]()
[![License](https://img.shields.io/badge/license-MIT-green)]()

---

## Overview

TON Universal Wallet is a browser-based, self-custodial wallet designed as a Telegram-style mini-app. It supports the full lifecycle of TON wallet operations — from mnemonic generation and secure encrypted storage to sending transactions, swapping tokens, and executing enterprise-scale batch payouts. The UI follows a mobile-first card-based design with smooth animations and modern typography.

---

## Features

| Feature                   | Description                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------ |
| **Multi-Wallet Versions** | Supports V3R1, V3R2, V4R2 (recommended), V5R1 (gasless), and Highload V3 (enterprise batch)     |
| **Multi-Send**            | Send to multiple recipients in a single operation with W5 sequential batching or Highload V3 parallel burst mode |
| **Jetton Support**        | USDT, NOT, DOGS, CATI, MAJOR, SCALE, HMSTR, and any TEP-74 compatible token                     |
| **DNS Resolution**        | Resolve `.ton` domain names to wallet addresses directly in send and multi-send flows             |
| **DEX Aggregation**       | Best-rate token swaps across STON.fi (V1 + V2) and DeDust.io with slippage protection            |
| **Secure Storage**        | AES-256-GCM encrypted mnemonic storage with PBKDF2 key derivation                                |
| **Offline Signing**       | Air-gapped transaction signing for cold-storage security                                          |
| **Gasless Transactions**  | V5R1 gasless transaction support via relayer                                                      |
| **Multi-Account**         | Create, import, rename, and switch between multiple wallet accounts                               |
| **Multi-Network**         | Seamless switching between Mainnet and Testnet                                                    |
| **Resilient Networking**  | Circuit breaker, failover, load balancing, and health-check mechanisms                            |
| **Smart Rate Limiting**   | Intelligent API request management to prevent rate-limit errors from blockchain APIs              |
| **Deposit Monitoring**    | Real-time incoming deposit detection with confirmation tracking                                   |
| **CSV Import**            | Import recipient lists from CSV files for bulk multi-send operations                              |
| **Mobile-First UI**       | Responsive card-based layout optimized for mobile with modern fonts and smooth animations         |

---

## Multi-Send

The Multi-Send feature allows dispatching TON or Jetton transfers to many recipients at once. It supports two execution engines:

- **W5 Sequential Batching** — Uses WalletContractV5R1 to send up to 254 messages per batch with seqno-based confirmation polling between batches.
- **Highload V3 Parallel Burst** — Sends independent messages in parallel using unique Query IDs for maximum throughput and partial-failure isolation.

Additional capabilities include per-row address and amount validation, dynamic coin selection, .ton DNS resolution, amount and comment unification across rows, pre-flight balance checks, on-chain transaction validation, and real-time batch progress tracking with per-row status indicators.

---

## Wallet Versions

| Version         | Max Messages | Key Feature              | Use Case                    |
| --------------- | ------------ | ------------------------ | --------------------------- |
| V3R1            | 4            | Basic wallet             | Simple transfers            |
| V3R2            | 4            | Gas efficiency           | Cost-optimized transfers    |
| **V4R2**        | 4            | Plugin support           | **Recommended default**     |
| V5R1            | 4            | Gasless + extensions     | Sponsored transactions      |
| Highload V3     | **254**      | Batch & parallel sending | Enterprise / mass payouts   |

---

## Supported Tokens

| Token  | Decimals | Network           |
| ------ | -------- | ----------------- |
| TON    | 9        | Mainnet / Testnet |
| USDT   | 6        | Mainnet / Testnet |
| NOT    | 9        | Mainnet           |
| DOGS   | 9        | Mainnet           |
| CATI   | 9        | Mainnet           |
| MAJOR  | 9        | Mainnet           |
| HMSTR  | 9        | Mainnet           |
| SCALE  | 9        | Mainnet           |

---

## Security

| Layer           | Mechanism                                              |
| --------------- | ------------------------------------------------------ |
| Key Storage     | AES-256-GCM encryption with PBKDF2 key derivation     |
| Private Keys    | Never persisted — derived from mnemonic on demand      |
| Password        | PBKDF2 hash stored for verification only               |
| Offline Signing | BOC serialization for air-gapped device signing        |
| Rate Limiting   | Token bucket and per-user sliding window enforcement   |

---

## Tech Stack

| Technology       | Purpose                  |
| ---------------- | ------------------------ |
| React 19         | UI framework             |
| TypeScript 5.3   | Type safety              |
| Vite 5           | Build and dev server     |
| TailwindCSS 3.4  | Styling                  |
| Framer Motion 12 | Animations               |
| @ton/ton 16      | TON blockchain SDK       |
| @ton/crypto 3.3  | Cryptographic operations |
| Vitest           | Testing framework        |

---

## Getting Started

1. Install dependencies.
2. Copy `.env.example` to `.env` and add the required API keys (see the example file for instructions).
3. Start the development server or build for production.

---

## License

MIT License

## References

- [@ton/ton SDK](https://github.com/ton-org/ton)
- [Highload Wallet V3](https://github.com/ton-blockchain/highload-wallet-contract-v3)
- [Wallet V5 Spec](https://docs.ton.org/standard/wallets/v5)
- [TonAPI](https://tonapi.io)
- [STON.fi](https://ston.fi)
- [DeDust](https://dedust.io)
