/**
 * TonAPI Client
 * 
 * Client for TonAPI (tonapi.io) for blockchain indexing and history.
 */

import { Address } from '@ton/core';
import type {
    NetworkType,
    TonApiConfig,
    AccountInfo,
    TransactionHistoryItem,
    JettonBalance
} from '../types';

/**
 * TonAPI endpoints
 */
const TONAPI_ENDPOINTS = {
    mainnet: 'https://tonapi.io/v2',
    testnet: 'https://testnet.tonapi.io/v2',
};

/**
 * TonAPI Client
 */
export class TonApiClient {
    private readonly baseUrl: string;
    private readonly apiKey?: string;
    private readonly timeout: number;
    private readonly network: NetworkType;

    constructor(network: NetworkType = 'mainnet', config?: TonApiConfig) {
        this.network = network;
        this.baseUrl = config?.baseUrl ?? TONAPI_ENDPOINTS[network];
        this.apiKey = config?.apiKey;
        this.timeout = config?.timeout ?? 30000;
    }

    /**
     * Make API request
     */
    private async request<T>(path: string, options?: RequestInit): Promise<T> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };

        if (this.apiKey) {
            headers['Authorization'] = `Bearer ${this.apiKey}`;
        }

        const response = await fetch(`${this.baseUrl}${path}`, {
            ...options,
            headers: {
                ...headers,
                ...options?.headers,
            },
        });

        if (!response.ok) {
            throw new Error(`TonAPI error: ${response.status} ${response.statusText}`);
        }

        return response.json();
    }

    /**
     * Get account info
     */
    async getAccountInfo(address: string): Promise<AccountInfo | null> {
        try {
            const data = await this.request<any>(`/accounts/${encodeURIComponent(address)}`);

            return {
                address: data.address,
                balance: BigInt(data.balance || '0'),
                status: data.status || 'uninit',
                lastActivity: data.last_activity,
            };
        } catch {
            return null;
        }
    }

    /**
     * Get balance in nanotons
     */
    async getBalance(address: string): Promise<bigint> {
        const info = await this.getAccountInfo(address);
        return info?.balance ?? 0n;
    }

    /**
     * Get transaction history
     */
    async getTransactions(
        address: string,
        limit: number = 20
    ): Promise<TransactionHistoryItem[]> {
        try {
            const accountData = await this.request<any>(`/accounts/${encodeURIComponent(address)}`);
            const myRawAddress = accountData?.address;

            const data = await this.request<any>(
                `/accounts/${encodeURIComponent(address)}/events?limit=${limit}`
            );

            return this.parseEvents(data.events || [], myRawAddress);
        } catch {
            return [];
        }
    }

    /**
     * Parse events into transaction history
     */
    private parseEvents(events: any[], myRawAddress: string): TransactionHistoryItem[] {
        const transactions: TransactionHistoryItem[] = [];
        const myHash = this.extractHash(myRawAddress);

        for (const event of events) {
            const actions = event.actions || [];

            for (const action of actions) {
                if (action.type === 'TonTransfer') {
                    const transfer = action.TonTransfer;
                    const senderHash = this.extractHash(transfer.sender?.address);
                    const recipientHash = this.extractHash(transfer.recipient?.address);

                    const isIncoming = recipientHash === myHash && senderHash !== myHash;

                    transactions.push({
                        hash: event.event_id,
                        type: isIncoming ? 'incoming' : 'outgoing',
                        amount: BigInt(transfer.amount || '0'),
                        from: this.toUserFriendlyAddress(transfer.sender?.address, transfer.sender?.name),
                        to: this.toUserFriendlyAddress(transfer.recipient?.address, transfer.recipient?.name),
                        fromRaw: transfer.sender?.address,
                        toRaw: transfer.recipient?.address,
                        timestamp: event.timestamp,
                        comment: transfer.comment,
                        status: 'confirmed',
                    });
                }

                if (action.type === 'JettonTransfer') {
                    const transfer = action.JettonTransfer;
                    const recipientHash = this.extractHash(transfer.recipient?.address);
                    const isIncoming = recipientHash === myHash;

                    transactions.push({
                        hash: event.event_id,
                        type: isIncoming ? 'incoming' : 'outgoing',
                        amount: BigInt(transfer.amount || '0'),
                        from: this.toUserFriendlyAddress(transfer.sender?.address, transfer.sender?.name),
                        to: this.toUserFriendlyAddress(transfer.recipient?.address, transfer.recipient?.name),
                        fromRaw: transfer.sender?.address,
                        toRaw: transfer.recipient?.address,
                        timestamp: event.timestamp,
                        comment: transfer.comment,
                        jetton: {
                            address: transfer.jetton?.address || '',
                            symbol: transfer.jetton?.symbol || 'TOKEN',
                            name: transfer.jetton?.name || 'Unknown',
                            decimals: transfer.jetton?.decimals || 9,
                            image: transfer.jetton?.image,
                            verified: transfer.jetton?.verification === 'whitelist',
                        },
                        status: 'confirmed',
                    });
                }
            }
        }

        return transactions;
    }

    /**
     * Extract hash from raw address
     */
    private extractHash(address: string | undefined): string {
        if (!address) return '';
        if (address.includes(':')) {
            return address.split(':')[1]?.toLowerCase() || '';
        }
        return address.toLowerCase();
    }

    /**
     * Convert raw address to user-friendly format
     */
    private toUserFriendlyAddress(
        rawAddress: string | undefined,
        nameHint?: string
    ): string {
        if (nameHint) {
            return nameHint;
        }

        if (!rawAddress) {
            return 'Unknown';
        }

        if (rawAddress.startsWith('UQ') || rawAddress.startsWith('EQ') ||
            rawAddress.startsWith('kQ') || rawAddress.startsWith('0Q')) {
            return rawAddress;
        }

        try {
            if (rawAddress.includes(':')) {
                const addr = Address.parseRaw(rawAddress);
                return addr.toString({ bounceable: false, testOnly: this.network === 'testnet' });
            }
        } catch {
            // Fallback
        }

        if (rawAddress.includes(':')) {
            const hash = rawAddress.split(':')[1] || '';
            if (hash.length > 12) {
                return `${hash.slice(0, 6)}...${hash.slice(-6)}`;
            }
        }

        return rawAddress;
    }

    /**
     * Get Jetton balances
     */
    async getJettonBalances(address: string): Promise<JettonBalance[]> {
        try {
            const data = await this.request<any>(
                `/accounts/${encodeURIComponent(address)}/jettons`
            );

            return (data.balances || []).map((item: any) => {
                const balance = BigInt(item.balance || '0');
                const decimals = item.jetton?.decimals || 9;

                return {
                    jetton: {
                        address: item.jetton?.address || '',
                        symbol: item.jetton?.symbol || 'TOKEN',
                        name: item.jetton?.name || 'Unknown Token',
                        decimals,
                        image: item.jetton?.image,
                        verified: item.jetton?.verification === 'whitelist',
                    },
                    walletAddress: item.wallet_address?.address || '',
                    balance,
                    balanceFormatted: this.formatBalance(balance, decimals),
                };
            });
        } catch {
            return [];
        }
    }

    /**
     * Get Jetton wallet address
     */
    async getJettonWalletAddress(
        ownerAddress: string,
        jettonMasterAddress: string
    ): Promise<string | null> {
        try {
            const data = await this.request<any>(
                `/accounts/${encodeURIComponent(ownerAddress)}/jettons/${encodeURIComponent(jettonMasterAddress)}`
            );
            return data.wallet_address?.address || null;
        } catch {
            return null;
        }
    }

    /**
     * Format balance with decimals
     */
    private formatBalance(amount: bigint, decimals: number): string {
        const divisor = BigInt(10 ** decimals);
        const whole = amount / divisor;
        const fraction = amount % divisor;

        if (fraction === 0n) {
            return whole.toString();
        }

        const fractionStr = fraction.toString().padStart(decimals, '0');
        const trimmed = fractionStr.replace(/0+$/, '');

        return `${whole}.${trimmed}`;
    }

    /**
     * Get current network
     */
    getNetwork(): NetworkType {
        return this.network;
    }

    /**
     * Create client with different network
     */
    withNetwork(network: NetworkType): TonApiClient {
        return new TonApiClient(network, {
            apiKey: this.apiKey,
            timeout: this.timeout,
        });
    }
}

/**
 * Create default TonAPI client
 */
export function createTonApiClient(network: NetworkType = 'mainnet', apiKey?: string): TonApiClient {
    return new TonApiClient(network, { apiKey });
}

export default TonApiClient;
