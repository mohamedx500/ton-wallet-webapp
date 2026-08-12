/**
 * STON.fi provider — public surface
 * ============================================================================
 *
 * The single entry point to the STON.fi integration. Everything outside this
 * directory imports from here, and nothing outside it imports `@ston-fi/*` —
 * enforced by `tests/swap/architecture.test.ts`.
 *
 * What is exported, and why it stops there:
 *
 *  - {@link createStonfiProvider} — the factory the registry calls. This is the
 *    only export the application needs.
 *  - {@link StonfiProvider} and its options — for tests that need to reach
 *    provider internals directly.
 *  - The router allow-lists and the client's decoding helpers — asserted against
 *    directly by the swap test-suite, which is the point of pinning them.
 *
 * The SDK contract classes, the raw API response shapes and the quote's private
 * `providerData` are deliberately *not* re-exported. A caller that could reach
 * them could build a payload without passing the destination checks in
 * `StonfiProvider.buildSwap`, which is exactly what this boundary exists to
 * prevent.
 */

export { STONFI_PROVIDER_ID, StonfiProvider, createStonfiProvider } from './StonfiProvider';
export type { StonfiProviderOptions } from './StonfiProvider';

export { PINNED_PTON_MASTERS, PINNED_ROUTERS, StonfiRouterRegistry } from './routerRegistry';
export type { RouterTrustSource, StonfiRouter } from './routerRegistry';

export { STONFI_API_BASE_URL, STONFI_NATIVE_ADDRESS, StonfiClient, bpsToFractionString } from './client';
export type {
    StonApi,
    StonfiAsset,
    StonfiSimulateParams,
    StonfiSimulation,
    StonfiSimulationRouter,
    StonfiSwapStatus,
} from './client';
