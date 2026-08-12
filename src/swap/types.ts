/**
 * Swap domain model and the DexProvider contract
 * ============================================================================
 *
 * This file is the seam between the wallet and any decentralised exchange. The
 * swap engine, the transaction builder and the entire UI depend **only** on the
 * types declared here. No DEX-specific identifier, opcode, address, gas
 * constant, version number or SDK type appears anywhere above a provider
 * implementation.
 *
 * The rule that keeps this true, enforced by review and by the import test in
 * `tests/swap/architecture.test.ts`:
 *
 *   > A module outside `src/swap/providers/<name>/` may not import that
 *   > provider's SDK. `@ston-fi/*` appears only under
 *   > `src/swap/providers/stonfi/`.
 *
 * Adding a DEX therefore means adding one directory that implements
 * {@link DexProvider} and registering it. The engine, builder and UI do not
 * change. See `docs/swap.md#adding-a-provider`.
 *
 * LIFECYCLE
 * ---------
 *   quote()      → SwapQuote   — priced, not yet committed to
 *   buildSwap()  → SwapPlan    — concrete messages, still unsigned
 *   (wallet signs and broadcasts the plan's messages)
 *   getOutcome() → SwapOutcome — did the DEX actually execute it?
 *
 * The separation of `buildSwap` from signing is deliberate: every safety check
 * in `validation.ts` runs on a fully-formed `SwapPlan`, so the wallet can refuse
 * to sign something it cannot verify *after* the provider has finished
 * constructing it.
 */

import type { Cell } from '@ton/core';

import type { FungibleAsset } from '../assets/fungible';
import type { AddressSet } from '../core/address';
import type { ChainAccess, NetworkId } from '../core/chain';
import type { SubmissionReference } from '../wallet';

// ────────────────────────────────────────────────────────────────────────────
// Provider identity
// ────────────────────────────────────────────────────────────────────────────

/**
 * Stable, lowercase identifier for a DEX provider, e.g. `'stonfi'`.
 *
 * Persisted in transaction history, so it must never change for an existing
 * provider. Not an enum: adding a provider must not require editing core types.
 */
export type DexProviderId = string;

/**
 * Read-only provider collection consumed by the engine.
 *
 * The interface belongs to the domain layer because the engine needs provider
 * lookup but must not depend on the concrete application registry that wires in
 * STON.fi. Tests can supply a tiny in-memory source without importing any
 * provider directory.
 */
export interface DexProviderSource {
    /** Every enabled provider, in deterministic preference order. */
    list(): readonly DexProvider[];
    /** Look up an enabled provider by its stable identifier. */
    get(id: DexProviderId): DexProvider | undefined;
    /** Look up a provider or fail when a persisted reference is inconsistent. */
    require(id: DexProviderId): DexProvider;
}

/**
 * What a provider is able to do.
 *
 * Declared rather than assumed, because the engine adapts its behaviour: a
 * provider without `statusTracking` gets confirmation by transaction scan rather
 * than by DEX-side query lookup, and one without `onChainDeadline` gets a
 * shorter client-side quote-freshness window because there is no contract-level
 * expiry protecting the user.
 */
export interface DexCapabilities {
    /** Can enumerate its tradable assets (`listAssets`). */
    readonly assetDiscovery: boolean;
    /** Prices come from a real simulation rather than a local approximation. */
    readonly simulation: boolean;
    /** Embeds an expiry in the on-chain payload, so a stale swap self-cancels. */
    readonly onChainDeadline: boolean;
    /** Can resolve the fate of a specific swap by reference (`getOutcome`). */
    readonly statusTracking: boolean;
    /** Accepts a referral address / fee. */
    readonly referrals: boolean;
    /** Can report the exact minimum-received the contract will enforce. */
    readonly exactMinOut: boolean;
}

// ────────────────────────────────────────────────────────────────────────────
// Quoting
// ────────────────────────────────────────────────────────────────────────────

