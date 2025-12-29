/**
 * Highload V3 Batch Test Suite
 * 
 * Tests the QueryID iterator and batch transaction logic
 * using Vitest framework.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { toNano } from '@ton/core';
import { HighloadQueryId, QueryIdStore } from '../src/wallets/highload-v3/HighloadQueryId';
import type { BatchTransaction } from '../src/types';

// Test configuration
const TEST_CONFIG = {
    BATCH_SIZE: 100,
    TEST_RECIPIENT: 'UQBsGx9arFLahaMBhsg6T-0YRkze6bqsM-GRxDPQRziLVR-j',
    AMOUNT_PER_TX: 0.001,
};

describe('HighloadQueryId', () => {
    describe('Basic creation', () => {
        it('should create with default state', () => {
            const qid = new HighloadQueryId();
            expect(qid.getShift()).toBe(0);
            expect(qid.getBitNumber()).toBe(0);
            expect(qid.getQueryId()).toBe(0n);
        });

        it('should create from shift and bit number', () => {
            const qid = HighloadQueryId.fromShiftAndBitNumber(100, 500);
            expect(qid.getShift()).toBe(100);
            expect(qid.getBitNumber()).toBe(500);

            // Verify formula: (Shift << 10) + BitNumber
            const expectedId = BigInt((100 << 10) + 500);
            expect(qid.getQueryId()).toBe(expectedId);
        });

        it('should create from timestamp', () => {
            const timestamp = Date.now();
            const qid = HighloadQueryId.fromTimestamp(timestamp);

            expect(qid.getShift()).toBeGreaterThanOrEqual(0);
            expect(qid.getShift()).toBeLessThanOrEqual(8191);
            expect(qid.getBitNumber()).toBeGreaterThanOrEqual(0);
            expect(qid.getBitNumber()).toBeLessThanOrEqual(1022);
        });
    });

    describe('QueryID Formula', () => {
        it('should calculate query ID as (Shift << 10) + BitNumber', () => {
            const testCases = [
                { shift: 0, bit: 0, expected: 0n },
                { shift: 1, bit: 0, expected: 1024n },
                { shift: 0, bit: 1, expected: 1n },
                { shift: 1, bit: 1, expected: 1025n },
                { shift: 100, bit: 500, expected: BigInt((100 << 10) + 500) },
                { shift: 8191, bit: 1022, expected: BigInt((8191 << 10) + 1022) },
            ];

            for (const tc of testCases) {
                const qid = HighloadQueryId.fromShiftAndBitNumber(tc.shift, tc.bit);
                expect(qid.getQueryId()).toBe(tc.expected);
            }
        });
    });

    describe('getNext()', () => {
        it('should return current state and increment', () => {
            const qid = HighloadQueryId.fromShiftAndBitNumber(0, 0);

            const first = qid.getNext();
            expect(first.getQueryId()).toBe(0n);
            expect(qid.getBitNumber()).toBe(1);

            const second = qid.getNext();
            expect(second.getQueryId()).toBe(1n);
            expect(qid.getBitNumber()).toBe(2);
        });

        it('should generate sequential IDs', () => {
            const qid = HighloadQueryId.fromShiftAndBitNumber(0, 0);
            const ids: bigint[] = [];

            for (let i = 0; i < 10; i++) {
                const next = qid.getNext();
                ids.push(next.getQueryId());
            }

            // Verify sequential
            for (let i = 1; i < ids.length; i++) {
                expect(ids[i]).toBe(ids[i - 1] + 1n);
            }
        });

        it('should increment shift when bitNumber reaches max', () => {
            const qid = HighloadQueryId.fromShiftAndBitNumber(0, 1021);

            qid.getNext(); // 0, 1021
            qid.getNext(); // 0, 1022
            qid.getNext(); // Should wrap to 1, 0

            expect(qid.getShift()).toBe(1);
            expect(qid.getBitNumber()).toBe(1);
        });
    });

    describe('hasNext()', () => {
        it('should return true when IDs available', () => {
            const qid = HighloadQueryId.fromShiftAndBitNumber(0, 0);
            expect(qid.hasNext()).toBe(true);
        });

        it('should return false at maximum', () => {
            const qid = HighloadQueryId.fromShiftAndBitNumber(8191, 1022);
            expect(qid.hasNext()).toBe(false);
        });
    });

    describe('Unique ID generation', () => {
        it('should generate 100 unique IDs', () => {
            const qid = HighloadQueryId.fromTimestamp();
            const uniqueIds = new Set<string>();

            for (let i = 0; i < 100; i++) {
                const next = qid.getNext();
                const id = next.getQueryId().toString();
                expect(uniqueIds.has(id)).toBe(false);
                uniqueIds.add(id);
            }

            expect(uniqueIds.size).toBe(100);
        });

        it('should generate 1000 unique IDs without duplicates', () => {
            const qid = HighloadQueryId.fromShiftAndBitNumber(0, 0);
            const uniqueIds = new Set<string>();

            for (let i = 0; i < 1000; i++) {
                const next = qid.getNext();
                const id = next.getQueryId().toString();
                expect(uniqueIds.has(id)).toBe(false);
                uniqueIds.add(id);
            }

            expect(uniqueIds.size).toBe(1000);
        });
    });

    describe('State management', () => {
        it('should clone correctly', () => {
            const qid = HighloadQueryId.fromShiftAndBitNumber(50, 100);
            const clone = qid.clone();

            expect(clone.getShift()).toBe(qid.getShift());
            expect(clone.getBitNumber()).toBe(qid.getBitNumber());
            expect(clone.getQueryId()).toBe(qid.getQueryId());

            // Modify original, clone should not change
            qid.getNext();
            expect(clone.getBitNumber()).toBe(100);
        });

        it('should reset correctly', () => {
            const qid = HighloadQueryId.fromShiftAndBitNumber(100, 500);
            qid.reset();

            expect(qid.getShift()).toBe(0);
            expect(qid.getBitNumber()).toBe(0);
        });

        it('should return correct state', () => {
            const qid = HighloadQueryId.fromShiftAndBitNumber(123, 456);
            const state = qid.getState();

            expect(state.shift).toBe(123);
            expect(state.bitNumber).toBe(456);
        });
    });

    describe('Validation', () => {
        it('should throw for invalid shift', () => {
            expect(() => HighloadQueryId.fromShiftAndBitNumber(-1, 0)).toThrow();
            expect(() => HighloadQueryId.fromShiftAndBitNumber(8192, 0)).toThrow();
        });

        it('should throw for invalid bitNumber', () => {
            expect(() => HighloadQueryId.fromShiftAndBitNumber(0, -1)).toThrow();
            expect(() => HighloadQueryId.fromShiftAndBitNumber(0, 1023)).toThrow();
        });
    });
});

describe('Batch Transaction Simulation', () => {
    it('should allocate unique QueryIDs for batch', () => {
        const transactions: BatchTransaction[] = [];

        for (let i = 0; i < TEST_CONFIG.BATCH_SIZE; i++) {
            transactions.push({
                to: TEST_CONFIG.TEST_RECIPIENT,
                amount: toNano(TEST_CONFIG.AMOUNT_PER_TX.toString()),
                comment: `Test tx ${i + 1}`,
                bounce: false,
            });
        }

        // Simulate QueryID allocation
        const queryIdIterator = HighloadQueryId.fromTimestamp();
        const allocatedIds: bigint[] = [];

        // For 100 transactions, we need 1 batch (max 254 per batch)
        const numBatches = Math.ceil(transactions.length / 254);

        for (let i = 0; i < numBatches; i++) {
            const batchQueryId = queryIdIterator.getNext();
            allocatedIds.push(batchQueryId.getQueryId());
        }

        // Verify all IDs are unique
        const uniqueCheck = new Set(allocatedIds.map(id => id.toString()));
        expect(uniqueCheck.size).toBe(allocatedIds.length);
    });

    it('should handle large batches (500+ transactions)', () => {
        const numTransactions = 500;
        const queryIdIterator = HighloadQueryId.fromShiftAndBitNumber(0, 0);
        const numBatches = Math.ceil(numTransactions / 254);

        const allocatedIds: bigint[] = [];

        for (let i = 0; i < numBatches; i++) {
            const batchQueryId = queryIdIterator.getNext();
            allocatedIds.push(batchQueryId.getQueryId());
        }

        expect(allocatedIds.length).toBe(numBatches);
        expect(numBatches).toBe(2); // 500/254 = 2 batches

        // Verify unique
        const uniqueCheck = new Set(allocatedIds.map(id => id.toString()));
        expect(uniqueCheck.size).toBe(numBatches);
    });
});

describe('QueryIdStore', () => {
    it('should initialize and get next', () => {
        const testAddress = `UQTest${Date.now()}`;
        const store = new QueryIdStore(testAddress);

        const first = store.getNext();
        const second = store.getNext();

        // IDs should be different
        expect(first.getQueryId()).not.toBe(second.getQueryId());
    });

    it('should report hasNext correctly', () => {
        const testAddress = `UQTest${Date.now()}`;
        const store = new QueryIdStore(testAddress);

        expect(store.hasNext()).toBe(true);
    });

    it('should return current state via getCurrent', () => {
        const testAddress = `UQTest${Date.now()}`;
        const store = new QueryIdStore(testAddress);

        const current1 = store.getCurrent();
        const current2 = store.getCurrent();

        // getCurrent should not advance
        expect(current1.getQueryId()).toBe(current2.getQueryId());
    });
});
