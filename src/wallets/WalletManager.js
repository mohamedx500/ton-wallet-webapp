/**
 * WalletManager - Handles all TON wallet types
 * Supports: V1R1-V1R3, V2R1-V2R2, V3R1-V3R2, V4R2, V5R1, Highload V1-V3
 */

import { mnemonicNew, mnemonicToPrivateKey } from '@ton/crypto';
import {
    WalletContractV1R1,
    WalletContractV1R2,
    WalletContractV1R3,
    WalletContractV2R1,
    WalletContractV2R2,
    WalletContractV3R1,
    WalletContractV3R2,
    WalletContractV4,
} from '@ton/ton';
import {
    Address,
    beginCell,
    Cell,
    contractAddress,
} from '@ton/core';

// =============================================================================
// WALLET CONTRACT CODES
// =============================================================================

/**
 * Highload Wallet V3 contract code (BOC)
 * Source: https://github.com/ton-blockchain/highload-wallet-contract-v3
 */
const HIGHLOAD_V3_CODE = Cell.fromBoc(
    Buffer.from(
        'b5ee9c7241021001000228000114ff00f4a413f4bcf2c80b01020120020d02014803040078d020d74bc00101c060b0915be101d0d3030171b0915be0fa4030f828c705b39130e0d31f018210ae42e5a4ba9d8040d721d74cf82a01ed55fb04e030020120050a02027306070011adce76a2686b85ffc00201200809001aabb6ed44d0810122d721d70b3f0018aa3bed44d08307d721d70b1f0201200b0c001bb9a6eed44d0810162d721d70b15800e5b8bf2eda2edfb21ab09028409b0ed44d0810120d721f404f404d33fd315d1058e1bf82325a15210b99f326df82305aa0015a112b992306dde923033e2923033e25230800df40f6fa19ed021d721d70a00955f037fdb31e09130e259800df40f6fa19cd001d721d70a00937fdb31e0915be270801f6f2d48308d718d121f900ed44d0d3ffd31ff404f404d33fd315d1f82321a15220b98e12336df82324aa00a112b9926d32de58f82301de541675f910f2a106d0d31fd4d307d30cd309d33fd315d15168baf2a2515abaf2a6f8232aa15250bcf2a304f823bbf2a35304800df40f6fa199d024d721d70a00f2649130e20e01fe5309800df40f6fa18e13d05004d718d20001f264c858cf16cf8301cf168e1030c824cf40cf8384095005a1a514cf40e2f800c94039800df41704c8cbff13cb1ff40012f40012cb3f12cb15c9ed54f80f21d0d30001f265d3020171b0925f03e0fa4001d70b01c000f2a5fa4031fa0031f401fa0031fa00318060d721d300010f0020f265d2000193d431d19130e272b1fb00b585bf03',
        'hex'
    )
)[0];

/**
 * Highload Wallet V2 contract code (BOC)
 */
const HIGHLOAD_V2_CODE = Cell.fromBoc(
    Buffer.from(
        'B5EE9C724101090100E5000114FF00F4A413F4BCF2C80B010201200203020148040501EAF28308D71820D31FD33FF823AA1F5320B9F263ED44D0D31FD33FD3FFF404D153608040F40E6FA131F2605173BAF2A207F901541087F910F2A302F404D1F8007F8E16218010F4786FA5209802D307D43001FB009132E201B3E65B01A4D15CD5B1BE9132E2019007E8E201B3E30D0201D50C070017BD9CE76A26869AF98EB85FFC0041BE5F976A268698F98E99FE9FF98FA0268A91040207A0737D098C92DBFC95DD1F140034208040F4966FA56C122094305303B9DE2093333601926C21E2B39F9E545A',
        'hex'
    )
)[0];

/**
 * Highload Wallet V1 contract code (BOC)
 */
const HIGHLOAD_V1_CODE = Cell.fromBoc(
    Buffer.from(
        'B5EE9C724101090100E0000114FF00F4A413F4BCF2C80B010201200203020148040501EAF28308D71820D31FD33FF823AA1F5320B9F263ED44D0D31FD33FD3FFF404D153608040F40E6FA131F2605173BAF2A207F901541087F910F2A302F404D1F8007F8E16218010F4786FA5209802D307D43001FB009132E201B3E65B01A4D15CD5B1BE9132E2019007E8E201B3E30D0201AD0607000BE9A8D15608EB85FFFE0041BE5F976A268698F98E99FE9FF98FA0268A91040207A0737D098C92DBFC95DD1F1400044208040F4966FA56C122094305303B9DE2093333601926C21E2B39F9E545A',
        'hex'
    )
)[0];

