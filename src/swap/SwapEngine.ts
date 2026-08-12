/**
 * Swap engine
 * ============================================================================
 *
 * The provider-agnostic orchestrator that sits between the UI and any DEX. It
 * imports {@link DexProvider} and nothing DEX-specific — no router address, no
 * opcode, no SDK, not even the string `'stonfi'`. Adding an exchange does not
 * touch this file.
 *
 * THE FOUR STAGES
 * ---------------
 *   quoteAll()       ask every provider concurrently, rank what comes back
 *   prepare()        build, verify, validate — everything before a signature
 *   (the wallet layer signs and broadcasts `prepared.plan.messages`)
 *   waitForOutcome() resolve what the DEX actually did
 *
 * `prepare()` deliberately stops short of signing. The wallet layer is the only
 * component that can sign, and it is handed a plan that has already passed every
 * assertion in `validation.ts`. A provider therefore cannot cause a signature by
 * itself, no matter what it returns.
 *
 * WHY VERIFICATION LIVES HERE AND NOT IN THE PROVIDER
 * --------------------------------------------------
 * A provider builds the plan *and* implements `verifyDestination`, so on its own
 * it could trivially approve its own output. The engine is what makes the second
 * opinion worth having: it drives the check itself, for every message, and feeds
 * the verdicts into `assertPlanSafeToSign`, which requires the address to appear
 * in *both* the provider's vouched set and an independently-derived verdict, with
 * matching roles. A provider that skips the work fails the check rather than
 * passing it.
 *
 * The audited implementation had no equivalent stage at all: whatever address
 * came back in the price response was signed for.
 *
 * DETERMINISM
 * -----------
 * Time and randomness are injected ({@link SwapEngineOptions.clock},
 * {@link SwapEngineOptions.queryIds}). Nothing here or below calls `Date.now()`.
 * Quote expiry, deadline arithmetic and `query_id` uniqueness are therefore
 * testable without faking globals.
 *
 * @see docs/swap.md
 */

import { assetKey } from '../assets/fungible';
import type { FungibleAsset } from '../assets/fungible';
import { addressKey, parseAddress } from '../core/address';
import type { ChainAccess } from '../core/chain';
import type { BalanceReader } from '../core/jetton';

import {
    ConfirmationTimeoutError,
    NoRouteError,
    ProviderProtocolError,
    SwapError,
    SwapErrorCode,
    isSwapError,
    toSwapError,
} from './errors';
import type {
    DestinationVerdict,
    DexProvider,
    DexProviderId,
    DexProviderSource,
    QuoteAttempt,
    QuoteComparison,
    QuoteRequest,
    SwapErrorLike,
    SwapOutcome,
    SwapPlan,
    SwapQuote,
    SwapReference,
    WalletBalances,
} from './types';
import {
    DEFAULT_SWAP_POLICY,
    assertPlanSafeToSign,
    assertPriceImpactAcceptable,
    assertQuoteCoherent,
    assertQuoteFresh,
    assertSlippageFloor,
    assertSufficientBalance,
    assertValidQuoteRequest,
    assertValidSlippage,
    collectSwapWarnings,
} from './validation';
import type { SwapPolicy, SwapWarning } from './validation';

/** Largest value the protocol's `query_id` field can carry. */
const MAX_UINT64 = (1n << 64n) - 1n;

/**
 * Source of `query_id` values.
 *
 * Injected so tests can pin the id and assert on the exact payload, and so the
 * production source can be cryptographic. Both matter: the id is what correlates
 * a swap with its outcome, and a *predictable* id would let an observer submit a
 * colliding reference.
 */
export interface QueryIdSource {
    /** A fresh 64-bit id. Must never return the same value twice. */
    next(): bigint;
}

/**
 * Cryptographically random `query_id`s.
 *
 * 64 random bits, so collision between two swaps by the same wallet is not a
 * practical concern. `0` is excluded because the audited implementation used it
 * as a constant: keeping it out of circulation means a zero id in a log is
 * unambiguously the old bug and not a fresh draw.
 *
 * Note this is the *DEX payload's* id, which is a free-form uint64. It is not
 * the Highload V3 wallet's `query_id`, which is a structured shift/bitnumber
 * pair the wallet layer allocates separately.
 */