/** A request for a price. Pure data; safe to log. */
export interface QuoteRequest {
    readonly from: FungibleAsset;
    readonly to: FungibleAsset;
    /** Amount offered, in indivisible units of `from`. Always > 0. */
    readonly offerUnits: bigint;
    /** Tolerance in basis points (100 = 1%). Integer, validated by the engine. */
    readonly slippageBps: number;
    /** The wallet that will sign. Some DEXes need it to simulate accurately. */
    readonly walletAddress: string;
    /**
     * Injected clock, used to stamp `SwapQuote.createdAtMs` and to age caches.
     *
     * Passed in rather than read from `Date.now()` inside the provider so that
     * quote freshness and expiry are testable without faking timers globally.
     */
    readonly nowMs: number;
}

/** Gas accounting for a swap, all values in nanotons. */
export interface SwapGasEstimate {
    /**
     * Total TON that must leave the wallet with the message.
     *
     * For a jetton offer this is pure gas. For a TON offer it is the offered
     * amount *plus* gas — the engine keeps the distinction in `offerUnits` so it
     * can check the balance correctly either way.
     */
    readonly messageValue: bigint;
    /**
     * Portion of `messageValue` forwarded to the DEX contracts to pay for the
     * downstream chain of internal messages.
     *
     * Invariant, checked in `validation.ts`: `forwardValue < messageValue`.
     * If forward >= value the transfer aborts before reaching the DEX — a
     * silent failure mode that returns nothing and consumes the fee.
     */
    readonly forwardValue: bigint;
    /** Provider's estimate of what is actually consumed; the rest is refunded. */
    readonly estimatedConsumption: bigint;
}

/** One leg of a route, for display on the confirmation screen. */
export interface SwapRouteHop {
    /** Human description, e.g. `'STON.fi v2.2 · constant product pool'`. */
    readonly label: string;
    /** The pool or vault contract this hop passes through. */
    readonly contractAddress: string;
}

/**
 * A priced swap offer from one provider.
 *
 * Immutable and self-describing: it carries everything the UI needs to render a
 * confirmation screen and everything the engine needs to validate a build,
 * without calling back into the provider.
 */
export interface SwapQuote {
    readonly providerId: DexProviderId;
    readonly from: FungibleAsset;
    readonly to: FungibleAsset;
    /** Amount offered, in units of `from`. */
    readonly offerUnits: bigint;
    /** Expected output at the quoted price, in units of `to`. */
    readonly expectedOutUnits: bigint;
    /**
     * Minimum output the contract will accept, in units of `to`.
     *
     * This is the value that actually protects the user. The engine independently
     * recomputes the floor implied by `slippageBps` and takes whichever is
     * *higher*, so a provider cannot quietly widen the tolerance the user chose.
     */
    readonly minOutUnits: bigint;
    /** Tolerance this quote was priced with, in bps. */
    readonly slippageBps: number;
    /** Provider's own recommendation for this pool's volatility, if it has one. */
    readonly recommendedSlippageBps: number | null;
    /** Price impact in bps, for the "you are moving the market" warning. */
    readonly priceImpactBps: number;
    /** Protocol fee, in units of `feeAsset`. */
    readonly feeUnits: bigint;
    /** Which asset the fee is denominated in (not always `from` or `to`). */
    readonly feeAsset: FungibleAsset;
    readonly gas: SwapGasEstimate;
    readonly route: readonly SwapRouteHop[];
    /** Wall-clock time the quote was produced, for freshness checks. */
    readonly createdAtMs: number;
    /**
     * Provider-private state needed to build the transaction.
     *
     * Typed `unknown`, never `any`: the engine cannot accidentally read it, and
     * the issuing provider must narrow it through a runtime type guard before
     * use. This is the only field in the domain model that is not fully typed,
     * and it is deliberately opaque — see `docs/swap.md#providerdata`.
     */
    readonly providerData: unknown;
}

// ────────────────────────────────────────────────────────────────────────────
// Building
// ────────────────────────────────────────────────────────────────────────────

