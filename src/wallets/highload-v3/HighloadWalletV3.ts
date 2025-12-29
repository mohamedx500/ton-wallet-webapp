/**
 * Highload Wallet V3 Contract Wrapper
 * 
 * Official implementation based on:
 * https://github.com/ton-blockchain/highload-wallet-contract-v3
 * 
 * This wallet is designed for high-volume transactions, supporting
 * up to 254 messages per transaction.
 */

import { Buffer } from 'buffer';
import {
    Address,
    beginCell,
    Cell,
    Contract,
    contractAddress,
    ContractProvider,
    internal as internal_relaxed,
    MessageRelaxed,
    OutAction,
    OutActionSendMsg,
    Sender,
    SendMode,
    storeMessageRelaxed,
    storeOutList,
    toNano
} from '@ton/core';
import { sign } from '@ton/crypto';
import { HighloadQueryId } from './HighloadQueryId';
import { HIGHLOAD_CONSTANTS } from '../../types';

/**
 * Highload V3 Configuration
 */
export interface HighloadWalletV3Config {
    publicKey: Buffer;
    subwalletId: number;
    timeout: number;
}

/**
 * Highload V3 Contract Code (Official)
 */
const HIGHLOAD_V3_CODE_HEX = 'b5ee9c7241021001000228000114ff00f4a413f4bcf2c80b01020120020d02014803040078d020d74bc00101c060b0915be101d0d3030171b0915be0fa4030f828c705b39130e0d31f018210ae42e5a4ba9d8040d721d74cf82a01ed55fb04e030020120050a02027306070011adce76a2686b85ffc00201200809001aabb6ed44d0810122d721d70b3f0018aa3bed44d08307d721d70b1f0201200b0c001bb9a6eed44d0810162d721d70b15800e5b8bf2eda2edfb21ab09028409b0ed44d0810120d721f404f404d33fd315d1058e1bf82325a15210b99f326df82305aa0015a112b992306dde923033e2923033e25230800df40f6fa19ed021d721d70a00955f037fdb31e09130e259800df40f6fa19cd001d721d70a00937fdb31e0915be270801f6f2d48308d718d121f900ed44d0d3ffd31ff404f404d33fd315d1f82321a15220b98e12336df82324aa00a112b9926d32de58f82301de541675f910f2a106d0d31fd4d307d30cd309d33fd315d15168baf2a2515abaf2a6f8232aa15250bcf2a304f823bbf2a35304800df40f6fa199d024d721d70a00f2649130e20e01fe5309800df40f6fa18e13d05004d718d20001f264c858cf16cf8301cf168e1030c824cf40cf8384095005a1a514cf40e2f800c94039800df41704c8cbff13cb1ff40012f40012cb3f12cb15c9ed54f80f21d0d30001f265d3020171b0925f03e0fa4001d70b01c000f2a5fa4031fa0031f401fa0031fa00318060d721d300010f0020f265d2000193d431d19130e272b1fb00b585bf03';

/**
 * Convert config to initial data cell
 */
export function highloadWalletV3ConfigToCell(config: HighloadWalletV3Config): Cell {
    return beginCell()
        .storeBuffer(config.publicKey)
        .storeUint(config.subwalletId, 32)
        .storeUint(0, 1 + 1 + HIGHLOAD_CONSTANTS.TIMESTAMP_SIZE) // empty old_queries + empty queries + last_clean_time
        .storeUint(config.timeout, HIGHLOAD_CONSTANTS.TIMEOUT_SIZE)
        .endCell();
}

/**
 * Highload Wallet V3 Contract
 */
export class HighloadWalletV3 implements Contract {
    static readonly code = Cell.fromBoc(Buffer.from(HIGHLOAD_V3_CODE_HEX, 'hex'))[0];

    constructor(
        readonly address: Address,
        readonly init?: { code: Cell; data: Cell }
    ) { }

    /**
     * Create from existing address
     */
    static createFromAddress(address: Address): HighloadWalletV3 {
        return new HighloadWalletV3(address);
    }

    /**
     * Create from configuration
     */
    static createFromConfig(
        config: HighloadWalletV3Config,
        code?: Cell,
        workchain = 0
    ): HighloadWalletV3 {
        const data = highloadWalletV3ConfigToCell(config);
        const contractCode = code ?? HighloadWalletV3.code;
        const init = { code: contractCode, data };
        return new HighloadWalletV3(contractAddress(workchain, init), init);
    }

    /**
     * Get contract code
     */
    static getCode(): Cell {
        return HighloadWalletV3.code;
    }

