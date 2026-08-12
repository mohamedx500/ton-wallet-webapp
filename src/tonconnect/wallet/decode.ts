import { TonConnectWalletError } from './errors';
import {
    TON_CONNECT_MAX_LINK_LENGTH,
    TON_CONNECT_MAX_MANIFEST_URL_LENGTH,
    TON_CONNECT_MAX_PROOF_PAYLOAD_BYTES,
    TON_CONNECT_MAX_RPC_PARAMETER_BYTES,
    TON_CONNECT_PROTOCOL_VERSION,
} from './types';
import type {
    TonAddressConnectItem,
    TonConnectAppRequest,
    TonConnectItem,
    TonConnectLink,
    TonConnectManifest,
    TonConnectRequest,
    TonConnectReturnStrategy,
    TonProofConnectItem,
} from './types';

const CLIENT_ID = /^[0-9a-f]{64}$/u;
const RPC_ID = /^(?:0|[1-9][0-9]*)$/u;
const TRACE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ALLOWED_LINK_PARAMETERS = new Set(['v', 'id', 'r', 'ret', 'trace_id']);
const SUPPORTED_METHODS = new Set(['sendTransaction', 'signMessage', 'signData', 'disconnect']);
const UTF8 = new TextEncoder();

export interface DecodeTonConnectLinkOptions {
    readonly acceptedSchemes?: readonly string[];
    readonly acceptedHttpsHosts?: readonly string[];
}

export function decodeTonConnectLink(
    value: string,
    options: DecodeTonConnectLinkOptions = {},
): TonConnectLink {
    if (typeof value !== 'string' || value.length === 0 || value.length > TON_CONNECT_MAX_LINK_LENGTH) {
        throw invalidLink('The TON Connect link length is invalid.');
    }

    let url: URL;
    try {
        url = new URL(value);
    } catch (cause) {
        throw invalidLink('The TON Connect link is not a valid URL.', cause);
    }
    assertAcceptedLocation(url, options);
    assertExactSearchParameters(url);

    const versionText = requiredParameter(url, 'v');
    if (versionText !== String(TON_CONNECT_PROTOCOL_VERSION)) {
        throw new TonConnectWalletError(
            'UNSUPPORTED_PROTOCOL_VERSION',
            'This wallet supports TON Connect protocol version 2 only.',
        );
    }

    const appClientId = requiredParameter(url, 'id');
    if (!CLIENT_ID.test(appClientId)) {
        throw invalidLink('The TON Connect application client ID is invalid.');
    }

    const requestText = requiredParameter(url, 'r');
    if (UTF8.encode(requestText).byteLength > TON_CONNECT_MAX_RPC_PARAMETER_BYTES) {
        throw invalidLink('The TON Connect connect request is too large.');
    }

    return Object.freeze({
        version: TON_CONNECT_PROTOCOL_VERSION,
        appClientId,
        request: decodeConnectRequest(parseJson(requestText, 'INVALID_CONNECT_REQUEST')),
        returnStrategy: decodeReturnStrategy(url.searchParams.get('ret')),
        traceId: decodeTraceId(url.searchParams.get('trace_id')),
    });
}

export function decodeConnectRequest(value: unknown): TonConnectRequest {
    const record = exactRecord(value, ['manifestUrl', 'items'], 'INVALID_CONNECT_REQUEST');
    const manifestUrl = stringField(record, 'manifestUrl', 'INVALID_CONNECT_REQUEST');
    if (manifestUrl.length === 0 || manifestUrl.length > TON_CONNECT_MAX_MANIFEST_URL_LENGTH) {
        throw invalidRequest('The TON Connect manifest URL length is invalid.');
    }
    assertHttpsUrl(
        manifestUrl,
        'The TON Connect manifest URL must use HTTPS.',
        'INVALID_CONNECT_REQUEST',
    );

    const rawItems = record['items'];
    if (!Array.isArray(rawItems) || rawItems.length === 0 || rawItems.length > 2) {
        throw invalidRequest('The TON Connect request must contain one or two supported items.');
    }
    const items = rawItems.map((item) => decodeConnectItem(item));
    if (!items.some((item) => item.name === 'ton_addr')) {
        throw invalidRequest('The TON Connect request must include ton_addr.');
    }
    if (new Set(items.map((item) => item.name)).size !== items.length) {
        throw invalidRequest('The TON Connect request contains duplicate items.');
    }
    return Object.freeze({ manifestUrl, items: Object.freeze(items) });
}

