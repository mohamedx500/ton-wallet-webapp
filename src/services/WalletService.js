/**
 * WalletService - Handles wallet creation and transactions
 * Supports V3R2, V4R2 with real blockchain integration
 * Supports TON and Jetton (USDT, etc.) transfers
 */

import { Buffer } from 'buffer';
import { mnemonicNew, mnemonicToPrivateKey } from '@ton/crypto';
import {
    WalletContractV3R2,
    WalletContractV4,
    TonClient,
    internal,
} from '@ton/ton';
import {
    Address,
    beginCell,
    toNano,
    Cell,
    contractAddress,
    SendMode,
} from '@ton/core';
import { HighloadWalletV3, HighloadQueryId, QueryIdStore } from '../wallets/highload-v3/index.ts';

// =============================================================================
// WALLET CONTRACT CODES (Lazy-loaded to prevent module load errors)
// =============================================================================

let HIGHLOAD_V3_CODE = null;
let WALLET_V5_CODE = null;

/**
 * Get Highload Wallet V3 contract code (lazy-loaded)
 */
function getHighloadV3Code() {
    if (!HIGHLOAD_V3_CODE) {
        try {
            HIGHLOAD_V3_CODE = Cell.fromBoc(
                Buffer.from(
                    'b5ee9c7241021001000228000114ff00f4a413f4bcf2c80b01020120020d02014803040078d020d74bc00101c060b0915be101d0d3030171b0915be0fa4030f828c705b39130e0d31f018210ae42e5a4ba9d8040d721d74cf82a01ed55fb04e030020120050a02027306070011adce76a2686b85ffc00201200809001aabb6ed44d0810122d721d70b3f0018aa3bed44d08307d721d70b1f0201200b0c001bb9a6eed44d0810162d721d70b15800e5b8bf2eda2edfb21ab09028409b0ed44d0810120d721f404f404d33fd315d1058e1bf82325a15210b99f326df82305aa0015a112b992306dde923033e2923033e25230800df40f6fa19ed021d721d70a00955f037fdb31e09130e259800df40f6fa19cd001d721d70a00937fdb31e0915be270801f6f2d48308d718d121f900ed44d0d3ffd31ff404f404d33fd315d1f82321a15220b98e12336df82324aa00a112b9926d32de58f82301de541675f910f2a106d0d31fd4d307d30cd309d33fd315d15168baf2a2515abaf2a6f8232aa15250bcf2a304f823bbf2a35304800df40f6fa199d024d721d70a00f2649130e20e01fe5309800df40f6fa18e13d05004d718d20001f264c858cf16cf8301cf168e1030c824cf40cf8384095005a1a514cf40e2f800c94039800df41704c8cbff13cb1ff40012f40012cb3f12cb15c9ed54f80f21d0d30001f265d3020171b0925f03e0fa4001d70b01c000f2a5fa4031fa0031f401fa0031fa00318060d721d300010f0020f265d2000193d431d19130e272b1fb00b585bf03',
                    'hex'
                )
            )[0];
        } catch (error) {
            console.error('Failed to load Highload V3 contract code:', error);
            throw new Error('Highload V3 contract code failed to load');
        }
    }
    return HIGHLOAD_V3_CODE;
}

/**
 * Get Wallet V5R1 contract code (lazy-loaded)
 */
