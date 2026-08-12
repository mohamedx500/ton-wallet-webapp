/**
 * NftTransferBuilder — Slice 4: NFT transfer cell construction.
 *
 * Constructs a TEP-62 compliant `transfer#5fcc3d14` message body to send
 * an NFT item to a new owner. The resulting `UnsignedWalletMessage` is
 * consumed by TransferExecutor / PasswordConfirmedTransactionExecutor.
 */

import { Address, beginCell, toNano } from '@ton/core';
import type { Cell } from '@ton/core';
import type { UnsignedWalletMessage } from '../wallet/types';
import type { NftTransferIntent } from './types';

/** TEP-62 transfer opcode. */
export const NFT_TRANSFER_OPCODE = 0x5fcc3d14;

/** Minimum attached TON for NFT transfers (covers storage + forward fees). */
export const NFT_MIN_ATTACHED_TON = toNano('0.07');

/** Default forward amount sent to new owner with the transfer notification. */
export const NFT_DEFAULT_FORWARD_AMOUNT = toNano('0.05');

/**
 * Build a TEP-62 NFT transfer body cell.
 *
 * Layout (from TEP-62 spec):
 * ```
 * transfer#5fcc3d14
 *   query_id:uint64
 *   new_owner:MsgAddress
 *   response_destination:MsgAddress
 *   custom_payload:(Maybe ^Cell)
 *   forward_amount:(VarUInteger 16)
 *   forward_payload:(Either Cell ^Cell)
 * ```
 */
export function buildNftTransferBody(intent: NftTransferIntent): Cell {
    validateNftTransferIntent(intent);

    const recipientAddress = Address.parse(intent.recipient);
    const responseAddress = Address.parse(intent.responseDestination);

    let forwardPayloadCell: Cell | null = null;
    if (intent.forwardPayload && intent.forwardPayload.length > 0) {
        // Store as a UTF-8 text comment (matching TON comment encoding)
        forwardPayloadCell = beginCell()
            .storeUint(0, 32) // text comment op prefix
            .storeStringTail(intent.forwardPayload)
            .endCell();
    }

    const builder = beginCell()
        .storeUint(NFT_TRANSFER_OPCODE, 32)
        .storeUint(0, 64) // query_id (0 = no specific query tracking)
        .storeAddress(recipientAddress)
        .storeAddress(responseAddress)
        .storeBit(false); // no custom_payload

    builder.storeCoins(intent.forwardAmount);

    if (forwardPayloadCell) {
        builder.storeBit(true).storeRef(forwardPayloadCell);
    } else {
        builder.storeBit(false);
    }

    return builder.endCell();
}

/**
 * Build an `UnsignedWalletMessage` for an NFT transfer.
 * The message is sent to the NFT item contract (not the owner or recipient).
 */
export function buildNftTransferMessage(intent: NftTransferIntent): UnsignedWalletMessage {
    validateNftTransferIntent(intent);
    const body = buildNftTransferBody(intent);
    return Object.freeze({
        to: intent.nftAddress,
        value: intent.attachedTon,
        body,
        bounce: true, // NFT contracts are always bounced — they're deployed contracts
        purpose: intent.purpose,
    });
}

function validateNftTransferIntent(intent: NftTransferIntent): void {
    if (!intent.nftAddress || intent.nftAddress.length === 0) {
        throw new Error('NftTransferBuilder: nftAddress is required.');
    }
    if (!intent.recipient || intent.recipient.length === 0) {
        throw new Error('NftTransferBuilder: recipient is required.');
    }
    if (!intent.responseDestination || intent.responseDestination.length === 0) {
        throw new Error('NftTransferBuilder: responseDestination is required.');
    }
    if (intent.attachedTon < NFT_MIN_ATTACHED_TON) {
        throw new Error(
            `NftTransferBuilder: attachedTon must be at least ${NFT_MIN_ATTACHED_TON} nanotons (0.07 TON).`,
        );
    }
    if (intent.forwardAmount < 0n) {
        throw new Error('NftTransferBuilder: forwardAmount cannot be negative.');
    }
    if (intent.forwardAmount >= intent.attachedTon) {
        throw new Error(
            'NftTransferBuilder: forwardAmount must be less than attachedTon to leave gas for fees.',
        );
    }
    // Validate addresses parse correctly
    try {
        Address.parse(intent.nftAddress);
        Address.parse(intent.recipient);
        Address.parse(intent.responseDestination);
    } catch (cause) {
        throw new Error(`NftTransferBuilder: invalid address in intent — ${String(cause)}`);
    }
}
