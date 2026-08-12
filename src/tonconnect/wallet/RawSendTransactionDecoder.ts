import {
    Address,
    Cell,
    beginCell,
    loadStateInit,
    storeStateInit,
} from '@ton/core';

import { isSameAddress } from '../../core/address';
import type { NetworkId } from '../../core/chain';
import type {
    StandardWalletDescriptor,
    UnsignedWalletMessage,
    WalletExecutionRequest,
} from '../../wallet/types';
import { TonConnectWalletError } from './errors';
import { assertTonConnectNetwork } from './network';

const DECIMAL_NANOTONS = /^(?:0|[1-9][0-9]*)$/u;
const MAX_UINT64 = (1n << 64n) - 1n;
const MAX_MESSAGES = 4;
const MAX_BOC_BYTES = 65_536;

export interface RawSendTransactionDecodeContext {
    readonly network: NetworkId;
    readonly wallet: StandardWalletDescriptor;
    readonly requestId: string;
    readonly appClientId: string;
    readonly nowUnix: number;
    readonly maxFutureSeconds?: number;
}

/** Strict raw-message TON Connect adapter. It constructs no signatures and performs no I/O. */
export function decodeRawSendTransaction(
    value: unknown,
    context: RawSendTransactionDecodeContext,
): WalletExecutionRequest {
    assertContext(context);
    const record = exactRecord(value, ['valid_until', 'network', 'from', 'messages']);
    const validUntilUnix = safeInteger(record, 'valid_until');
    const maxFutureSeconds = context.maxFutureSeconds ?? 300;
    if (validUntilUnix <= context.nowUnix) {
        throw invalidTransaction('The TON Connect transaction request has expired.');
    }
    if (validUntilUnix > context.nowUnix + maxFutureSeconds) {
        throw invalidTransaction('The TON Connect transaction lifetime exceeds the wallet limit.');
    }

    const network = stringField(record, 'network');
    assertTonConnectNetwork(context.network, network);
    const from = stringField(record, 'from');
    if (!isSameAddress(from, context.wallet.address)) {
        throw invalidTransaction('The TON Connect transaction sender does not match the selected wallet.');
    }

    const rawMessages = record['messages'];
    if (!Array.isArray(rawMessages) || rawMessages.length === 0 || rawMessages.length > MAX_MESSAGES) {
        throw invalidTransaction('A standard wallet accepts between one and four TON Connect messages.');
    }
    const messages = Object.freeze(rawMessages.map((message, index) => decodeMessage(message, context.network, index)));
    return Object.freeze({
        network: context.network,
        wallet: context.wallet,
        messages,
        validUntilUnix,
        correlationId: correlationId(context.appClientId, context.requestId),
    });
}

function decodeMessage(value: unknown, network: NetworkId, index: number): UnsignedWalletMessage {
    const record = exactRecord(value, ['address', 'amount', 'payload', 'stateInit'], ['address', 'amount']);
    const friendly = friendlyAddress(stringField(record, 'address'), network);
    const amount = decimalNanotons(stringField(record, 'amount'));
    const payload = optionalBoc(record, 'payload', 'payload');
    const stateInit = optionalBoc(record, 'stateInit', 'stateInit');
    if (stateInit !== undefined) validateStateInitBoc(stateInit);
    return Object.freeze({
        to: friendly.address.toRawString(),
        value: amount,
        ...(payload === undefined ? {} : { body: payload }),
        bounce: friendly.isBounceable,
        purpose: `TON Connect message ${index + 1} of raw transaction`,
    });
}

function friendlyAddress(value: string, network: NetworkId): ReturnType<typeof Address.parseFriendly> {
    if (!Address.isFriendly(value)) {
        throw invalidTransaction('TON Connect destinations must use TEP-2 user-friendly addresses.');
    }
    let parsed: ReturnType<typeof Address.parseFriendly>;
    try {
        parsed = Address.parseFriendly(value);
    } catch (cause) {
        throw new TonConnectWalletError(
            'INVALID_SEND_TRANSACTION',
            'A TON Connect destination address is invalid.',
            {},
            { cause },
        );
    }
    if (parsed.isTestOnly !== (network === 'testnet')) {
        throw invalidTransaction('A TON Connect destination address belongs to a different TON network.');
    }
    return parsed;
}

function decimalNanotons(value: string): bigint {
    if (!DECIMAL_NANOTONS.test(value)) {
        throw invalidTransaction('TON Connect amounts must be canonical decimal nanotons.');
    }
    const amount = BigInt(value);
    if (amount <= 0n || amount > MAX_UINT64) {
        throw invalidTransaction('A TON Connect message amount is outside the supported positive uint64 range.');
    }
    return amount;
}

