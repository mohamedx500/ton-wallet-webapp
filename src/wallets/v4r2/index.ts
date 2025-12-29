/**
 * V4R2 Wallet Module Exports
 */

export { V4R2WalletService } from './V4R2WalletService';

// V4R2 uses the same jetton service pattern
export { V3R1JettonService as V4R2JettonService } from '../v3r1/jettons/JettonService';
export { V3R1UsdtService as V4R2UsdtService } from '../v3r1/jettons/usdt/UsdtService';
export { V3R1NotcoinService as V4R2NotcoinService } from '../v3r1/jettons/notcoin/NotcoinService';
