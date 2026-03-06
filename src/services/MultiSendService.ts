/**
 * MultiSendService — THE CORE ENGINE
 *
 * Orchestrates the entire multi-send blockchain dispatch flow:
 *   A) buildJettonPayload — Constructs TEP-74 op::transfer cells for Jetton rows.
 *   B) chunkTransfers — Splits rows into arrays of max 254.
 *   C) executeW5Batch — Sequential dispatch with 5s seqno polling delay.
 *   D) executeHighloadV3 — Parallel dispatch via independent Query IDs.
 *
 * CRITICAL PROTOCOL RULES ENFORCED:
 * - W5 uses Seqno; 2-5s delay between batches; cascade failure halts all.
 * - Highload V3 uses Query IDs; no delays; partial failure isolation.
 * - 254 hard limit per on-chain TX payload.
 * - Jetton transfers: `to` = sender's Jetton Wallet, `destination` = recipient.
 */

import { TonClient, internal, WalletContractV5R1 } from '@ton/ton';
import {
    Address,
    beginCell,
    toNano,
    Cell,
    SendMode,
    storeMessageRelaxed,
    type OutActionSendMsg,
} from '@ton/core';
import type { KeyPair, NetworkType } from '../types';
import { JETTON_OP_CODES, HIGHLOAD_CONSTANTS } from '../types';
import type { TransferRow, CoinInfo, PreparedChunk, ChunkResult, HighloadMode } from '../types/multisend';
import { MessageRelaxed } from '@ton/core';
// =============================================================================
// CONSTANTS
// =============================================================================

/** Maximum internal transfers per single on-chain TX */
const MAX_TRANSFERS_PER_TX = 254;

/** Delay between W5 batches in milliseconds (5 seconds) */
const W5_BATCH_DELAY_MS = 5000;

/** Polling interval for seqno confirmation */
const SEQNO_POLL_INTERVAL_MS = 1500;

/** Maximum seqno polling attempts before timeout */
const SEQNO_POLL_MAX_ATTEMPTS = 15;

/** Retry configuration for API calls */
const API_RETRY_MAX_ATTEMPTS = 5;
const API_RETRY_BASE_DELAY_MS = 2000;

/** Gas attached to each Jetton transfer message (0.05 TON) */
const JETTON_GAS_AMOUNT = toNano('0.05');

/** Forward TON amount for Jetton transfer payload */
const JETTON_FORWARD_AMOUNT = toNano('0.01');

// =============================================================================
// TYPES
// =============================================================================

/** Parameters for the execute functions */
export interface MultiSendExecuteParams {
    /** TonClient instance */
    client: TonClient;
    /** Wallet key pair */
    keyPair: KeyPair;
    /** Sender's wallet address */
    senderAddress: string;
    /** Network type */
    network: NetworkType;
    /** Prepared transfer rows (with resolved addresses) */
    rows: TransferRow[];
    /** Callback fired on each batch status change */
    onBatchUpdate?: (chunkIndex: number, status: 'sending' | 'waiting_confirmation' | 'success' | 'failed', txHash?: string, error?: string) => void;
    /** Callback fired on each row status change */
    onRowUpdate?: (rowId: string, status: 'sending' | 'success' | 'failed', error?: string, queryId?: bigint) => void;
}

/** Resolved Jetton wallet address cache */
type JettonWalletCache = Map<string, string>;

// =============================================================================
// A) BUILD JETTON PAYLOAD
// =============================================================================

/**
 * Build a TEP-74 compliant Jetton transfer cell.
 *
 * CRITICAL: For Jetton transfers:
 * - The internal message `to` = sender's Jetton Wallet Address (NOT the recipient).
 * - The actual recipient is placed in the `destination` field of the payload.
 * - forward_ton_amount is attached for the Jetton contract to execute.
 *
 * @param recipientAddress The actual recipient's wallet address.
 * @param amount The Jetton amount in base units (e.g. 1_000_000 for 1 USDT with 6 decimals).
 * @param comment Optional text comment.
 * @param senderAddress The sender's address for response_destination.
 * @returns The TEP-74 transfer cell body.
 */
