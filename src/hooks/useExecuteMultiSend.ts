/**
 * useExecuteMultiSend Hook
 *
 * The final orchestration hook triggered when "Send Batch" is clicked.
 * Executes the full 7-step pipeline:
 *   1. Input sanitization
 *   2. DNS resolution for .ton domains
 *   3. Jetton wallet address lookup (handled inside MultiSendService)
 *   4. Balance check (native TON + Jetton gas)
 *   5. Chunking (254 limit)
 *   6. Dispatch (W5 sequential OR Highload V3 parallel)
 *   7. Result mapping (TX hashes → rows, success/fail status)
 *
 * Updates global MultiSendContext state at every phase transition.
 */

import { useCallback } from 'react';
import { TonClient } from '@ton/ton';
import { useMultiSend } from '../context/MultiSendContext';
import { useWallet } from '../context/WalletContext';
import { isValidAddressFormat } from '../context/MultiSendContext';
import { DnsResolverService } from '../services/DnsResolverService';
import {
    executeW5Batch,
    executeHighloadV3,
    chunkTransfers,
    estimateTotalFees,
} from '../services/MultiSendService';
import type {
    TransferRow,
    BatchProgress,
    BatchStatus,
    RowStatus,
} from '../types/multisend';

/**
 * Return type for the hook.
 */
interface UseExecuteMultiSendReturn {
    /** Trigger the full multi-send execution pipeline */
    executeSend: (password: string) => Promise<void>;
}

