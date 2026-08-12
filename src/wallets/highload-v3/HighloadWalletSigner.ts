/**
 * HighloadWalletSigner — Slice 2: Highload V3 signing adapter.
 *
 * Adapts HighloadWalletV3.sendBatch() to the typed WalletSigner interface
 * defined in src/wallet/types.ts so Highload V3 participates in the same
 * execution boundary as standard wallets (N1–N10).
 *
 * The signer owns:
 *   - Replay protection allocation via HighloadQueryId.
 *   - Signing via the official HighloadWalletV3 contract methods.
 *   - StateInit attachment on first deployment (seqno 0 analogue = uninitialized).
 *
 * It does NOT own submission, confirmation, or persistence.
 */

import { Buffer } from 'buffer';
import {
    Address,
    beginCell,
    Cell,
    internal as internal_relaxed,
    OutActionSendMsg,
    SendMode,
    storeMessageRelaxed,
    storeOutList,
} from '@ton/core';
import { sign } from '@ton/crypto';
import type { TonClient } from '@ton/ton';

import type {
    HighloadWalletDescriptor,
    HighloadReplayProtection,
    ReplayProtection,
    SignedWalletEnvelope,
    WalletDescriptor,
    WalletExecutionRequest,
    WalletSigner,
} from '../../wallet/types';
import { HighloadWalletV3, TIMESTAMP_SIZE, TIMEOUT_SIZE, highloadWalletV3ConfigToCell } from './HighloadWalletV3';
import { HighloadQueryId } from './HighloadQueryId';

const HIGHLOAD_WALLET_V3_CODE_HEX =
    'b5ee9c7241021001000228000114ff00f4a413f4bcf2c80b01020120020d02014803040078d020d74bc00101c060b0915be101d0d3030171b0915be0fa4030f828c705b39130e0d31f018210ae42e5a4ba9d8040d721d74cf82a01ed55fb04e030020120050a02027306070011adce76a2686b85ffc00201200809001aabb6ed44d0810122d721d70b3f0018aa3bed44d08307d721d70b1f0201200b0c001bb9a6eed44d0810162d721d70b15800e5b8bf2eda2edfb21ab09028409b0ed44d0810120d721f404f404d33fd315d1058e1bf82325a15210b99f326df82305aa0015a112b992306dde923033e2923033e25230800df40f6fa19ed021d721d70a00955f037fdb31e09130e259800df40f6fa19cd001d721d70a00937fdb31e0915be270801f6f2d48308d718d121f900ed44d0d3ffd31ff404f404d33fd315d1f82321a15220b98e12336df82324aa00a112b9926d32de58f82301de541675f910f2a106d0d31fd4d307d30cd309d33fd315d15168baf2a2515abaf2a6f8232aa15250bcf2a304f823bbf2a35304800df40f6fa199d024d721d70a00f2649130e20e01fe5309800df40f6fa18e13d05004d718d20001f264c858cf16cf8301cf168e1030c824cf40cf8384095005a1a514cf40e2f800c94039800df41704c8cbff13cb1ff40012f40012cb3f12cb15c9ed54f80f21d0d30001f265d3020171b0925f03e0fa4001d70b01c000f2a5fa4031fa0031f401fa0031fa00318060d721d300010f0020f265d2000193d431d19130e272b1fb00b585bf03';

function getHighloadCode(): Cell {
    return Cell.fromBoc(Buffer.from(HIGHLOAD_WALLET_V3_CODE_HEX, 'hex'))[0]!;
}

export interface HighloadWalletSignerOptions {
    /** Raw TonClient bound to the correct network. */
    readonly client: TonClient;
    /** Clock for createdAt — defaults to Math.floor(Date.now()/1000). */
    readonly clock?: () => number;
}

/**
 * Highload Wallet V3 signer.
 *
 * Accepts a `WalletExecutionRequest` with a `highload-v3` wallet descriptor
 * and a `HighloadReplayProtection`, builds the signed external message, and
 * returns a `SignedWalletEnvelope` for submission.
 *
 * Key derivation must be done externally and the resulting secretKey passed to
 * `signWithKey()`. The public `sign()` method is the preferred entry point for
 * use with the execution coordinator (which passes derived keys transiently).
 */
export class HighloadWalletSigner implements WalletSigner {
    private readonly client: TonClient;
    private readonly clock: () => number;

    public constructor(options: HighloadWalletSignerOptions) {
        this.client = options.client;
        this.clock = options.clock ?? (() => Math.floor(Date.now() / 1000));
    }

    public supports(wallet: WalletDescriptor): boolean {
        return wallet.kind === 'highload-v3';
    }

    /**
     * Sign a wallet execution request.
     *
     * @param request          - Immutable execution request.
     * @param replayProtection - Pre-allocated Highload query ID.
     * @param secretKey        - Transient 64-byte secret key (zeroed after use by caller).
     */
    public async sign(
        request: WalletExecutionRequest,
        replayProtection: ReplayProtection,
    ): Promise<SignedWalletEnvelope> {
        throw new Error(
            'HighloadWalletSigner.sign() requires a secret key — use signWithKey() from the coordinator.',
        );
    }