export function buildJettonPayload(
    recipientAddress: string,
    amount: bigint,
    comment: string | undefined,
    senderAddress: string
): Cell {
    let forwardPayload = beginCell().endCell();
    if (comment && comment.length > 0) {
        forwardPayload = beginCell()
            .storeUint(0, 32) // text comment op
            .storeStringTail(comment)
            .endCell();
    }

    return beginCell()
        .storeUint(JETTON_OP_CODES.TRANSFER, 32)   // op::transfer = 0xf8a7ea5
        .storeUint(0, 64)                            // query_id
        .storeCoins(amount)                           // Jetton amount
        .storeAddress(Address.parse(recipientAddress)) // destination (actual recipient)
        .storeAddress(Address.parse(senderAddress))    // response_destination
        .storeBit(0)                                   // no custom payload
        .storeCoins(JETTON_FORWARD_AMOUNT)             // forward_ton_amount (gas)
        .storeBit(comment ? 1 : 0)                     // forward_payload flag
        .storeRef(forwardPayload)                      // forward_payload (comment)
        .endCell();
}

// =============================================================================
// B) CHUNK TRANSFERS
// =============================================================================

/**
 * Split an array of transfer rows into chunks of max 254 items each.
 *
 * @param rows The full array of transfer rows.
 * @returns An array of PreparedChunk objects.
 */
