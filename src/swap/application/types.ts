import type { AssetTrustLevel, FungibleAsset } from '../../assets/fungible';
import type { NetworkId } from '../../core/chain';
import type { WalletDescriptor } from '../../wallet/types';

/**
 * Minimal legacy token shape accepted at the inactive application boundary.
 *
 * `contractAddress` is the only protocol identity. Symbols and names are
 * attacker-controlled display metadata and never select an asset or route.
 */
export interface LegacySwapAssetInput {
    readonly contractAddress: string;
    readonly symbol: string;
    readonly name: string;
    readonly decimals: number;
    readonly imageUrl?: string;
    readonly trust?: AssetTrustLevel;
}

/** Public account data required to select a standard-wallet execution adapter. */
export interface LegacyWalletAccountInput {
    readonly type: string;
    readonly address: string;
}

/** Input for constructing an immutable, exact-unit swap intent. */
export interface CreateSwapIntentInput {
    readonly network: NetworkId;
    readonly ownerAddress: string;
    readonly account: LegacyWalletAccountInput;
    readonly from: LegacySwapAssetInput;
    readonly to: LegacySwapAssetInput;
    readonly amount: string;
    readonly slippageBps: number;
    readonly correlationId: string;
}

/**
 * Provider-neutral application intent produced before any quote or network call.
 *
 * This value is safe to hand to a quote-session adapter. It contains no password,
 * mnemonic, key, signer, payload cell, signature, BOC, or vendor response.
 */
export interface SwapIntent {
    readonly network: NetworkId;
    readonly ownerAddress: string;
    readonly wallet: WalletDescriptor;
    readonly from: FungibleAsset;
    readonly to: FungibleAsset;
    readonly offerUnits: bigint;
    readonly slippageBps: number;
    readonly correlationId: string;
}
