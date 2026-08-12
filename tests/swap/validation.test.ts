/**
 * Pre-signature validation tests
 * ============================================================================
 *
 * The safety layer is the reason this rewrite exists, so it is tested directly
 * rather than only through the engine. Every check in `src/swap/validation.ts`
 * has at least one test that makes it fire and one that proves it does not fire
 * on a valid plan.
 *
 * The four defects behind the reported "sent 0.2 USDT, got 0.2 USDT back" have
 * dedicated regression tests, named after the defect. Those are the tests that
 * must never be deleted.
 *
 * @see docs/swap.md#validation
 */

import { describe, expect, it } from 'vitest';

import {
    DEFAULT_SWAP_POLICY,
    assertBounceable,
    assertDeadline,
    assertGasCoherent,
    assertPlanFresh,
    assertPlanSafeToSign,
    assertPlanStructure,
    assertPriceImpactAcceptable,
    assertQuoteCoherent,
    assertQuoteFresh,
    assertSlippageFloor,
    assertSufficientBalance,
    assertTrustedDestinations,
    assertValidQuoteRequest,
    assertValidSlippage,
    collectSwapWarnings,
    effectiveSlippageBps,
    resolveMinOut,
} from '../../src/swap/validation';
import { SwapErrorCode } from '../../src/swap/errors';
import type { SwapError } from '../../src/swap/errors';
import { AddressSet } from '../../src/core/address';
import { applySlippage } from '../../src/core/units';
import type { DestinationVerdict } from '../../src/swap/types';

import {
    ATTACKER,
    DEFAULT_GAS,
    NOW_MS,
    NOT,
    OWN_JETTON_WALLET,
    TON,
    UNVERIFIED,
    USDT,
    WALLET,
    addressKeyOf,
    approvingVerdicts,
    makeMessage,
    makePlan,
    makeQuote,
    makeReference,
} from './fixtures';

/** Assert that `run` throws a `SwapError` with the given code; return it. */
function expectSwapError(run: () => unknown, code: string): SwapError {
    let thrown: unknown;
    try {
        run();
    } catch (error) {
        thrown = error;
    }
    if (thrown === undefined) {
        throw new Error(`expected a SwapError with code ${code}, but nothing was thrown`);
    }
    const error = thrown as SwapError;
    expect(error.code).toBe(code);
    return error;
}

// ────────────────────────────────────────────────────────────────────────────

describe('assertValidQuoteRequest', () => {
    const base = {
        from: USDT,
        to: TON,
        offerUnits: 200_000n,
        slippageBps: 100,
        walletAddress: WALLET,
        nowMs: NOW_MS,
    };

    it('accepts a well-formed request', () => {
        expect(() => assertValidQuoteRequest(base)).not.toThrow();
    });

    it('rejects a zero amount', () => {
        expectSwapError(() => assertValidQuoteRequest({ ...base, offerUnits: 0n }), SwapErrorCode.InvalidRequest);
    });

    it('rejects a negative amount', () => {
        expectSwapError(() => assertValidQuoteRequest({ ...base, offerUnits: -1n }), SwapErrorCode.InvalidRequest);
    });

    it('rejects swapping an asset for itself', () => {
        expectSwapError(() => assertValidQuoteRequest({ ...base, to: USDT }), SwapErrorCode.InvalidRequest);
    });

    it('rejects the same jetton spelled with a different address encoding', () => {
        // The non-bounceable spelling of the same master. A string comparison
        // would let this through and quote a self-swap.
        const nonBounceable = { ...USDT, master: unbounceable(USDT.master) };
        expectSwapError(
            () => assertValidQuoteRequest({ ...base, from: USDT, to: nonBounceable }),
            SwapErrorCode.InvalidRequest,
        );
    });

    it('refuses to trade a blacklisted asset', () => {
        const blacklisted = { ...UNVERIFIED, trust: 'blacklisted' as const };
        const error = expectSwapError(
            () => assertValidQuoteRequest({ ...base, to: blacklisted }),
            SwapErrorCode.InvalidRequest,
        );
        expect(error.message).toContain('flagged as unsafe');
    });

    it('rejects an implausible decimals claim', () => {
        // Metadata is attacker-controlled and `decimals` scales every displayed
        // amount, so a nonsense value has to fail before it reaches the UI.
        expectSwapError(
            () => assertValidQuoteRequest({ ...base, to: { ...NOT, decimals: 255 } }),
            SwapErrorCode.InvalidRequest,
        );
        expectSwapError(
            () => assertValidQuoteRequest({ ...base, to: { ...NOT, decimals: -1 } }),
            SwapErrorCode.InvalidRequest,
        );
        expectSwapError(
            () => assertValidQuoteRequest({ ...base, to: { ...NOT, decimals: 6.5 } }),
            SwapErrorCode.InvalidRequest,
        );
    });
});