/**
 * Wallet V5R1 (W5) contract code (BOC)
 */
const WALLET_V5_CODE = Cell.fromBoc(
    Buffer.from(
        'b5ee9c7241021401000281000114ff00f4a413f4bcf2c80b01020120020d020148030402dcd020d749c120915b8e09130e30d31f01c0028e430221c0008e24c200200835c87b513e9054130b4c7c0038e2f8325c7c1f2afc87c038d8c000a3d0b9c5001a4e350c1fccc7c0c8d5d9ec5c0e4e84003c0c1fccc7c15f901b1cfc900d0e21400c3c00925f03e0fa403020fa4401c8ca07cbffc9d0500e0113e910c10228e36d70b00e2a1c2fff2aff82a0be10210354e46c8cc020120050c0201200607020120080b0025bc82df6a2687d20699fea6a6a182de86a182c40043b8b5d31ed44d0fa40d33fd4d4d43010245f04d0d431d430d071c8cb0701cf16ccc980201200a09003d45af0047028103104039f8256eb8c14800e7807800a00a4600a68a8800a18020158ae30db3c01a40043232c1540173c59400fe8084f2da84b2c7f2cfc0778a9802e0d0d30701c000f2e0c8c2120c01f2afc82a54f00bc200a20be9045134fa00d4d43002143082103b9aca0015bef2e0c8f2afc87c040b8fe130b020120100f0039d1c32243e21f0034bef28228103a3c8258de33c58073c5b33248b232c044bd003d0032c032483e401c1d3232c0b281f2fff274140371c1472c7cb8b0c2be80146a2860822625a020822625a004ad822860822625a028062849e5c412440e0dd7c1380c0dd7c0c8d5d9ec580c00d635c2c7f2c1d4c03c03c3c078c3e0e26e2a1f0b8d00e03c00b232ccc93c00c2c03c00b23230d33232c0b281e9002500a232c7c600a232c7c671f2c1d633c58073c5b3327b55208c232633c58073c5b33248b232c044bd003d0032c032c07000be010c20835d270803cb8b17c92e2c110f2d193',
        'hex'
    )
)[0];

// =============================================================================
// WALLET MANAGER CLASS
// =============================================================================

export class WalletManager {
    constructor() {
        this.walletTypes = {
            // Standard Wallets
            'v1r1': { name: 'Wallet V1R1', class: WalletContractV1R1 },
            'v1r2': { name: 'Wallet V1R2', class: WalletContractV1R2 },
            'v1r3': { name: 'Wallet V1R3', class: WalletContractV1R3 },
            'v2r1': { name: 'Wallet V2R1', class: WalletContractV2R1 },
            'v2r2': { name: 'Wallet V2R2', class: WalletContractV2R2 },
            'v3r1': { name: 'Wallet V3R1', class: WalletContractV3R1 },
            'v3r2': { name: 'Wallet V3R2', class: WalletContractV3R2 },
            'v4r2': { name: 'Wallet V4R2', class: WalletContractV4 },
            'v5r1': { name: 'Wallet V5R1', code: WALLET_V5_CODE },

            // Highload Wallets
            'highload-v1': { name: 'Highload V1', code: HIGHLOAD_V1_CODE },
            'highload-v2': { name: 'Highload V2', code: HIGHLOAD_V2_CODE },
            'highload-v3': { name: 'Highload V3', code: HIGHLOAD_V3_CODE },
        };
    }

    /**
     * Generate a new wallet
     */
    async generateWallet(options) {
        const {
            type,
            subwalletId = 698983191,
            workchain = 0,
            timeout = 3600,
            testnet = false,
        } = options;

        // Generate new mnemonic
        const mnemonic = await mnemonicNew(24);
        const keyPair = await mnemonicToPrivateKey(mnemonic);

        // Create wallet based on type
        const wallet = await this._createWallet(type, keyPair.publicKey, {
            subwalletId,
            workchain,
            timeout,
        });

        return {
            type,
            mnemonic,
            publicKey: keyPair.publicKey.toString('hex'),
            privateKey: keyPair.secretKey.toString('hex'),
            address: {
                bounceable: wallet.address.toString({ bounceable: true, testOnly: testnet }),
                nonBounceable: wallet.address.toString({ bounceable: false, testOnly: testnet }),
                raw: wallet.address.toRawString(),
            },
            subwalletId,
            workchain,
            timeout,
            testnet,
        };
    }

