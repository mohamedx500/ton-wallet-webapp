import type { JettonAsset, NativeAsset } from '../assets/fungible';
import type { NetworkId } from '../core/chain';

interface TransferIntentBase {
    readonly network: NetworkId;
    readonly recipient: string;
    readonly amount: bigint;
    readonly attachedTon: bigint;
    readonly bounce: boolean;
    readonly purpose: string;
    /** Empty or omitted means that no message body is constructed. */
    readonly comment?: string;
}

/** Exact native TON intent. `amount` and `attachedTon` must be identical. */
export interface NativeTonTransferIntent extends TransferIntentBase {
    readonly kind: 'native-ton';
    readonly asset: NativeAsset;
}

/** Exact TEP-74 intent addressed through the owner's already-resolved Jetton wallet. */
export interface JettonTransferIntent extends TransferIntentBase {
    readonly kind: 'jetton';
    readonly asset: JettonAsset;
    readonly ownerAddress: string;
    readonly senderJettonWalletAddress: string;
    readonly responseDestination: string;
    readonly queryId: bigint;
    readonly forwardTonAmount: bigint;
}

export type TransferIntent = NativeTonTransferIntent | JettonTransferIntent;

export interface NativeTonTransferInput {
    readonly network: NetworkId;
    readonly asset: NativeAsset;
    readonly recipient: string;
    readonly amount: string;
    readonly bounce: boolean;
    readonly purpose: string;
    readonly comment?: string;
}

export interface JettonTransferInput {
    readonly network: NetworkId;
    readonly asset: JettonAsset;
    readonly recipient: string;
    readonly amount: string;
    readonly attachedTon: bigint;
    readonly bounce: boolean;
    readonly purpose: string;
    readonly ownerAddress: string;
    readonly senderJettonWalletAddress: string;
    readonly responseDestination: string;
    readonly queryId: bigint;
    readonly forwardTonAmount: bigint;
    readonly comment?: string;
}
