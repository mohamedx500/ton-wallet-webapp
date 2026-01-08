/**
 * TON Transaction Fee Configuration
 * ============================================================================
 * 
 * This module defines safe minimum fee constants for various transaction types.
 * The values are intentionally OVERESTIMATED to ensure transactions succeed
 * even under high network load conditions.
 * 
 * IMPORTANT: The "Overpay & Refund" Pattern
 * - We attach more TON than needed (overpay)
 * - Smart contracts return unused gas via `response_destination`
 * - User receives refund automatically (Op::Excesses - 0xd53276db)
 * 
 * Frontend Hint: Listen for incoming messages with op code 0xd53276db
 * to confirm gas refunds have been received.
 */

import { toNano } from '@ton/core';

/**
 * Fee configuration with safe minimums
 * All values are in nanoTON (BigInt)
 */
export const FEES_CONFIG = {
    // ============================================================================
    // JETTON TRANSFER FEES
    // ============================================================================

    /**
     * TON attached to jetton transfer message
     * Standard is ~0.03 TON, we use 0.05 for safety margin
     * This covers: gas + forward_amount + response message
     */
    JETTON_TRANSFER_ATTACHED: toNano('0.05'),

    /**
     * Forward TON amount for transfer notification
     * Sent to recipient as part of the transfer_notification message
     */
    JETTON_FORWARD_AMOUNT: toNano('0.01'),

    // ============================================================================
    // SWAP FEES (STON.fi / DeDust)
    // ============================================================================

    /**
     * Gas for TON -> Jetton swaps
     * Standard is ~0.15, we use 0.25 for safety with complex routing
     */
    SWAP_TON_TO_JETTON: toNano('0.25'),

    /**
     * Gas for Jetton -> TON swaps  
     * Needs extra gas for jetton wallet interaction
     */
    SWAP_JETTON_TO_TON: toNano('0.30'),

    /**
     * Gas for Jetton -> Jetton swaps
     * Most complex - involves two jetton wallets
     */
    SWAP_JETTON_TO_JETTON: toNano('0.35'),

    /**
     * DeDust specific gas (tends to need more due to vault architecture)
     */
    DEDUST_TON_SWAP: toNano('0.30'),
    DEDUST_JETTON_SWAP: toNano('0.35'),

    /**
     * STON.fi V1 gas requirements
     */
    STONFI_TON_SWAP: toNano('0.25'),
    STONFI_JETTON_SWAP: toNano('0.30'),

    // ============================================================================
    // HIGHLOAD WALLET SPECIFIC
    // ============================================================================

    /**
     * Highload V3 jetton transfer attached TON
     * Slightly higher to account for Highload's message structure
     */
    HIGHLOAD_JETTON_ATTACHED: toNano('0.06'),

    /**
     * Highload V3 swap attached TON
     */
    HIGHLOAD_SWAP_ATTACHED: toNano('0.30'),
} as const;

/**
 * Op codes for message identification
 * Used to detect refunds and notifications
 */
export const OP_CODES = {
    /** Jetton transfer operation */
    JETTON_TRANSFER: 0x0f8a7ea5,

    /** Transfer notification (received by recipient) */
    TRANSFER_NOTIFICATION: 0x7362d09c,

    /** Excess/refund message - confirms gas was returned */
    EXCESSES: 0xd53276db,

    /** Internal transfer between jetton wallets */
    INTERNAL_TRANSFER: 0x178d4519,

    /** Burn notification */
    BURN_NOTIFICATION: 0x7bdd97de,

    /** DeDust swap operation */
    DEDUST_SWAP: 0xea06185d,

    /** STON.fi V1 swap operation */
    STONFI_SWAP_V1: 0x25938561,
} as const;

/**
 * Helper function to get fee for a specific operation
 */
export function getFee(operation: keyof typeof FEES_CONFIG): bigint {
    return FEES_CONFIG[operation];
}

/**
 * Calculate total value for jetton transfer
 * @param forwardAmount - Optional custom forward amount
 * @returns Total TON to attach
 */
export function getJettonTransferValue(forwardAmount?: bigint): bigint {
    const forward = forwardAmount ?? FEES_CONFIG.JETTON_FORWARD_AMOUNT;
    return FEES_CONFIG.JETTON_TRANSFER_ATTACHED + forward;
}

/**
 * Calculate total value for swap based on token types
 * @param fromNative - Is the input token native TON?
 * @param toNative - Is the output token native TON?
 * @param swapAmount - Amount being swapped (only for native -> jetton)
 * @param provider - DEX provider ('stonfi' | 'dedust')
 * @returns Gas fee to add (not including swap amount)
 */
export function getSwapGasFee(
    fromNative: boolean,
    toNative: boolean,
    provider: 'stonfi' | 'dedust'
): bigint {
    if (provider === 'dedust') {
        return fromNative ? FEES_CONFIG.DEDUST_TON_SWAP : FEES_CONFIG.DEDUST_JETTON_SWAP;
    } else {
        // STON.fi
        if (fromNative && !toNative) {
            return FEES_CONFIG.STONFI_TON_SWAP;
        } else if (!fromNative && toNative) {
            return FEES_CONFIG.STONFI_JETTON_SWAP;
        } else {
            return FEES_CONFIG.SWAP_JETTON_TO_JETTON;
        }
    }
}

export default FEES_CONFIG;
