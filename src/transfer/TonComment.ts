import { beginCell } from '@ton/core';
import type { Cell } from '@ton/core';

import { TransferConstructionError } from './errors';

export const TON_TEXT_COMMENT_OPCODE = 0;

/**
 * Build the canonical opcode-zero text comment body.
 *
 * Empty and omitted comments are represented as no body. They are never encoded
 * as an empty Cell or a referenced empty payload.
 */
export function buildTonComment(comment: string | undefined): Cell | undefined {
    if (comment === undefined || comment.length === 0) {
        return undefined;
    }

    try {
        return beginCell()
            .storeUint(TON_TEXT_COMMENT_OPCODE, 32)
            .storeStringTail(comment)
            .endCell();
    } catch (cause) {
        throw new TransferConstructionError(
            'INVALID_TRANSFER_COMMENT',
            'The transfer comment cannot be encoded in a TON message Cell.',
            {},
            cause,
        );
    }
}
