import { TON_ASSET } from '../assets/fungible';
import type { JettonAsset, NativeAsset } from '../assets/fungible';
import { parseUnits } from '../core/units';
import { TransferConstructionError } from './errors';
import type {
    JettonTransferInput,
    JettonTransferIntent,
    NativeTonTransferInput,
    NativeTonTransferIntent,
} from './types';

export function createNativeTonTransferIntent(
    input: NativeTonTransferInput,
): NativeTonTransferIntent {
    assertNativeAsset(input.asset);
    const amount = parsePositiveAmount(input.amount, input.asset.decimals);

    return Object.freeze({
        kind: 'native-ton',
        network: input.network,
        asset: Object.freeze({ ...input.asset }),
        recipient: input.recipient,
        amount,
        attachedTon: amount,
        bounce: input.bounce,
        purpose: input.purpose,
        ...(input.comment === undefined ? {} : { comment: input.comment }),
    });
}

export function createJettonTransferIntent(
    input: JettonTransferInput,
): JettonTransferIntent {
    assertJettonAsset(input.asset);
    const amount = parsePositiveAmount(input.amount, input.asset.decimals);

    return Object.freeze({
        kind: 'jetton',
        network: input.network,
        asset: Object.freeze({ ...input.asset }),
        recipient: input.recipient,
        amount,
        attachedTon: input.attachedTon,
        bounce: input.bounce,
        purpose: input.purpose,
        ownerAddress: input.ownerAddress,
        senderJettonWalletAddress: input.senderJettonWalletAddress,
        responseDestination: input.responseDestination,
        queryId: input.queryId,
        forwardTonAmount: input.forwardTonAmount,
        ...(input.comment === undefined ? {} : { comment: input.comment }),
    });
}

function parsePositiveAmount(value: string, decimals: number): bigint {
    const amount = parseUnits(value, decimals);
    if (amount <= 0n) {
        throw new TransferConstructionError(
            'INVALID_TRANSFER_AMOUNT',
            'A transfer amount must be greater than zero.',
        );
    }
    return amount;
}

function assertNativeAsset(asset: NativeAsset): void {
    if (
        asset.kind !== 'native'
        || asset.decimals !== TON_ASSET.decimals
        || asset.symbol !== TON_ASSET.symbol
    ) {
        throw invalidAsset('A native TON transfer requires the canonical native asset.');
    }
}

function assertJettonAsset(asset: JettonAsset): void {
    if (asset.kind !== 'jetton') {
        throw invalidAsset('A Jetton transfer requires a Jetton master identity.');
    }
    try {
        parseUnits('0', asset.decimals);
    } catch (cause) {
        throw new TransferConstructionError(
            'INVALID_TRANSFER_INTENT',
            'The Jetton asset has an invalid decimal precision.',
            {},
            cause,
        );
    }
}

function invalidAsset(message: string): TransferConstructionError {
    return new TransferConstructionError('INVALID_TRANSFER_INTENT', message);
}
