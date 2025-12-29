/**
 * Highload Query ID Iterator
 * 
 * Implements the composite QueryID pattern for Highload Wallet V3.
 * CRITICAL: Uses (Shift << 10) + BitNumber pattern, NOT random QueryIDs.
 * 
 * The query_id is a 23-bit number composed of:
 * - Shift (13 bits): 0-8191, represents the time window
 * - BitNumber (10 bits): 0-1022, represents the sequence within the window
 * 
 * This ensures proper cleanup of the contract's dictionary and prevents
 * replay attacks.
 */

import type { QueryIdState } from '../../types';
import { HIGHLOAD_CONSTANTS } from '../../types';

/**
 * Highload Query ID Manager
 * 
 * Maintains state for generating unique, sequential query IDs.
 */
export class HighloadQueryId {
    private shift: number;
    private bitNumber: number;

    constructor(initialState?: QueryIdState) {
        this.shift = initialState?.shift ?? 0;
        this.bitNumber = initialState?.bitNumber ?? 0;
    }

    /**
     * Create from shift and bit number
     */
    static fromShiftAndBitNumber(shift: number, bitNumber: number): HighloadQueryId {
        if (shift < 0 || shift > HIGHLOAD_CONSTANTS.QUERY_ID_SHIFT_MAX) {
            throw new Error(`Shift must be between 0 and ${HIGHLOAD_CONSTANTS.QUERY_ID_SHIFT_MAX}`);
        }
        if (bitNumber < 0 || bitNumber > HIGHLOAD_CONSTANTS.QUERY_ID_BIT_MAX) {
            throw new Error(`BitNumber must be between 0 and ${HIGHLOAD_CONSTANTS.QUERY_ID_BIT_MAX}`);
        }

        return new HighloadQueryId({ shift, bitNumber });
    }

    /**
     * Create from current timestamp (time-based initialization)
     */
    static fromTimestamp(timestamp?: number): HighloadQueryId {
        const ts = timestamp ?? Date.now();
        // Use seconds as shift, modulo max value
        const shift = Math.floor(ts / 1000) % (HIGHLOAD_CONSTANTS.QUERY_ID_SHIFT_MAX + 1);
        // Use milliseconds mod max as initial bit number
        const bitNumber = ts % (HIGHLOAD_CONSTANTS.QUERY_ID_BIT_MAX + 1);

        return new HighloadQueryId({ shift, bitNumber });
    }

    /**
     * Get next query ID and advance the counter
     * Returns the current state before incrementing
     */
    getNext(): HighloadQueryId {
        // Create a copy of current state to return
        const current = HighloadQueryId.fromShiftAndBitNumber(this.shift, this.bitNumber);

        // Advance to next
        if (this.bitNumber >= HIGHLOAD_CONSTANTS.QUERY_ID_BIT_MAX) {
            this.bitNumber = 0;
            this.shift++;

            if (this.shift > HIGHLOAD_CONSTANTS.QUERY_ID_SHIFT_MAX) {
                throw new Error('HighloadQueryId overflow: shift exceeded maximum');
            }
        } else {
            this.bitNumber++;
        }

        return current;
    }

    /**
     * Check if there are more query IDs available
     */
    hasNext(): boolean {
        return this.shift < HIGHLOAD_CONSTANTS.QUERY_ID_SHIFT_MAX ||
            this.bitNumber < HIGHLOAD_CONSTANTS.QUERY_ID_BIT_MAX;
    }

    /**
     * Get current shift value
     */
    getShift(): number {
        return this.shift;
    }

    /**
     * Get current bit number
     */
    getBitNumber(): number {
        return this.bitNumber;
    }

    /**
     * Get the composite query ID as bigint
     * Formula: (Shift << 10) + BitNumber
     */
    getQueryId(): bigint {
        return BigInt((this.shift << 10) + this.bitNumber);
    }

    /**
     * Alias for getQueryId for compatibility
     */
    toQueryId(): bigint {
        return this.getQueryId();
    }

    /**
     * Get current state
     */
    getState(): QueryIdState {
        return {
            shift: this.shift,
            bitNumber: this.bitNumber,
        };
    }

    /**
     * Reset to initial state
     */
    reset(): void {
        this.shift = 0;
        this.bitNumber = 0;
    }

    /**
     * Clone the current state
     */
    clone(): HighloadQueryId {
        return HighloadQueryId.fromShiftAndBitNumber(this.shift, this.bitNumber);
    }

    /**
     * Get the total number of available query IDs from current state
     */
    getRemainingCount(): number {
        const remaining = (HIGHLOAD_CONSTANTS.QUERY_ID_SHIFT_MAX - this.shift) *
            (HIGHLOAD_CONSTANTS.QUERY_ID_BIT_MAX + 1) +
            (HIGHLOAD_CONSTANTS.QUERY_ID_BIT_MAX - this.bitNumber);
        return remaining;
    }
}

/**
 * Persistent Query ID Store
 * 
 * Manages query ID state persistence for the Highload wallet.
 * This is critical for ensuring query IDs are never reused.
 */
export class QueryIdStore {
    private readonly storageKey: string;
    private queryId: HighloadQueryId;

    constructor(walletAddress: string) {
        this.storageKey = `highload_queryid_${walletAddress}`;
        this.queryId = this.load();
    }

    /**
     * Load state from storage
     */
    private load(): HighloadQueryId {
        try {
            if (typeof localStorage !== 'undefined') {
                const saved = localStorage.getItem(this.storageKey);
                if (saved) {
                    const state = JSON.parse(saved) as QueryIdState;
                    return HighloadQueryId.fromShiftAndBitNumber(state.shift, state.bitNumber);
                }
            }
        } catch (error) {
            console.warn('Failed to load QueryId state:', error);
        }

        // Initialize from timestamp for uniqueness
        return HighloadQueryId.fromTimestamp();
    }

    /**
     * Save state to storage
     */
    private save(): void {
        try {
            if (typeof localStorage !== 'undefined') {
                localStorage.setItem(this.storageKey, JSON.stringify(this.queryId.getState()));
            }
        } catch (error) {
            console.warn('Failed to save QueryId state:', error);
        }
    }

    /**
     * Get next query ID and persist
     */
    getNext(): HighloadQueryId {
        const next = this.queryId.getNext();
        this.save();
        return next;
    }

    /**
     * Get current state without advancing
     */
    getCurrent(): HighloadQueryId {
        return this.queryId.clone();
    }

    /**
     * Reset the store
     */
    reset(): void {
        this.queryId = HighloadQueryId.fromTimestamp();
        this.save();
    }

    /**
     * Check if more IDs available
     */
    hasNext(): boolean {
        return this.queryId.hasNext();
    }
}

export default HighloadQueryId;