function getWalletV5Code() {
    if (!WALLET_V5_CODE) {
        try {
            // Official V5R1 contract code from ton-blockchain/wallet-contract-v5
            WALLET_V5_CODE = Cell.fromBoc(
                Buffer.from(
                    'b5ee9c7241021401000281000114ff00f4a413f4bcf2c80b01020120020d020148030402dcd020d749c120915b8f6320d70b1f2082106578746ebd21821073696e74bdb0925f03e082106578746eba8eb48020d72101d074d721fa4030fa44f828fa443058bd915be0ed44d0810141d721f4058307f40e6fa1319130e18040d721707fdb3ce03120d749810280b99130e070e2100f020120050c020120060902016e07080019adce76a2684020eb90eb85ffc00019af1df6a2684010eb90eb858fc00201480a0b0017b325fb51341c75c875c2c7e00011b262fb513435c280200019be5f0f6a2684080a0eb90fa02c0102f20e011e20d70b1f82107369676ebaf2e08a7f0f01e68ef0eda2edfb218308d722028308d723208020d721d31fd31fd31fed44d0d200d31f20d31fd3ffd70a000af90140ccf9109a28945f0adb31e1f2c087df02b35007b0f2d0845125baf2e0855036baf2e086f823bbf2d0882292f800de01a47fc8ca00cb1f01cf16c9ed542092f80fde70db3cd81003f6eda2edfb02f404216e926c218e4c0221d73930709421c700b38e2d01d72820761e436c20d749c008f2e09320d74ac002f2e09320d71d06c712c2005230b0f2d089d74cd7393001a4e86c128407bbf2e093d74ac000f2e093ed55e2d20001c000915be0ebd72c08142091709601d72c081c12e25210b1e30f20d74a111213009601fa4001fa44f828fa443058baf2e091ed44d0810141d718f405049d7fc8ca0040048307f453f2e08b8e14038307f45bf2e08c22d70a00216e01b3b0f2d090e2c85003cf1612f400c9ed54007230d72c08248e2d21f2e092d200ed44d0d2005113baf2d08f54503091319c01810140d721d70a00f2e08ee2c8ca0058cf16c9ed5493f2c08de20010935bdb31e1d74cd0b4d6c35e',
                    'hex'
                )
            )[0];
        } catch (error) {
            console.error('Failed to load Wallet V5 contract code:', error);
            throw new Error('Wallet V5 contract code failed to load');
        }
    }
    return WALLET_V5_CODE;
}

// =============================================================================
// WALLET SERVICE CLASS
// =============================================================================

export class WalletService {
    constructor() {
        this.clients = {
            mainnet: null,
            testnet: null,
        };
    }

    /**
     * Get TonClient for network with retry configuration
     */
    getClient(testnet = false) {
        const network = testnet ? 'testnet' : 'mainnet';

        if (!this.clients[network]) {
            const endpoint = testnet
                ? 'https://testnet.toncenter.com/api/v2/jsonRPC'
                : 'https://toncenter.com/api/v2/jsonRPC';

            // Add API key for better reliability (from .env)
            const apiKey = testnet
                ? null // Testnet typically doesn't need API key
                : (import.meta.env.VITE_TONCENTER_API_KEY || null); // Toncenter API key from .env

            this.clients[network] = new TonClient({
                endpoint,
                apiKey: apiKey,  // ✅ Add API key
                timeout: 30000,
            });
        }

        return this.clients[network];
    }

    /**
     * Sleep helper for retry delays
     */
    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Retry a function with exponential backoff
     */
    async withRetry(fn, maxRetries = 3, baseDelay = 2000) {
        let lastError;

        for (let i = 0; i < maxRetries; i++) {
            try {
                return await fn();
            } catch (error) {
                lastError = error;
                const errorStr = error.message || '';

                if (errorStr.includes('429') || errorStr.includes('rate') || errorStr.includes('Too Many')) {
                    const delay = baseDelay * Math.pow(2, i);
                    console.log(`Rate limited, retrying in ${delay}ms... (attempt ${i + 1}/${maxRetries})`);
                    await this.sleep(delay);
                } else {
                    throw error;
                }
            }
        }

        throw lastError;
    }

    /**
     * Get private key from mnemonic
     * @param {string[]} mnemonic 
     * @returns {Promise<string>} Hex string of private key
     */
    async getPrivateKey(mnemonic) {
        if (!mnemonic || mnemonic.length === 0) throw new Error('Mnemonic required');
        const key = await mnemonicToPrivateKey(mnemonic);
        return key.secretKey.toString('hex');
    }

    /**
     * Generate new mnemonic
     */
    async generateMnemonic() {
        return await mnemonicNew(24);
    }

