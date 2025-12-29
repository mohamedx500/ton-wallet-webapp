/**
 * V3R2 Wallet Module Exports
 */

export { V3R2WalletService } from './V3R2WalletService';

// V3R2 uses the same jetton service pattern as V3R1
// Re-export from v3r1 for consistency
export { V3R1JettonService as V3R2JettonService } from '../v3r1/jettons/JettonService';
export { V3R1UsdtService as V3R2UsdtService } from '../v3r1/jettons/usdt/UsdtService';
export { V3R1NotcoinService as V3R2NotcoinService } from '../v3r1/jettons/notcoin/NotcoinService';