export class RandomQueryIdSource implements QueryIdSource {
    public next(): bigint {
        const source = globalThis.crypto;
        if (source === undefined || typeof source.getRandomValues !== 'function') {
            throw new SwapError(
                SwapErrorCode.BuildFailed,
                'This environment has no secure random number generator, so a swap cannot be safely identified.',
            );
        }
        const bytes = source.getRandomValues(new Uint8Array(8));
        let value = 0n;
        for (const byte of bytes) {
            value = (value << 8n) | BigInt(byte);
        }
        return value === 0n ? 1n : value;
    }
}

/** Construction parameters for {@link SwapEngine}. */
export interface SwapEngineOptions {
    readonly chain: ChainAccess;
    readonly registry: DexProviderSource;
    /** Reads balances for the pre-flight check. */
    readonly balances: BalanceReader;
    /** Safety limits. Defaults to {@link DEFAULT_SWAP_POLICY}. */
    readonly policy?: SwapPolicy;
    /** Injected clock. Defaults to `Date.now`. */
    readonly clock?: () => number;
    /** Injected `query_id` source. Defaults to {@link RandomQueryIdSource}. */
    readonly queryIds?: QueryIdSource;
}

/** Options for {@link SwapEngine.quoteAll}. */
export interface QuoteAllOptions {
    /** Restrict the fan-out to these providers. Defaults to all registered. */
    readonly providerIds?: readonly DexProviderId[];
}

/** Options for {@link SwapEngine.prepare}. */
export interface PrepareOptions {
    /** The wallet that will sign. */
    readonly walletAddress: string;
    /** Where the bought asset should land. Defaults to `walletAddress`. */
    readonly receiverAddress?: string;
    /** On-chain validity window. Defaults to the policy's value. */
    readonly deadlineSeconds?: number;
    /**
     * Pre-read balances.
     *
     * Supply them when the UI has already fetched them for the amount field, to
     * avoid a second round-trip. Omit to have the engine read them from chain.
     */
    readonly balances?: WalletBalances;
}

/**
 * A swap that has passed every check and is ready to be signed.
 *
 * Reaching this type is the assertion. There is no partially-validated variant:
 * `prepare()` either returns this or throws.
 */
export interface PreparedSwap {
    readonly plan: SwapPlan;
    /** Advisory cautions for the confirmation screen. Never blocking. */
    readonly warnings: readonly SwapWarning[];
    /** Independent verdict per destination, keyed by canonical address. */
    readonly verdicts: ReadonlyMap<string, DestinationVerdict>;
    /** Balances the affordability check was made against. */
    readonly balances: WalletBalances;
    /** The provider that produced the plan, for display attribution. */
    readonly provider: DexProvider;
}

/** Options for {@link SwapEngine.waitForOutcome}. */
export interface WaitForOutcomeOptions {
    /** Give up after this long. Default 3 minutes. */
    readonly timeoutMs?: number;
    /** Gap between polls. Default 3 seconds. */
    readonly pollIntervalMs?: number;
    /** Cancels polling, e.g. when the user navigates away. */
    readonly signal?: AbortSignal;
    /** Called after every poll, for a live status line. */
    readonly onProgress?: (outcome: SwapOutcome) => void;
    /**
     * When STON.fi has not indexed the swap yet, treat a received-asset balance
     * increase as success once it reaches the quoted minimum.
     */
    readonly balanceFallback?: {
        readonly ownerAddress: string;
        readonly asset: FungibleAsset;
        readonly minReceivedUnits: bigint;
        /** Captured before submission so a fast DEX fill is still detected. */
        readonly baselineUnits?: bigint;
    };
}

const DEFAULT_CONFIRMATION_TIMEOUT_MS = 180_000;
const DEFAULT_POLL_INTERVAL_MS = 3_000;

