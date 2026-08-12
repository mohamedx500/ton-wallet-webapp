import type {
    StandardWalletContractVersion,
    StandardWalletDescriptor,
    WalletContractVersion,
    WalletDescriptor,
} from './types';
import { DEFAULT_CONFIG } from '../types';

/** Matches {@link WalletService.importWallet} wallet-id defaults. */
const STANDARD_V4_FAMILY_WALLET_ID = 698983191;

/**
 * Build a standard-wallet descriptor that matches how this app imports wallets.
 * v5r1 must not receive the v4-family subwallet id.
 */
export function standardWalletDescriptorForVersion(
    version: StandardWalletContractVersion,
    address: string,
): StandardWalletDescriptor {
    const descriptor: StandardWalletDescriptor = Object.freeze({
        kind: 'standard',
        version,
        address,
    });

    if (version === 'v4r2' || version === 'v3r1' || version === 'v3r2') {
        return Object.freeze({
            ...descriptor,
            subwalletId: STANDARD_V4_FAMILY_WALLET_ID,
        });
    }

    return descriptor;
}

/** Build a wallet descriptor for any supported account type. */
export function walletDescriptorForAccountType(
    version: WalletContractVersion,
    address: string,
): WalletDescriptor {
    if (version === 'highload-v3') {
        return Object.freeze({
            kind: 'highload-v3',
            version: 'highload-v3',
            address,
            subwalletId: DEFAULT_CONFIG.SUBWALLET_ID_HIGHLOAD_V3,
            timeoutSeconds: DEFAULT_CONFIG.HIGHLOAD_TIMEOUT,
        });
    }
    return standardWalletDescriptorForVersion(version, address);
}