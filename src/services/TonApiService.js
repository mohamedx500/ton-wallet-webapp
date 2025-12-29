/**
 * TonApiService - Fetches real-time data from TON blockchain
 * Uses TonAPI for balance and transaction history
 */

import { Address } from '@ton/core';

export class TonApiService {
    constructor() {
        this.endpoints = {
            mainnet: 'https://tonapi.io/v2',
            testnet: 'https://testnet.tonapi.io/v2',
        };
        this.apiKey = 'AHTZZ7E34KIKKDYAAAALJKYQO7LDK72FO5LDOFCKEVP5KEUOP56JZB6FMWE4U3JWGMIOO7Q'; // TonAPI Console Key
        this.isTestnet = false;
    }

    /**
     * Helper to perform fetch with headers
     */
    async _fetch(url, options = {}) {
        const headers = {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            ...options.headers
        };
        return fetch(url, { ...options, headers });
    }

    /**
     * Get endpoint for network
     */
    getEndpoint(testnet = false) {
        this.isTestnet = testnet;
        return testnet ? this.endpoints.testnet : this.endpoints.mainnet;
    }

    /**
     * Fetch balance for address
     */
    async getBalance(address, testnet = false) {
        try {
            const endpoint = this.getEndpoint(testnet);
            const response = await this._fetch(`${endpoint}/accounts/${encodeURIComponent(address)}`);

            if (!response.ok) {
                if (response.status === 404) {
                    return 0;
                }
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            return parseInt(data.balance) || 0;

        } catch (error) {
            console.error('Error fetching balance:', error);
            return 0;
        }
    }

    /**
     * Fetch rates for TON and USDT
     */
    async getRates() {
        try {
            const endpoint = this.getEndpoint(false); // Rates usually on mainnet endpoint
            const response = await this._fetch(`${endpoint}/rates?tokens=ton,usdt&currencies=usd`);
            if (!response.ok) return { ton: { price: 0, diff: '0.00%' }, usdt: { price: 1, diff: '0.00%' } }; // Fallback

            const data = await response.json();

            // The API returns diff as a string like "−2.89%" or "+8.95%"
            // We just need to normalize the special minus character
            const normalizeDiff = (diffValue) => {
                if (!diffValue) return '0.00%';
                // Replace the special minus character (−) with regular minus (-)
                return String(diffValue).replace('−', '-');
            };

            return {
                ton: {
                    price: data.rates?.TON?.prices?.USD || 0,
                    diff: normalizeDiff(data.rates?.TON?.diff_24h?.USD)
                },
                usdt: {
                    price: data.rates?.USDT?.prices?.USD || 1,
                    diff: normalizeDiff(data.rates?.USDT?.diff_24h?.USD)
                }
            };
        } catch (error) {
            console.error('Error fetching rates:', error);
            // Default fallback prices
            return { ton: { price: 5.5, diff: '0.00%' }, usdt: { price: 1, diff: '0.00%' } };
        }
    }

    /**
     * Fetch Jetton balances for address
     */
    async getJettons(address, testnet = false) {
        try {
            const endpoint = this.getEndpoint(testnet);
            const response = await this._fetch(`${endpoint}/accounts/${encodeURIComponent(address)}/jettons`);

            if (!response.ok) {
                if (response.status === 404) return [];
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            const balances = data.balances || [];

            // Process with TrustWallet fallback
            return balances.map(b => {
                const jettonAddress = b.jetton.address;
                const trustWalletUrl = `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ton/assets/${jettonAddress}/logo.png`;

                // If no image from API, use TrustWallet fallback. 
                // Note: The UI can also try to load TrustWallet URL if the API image fails to load (onError in img tag),
                // but setting a smart default here helps.
                if (!b.jetton.image) {
                    b.jetton.image = trustWalletUrl;
                }

                return b;
            });
        } catch (error) {
            console.error('Error fetching jettons:', error);
            return [];
        }
    }

    /**
     * Fetch transactions for address
     */
    async getTransactions(address, testnet = false, limit = 20) {
        try {
            const endpoint = this.getEndpoint(testnet);

            // First, get the raw address from account info
            const accountResponse = await this._fetch(`${endpoint}/accounts/${encodeURIComponent(address)}`);
            let myRawAddress = null;

            if (accountResponse.ok) {
                const accountData = await accountResponse.json();
                myRawAddress = accountData.address; // This is in raw format 0:xxx
            }

            // Fetch events
            const response = await this._fetch(
                `${endpoint}/accounts/${encodeURIComponent(address)}/events?limit=${limit}`
            );

            if (!response.ok) {
                if (response.status === 404) {
                    return [];
                }
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();

            // Parse events into transactions using raw address for comparison
            return this._parseEvents(data.events || [], myRawAddress || address, testnet);

        } catch (error) {
            console.error('Error fetching transactions:', error);
            return [];
        }
    }

    /**
     * Extract the hash part of a raw address (after the colon)
     */
    _extractHash(address) {
        if (!address) return '';

        // If it's raw format like "0:abc123def..."
        if (address.includes(':')) {
            return address.split(':')[1]?.toLowerCase() || '';
        }

        return address.toLowerCase();
    }

    /**
     * Convert raw address (0:xxx) to user-friendly format using @ton/core
     */
    _toUserFriendlyAddress(rawAddress, nameHint = null, testnet = false) {
        // If we have a domain name, use it
        if (nameHint) {
            return nameHint;
        }

        if (!rawAddress) return 'Unknown';

        // If already in friendly format
        if (rawAddress.startsWith('UQ') || rawAddress.startsWith('EQ') ||
            rawAddress.startsWith('kQ') || rawAddress.startsWith('0Q')) {
            return rawAddress;
        }

        try {
            // Parse raw address and convert to user-friendly format
            // Raw format is "0:hexstring" or "-1:hexstring"
            if (rawAddress.includes(':')) {
                const address = Address.parseRaw(rawAddress);
                // Convert to user-friendly format (non-bounceable for wallets)
                return address.toString({ bounceable: false, testOnly: testnet });
            }
        } catch (e) {
            console.warn('Could not convert address:', rawAddress, e);
        }

        // Fallback: show shortened hex
        if (rawAddress.includes(':')) {
            const hash = rawAddress.split(':')[1] || '';
            if (hash.length > 12) {
                return `${hash.slice(0, 6)}...${hash.slice(-6)}`;
            }
        }

        return rawAddress;
    }

    /**
     * Parse TonAPI events into transaction objects
     */
    _parseEvents(events, myRawAddress, testnet = false) {
        const transactions = [];
        const myHash = this._extractHash(myRawAddress);

        console.log('Parsing events for raw address:', myRawAddress);
        console.log('My address hash:', myHash);

        for (const event of events) {
            const actions = event.actions || [];

            for (const action of actions) {
                if (action.type === 'TonTransfer') {
                    const transfer = action.TonTransfer;

                    // Get raw addresses for comparison
                    const senderRaw = transfer.sender?.address;
                    const recipientRaw = transfer.recipient?.address;

                    // Get domain names if available
                    const senderName = transfer.sender?.name;
                    const recipientName = transfer.recipient?.name;

                    // Extract hashes for comparison
                    const senderHash = this._extractHash(senderRaw);
                    const recipientHash = this._extractHash(recipientRaw);

                    // Determine direction by comparing hashes
                    const senderIsMe = senderHash === myHash;
                    const recipientIsMe = recipientHash === myHash;

                    let type = 'outgoing';
                    if (recipientIsMe && !senderIsMe) {
                        type = 'incoming';
                    } else if (senderIsMe && !recipientIsMe) {
                        type = 'outgoing';
                    } else if (senderIsMe && recipientIsMe) {
                        type = 'outgoing'; // Self transfer
                    }

                    // Convert to user-friendly display addresses
                    const fromDisplay = this._toUserFriendlyAddress(senderRaw, senderName, testnet);
                    const toDisplay = this._toUserFriendlyAddress(recipientRaw, recipientName, testnet);

                    console.log(`Transaction: ${type} | From: ${fromDisplay} | To: ${toDisplay}`);

                    transactions.push({
                        hash: event.event_id,
                        type,
                        amount: parseInt(transfer.amount) || 0,
                        from: fromDisplay,
                        to: toDisplay,
                        fromRaw: senderRaw,
                        toRaw: recipientRaw,
                        timestamp: event.timestamp,
                        comment: transfer.comment || '',
                    });
                }

                if (action.type === 'JettonTransfer') {
                    const transfer = action.JettonTransfer;

                    const senderRaw = transfer.sender?.address;
                    const recipientRaw = transfer.recipient?.address;
                    const senderName = transfer.sender?.name;
                    const recipientName = transfer.recipient?.name;

                    const recipientHash = this._extractHash(recipientRaw);
                    const recipientIsMe = recipientHash === myHash;

                    const fromDisplay = this._toUserFriendlyAddress(senderRaw, senderName, testnet);
                    const toDisplay = this._toUserFriendlyAddress(recipientRaw, recipientName, testnet);

                    transactions.push({
                        hash: event.event_id,
                        type: recipientIsMe ? 'incoming' : 'outgoing',
                        amount: parseInt(transfer.amount) || 0,
                        from: fromDisplay,
                        to: toDisplay,
                        fromRaw: senderRaw,
                        toRaw: recipientRaw,
                        timestamp: event.timestamp,
                        jetton: transfer.jetton?.symbol || 'Token',
                        decimals: transfer.jetton?.decimals || 9,
                        comment: transfer.comment || '',
                    });
                }
            }
        }

        return transactions;
    }

    /**
     * Get account info
     */
    async getAccountInfo(address, testnet = false) {
        try {
            const endpoint = this.getEndpoint(testnet);
            const response = await this._fetch(`${endpoint}/accounts/${encodeURIComponent(address)}`);

            if (!response.ok) {
                return null;
            }

            return await response.json();

        } catch (error) {
            console.error('Error fetching account info:', error);
            return null;
        }
    }

    /**
     * Get jetton balances
     */
    async getJettonBalances(address, testnet = false) {
        try {
            const endpoint = this.getEndpoint(testnet);
            const response = await this._fetch(`${endpoint}/accounts/${encodeURIComponent(address)}/jettons`);

            if (!response.ok) {
                return [];
            }

            const data = await response.json();
            return data.balances || [];

        } catch (error) {
            console.error('Error fetching jetton balances:', error);
            return [];
        }
    }
}