/**
 * Orchestrates quoting, validation and confirmation across every registered DEX.
 *
 * Stateless between calls. One instance per session is fine; so is one per
 * screen.
 */
export class SwapEngine {
    public readonly network: ChainAccess['network'];
    private readonly chain: ChainAccess;
    private readonly registry: DexProviderSource;
    private readonly balanceReader: BalanceReader;
    private readonly policy: SwapPolicy;
    private readonly clock: () => number;
    private readonly queryIds: QueryIdSource;

    public constructor(options: SwapEngineOptions) {
        this.network = options.chain.network;
        this.chain = options.chain;
        this.registry = options.registry;
        this.balanceReader = options.balances;
        this.policy = options.policy ?? DEFAULT_SWAP_POLICY;
        this.clock = options.clock ?? ((): number => Date.now());
        this.queryIds = options.queryIds ?? new RandomQueryIdSource();
    }

    /** The safety limits in force. */
    public get swapPolicy(): SwapPolicy {
        return this.policy;
    }

    /** Providers available for swapping. */
    public get providers(): readonly DexProvider[] {
        return this.registry.list();
    }

    // ────────────────────────────────────────────────────────────────────────
    // Assets
    // ────────────────────────────────────────────────────────────────────────

    /**
     * The union of every provider's tradable assets, de-duplicated.
     *
     * When two providers describe the same token, the entry from the provider
     * that trusts it *less* wins. That is deliberate and the opposite of a
     * merge-by-preference: if any integration considers a token unverified or
     * blacklisted, the user should see that, not the friendlier description.
     *
     * A provider that fails is skipped rather than failing the whole list — one
     * exchange being down must not empty the token picker.
     */
    public async listAssets(): Promise<readonly FungibleAsset[]> {
        const capable = this.registry.list().filter((provider) => provider.capabilities.assetDiscovery);
        const lists = await Promise.all(
            capable.map(async (provider) => {
                try {
                    return await provider.listAssets();
                } catch {
                    return [] as readonly FungibleAsset[];
                }
            }),
        );

        const merged = new Map<string, FungibleAsset>();
        for (const list of lists) {
            for (const asset of list) {
                const key = assetKey(asset);
                const existing = merged.get(key);
                if (existing === undefined || trustRank(asset) < trustRank(existing)) {
                    merged.set(key, asset);
                }
            }
        }
        return [...merged.values()];
    }

    // ────────────────────────────────────────────────────────────────────────
    // Quoting
    // ────────────────────────────────────────────────────────────────────────

    /**
     * Ask every provider for a price, concurrently, and rank the results.
     *
     * Failures are collected rather than thrown: one provider having no pool for
     * a pair is normal, and the UI needs to explain the gap ("STON.fi has no
     * route for this pair") rather than show an empty screen. A comparison in
     * which *nothing* succeeded is returned with `best: null`; call
     * {@link requireBest} when a quote is mandatory.
     *
     * Every returned quote has already been re-checked against the request, so a
     * provider cannot quietly quote a different pair, a different size or a wider
     * slippage than the user asked for. That class of substitution is what made
     * the audited implementation's "token-out confirmation" unreliable.
     */
    public async quoteAll(request: QuoteRequest, options: QuoteAllOptions = {}): Promise<QuoteComparison> {
        assertValidQuoteRequest(request, this.policy);
        assertValidSlippage(request.slippageBps, this.policy);
        // Throws on a malformed address before any provider is contacted.
        parseAddress(request.walletAddress);

        const registeredProviders = this.registry.list();
        const providers: readonly DexProvider[] =
            options.providerIds === undefined
                ? registeredProviders
                : registeredProviders.filter((provider) => options.providerIds?.includes(provider.id) === true);

        if (providers.length === 0) {
            throw new SwapError(SwapErrorCode.QuoteUnavailable, 'No exchange is available to price this swap.', {
                retryable: false,
            });
        }

        const attempts = await Promise.all(
            providers.map((provider) => this.attemptQuote(provider, request)),
        );

        // Rank in provider order first so the sort's stability makes registry
        // order the final tie-break, which is where the preference is declared.
        const quotes = attempts
            .filter((attempt): attempt is Extract<QuoteAttempt, { status: 'fulfilled' }> =>
                attempt.status === 'fulfilled',
            )
            .map((attempt) => attempt.quote)
            .sort(compareQuotes);

        return { quotes, attempts, best: quotes[0] ?? null };
    }