describe('assertValidSlippage', () => {
    it('accepts the policy bounds themselves', () => {
        expect(() => assertValidSlippage(DEFAULT_SWAP_POLICY.minSlippageBps)).not.toThrow();
        expect(() => assertValidSlippage(DEFAULT_SWAP_POLICY.maxSlippageBps)).not.toThrow();
    });

    it('rejects zero slippage', () => {
        // Not a typo in the policy: an AMM's output moves between simulation and
        // execution, so a 0% tolerance is a guaranteed revert, not a better price.
        expectSwapError(() => assertValidSlippage(0), SwapErrorCode.InvalidSlippage);
    });

    it('rejects slippage above the ceiling', () => {
        expectSwapError(
            () => assertValidSlippage(DEFAULT_SWAP_POLICY.maxSlippageBps + 1),
            SwapErrorCode.InvalidSlippage,
        );
    });

    it('rejects a fractional bps value', () => {
        // bps exists to keep slippage in integers; a float here means someone
        // converted a percentage with `*100` and hit binary rounding.
        expectSwapError(() => assertValidSlippage(50.5), SwapErrorCode.InvalidRequest);
        expectSwapError(() => assertValidSlippage(Number.NaN), SwapErrorCode.InvalidRequest);
    });
});

describe('assertQuoteFresh', () => {
    it('accepts a quote inside the window', () => {
        const quote = makeQuote();
        expect(() => assertQuoteFresh(quote, NOW_MS + DEFAULT_SWAP_POLICY.maxQuoteAgeMs - 1)).not.toThrow();
    });

    it('rejects a quote past the window', () => {
        const quote = makeQuote();
        expectSwapError(
            () => assertQuoteFresh(quote, NOW_MS + DEFAULT_SWAP_POLICY.maxQuoteAgeMs + 1),
            SwapErrorCode.QuoteExpired,
        );
    });

    it('rejects a quote stamped in the future', () => {
        // A clock skew large enough to matter must not read as "infinitely fresh".
        const quote = makeQuote({ createdAtMs: NOW_MS + 60_000 });
        expectSwapError(() => assertQuoteFresh(quote, NOW_MS), SwapErrorCode.QuoteExpired);
    });

    it('tolerates small clock skew', () => {
        const quote = makeQuote({ createdAtMs: NOW_MS + 1_000 });
        expect(() => assertQuoteFresh(quote, NOW_MS)).not.toThrow();
    });
});

describe('assertQuoteCoherent', () => {
    it('accepts a coherent quote', () => {
        expect(() => assertQuoteCoherent(makeQuote())).not.toThrow();
    });

    it('rejects a quote that returns nothing', () => {
        expectSwapError(
            () => assertQuoteCoherent(makeQuote({ expectedOutUnits: 0n, minOutUnits: 0n })),
            SwapErrorCode.InvalidRequest,
        );
    });

    it('rejects a zero minimum-received', () => {
        // `min_out: 0` is what an unbounded-slippage payload looks like. The
        // contract would accept any price at all.
        expectSwapError(
            () => assertQuoteCoherent(makeQuote({ minOutUnits: 0n })),
            SwapErrorCode.MalformedTransaction,
        );
    });

    it('rejects a minimum above the expected output', () => {
        // Guaranteed revert. Reachable by mixing a simulated output with a locally
        // recomputed floor at different precisions.
        const quote = makeQuote({ expectedOutUnits: 1_000n, minOutUnits: 1_001n });
        const error = expectSwapError(() => assertQuoteCoherent(quote), SwapErrorCode.MalformedTransaction);
        expect(error.message).toContain('could never succeed');
    });

    it('rejects a negative price impact', () => {
        expectSwapError(
            () => assertQuoteCoherent(makeQuote({ priceImpactBps: -5 })),
            SwapErrorCode.MalformedTransaction,
        );
    });
});