    /**
     * Resolve address or domain
     */
    async resolveAddress(client, input) {
        if (!input) throw new Error('Address required');

        // Check if it is a domain
        if (typeof input === 'string' && input.toLowerCase().endsWith('.ton')) {
            console.log(`Resolving DNS: ${input}`);
            const resolved = await client.dns.getWalletAddress(input);
            if (!resolved) throw new Error(`Could not resolve domain: ${input}`);
            console.log(`Resolved: ${resolved.toString()}`);
            return resolved;
        }

        // Standard address parsing
        if (typeof input === 'string') {
            return Address.parse(input);
        }
        return input;
    }

    /**
     * Import wallet from mnemonic
     */
    async importWallet(mnemonic, walletType = 'v4r2', testnet = false) {
        try {
            const keyPair = await mnemonicToPrivateKey(mnemonic);

            let wallet;
            let address;

            switch (walletType) {
                case 'v3r2':
                    wallet = WalletContractV3R2.create({
                        publicKey: keyPair.publicKey,
                        workchain: 0,
                    });
                    address = wallet.address.toString({ bounceable: false, testOnly: testnet });
                    break;

                case 'v4r2':
                    wallet = WalletContractV4.create({
                        publicKey: keyPair.publicKey,
                        workchain: 0,
                    });
                    address = wallet.address.toString({ bounceable: false, testOnly: testnet });
                    break;

                case 'v5r1': {
                    try {
                        console.log('Creating V5R1 wallet...');

                        // V5R1 wallet with proper contract code
                        const subwalletId = 698983191; // Default subwallet ID for V5
                        const v5Code = getWalletV5Code();

                        const v5Data = beginCell()
                            .storeUint(1, 1) // seqno_enabled flag
                            .storeUint(0, 32) // seqno
                            .storeUint(subwalletId, 32) // wallet_id
                            .storeBuffer(keyPair.publicKey, 32) // public_key
                            .storeBit(false) // extensions dict empty
                            .endCell();

                        const v5Init = { code: v5Code, data: v5Data };
                        const v5Address = contractAddress(0, v5Init);
                        address = v5Address.toString({ bounceable: false, testOnly: testnet });

                        // Create a minimal wallet object for compatibility
                        // Note: Transaction sending for v5r1 requires proper wallet contract wrapper
                        wallet = {
                            address: v5Address,
                            init: v5Init,
                        };
                        console.log('V5R1 wallet created with address:', address);
                    } catch (error) {
                        console.error('Error creating V5R1 wallet:', error);
                        throw new Error(`Failed to create V5R1 wallet: ${error.message}`);
                    }
                    break;
                }

                case 'highload-v3': {
                    try {
                        // Highload V3 wallet with proper contract code
                        const TIMESTAMP_SIZE_HL = 64;
                        const TIMEOUT_SIZE_HL = 22;
                        const subwalletIdHL = 698983191; // Default subwallet ID
                        const timeoutHL = 3600; // Default timeout
                        const hl3Code = getHighloadV3Code();

                        const hl3Data = beginCell()
                            .storeBuffer(keyPair.publicKey, 32)
                            .storeUint(subwalletIdHL, 32)
                            .storeUint(0, 1 + 1 + TIMESTAMP_SIZE_HL) // empty old_queries + empty queries + last_clean_time
                            .storeUint(timeoutHL, TIMEOUT_SIZE_HL)
                            .endCell();

                        const hl3Init = { code: hl3Code, data: hl3Data };
                        const hl3Address = contractAddress(0, hl3Init);
                        address = hl3Address.toString({ bounceable: false, testOnly: testnet });

                        // Create a minimal wallet object for compatibility
                        // Note: Transaction sending for highload-v3 requires proper wallet contract wrapper
                        wallet = {
                            address: hl3Address,
                            init: hl3Init,
                        };
                        console.log('Highload V3 wallet created with address:', address);
                    } catch (error) {
                        console.error('Error creating Highload V3 wallet:', error);
                        throw new Error(`Failed to create Highload V3 wallet: ${error.message}`);
                    }
                    break;
                }

                default:
                    // Fallback to v4r2 for unknown wallet types
                    console.warn(`Unknown wallet type: ${walletType}, falling back to v4r2`);
                    wallet = WalletContractV4.create({
                        publicKey: keyPair.publicKey,
                        workchain: 0,
                    });
                    address = wallet.address.toString({ bounceable: false, testOnly: testnet });
                    break;
            }

            // Ensure address and wallet are defined
            if (!address || !wallet) {
                throw new Error(`Failed to create wallet of type: ${walletType}`);
            }

            return {
                type: walletType,
                address,
                publicKey: keyPair.publicKey.toString('hex'),
                wallet,
                keyPair,
            };
        } catch (error) {
            console.error('Error importing wallet:', error);
            // Fallback for v5r1 or highload-v3 if contract code fails
            if ((walletType === 'v5r1' || walletType === 'highload-v3') &&
                (error.message.includes('contract code') || error.message.includes('Wallet V5 contract code failed to load') || error.message.includes('Highload V3 contract code failed to load'))) {
                console.warn(`WARNING: ${walletType} wallet creation failed, falling back to V4R2. Error:`, error.message);
                console.warn(`This means ${walletType} contract code could not be loaded properly.`);
                // Return the fallback wallet with explicit type indication
                const fallbackWallet = await this.importWallet(mnemonic, 'v4r2', testnet);
                fallbackWallet.originalType = walletType; // Track original requested type
                fallbackWallet.fallbackReason = 'Contract code load failure';
                return fallbackWallet;
            }
            throw error;
        }
    }

