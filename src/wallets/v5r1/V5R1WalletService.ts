/**
 * V5R1 Wallet Service
 * 
 * Implements the Wallet V5R1 (W5) contract with gasless transaction support.
 * V5 is the modern standard with extension support and gasless features.
 */

import { Buffer } from 'buffer';
import { TonClient, internal } from '@ton/ton';
import {
    Address,
    beginCell,
    toNano,
    Cell,
    contractAddress,
    SendMode,
    storeMessageRelaxed
} from '@ton/core';
import { mnemonicToPrivateKey, sign } from '@ton/crypto';
import type {
    WalletInfo,
    KeyPair,
    TransactionParams,
    TransactionResult,
    NetworkType,
    GaslessTransactionConfig
} from '../../types';
import { TON_CONSTANTS, DEFAULT_CONFIG } from '../../types';

/**
 * V5R1 Contract Code (Official from ton-blockchain/wallet-contract-v5)
 */
const V5R1_CODE_HEX = 'b5ee9c7241021401000281000114ff00f4a413f4bcf2c80b01020120020d020148030402dcd020d749c120915b8f6320d70b1f2082106578746ebd21821073696e74bdb0925f03e082106578746eba8eb48020d72101d074d721fa4030fa44f828fa443058bd915be0ed44d0810141d721f4058307f40e6fa1319130e18040d721707fdb3ce03120d749810280b99130e070e2100f020120050c020120060902016e07080019adce76a2684020eb90eb85ffc00019af1df6a2684010eb90eb858fc00201480a0b0017b325fb51341c75c875c2c7e00011b262fb513435c280200019be5f0f6a2684080a0eb90fa02c0102f20e011e20d70b1f82107369676ebaf2e08a7f0f01e68ef0eda2edfb218308d722028308d723208020d721d31fd31fd31fed44d0d200d31f20d31fd3ffd70a000af90140ccf9109a28945f0adb31e1f2c087df02b35007b0f2d0845125baf2e0855036baf2e086f823bbf2d0882292f800de01a47fc8ca00cb1f01cf16c9ed542092f80fde70db3cd81003f6eda2edfb02f404216e926c218e4c0221d73930709421c700b38e2d01d72820761e436c20d749c008f2e09320d74ac002f2e09320d71d06c712c2005230b0f2d089d74cd7393001a4e86c128407bbf2e093d74ac000f2e093ed55e2d20001c000915be0ebd72c08142091709601d72c081c12e25210b1e30f20d74a111213009601fa4001fa44f828fa443058baf2e091ed44d0810141d718f405049d7fc8ca0040048307f453f2e08b8e14038307f45bf2e08c22d70a00216e01b3b0f2d090e2c85003cf1612f400c9ed54007230d72c08248e2d21f2e092d200ed44d0d2005113baf2d08f54503091319c01810140d721d70a00f2e08ee2c8ca0058cf16c9ed5493f2c08de20010935bdb31e1d74cd0b4d6c35e';

/**
 * V5R1 Wallet Service with Gasless Support
 */
export class V5R1WalletService {
    private readonly network: NetworkType;
    private readonly workchain: number;
    private readonly code: Cell;

    constructor(network: NetworkType = 'mainnet') {
        this.network = network;
        this.workchain = TON_CONSTANTS.WORKCHAIN;
        this.code = Cell.fromBoc(Buffer.from(V5R1_CODE_HEX, 'hex'))[0];
    }

    /**
     * Create wallet from mnemonic
     */
    async createFromMnemonic(mnemonic: string[], subwalletId?: number): Promise<WalletInfo> {
        const keyPair = await mnemonicToPrivateKey(mnemonic);
        const walletId = subwalletId ?? DEFAULT_CONFIG.SUBWALLET_ID;

        const data = beginCell()
            .storeUint(1, 1)           // seqno_enabled flag
            .storeUint(0, 32)          // seqno
            .storeUint(walletId, 32)   // wallet_id
            .storeBuffer(keyPair.publicKey, 32) // public_key
            .storeBit(false)           // extensions dict empty
            .endCell();

        const init = { code: this.code, data };
        const walletAddress = contractAddress(this.workchain, init);

        const address = walletAddress.toString({
            bounceable: false,
            testOnly: this.network === 'testnet'
        });

        return {
            version: 'v5r1',
            address,
            rawAddress: walletAddress.toRawString(),
            publicKey: keyPair.publicKey.toString('hex'),
            keyPair,
            isDeployed: false,
            init,
        };
    }

