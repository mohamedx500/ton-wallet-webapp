/**
 * Offline Signing Service
 * 
 * Enables signing transactions without network access.
 * Useful for cold storage and air-gapped systems.
 */

import { Buffer } from 'buffer';
import {
    Address,
    beginCell,
    Cell,
    internal,
    storeMessageRelaxed
} from '@ton/core';
import { sign } from '@ton/crypto';
import type { KeyPair, WalletVersion, TransactionParams } from '../types';

/**
 * Unsigned transaction data
 */
export interface UnsignedTransaction {
    // Transaction details
    to: string;
    amount: bigint;
    comment?: string;
    bounce?: boolean;
    // Wallet details
    walletAddress: string;
    walletVersion: WalletVersion;
    seqno: number;
    // Metadata
    validUntil: number;
    createdAt: number;
}

/**
 * Signed transaction data
 */
export interface SignedTransaction {
    // Original transaction
    unsigned: UnsignedTransaction;
    // Signature
    signature: string;
    // Signed body (ready to broadcast)
    signedBody: string;
}

/**
 * Offline Signing Service
 */
export class OfflineSigningService {
    /**
     * Create unsigned transaction body
     */
    createUnsignedBody(tx: UnsignedTransaction): Cell {
        // Build message body
        let body: Cell | undefined;
        if (tx.comment) {
            body = beginCell()
                .storeUint(0, 32)
                .storeStringTail(tx.comment)
                .endCell();
        }

        // Build internal message
        const internalMessage = internal({
            to: Address.parse(tx.to),
            value: tx.amount,
            body,
            bounce: tx.bounce ?? false,
        });

        // Create wallet-specific message
        switch (tx.walletVersion) {
            case 'v3r1':
            case 'v3r2':
                return this.buildV3Message(internalMessage, tx.seqno, tx.validUntil);
            case 'v4r2':
                return this.buildV4Message(internalMessage, tx.seqno, tx.validUntil);
            case 'v5r1':
                return this.buildV5Message(internalMessage, tx.seqno, tx.validUntil);
            case 'highload-v3':
                throw new Error('Use OfflineHighloadService for Highload V3 transactions');
            default:
                throw new Error(`Unsupported wallet version: ${tx.walletVersion}`);
        }
    }

    /**
     * Build V3/V3R2 message body
     */
    private buildV3Message(message: any, seqno: number, validUntil: number): Cell {
        const messageBuilder = beginCell();
        messageBuilder.store(storeMessageRelaxed(message));
        const messageCell = messageBuilder.endCell();

        return beginCell()
            .storeUint(0, 32) // subwallet_id (not used in v3)
            .storeUint(validUntil, 32)
            .storeUint(seqno, 32)
            .storeRef(messageCell)
            .storeUint(3, 8) // send mode
            .endCell();
    }

    /**
     * Build V4R2 message body
     */
    private buildV4Message(message: any, seqno: number, validUntil: number): Cell {
        const messageBuilder = beginCell();
        messageBuilder.store(storeMessageRelaxed(message));
        const messageCell = messageBuilder.endCell();

        return beginCell()
            .storeUint(698983191, 32) // subwallet_id
            .storeUint(validUntil, 32)
            .storeUint(seqno, 32)
            .storeUint(0, 8) // op = 0 for simple transfer
            .storeRef(messageCell)
            .storeUint(3, 8) // send mode
            .endCell();
    }

    /**
     * Build V5R1 message body
     */
    private buildV5Message(message: any, seqno: number, validUntil: number): Cell {
        const messageBuilder = beginCell();
        messageBuilder.store(storeMessageRelaxed(message));
        const messageCell = messageBuilder.endCell();

        return beginCell()
            .storeUint(0x73696e74, 32) // op: sint
            .storeUint(698983191, 32) // wallet_id
            .storeUint(validUntil, 32)
            .storeUint(seqno, 32)
            .storeRef(messageCell)
            .endCell();
    }

    /**
     * Sign transaction offline
     */
    signTransaction(
        unsignedBody: Cell,
        secretKey: Buffer
    ): { signature: Buffer; signedBody: Cell } {
        const signature = sign(unsignedBody.hash(), secretKey);

        const signedBody = beginCell()
            .storeBuffer(signature)
            .storeSlice(unsignedBody.beginParse())
            .endCell();

        return { signature, signedBody };
    }

    /**
     * Create and sign transaction in one step
     */
    createSignedTransaction(
        tx: UnsignedTransaction,
        secretKey: Buffer
    ): SignedTransaction {
        const unsignedBody = this.createUnsignedBody(tx);
        const { signature, signedBody } = this.signTransaction(unsignedBody, secretKey);

        return {
            unsigned: tx,
            signature: signature.toString('hex'),
            signedBody: signedBody.toBoc().toString('base64'),
        };
    }

    /**
     * Parse signed transaction from BOC
     */
    parseSignedTransaction(boc: string): Cell {
        return Cell.fromBoc(Buffer.from(boc, 'base64'))[0];
    }

    /**
     * Prepare transaction for offline signing
     */
    prepareForSigning(
        params: TransactionParams,
        walletAddress: string,
        walletVersion: WalletVersion,
        seqno: number
    ): UnsignedTransaction {
        const now = Math.floor(Date.now() / 1000);

        return {
            to: params.to,
            amount: params.amount,
            comment: params.comment,
            bounce: params.bounce,
            walletAddress,
            walletVersion,
            seqno,
            validUntil: now + 3600, // 1 hour validity
            createdAt: now,
        };
    }
}

/**
 * Create default offline signing service
 */
export function createOfflineSigningService(): OfflineSigningService {
    return new OfflineSigningService();
}

export default OfflineSigningService;