describe('assertSlippageFloor', () => {
    it('accepts a floor exactly at the tolerance', () => {
        expect(() => assertSlippageFloor(makeQuote())).not.toThrow();
    });

    it('accepts a floor stricter than the tolerance', () => {
        const quote = makeQuote();
        expect(() => assertSlippageFloor({ ...quote, minOutUnits: quote.expectedOutUnits })).not.toThrow();
    });

    it('rejects a floor one unit below the tolerance', () => {
        // The smallest possible violation, and the one a rounding bug produces.
        const quote = makeQuote();
        const error = expectSwapError(
            () => assertSlippageFloor({ ...quote, minOutUnits: quote.minOutUnits - 1n }),
            SwapErrorCode.MalformedTransaction,
        );
        expect(error.details['slippageBps']).toBe('100');
    });

    it('rejects a provider floor that silently widens the tolerance', () => {
        // The user asked for 1%; the payload would accept a 30% loss. This is the
        // check that makes `minOutUnits` from a provider advisory rather than
        // authoritative.
        const quote = makeQuote({ slippageBps: 100 });
        expectSwapError(
            () => assertSlippageFloor({ ...quote, minOutUnits: applySlippage(quote.expectedOutUnits, 3_000) }),
            SwapErrorCode.MalformedTransaction,
        );
    });
});

describe('resolveMinOut', () => {
    it('takes whichever floor is stricter', () => {
        const expected = 1_000_000n;
        // Provider's floor is looser (2%) than the user's 1% → user's wins.
        expect(resolveMinOut(expected, 100, applySlippage(expected, 200))).toBe(applySlippage(expected, 100));
        // Provider's floor is stricter (0.5%) → provider's wins.
        expect(resolveMinOut(expected, 100, applySlippage(expected, 50))).toBe(applySlippage(expected, 50));
    });

    it('can only ever tighten protection, never loosen it', () => {
        const expected = 12_345_678_901_234_567_890n; // beyond 2^53
        for (const providerBps of [0, 1, 50, 100, 500, 9_999]) {
            const resolved = resolveMinOut(expected, 100, applySlippage(expected, providerBps));
            expect(resolved).toBeGreaterThanOrEqual(applySlippage(expected, 100));
        }
    });
});

describe('assertPriceImpactAcceptable', () => {
    it('accepts ordinary impact', () => {
        expect(() => assertPriceImpactAcceptable(makeQuote({ priceImpactBps: 150 }))).not.toThrow();
    });

    it('accepts impact exactly at the ceiling', () => {
        const at = DEFAULT_SWAP_POLICY.maxPriceImpactBps;
        expect(() => assertPriceImpactAcceptable(makeQuote({ priceImpactBps: at }))).not.toThrow();
    });

    it('refuses impact above the ceiling', () => {
        const over = DEFAULT_SWAP_POLICY.maxPriceImpactBps + 1;
        expectSwapError(
            () => assertPriceImpactAcceptable(makeQuote({ priceImpactBps: over })),
            SwapErrorCode.InvalidRequest,
        );
    });
});

// ────────────────────────────────────────────────────────────────────────────
// Regression tests for the four audited defects
// ────────────────────────────────────────────────────────────────────────────

describe('regression: defect A4 — bounce: false burned the funds', () => {
    it('accepts a bounceable plan', () => {
        expect(() => assertBounceable(makePlan())).not.toThrow();
    });

    it('refuses a non-bounceable message', () => {
        // The audited builder hardcoded `bounce: false`. On TON that converts a
        // recoverable DEX rejection into permanent loss: the value stays at the
        // destination instead of returning.
        const plan = makePlan({ messages: [makeMessage({ bounce: false })] });
        const error = expectSwapError(() => assertBounceable(plan), SwapErrorCode.MalformedTransaction);
        expect(error.severity).toBe('suspicious');
        expect(error.message).toContain('would not return your funds');
    });

    it('refuses when only one of several messages is non-bounceable', () => {
        const quote = makeQuote();
        const half = quote.gas.messageValue / 2n;
        const plan = makePlan({
            quote,
            messages: [makeMessage({ value: half }), makeMessage({ value: half, bounce: false })],
        });
        expectSwapError(() => assertBounceable(plan), SwapErrorCode.MalformedTransaction);
    });
});

