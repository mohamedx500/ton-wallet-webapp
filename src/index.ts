/**
 * Universal TON Wallet - Main Entry Point
 * 
 * Clean, modular TypeScript architecture supporting:
 * - V3R1, V3R2, V4R2, V5R1 (Standard Wallets)
 * - Highload V3 (Enterprise/Batch Transactions)
 * - Jetton Transfers (USDT, NOT, etc.)
 * - Secure Key Storage (AES-256-GCM)
 * - Offline Signing
 * 
 * @packageDocumentation
 */

// Buffer polyfill for browser
import { Buffer } from 'buffer';
if (typeof window !== 'undefined') {
    (window as any).Buffer = Buffer;
}

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export * from './types';

// ============================================================================
// WALLET EXPORTS
// ============================================================================

export {
    // Standard Wallet (unified)
    StandardWalletService,
    createStandardWalletService,

    // V3R1
    V3R1WalletService,
    V3R1JettonService,
    V3R1UsdtService,
    V3R1NotcoinService,

    // V3R2
    V3R2WalletService,

    // V4R2
    V4R2WalletService,

    // V5R1
    V5R1WalletService,

    // Highload V3
    HighloadQueryId,
    QueryIdStore,
    HighloadWalletV3,
    HighloadWalletV3Service,
    HighloadV3JettonService,
    HighloadV3UsdtService,
} from './wallets';

// ============================================================================
// NETWORK EXPORTS
// ============================================================================

export {
    RpcClient,
    createRpcClient,
    TonApiClient,
    createTonApiClient,
} from './network';

// ============================================================================
// CRYPTO EXPORTS
// ============================================================================

export {
    MnemonicService,
    createMnemonicService,
    EncryptionService,
    createEncryptionService,
    OfflineSigningService,
    createOfflineSigningService,
} from './crypto';

// ============================================================================
// CONVENIENCE FACTORY FUNCTIONS
// ============================================================================

import { TonClient } from '@ton/ton';
import type { NetworkType, WalletVersion } from './types';
import { StandardWalletService } from './wallets';
import { HighloadWalletV3Service } from './wallets/highload-v3';
import { RpcClient } from './network';
import { TonApiClient } from './network';
import { MnemonicService } from './crypto';

/**
 * Create a complete wallet setup
 */
export async function createWallet(
    mnemonic: string[],
    version: WalletVersion = 'v4r2',
    network: NetworkType = 'mainnet'
) {
    const rpcClient = new RpcClient({ network });
    const tonClient = rpcClient.getClient();
    const tonApiClient = new TonApiClient(network);

    if (version === 'highload-v3') {
        const service = new HighloadWalletV3Service(network);
        const wallet = await service.createFromMnemonic(mnemonic);
        return {
            wallet,
            service,
            tonClient,
            rpcClient,
            tonApiClient,
        };
    } else {
        const service = new StandardWalletService(network);
        const wallet = await service.createFromMnemonic(mnemonic, version as any);
        return {
            wallet,
            service,
            tonClient,
            rpcClient,
            tonApiClient,
        };
    }
}

/**
 * Generate a new wallet
 */
export async function generateNewWallet(
    version: WalletVersion = 'v4r2',
    network: NetworkType = 'mainnet'
) {
    const mnemonicService = new MnemonicService();
    const mnemonic = await mnemonicService.generateMnemonic(24);
    const setup = await createWallet(mnemonic, version, network);
    return {
        ...setup,
        mnemonic,
    };
}

/**
 * Import wallet from mnemonic string
 */
export async function importWallet(
    mnemonicString: string,
    version: WalletVersion = 'v4r2',
    network: NetworkType = 'mainnet'
) {
    const mnemonicService = new MnemonicService();
    const mnemonic = mnemonicService.parseMnemonic(mnemonicString);

    const isValid = await mnemonicService.validateMnemonic(mnemonic);
    if (!isValid) {
        throw new Error('Invalid mnemonic phrase');
    }

    return createWallet(mnemonic, version, network);
}

// ============================================================================
// VERSION INFO
// ============================================================================

export const VERSION = '2.0.0';
export const SUPPORTED_VERSIONS: WalletVersion[] = [
    'v3r1',
    'v3r2',
    'v4r2',
    'v5r1',
    'highload-v3',
];

// Default export
export default {
    createWallet,
    generateNewWallet,
    importWallet,
    VERSION,
    SUPPORTED_VERSIONS,
};