export function chunkTransfers(rows: TransferRow[]): PreparedChunk[] {
    const chunks: PreparedChunk[] = [];
    for (let i = 0; i < rows.length; i += MAX_TRANSFERS_PER_TX) {
        chunks.push({
            index: chunks.length,
            rows: rows.slice(i, i + MAX_TRANSFERS_PER_TX),
        });
    }
    return chunks;
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Look up the sender's Jetton wallet address for a given Jetton master contract.
 * Uses TonAPI with caching to avoid redundant lookups.
 */
async function resolveJettonWalletAddress(
    senderAddress: string,
    jettonMasterAddress: string,
    network: NetworkType,
    cache: JettonWalletCache
): Promise<string> {
    const cacheKey = `${senderAddress}:${jettonMasterAddress}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const baseUrl = network === 'testnet'
        ? 'https://testnet.tonapi.io/v2'
        : 'https://tonapi.io/v2';

    const response = await fetch(
        `${baseUrl}/accounts/${encodeURIComponent(senderAddress)}/jettons/${encodeURIComponent(jettonMasterAddress)}`,
        { signal: AbortSignal.timeout(10000) }
    );

    if (!response.ok) {
        throw new Error(`Failed to resolve Jetton wallet for ${jettonMasterAddress}: HTTP ${response.status}`);
    }

    const data = await response.json();
    const jettonWalletAddr = data.wallet_address?.address;

    if (!jettonWalletAddr) {
        throw new Error(`No Jetton wallet found for token ${jettonMasterAddress}`);
    }

    cache.set(cacheKey, jettonWalletAddr);
    return jettonWalletAddr;
}

/**
 * Generic retry helper for RPC/API calls to handle rate limits (429)
 */
async function withRetry<T>(fn: () => Promise<T>, maxRetries = API_RETRY_MAX_ATTEMPTS): Promise<T> {
    let lastError: any;
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn();
        } catch (error: any) {
            lastError = error;
            const errorStr = error?.message || String(error);
            if (errorStr.includes('429') || errorStr.includes('rate') || errorStr.includes('Too Many')) {
                const delay = API_RETRY_BASE_DELAY_MS * Math.pow(2, i);
                console.warn(`[MultiSend] Rate limited, retrying in ${delay}ms... (attempt ${i + 1}/${maxRetries})`);
                await new Promise(r => setTimeout(r, delay));
            } else {
                throw error;
            }
        }
    }
    throw lastError;
}

/**
 * Parse a user-facing decimal amount string into base units (bigint).
 */
function parseAmount(amount: string, decimals: number): bigint {
    const [whole = '0', fraction = ''] = amount.split('.');
    const paddedFraction = fraction.padEnd(decimals, '0').slice(0, decimals);
    return BigInt(whole + paddedFraction);
}

/**
 * Build an OutActionSendMsg for a single transfer row.
 * Handles both native TON and Jetton (TEP-74) transfers.
 */
async function buildTransferMessage(
    row: TransferRow,
    senderAddress: string,
    network: NetworkType,
    jettonCache: JettonWalletCache
): Promise<OutActionSendMsg> {
    const recipientAddress = row.resolvedAddress || row.address;

    if (row.coin.isNative) {
        // ── Native TON transfer ──────────────────────────────────
        const amount = parseAmount(row.amount, row.coin.decimals);

        let body: Cell | undefined;
        if (row.comment && row.comment.length > 0) {
            body = beginCell()
                .storeUint(0, 32)
                .storeStringTail(row.comment)
                .endCell();
        }

        return {
            type: 'sendMsg' as const,
            mode: SendMode.PAY_GAS_SEPARATELY,
            outMsg: internal({
                to: Address.parse(recipientAddress),
                value: amount,
                body,
                bounce: false,
            }),
        };
    } else {
        // ── Jetton (TEP-74) transfer ─────────────────────────────
        // CRITICAL: `to` must be the sender's Jetton Wallet, NOT the recipient
        const jettonWalletAddr = await resolveJettonWalletAddress(
            senderAddress,
            row.coin.masterAddress!,
            network,
            jettonCache
        );

        const jettonAmount = parseAmount(row.amount, row.coin.decimals);
        const jettonBody = buildJettonPayload(
            recipientAddress,
            jettonAmount,
            row.comment,
            senderAddress
        );

        return {
            type: 'sendMsg' as const,
            mode: SendMode.PAY_GAS_SEPARATELY,
            outMsg: internal({
                to: Address.parse(jettonWalletAddr),
                value: JETTON_GAS_AMOUNT,    // Gas for Jetton transfer
                body: jettonBody,
                bounce: true,
            }),
        };
    }
}

// =============================================================================
// C) EXECUTE W5 BATCH (Sequential with seqno delays)
// =============================================================================

export async function executeW5Batch(
    params: MultiSendExecuteParams
): Promise<ChunkResult[]> {
    const { client, keyPair, senderAddress, network, rows, onBatchUpdate, onRowUpdate } = params;

    const chunks = chunkTransfers(rows);
    const results: ChunkResult[] = [];
    const jettonCache: JettonWalletCache = new Map();

    // 1. إنشاء نسخة المحفظة الرسمية V5R1
    const contract = WalletContractV5R1.create({ publicKey: keyPair.publicKey });
    const wallet = client.open(contract);

    for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
        const chunk = chunks[chunkIdx];

        try {
            // تحديث حالة الواجهة
            onBatchUpdate?.(chunkIdx, 'sending');
            for (const row of chunk.rows) {
                onRowUpdate?.(row.id, 'sending');
            }

            // 2. بناء الرسائل بشكل صحيح (مع الـ await واستخراج outMsg)
            const messages: MessageRelaxed[] = [];
            for (const row of chunk.rows) {
                const actionMsg = await buildTransferMessage(row, senderAddress, network, jettonCache);
                // يجب استخراج outMsg وتمريرها مباشرة
                messages.push(actionMsg.outMsg as MessageRelaxed);
            }

            // 3. الحصول على رقم الـ seqno الحالي
            const seqno = await wallet.getSeqno();

            // 4. إرسال المعاملة باستخدام الدالة الرسمية
            await wallet.sendTransfer({
                seqno,
                secretKey: keyPair.secretKey,
                sendMode: SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
                messages: messages
            });

            onBatchUpdate?.(chunkIdx, 'waiting_confirmation');

            // 5. الانتظار حتى يتم تأكيد المعاملة في الشبكة (seqno increment)
            let confirmed = false;
            for (let attempt = 0; attempt < SEQNO_POLL_MAX_ATTEMPTS; attempt++) {
                await new Promise((resolve) => setTimeout(resolve, SEQNO_POLL_INTERVAL_MS));
                try {
                    const newSeqno = await wallet.getSeqno();
                    if (newSeqno > seqno) {
                        confirmed = true;
                        break;
                    }
                } catch {
                    // استمر في المحاولة
                }
            }

            if (!confirmed) {
                throw new Error(`Batch ${chunkIdx + 1} timed out waiting for seqno confirmation`);
            }

            let realTxHash = `w5_batch_${chunkIdx}`; // Fallback

            try {
                // هنجيب آخر معاملة تمت على المحفظة
                const transactions = await client.getTransactions(wallet.address, { limit: 1 });
                if (transactions.length > 0) {
                    // هنحول الهاش لـ Hex عشان Tonviewer يقدر يقرأه
                    realTxHash = transactions[0].hash().toString('hex');
                }
            } catch (e) {
                console.warn('Could not fetch real tx hash', e);
            }
            onBatchUpdate?.(chunkIdx, 'success', realTxHash);
            for (const row of chunk.rows) {
                onRowUpdate?.(row.id, 'success');
            }

            results.push({
                chunkIndex: chunkIdx,
                success: true,
                txHash: realTxHash,
            });

            // تأخير 5 ثواني قبل الباتش التالي
            if (chunkIdx < chunks.length - 1) {
                await new Promise((resolve) => setTimeout(resolve, W5_BATCH_DELAY_MS));
            }

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error(`[MultiSend] W5 batch ${chunkIdx + 1} failed:`, error);

            onBatchUpdate?.(chunkIdx, 'failed', undefined, errorMessage);
            for (const row of chunk.rows) {
                onRowUpdate?.(row.id, 'failed', errorMessage);
            }

            results.push({
                chunkIndex: chunkIdx,
                success: false,
                error: errorMessage,
            });

            // إيقاف الإرسال في حالة الفشل
            break;
        }
    }

    return results;
}

// =============================================================================
// D) EXECUTE HIGHLOAD V3 (Parallel via Query IDs)
// =============================================================================

/**
 * Execute multi-send using Highload Wallet V3.
 *
 * PROTOCOL RULES:
 * - Uses independent Query IDs (Shift << 10 + BitNumber), NOT Seqno.
 * - NO delays between batches — all dispatched simultaneously.
 * - Partial failure isolation: failed Query ID → specific row(s).
 *
 * @param mode 'batches' → chunk and fire all chunks via Promise.all.
 *             'individual' → fire every single transfer as its own TX.
 * @returns Array of chunk results.
 */
export async function executeHighloadV3(
    params: MultiSendExecuteParams,
    mode: HighloadMode
): Promise<ChunkResult[]> {
    const { client, keyPair, senderAddress, network, rows, onBatchUpdate, onRowUpdate } = params;

    const jettonCache: JettonWalletCache = new Map();

    // Dynamic import of Highload services
    const { HighloadWalletV3Service } = await import('../wallets/highload-v3');

    const highloadService = new HighloadWalletV3Service(network);

    if (mode === 'batches') {
        // ── MODE A: Chunked Batches (up to 254 per TX, all fired simultaneously) ──
        const chunks = chunkTransfers(rows);

        // Build all chunk messages in parallel
        const chunkMessages = await Promise.all(
            chunks.map(async (chunk) => {
                const messages: OutActionSendMsg[] = [];
                for (const row of chunk.rows) {
                    const msg = await buildTransferMessage(row, senderAddress, network, jettonCache);
                    messages.push(msg);
                }
                return { chunk, messages };
            })
        );

        // Notify all rows as sending
        for (const row of rows) {
            onRowUpdate?.(row.id, 'sending');
        }

        // Fire ALL chunks simultaneously (no delays — Highload V3 uses Query IDs)
        const chunkPromises = chunkMessages.map(async ({ chunk, messages }) => {
            onBatchUpdate?.(chunk.index, 'sending');

            try {
                const result = await highloadService.sendBatch(client, keyPair,
                    chunk.rows.map(row => ({
                        to: row.resolvedAddress || row.address,
                        amount: parseAmount(row.amount, row.coin.decimals),
                        comment: row.comment || undefined,
                        bounce: false,
                    }))
                );

                if (result.success) {
                    const txHash = `hl_batch_${chunk.index}_q${result.queryId?.toString() || 'unknown'}`;
                    onBatchUpdate?.(chunk.index, 'success', txHash);
                    for (const row of chunk.rows) {
                        onRowUpdate?.(row.id, 'success', undefined, result.queryId);
                    }
                    return {
                        chunkIndex: chunk.index,
                        success: true,
                        txHash,
                        queryId: result.queryId,
                    } as ChunkResult;
                } else {
                    const errorMsg = result.error || 'Highload batch dispatch failed';
                    onBatchUpdate?.(chunk.index, 'failed', undefined, errorMsg);
                    // ISOLATED FAILURE: Only mark THIS chunk's rows as failed
                    for (const row of chunk.rows) {
                        onRowUpdate?.(row.id, 'failed', errorMsg, result.queryId);
                    }
                    return {
                        chunkIndex: chunk.index,
                        success: false,
                        error: errorMsg,
                        queryId: result.queryId,
                    } as ChunkResult;
                }
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : 'Unknown error';
                onBatchUpdate?.(chunk.index, 'failed', undefined, errorMsg);
                for (const row of chunk.rows) {
                    onRowUpdate?.(row.id, 'failed', errorMsg);
                }
                return {
                    chunkIndex: chunk.index,
                    success: false,
                    error: errorMsg,
                } as ChunkResult;
            }
        });

        // Await ALL simultaneously (no delays)
        const results = await Promise.allSettled(chunkPromises);

        return results.map((result) => {
            if (result.status === 'fulfilled') return result.value;
            return {
                chunkIndex: -1,
                success: false,
                error: result.reason?.message || 'Promise rejected',
            };
        });
    } else {
        // ── MODE B: Individual Parallel (each transfer is a separate TX) ──
        // Fire every single transfer simultaneously, each with its own Query ID

        // Notify all as sending
        for (const row of rows) {
            onRowUpdate?.(row.id, 'sending');
        }

        const individualPromises = rows.map(async (row, index) => {
            try {
                const result = await highloadService.sendTransaction(client, keyPair, {
                    to: row.resolvedAddress || row.address,
                    amount: parseAmount(row.amount, row.coin.decimals),
                    comment: row.comment || undefined,
                    bounce: false,
                });

                if (result.success) {
                    const txHash = `hl_ind_${index}_q${result.queryId?.toString() || 'unknown'}`;
                    onRowUpdate?.(row.id, 'success', undefined, result.queryId);
                    return {
                        chunkIndex: index,
                        success: true,
                        txHash,
                        queryId: result.queryId,
                    } as ChunkResult;
                } else {
                    const errorMsg = result.error || 'Individual transfer failed';
                    onRowUpdate?.(row.id, 'failed', errorMsg, result.queryId);
                    return {
                        chunkIndex: index,
                        success: false,
                        error: errorMsg,
                        queryId: result.queryId,
                    } as ChunkResult;
                }
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : 'Unknown error';
                onRowUpdate?.(row.id, 'failed', errorMsg);
                return {
                    chunkIndex: index,
                    success: false,
                    error: errorMsg,
                } as ChunkResult;
            }
        });

        // Fire ALL simultaneously (Highload V3 — no seqno, no delays)
        const results = await Promise.allSettled(individualPromises);

        return results.map((result) => {
            if (result.status === 'fulfilled') return result.value;
            return {
                chunkIndex: -1,
                success: false,
                error: result.reason?.message || 'Promise rejected',
            };
        });
    }
}

// =============================================================================
// UTILITY: Estimate total fees
// =============================================================================

/**
 * Estimate the total TON needed for a multi-send operation.
 * Native TON: sum of amounts + small gas per tx.
 * Jettons: sum of JETTON_GAS_AMOUNT per Jetton row + native TON amounts.
 */
export function estimateTotalFees(rows: TransferRow[]): bigint {
    let totalNative = 0n;
    let totalJettonGas = 0n;
    const gasPerNativeTx = toNano('0.01');

    for (const row of rows) {
        if (!row.amount || isNaN(Number(row.amount)) || Number(row.amount) <= 0) continue;

        if (row.coin.isNative) {
            totalNative += parseAmount(row.amount, row.coin.decimals);
            totalNative += gasPerNativeTx;
        } else {
            totalJettonGas += JETTON_GAS_AMOUNT;
        }
    }

    return totalNative + totalJettonGas;
}
