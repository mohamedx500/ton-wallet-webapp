/**
 * Wallets Module Exports
 * 
 * Main entry point for all wallet services.
 */

// Standard Wallet (unified interface)
export { StandardWalletService, createStandardWalletService } from './StandardWallet';
export type { StandardWalletVersion } from './StandardWallet';

// V3R1
export { V3R1WalletService, V3R1JettonService, V3R1UsdtService, V3R1NotcoinService } from './v3r1';
export { USDT_MASTER_ADDRESS, NOTCOIN_MASTER_ADDRESS } from './v3r1';

// V3R2
export { V3R2WalletService, V3R2JettonService, V3R2UsdtService, V3R2NotcoinService } from './v3r2';

// V4R2
export { V4R2WalletService, V4R2JettonService, V4R2UsdtService, V4R2NotcoinService } from './v4r2';

// V5R1
export { V5R1WalletService, V5R1JettonService, V5R1UsdtService, V5R1NotcoinService } from './v5r1';

// Highload V3
export {
    HighloadQueryId,
    QueryIdStore,
    HighloadWalletV3,
    highloadWalletV3ConfigToCell,
    HighloadWalletV3Service,
    HighloadV3JettonService,
    HighloadV3UsdtService
} from './highload-v3';
export type { HighloadWalletV3Config, UsdtTransferParams } from './highload-v3';