export function decodeTonConnectAppRequest(value: unknown): TonConnectAppRequest {
    const record = exactRecord(value, ['method', 'params', 'id'], 'INVALID_APP_REQUEST');
    const method = stringField(record, 'method', 'INVALID_APP_REQUEST');
    if (!SUPPORTED_METHODS.has(method)) {
        throw new TonConnectWalletError('INVALID_APP_REQUEST', 'The TON Connect RPC method is unsupported.');
    }
    const id = stringField(record, 'id', 'INVALID_APP_REQUEST');
    if (!RPC_ID.test(id)) {
        throw new TonConnectWalletError('INVALID_APP_REQUEST', 'The TON Connect request ID must be an unsigned decimal integer.');
    }
    const rawParams = record['params'];
    if (!Array.isArray(rawParams) || rawParams.some((parameter) => typeof parameter !== 'string')) {
        throw new TonConnectWalletError('INVALID_APP_REQUEST', 'The TON Connect request params are invalid.');
    }
    if (rawParams.some((parameter) => UTF8.encode(parameter).byteLength > TON_CONNECT_MAX_RPC_PARAMETER_BYTES)) {
        throw new TonConnectWalletError('INVALID_APP_REQUEST', 'A TON Connect request parameter is too large.');
    }
    if (method === 'disconnect' ? rawParams.length !== 0 : rawParams.length !== 1) {
        throw new TonConnectWalletError('INVALID_APP_REQUEST', 'The TON Connect request has an invalid parameter count.');
    }
    return Object.freeze({
        method: method as TonConnectAppRequest['method'],
        params: Object.freeze([...rawParams]),
        id,
    });
}

