/**
 * Pre-signature validation
 * ============================================================================
 *
 * Every check the wallet performs between "the provider produced a plan" and
 * "the user is asked to sign". Nothing here talks to the network: these are pure
 * assertions over a {@link SwapPlan}, so the whole safety layer is unit-testable
 * and cannot be skipped by a provider that forgets to call something.
 *
 * DESIGN: FAIL CLOSED
 * -------------------
 * Each check throws on violation rather than returning a boolean. A caller that
 * forgets to inspect a returned flag would proceed to sign; a caller that
 * forgets to catch an exception aborts. When the wallet is unsure, the correct
 * outcome is always "do not sign".
 *
 * WHAT EACH CHECK DEFENDS AGAINST
 * -------------------------------
 * The audited implementation lost funds in three distinct ways, and each has a
 * dedicated assertion here:
 *
 *  1. `bounce: false` on the outgoing message, so a rejected swap burned the
 *     funds instead of returning them → {@link assertBounceable}.
 *  2. No check that the destination belonged to the DEX at all, so any address
 *     appearing in an API response would be signed for →
 *     {@link assertTrustedDestinations}.
 *  3. `min_out` computed in floating point and an expiry of `0`, so the contract
 *     either rejected the swap outright or accepted an unbounded price →
 *     {@link assertSlippageFloor} and {@link assertDeadline}.
 *
 * @see docs/swap.md#validation
 */

import { AddressSet, addressKey, formatAddress } from '../core/address';
import { BPS_DENOMINATOR, applySlippage, formatUnits, maxBigInt } from '../core/units';
import { assetLabel, isNativeAsset, isSameAsset } from '../assets/fungible';
import type { FungibleAsset } from '../assets/fungible';

import {
    InsufficientFundsError,
    InvalidSlippageError,
    InvalidSwapRequestError,
    MalformedTransactionError,
    QuoteExpiredError,
    UntrustedDestinationError,
} from './errors';
import type { DestinationVerdict, OutgoingMessage, QuoteRequest, SwapPlan, SwapQuote, WalletBalances } from './types';

// ────────────────────────────────────────────────────────────────────────────
// Tunable safety limits
// ────────────────────────────────────────────────────────────────────────────

/**
 * Bounds and thresholds applied to every swap.
 *
 * Collected in one frozen object so the policy is auditable at a glance and can
 * be overridden wholesale in tests without monkey-patching module internals.
 */
export interface SwapPolicy {
    /**
     * Minimum slippage tolerance, in bps.
     *
     * Not zero: a real AMM's output moves between simulation and execution
     * because other trades land in between. A tolerance of 0 does not mean
     * "perfect price", it means "this swap will revert", which is a worse outcome
     * than a 0.1% concession.
     */
    readonly minSlippageBps: number;
    /**
     * Maximum slippage tolerance, in bps. Above this, a sandwich attacker can
     * extract most of the difference, so the wallet refuses rather than warns.
     */
    readonly maxSlippageBps: number;
    /** Slippage above this shows a confirmation warning (but is permitted). */
    readonly warnSlippageBps: number;
    /** Price impact above this shows a confirmation warning. */
    readonly warnPriceImpactBps: number;
    /** Price impact above this is refused: almost certainly a broken pool. */
    readonly maxPriceImpactBps: number;
    /** How long a quote may be used to build a transaction, in ms. */
    readonly maxQuoteAgeMs: number;
    /**
     * How long a built plan stays valid client-side, in ms.
     *
     * Shorter than the on-chain deadline on purpose: the client-side window
     * stops the *user* signing something stale, while the on-chain deadline is
     * the backstop for a message that is delayed in flight.
     */
    readonly maxPlanAgeMs: number;
    /** Lifetime of the on-chain expiry embedded in the payload, in seconds. */
    readonly onChainDeadlineSeconds: number;
    /**
     * TON kept aside beyond the swap's own gas, in nanotons.
     *
     * Without a reserve the user can spend to a balance that cannot pay for the
     * next transfer, which strands the wallet.
     */
    readonly tonReserve: bigint;
}

