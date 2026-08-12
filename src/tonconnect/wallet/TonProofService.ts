import { Address } from '@ton/core';
import { sha256_sync } from '@ton/crypto';

import type { NetworkId } from '../../core/chain';
import { isSameAddress } from '../../core/address';
import { TonConnectWalletError } from './errors';
import { TON_CONNECT_MAX_PROOF_PAYLOAD_BYTES } from './types';
import type {
    TonProofRequest,
    TonProofResult,
    TonProofSigningAuthority,
} from './types';

const MESSAGE_PREFIX = Buffer.from('ton-proof-item-v2/', 'utf8');
const SIGNATURE_PREFIX = Buffer.from('ton-connect', 'utf8');
const HASH_PREFIX = Buffer.from([0xff, 0xff]);
const MAX_DOMAIN_BYTES = 255;
const MAX_FUTURE_SECONDS = 60;
const UTF8 = new TextEncoder();

export interface TonProofServiceOptions {
    readonly network: NetworkId;
    readonly clock: () => number;
    readonly maxAgeSeconds?: number;
}

/** Exact TON Connect address-proof constructor. Signing authority remains external and transient. */
export class TonProofService {
    public readonly network: NetworkId;
    private readonly clock: () => number;
    private readonly maxAgeSeconds: number;

    public constructor(options: TonProofServiceOptions) {
        this.network = options.network;
        this.clock = options.clock;
        this.maxAgeSeconds = options.maxAgeSeconds ?? 300;
        if (!Number.isSafeInteger(this.maxAgeSeconds) || this.maxAgeSeconds <= 0) {
            throw invalidProof('The TON proof maximum age is invalid.');
        }
    }

    public async create(
        request: TonProofRequest,
        authority: TonProofSigningAuthority,
    ): Promise<TonProofResult> {
        const prepared = prepareTonProof(request, this.network, this.clock(), this.maxAgeSeconds);
        if (!isSameAddress(authority.walletAddress, request.walletAddress)) {
            throw invalidProof('The TON proof signing authority belongs to a different wallet.');
        }
        const signature = await authority.sign(prepared.hash);
        if (signature.byteLength !== 64) {
            throw invalidProof('The TON proof signing authority returned an invalid signature.');
        }
        const result: TonProofResult = Object.freeze({
            name: 'ton_proof',
            proof: Object.freeze({
                timestamp: request.timestamp,
                domain: Object.freeze({
                    lengthBytes: prepared.domainBytes.byteLength,
                    value: prepared.domain,
                }),
                signature: Buffer.from(signature).toString('base64'),
                payload: request.payload,
            }),
        });
        prepared.hash.fill(0);
        prepared.message.fill(0);
        prepared.domainBytes.fill(0);
        return result;
    }
}

export interface PreparedTonProof {
    readonly domain: string;
    readonly domainBytes: Buffer;
    readonly message: Buffer;
    readonly hash: Buffer;
}

export function prepareTonProof(
    request: TonProofRequest,
    expectedNetwork: NetworkId,
    nowUnix: number,
    maxAgeSeconds: number,
): PreparedTonProof {
    if (request.network !== expectedNetwork) throw invalidProof('The TON proof belongs to a different TON network.');
    if (!Number.isSafeInteger(nowUnix) || !Number.isSafeInteger(request.timestamp) || request.timestamp < 0) {
        throw invalidProof('The TON proof timestamp is invalid.');
    }
    if (request.timestamp > nowUnix + MAX_FUTURE_SECONDS || request.timestamp < nowUnix - maxAgeSeconds) {
        throw invalidProof('The TON proof timestamp is outside the allowed signing window.');
    }
    const payloadBytes = Buffer.from(request.payload, 'utf8');
    if (payloadBytes.byteLength === 0 || payloadBytes.byteLength > TON_CONNECT_MAX_PROOF_PAYLOAD_BYTES) {
        throw invalidProof('The TON proof payload length is invalid.');
    }
    const domain = decodeDomain(request.manifestUrl);
    const domainBytes = Buffer.from(domain, 'utf8');
    if (domainBytes.byteLength === 0 || domainBytes.byteLength > MAX_DOMAIN_BYTES) {
        throw invalidProof('The TON proof domain length is invalid.');
    }
    const address = Address.parse(request.walletAddress);
    const addressBytes = Buffer.alloc(36);
    addressBytes.writeInt32BE(address.workChain, 0);
    address.hash.copy(addressBytes, 4);
    const domainLength = Buffer.alloc(4);
    domainLength.writeUInt32LE(domainBytes.byteLength, 0);
    const timestamp = Buffer.alloc(8);
    timestamp.writeBigUInt64LE(BigInt(request.timestamp), 0);
    const message = Buffer.concat([
        MESSAGE_PREFIX,
        addressBytes,
        domainLength,
        domainBytes,
        timestamp,
        payloadBytes,
    ]);
    const innerHash = sha256_sync(message);
    const hash = sha256_sync(Buffer.concat([HASH_PREFIX, SIGNATURE_PREFIX, innerHash]));
    addressBytes.fill(0);
    domainLength.fill(0);
    timestamp.fill(0);
    payloadBytes.fill(0);
    innerHash.fill(0);
    return Object.freeze({ domain, domainBytes, message, hash });
}

function decodeDomain(manifestUrl: string): string {
    let url: URL;
    try {
        url = new URL(manifestUrl);
    } catch (cause) {
        throw new TonConnectWalletError('INVALID_TON_PROOF_REQUEST', 'The TON proof manifest URL is invalid.', {}, { cause });
    }
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
        throw invalidProof('The TON proof manifest URL must use HTTPS.');
    }
    const domain = url.hostname.toLowerCase();
    const labels = domain.split('.');
    if (labels.length < 2 || labels.some((label) => label.length === 0 || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label))) {
        throw invalidProof('The TON proof domain is reserved or invalid for an external dApp.');
    }
    return domain;
}

function invalidProof(message: string): TonConnectWalletError {
    return new TonConnectWalletError('INVALID_TON_PROOF_REQUEST', message);
}
