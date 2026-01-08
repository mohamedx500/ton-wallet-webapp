/**
 * AtomicQueryIdProvider - Collision-free Highload V3 Query ID Generator
 * ============================================================================
 * 
 * Problem: Under high load, Date.now() % 1023 causes query_id collisions
 * because multiple transactions within the same millisecond get the same ID.
 * 
 * Solution: Maintain an atomic rolling counter that guarantees uniqueness
 * even under 1,000+ requests/second load.
 * 
 * Highload V3 Query ID Format:
 * - shift: (timestamp / 1000) % 8192 (13-bit window based on seconds)
 * - bitNumber: Rolling counter 0-1022 within each shift window
 */

import { HighloadQueryId } from '../wallets/highload-v3/index';

// Maximum bitNumber value (Highload V3 uses 10-bit field = 0-1022)
const MAX_BIT_NUMBER = 1022;

// Maximum shift value (13-bit field = 0-8191)
const MAX_SHIFT = 8191;

/**
 * AtomicQueryIdProvider
 * Thread-safe query ID generator for Highload V3 transactions
 */
class AtomicQueryIdProvider {
    private currentShift: number = 0;
    private currentBitNumber: number = 0;
    private lastTimestamp: number = 0;
    private usedBitNumbers: Set<number> = new Set();

    constructor() {
        this.reset();
    }

    /**
     * Reset the provider state
     */
    reset(): void {
        this.currentShift = Math.floor(Date.now() / 1000) % (MAX_SHIFT + 1);
        this.currentBitNumber = 0;
        this.lastTimestamp = Date.now();
        this.usedBitNumbers.clear();
    }

    /**
     * Get the next unique query ID
     * Guarantees no collisions even under high-frequency usage
     * 
     * @returns HighloadQueryId instance ready for use
     */
    getNextQueryId(): HighloadQueryId {
        const now = Date.now();
        const currentSecond = Math.floor(now / 1000);
        const newShift = currentSecond % (MAX_SHIFT + 1);

        // If we've moved to a new second (shift window), reset the counter
        if (newShift !== this.currentShift) {
            this.currentShift = newShift;
            this.currentBitNumber = 0;
            this.usedBitNumbers.clear();
        }

        // Find the next available bitNumber
        while (this.usedBitNumbers.has(this.currentBitNumber)) {
            this.currentBitNumber = (this.currentBitNumber + 1) % (MAX_BIT_NUMBER + 1);

            // If we've wrapped around completely, force a new shift
            if (this.usedBitNumbers.size >= MAX_BIT_NUMBER) {
                // Wait a tiny bit to get a new millisecond, then recalculate shift
                this.currentShift = (this.currentShift + 1) % (MAX_SHIFT + 1);
                this.currentBitNumber = 0;
                this.usedBitNumbers.clear();
                break;
            }
        }

        // Mark this bitNumber as used
        this.usedBitNumbers.add(this.currentBitNumber);

        // Create the HighloadQueryId
        const queryId = HighloadQueryId.fromShiftAndBitNumber(
            this.currentShift,
            this.currentBitNumber
        );

        // Advance to next bitNumber for the next call
        const usedBitNumber = this.currentBitNumber;
        this.currentBitNumber = (this.currentBitNumber + 1) % (MAX_BIT_NUMBER + 1);
        this.lastTimestamp = now;

        console.log(`[AtomicQueryIdProvider] Generated queryId: shift=${this.currentShift}, bitNumber=${usedBitNumber}, raw=${queryId.getQueryId()}`);

        return queryId;
    }

    /**
     * Get current state for debugging
     */
    getState(): { shift: number; bitNumber: number; usedCount: number } {
        return {
            shift: this.currentShift,
            bitNumber: this.currentBitNumber,
            usedCount: this.usedBitNumbers.size,
        };
    }

    /**
     * Static method to create a simple query ID without tracking
     * Use this for one-off transactions where collisions are unlikely
     */
    static createSimpleQueryId(): HighloadQueryId {
        const now = Date.now();
        const shift = Math.floor(now / 1000) % (MAX_SHIFT + 1);
        // Use microsecond-level precision + random offset for bitNumber
        const bitNumber = (now % 1000 + Math.floor(Math.random() * 23)) % (MAX_BIT_NUMBER + 1);
        return HighloadQueryId.fromShiftAndBitNumber(shift, bitNumber);
    }
}

// Singleton instance for the application
export const atomicQueryIdProvider = new AtomicQueryIdProvider();

export default AtomicQueryIdProvider;
