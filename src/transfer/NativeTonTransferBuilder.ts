import { TON_ASSET } from '../assets/fungible';
import type { UnsignedWalletMessage } from '../wallet/types';
import { buildTonComment } from './TonComment';
import { TransferConstructionError } from './errors';
import type { NativeTonTransferIntent } from './types';
import {
    assertBouncePolicy,
    assertNetwork,
    assertPositiveUnits,
    canonicalTransferAddress,
    freezeAndValidateMessage,
} from './validation';

export function buildNativeTonTransferMessage(
    intent: NativeTonTransferIntent,
): UnsignedWalletMessage {
    assertNetwork(intent.network);
    if (
        intent.kind !== 'native-ton'
        || intent.asset.kind !== 'native'
        || intent.asset.decimals !== TON_ASSET.decimals
        || intent.asset.symbol !== TON_ASSET.symbol
    ) {
        throw new TransferConstructionError(
            'INVALID_TRANSFER_INTENT',
            'A native TON message requires the canonical native asset.',
        );
    }
    assertPositiveUnits(intent.amount, 'amount');
    assertPositiveUnits(intent.attachedTon, 'attachedTon');
    if (intent.attachedTon !== intent.amount) {
        throw new TransferConstructionError(
            'INVALID_TRANSFER_INTENT',
            'A native TON message must attach exactly the approved transfer amount.',
        );
    }
    assertBouncePolicy(intent.bounce);

    const body = buildTonComment(intent.comment);
    return freezeAndValidateMessage({
        to: canonicalTransferAddress(intent.recipient, intent.network),
        value: intent.amount,
        ...(body === undefined ? {} : { body }),
        bounce: intent.bounce,
        purpose: intent.purpose,
    });
}
