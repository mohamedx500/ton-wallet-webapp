import { Address } from '@ton/core';

import { formatAddress, isSameAddress, parseAddress } from '../core/address';
import type { NetworkId } from '../core/chain';
import { assertUnsignedWalletMessage } from '../wallet/validation';
import type { UnsignedWalletMessage } from '../wallet/types';
import { TransferConstructionError } from './errors';

export const MAX_UINT64 = (1n << 64n) - 1n;

export function canonicalTransferAddress(address: string, network: NetworkId): string {
    return formatAddress(parseTransferAddress(address, network), {
        bounceable: true,
        testOnly: network === 'testnet',
    });
}

export function parseTransferAddress(address: string, network: NetworkId): Address {
    const trimmed = address.trim();
    const parsed = parseAddress(trimmed);
    if (
        Address.isFriendly(trimmed)
        && Address.parseFriendly(trimmed).isTestOnly !== (network === 'testnet')
    ) {
        throw invalidIntent('The transfer address test-only flag does not match the configured TON network.');
    }
    return parsed;
}

export function assertNetwork(network: NetworkId): void {
    if (network !== 'mainnet' && network !== 'testnet') {
        throw invalidIntent('The transfer must use an explicit supported TON network.');
    }
}

export function assertPositiveUnits(value: bigint, field: string): void {
    if (typeof value !== 'bigint' || value <= 0n) {
        throw new TransferConstructionError(
            'INVALID_TRANSFER_AMOUNT',
            `${field} must be greater than zero.`,
            { field },
        );
    }
}

export function assertNonNegativeUnits(value: bigint, field: string): void {
    if (typeof value !== 'bigint' || value < 0n) {
        throw new TransferConstructionError(
            'INVALID_TRANSFER_AMOUNT',
            `${field} cannot be negative.`,
            { field },
        );
    }
}

export function assertBouncePolicy(value: boolean): void {
    if (typeof value !== 'boolean') {
        throw invalidIntent('The transfer requires an explicit bounce policy.');
    }
}

export function assertJettonQueryId(queryId: bigint): void {
    if (typeof queryId !== 'bigint' || queryId <= 0n || queryId > MAX_UINT64) {
        throw new TransferConstructionError(
            'INVALID_JETTON_QUERY_ID',
            'The Jetton query identifier must be a nonzero unsigned 64-bit integer.',
        );
    }
}

export function assertResponseDestinationOwner(
    responseDestination: string,
    ownerAddress: string,
): void {
    if (!isSameAddress(responseDestination, ownerAddress)) {
        throw invalidIntent('The Jetton response destination must belong to the sending owner.');
    }
}

export function assertSenderJettonWalletIsNotMaster(
    senderJettonWalletAddress: string,
    masterAddress: string,
): void {
    if (isSameAddress(senderJettonWalletAddress, masterAddress)) {
        throw invalidIntent('The outgoing Jetton message must target the sender Jetton wallet, not the master.');
    }
}

export function freezeAndValidateMessage(message: UnsignedWalletMessage): UnsignedWalletMessage {
    assertUnsignedWalletMessage(message);
    return Object.freeze(message);
}

function invalidIntent(message: string): TransferConstructionError {
    return new TransferConstructionError('INVALID_TRANSFER_INTENT', message);
}