    /**
     * {@link quoteAll}, but throws when nothing priced.
     *
     * The thrown error is the most informative one available: if every provider
     * said "no route", that is reported as {@link NoRouteError} rather than as a
     * generic outage, because the two suggest completely different user actions.
     */
    public async requireBest(request: QuoteRequest, options: QuoteAllOptions = {}): Promise<SwapQuote> {
        const comparison = await this.quoteAll(request, options);
        const best = comparison.best;
        if (best !== null) {
            return best;
        }

        const failures = comparison.attempts.filter(
            (attempt): attempt is Extract<QuoteAttempt, { status: 'rejected' }> => attempt.status === 'rejected',
        );
        const everyFailureIsNoRoute =
            failures.length > 0 && failures.every((attempt) => attempt.error.code === SwapErrorCode.NoRoute);
        if (everyFailureIsNoRoute) {
            throw new NoRouteError(request.from.symbol, request.to.symbol);
        }
        // Surface the most alarming failure rather than the first: a refusal to
        // trust a contract must not be hidden behind an ordinary timeout.
        const notable =
            failures.find((attempt) => attempt.error.severity === 'suspicious') ??
            failures.find((attempt) => attempt.error.severity === 'error') ??
            failures[0];
        throw new SwapError(
            SwapErrorCode.QuoteUnavailable,
            notable === undefined
                ? 'No exchange could price this swap right now.'
                : `No exchange could price this swap right now (${notable.error.message})`,
            { retryable: true },
        );
    }

    /** Quote one provider, converting any failure into a recorded attempt. */
    private async attemptQuote(provider: DexProvider, request: QuoteRequest): Promise<QuoteAttempt> {
        try {
            if (!(await provider.supportsPair(request.from, request.to))) {
                throw new NoRouteError(request.from.symbol, request.to.symbol);
            }
            const quote = await provider.quote(request);
            this.assertQuoteAnswersRequest(quote, request, provider.id);
            return { status: 'fulfilled', providerId: provider.id, quote };
        } catch (cause) {
            return { status: 'rejected', providerId: provider.id, error: describeError(cause, provider.id) };
        }
    }

    /**
     * A quote must answer the question that was asked.
     *
     * These are cheap comparisons, and they close a whole family of failures at
     * once: a provider that returns a cached quote for the previous pair, one
     * that silently rounds the amount, one that widens the tolerance to make its
     * price look better, and one that hands back another provider's quote.
     */
    private assertQuoteAnswersRequest(quote: SwapQuote, request: QuoteRequest, providerId: DexProviderId): void {
        if (quote.providerId !== providerId) {
            throw new ProviderProtocolError(providerId, 'The quote is attributed to a different exchange.');
        }
        if (assetKey(quote.from) !== assetKey(request.from) || assetKey(quote.to) !== assetKey(request.to)) {
            throw new ProviderProtocolError(providerId, 'The quote is for a different pair than the one requested.');
        }
        if (quote.offerUnits !== request.offerUnits) {
            throw new ProviderProtocolError(providerId, 'The quote is for a different amount than the one requested.');
        }
        if (quote.slippageBps !== request.slippageBps) {
            throw new ProviderProtocolError(
                providerId,
                'The quote used a different slippage tolerance than the one selected.',
            );
        }
        // Structural soundness of the price itself. Run at quote time as well as
        // before signing so a bad quote never reaches the confirmation screen.
        assertQuoteFresh(quote, request.nowMs, this.policy);
        assertQuoteCoherent(quote);
        assertSlippageFloor(quote);
        assertPriceImpactAcceptable(quote, this.policy);
    }

    // ────────────────────────────────────────────────────────────────────────
    // Preparing
    // ────────────────────────────────────────────────────────────────────────

