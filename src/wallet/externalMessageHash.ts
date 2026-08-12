import { beginCell, storeMessage } from '@ton/core';
import type { Message } from '@ton/core';

const NORMALIZED_EXTERNAL_MESSAGE_HASH = /^[0-9a-f]{64}$/;

/**
 * Computes the TEP-467 normalized hash used to correlate an external-in message
 * with the wallet transaction that processed it.
 *
 * Source, state init, and import fee are deliberately normalized because nodes
 * may represent those fields differently after the message is imported.
 */
export function normalizedExternalMessageHash(message: Message): string {
    if (message.info.type !== 'external-in') {
        throw new Error('Only external-in messages have a normalized external-message hash.');
    }

    const normalized: Message = {
        info: {
            type: 'external-in',
            dest: message.info.dest,
            importFee: 0n,
        },
        init: null,
        body: message.body,
    };

    return beginCell()
        .store(storeMessage(normalized, { forceRef: true }))
        .endCell()
        .hash()
        .toString('hex');
}

export function isNormalizedExternalMessageHash(value: string): boolean {
    return NORMALIZED_EXTERNAL_MESSAGE_HASH.test(value);
}