export function decodeTonConnectManifest(value: unknown, manifestUrl: string): TonConnectManifest {
    const record = exactRecord(
        value,
        ['url', 'name', 'iconUrl', 'termsOfUseUrl', 'privacyPolicyUrl'],
        'INVALID_MANIFEST',
        ['url', 'name', 'iconUrl'],
    );
    const url = stringField(record, 'url', 'INVALID_MANIFEST');
    const name = stringField(record, 'name', 'INVALID_MANIFEST').trim();
    const iconUrl = stringField(record, 'iconUrl', 'INVALID_MANIFEST');
    const termsOfUseUrl = nullableUrl(record, 'termsOfUseUrl');
    const privacyPolicyUrl = nullableUrl(record, 'privacyPolicyUrl');
    if (name.length === 0 || name.length > 128 || /[\u0000-\u001f\u007f]/u.test(name)) {
        throw new TonConnectWalletError('INVALID_MANIFEST', 'The TON Connect manifest name is invalid.');
    }
    const appUrl = assertHttpsUrl(url, 'The TON Connect application URL must use HTTPS.');
    const sourceUrl = assertHttpsUrl(manifestUrl, 'The TON Connect manifest URL must use HTTPS.');
    const icon = assertHttpsUrl(iconUrl, 'The TON Connect manifest icon URL must use HTTPS.');
    if (!/\.(?:png|ico)(?:$|[?#])/iu.test(icon.href)) {
        throw new TonConnectWalletError('INVALID_MANIFEST', 'The TON Connect manifest icon must be PNG or ICO.');
    }
    if (appUrl.origin !== sourceUrl.origin) {
        throw new TonConnectWalletError('INVALID_MANIFEST', 'The TON Connect manifest origin does not match its application URL.');
    }
    return Object.freeze({
        url: stripTrailingSlash(appUrl.href),
        origin: appUrl.origin,
        name,
        iconUrl: icon.href,
        termsOfUseUrl,
        privacyPolicyUrl,
    });
}

export function compareTonConnectRequestIds(previous: string | null, next: string): void {
    if (!RPC_ID.test(next)) {
        throw new TonConnectWalletError('INVALID_APP_REQUEST', 'The TON Connect request ID is invalid.');
    }
    if (previous !== null && (!RPC_ID.test(previous) || BigInt(next) <= BigInt(previous))) {
        throw new TonConnectWalletError(
            'REPLAYED_APP_REQUEST',
            'The TON Connect request ID was already processed or is out of order.',
        );
    }
}

function decodeConnectItem(value: unknown): TonConnectItem {
    if (!isRecord(value) || typeof value['name'] !== 'string') {
        throw invalidRequest('A TON Connect request item is invalid.');
    }
    if (value['name'] === 'ton_addr') {
        const record = exactRecord(value, ['name', 'network'], 'INVALID_CONNECT_REQUEST', ['name']);
        const network = optionalString(record, 'network', 'INVALID_CONNECT_REQUEST');
        const result: TonAddressConnectItem = Object.freeze({
            name: 'ton_addr',
            ...(network === undefined ? {} : { network }),
        });
        return result;
    }
    if (value['name'] === 'ton_proof') {
        const record = exactRecord(value, ['name', 'payload'], 'INVALID_CONNECT_REQUEST');
        const payload = stringField(record, 'payload', 'INVALID_CONNECT_REQUEST');
        if (payload.length === 0 || UTF8.encode(payload).byteLength > TON_CONNECT_MAX_PROOF_PAYLOAD_BYTES) {
            throw invalidRequest('The TON Connect proof payload length is invalid.');
        }
        const result: TonProofConnectItem = Object.freeze({ name: 'ton_proof', payload });
        return result;
    }
    throw invalidRequest('The TON Connect request item is unsupported.');
}

function decodeReturnStrategy(value: string | null): TonConnectReturnStrategy {
    if (value === null || value === '' || value === 'back') return Object.freeze({ kind: 'back' });
    if (value === 'none') return Object.freeze({ kind: 'none' });
    const url = assertHttpsUrl(
        value,
        'The TON Connect return URL must use HTTPS.',
        'INVALID_CONNECT_LINK',
    );
    return Object.freeze({ kind: 'url', url: url.href });
}

function decodeTraceId(value: string | null): string | null {
    if (value === null) return null;
    if (!TRACE_ID.test(value)) throw invalidLink('The TON Connect trace ID is invalid.');
    return value.toLowerCase();
}

function assertAcceptedLocation(url: URL, options: DecodeTonConnectLinkOptions): void {
    const acceptedSchemes = options.acceptedSchemes ?? ['tc:'];
    if (url.protocol === 'https:') {
        if (!(options.acceptedHttpsHosts ?? []).includes(url.hostname.toLowerCase())) {
            throw invalidLink('The TON Connect HTTPS link host is not configured for this wallet.');
        }
        return;
    }
    if (!acceptedSchemes.includes(url.protocol)) {
        throw invalidLink('The TON Connect link scheme is unsupported.');
    }
}

function assertExactSearchParameters(url: URL): void {
    const seen = new Set<string>();
    for (const key of url.searchParams.keys()) {
        if (!ALLOWED_LINK_PARAMETERS.has(key) || seen.has(key)) {
            throw invalidLink('The TON Connect link contains unknown or duplicate parameters.');
        }
        seen.add(key);
    }
}

function requiredParameter(url: URL, key: string): string {
    const value = url.searchParams.get(key);
    if (value === null || value.length === 0) throw invalidLink(`The TON Connect ${key} parameter is required.`);
    return value;
}

function exactRecord(
    value: unknown,
    allowed: readonly string[],
    code: 'INVALID_CONNECT_REQUEST' | 'INVALID_APP_REQUEST' | 'INVALID_MANIFEST',
    required: readonly string[] = allowed,
): Readonly<Record<string, unknown>> {
    if (!isRecord(value)) throw new TonConnectWalletError(code, 'The TON Connect object is invalid.');
    const keys = Object.keys(value);
    if (keys.some((key) => !allowed.includes(key)) || required.some((key) => !keys.includes(key))) {
        throw new TonConnectWalletError(code, 'The TON Connect object has missing or unknown fields.');
    }
    return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(
    record: Readonly<Record<string, unknown>>,
    key: string,
    code: 'INVALID_CONNECT_REQUEST' | 'INVALID_APP_REQUEST' | 'INVALID_MANIFEST',
): string {
    const value = record[key];
    if (typeof value !== 'string') throw new TonConnectWalletError(code, 'A TON Connect string field is invalid.');
    return value;
}

function optionalString(
    record: Readonly<Record<string, unknown>>,
    key: string,
    code: 'INVALID_CONNECT_REQUEST' | 'INVALID_APP_REQUEST',
): string | undefined {
    const value = record[key];
    if (value === undefined) return undefined;
    if (typeof value !== 'string') throw new TonConnectWalletError(code, 'An optional TON Connect field is invalid.');
    return value;
}

function nullableUrl(record: Readonly<Record<string, unknown>>, key: string): string | null {
    const value = record[key];
    if (value === undefined) return null;
    if (typeof value !== 'string') throw new TonConnectWalletError('INVALID_MANIFEST', 'A TON Connect policy URL is invalid.');
    return assertHttpsUrl(value, 'TON Connect policy URLs must use HTTPS.').href;
}

function assertHttpsUrl(
    value: string,
    message: string,
    code: 'INVALID_CONNECT_REQUEST' | 'INVALID_MANIFEST' | 'INVALID_CONNECT_LINK' = 'INVALID_MANIFEST',
): URL {
    let url: URL;
    try {
        url = new URL(value);
    } catch (cause) {
        throw new TonConnectWalletError(code, message, {}, { cause });
    }
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
        throw new TonConnectWalletError(code, message);
    }
    return url;
}

function parseJson(value: string, code: 'INVALID_CONNECT_REQUEST'): unknown {
    try {
        return JSON.parse(value) as unknown;
    } catch (cause) {
        throw new TonConnectWalletError(code, 'The TON Connect JSON payload is invalid.', {}, { cause });
    }
}

function stripTrailingSlash(value: string): string {
    return value.endsWith('/') ? value.slice(0, -1) : value;
}

function invalidLink(message: string, cause?: unknown): TonConnectWalletError {
    return new TonConnectWalletError('INVALID_CONNECT_LINK', message, {}, cause === undefined ? undefined : { cause });
}

function invalidRequest(message: string): TonConnectWalletError {
    return new TonConnectWalletError('INVALID_CONNECT_REQUEST', message);
}