describe('regression: defect A1 — tx_deadline was hardcoded to 0', () => {
    it('accepts a deadline in the near future', () => {
        expect(() => assertDeadline(makePlan(), NOW_MS)).not.toThrow();
    });

    it('refuses a deadline of zero', () => {
        // This single field caused every V2 swap to bounce. `0` is always in the
        // past, so the router's `tx_deadline` check failed on arrival and refunded
        // the jettons — exactly the reported 0.2 USDT round-trip.
        const plan = makePlan({ reference: makeReference({ deadlineUnix: 0 }) });
        const error = expectSwapError(() => assertDeadline(plan, NOW_MS), SwapErrorCode.MalformedTransaction);
        expect(error.message).toContain('already passed');
        expect(error.details['deadlineUnix']).toBe('0');
    });

    it('refuses a deadline one second in the past', () => {
        const nowUnix = Math.floor(NOW_MS / 1000);
        const plan = makePlan({ reference: makeReference({ deadlineUnix: nowUnix - 1 }) });
        expectSwapError(() => assertDeadline(plan, NOW_MS), SwapErrorCode.MalformedTransaction);
    });

    it('refuses a deadline equal to now', () => {
        // `<=` not `<`: a message that arrives in the same second as its deadline
        // is racing the block, and the router compares against block time.
        const nowUnix = Math.floor(NOW_MS / 1000);
        const plan = makePlan({ reference: makeReference({ deadlineUnix: nowUnix }) });
        expectSwapError(() => assertDeadline(plan, NOW_MS), SwapErrorCode.MalformedTransaction);
    });

    it('refuses a deadline absurdly far in the future', () => {
        // A stalled message with a week-long deadline can execute at a price from
        // an entirely different market.
        const nowUnix = Math.floor(NOW_MS / 1000);
        const plan = makePlan({ reference: makeReference({ deadlineUnix: nowUnix + 7 * 24 * 3_600 }) });
        expectSwapError(() => assertDeadline(plan, NOW_MS), SwapErrorCode.MalformedTransaction);
    });

    it('permits a null deadline for providers without on-chain expiry', () => {
        // V1 routers have no `tx_deadline` field. That is legitimate — but it is
        // why `collectSwapWarnings` raises `no-on-chain-deadline`.
        const plan = makePlan({ reference: makeReference({ deadlineUnix: null }) });
        expect(() => assertDeadline(plan, NOW_MS)).not.toThrow();
    });
});

describe('regression: defect A6 — query_id was always 0', () => {
    it('accepts a 64-bit query id', () => {
        const plan = makePlan({ reference: makeReference({ queryId: (1n << 64n) - 1n }) });
        expect(() => assertPlanStructure(plan)).not.toThrow();
    });

    it('refuses a query id that does not fit the protocol field', () => {
        const plan = makePlan({ reference: makeReference({ queryId: 1n << 64n }) });
        expectSwapError(() => assertPlanStructure(plan), SwapErrorCode.MalformedTransaction);
    });

    it('refuses a negative query id', () => {
        const plan = makePlan({ reference: makeReference({ queryId: -1n }) });
        expectSwapError(() => assertPlanStructure(plan), SwapErrorCode.MalformedTransaction);
    });
});

describe('regression: signing an address that came from an HTTP response', () => {
    it('accepts a destination vouched for and independently verified', () => {
        const plan = makePlan();
        expect(() => assertTrustedDestinations(plan, approvingVerdicts(plan))).not.toThrow();
    });

    it('refuses a destination the provider did not vouch for', () => {
        const plan = makePlan({ trustedDestinations: new AddressSet([ATTACKER]) });
        const error = expectSwapError(
            () => assertTrustedDestinations(plan, approvingVerdicts(plan)),
            SwapErrorCode.UntrustedDestination,
        );
        expect(error.severity).toBe('suspicious');
    });

    it('refuses a destination with no independent verdict', () => {
        // A provider's own allow-list is not a check — it can contain anything.
        // The absence of a second opinion must fail closed.
        const plan = makePlan();
        const error = expectSwapError(
            () => assertTrustedDestinations(plan, new Map()),
            SwapErrorCode.UntrustedDestination,
        );
        expect(error.message).toContain('independent verification was not performed');
    });

    it('refuses a destination whose verdict is negative', () => {
        const plan = makePlan();
        const verdicts = new Map<string, DestinationVerdict>([
            [
                addressKeyOf(OWN_JETTON_WALLET),
                { trusted: false, role: 'own-jetton-wallet', reason: 'not derivable from the selected jetton master' },
            ],
        ]);
        const error = expectSwapError(
            () => assertTrustedDestinations(plan, verdicts),
            SwapErrorCode.UntrustedDestination,
        );
        expect(error.message).toContain('not derivable');
    });

    it('refuses a destination whose verified role differs from the claimed one', () => {
        // Stops a router being presented as "your own jetton wallet" on the
        // confirmation screen — the label is what the user actually reads.
        const plan = makePlan();
        const verdicts = new Map<string, DestinationVerdict>([
            [addressKeyOf(OWN_JETTON_WALLET), { trusted: true, role: 'dex-router', reason: 'in router registry' }],
        ]);
        const error = expectSwapError(
            () => assertTrustedDestinations(plan, verdicts),
            SwapErrorCode.UntrustedDestination,
        );
        expect(error.message).toContain('described it as own-jetton-wallet but verification found dex-router');
    });

    it('matches destinations regardless of address encoding', () => {
        // The plan vouches for the bounceable spelling; the message uses the
        // non-bounceable one. Same account, so this must pass — a string compare
        // here would block every legitimate swap.
        const plan = makePlan({
            messages: [makeMessage({ to: unbounceable(OWN_JETTON_WALLET) })],
            trustedDestinations: new AddressSet([OWN_JETTON_WALLET]),
        });
        const verdicts = new Map<string, DestinationVerdict>([
            [addressKeyOf(OWN_JETTON_WALLET), { trusted: true, role: 'own-jetton-wallet', reason: 'derived on-chain' }],
        ]);
        expect(() => assertTrustedDestinations(plan, verdicts)).not.toThrow();
    });
});

