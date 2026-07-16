/**
 * TokenDiscoveryService - Auto-Discovery Protocol for TON Tokens
 * 
 * Following the "Zero-Maintenance" principle from plan2.md:
 * - No hardcoded token addresses, names, or icon paths
 * - Dynamic fetching from TONAPI.io
 * - Auto-render any token the user holds
 */

export interface DiscoveredToken {
    symbol: string;
    name: string;
    balance: string;
    balanceFormatted: number;
    imageUrl: string;
    contractAddress: string;
    decimals: number;
}

export interface TokenMetadata {
    symbol: string;
    name: string;
    decimals: number;
    imageUrl: string;
    contractAddress: string;
}

// Default fallback icon for tokens without images
const FALLBACK_ICON = 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ton/info/logo.png';

// Popular tokens cache from STON.fi for quick swap access
const POPULAR_TOKENS_CACHE: TokenMetadata[] = [
    {
        symbol: 'Gram',
        name: 'Gram',
        decimals: 9,
        imageUrl: 'https://asset.ston.fi/img/EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c/d6004ba1bb042d9224b37dacf17399d04ff64d4ae5a6a1fbc52ae3906545c2fc',
        contractAddress: 'native',
    },
    {
        symbol: 'USD₮',
        name: 'Tether USD',
        decimals: 6,
        imageUrl: 'https://asset.ston.fi/img/EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs/1a87edfee9a28b05578853952e5effb8cc30af1e0fb90043aa2ce19dce490849',
        contractAddress: 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs',
    },
];

class TokenDiscoveryService {
    private apiBase = 'https://tonapi.io/v2';
    private stonfiApiBase = 'https://api.ston.fi/v1';
    private cachedAssets: Map<string, TokenMetadata> = new Map();
    private assetsLoaded = false;

    /**
     * Fetch all Jettons held by a wallet address from TONAPI
     * This is the core "Auto-Discovery" mechanism
     */
    async discoverUserTokens(walletAddress: string): Promise<DiscoveredToken[]> {
        if (!walletAddress) {
            console.log('[TokenDiscovery] No wallet address provided');
            return [];
        }

        try {
            console.log('[TokenDiscovery] Fetching tokens for:', walletAddress);

            const response = await fetch(`${this.apiBase}/accounts/${walletAddress}/jettons`, {
                headers: {
                    'Accept': 'application/json',
                }
            });

            if (!response.ok) {
                console.error('[TokenDiscovery] API error:', response.status);
                return [];
            }

            const data = await response.json();
            const tokens: DiscoveredToken[] = [];

            // Add native TON balance first
            const tonBalance = await this.getTonBalance(walletAddress);
            tokens.push({
                symbol: 'Gram',
                name: 'Gram',
                balance: tonBalance.raw,
                balanceFormatted: tonBalance.formatted,
                imageUrl: POPULAR_TOKENS_CACHE[0].imageUrl,
                contractAddress: 'native',
                decimals: 9,
            });

            // Process Jettons from API response
            if (data.balances && Array.isArray(data.balances)) {
                for (const jetton of data.balances) {
                    const metadata = jetton.jetton;
                    const balance = jetton.balance || '0';
                    const decimals = metadata?.decimals || 9;

                    tokens.push({
                        symbol: metadata?.symbol || 'Unknown',
                        name: metadata?.name || 'Unknown Token',
                        balance: balance,
                        balanceFormatted: parseFloat(balance) / Math.pow(10, decimals),
                        imageUrl: metadata?.image || metadata?.preview || FALLBACK_ICON,
                        contractAddress: metadata?.address || '',
                        decimals: decimals,
                    });
                }
            }

            console.log('[TokenDiscovery] Found', tokens.length, 'tokens');
            return tokens;
        } catch (error) {
            console.error('[TokenDiscovery] Error fetching tokens:', error);
            return [];
        }
    }

    /**
     * Get TON balance for a wallet
     */
    async getTonBalance(walletAddress: string): Promise<{ raw: string; formatted: number }> {
        try {
            const response = await fetch(`${this.apiBase}/accounts/${walletAddress}`, {
                headers: { 'Accept': 'application/json' }
            });

            if (response.ok) {
                const data = await response.json();
                const balance = data.balance || '0';
                return {
                    raw: balance,
                    formatted: parseFloat(balance) / 1e9,
                };
            }
        } catch (error) {
            console.error('[TokenDiscovery] Error fetching TON balance:', error);
        }
        return { raw: '0', formatted: 0 };
    }