    /**
     * Send TON transaction with retry logic
     */
    async sendTransaction(mnemonic, walletType, recipient, amount, comment = '', testnet = false) {
        const keyPair = await mnemonicToPrivateKey(mnemonic);
        const client = this.getClient(testnet);

        let wallet;

        switch (walletType) {
            case 'v3r2':
                wallet = client.open(WalletContractV3R2.create({
                    publicKey: keyPair.publicKey,
                    workchain: 0,
                }));
                break;

            case 'v4r2':
                wallet = client.open(WalletContractV4.create({
                    publicKey: keyPair.publicKey,
                    workchain: 0,
                }));
                break;

            case 'highload-v3':
                // Highload V3 uses different API
                return await this.sendHighloadTransaction(mnemonic, recipient, amount, comment, testnet);

            default:
                wallet = client.open(WalletContractV4.create({
                    publicKey: keyPair.publicKey,
                    workchain: 0,
                }));
                break;
        }

        // Get seqno with retry
        let seqno = 0;
        try {
            seqno = await this.withRetry(async () => {
                return await wallet.getSeqno();
            });
        } catch (e) {
            console.log('Could not get seqno, using 0:', e.message);
            seqno = 0;
        }

        // Build message body
        let body = undefined;
        if (comment) {
            body = beginCell()
                .storeUint(0, 32)
                .storeStringTail(comment)
                .endCell();
        }

        // Send transfer with retry
        await this.withRetry(async () => {
            await wallet.sendTransfer({
                secretKey: keyPair.secretKey,
                seqno,
                messages: [
                    internal({
                        to: await this.resolveAddress(client, recipient),
                        value: toNano(amount.toString()),
                        body,
                        bounce: false,
                    })
                ],
            });
        });

        return { success: true, seqno };
    }