/**
 * Everything a provider needs to turn a quote into concrete messages, supplied
 * by the engine so it stays deterministic and testable.
 */
export interface SwapBuildContext {
    /** Wallet that will sign, and the default refund/receiver address. */
    readonly walletAddress: string;
    /** Where the bought asset should land. Defaults to `walletAddress`. */
    readonly receiverAddress?: string;
    /**
     * Unique 64-bit correlation id, generated by the engine.
     *
     * Two jobs: it lets the DEX report this specific swap's fate afterwards, and
     * it makes the message distinguishable from a replay of an earlier one. The
     * audited implementation hardcoded `0`, which made post-trade confirmation
     * impossible.
     */
    readonly queryId: bigint;
    /** Injected clock. Never call `Date.now()` inside a provider. */
    readonly nowMs: number;
    /** How long the on-chain payload should stay valid, in seconds. */
    readonly deadlineSeconds: number;
    /** Read-only chain access, for deriving addresses on-chain. */
    readonly chain: ChainAccess;
}

/**
 * One message the wallet must send, in the shape the wallet layer signs.
 *
 * `bounce` is required, not optional, and every swap message sets it `true`.
 * On TON, funds are returned on contract failure **only** for a bounceable
 * message; the audited code hardcoded `bounce: false`, which converted every
 * recoverable DEX rejection into permanent loss. Making the field mandatory
 * means no future builder can forget to think about it.
 */
export interface OutgoingMessage {
    /** Destination, bounceable friendly form. Validated against the allow-list. */
    readonly to: string;
    /** TON to attach, in nanotons. */
    readonly value: bigint;
    /** Message body. */
    readonly body: Cell;
    /** Must be `true` for any contract destination. */
    readonly bounce: boolean;
    /**
     * Human description of what this message does, shown on the confirmation
     * screen: `'Transfer 0.2 USDT to STON.fi router v2.2'`. The user should never
     * be asked to approve an opaque payload.
     */
    readonly purpose: string;
    /**
     * The role the destination plays, resolved by the provider and re-checked by
     * the engine against an independent source.
     */
    readonly destinationRole: DestinationRole;
}

/** What kind of contract a message is addressed to. */
export type DestinationRole =
    /** The user's own jetton wallet (a TEP-74 transfer starts here). */
    | 'own-jetton-wallet'
    /** A DEX router. */
    | 'dex-router'
    /** A proxy-TON wallet owned by a router. */
    | 'proxy-ton-wallet'
    /** A DEX vault. */
    | 'dex-vault'
    /** Anything else — the engine refuses to sign this. */
    | 'unknown';

/**
 * Correlation handle for a submitted swap. Persisted in transaction history so
 * the outcome can still be resolved after a page reload.
 */
export interface SwapReference {
    readonly providerId: DexProviderId;
    /** Router the swap was routed through. */
    readonly routerAddress: string;
    /** Wallet that signed. */
    readonly ownerAddress: string;
    /** The `query_id` embedded in the payload. */
    readonly queryId: bigint;
    /** Unix seconds after which the on-chain payload is void, if supported. */
    readonly deadlineUnix: number | null;
}

/**
 * Secret-free correlation state needed to resume a submitted swap after reload.
 *
 * The record deliberately excludes the quote, provider-private route data,
 * payload cells, signed envelope, BOC, signature, and raw API responses.
 */
export interface PendingSwapReference {
    readonly schemaVersion: 1;
    readonly network: NetworkId;
    readonly submission: SubmissionReference;
    readonly swap: SwapReference;
}

/** Persistence boundary for pending swap correlation metadata only. */
export interface PendingSwapReferenceStore {
    put(reference: PendingSwapReference): Promise<void>;
    get(network: NetworkId, submissionId: string): Promise<PendingSwapReference | null>;
    list(network: NetworkId, ownerAddress: string): Promise<readonly PendingSwapReference[]>;
    remove(network: NetworkId, submissionId: string): Promise<void>;
}

