/**
 * DomainService — Slice 4: TON DNS domain management.
 *
 * Specialized service for .ton domain NFTs that extends NftItem with:
 *   - Linked wallet address resolution.
 *   - Domain expiry resolution.
 *   - `linkAddress()` transaction builder: sets the wallet record in the DNS NFT.
 *   - `renewDomain()` transaction builder: sends renewal payment.
 *
 * Domain resolution is done via TonAPI v2 DNS endpoints.
 * Link/renew messages use DNS contract opcodes from the official TON contracts.
 */

import { Address, beginCell, toNano } from '@ton/core';
import type { Cell } from '@ton/core';
import type { NetworkId } from '../core/chain';
import type { UnsignedWalletMessage } from '../wallet/types';

const TONAPI_BASE: Record<NetworkId, string> = {
    mainnet: 'https://tonapi.io',
    testnet: 'https://testnet.tonapi.io',
};

// DNS set-record opcode (from TON DNS contract)
const DNS_SET_RECORD_OPCODE = 0x4eb1f0f9;

// Category hash for "wallet" record — sha256('wallet') as known by TON DNS contracts
// This is a well-known constant from the official TON DNS implementation.
const DNS_CATEGORY_WALLET = BigInt(
    '0xe8d44050873dba865aa7c170ab4cce64d90839a34dcfd6cf71d14e0205443b1b',
);

/** Minimum attached TON for domain operations. */
export const DOMAIN_MIN_ATTACHED_TON = toNano('0.02');

/** Renewal cost is determined by the DNS contract, this is the minimum to send. */
export const DOMAIN_RENEWAL_AMOUNT = toNano('0.07');

export interface DomainInfo {
    readonly domainName: string;
    readonly nftAddress: string;
    readonly ownerAddress: string;
    /** Currently linked wallet address, or null if not set. */
    readonly linkedAddress: string | null;
    /** Unix timestamp when the domain expires. */
    readonly expiresAtUnix: number | null;
    readonly network: NetworkId;
}

export interface DomainServiceOptions {
    readonly network: NetworkId;
    readonly apiKey?: string;
}

export class DomainService {
    private readonly network: NetworkId;
    private readonly apiKey: string | undefined;

    public constructor(options: DomainServiceOptions) {
        this.network = options.network;
        this.apiKey = options.apiKey;
    }

    /**
     * Resolve a .ton domain name to detailed domain info.
     */
    public async resolve(domainName: string): Promise<DomainInfo | null> {
        const base = TONAPI_BASE[this.network];
        const headers = this.buildHeaders();
        const normalized = domainName.toLowerCase().trim();

        try {
            const response = await fetch(
                `${base}/v2/dns/${encodeURIComponent(normalized)}`,
                { headers, signal: AbortSignal.timeout(8000) },
            );
            if (!response.ok) return null;

            const json = await response.json() as Record<string, unknown>;

            const walletSection = json['wallet'] as Record<string, unknown> | undefined;
            const linkedAddress = (walletSection?.['address'] as string | undefined) ?? null;

            const expiresAtUnix = typeof json['expiring_at'] === 'number'
                ? (json['expiring_at'] as number)
                : null;

            const itemSection = json['nft_item'] as Record<string, unknown> | undefined;
            const nftAddress = (itemSection?.['address'] as string | undefined) ?? '';
            const ownerSection = itemSection?.['owner'] as Record<string, unknown> | undefined;
            const ownerAddress = (ownerSection?.['address'] as string | undefined) ?? '';

            if (!nftAddress || !ownerAddress) return null;

            return Object.freeze({
                domainName: normalized,
                nftAddress,
                ownerAddress,
                linkedAddress,
                expiresAtUnix,
                network: this.network,
            });
        } catch {
            return null;
        }
    }

    /**
     * Build an `UnsignedWalletMessage` to set the wallet record of a .ton domain
     * to `walletAddress`. This message is sent to the DNS NFT item contract.
     *
     * The resulting message must be signed by the *domain owner*.
     */
    public buildLinkAddressMessage(
        nftAddress: string,
        walletAddress: string,
    ): UnsignedWalletMessage {
        Address.parse(nftAddress);
        Address.parse(walletAddress);

        // Build the DNS record value cell for "wallet" category
        // Format: addr#9fd3 address:MsgAddress = DNSRecord
        const walletRecordValue = beginCell()
            .storeUint(0x9fd3, 16)       // addr tag
            .storeAddress(Address.parse(walletAddress))
            .storeUint(0, 8)              // padding
            .endCell();

        // DNS set-record body: op | category | value
        const body = beginCell()
            .storeUint(DNS_SET_RECORD_OPCODE, 32)
            .storeUint(0, 64)             // query_id
            .storeUint(DNS_CATEGORY_WALLET, 256)
            .storeBit(true)               // value present
            .storeRef(walletRecordValue)
            .endCell();

        return Object.freeze({
            to: nftAddress,
            value: DOMAIN_MIN_ATTACHED_TON,
            body,
            bounce: true,
            purpose: `Link ${walletAddress} to domain`,
        });
    }

    /**
     * Build an `UnsignedWalletMessage` to unlink the wallet record of a .ton domain.
     * Sets the wallet category to null.
     */
    public buildUnlinkAddressMessage(nftAddress: string): UnsignedWalletMessage {
        Address.parse(nftAddress);

        const body = beginCell()
            .storeUint(DNS_SET_RECORD_OPCODE, 32)
            .storeUint(0, 64)
            .storeUint(DNS_CATEGORY_WALLET, 256)
            .storeBit(false)  // null value = remove record
            .endCell();

        return Object.freeze({
            to: nftAddress,
            value: DOMAIN_MIN_ATTACHED_TON,
            body,
            bounce: true,
            purpose: 'Unlink wallet address from domain',
        });
    }

    /**
     * Build an `UnsignedWalletMessage` to renew a .ton domain.
     * Sends the renewal payment directly to the NFT item contract.
     */
    public buildRenewMessage(nftAddress: string): UnsignedWalletMessage {
        Address.parse(nftAddress);

        // Renewal is a simple TON payment to the NFT; no specific body needed.
        return Object.freeze({
            to: nftAddress,
            value: DOMAIN_RENEWAL_AMOUNT,
            bounce: true,
            purpose: 'Renew .ton domain',
        });
    }

    private buildHeaders(): Record<string, string> {
        const h: Record<string, string> = { 'Accept': 'application/json' };
        if (this.apiKey) h['Authorization'] = `Bearer ${this.apiKey}`;
        return h;
    }
}