/** Default policy. Values chosen against observed STON.fi mainnet behaviour. */
export const DEFAULT_SWAP_POLICY: SwapPolicy = Object.freeze({
    minSlippageBps: 10, // 0.10%
    maxSlippageBps: 2_000, // 20%
    warnSlippageBps: 300, // 3%
    warnPriceImpactBps: 200, // 2%
    maxPriceImpactBps: 3_000, // 30%
    maxQuoteAgeMs: 60_000, // 1 minute
    maxPlanAgeMs: 120_000, // 2 minutes
    onChainDeadlineSeconds: 600, // 10 minutes
    tonReserve: 50_000_000n, // 0.05 TON
});

// ────────────────────────────────────────────────────────────────────────────
// Request-level checks (before any network call)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Validate a quote request. Runs before the first network call, so a malformed
 * request costs nothing.
 */
export function assertValidQuoteRequest(request: QuoteRequest, policy: SwapPolicy = DEFAULT_SWAP_POLICY): void {
    if (request.offerUnits <= 0n) {
        throw new InvalidSwapRequestError('Enter an amount greater than zero.', {
            offerUnits: request.offerUnits.toString(),
        });
    }
    if (isSameAsset(request.from, request.to)) {
        throw new InvalidSwapRequestError('Choose two different tokens to swap between.', {
            asset: assetLabel(request.from),
        });
    }
    if (request.from.trust === 'blacklisted' || request.to.trust === 'blacklisted') {
        const flagged = request.from.trust === 'blacklisted' ? request.from : request.to;
        throw new InvalidSwapRequestError(
            `${assetLabel(flagged)} is flagged as unsafe and cannot be swapped in this wallet.`,
            { asset: assetLabel(flagged) },
        );
    }
    assertValidSlippage(request.slippageBps, policy);
    assertValidDecimals(request.from);
    assertValidDecimals(request.to);
}

/** Slippage must be an integer bps value inside the policy range. */
export function assertValidSlippage(slippageBps: number, policy: SwapPolicy = DEFAULT_SWAP_POLICY): void {
    if (!Number.isInteger(slippageBps)) {
        throw new InvalidSwapRequestError('Slippage tolerance must be a whole number of basis points.', {
            slippageBps: String(slippageBps),
        });
    }
    if (slippageBps < policy.minSlippageBps || slippageBps > policy.maxSlippageBps) {
        throw new InvalidSlippageError(slippageBps, policy.minSlippageBps, policy.maxSlippageBps);
    }
}

/**
 * Decimals must be a plausible integer.
 *
 * Metadata is attacker-controlled, and `decimals` is a *multiplier* on every
 * amount the user sees: a jetton claiming 255 decimals would make a 1-unit
 * balance display as a rounding error, and one claiming 0 where it means 9 would
 * make the user authorise a billion-fold larger trade than intended.
 */
