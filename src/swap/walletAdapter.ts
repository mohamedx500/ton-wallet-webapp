import type { OutgoingMessage } from './types';
import type { UnsignedWalletMessage } from '../wallet';

/**
 * Convert a swap plan's already-validated messages into the general wallet seam.
 *
 * This adapter intentionally lives in the swap feature. The wallet layer must
 * never depend on DEX concepts such as `destinationRole` or provider identity.
 * The Cell instance is preserved exactly: no payload is parsed, rebuilt, or
 * altered between swap validation and wallet signing.
 */
export function toUnsignedWalletMessages(
    messages: readonly OutgoingMessage[],
): readonly UnsignedWalletMessage[] {
    return Object.freeze(
        messages.map((message) =>
            Object.freeze({
                to: message.to,
                value: message.value,
                body: message.body,
                bounce: message.bounce,
                purpose: message.purpose,
            }),
        ),
    );
}
