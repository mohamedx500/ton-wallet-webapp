/**
 * V5R1 Wallet Module Exports
 */

export { V5R1WalletService } from './V5R1WalletService';

// V5R1 uses the same jetton service pattern
export { V3R1JettonService as V5R1JettonService } from '../v3r1/jettons/JettonService';
export { V3R1UsdtService as V5R1UsdtService } from '../v3r1/jettons/usdt/UsdtService';
export { V3R1NotcoinService as V5R1NotcoinService } from '../v3r1/jettons/notcoin/NotcoinService';