function assertValidDecimals(asset: FungibleAsset): void {
    if (!Number.isInteger(asset.decimals) || asset.decimals < 0 || asset.decimals > 30) {
        throw new InvalidSwapRequestError(
            `${assetLabel(asset)} reports an implausible precision (${asset.decimals} decimals) and cannot be traded safely.`,
            { asset: assetLabel(asset), decimals: String(asset.decimals) },
        );
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Quote-level checks
// ────────────────────────────────────────────────────────────────────────────

/** A quote may only be built from while it is fresh. */
export function assertQuoteFresh(quote: SwapQuote, nowMs: number, policy: SwapPolicy = DEFAULT_SWAP_POLICY): void {
    const ageMs = nowMs - quote.createdAtMs;
    // A quote stamped in the future means a clock problem somewhere; treat it as
    // unusable rather than as infinitely fresh.
    if (ageMs < -5_000 || ageMs > policy.maxQuoteAgeMs) {
        throw new QuoteExpiredError(Math.max(ageMs, 0), policy.maxQuoteAgeMs);
    }
}

/**
 * A quote must promise a non-zero output, and its declared `minOutUnits` must
 * not exceed what it expects to receive.
 *
 * `minOut > expectedOut` guarantees the contract rejects the swap. The audited
 * code could produce exactly that by mixing a simulated output with a locally
 * recomputed floor at different precisions.
 */
export function assertQuoteCoherent(quote: SwapQuote): void {
    if (quote.expectedOutUnits <= 0n) {
        throw new InvalidSwapRequestError(
            `This trade would return no ${assetLabel(quote.to)}. Try a larger amount.`,
            { expectedOut: quote.expectedOutUnits.toString() },
        );
    }
    if (quote.minOutUnits <= 0n) {
        throw new MalformedTransactionError('the minimum received amount is zero, which offers no price protection', {
            minOut: quote.minOutUnits.toString(),
        });
    }
    if (quote.minOutUnits > quote.expectedOutUnits) {
        throw new MalformedTransactionError(
            'the minimum received amount exceeds the expected output, so the swap could never succeed',
            {
                minOut: quote.minOutUnits.toString(),
                expectedOut: quote.expectedOutUnits.toString(),
            },
        );
    }
    if (quote.priceImpactBps < 0) {
        throw new MalformedTransactionError('the provider reported a negative price impact', {
            priceImpactBps: String(quote.priceImpactBps),
        });
    }
}

/**
 * Recompute the slippage floor locally and require the quote to respect it.
 *
 * The provider's `minOutUnits` is advisory; this is the authoritative check. The
 * engine uses {@link resolveMinOut} to take the stricter of the two, and this
 * assertion catches the case where a provider's floor is looser than the
 * tolerance the user actually chose — i.e. where the user asked for 1% but the
 * payload would accept a 30% loss.
 */
export function assertSlippageFloor(quote: SwapQuote): void {
    const localFloor = applySlippage(quote.expectedOutUnits, quote.slippageBps);
    if (quote.minOutUnits < localFloor) {
        throw new MalformedTransactionError(
            `the minimum received amount is below the ${(quote.slippageBps / 100).toFixed(2)}% tolerance you selected`,
            {
                providerMinOut: quote.minOutUnits.toString(),
                requiredMinOut: localFloor.toString(),
                slippageBps: String(quote.slippageBps),
            },
        );
    }
}

/**
 * The minimum-received the wallet will actually enforce: the stricter of the
 * provider's floor and the one implied by the user's tolerance.
 *
 * Used by the engine when a provider lets the caller supply `min_out` directly.
 * Taking the max means a provider can only ever make the protection *tighter*
 * than the user asked for, never looser.
 */
export function resolveMinOut(expectedOutUnits: bigint, slippageBps: number, providerMinOut: bigint): bigint {
    return maxBigInt(providerMinOut, applySlippage(expectedOutUnits, slippageBps));
}

/** Price impact beyond the policy ceiling is refused outright. */
export function assertPriceImpactAcceptable(quote: SwapQuote, policy: SwapPolicy = DEFAULT_SWAP_POLICY): void {
    if (quote.priceImpactBps > policy.maxPriceImpactBps) {
        throw new InvalidSwapRequestError(
            `This trade would move the price by ${(quote.priceImpactBps / 100).toFixed(2)}%. ` +
                `The pool is too shallow for this amount — try a smaller trade.`,
            {
                priceImpactBps: String(quote.priceImpactBps),
                maxPriceImpactBps: String(policy.maxPriceImpactBps),
            },
        );
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Plan-level checks (immediately before signing)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Run the full pre-signature suite over a built plan.
 *
 * The single entry point the engine calls. Ordered cheapest-first, and
 * structure-before-semantics so a malformed plan cannot reach a check that
 * assumes well-formedness.
 */
export function assertPlanSafeToSign(
    plan: SwapPlan,
    nowMs: number,
    verdicts: ReadonlyMap<string, DestinationVerdict>,
    policy: SwapPolicy = DEFAULT_SWAP_POLICY,
): void {
    assertPlanStructure(plan);
    assertPlanFresh(plan, nowMs, policy);
    assertQuoteCoherent(plan.quote);
    assertSlippageFloor(plan.quote);
    assertPriceImpactAcceptable(plan.quote, policy);
    assertBounceable(plan);
    assertGasCoherent(plan);
    assertDeadline(plan, nowMs, policy);
    assertTrustedDestinations(plan, verdicts);
}

/** The plan must be internally consistent before any semantic check runs. */
export function assertPlanStructure(plan: SwapPlan): void {
    if (plan.messages.length === 0) {
        throw new MalformedTransactionError('the provider produced no messages to send');
    }
    // A swap should be one message; a handful is conceivable for a multi-hop
    // route. A large number means a bug or an attempt to smuggle extra transfers
    // past the confirmation screen.
    if (plan.messages.length > 4) {
        throw new MalformedTransactionError(
            `the provider produced ${plan.messages.length} messages, which is more than any legitimate swap requires`,
            { messageCount: String(plan.messages.length) },
        );
    }
    if (plan.providerId !== plan.quote.providerId) {
        throw new MalformedTransactionError('the plan and its quote come from different providers', {
            planProvider: plan.providerId,
            quoteProvider: plan.quote.providerId,
        });
    }
    if (plan.reference.providerId !== plan.providerId) {
        throw new MalformedTransactionError('the plan reference names a different provider', {
            planProvider: plan.providerId,
            referenceProvider: plan.reference.providerId,
        });
    }
    if (plan.reference.queryId < 0n || plan.reference.queryId > MAX_UINT64) {
        throw new MalformedTransactionError('the swap query id does not fit in the protocol field', {
            queryId: plan.reference.queryId.toString(),
        });
    }
    if (plan.trustedDestinations.size === 0) {
        throw new MalformedTransactionError('the provider vouched for no destination addresses');
    }
    for (const message of plan.messages) {
        assertMessageStructure(message);
    }
}

const MAX_UINT64 = (1n << 64n) - 1n;

/** Per-message structural checks. */
function assertMessageStructure(message: OutgoingMessage): void {
    if (message.value < 0n) {
        throw new MalformedTransactionError('a message carries a negative TON value', {
            value: message.value.toString(),
        });
    }
    if (message.value === 0n) {
        // A zero-value message cannot pay for its own processing, let alone the
        // downstream chain of internal messages a swap requires.
        throw new MalformedTransactionError('a message carries no TON, so it cannot pay for gas', {
            to: message.to,
        });
    }
    if (message.purpose.trim().length === 0) {
        throw new MalformedTransactionError('a message has no description to show on the confirmation screen', {
            to: message.to,
        });
    }
    if (message.destinationRole === 'unknown') {
        throw new MalformedTransactionError(
            `the provider could not say what kind of contract ${message.to} is`,
            { to: message.to },
        );
    }
    // `formatAddress` throws on anything unparseable, so this both validates the
    // address and proves the string the user is shown is the one being signed.
    formatAddress(message.to);
}

/** A built plan may only be signed inside its validity window. */
export function assertPlanFresh(plan: SwapPlan, nowMs: number, policy: SwapPolicy = DEFAULT_SWAP_POLICY): void {
    if (nowMs > plan.expiresAtMs) {
        throw new QuoteExpiredError(nowMs - plan.quote.createdAtMs, policy.maxQuoteAgeMs);
    }
    const ageMs = nowMs - plan.quote.createdAtMs;
    if (ageMs > policy.maxPlanAgeMs) {
        throw new QuoteExpiredError(ageMs, policy.maxPlanAgeMs);
    }
}

/**
 * Every message must be bounceable.
 *
 * This is the check that would have prevented the reported fund loss. On TON, a
 * non-bounceable message whose destination throws leaves the value at the
 * destination: the DEX rejects the swap and the tokens are simply gone. With
 * `bounce: true` the same rejection returns the funds, which is exactly the
 * "0.2 USDT came back" behaviour a *correctly configured* wallet should show
 * when a swap fails.
 *
 * @see https://docs.ton.org/develop/smart-contracts/guidelines/non-bouncable-messages
 */
export function assertBounceable(plan: SwapPlan): void {
    for (const message of plan.messages) {
        if (!message.bounce) {
            throw new MalformedTransactionError(
                `the message to ${message.to} is not bounceable, so a failed swap would not return your funds`,
                { to: message.to, purpose: message.purpose },
            );
        }
    }
}

/**
 * Gas accounting must be internally consistent.
 *
 * `forwardValue >= messageValue` is a silent killer: the jetton wallet checks
 * that the attached value covers the forward amount plus its own fees, and
 * aborts if it does not. The user sees a failed transaction with no explanation.
 */
export function assertGasCoherent(plan: SwapPlan): void {
    const { gas } = plan.quote;
    if (gas.messageValue <= 0n) {
        throw new MalformedTransactionError('the swap attaches no TON for gas', {
            messageValue: gas.messageValue.toString(),
        });
    }
    if (gas.forwardValue < 0n) {
        throw new MalformedTransactionError('the forwarded gas amount is negative', {
            forwardValue: gas.forwardValue.toString(),
        });
    }
    if (gas.forwardValue >= gas.messageValue) {
        throw new MalformedTransactionError(
            'the forwarded gas amount is not less than the attached value, so the transfer would abort before reaching the DEX',
            {
                forwardValue: gas.forwardValue.toString(),
                messageValue: gas.messageValue.toString(),
            },
        );
    }
    // The declared budget must match what is actually attached, or the balance
    // check the engine performed was against the wrong number.
    const attached = plan.messages.reduce((sum, message) => sum + message.value, 0n);
    if (attached !== gas.messageValue) {
        throw new MalformedTransactionError(
            'the TON attached to the messages does not match the amount quoted for this swap',
            { attached: attached.toString(), quoted: gas.messageValue.toString() },
        );
    }
}

/**
 * The on-chain expiry must be in the future and not absurdly far out.
 *
 * A deadline of `0` — what the audited builder wrote into every V2 payload — is
 * always in the past, so the router's `tx_deadline` check failed and every swap
 * bounced. That single field is the root cause of the reported failure, which is
 * why it gets its own named assertion.
 *
 * A deadline far in the future is also rejected: it means a stalled message can
 * execute at a price from another market entirely.
 */
export function assertDeadline(plan: SwapPlan, nowMs: number, policy: SwapPolicy = DEFAULT_SWAP_POLICY): void {
    const { deadlineUnix } = plan.reference;
    if (deadlineUnix === null) {
        // The provider does not support on-chain expiry. Permitted, but then the
        // client-side window is the only protection, so it must be short.
        return;
    }
    const nowUnix = Math.floor(nowMs / 1000);
    if (deadlineUnix <= nowUnix) {
        throw new MalformedTransactionError(
            'the swap deadline has already passed, so the DEX would reject it on arrival',
            { deadlineUnix: String(deadlineUnix), nowUnix: String(nowUnix) },
        );
    }
    const maxDeadline = nowUnix + policy.onChainDeadlineSeconds * 4;
    if (deadlineUnix > maxDeadline) {
        throw new MalformedTransactionError(
            'the swap deadline is too far in the future to be safe',
            { deadlineUnix: String(deadlineUnix), maxDeadlineUnix: String(maxDeadline) },
        );
    }
}

/**
 * Every destination must be independently verified.
 *
 * Two conditions, both required:
 *
 *  1. the address is in the plan's `trustedDestinations` set — the provider
 *     vouches for it; and
 *  2. `verifyDestination` returned `trusted: true` for it — an *independent*
 *     source (published router registry, or on-chain derivation from the jetton
 *     master the user picked) agrees.
 *
 * Requiring both is the point. A provider that is compromised or simply buggy
 * can populate its own allow-list with anything; the second source is what makes
 * the check meaningful.
 *
 * The declared role must also match, so a router address cannot be presented as
 * the user's own jetton wallet on the confirmation screen.
 */
export function assertTrustedDestinations(
    plan: SwapPlan,
    verdicts: ReadonlyMap<string, DestinationVerdict>,
): void {
    for (const message of plan.messages) {
        if (!plan.trustedDestinations.has(message.to)) {
            throw new UntrustedDestinationError(
                message.to,
                plan.providerId,
                'not in the set of contracts the provider vouched for',
            );
        }
        const verdict = verdicts.get(addressKey(message.to));
        if (verdict === undefined) {
            throw new UntrustedDestinationError(
                message.to,
                plan.providerId,
                'independent verification was not performed',
            );
        }
        if (!verdict.trusted) {
            throw new UntrustedDestinationError(message.to, plan.providerId, verdict.reason);
        }
        if (verdict.role !== message.destinationRole) {
            throw new UntrustedDestinationError(
                message.to,
                plan.providerId,
                `the provider described it as ${message.destinationRole} but verification found ${verdict.role}`,
            );
        }
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Balance checks
// ────────────────────────────────────────────────────────────────────────────

/**
 * Verify the wallet can afford both the offered amount and the gas.
 *
 * The two cases differ in a way that is easy to get wrong:
 *
 *  - **Jetton offer.** The jetton balance covers `offerUnits`; the TON balance
 *    covers gas alone.
 *  - **Native offer.** The TON balance covers `offerUnits` *and* gas, because
 *    the offered TON is carried by the same message. `gas.messageValue` already
 *    includes the offer for this case, so checking it against the balance covers
 *    both — checking them separately would double-count.
 *
 * A reserve is held back in both cases so the wallet is not left unable to pay
 * for its next transaction.
 */
export function assertSufficientBalance(
    quote: SwapQuote,
    balances: WalletBalances,
    policy: SwapPolicy = DEFAULT_SWAP_POLICY,
): void {
    const tonRequired = quote.gas.messageValue + policy.tonReserve;
    if (balances.tonUnits < tonRequired) {
        throw new InsufficientFundsError({
            symbol: 'TON',
            required: formatUnits(tonRequired, 9),
            available: formatUnits(balances.tonUnits, 9),
            forGas: true,
        });
    }
    if (isNativeAsset(quote.from)) {
        // Already covered: gas.messageValue includes the offered TON.
        return;
    }
    if (balances.offeredAssetUnits < quote.offerUnits) {
        throw new InsufficientFundsError({
            symbol: assetLabel(quote.from),
            required: formatUnits(quote.offerUnits, quote.from.decimals),
            available: formatUnits(balances.offeredAssetUnits, quote.from.decimals),
        });
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Non-fatal warnings
// ────────────────────────────────────────────────────────────────────────────

/** A condition worth showing on the confirmation screen but not worth refusing. */
export interface SwapWarning {
    readonly code:
        | 'high-slippage'
        | 'high-price-impact'
        | 'unverified-asset'
        | 'slippage-below-recommended'
        | 'no-on-chain-deadline';
    readonly message: string;
}

/**
 * Collect advisory warnings for a quote.
 *
 * Separate from the assertions on purpose: a refusal and a caution are different
 * products, and conflating them either blocks legitimate trades or lets risky
 * ones through silently.
 */
export function collectSwapWarnings(
    quote: SwapQuote,
    options: { readonly hasOnChainDeadline: boolean },
    policy: SwapPolicy = DEFAULT_SWAP_POLICY,
): readonly SwapWarning[] {
    const warnings: SwapWarning[] = [];

    if (quote.slippageBps > policy.warnSlippageBps) {
        warnings.push({
            code: 'high-slippage',
            message:
                `You are accepting up to ${(quote.slippageBps / 100).toFixed(2)}% slippage. ` +
                `You could receive as little as ${formatUnits(quote.minOutUnits, quote.to.decimals)} ${assetLabel(quote.to)}.`,
        });
    }

    if (quote.priceImpactBps > policy.warnPriceImpactBps) {
        warnings.push({
            code: 'high-price-impact',
            message:
                `This trade moves the pool price by ${(quote.priceImpactBps / 100).toFixed(2)}%. ` +
                `Splitting it into smaller trades may give a better rate.`,
        });
    }

    if (quote.recommendedSlippageBps !== null && quote.slippageBps < quote.recommendedSlippageBps) {
        warnings.push({
            code: 'slippage-below-recommended',
            message:
                `This pool usually needs at least ${(quote.recommendedSlippageBps / 100).toFixed(2)}% slippage. ` +
                `At ${(quote.slippageBps / 100).toFixed(2)}% the swap may be rejected and your funds returned.`,
        });
    }

    for (const asset of [quote.from, quote.to]) {
        if (asset.trust === 'unknown' || asset.trust === 'community') {
            warnings.push({
                code: 'unverified-asset',
                message:
                    `${assetLabel(asset)} is not on a verified token list. ` +
                    `Check the contract address before trading — token names can be copied.`,
            });
        }
    }

    if (!options.hasOnChainDeadline) {
        warnings.push({
            code: 'no-on-chain-deadline',
            message:
                'This route has no on-chain expiry. If the network is congested the swap may execute at a later price.',
        });
    }

    return warnings;
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers shared with the engine
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build the address set a plan should vouch for, from a provider's list.
 *
 * Thin wrapper, but it keeps `AddressSet` construction in one place so provider
 * code cannot accidentally build a set of raw, unnormalised strings — which
 * would make every `has()` lookup silently miss.
 */
export function trustedSet(addresses: Iterable<string>): AddressSet {
    return new AddressSet(addresses);
}

/**
 * Effective tolerance encoded by `minOut`, in whole basis points.
 *
 * `applySlippage` must round the output floor down to a token unit. Reversing
 * that floor can therefore produce a fractional basis point above the user's
 * requested tolerance. The UI reports whole bps by flooring that fractional
 * remainder; it must not display 2.51% for a 2.50% choice merely because the
 * token cannot encode a fraction of its smallest unit.
 */
export function effectiveSlippageBps(quote: SwapQuote): number {
    if (quote.expectedOutUnits <= 0n || quote.minOutUnits >= quote.expectedOutUnits) {
        return 0;
    }
    const lostUnits = quote.expectedOutUnits - quote.minOutUnits;
    return Number((lostUnits * BPS_DENOMINATOR) / quote.expectedOutUnits);
}