// ────────────────────────────────────────────────────────────────────────────

describe('assertGasCoherent', () => {
    it('accepts coherent gas accounting', () => {
        expect(() => assertGasCoherent(makePlan())).not.toThrow();
    });

    it('refuses a forward amount equal to the attached value', () => {
        // The silent killer: the jetton wallet requires the attached value to
        // cover the forward amount *plus* its own fees, so it aborts before the
        // DEX ever sees the message. The user sees a failure with no explanation.
        const quote = makeQuote({
            gas: { messageValue: 300_000_000n, forwardValue: 300_000_000n, estimatedConsumption: 200_000_000n },
        });
        const error = expectSwapError(
            () => assertGasCoherent(makePlan({ quote })),
            SwapErrorCode.MalformedTransaction,
        );
        expect(error.message).toContain('abort before reaching the DEX');
    });

    it('refuses a forward amount above the attached value', () => {
        const quote = makeQuote({
            gas: { messageValue: 100_000_000n, forwardValue: 300_000_000n, estimatedConsumption: 50_000_000n },
        });
        expectSwapError(() => assertGasCoherent(makePlan({ quote })), SwapErrorCode.MalformedTransaction);
    });

    it('refuses a zero attached value', () => {
        const quote = makeQuote({
            gas: { messageValue: 0n, forwardValue: 0n, estimatedConsumption: 0n },
        });
        expectSwapError(() => assertGasCoherent(makePlan({ quote })), SwapErrorCode.MalformedTransaction);
    });

    it('refuses when the messages carry a different total than the quote declared', () => {
        // Otherwise the balance check the engine performed was against the wrong
        // number, and a swap can be approved that the wallet cannot afford.
        const quote = makeQuote();
        const plan = makePlan({ quote, messages: [makeMessage({ value: quote.gas.messageValue + 1n })] });
        const error = expectSwapError(() => assertGasCoherent(plan), SwapErrorCode.MalformedTransaction);
        expect(error.details['attached']).toBe((quote.gas.messageValue + 1n).toString());
        expect(error.details['quoted']).toBe(quote.gas.messageValue.toString());
    });

    it('sums multi-message plans rather than checking each message', () => {
        const quote = makeQuote();
        const half = quote.gas.messageValue / 2n;
        const plan = makePlan({
            quote,
            messages: [makeMessage({ value: half }), makeMessage({ value: quote.gas.messageValue - half })],
        });
        expect(() => assertGasCoherent(plan)).not.toThrow();
    });
});