    /**
     * Send TON transaction with custom Cell payload (for DEX swaps, etc.)
     * @param {string[]} mnemonic - Wallet mnemonic
     * @param {string} walletType - Wallet version
     * @param {string} recipient - Recipient address
     * @param {string} amount - Amount in TON
     * @param {Cell} body - Custom Cell payload
     * @param {boolean} testnet - Network
     */
    async sendTransactionWithPayload(mnemonic, walletType, recipient, amount, body, testnet = false) {
        console.log('[WalletService] sendTransactionWithPayload:', { recipient, amount, hasBody: !!body });

        const keyPair = await mnemonicToPrivateKey(mnemonic);
        const client = this.getClient(testnet);

        let wallet;

        switch (walletType) {
            case 'v3r2':
                wallet = client.open(WalletContractV3R2.create({
                    publicKey: keyPair.publicKey,
                    workchain: 0,
                }));
                break;

            case 'v4r2':
                wallet = client.open(WalletContractV4.create({
                    publicKey: keyPair.publicKey,
                    workchain: 0,
                }));
                break;

            case 'highload-v3':
                // Highload V3 uses different API
                return await this.sendHighloadTransactionWithPayload(mnemonic, recipient, amount, body, testnet);

            default:
                wallet = client.open(WalletContractV4.create({
                    publicKey: keyPair.publicKey,
                    workchain: 0,
                }));
                break;
        }

        // Get seqno with retry
        let seqno = 0;
        try {
            seqno = await this.withRetry(async () => {
                return await wallet.getSeqno();
            });
        } catch (e) {
            console.log('Could not get seqno, using 0:', e.message);
            seqno = 0;
        }

        // Send transfer with custom body
        await this.withRetry(async () => {
            await wallet.sendTransfer({
                secretKey: keyPair.secretKey,
                seqno,
                messages: [
                    internal({
                        to: await this.resolveAddress(client, recipient),
                        value: toNano(amount.toString()),
                        body: body, // Custom Cell payload
                        bounce: false,
                    })
                ],
            });
        });

        console.log('[WalletService] Transaction with payload sent successfully');
        return { success: true, seqno };
    }

    /**
     * Send Highload V3 transaction with custom Cell payload
     */
    async sendHighloadTransactionWithPayload(mnemonic, recipient, amount, body, testnet = false) {
        console.log('=== HIGHLOAD TRANSACTION WITH PAYLOAD ===');
        console.log('Parameters: recipient=', recipient, 'amount=', amount, 'hasBody=', !!body);

        const SUBWALLET_ID = 698983191;
        const TIMEOUT = 3600;

        try {
            const numericAmount = parseFloat(amount);
            if (isNaN(numericAmount) || numericAmount <= 0) {
                throw new Error('Invalid amount: must be a positive number');
            }

            const client = this.getClient(testnet);
            const parsedAddress = await this.resolveAddress(client, recipient);
            const keyPair = await mnemonicToPrivateKey(mnemonic);

            const wallet = client.open(
                HighloadWalletV3.createFromConfig(
                    { publicKey: keyPair.publicKey, subwalletId: SUBWALLET_ID, timeout: TIMEOUT },
                    getHighloadV3Code()
                )
            );

            // Build internal message WITH the payload body
            const internalMessage = internal({
                to: parsedAddress,
                value: toNano(numericAmount.toString()),
                body: body, // Custom Cell payload for swap
                bounce: false,
            });

            const offsets = [30, 60, 120, 180];
            let lastError = null;

            for (const offset of offsets) {
                const createdAt = Math.floor(Date.now() / 1000) - offset;
                const now = Date.now();
                const shift = Math.floor(now / 1000) % 8192;
                const bitNumber = now % 1023;
                const queryId = HighloadQueryId.fromShiftAndBitNumber(shift, bitNumber);

                try {
                    await wallet.sendExternalMessage(keyPair.secretKey, {
                        message: internalMessage,
                        mode: SendMode.PAY_GAS_SEPARATELY,
                        query_id: queryId,
                        createdAt: createdAt,
                        subwalletId: SUBWALLET_ID,
                        timeout: TIMEOUT,
                    });

                    console.log('SUCCESS! Swap transaction sent!');
                    return { success: true, seqno: queryId.getQueryId().toString() };

                } catch (error) {
                    console.log(`Failed with offset ${offset}s: ${error.message}`);
                    lastError = error;
                }
            }

            throw lastError || new Error('All timestamp offsets failed');

        } catch (error) {
            console.error('Error sending highload transaction with payload:', error);
            throw new Error(`Failed to send swap transaction: ${error.message}`);
        }
    }

