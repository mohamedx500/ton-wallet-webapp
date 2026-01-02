/**
 * HighloadWalletV3 - Official Highload Wallet V3 wrapper
 * Based on: https://github.com/ton-blockchain/highload-wallet-contract-v3
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

export type HighloadWalletV3Config = {
    publicKey: Buffer;
    subwalletId: number;
    timeout: number;
};

// Constants from official implementation
export const TIMESTAMP_SIZE = 64;
export const TIMEOUT_SIZE = 22;

// OP code for internal transfer
export const OP_INTERNAL_TRANSFER = 0xae42e5a4;

export function highloadWalletV3ConfigToCell(config: HighloadWalletV3Config): Cell {
    return beginCell()
        .storeBuffer(config.publicKey)
        .storeUint(config.subwalletId, 32)
        .storeUint(0, 1 + 1 + TIMESTAMP_SIZE) // empty old_queries (1 bit) + empty queries (1 bit) + last_clean_time (64 bits)
        .storeUint(config.timeout, TIMEOUT_SIZE)
        .endCell();
}

export class HighloadWalletV3 implements Contract {
    constructor(
        readonly address: Address,
        readonly init?: { code: Cell; data: Cell }
    ) { }

    static createFromAddress(address: Address): HighloadWalletV3 {
        return new HighloadWalletV3(address);
    }

    static createFromConfig(
        config: HighloadWalletV3Config,
        code: Cell,
        workchain = 0
    ): HighloadWalletV3 {
        const data = highloadWalletV3ConfigToCell(config);
        const init = { code, data };
        return new HighloadWalletV3(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            bounce: false,
            sendMode: SendMode.PAY_GAS_SEPARATELY,
            body: beginCell().endCell(),
        });
    }

    /**
     * Send external message - provider is auto-injected by client.open()
     * Call like: wallet.sendExternalMessage(secretKey, opts)
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
            .storeUint(opts.createdAt, TIMESTAMP_SIZE)
            .storeUint(opts.timeout, TIMEOUT_SIZE)
            .endCell();

        // Sign and wrap - messageInner stored as REFERENCE
        await provider.external(
            beginCell()
                .storeBuffer(sign(messageInner.hash(), secretKey))
                .storeRef(messageInner)      // Inner message stored as REFERENCE
                .endCell()
        );
    }

    static createInternalTransferBody(opts: {
        actions: OutAction[] | Cell;
        queryId: HighloadQueryId;
    }): Cell {
        let actionsCell: Cell;
        if (opts.actions instanceof Cell) {
            actionsCell = opts.actions;
        } else {
            if (opts.actions.length > 254) {
                throw TypeError("Max allowed action count is 254. Use packActions instead.");
            }
            const actionsBuilder = beginCell();
            storeOutList(opts.actions)(actionsBuilder);
            actionsCell = actionsBuilder.endCell();
        }
        return beginCell()
            .storeUint(OP_INTERNAL_TRANSFER, 32)
            .storeUint(opts.queryId.getQueryId(), 64)
            .storeRef(actionsCell)
            .endCell();
    }

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

    packActions(
        messages: OutAction[],
        value: bigint = toNano('1'),
        query_id: HighloadQueryId
    ): MessageRelaxed {
        let batch: OutAction[];
        if (messages.length > 254) {
            batch = messages.slice(0, 253);
            batch.push({
                type: 'sendMsg',
                mode: value > 0n ? SendMode.PAY_GAS_SEPARATELY : SendMode.CARRY_ALL_REMAINING_BALANCE,
                outMsg: this.packActions(messages.slice(253), value, query_id),
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

    async getPublicKey(provider: ContractProvider): Promise<Buffer> {
        const res = (await provider.get('get_public_key', [])).stack;
        const pubKeyU = res.readBigNumber();
        return Buffer.from(pubKeyU.toString(16).padStart(32 * 2, '0'), 'hex');
    }

    async getSubwalletId(provider: ContractProvider): Promise<number> {
        const res = (await provider.get('get_subwallet_id', [])).stack;
        return res.readNumber();
    }

    async getTimeout(provider: ContractProvider): Promise<number> {
        const res = (await provider.get('get_timeout', [])).stack;
        return res.readNumber();
    }

    async getLastCleaned(provider: ContractProvider): Promise<number> {
        const res = (await provider.get('get_last_clean_time', [])).stack;
        return res.readNumber();
    }

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