describe('assertPlanStructure', () => {
    it('accepts a well-formed plan', () => {
        expect(() => assertPlanStructure(makePlan())).not.toThrow();
    });

    it('refuses a plan with no messages', () => {
        expectSwapError(() => assertPlanStructure(makePlan({ messages: [] })), SwapErrorCode.MalformedTransaction);
    });

    it('refuses a plan with implausibly many messages', () => {
        // A swap is one message, or a handful for a multi-hop route. A long list
        // means a bug, or extra transfers smuggled past the confirmation screen.
        const messages = Array.from({ length: 5 }, () => makeMessage({ value: 1_000_000n }));
        expectSwapError(() => assertPlanStructure(makePlan({ messages })), SwapErrorCode.MalformedTransaction);
    });

    it('refuses a plan whose quote came from another provider', () => {
        const plan = makePlan({ quote: makeQuote({ providerId: 'other-dex' }), providerId: 'test-dex' });
        expectSwapError(() => assertPlanStructure(plan), SwapErrorCode.MalformedTransaction);
    });

    it('refuses a plan whose reference names another provider', () => {
        const plan = makePlan({ reference: makeReference({ providerId: 'other-dex' }) });
        expectSwapError(() => assertPlanStructure(plan), SwapErrorCode.MalformedTransaction);
    });

    it('refuses a plan that vouches for no destinations', () => {
        expectSwapError(
            () => assertPlanStructure(makePlan({ trustedDestinations: new AddressSet([]) })),
            SwapErrorCode.MalformedTransaction,
        );
    });

    it('refuses a message with a zero value', () => {
        // A zero-value message cannot pay for its own processing, let alone the
        // chain of internal messages a swap needs.
        expectSwapError(
            () => assertPlanStructure(makePlan({ messages: [makeMessage({ value: 0n })] })),
            SwapErrorCode.MalformedTransaction,
        );
    });

    it('refuses a message with a negative value', () => {
        expectSwapError(
            () => assertPlanStructure(makePlan({ messages: [makeMessage({ value: -1n })] })),
            SwapErrorCode.MalformedTransaction,
        );
    });

    it('refuses a message with no description for the confirmation screen', () => {
        // The user must never be asked to approve an opaque payload.
        expectSwapError(
            () => assertPlanStructure(makePlan({ messages: [makeMessage({ purpose: '   ' })] })),
            SwapErrorCode.MalformedTransaction,
        );
    });

    it('refuses a message whose destination role is unknown', () => {
        expectSwapError(
            () => assertPlanStructure(makePlan({ messages: [makeMessage({ destinationRole: 'unknown' })] })),
            SwapErrorCode.MalformedTransaction,
        );
    });

    it('refuses a message with an unparseable destination', () => {
        // Also proves the address the user is shown is the one being signed:
        // `formatAddress` round-trips it.
        expect(() =>
            assertPlanStructure(makePlan({ messages: [makeMessage({ to: 'not-an-address' })] })),
        ).toThrow();
    });
});

describe('assertPlanFresh', () => {
    it('accepts a plan inside its window', () => {
        expect(() => assertPlanFresh(makePlan(), NOW_MS + 1_000)).not.toThrow();
    });

    it('refuses a plan past its own expiry', () => {
        const plan = makePlan({ expiresAtMs: NOW_MS + 10_000 });
        expectSwapError(() => assertPlanFresh(plan, NOW_MS + 10_001), SwapErrorCode.QuoteExpired);
    });

    it('refuses a plan built from a quote older than the plan-age ceiling', () => {
        // A provider could set `expiresAtMs` arbitrarily far out; the quote's own
        // age is the independent bound.
        const plan = makePlan({
            quote: makeQuote({ createdAtMs: NOW_MS - DEFAULT_SWAP_POLICY.maxPlanAgeMs - 1 }),
            expiresAtMs: NOW_MS + 600_000,
        });
        expectSwapError(() => assertPlanFresh(plan, NOW_MS), SwapErrorCode.QuoteExpired);
    });
});

describe('assertPlanSafeToSign', () => {
    it('accepts a fully valid plan', () => {
        const plan = makePlan();
        expect(() => assertPlanSafeToSign(plan, NOW_MS, approvingVerdicts(plan))).not.toThrow();
    });

    it('checks structure before semantics', () => {
        // An empty-message plan must fail on structure, not crash inside a check
        // that assumes there is a message to inspect.
        const plan = makePlan({ messages: [] });
        expectSwapError(
            () => assertPlanSafeToSign(plan, NOW_MS, new Map()),
            SwapErrorCode.MalformedTransaction,
        );
    });

    it.each([
        ['non-bounceable message', () => makePlan({ messages: [makeMessage({ bounce: false })] })],
        ['zero deadline', () => makePlan({ reference: makeReference({ deadlineUnix: 0 }) })],
        [
            'unbounded min_out',
            () => {
                const quote = makeQuote({ minOutUnits: 0n });
                return makePlan({ quote });
            },
        ],
        [
            'incoherent gas',
            () =>
                makePlan({
                    quote: makeQuote({
                        gas: { messageValue: 100n, forwardValue: 100n, estimatedConsumption: 50n },
                    }),
                    messages: [makeMessage({ value: 100n })],
                }),
        ],
    ])('refuses to sign a plan with a %s', (_label, build) => {
        const plan = build();
        expect(() => assertPlanSafeToSign(plan, NOW_MS, approvingVerdicts(plan))).toThrow();
    });

    it('refuses to sign when verification was skipped, even if everything else is valid', () => {
        // The property that matters most: a caller cannot get a signature by
        // simply not running `verifyDestination`.
        const plan = makePlan();
        expectSwapError(
            () => assertPlanSafeToSign(plan, NOW_MS, new Map()),
            SwapErrorCode.UntrustedDestination,
        );
    });
});

