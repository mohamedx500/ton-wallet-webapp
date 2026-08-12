import { parseAddress } from '../core/address';
import { WalletExecutionError } from './errors';
import type {
    HighloadWalletDescriptor,
    StandardWalletDescriptor,
    UnsignedWalletMessage,
    WalletDescriptor,
    WalletExecutionRequest,
} from './types';

const MAX_SAFE_UINT32 = 0xffff_ffff;
const MAX_CORRELATION_ID_LENGTH = 128;
const MAX_PURPOSE_LENGTH = 240;
const MAX_MESSAGES_BY_WALLET: Readonly<Record<WalletDescriptor['kind'], number>> = Object.freeze({
    standard: 4,
    'highload-v3': 254,
});

export interface WalletRequestValidationOptions {
    /** Injected Unix clock in seconds. */
    readonly nowUnix: number;
    /** Maximum accepted lifetime from `nowUnix`. Defaults to five minutes. */
    readonly maxFutureSeconds?: number;
}

/** Fail closed before a wallet-version signer receives a request. */
export function assertWalletExecutionRequest(
    request: WalletExecutionRequest,
    options: WalletRequestValidationOptions,
): void {
    assertFiniteSafeInteger(options.nowUnix, 'nowUnix');
    assertWalletDescriptor(request.wallet);
    assertCorrelationId(request.correlationId);

    const maxFutureSeconds = options.maxFutureSeconds ?? 300;
    assertFiniteSafeInteger(maxFutureSeconds, 'maxFutureSeconds');
    if (maxFutureSeconds <= 0) {
        throw invalidRequest('Maximum request lifetime must be greater than zero.');
    }

    if (!Number.isSafeInteger(request.validUntilUnix)) {
        throw invalidRequest('The transaction expiry is invalid.');
    }
    if (request.validUntilUnix <= options.nowUnix) {
        throw new WalletExecutionError('REQUEST_EXPIRED', 'This transaction request has expired.');
    }
    if (request.validUntilUnix > options.nowUnix + maxFutureSeconds) {
        throw invalidRequest('The transaction expiry exceeds the allowed lifetime.');
    }

    const maximum = MAX_MESSAGES_BY_WALLET[request.wallet.kind];
    if (request.messages.length === 0 || request.messages.length > maximum) {
        throw invalidRequest(`This wallet accepts between 1 and ${maximum} messages per request.`);
    }

    for (const message of request.messages) {
        assertUnsignedWalletMessage(message);
    }
}

export function assertWalletDescriptor(wallet: WalletDescriptor): void {
    parseAddress(wallet.address);

    if (wallet.kind === 'standard') {
        assertStandardWalletDescriptor(wallet);
        return;
    }

    assertHighloadWalletDescriptor(wallet);
}

export function assertUnsignedWalletMessage(message: UnsignedWalletMessage): void {
    parseAddress(message.to);

    if (message.value <= 0n) {
        throw invalidRequest('Every outgoing message must attach a positive TON value.');
    }

    const purpose = message.purpose.trim();
    if (purpose.length === 0 || purpose.length > MAX_PURPOSE_LENGTH) {
        throw invalidRequest('Every outgoing message requires a concise approval description.');
    }
}

function assertStandardWalletDescriptor(wallet: StandardWalletDescriptor): void {
    if (wallet.subwalletId !== undefined) {
        assertUint32(wallet.subwalletId, 'subwalletId');
    }
}

function assertHighloadWalletDescriptor(wallet: HighloadWalletDescriptor): void {
    assertUint32(wallet.subwalletId, 'subwalletId');
    if (!Number.isSafeInteger(wallet.timeoutSeconds) || wallet.timeoutSeconds <= 0 || wallet.timeoutSeconds >= 1 << 22) {
        throw invalidRequest('Highload Wallet V3 timeout must fit the 22-bit contract field.');
    }
}

function assertCorrelationId(correlationId: string): void {
    if (!/^[A-Za-z0-9_-]+$/.test(correlationId) || correlationId.length > MAX_CORRELATION_ID_LENGTH) {
        throw invalidRequest('The transaction correlation identifier is invalid.');
    }
}

function assertUint32(value: number, field: string): void {
    if (!Number.isSafeInteger(value) || value < 0 || value > MAX_SAFE_UINT32) {
        throw invalidRequest(`${field} must be an unsigned 32-bit integer.`);
    }
}

function assertFiniteSafeInteger(value: number, field: string): void {
    if (!Number.isSafeInteger(value)) {
        throw invalidRequest(`${field} must be a safe integer.`);
    }
}

function invalidRequest(message: string): WalletExecutionError {
    return new WalletExecutionError('INVALID_WALLET_REQUEST', message);
}