    /**
     * Get contract code
     */
    getCode(): Cell {
        return this.code;
    }

    /**
     * Build wallet initial data
     */
    buildInitData(publicKey: Buffer, subwalletId?: number): Cell {
        const walletId = subwalletId ?? DEFAULT_CONFIG.SUBWALLET_ID;

        return beginCell()
            .storeUint(1, 1)
            .storeUint(0, 32)
            .storeUint(walletId, 32)
            .storeBuffer(publicKey, 32)
            .storeBit(false)
            .endCell();
    }

    /**
     * Send TON transaction (standard, with gas)
     */
    async sendTransaction(
        client: TonClient,
        keyPair: KeyPair,
        params: TransactionParams,
        subwalletId?: number
    ): Promise<TransactionResult> {
        try {
            const walletId = subwalletId ?? DEFAULT_CONFIG.SUBWALLET_ID;
            const data = this.buildInitData(keyPair.publicKey, walletId);
            const init = { code: this.code, data };
            const walletAddress = contractAddress(this.workchain, init);

            // Get current seqno
            let seqno = 0;
            try {
                const result = await client.runMethod(walletAddress, 'seqno');
                seqno = result.stack.readNumber();
            } catch {
                seqno = 0;
            }

            // Build message body
            let body: Cell | undefined;
            if (params.comment) {
                body = beginCell()
                    .storeUint(0, 32)
                    .storeStringTail(params.comment)
                    .endCell();
            }

            // Build internal message
            const internalMessage = internal({
                to: Address.parse(params.to),
                value: params.amount,
                body,
                bounce: params.bounce ?? false,
            });

            // Build V5 transfer
            const validUntil = Math.floor(Date.now() / 1000) + 3600;

            const transferBody = beginCell()
                .storeUint(0x73696e74, 32) // op: sint (signed internal)
                .storeUint(walletId, 32)
                .storeUint(validUntil, 32)
                .storeUint(seqno, 32)
                .storeRef(beginCell()
                    .store(storeMessageRelaxed(internalMessage))
                    .endCell())
                .endCell();

            // Sign
            const signature = sign(transferBody.hash(), keyPair.secretKey);

            const signedBody = beginCell()
                .storeBuffer(signature)
                .storeSlice(transferBody.beginParse())
                .endCell();

            // Send external message using provider
            const provider = client.provider(walletAddress);
            await provider.external(signedBody);

            return {
                success: true,
                seqno,
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }

    /**
     * Build gasless transaction (for relay)
     * This prepares a transaction that can be sent by a relayer who pays gas
     */
    async buildGaslessTransaction(
        keyPair: KeyPair,
        config: GaslessTransactionConfig,
        seqno: number,
        subwalletId?: number
    ): Promise<Cell> {
        const walletId = subwalletId ?? DEFAULT_CONFIG.SUBWALLET_ID;
        const validUntil = Math.floor(Date.now() / 1000) + 3600;

        // Build transfer body for relayer
        const transferBody = beginCell()
            .storeUint(0x73696e74, 32) // op: sint
            .storeUint(walletId, 32)
            .storeUint(validUntil, 32)
            .storeUint(seqno, 32)
            .storeRef(beginCell()
                .store(storeMessageRelaxed(config.message))
                .endCell())
            .endCell();

        // Sign the message
        const signature = sign(transferBody.hash(), keyPair.secretKey);

        return beginCell()
            .storeBuffer(signature)
            .storeSlice(transferBody.beginParse())
            .endCell();
    }

    /**
     * Get current seqno
     */
    async getSeqno(client: TonClient, walletAddress: Address): Promise<number> {
        try {
            const result = await client.runMethod(walletAddress, 'seqno');
            return result.stack.readNumber();
        } catch {
            return 0;
        }
    }
}

export default V5R1WalletService;