    /**
     * Turn a quote into a plan that is safe to sign.
     *
     * The order of operations is the safety property, and it is deliberate:
     *
     *  1. refuse a stale quote *before* building, so nothing is constructed from
     *     a price the user can no longer be shown honestly;
     *  2. build;
     *  3. independently verify every destination;
     *  4. read balances;
     *  5. run the full assertion suite over the built plan, against the verdicts.
     *
     * Step 5 sees exactly the bytes that will be signed. Nothing between it and
     * the signature can alter the plan — it is frozen data.
     *
     * @throws {SwapError} on any failure. There is no partial success.
     */
    public async prepare(quote: SwapQuote, options: PrepareOptions): Promise<PreparedSwap> {
        const provider = this.registry.require(quote.providerId);
        const nowMs = this.clock();
        const walletAddress = parseAddress(options.walletAddress).toString();

        assertQuoteFresh(quote, nowMs, this.policy);

        const queryId = this.queryIds.next();
        if (queryId <= 0n || queryId > MAX_UINT64) {
            throw new SwapError(SwapErrorCode.BuildFailed, 'Could not generate a valid identifier for this swap.');
        }

        const deadlineSeconds = options.deadlineSeconds ?? this.policy.onChainDeadlineSeconds;
        let plan: SwapPlan;
        try {
            plan = await provider.buildSwap(quote, {
                walletAddress,
                ...(options.receiverAddress === undefined
                    ? {}
                    : { receiverAddress: parseAddress(options.receiverAddress).toString() }),
                queryId,
                nowMs,
                deadlineSeconds,
                chain: this.chain,
            });
        } catch (cause) {
            throw toSwapError(cause, provider.id, 'The exchange could not build this swap.');
        }

        // The plan must be built from the quote that was validated, not from one
        // the provider substituted along the way.
        if (plan.quote !== quote) {
            throw new ProviderProtocolError(
                provider.id,
                'The exchange returned a plan for a different quote than the one submitted.',
            );
        }
        if (plan.reference.queryId !== queryId) {
            throw new ProviderProtocolError(
                provider.id,
                'The exchange did not use the identifier issued for this swap, so its outcome could not be confirmed.',
            );
        }

        const verdicts = await this.verifyDestinations(provider, plan, walletAddress, nowMs);
        const balances = options.balances ?? (await this.readBalances(walletAddress, quote.from));

        assertPlanSafeToSign(plan, nowMs, verdicts, this.policy);
        assertSufficientBalance(quote, balances, this.policy);

        return {
            plan,
            warnings: collectSwapWarnings(
                quote,
                { hasOnChainDeadline: plan.reference.deadlineUnix !== null },
                this.policy,
            ),
            verdicts,
            balances,
            provider,
        };
    }

    /**
     * Obtain an independent verdict for every distinct destination in a plan.
     *
     * A destination the provider cannot verify yields an untrusted verdict rather
     * than an exception, so `assertTrustedDestinations` produces the specific,
     * user-facing refusal — one code path for "we would not sign this", whatever
     * the reason.
     */
    private async verifyDestinations(
        provider: DexProvider,
        plan: SwapPlan,
        walletAddress: string,
        nowMs: number,
    ): Promise<ReadonlyMap<string, DestinationVerdict>> {
        const targets = new Map<string, (typeof plan.messages)[number]>();
        for (const message of plan.messages) {
            targets.set(addressKey(message.to), message);
        }

        const entries = await Promise.all(
            [...targets.entries()].map(async ([key, message]): Promise<[string, DestinationVerdict]> => {
                try {
                    const verdict = await provider.verifyDestination({
                        address: message.to,
                        expectedRole: message.destinationRole,
                        quote: plan.quote,
                        walletAddress,
                        nowMs,
                        chain: this.chain,
                    });
                    return [key, verdict];
                } catch (cause) {
                    return [
                        key,
                        {
                            trusted: false,
                            role: 'unknown',
                            reason: isSwapError(cause)
                                ? cause.message
                                : 'the destination could not be verified against an independent source',
                        },
                    ];
                }
            }),
        );
        return new Map(entries);
    }