    /**
     * Load all available assets from STON.fi for swap token selection
     * This provides the full list of tradeable tokens
     */
    async loadAvailableAssets(): Promise<TokenMetadata[]> {
        if (this.assetsLoaded && this.cachedAssets.size > 0) {
            return Array.from(this.cachedAssets.values());
        }

        try {
            console.log('[TokenDiscovery] Loading assets from STON.fi...');
            const response = await fetch(`${this.stonfiApiBase}/assets`, {
                headers: { 'Accept': 'application/json' }
            });

            if (!response.ok) {
                console.error('[TokenDiscovery] STON.fi API error:', response.status);
                return POPULAR_TOKENS_CACHE;
            }

            const data = await response.json();
            const assets: TokenMetadata[] = [];

            // Add native TON first
            assets.push(POPULAR_TOKENS_CACHE[0]);
            this.cachedAssets.set('native', POPULAR_TOKENS_CACHE[0]);

            // Process STON.fi assets
            if (data.asset_list && Array.isArray(data.asset_list)) {
                // Filter to get high liquidity tokens first, then popular ones
                const sortedAssets = data.asset_list
                    .filter((a: any) => !a.blacklisted && !a.deprecated)
                    .sort((a: any, b: any) => (b.popularity_index || 0) - (a.popularity_index || 0))
                    .slice(0, 100); // Top 100 tokens

                for (const asset of sortedAssets) {
                    if (asset.symbol === 'TON') continue; // Skip duplicate TON

                    const token: TokenMetadata = {
                        symbol: asset.symbol || 'Unknown',
                        name: asset.display_name || asset.symbol || 'Unknown',
                        decimals: asset.decimals || 9,
                        imageUrl: asset.image_url || FALLBACK_ICON,
                        contractAddress: asset.contract_address || '',
                    };

                    assets.push(token);
                    this.cachedAssets.set(asset.contract_address, token);
                }
            }

            this.assetsLoaded = true;
            console.log('[TokenDiscovery] Loaded', assets.length, 'assets');
            return assets;
        } catch (error) {
            console.error('[TokenDiscovery] Error loading assets:', error);
            return POPULAR_TOKENS_CACHE;
        }
    }

    /**
     * Lookup token metadata by contract address
     * Used when user pastes a contract address for swapping
     */
    async lookupToken(contractAddress: string): Promise<TokenMetadata | null> {
        // Check cache first
        if (this.cachedAssets.has(contractAddress)) {
            return this.cachedAssets.get(contractAddress) || null;
        }

        try {
            // Try TONAPI for jetton metadata
            const response = await fetch(`${this.apiBase}/jettons/${contractAddress}`, {
                headers: { 'Accept': 'application/json' }
            });

            if (response.ok) {
                const data = await response.json();
                const metadata = data.metadata;

                const token: TokenMetadata = {
                    symbol: metadata?.symbol || 'Unknown',
                    name: metadata?.name || 'Unknown Token',
                    decimals: metadata?.decimals || 9,
                    imageUrl: metadata?.image || FALLBACK_ICON,
                    contractAddress: contractAddress,
                };

                this.cachedAssets.set(contractAddress, token);
                return token;
            }
        } catch (error) {
            console.error('[TokenDiscovery] Error looking up token:', error);
        }

        return null;
    }

    /**
     * Search tokens by symbol or name
     */
    searchTokens(tokens: TokenMetadata[], query: string): TokenMetadata[] {
        if (!query.trim()) return tokens;

        const search = query.toLowerCase().trim();
        return tokens.filter(t =>
            t.symbol.toLowerCase().includes(search) ||
            t.name.toLowerCase().includes(search) ||
            t.contractAddress.toLowerCase().includes(search)
        );
    }

    /**
     * Get popular tokens for quick swap access
     */
    getPopularTokens(): TokenMetadata[] {
        return POPULAR_TOKENS_CACHE;
    }
}

export const tokenDiscoveryService = new TokenDiscoveryService();
export default tokenDiscoveryService;
