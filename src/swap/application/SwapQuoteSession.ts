import type { NetworkId } from '../../core/chain';
import type { DexProvider, DexProviderId, QuoteRequest, SwapQuote } from '../types';
import {
    SwapApplicationError,
    SwapApplicationErrorCode,
} from './errors';
import type { SwapIntent } from './types';

/** Narrow quote-only engine contract used by the inactive application adapter. */
export interface SwapQuoteEngine {
    readonly network: NetworkId;
    readonly providers: readonly DexProvider[];
    requireBest(
        request: QuoteRequest,
        options: { readonly providerIds?: readonly DexProviderId[] },
    ): Promise<SwapQuote>;
}

/** Configuration for one network-bound provider-restricted quote session. */
export interface SwapQuoteSessionOptions {
    readonly engine: SwapQuoteEngine;
    /** Enabled provider selected by application configuration. */
    readonly providerId: DexProviderId;
    /** Injected clock used to construct the exact quote request. */
    readonly clock: () => number;
}

/** Immutable handoff that preserves the exact quote instance returned by the engine. */
export interface SwapQuoteApproval {
    readonly intent: SwapIntent;
    readonly request: QuoteRequest;
    readonly quote: SwapQuote;
    readonly generation: number;
}

/** Latest-request-wins result for one quote attempt. */
export type SwapQuoteSessionResult =
    | {
        readonly state: 'ready';
        readonly approval: SwapQuoteApproval;
    }
    | {
        readonly state: 'superseded';
        readonly generation: number;
    };

/**
 * Inactive UI-facing quote boundary.
 *
 * The session does not cancel provider transport. It allocates a monotonically
 * increasing generation before each request and suppresses every completion that
 * is no longer current. This prevents an older response or failure from replacing
 * newer UI state while transport-level AbortSignal support remains a separate
 * provider/client contract slice.
 */
export class SwapQuoteSession {
    public readonly network: NetworkId;
    public readonly providerId: DexProviderId;
    private readonly engine: SwapQuoteEngine;
    private readonly clock: () => number;
    private generation = 0;

    public constructor(options: SwapQuoteSessionOptions) {
        this.engine = options.engine;
        this.network = options.engine.network;
        this.providerId = options.providerId;
        this.clock = options.clock;
        this.assertProviderConfiguration();
    }

    /** Invalidate every request currently in flight, for modal close or intent change. */
    public invalidate(): void {
        this.generation = nextGeneration(this.generation);
    }

    /** Quote one exact intent through only the configured provider. */
    public async quote(intent: SwapIntent): Promise<SwapQuoteSessionResult> {
        if (intent.network !== this.network) {
            throw new SwapApplicationError(
                SwapApplicationErrorCode.QuoteSessionNetworkMismatch,
                'The quote session and swap intent must use the same TON network.',
            );
        }

        const generation = nextGeneration(this.generation);
        this.generation = generation;
        const request = Object.freeze({
            from: intent.from,
            to: intent.to,
            offerUnits: intent.offerUnits,
            slippageBps: intent.slippageBps,
            walletAddress: intent.ownerAddress,
            nowMs: this.readClock(),
        });

        try {
            const quote = await this.engine.requireBest(request, {
                providerIds: Object.freeze([this.providerId]),
            });
            if (generation !== this.generation) {
                return Object.freeze({ state: 'superseded', generation });
            }
            if (quote.providerId !== this.providerId) {
                throw new SwapApplicationError(
                    SwapApplicationErrorCode.QuoteProviderUnavailable,
                    'The quote came from a provider that is not enabled for this session.',
                    { providerId: quote.providerId },
                );
            }

            return Object.freeze({
                state: 'ready',
                approval: Object.freeze({
                    intent,
                    request,
                    quote,
                    generation,
                }),
            });
        } catch (cause) {
            if (generation !== this.generation) {
                return Object.freeze({ state: 'superseded', generation });
            }
            throw cause;
        }
    }

    private assertProviderConfiguration(): void {
        const provider = this.engine.providers.find((candidate) => candidate.id === this.providerId);
        if (provider === undefined) {
            throw new SwapApplicationError(
                SwapApplicationErrorCode.QuoteProviderUnavailable,
                'The configured exchange is not available on this TON network.',
                { providerId: this.providerId },
            );
        }
        if (
            !provider.capabilities.simulation
            || !provider.capabilities.exactMinOut
            || !provider.capabilities.onChainDeadline
            || !provider.capabilities.statusTracking
        ) {
            throw new SwapApplicationError(
                SwapApplicationErrorCode.QuoteProviderUnsafe,
                'The configured exchange does not satisfy the safe swap capabilities.',
                { providerId: provider.id },
            );
        }
    }

    private readClock(): number {
        const nowMs = this.clock();
        if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
            throw new SwapApplicationError(
                SwapApplicationErrorCode.InvalidNetwork,
                'The application quote clock is invalid.',
            );
        }
        return nowMs;
    }
}

function nextGeneration(current: number): number {
    if (current >= Number.MAX_SAFE_INTEGER) {
        return 1;
    }
    return current + 1;
}
