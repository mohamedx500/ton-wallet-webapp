import { beginCell } from '@ton/core';
import type { Cell } from '@ton/core';

import type { UnsignedWalletMessage } from '../wallet/types';
import { buildTonComment } from './TonComment';
import { TransferConstructionError } from './errors';
import type { JettonTransferIntent } from './types';
import {
    assertBouncePolicy,
    assertJettonQueryId,
    assertNetwork,
    assertNonNegativeUnits,
    assertPositiveUnits,
    assertResponseDestinationOwner,
    assertSenderJettonWalletIsNotMaster,
    canonicalTransferAddress,
    freezeAndValidateMessage,
    parseTransferAddress,
} from './validation';

export const JETTON_TRANSFER_OPCODE = 0x0f8a7ea5;

export function buildJettonTransferBody(intent: JettonTransferIntent): Cell {
    validateJettonIntent(intent);
    const forwardPayload = buildTonComment(intent.comment);

    try {
        const builder = beginCell()
            .storeUint(JETTON_TRANSFER_OPCODE, 32)
            .storeUint(intent.queryId, 64)
            .storeCoins(intent.amount)
            .storeAddress(parseTransferAddress(intent.recipient, intent.network))
            .storeAddress(parseTransferAddress(intent.responseDestination, intent.network))
            .storeBit(false)
            .storeCoins(intent.forwardTonAmount);

        if (forwardPayload === undefined) {
            builder.storeBit(false);
        } else {
            builder.storeBit(true).storeRef(forwardPayload);
        }
        return builder.endCell();
    } catch (cause) {
        if (cause instanceof TransferConstructionError) {
            throw cause;
        }
        throw new TransferConstructionError(
            'INVALID_TRANSFER_INTENT',
            'The Jetton transfer cannot be encoded as a TEP-74 message.',
            {},
            cause,
        );
    }
}

export function buildJettonTransferMessage(
    intent: JettonTransferIntent,
): UnsignedWalletMessage {
    const body = buildJettonTransferBody(intent);
    return freezeAndValidateMessage({
        to: canonicalTransferAddress(intent.senderJettonWalletAddress, intent.network),
        value: intent.attachedTon,
        body,
        bounce: intent.bounce,
        purpose: intent.purpose,
    });
}

function validateJettonIntent(intent: JettonTransferIntent): void {
    assertNetwork(intent.network);
    if (intent.kind !== 'jetton' || intent.asset.kind !== 'jetton') {
        throw new TransferConstructionError(
            'INVALID_TRANSFER_INTENT',
            'A TEP-74 transfer requires a Jetton master identity.',
        );
    }
    canonicalTransferAddress(intent.asset.master, intent.network);
    canonicalTransferAddress(intent.ownerAddress, intent.network);
    canonicalTransferAddress(intent.senderJettonWalletAddress, intent.network);
    canonicalTransferAddress(intent.recipient, intent.network);
    canonicalTransferAddress(intent.responseDestination, intent.network);
    assertPositiveUnits(intent.amount, 'amount');
    assertPositiveUnits(intent.attachedTon, 'attachedTon');
    assertNonNegativeUnits(intent.forwardTonAmount, 'forwardTonAmount');
    assertJettonQueryId(intent.queryId);
    assertBouncePolicy(intent.bounce);
    assertResponseDestinationOwner(intent.responseDestination, intent.ownerAddress);
    assertSenderJettonWalletIsNotMaster(
        intent.senderJettonWalletAddress,
        intent.asset.master,
    );
}