    /**
     * Send Highload V3 transaction
     */
    async sendHighloadTransaction(mnemonic, recipient, amount, comment = '', testnet = false) {
        console.log('=== HIGHLOAD TRANSACTION DEBUG ===');
        console.log('Parameters received:');
        console.log('- mnemonic:', mnemonic ? '[REDACTED]' : 'undefined');
        console.log('- recipient:', recipient);
        console.log('- amount:', amount);
        console.log('- comment:', comment);
        console.log('- testnet:', testnet);
        console.log('================================');

        const SUBWALLET_ID = 698983191;
        const TIMEOUT = 3600;

        try {
            // Validate amount parameter
            if (amount === undefined || amount === null || amount === '') {
                throw new Error('Amount is required for transaction');
            }

            const numericAmount = parseFloat(amount);
            if (isNaN(numericAmount) || numericAmount <= 0) {
                throw new Error('Invalid amount: must be a positive number');
            }

            // Validate recipient address
            if (!recipient || recipient === '') {
                throw new Error('Recipient address is required for transaction');
            }

            console.log('Testing address parsing...');
            const client = this.getClient(testnet);
            const parsedAddress = await this.resolveAddress(client, recipient);
            console.log('✅ Recipient address parsed successfully:', parsedAddress.toString());

            const keyPair = await mnemonicToPrivateKey(mnemonic);

            // Create wallet instance using client.open() - this binds the provider automatically
            console.log('Creating HighloadWalletV3 instance...');
            const wallet = client.open(
                HighloadWalletV3.createFromConfig(
                    { publicKey: keyPair.publicKey, subwalletId: SUBWALLET_ID, timeout: TIMEOUT },
                    getHighloadV3Code()
                )
            );

            const walletAddress = wallet.address.toString({ bounceable: true });
            console.log('✅ Wallet address:', walletAddress);

            // Build internal message
            const internalMessage = internal({
                to: parsedAddress,
                value: toNano(numericAmount.toString()),
                bounce: false,
            });

            // Try multiple createdAt offsets
            const offsets = [30, 60, 120, 180];
            let lastError = null;

            for (const offset of offsets) {
                const createdAt = Math.floor(Date.now() / 1000) - offset;
                console.log(`Trying with createdAt offset: ${offset}s (ts=${createdAt})`);

                // Generate a UNIQUE query_id based on current time
                const now = Date.now();
                const shift = Math.floor(now / 1000) % 8192;
                const bitNumber = now % 1023;
                const queryId = HighloadQueryId.fromShiftAndBitNumber(shift, bitNumber);
                console.log(`Query ID: shift=${shift}, bitNumber=${bitNumber} (unique: ${queryId.getQueryId()})`);

                try {
                    // The key: client.open() returns a proxy that auto-injects provider as first arg
                    // So we call: wallet.sendExternalMessage(secretKey, opts)
                    await wallet.sendExternalMessage(keyPair.secretKey, {
                        message: internalMessage,
                        mode: SendMode.PAY_GAS_SEPARATELY,
                        query_id: queryId,
                        createdAt: createdAt,
                        subwalletId: SUBWALLET_ID,
                        timeout: TIMEOUT,
                    });

                    console.log('SUCCESS! Transfer sent!');
                    console.log(`View: https://tonviewer.com/${walletAddress}`);
                    return { success: true, seqno: queryId.getQueryId().toString() };

                } catch (error) {
                    console.log(`Failed with offset ${offset}s: ${error.message}`);
                    lastError = error;

                    // Check for specific error codes
                    if (error.response?.data) {
                        console.log(`Response: ${JSON.stringify(error.response.data)}`);
                    }
                }
            }

            // All attempts failed
            throw lastError || new Error('All timestamp offsets failed');

        } catch (error) {
            console.error('Error sending highload transaction:', error);
            throw new Error(`Failed to send highload transaction: ${error.message}`);
        }
    }

