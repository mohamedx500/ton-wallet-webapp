/**
 * Swap module — public surface
 * ============================================================================
 *
 * Everything the application needs to price, validate, sign and confirm a swap,
 * with no reference to any particular exchange.
 *
 * TYPICAL USE
 * -----------
 * ```ts
 * const engine = new SwapEngine({
 *     chain,
 *     registry: createDefaultRegistry(chain),
 *     balances: new ChainBalanceReader(chain),
 * });
 *
 * const quote = await engine.requireBest({
 *     from: TON_ASSET,
 *     to: usdt,
 *     offerUnits: parseUnits('1.5', 9),
 *     slippageBps: 100,
 *     walletAddress,
 *     nowMs: Date.now(),
 * });
 *
 * const prepared = await engine.prepare(quote, { walletAddress });
 * // …show prepared.plan.messages and prepared.warnings, then sign…
 * const outcome = await engine.waitForOutcome(prepared.plan.reference);
 * ```
 *
 * WHAT IS NOT EXPORTED
 * --------------------
 * No provider implementation, and no exchange SDK type. The UI imports
 * {@link SwapEngine} and the domain types; it never names an exchange. That is
 * what lets a DEX be added or removed as a directory under
 * `src/swap/providers/`, and it is checked mechanically by
 * `tests/swap/architecture.test.ts`.
 *
 * @see docs/swap.md
 */

// ── Inactive application boundary ──────────────────────────────────────────
export {
    ACTIVE_TON_ASSET,
    LegacySecurityServiceSwapMnemonicDecryptor,
    PasswordConfirmedSwapExecutor,
    PendingSwapRecoveryBootstrap,
    SwapApplicationError,
    SwapLifecycleService,
    SwapApplicationErrorCode,
    SwapQuoteSession,
    StrictSwapUiAdapter,
    createActiveQuoteIntent,
    createSwapIntent,
    decodePasswordConfirmedSwapAccount,
    decodeStonfiAssets,
    findActiveAssetBalance,
    hasPositiveExactAmount,
    parsePositiveOfferUnits,
    toFungibleAsset,
    toWalletDescriptor,
} from './application';
export type {
    ActiveQuoteIntentInput,
    ActiveSwapAsset,
    ActiveWalletTokenBalance,
    ApprovedSwapCoordinator,
    ApprovedSwapCoordinatorFactory,
    CreateSwapIntentInput,
    ExecutePasswordConfirmedSwapRequest,
    ExecuteStrictSwapOptions,
    LegacyEncryptedMnemonic,
    LegacySecurityDecryptor,
    LegacySwapAssetInput,
    LegacyWalletAccountInput,
    PasswordConfirmedSwapAccount,
    PasswordConfirmedSwapExecutorOptions,
    PasswordConfirmedSwapOperation,
    PasswordConfirmedSwapResult,
    PendingSwapRecoveryBootstrapOptions,
    RecoveredSwapLifecycle,
    RecoveryLifecycleStage,
    WalletCoordinatorFactory,
    StrictSwapQuoteView,
    StrictSwapUiAdapterOptions,
    StrictSwapUiListener,
    StrictSwapUiPhase,
    StrictSwapUiSnapshot,
    SwapLifecycleEvent,
    SwapLifecycleExecutionOptions,
    SwapLifecycleStage,
    SwapMnemonicDecryptor,
    WalletPendingSwapRecovery,
    SwapApplicationErrorCodeValue,
    SwapIntent,
    SwapQuoteApproval,
    SwapQuoteEngine,
    SwapQuoteSessionOptions,
    SwapQuoteSessionResult,
} from './application';

// The inactive React hook is intentionally imported from `./StrictSwapReact`
// directly so this provider-neutral protocol barrel remains React-free.

// ── Engine ──────────────────────────────────────────────────────────────────
export { RandomQueryIdSource, SwapEngine } from './SwapEngine';
export {
    BrowserPendingSwapReferenceStore,
    decodePendingSwapReference,
} from './BrowserPendingSwapReferenceStore';
export type {
    BrowserPendingSwapReferenceStoreOptions,
} from './BrowserPendingSwapReferenceStore';
export { PendingSwapRecoveryCoordinator } from './PendingSwapRecoveryCoordinator';
export type {
    PendingSwapRecoveryCoordinatorOptions,
    PendingSwapRecoveryResult,
    RecoverPendingSwapOptions,
    RecoverWalletSwapsOptions,
} from './PendingSwapRecoveryCoordinator';
export { SwapExecutionCoordinator } from './SwapExecutionCoordinator';
export type {
    ExecuteSwapOptions,
    ExecuteSwapRequest,
    SwapExecutionCoordinatorOptions,
    SwapExecutionProgress,
    SwapExecutionProgressStage,
    SwapExecutionResult,
} from './SwapExecutionCoordinator';
export type {
    PrepareOptions,
    PreparedSwap,
    QueryIdSource,
    QuoteAllOptions,
    SwapEngineOptions,
    WaitForOutcomeOptions,
} from './SwapEngine';

// ── Provider registry ───────────────────────────────────────────────────────
export { DexProviderRegistry, createDefaultRegistry } from './providers/registry';

// ── Domain model ────────────────────────────────────────────────────────────
export type {
    DestinationCheck,
    DestinationRole,
    DestinationVerdict,
    DexCapabilities,
    DexProvider,
    DexProviderId,
    DexProviderSource,
    OutgoingMessage,
    PendingSwapReference,
    PendingSwapReferenceStore,
    QuoteAttempt,
    QuoteComparison,
    QuoteRequest,
    SwapBuildContext,
    SwapErrorLike,
    SwapGasEstimate,
    SwapOutcome,
    SwapOutcomeState,
    SwapPlan,
    SwapQuote,
    SwapReference,
    SwapRouteHop,
    WalletBalances,
} from './types';

// ── Wallet execution seam ──────────────────────────────────────────────────
export { toUnsignedWalletMessages } from './walletAdapter';

// ── Errors ──────────────────────────────────────────────────────────────────
export {
    ConfirmationTimeoutError,
    InsufficientFundsError,
    InvalidSlippageError,
    InvalidSwapRequestError,
    MalformedTransactionError,
    NoRouteError,
    PriceMovedError,
    ProviderProtocolError,
    QuoteExpiredError,
    SwapError,
    SwapErrorCode,
    SwapRevertedError,
    UntrustedDestinationError,
    isSwapError,
    toSwapError,
} from './errors';
export type { SwapErrorSeverity } from './errors';

// ── Policy and validation ───────────────────────────────────────────────────
//
// Exported so the UI can render the limits it is being held to (maximum
// slippage, price-impact ceiling) rather than hardcoding them in a label, and so
// tests can tighten the policy without patching module internals.
export {
    DEFAULT_SWAP_POLICY,
    assertSufficientBalance,
    assertValidSlippage,
    collectSwapWarnings,
    effectiveSlippageBps,
    resolveMinOut,
} from './validation';
export type { SwapPolicy, SwapWarning } from './validation';