    /**
     * Sign with an explicitly provided secret key (called by the coordinator
     * which derives the key transiently and zeros it in `finally`).
     */
    public async signWithKey(
        request: WalletExecutionRequest,
        replayProtection: ReplayProtection,
        secretKey: Buffer,
    ): Promise<SignedWalletEnvelope> {
        if (replayProtection.kind !== 'highload-query') {
            throw new Error(`HighloadWalletSigner: expected 'highload-query' replay protection, got '${replayProtection.kind}'.`);
        }
        if (request.wallet.kind !== 'highload-v3') {
            throw new Error(`HighloadWalletSigner: expected 'highload-v3' wallet descriptor, got '${request.wallet.kind}'.`);
        }

        const descriptor = request.wallet as HighloadWalletDescriptor;
        const queryIdObj = HighloadQueryId.fromShiftAndBitNumber(
            Number((replayProtection.queryId >> BigInt(10)) & BigInt(0x1FFF)),
            Number(replayProtection.queryId & BigInt(0x3FF)),
        );
        const createdAt = replayProtection.createdAtUnix;
        const code = getHighloadCode();

        // Derive the public key from the secret key to reconstruct the wallet
        const publicKey = Buffer.from(secretKey.slice(32));
        const walletConfig = {
            publicKey,
            subwalletId: descriptor.subwalletId,
            timeout: descriptor.timeoutSeconds,
        };
        const data = highloadWalletV3ConfigToCell(walletConfig);
        const walletInit = { code, data };

        const walletAddress = Address.parse(descriptor.address);
        const wallet = new HighloadWalletV3(walletAddress, walletInit);

        if (request.messages.length === 0) {
            throw new Error('HighloadWalletSigner: at least one message is required.');
        }
        if (request.messages.length > 254) {
            throw new Error(`HighloadWalletSigner: max 254 messages, got ${request.messages.length}.`);
        }

        let messageCell: Cell;
        let mode: number;

        if (request.messages.length === 1) {
            // Single message path (burst-optimized path for swaps and individual transfers)
            const msg = request.messages[0]!;
            const outMsg = internal_relaxed({
                to: Address.parse(msg.to),
                value: msg.value,
                bounce: msg.bounce,
                body: msg.body,
            });
            const messageBuilder = beginCell();
            messageBuilder.store(storeMessageRelaxed(outMsg));
            messageCell = messageBuilder.endCell();
            mode = msg.bounce
                ? SendMode.PAY_GAS_SEPARATELY
                : SendMode.PAY_GAS_SEPARATELY | SendMode.IGNORE_ERRORS;
        } else {
            // Batch of messages (up to 254 per request)
            const actions: OutActionSendMsg[] = request.messages.map((msg) => ({
                type: 'sendMsg' as const,
                mode: msg.bounce
                    ? SendMode.PAY_GAS_SEPARATELY
                    : SendMode.PAY_GAS_SEPARATELY | SendMode.IGNORE_ERRORS,
                outMsg: internal_relaxed({
                    to: Address.parse(msg.to),
                    value: msg.value,
                    bounce: msg.bounce,
                    body: msg.body,
                }),
            }));

            const actionsBuilder = beginCell();
            storeOutList(actions)(actionsBuilder);
            const actionsCell = actionsBuilder.endCell();

            const internalTransferBody = HighloadWalletV3.createInternalTransferBody({
                actions: actionsCell,
                queryId: queryIdObj,
            });

            const internalMessage = internal_relaxed({
                to: walletAddress,
                value: 0n,
                body: internalTransferBody,
            });

            messageCell = beginCell()
                .store(storeMessageRelaxed(internalMessage))
                .endCell();
            mode = SendMode.CARRY_ALL_REMAINING_BALANCE;
        }

        // Official HL3 layout: subwalletId, message ref, mode, queryId, createdAt, timeout
        const messageInner = beginCell()
            .storeUint(descriptor.subwalletId, 32)
            .storeRef(messageCell)
            .storeUint(mode, 8)
            .storeUint(queryIdObj.getQueryId(), 23)
            .storeUint(createdAt, TIMESTAMP_SIZE)
            .storeUint(descriptor.timeoutSeconds, TIMEOUT_SIZE)
            .endCell();

        const signature = sign(messageInner.hash(), secretKey);

        const signedBody = beginCell()
            .storeBuffer(signature)
            .storeRef(messageInner)
            .endCell();

        // Check if deployment is needed (uninitialized contract)
        let stateInit: { code: Cell; data: Cell } | undefined;
        try {
            const contractProvider = this.client.provider(walletAddress);
            const state = await contractProvider.getState();
            if (state.state.type === 'uninit') {
                stateInit = walletInit;
            }
        } catch {
            // If RPC fails, attach state init defensively
            stateInit = walletInit;
        }

        return Object.freeze({
            network: request.network,
            walletAddress: descriptor.address,
            walletVersion: 'highload-v3' as const,
            correlationId: request.correlationId,
            validUntilUnix: request.validUntilUnix,
            replayProtection,
            signedBody,
            ...(stateInit ? { stateInit } : {}),
        });
    }
}