// ────────────────────────────────────────────────────────────────────────────

describe('assertSufficientBalance', () => {
    it('accepts a wallet that can afford the trade and the gas', () => {
        const quote = makeQuote();
        expect(() =>
            assertSufficientBalance(quote, {
                tonUnits: quote.gas.messageValue + DEFAULT_SWAP_POLICY.tonReserve,
                offeredAssetUnits: quote.offerUnits,
            }),
        ).not.toThrow();
    });

    it('refuses when TON covers the gas but not the reserve', () => {
        // Spending to a balance that cannot pay for the next transfer strands the
        // wallet, which is a support ticket rather than a lost swap — but still a
        // failure the user did not choose.
        const quote = makeQuote();
        const error = expectSwapError(
            () =>
                assertSufficientBalance(quote, {
                    tonUnits: quote.gas.messageValue,
                    offeredAssetUnits: quote.offerUnits,
                }),
            SwapErrorCode.InsufficientGas,
        );
        expect(error.message).toContain('network fees');
    });

    it('refuses when the jetton balance is short by one unit', () => {
        const quote = makeQuote();
        expectSwapError(
            () =>
                assertSufficientBalance(quote, {
                    tonUnits: quote.gas.messageValue + DEFAULT_SWAP_POLICY.tonReserve,
                    offeredAssetUnits: quote.offerUnits - 1n,
                }),
            SwapErrorCode.InsufficientFunds,
        );
    });

    it('does not double-count the offered TON on a native swap', () => {
        // `gas.messageValue` already includes the offered TON for a native offer.
        // Checking the offer separately would demand twice the balance and refuse
        // affordable swaps.
        const offerUnits = 1_000_000_000n;
        const quote = makeQuote({
            from: TON,
            to: USDT,
            offerUnits,
            expectedOutUnits: 200_000n,
            gas: {
                messageValue: offerUnits + 300_000_000n,
                forwardValue: 240_000_000n,
                estimatedConsumption: 180_000_000n,
            },
        });
        expect(() =>
            assertSufficientBalance(quote, {
                tonUnits: offerUnits + 300_000_000n + DEFAULT_SWAP_POLICY.tonReserve,
                offeredAssetUnits: offerUnits,
            }),
        ).not.toThrow();
    });

    it('reports amounts in the offered asset own decimals', () => {
        // USDT has 6 decimals, not 9. Reporting "need 0.000000200" for a 0.2 USDT
        // shortfall is the kind of display bug that makes users distrust a wallet.
        const quote = makeQuote({ offerUnits: 200_000n });
        const error = expectSwapError(
            () =>
                assertSufficientBalance(quote, {
                    tonUnits: quote.gas.messageValue + DEFAULT_SWAP_POLICY.tonReserve,
                    offeredAssetUnits: 100_000n,
                }),
            SwapErrorCode.InsufficientFunds,
        );
        expect(error.details['required']).toBe('0.2');
        expect(error.details['available']).toBe('0.1');
    });
});

// ────────────────────────────────────────────────────────────────────────────