/**
 * A fully-built, not-yet-signed swap.
 *
 * Everything the engine's validation layer needs is present here, so validation
 * runs on exactly the bytes that will be signed.
 */
export interface SwapPlan {
    readonly providerId: DexProviderId;
    /** The quote this plan was built from. */
    readonly quote: SwapQuote;
    /** Messages to send, in order. Almost always exactly one. */
    readonly messages: readonly OutgoingMessage[];
    readonly reference: SwapReference;
    /**
     * Every address the provider vouches for, with the role it plays.
     *
     * The engine cross-checks each message destination against this set *and*
     * against `verifyDestination`, which must consult an independent source
     * (published router registry, or on-chain derivation). One source alone is
     * what allowed the audited code to sign whatever address an HTTP response
     * happened to contain.
     */
    readonly trustedDestinations: AddressSet;
    /** Wall-clock time this plan stops being safe to broadcast. */
    readonly expiresAtMs: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Confirming
// ────────────────────────────────────────────────────────────────────────────

/** Where a submitted swap has got to. */
export type SwapOutcomeState =
    /** Not visible on-chain yet. Keep polling. */
    | 'pending'
    /** The DEX executed it and the output was delivered. */
    | 'succeeded'
    /** The DEX rejected it. Funds were returned (given a bounceable message). */
    | 'failed'
    /** Polling gave up. The swap may still land; show the explorer link. */
    | 'unknown';

/** Resolved fate of a submitted swap. */
export interface SwapOutcome {
    readonly state: SwapOutcomeState;
    /** TVM exit code when the DEX aborted, as a string (may exceed 2^31). */
    readonly exitCode: string | null;
    readonly txHash: string | null;
    /** Units of the ask asset actually received, when determinable. */
    readonly receivedUnits: bigint | null;
    /** Explorer deep link for this swap. */
    readonly explorerUrl: string | null;
}

/** Verdict on whether a destination address may be signed for. */
export interface DestinationVerdict {
    readonly trusted: boolean;
    readonly role: DestinationRole;
    /**
     * Why — included in the error shown to the user when `trusted` is false, and
     * in the audit log when it is true. Must name the source of the decision,
     * e.g. `'listed in STON.fi router registry'` or `'derived on-chain from the
     * jetton master'`.
     */
    readonly reason: string;
}

/**
 * A destination to verify, with enough context for the provider to *recompute*
 * the expected address from first principles rather than merely inspect the one
 * it is handed.
 *
 * This is the whole point of the check. "Does this address look like a jetton
 * wallet?" is unanswerable — every account looks alike. "Is this the jetton
 * wallet that `get_wallet_address(user)` on the master the user selected returns?"
 * is decidable, and answering it is what makes signing safe.
 */
export interface DestinationCheck {
    /** The address the wallet is about to send to. */
    readonly address: string;
    /** The role the plan claims it has; the verdict must agree. */
    readonly expectedRole: DestinationRole;
    /** The quote the plan was built from, for recomputing from user-chosen inputs. */
    readonly quote: SwapQuote;
    /** The signing wallet, the owner used in a jetton-wallet derivation. */
    readonly walletAddress: string;
    /** Injected clock, for registry cache ageing. Never call `Date.now()`. */
    readonly nowMs: number;
    readonly chain: ChainAccess;
}

// ────────────────────────────────────────────────────────────────────────────
// The provider contract
// ────────────────────────────────────────────────────────────────────────────

/**
 * A decentralised exchange integration.
 *
 * Implementations must obey these rules — the engine relies on them and the
 * tests check them:
 *
 * 1. **Never trust a remote address.** A destination that will be signed for
 *    must be derived on-chain, or matched against a published contract registry.
 *    An address that arrives in a price-API response is untrusted input.
 * 2. **Never call `Date.now()`.** Take time from {@link SwapBuildContext.nowMs}
 *    so builds are reproducible and the deadline is testable. (A hardcoded
 *    deadline of `0` was the single defect behind the reported "sent 0.2 USDT,
 *    got 0.2 USDT back" failure — every V2 swap was expired on arrival.)
 * 3. **Never use floating point for an amount.** `bigint` end to end.
 * 4. **Always set `bounce: true`** on contract destinations.
 * 5. **Throw only `SwapError`.** Wrap foreign errors with `toSwapError`.
 * 6. **Be stateless per call.** Cache immutable registry data if useful, never
 *    per-swap state.
 */
export interface DexProvider {
    /** Stable id, persisted in history. */
    readonly id: DexProviderId;
    /** Name shown in the UI, e.g. `'STON.fi'`. */
    readonly displayName: string;
    /** Provider homepage, for the "powered by" affordance. */
    readonly website: string;
    readonly capabilities: DexCapabilities;

