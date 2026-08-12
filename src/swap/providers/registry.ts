/**
 * DEX provider registry
 * ============================================================================
 *
 * The one place that knows which DEX integrations exist. The swap engine holds a
 * registry, not a provider, so adding an exchange is a registration change
 * rather than an engine change.
 *
 * ADDING A PROVIDER
 * -----------------
 *  1. Create `src/swap/providers/<name>/` and implement `DexProvider` there.
 *     All of that exchange's SDK imports live inside that directory.
 *  2. Export a factory `create<Name>Provider(chain: ChainAccess): DexProvider`.
 *  3. Add one line to {@link createDefaultRegistry}.
 *
 * Nothing in `src/swap/SwapEngine.ts`, the transaction builder, or the UI is
 * touched. See `docs/swap.md#adding-a-provider` for the full walkthrough,
 * including the checklist a new provider must satisfy before it is enabled.
 *
 * ON DEDUST
 * ---------
 * DeDust was removed: its SDK is no longer actively maintained to the standard
 * this wallet requires. The abstraction is deliberately DEX-agnostic so it can
 * return as a provider directory whenever a maintained SDK exists, with no
 * change above this file.
 */

import type { ChainAccess } from '../../core/chain';
import type { DexProvider, DexProviderId, DexProviderSource } from '../types';

import { createStonfiProvider } from './stonfi';

/**
 * An immutable, ordered collection of DEX providers.
 *
 * Order is the tie-break when two providers quote an identical output, so it
 * encodes a preference. It is not a fallback chain: the engine queries every
 * enabled provider concurrently and compares results.
 */
export class DexProviderRegistry implements DexProviderSource {
    private readonly providers: readonly DexProvider[];
    private readonly byId: ReadonlyMap<DexProviderId, DexProvider>;

    public constructor(providers: readonly DexProvider[]) {
        const byId = new Map<DexProviderId, DexProvider>();
        for (const provider of providers) {
            if (byId.has(provider.id)) {
                // A duplicate id would make history entries ambiguous — the
                // `SwapReference` persisted with a transaction could no longer be
                // resolved back to the integration that produced it.
                throw new Error(`Duplicate DEX provider id: ${provider.id}`);
            }
            byId.set(provider.id, provider);
        }
        this.providers = [...providers];
        this.byId = byId;
    }

    /** Every registered provider, in preference order. */
    public list(): readonly DexProvider[] {
        return this.providers;
    }

    /** Look up a provider by id. Returns `undefined` when not registered. */
    public get(id: DexProviderId): DexProvider | undefined {
        return this.byId.get(id);
    }

    /**
     * Look up a provider by id, throwing when absent.
     *
     * Used when resolving a persisted `SwapReference`: a history entry naming a
     * provider that no longer exists is a real inconsistency, not a normal
     * "not found" case.
     */
    public require(id: DexProviderId): DexProvider {
        const provider = this.byId.get(id);
        if (provider === undefined) {
            throw new Error(`No DEX provider registered with id "${id}".`);
        }
        return provider;
    }

    /** Whether any provider is registered. */
    public get isEmpty(): boolean {
        return this.providers.length === 0;
    }

    /** A copy with additional providers appended. Useful in tests. */
    public with(...providers: readonly DexProvider[]): DexProviderRegistry {
        return new DexProviderRegistry([...this.providers, ...providers]);
    }

    /** A copy containing only the named providers, in registry order. */
    public only(ids: readonly DexProviderId[]): DexProviderRegistry {
        const wanted = new Set(ids);
        return new DexProviderRegistry(this.providers.filter((provider) => wanted.has(provider.id)));
    }
}

/**
 * The registry the application ships with.
 *
 * STON.fi is currently the only production provider. The signature takes
 * `ChainAccess` rather than a `TonClient` so providers cannot broadcast: they
 * can read chain state to derive and verify addresses, and nothing more.
 */
export function createDefaultRegistry(chain: ChainAccess): DexProviderRegistry {
    return new DexProviderRegistry([createStonfiProvider(chain)]);
}