    /**
     * Send Jetton (USDT, etc.) token transfer
     * @param {string[]} mnemonic - Wallet mnemonic
     * @param {string} walletType - Wallet version
     * @param {string} jettonWalletAddress - The sender's jetton wallet address
     * @param {string} recipientAddress - The recipient's TON address
     * @param {number} amount - Amount in token units (not nano)
     * @param {number} decimals - Token decimals (default 6 for USDT)
     * @param {string} comment - Optional comment
     * @param {boolean} testnet - Network
     */
    async sendJettonTransfer(mnemonic, walletType, jettonWalletAddress, recipientAddress, amount, decimals = 6, comment = '', testnet = false) {
        const keyPair = await mnemonicToPrivateKey(mnemonic);
        const client = this.getClient(testnet);

        // Resolve recipient address first (handle domains)
        const resolvedRecipient = await this.resolveAddress(client, recipientAddress);

        // Calculate amount in smallest units
        const jettonAmount = BigInt(Math.floor(amount * Math.pow(10, decimals)));

        // Build forward payload (comment)
        let forwardPayload = beginCell().endCell();
        if (comment) {
            forwardPayload = beginCell()
                .storeUint(0, 32) // op code for text comment
                .storeStringTail(comment)
                .endCell();
        }

        // Build jetton transfer body
        // TEP-74: https://github.com/ton-blockchain/TEPs/blob/master/text/0074-jettons-standard.md
        const jettonTransferBody = beginCell()
            .storeUint(0xf8a7ea5, 32) // op::transfer
            .storeUint(0, 64) // query_id
            .storeCoins(jettonAmount) // amount
            .storeAddress(resolvedRecipient) // destination
            .storeAddress(resolvedRecipient) // response_destination (send excess back to recipient)
            .storeBit(0) // no custom payload
            .storeCoins(toNano('0.01')) // forward_ton_amount (for notification)
            .storeBit(1) // store forward payload as ref
            .storeRef(forwardPayload)
            .endCell();

        console.log('Sending jetton transfer:', {
            jettonWallet: jettonWalletAddress,
            recipient: recipientAddress,
            amount: amount,
            decimals: decimals,
            jettonAmount: jettonAmount.toString(),
            walletType
        });

        let wallet;

        switch (walletType) {
            case 'v3r2':
                wallet = client.open(WalletContractV3R2.create({
                    publicKey: keyPair.publicKey,
                    workchain: 0,
                }));
                break;

            case 'v4r2':
                wallet = client.open(WalletContractV4.create({
                    publicKey: keyPair.publicKey,
                    workchain: 0,
                }));
                break;

            case 'highload-v3':
                // Send using Highload V3 specifics
                // We send 0.05 TON to the jetton wallet, with the transfer body
                return await this.sendHighloadTransactionWithPayload(
                    mnemonic,
                    jettonWalletAddress,
                    '0.05', // Attached value for processing
                    jettonTransferBody,
                    testnet
                );

            default:
                wallet = client.open(WalletContractV4.create({
                    publicKey: keyPair.publicKey,
                    workchain: 0,
                }));
                break;
        }

        // Standard Wallet Logic (V3/V4)

        // Get seqno with retry
        let seqno = 0;
        try {
            seqno = await this.withRetry(async () => {
                return await wallet.getSeqno();
            });
        } catch (e) {
            console.log('Could not get seqno, using 0:', e.message);
            seqno = 0;
        }

        // Send transfer with retry
        await this.withRetry(async () => {
            await wallet.sendTransfer({
                secretKey: keyPair.secretKey,
                seqno,
                messages: [
                    internal({
                        to: Address.parse(jettonWalletAddress),
                        value: toNano('0.05'), // Gas for jetton transfer
                        body: jettonTransferBody,
                        bounce: true,
                    })
                ],
            });
        });

        return { success: true, seqno };
    }

    /**
     * Get jetton wallet address for a user
     */
    async getJettonWalletAddress(ownerAddress, jettonMasterAddress, testnet = false) {
        try {
            const endpoint = testnet
                ? 'https://testnet.tonapi.io/v2'
                : 'https://tonapi.io/v2';

            const response = await fetch(
                `${endpoint}/accounts/${encodeURIComponent(ownerAddress)}/jettons/${encodeURIComponent(jettonMasterAddress)}`
            );

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            return data.wallet_address?.address || null;
        } catch (error) {
            console.error('Error getting jetton wallet address:', error);
            return null;
        }
    }
}
