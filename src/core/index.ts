/**
 * Core chain primitives
 * ============================================================================
 *
 * Shared, dependency-free building blocks used by every feature layer.
 * Nothing in `src/core` may import from a feature module (`swap`, `nft`, `dns`,
 * `tonconnect`) — the dependency arrow points one way only.
 */

export { CoreError, InvalidAmountError, InvalidAddressError } from './errors';

export {
    AddressSet,
    addressKey,
    formatAddress,
    isSameAddress,
    isValidAddress,
    parseAddress,
    shortenAddress,
    tryParseAddress,
} from './address';

export {
    BPS_DENOMINATOR,
    ONE_TON,
    TON_DECIMALS,
    applySlippage,
    bpsToPercent,
    differenceInBps,
    formatTon,
    formatUnits,
    maxBigInt,
    minBigInt,
    parseTon,
    parseUnits,
    percentToBps,
    truncateDecimalString,
    tryParseUnits,
} from './units';

export { TonClientChainAccess } from './chain';
export type { ChainAccess, GetMethodResult, NetworkId } from './chain';