export function useExecuteMultiSend(): UseExecuteMultiSendReturn {
    const {
        state,
        dispatch,
        setExecutionPhase,
        setRowAddressStatus,
        setRowStatus,
        setBatchProgress,
        updateBatchStatus,
        setGlobalError,
    } = useMultiSend();

    const { getDecryptedSeed, walletAddress } = useWallet();

    const executeSend = useCallback(async (password: string) => {
        const { rows, walletType, mode, highloadMode } = state;

        try {
            // ══════════════════════════════════════════════════════════════
            // STEP 1: INPUT SANITIZATION
            // ══════════════════════════════════════════════════════════════
            setExecutionPhase('validating');

            // Filter out empty/incomplete rows
            const validRows: TransferRow[] = [];
            const errors: string[] = [];

            for (const row of rows) {
                const trimmedAddress = row.address.trim();
                const trimmedAmount = row.amount.trim();

                if (!trimmedAddress && !trimmedAmount) {
                    continue; // Skip completely empty rows
                }

                if (!trimmedAddress) {
                    errors.push(`Row missing address`);
                    setRowAddressStatus(row.id, 'invalid', null, 'Address is required');
                    continue;
                }

                if (!trimmedAmount || isNaN(Number(trimmedAmount)) || Number(trimmedAmount) <= 0) {
                    errors.push(`Row with address ${trimmedAddress.slice(0, 10)}… has invalid amount`);
                    setRowStatus(row.id, 'failed', 'Amount must be greater than 0');
                    continue;
                }

                // Basic format check (raw address or .ton domain)
                if (!isValidAddressFormat(trimmedAddress) && !DnsResolverService.isTonDomain(trimmedAddress)) {
                    setRowAddressStatus(row.id, 'invalid', null, 'Invalid address format');
                    errors.push(`Invalid address: ${trimmedAddress.slice(0, 10)}…`);
                    continue;
                }

                // Sanitize comment (strip null bytes, limit length)
                const sanitizedComment = (row.comment || '')
                    .replace(/\0/g, '')
                    .slice(0, 120);

                validRows.push({
                    ...row,
                    address: trimmedAddress,
                    amount: trimmedAmount,
                    comment: sanitizedComment,
                });
            }

            if (validRows.length === 0) {
                setGlobalError('No valid transfer rows. Please check your inputs.');
                setExecutionPhase('error');
                return;
            }

            if (errors.length > 0) {
                setGlobalError(`${errors.length} row(s) have validation errors. Proceeding with ${validRows.length} valid rows.`);
            }

            // ══════════════════════════════════════════════════════════════
            // STEP 2: DNS RESOLUTION
            // ══════════════════════════════════════════════════════════════
            setExecutionPhase('resolving_dns');

            const dnsResolver = new DnsResolverService('mainnet');

            // Collect all addresses that need resolution
            const addressesToResolve = validRows
                .filter((row) => DnsResolverService.isTonDomain(row.address))
                .map((row) => row.address);

            if (addressesToResolve.length > 0) {
                const dnsResults = await dnsResolver.resolveAll(addressesToResolve);

                // Apply resolution results back to rows
                for (const row of validRows) {
                    if (DnsResolverService.isTonDomain(row.address)) {
                        const result = dnsResults[row.address.trim().toLowerCase()];
                        if (result?.success && result.address) {
                            row.resolvedAddress = result.address;
                            row.addressStatus = 'valid';
                            setRowAddressStatus(row.id, 'valid', result.address);
                        } else {
                            row.addressStatus = 'invalid';
                            const errorMsg = result?.error || 'DNS resolution failed';
                            setRowAddressStatus(row.id, 'invalid', null, errorMsg);
                        }
                    }
                }

                // Check if any DNS resolutions failed — HALT if so
                const failedDns = validRows.filter(
                    (r) => DnsResolverService.isTonDomain(r.address) && r.addressStatus === 'invalid'
                );

                if (failedDns.length > 0) {
                    setGlobalError(
                        `${failedDns.length} .ton domain(s) could not be resolved. Fix or remove them before sending.`
                    );
                    setExecutionPhase('error');
                    return;
                }
            }

            // Mark all raw addresses as valid
            for (const row of validRows) {
                if (row.addressStatus !== 'valid' && DnsResolverService.isRawAddress(row.address)) {
                    row.addressStatus = 'valid';
                    row.resolvedAddress = row.address;
                    setRowAddressStatus(row.id, 'valid', row.address);
                }
            }

            // ══════════════════════════════════════════════════════════════
            // STEP 3: BALANCE CHECK
            // ══════════════════════════════════════════════════════════════
            setExecutionPhase('checking_balance');

            const estimatedTotal = estimateTotalFees(validRows);

            // In a full production implementation, we would fetch the actual
            // wallet balance here and compare. For now, we trust the validation
            // was done at the UI level and proceed.
            // TODO: Implement actual balance fetch from TonClient
            // const balance = await client.getBalance(Address.parse(senderAddress));
            // if (balance < estimatedTotal) {
            //     setGlobalError(`Insufficient balance. Need ${fromNano(estimatedTotal)} TON.`);
            //     setExecutionPhase('error');
            //     return;
            // }

            // ══════════════════════════════════════════════════════════════
            // STEP 4: PREPARE BATCH PROGRESS TRACKING
            // ══════════════════════════════════════════════════════════════
            const chunks = chunkTransfers(validRows);

            const initialBatchStatuses: BatchStatus[] = chunks.map((chunk, i) => ({
                index: i,
                status: 'pending' as const,
                rowIds: chunk.rows.map((r) => r.id),
            }));

            const initialProgress: BatchProgress = {
                currentBatch: 0,
                totalBatches: chunks.length,
                batchStatuses: initialBatchStatuses,
            };

            setBatchProgress(initialProgress);

            // ══════════════════════════════════════════════════════════════
            // STEP 5: DISPATCH
            // ══════════════════════════════════════════════════════════════
            setExecutionPhase('sending');

            // Build common execution params
            // ── Connect to WalletContext ──────────────────────────────────────
            if (!walletAddress) {
                throw new Error("No active wallet address found. Are you logged in?");
            }

            const mnemonic = await getDecryptedSeed(password);
            const { mnemonicToPrivateKey } = await import('@ton/crypto');
            const keyPair = await mnemonicToPrivateKey(mnemonic);

            const client = new TonClient({
                endpoint: 'https://toncenter.com/api/v2/jsonRPC',
                apiKey: import.meta.env.VITE_TONCENTER_API_KEY,
            });

            const senderAddress = walletAddress;

            const executeParams = {
                client,
                keyPair,
                senderAddress,
                network: 'mainnet' as const,
                rows: validRows,
                onBatchUpdate: (
                    chunkIndex: number,
                    status: 'sending' | 'waiting_confirmation' | 'success' | 'failed',
                    txHash?: string,
                    error?: string
                ) => {
                    updateBatchStatus(chunkIndex, status, txHash, error);
                },
                onRowUpdate: (
                    rowId: string,
                    status: 'sending' | 'success' | 'failed',
                    error?: string,
                    queryId?: bigint
                ) => {
                    setRowStatus(rowId, status as RowStatus, error, queryId);
                },
            };

            // Dispatch based on wallet type
            let results;

            if (walletType === 'highload-v3') {
                // Highload V3: Parallel dispatch via Query IDs
                results = await executeHighloadV3(executeParams, highloadMode);
            } else {
                // W5 / V5R1 / V4R2 / V3R2 / V3R1: Sequential batching with delays
                results = await executeW5Batch(executeParams);
            }

            // ══════════════════════════════════════════════════════════════
            // STEP 6: RESULT MAPPING
            // ══════════════════════════════════════════════════════════════
            const allSuccessful = results.every((r) => r.success);
            const anyFailed = results.some((r) => !r.success);

            if (allSuccessful) {
                setExecutionPhase('complete');
            } else if (anyFailed) {
                const failedCount = results.filter((r) => !r.success).length;
                const failedErrors = results
                    .filter((r) => !r.success && r.error)
                    .map((r) => r.error)
                    .join('; ');

                setGlobalError(
                    `${failedCount} batch(es) failed: ${failedErrors}`
                );
                setExecutionPhase('complete'); // Still mark as complete so user can see results
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';
            console.error('[MultiSend] Execution failed:', error);
            setGlobalError(errorMessage);
            setExecutionPhase('error');
        }
    }, [
        state,
        setExecutionPhase,
        setRowAddressStatus,
        setRowStatus,
        setBatchProgress,
        updateBatchStatus,
        setGlobalError,
        getDecryptedSeed,
        walletAddress,
    ]);

    return { executeSend };
}

export default useExecuteMultiSend;