    /** Read the balances the affordability check needs. */
    private async readBalances(walletAddress: string, offered: FungibleAsset): Promise<WalletBalances> {
        const owner = parseAddress(walletAddress);
        const tonUnits = await this.balanceReader.getNativeBalance(owner);
        if (offered.kind === 'native') {
            // The offered asset *is* TON; reporting the same figure keeps
            // `assertSufficientBalance` from double-counting it.
            return { tonUnits, offeredAssetUnits: tonUnits };
        }
        const offeredAssetUnits = await this.balanceReader.getJettonBalance(owner, parseAddress(offered.master));
        return { tonUnits, offeredAssetUnits };
    }

    // ────────────────────────────────────────────────────────────────────────
    // Confirming
    // ────────────────────────────────────────────────────────────────────────

    /**
     * Poll until the swap reaches a terminal state.
     *
     * Broadcasting is not confirmation. A TON transaction can be accepted by the
     * network and still have the DEX refuse the swap and refund it — which is
     * precisely what the reported bug looked like from the user's side, and what
     * the audited wallet reported as a success. This resolves the difference.
     *
     * Timing out returns `state: 'unknown'` with an explorer link rather than
     * throwing: the swap may still land, and claiming failure would be as wrong as
     * claiming success. Call {@link requireOutcome} when a definitive answer is
     * needed.
     */
    public async waitForOutcome(
        reference: SwapReference,
        options: WaitForOutcomeOptions = {},
    ): Promise<SwapOutcome> {
        const provider = this.registry.require(reference.providerId);
        const explorerUrl = provider.explorerUrl(reference);

        if (!provider.capabilities.statusTracking) {
            return { state: 'unknown', exitCode: null, txHash: null, receivedUnits: null, explorerUrl };
        }

        const timeoutMs = options.timeoutMs ?? DEFAULT_CONFIRMATION_TIMEOUT_MS;
        const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
        const startedAtMs = this.clock();
        let last: SwapOutcome = { state: 'pending', exitCode: null, txHash: null, receivedUnits: null, explorerUrl };
        let baselineUnits: bigint | null = options.balanceFallback?.baselineUnits ?? null;
        if (options.balanceFallback !== undefined && baselineUnits === null) {
            baselineUnits = await this.readAssetBalance(options.balanceFallback);
        }

        for (;;) {
            options.signal?.throwIfAborted();

            try {
                last = await provider.getOutcome(reference);
                options.onProgress?.(last);
                if (last.state === 'succeeded' || last.state === 'failed') {
                    return last;
                }
            } catch (cause) {
                // A failed status query says nothing about the swap. Keep polling
                // until the deadline; only then report the uncertainty.
                if (isSwapError(cause) && cause.severity === 'suspicious') {
                    throw cause;
                }
            }

            const balanceOutcome = await this.tryBalanceFallback(options.balanceFallback, baselineUnits, explorerUrl);
            if (balanceOutcome !== null) {
                options.onProgress?.(balanceOutcome);
                return balanceOutcome;
            }

            if (this.clock() - startedAtMs >= timeoutMs) {
                return { ...last, state: 'unknown', explorerUrl: last.explorerUrl ?? explorerUrl };
            }
            await delay(pollIntervalMs, options.signal);
        }
    }

    /** Snapshot one asset balance for later outcome verification. */
    public async snapshotAssetBalance(asset: FungibleAsset, ownerAddress: string): Promise<bigint> {
        return this.readAssetBalance({
            ownerAddress,
            asset,
            minReceivedUnits: 1n,
        });
    }

    private async tryBalanceFallback(
        fallback: WaitForOutcomeOptions['balanceFallback'],
        baselineUnits: bigint | null,
        explorerUrl: string | null,
    ): Promise<SwapOutcome | null> {
        if (fallback === undefined || baselineUnits === null) {
            return null;
        }
        const currentUnits = await this.readAssetBalance(fallback);
        const receivedUnits = currentUnits - baselineUnits;
        if (receivedUnits < fallback.minReceivedUnits) {
            return null;
        }
        return Object.freeze({
            state: 'succeeded',
            exitCode: 'balance_confirmed',
            txHash: null,
            receivedUnits,
            explorerUrl,
        });
    }