    /**
     * Deploy wallet
     */
    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            bounce: false,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }

    /**
     * Send external message to the wallet
     */
    async sendExternalMessage(
        provider: ContractProvider,
        secretKey: Buffer,
        opts: {
            message: MessageRelaxed | Cell;
            mode: number;
            query_id: bigint | HighloadQueryId;
            createdAt: number;
            subwalletId: number;
            timeout: number;
        }
    ) {
        let messageCell: Cell;

        if (opts.message instanceof Cell) {
            messageCell = opts.message;
        } else {
            const messageBuilder = beginCell();
            messageBuilder.store(storeMessageRelaxed(opts.message));
            messageCell = messageBuilder.endCell();
        }

        const queryId = opts.query_id instanceof HighloadQueryId
            ? opts.query_id.getQueryId()
            : opts.query_id;

        // Build the message body exactly as per official implementation
        const messageInner = beginCell()
            .storeUint(opts.subwalletId, 32)
            .storeRef(messageCell)           // Message stored as REFERENCE
            .storeUint(opts.mode, 8)
            .storeUint(queryId, 23)
            .storeUint(opts.createdAt, HIGHLOAD_CONSTANTS.TIMESTAMP_SIZE)
            .storeUint(opts.timeout, HIGHLOAD_CONSTANTS.TIMEOUT_SIZE)
            .endCell();

        // Sign and wrap - messageInner stored as REFERENCE
        await provider.external(
            beginCell()
                .storeBuffer(sign(messageInner.hash(), secretKey))
                .storeRef(messageInner)      // Inner message stored as REFERENCE
                .endCell()
        );
    }

    /**
     * Create internal transfer body
     */
    static createInternalTransferBody(opts: {
        actions: OutAction[] | Cell;
        queryId: HighloadQueryId;
    }): Cell {
        let actionsCell: Cell;
        if (opts.actions instanceof Cell) {
            actionsCell = opts.actions;
        } else {
            if (opts.actions.length > HIGHLOAD_CONSTANTS.MAX_ACTIONS) {
                throw TypeError(`Max allowed action count is ${HIGHLOAD_CONSTANTS.MAX_ACTIONS}. Use packActions instead.`);
            }
            const actionsBuilder = beginCell();
            storeOutList(opts.actions)(actionsBuilder);
            actionsCell = actionsBuilder.endCell();
        }
        return beginCell()
            .storeUint(HIGHLOAD_CONSTANTS.OP_INTERNAL_TRANSFER, 32)
            .storeUint(opts.queryId.getQueryId(), 64)
            .storeRef(actionsCell)
            .endCell();
    }

    /**
     * Create internal transfer message
     */
    createInternalTransfer(opts: {
        actions: OutAction[] | Cell;
        queryId: HighloadQueryId;
        value: bigint;
    }): MessageRelaxed {
        return internal_relaxed({
            to: this.address,
            value: opts.value,
            body: HighloadWalletV3.createInternalTransferBody(opts),
        });
    }

    /**
     * Pack actions into a chain of internal transfers
     * Handles more than 254 messages by chaining
     */
    packActions(
        messages: OutAction[],
        value: bigint = toNano('1'),
        query_id: HighloadQueryId
    ): MessageRelaxed {
        let batch: OutAction[];
        if (messages.length > HIGHLOAD_CONSTANTS.MAX_ACTIONS) {
            batch = messages.slice(0, HIGHLOAD_CONSTANTS.MAX_ACTIONS - 1);
            batch.push({
                type: 'sendMsg',
                mode: value > 0n ? SendMode.PAY_GAS_SEPARATELY : SendMode.CARRY_ALL_REMAINING_BALANCE,
                outMsg: this.packActions(messages.slice(HIGHLOAD_CONSTANTS.MAX_ACTIONS - 1), value, query_id),
            });
        } else {
            batch = messages;
        }
        return this.createInternalTransfer({
            actions: batch,
            queryId: query_id,
            value,
        });
    }

    /**
     * Send batch of messages
     */
    async sendBatch(
        provider: ContractProvider,
        secretKey: Buffer,
        messages: OutActionSendMsg[],
        subwallet: number,
        query_id: HighloadQueryId,
        timeout: number,
        createdAt?: number,
        value: bigint = 0n
    ) {
        if (createdAt === undefined) {
            createdAt = Math.floor(Date.now() / 1000);
        }
        return await this.sendExternalMessage(provider, secretKey, {
            message: this.packActions(messages, value, query_id),
            mode: value > 0n ? SendMode.PAY_GAS_SEPARATELY : SendMode.CARRY_ALL_REMAINING_BALANCE,
            query_id: query_id,
            createdAt: createdAt,
            subwalletId: subwallet,
            timeout: timeout,
        });
    }

    /**
     * Get public key from contract
     */
    async getPublicKey(provider: ContractProvider): Promise<Buffer> {
        const res = (await provider.get('get_public_key', [])).stack;
        const pubKeyU = res.readBigNumber();
        return Buffer.from(pubKeyU.toString(16).padStart(32 * 2, '0'), 'hex');
    }

    /**
     * Get subwallet ID from contract
     */
    async getSubwalletId(provider: ContractProvider): Promise<number> {
        const res = (await provider.get('get_subwallet_id', [])).stack;
        return res.readNumber();
    }

    /**
     * Get timeout from contract
     */
    async getTimeout(provider: ContractProvider): Promise<number> {
        const res = (await provider.get('get_timeout', [])).stack;
        return res.readNumber();
    }

    /**
     * Get last cleaned time
     */
    async getLastCleaned(provider: ContractProvider): Promise<number> {
        const res = (await provider.get('get_last_clean_time', [])).stack;
        return res.readNumber();
    }

    /**
     * Check if query ID has been processed
     */
    async getProcessed(
        provider: ContractProvider,
        queryId: HighloadQueryId,
        needClean = true
    ): Promise<boolean> {
        const res = (
            await provider.get('processed?', [
                { type: 'int', value: queryId.getQueryId() },
                { type: 'int', value: needClean ? -1n : 0n },
            ])
        ).stack;
        return res.readBoolean();
    }
}

export default HighloadWalletV3;