    /**
     * Import wallet from mnemonic and generate all addresses
     */
    async importMnemonic(mnemonic, options = {}) {
        const { testnet = false } = options;

        const keyPair = await mnemonicToPrivateKey(mnemonic);
        const results = [];

        // Generate addresses for all wallet types
        for (const [type, config] of Object.entries(this.walletTypes)) {
            try {
                const wallet = await this._createWallet(type, keyPair.publicKey, {
                    subwalletId: 698983191,
                    workchain: 0,
                    timeout: 3600,
                });

                results.push({
                    type,
                    name: config.name,
                    address: wallet.address.toString({ bounceable: true, testOnly: testnet }),
                });
            } catch (error) {
                console.warn(`Could not create ${type} wallet:`, error);
            }
        }

        return results;
    }

    /**
     * Create wallet instance based on type
     */
    async _createWallet(type, publicKey, options) {
        const { subwalletId, workchain, timeout } = options;
        const config = this.walletTypes[type];

        if (!config) {
            throw new Error(`Unknown wallet type: ${type}`);
        }

        // Standard wallets with class
        if (config.class) {
            switch (type) {
                case 'v1r1':
                case 'v1r2':
                case 'v1r3':
                    return config.class.create({ publicKey, workchain });

                case 'v2r1':
                case 'v2r2':
                    return config.class.create({ publicKey, workchain });

                case 'v3r1':
                case 'v3r2':
                    return config.class.create({ publicKey, workchain, walletId: subwalletId });

                case 'v4r2':
                    return config.class.create({ publicKey, workchain, walletId: subwalletId });
            }
        }

        // Custom wallet implementations
        switch (type) {
            case 'v5r1':
                return this._createWalletV5(publicKey, subwalletId, workchain);

            case 'highload-v1':
                return this._createHighloadV1(publicKey, subwalletId, workchain);

            case 'highload-v2':
                return this._createHighloadV2(publicKey, subwalletId, workchain);

            case 'highload-v3':
                return this._createHighloadV3(publicKey, subwalletId, workchain, timeout);
        }

        throw new Error(`Wallet type ${type} not implemented`);
    }

    /**
     * Create Wallet V5R1 (W5)
     */
    _createWalletV5(publicKey, walletId, workchain) {
        // V5 context ID for mainnet
        const WALLET_V5_BETA_NETWORK_GLOBAL_ID = -239;
        const WALLET_V5_BETA_WORKCHAIN = 0;

        const data = beginCell()
            .storeUint(1, 1) // seqno_enabled flag
            .storeUint(0, 32) // seqno
            .storeUint(walletId, 32) // wallet_id
            .storeBuffer(publicKey, 32) // public_key
            .storeBit(false) // extensions dict empty
            .endCell();

        const init = { code: WALLET_V5_CODE, data };
        const address = contractAddress(workchain, init);

        return { address, init };
    }

    /**
     * Create Highload Wallet V1
     */
    _createHighloadV1(publicKey, subwalletId, workchain) {
        const data = beginCell()
            .storeBuffer(publicKey, 32)
            .storeUint(subwalletId, 32)
            .storeUint(0, 64) // last_cleaned
            .endCell();

        const init = { code: HIGHLOAD_V1_CODE, data };
        const address = contractAddress(workchain, init);

        return { address, init };
    }

    /**
     * Create Highload Wallet V2
     */
    _createHighloadV2(publicKey, subwalletId, workchain) {
        const data = beginCell()
            .storeBuffer(publicKey, 32)
            .storeUint(subwalletId, 32)
            .storeUint(0, 64) // last_cleaned
            .storeBit(false) // old_queries dict empty
            .endCell();

        const init = { code: HIGHLOAD_V2_CODE, data };
        const address = contractAddress(workchain, init);

        return { address, init };
    }

    /**
     * Create Highload Wallet V3
     */
    _createHighloadV3(publicKey, subwalletId, workchain, timeout) {
        const TIMESTAMP_SIZE = 64;
        const TIMEOUT_SIZE = 22;

        const data = beginCell()
            .storeBuffer(publicKey, 32)
            .storeUint(subwalletId, 32)
            .storeUint(0, 1 + 1 + TIMESTAMP_SIZE) // empty old_queries + empty queries + last_clean_time
            .storeUint(timeout, TIMEOUT_SIZE)
            .endCell();

        const init = { code: HIGHLOAD_V3_CODE, data };
        const address = contractAddress(workchain, init);

        return { address, init };
    }
}