    private async readAssetBalance(
        fallback: NonNullable<WaitForOutcomeOptions['balanceFallback']>,
    ): Promise<bigint> {
        const owner = parseAddress(fallback.ownerAddress);
        if (fallback.asset.kind === 'native') {
            return this.balanceReader.getNativeBalance(owner);
        }
        return this.balanceReader.getJettonBalance(owner, parseAddress(fallback.asset.master));
    }

    /**
     * {@link waitForOutcome}, but treats a refund or a timeout as an error.
     *
     * For callers that must branch on success — a retry flow, or a test — where
     * silently accepting `unknown` would hide exactly the failure being tested.
     */
    public async requireOutcome(reference: SwapReference, options: WaitForOutcomeOptions = {}): Promise<SwapOutcome> {
        const outcome = await this.waitForOutcome(reference, options);
        if (outcome.state === 'succeeded') {
            return outcome;
        }
        if (outcome.state === 'failed') {
            throw new SwapError(
                SwapErrorCode.SwapReverted,
                'The exchange rejected this swap and returned your funds.',
                {
                    severity: 'warning',
                    providerId: reference.providerId,
                    details: {
                        queryId: reference.queryId.toString(),
                        ...(outcome.exitCode === null ? {} : { exitCode: outcome.exitCode }),
                        ...(outcome.txHash === null ? {} : { txHash: outcome.txHash }),
                    },
                },
            );
        }
        throw new ConfirmationTimeoutError(
            reference.queryId.toString(),
            options.timeoutMs ?? DEFAULT_CONFIRMATION_TIMEOUT_MS,
        );
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Rank two quotes for the same pair, best first.
 *
 * Ordered by expected output, then by the guaranteed minimum, then by attached
 * gas. Comparing `expectedOutUnits` directly is sound because every quote in a
 * comparison is for the same `to` asset — `assertQuoteAnswersRequest` guarantees
 * it — so the units are identical.
 *
 * Gas is a tie-break rather than a subtraction: it is denominated in TON while
 * the output usually is not, and netting them would need a TON price this layer
 * does not have. Inventing an exchange rate to make the comparison look precise
 * would be worse than ranking on the figure that is exact.
 */
function compareQuotes(a: SwapQuote, b: SwapQuote): number {
    if (a.expectedOutUnits !== b.expectedOutUnits) {
        return a.expectedOutUnits > b.expectedOutUnits ? -1 : 1;
    }
    if (a.minOutUnits !== b.minOutUnits) {
        return a.minOutUnits > b.minOutUnits ? -1 : 1;
    }
    if (a.gas.messageValue !== b.gas.messageValue) {
        return a.gas.messageValue < b.gas.messageValue ? -1 : 1;
    }
    // Equal on every measure: leave the input order, which is registry order.
    return 0;
}

/** Lower is more trusted. Used to pick the most cautious duplicate. */
function trustRank(asset: FungibleAsset): number {
    switch (asset.trust) {
        case 'blacklisted':
            return 0;
        case 'unknown':
            return 1;
        case 'community':
            return 2;
        case 'verified':
            return 3;
        case 'builtin':
            return 4;
    }
}

/** Reduce any thrown value to the shape the UI renders attempt failures from. */
function describeError(cause: unknown, providerId: DexProviderId): SwapErrorLike {
    const error = isSwapError(cause) ? cause : toSwapError(cause, providerId, 'The exchange could not be reached.');
    return { code: error.code, message: error.message, severity: error.severity };
}

/** `setTimeout` as a promise, cancellable through an `AbortSignal`. */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted === true) {
            reject(signal.reason);
            return;
        }
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        const onAbort = (): void => {
            clearTimeout(timer);
            reject(signal?.reason);
        };
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}