describe('collectSwapWarnings', () => {
    const withDeadline = { hasOnChainDeadline: true };

    it('returns nothing for an ordinary trade between verified assets', () => {
        const quote = makeQuote({ from: USDT, to: NOT, slippageBps: 100, priceImpactBps: 20 });
        expect(collectSwapWarnings(quote, withDeadline)).toEqual([]);
    });

    it('warns about high slippage and states the worst case', () => {
        const quote = makeQuote({ slippageBps: 500 });
        const warnings = collectSwapWarnings(quote, withDeadline);
        const warning = warnings.find((candidate) => candidate.code === 'high-slippage');
        expect(warning).toBeDefined();
        // The number the user actually needs: what they could end up with.
        expect(warning?.message).toContain('0.95');
    });

    it('warns about high price impact', () => {
        const quote = makeQuote({ priceImpactBps: 800 });
        expect(collectSwapWarnings(quote, withDeadline).map((w) => w.code)).toContain('high-price-impact');
    });

    it('warns when slippage is below what the pool needs', () => {
        // A pool-specific recommendation the user has undercut: the swap will
        // probably revert and refund, which looks like a wallet bug if unexplained.
        const quote = makeQuote({ slippageBps: 50, recommendedSlippageBps: 200 });
        expect(collectSwapWarnings(quote, withDeadline).map((w) => w.code)).toContain('slippage-below-recommended');
    });

    it('warns once per unverified asset', () => {
        const quote = makeQuote({ from: UNVERIFIED, to: UNVERIFIED });
        const unverified = collectSwapWarnings(quote, withDeadline).filter((w) => w.code === 'unverified-asset');
        expect(unverified).toHaveLength(2);
    });

    it('warns when the route has no on-chain expiry', () => {
        const codes = collectSwapWarnings(makeQuote(), { hasOnChainDeadline: false }).map((w) => w.code);
        expect(codes).toContain('no-on-chain-deadline');
    });

    it('warns rather than refusing, so a risky-but-intended trade still works', () => {
        // The distinction the audited code conflated. A caution is not a refusal.
        const quote = makeQuote({ slippageBps: 1_500, priceImpactBps: 2_500, from: UNVERIFIED });
        expect(collectSwapWarnings(quote, { hasOnChainDeadline: false }).length).toBeGreaterThan(3);
        expect(() => assertPriceImpactAcceptable(quote)).not.toThrow();
        expect(() => assertValidSlippage(quote.slippageBps)).not.toThrow();
    });
});

describe('effectiveSlippageBps', () => {
    it('reports the tolerance actually encoded in the quote', () => {
        const quote = makeQuote({ expectedOutUnits: 1_000_000n, slippageBps: 100 });
        expect(effectiveSlippageBps(quote)).toBe(100);
    });

    it('reports zero when the floor equals the expected output', () => {
        const quote = makeQuote({ expectedOutUnits: 1_000_000n, minOutUnits: 1_000_000n });
        expect(effectiveSlippageBps(quote)).toBe(0);
    });

    it('stays exact for amounts beyond double precision', () => {
        // 20 digits: `Number` would round this and report the wrong tolerance.
        const expectedOutUnits = 99_999_999_999_999_999_999n;
        const quote = makeQuote({ expectedOutUnits, minOutUnits: applySlippage(expectedOutUnits, 250) });
        expect(effectiveSlippageBps(quote)).toBe(250);
    });

    it('does not divide by zero on an empty quote', () => {
        expect(effectiveSlippageBps(makeQuote({ expectedOutUnits: 0n, minOutUnits: 0n }))).toBe(0);
    });
});

describe('policy defaults', () => {
    it('is internally consistent', () => {
        const p = DEFAULT_SWAP_POLICY;
        expect(p.minSlippageBps).toBeGreaterThan(0);
        expect(p.minSlippageBps).toBeLessThan(p.warnSlippageBps);
        expect(p.warnSlippageBps).toBeLessThan(p.maxSlippageBps);
        expect(p.warnPriceImpactBps).toBeLessThan(p.maxPriceImpactBps);
        // A plan must not outlive the quote-freshness rule it was built under.
        expect(p.maxQuoteAgeMs).toBeLessThanOrEqual(p.maxPlanAgeMs);
        // The on-chain deadline is the backstop for a message already in flight,
        // so it must outlast the client-side window.
        expect(p.onChainDeadlineSeconds * 1_000).toBeGreaterThan(p.maxPlanAgeMs);
    });

    it('is frozen, so one test cannot leak policy changes into another', () => {
        expect(Object.isFrozen(DEFAULT_SWAP_POLICY)).toBe(true);
    });
});

describe('fixture sanity', () => {
    it('builds a plan whose gas matches its messages', () => {
        const plan = makePlan();
        const attached = plan.messages.reduce((sum, message) => sum + message.value, 0n);
        expect(attached).toBe(DEFAULT_GAS.messageValue);
    });
});

/** The same account in non-bounceable (`UQ…`) form. */
function unbounceable(address: string): string {
    return AddressSetSpelling(address);
}

function AddressSetSpelling(address: string): string {
    // Deliberately routed through @ton/core rather than string surgery: the
    // checksum differs between the two forms, so a hand-edited prefix would not
    // parse.
    return addressToString(address, false);
}

function addressToString(address: string, bounceable: boolean): string {
    const { Address } = require('@ton/core') as typeof import('@ton/core');
    return Address.parse(address).toString({ bounceable, urlSafe: true, testOnly: false });
}