    /**
     * Tradable assets, for the token picker. Only called when
     * `capabilities.assetDiscovery` is true.
     *
     * Metadata returned here is remote data: implementations must pass text
     * through `sanitizeAssetText` and set `trust` honestly.
     */
    listAssets(): Promise<readonly FungibleAsset[]>;

    /**
     * Cheap pre-check used to skip providers before quoting. May be
     * conservative; a `true` here does not commit the provider to a quote.
     */
    supportsPair(from: FungibleAsset, to: FungibleAsset): Promise<boolean>;

    /**
     * Price a swap.
     *
     * @throws {NoRouteError} when this provider has no route for the pair.
     * @throws {SwapError} for any other failure.
     */
    quote(request: QuoteRequest): Promise<SwapQuote>;

    /**
     * Turn a quote into concrete unsigned messages.
     *
     * Must reject a quote it did not issue (check `quote.providerId` and narrow
     * `providerData` through a type guard).
     */
    buildSwap(quote: SwapQuote, context: SwapBuildContext): Promise<SwapPlan>;

    /**
     * Decide whether a destination may be signed for.
     *
     * Must reach its verdict from a source **independent of the built plan** — a
     * published contract registry, or on-chain re-derivation from an address the
     * user chose. Returning `trusted: true` because the address is the one the
     * builder produced is not a check; it is a tautology. This is the last line
     * of defence before the user's funds move.
     */
    verifyDestination(check: DestinationCheck): Promise<DestinationVerdict>;

    /**
     * Resolve what happened to a submitted swap. Only called when
     * `capabilities.statusTracking` is true.
     */
    getOutcome(reference: SwapReference): Promise<SwapOutcome>;

    /** Explorer URL for a submitted swap, if the provider can produce one. */
    explorerUrl(reference: SwapReference): string | null;
}

// ────────────────────────────────────────────────────────────────────────────
// Engine-level types
// ────────────────────────────────────────────────────────────────────────────

/** A provider's response to a quote request, successful or not. */
export type QuoteAttempt =
    | { readonly status: 'fulfilled'; readonly providerId: DexProviderId; readonly quote: SwapQuote }
    | { readonly status: 'rejected'; readonly providerId: DexProviderId; readonly error: SwapErrorLike };

/**
 * Minimal shape of a swap error, so the UI can render an attempt failure without
 * importing the error classes.
 */
export interface SwapErrorLike {
    readonly code: string;
    readonly message: string;
    readonly severity: 'error' | 'warning' | 'suspicious';
}

/** Result of asking every registered provider for a price. */
export interface QuoteComparison {
    /** Quotes that succeeded, best first. Best = highest `expectedOutUnits`. */
    readonly quotes: readonly SwapQuote[];
    /** Every attempt, including failures, so the UI can explain gaps. */
    readonly attempts: readonly QuoteAttempt[];
    /** Convenience handle on `quotes[0]`. */
    readonly best: SwapQuote | null;
}

/** Balances the engine needs to pre-flight a swap. */
export interface WalletBalances {
    /** TON balance in nanotons, for the gas check. */
    readonly tonUnits: bigint;
    /**
     * Balance of the offered asset in its own units. Equals `tonUnits` when the
     * offered asset is native.
     */
    readonly offeredAssetUnits: bigint;
}