function optionalBoc(
    record: Readonly<Record<string, unknown>>,
    key: 'payload' | 'stateInit',
    label: string,
): Cell | undefined {
    const value = record[key];
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || value.length === 0) {
        throw invalidTransaction(`The TON Connect ${label} BOC is invalid.`);
    }
    let bytes: Buffer;
    try {
        bytes = Buffer.from(value, 'base64');
    } catch (cause) {
        throw new TonConnectWalletError('INVALID_SEND_TRANSACTION', `The TON Connect ${label} BOC is invalid.`, {}, { cause });
    }
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BOC_BYTES || bytes.toString('base64') !== value) {
        throw invalidTransaction(`The TON Connect ${label} BOC encoding is not canonical.`);
    }
    let roots: Cell[];
    try {
        roots = Cell.fromBoc(bytes);
    } catch (cause) {
        throw new TonConnectWalletError('INVALID_SEND_TRANSACTION', `The TON Connect ${label} BOC could not be decoded.`, {}, { cause });
    }
    const root = roots[0];
    if (roots.length !== 1 || root === undefined) {
        throw invalidTransaction(`The TON Connect ${label} must be a single-root BOC.`);
    }
    const canonical = root.toBoc().toString('base64');
    try {
        const canonicalRoot = Cell.fromBoc(Buffer.from(canonical, 'base64'))[0];
        if (canonicalRoot === undefined || !canonicalRoot.equals(root)) {
            throw invalidTransaction(`The TON Connect ${label} BOC is not canonical.`);
        }
    } catch (cause) {
        if (cause instanceof TonConnectWalletError) throw cause;
        throw new TonConnectWalletError('INVALID_SEND_TRANSACTION', `The TON Connect ${label} BOC is not canonical.`, {}, { cause });
    }
    return root;
}

function validateStateInitBoc(cell: Cell): void {
    try {
        const slice = cell.beginParse();
        const stateInit = loadStateInit(slice);
        if (slice.remainingBits !== 0 || slice.remainingRefs !== 0) {
            throw new Error('Trailing StateInit data');
        }
        const canonical = beginCell().store(storeStateInit(stateInit)).endCell();
        if (!canonical.equals(cell)) throw new Error('Non-canonical StateInit');
    } catch (cause) {
        throw new TonConnectWalletError(
            'INVALID_SEND_TRANSACTION',
            'The TON Connect stateInit is not a canonical StateInit cell.',
            {},
            { cause },
        );
    }
}

function assertContext(context: RawSendTransactionDecodeContext): void {
    if (context.wallet.kind !== 'standard') {
        throw invalidTransaction('Highload Wallet V3 is not supported by this TON Connect transaction adapter.');
    }
    if (!Number.isSafeInteger(context.nowUnix) || context.nowUnix < 0) {
        throw invalidTransaction('The TON Connect validation clock is invalid.');
    }
    const maximum = context.maxFutureSeconds ?? 300;
    if (!Number.isSafeInteger(maximum) || maximum <= 0) {
        throw invalidTransaction('The TON Connect transaction lifetime limit is invalid.');
    }
    if (!/^(?:0|[1-9][0-9]*)$/u.test(context.requestId)) {
        throw invalidTransaction('The TON Connect request ID is invalid.');
    }
    if (!/^[0-9a-f]{64}$/u.test(context.appClientId)) {
        throw invalidTransaction('The TON Connect application client ID is invalid.');
    }
}

function correlationId(appClientId: string, requestId: string): string {
    const suffix = requestId.length > 48 ? requestId.slice(-48) : requestId;
    return `tc_${appClientId.slice(0, 16)}_${suffix}`;
}

function exactRecord(
    value: unknown,
    allowed: readonly string[],
    required: readonly string[] = allowed,
): Readonly<Record<string, unknown>> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw invalidTransaction('The TON Connect sendTransaction payload is invalid.');
    }
    const record = value as Readonly<Record<string, unknown>>;
    const keys = Object.keys(record);
    if (keys.some((key) => !allowed.includes(key)) || required.some((key) => !keys.includes(key))) {
        throw invalidTransaction('The TON Connect sendTransaction payload has missing or unknown fields.');
    }
    return record;
}

function stringField(record: Readonly<Record<string, unknown>>, key: string): string {
    const value = record[key];
    if (typeof value !== 'string' || value.length === 0) {
        throw invalidTransaction('A TON Connect sendTransaction string field is invalid.');
    }
    return value;
}

function safeInteger(record: Readonly<Record<string, unknown>>, key: string): number {
    const value = record[key];
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        throw invalidTransaction('The TON Connect valid_until field is invalid.');
    }
    return value;
}

function invalidTransaction(message: string): TonConnectWalletError {
    return new TonConnectWalletError('INVALID_SEND_TRANSACTION', message);
}
