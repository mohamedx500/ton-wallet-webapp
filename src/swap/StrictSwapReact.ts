import { useSyncExternalStore } from 'react';

import type {
    StrictSwapUiAdapter,
    StrictSwapUiSnapshot,
} from './application';

/**
 * Inactive React hook over an already-composed long-lived adapter.
 *
 * The hook never constructs a client, graph, store, quote session, execution
 * service, or recovery bootstrap. React Strict Mode may subscribe repeatedly,
 * but it cannot duplicate protocol dependencies or trigger operations merely by
 * rendering.
 */
export function useStrictSwap(
    adapter: StrictSwapUiAdapter,
): StrictSwapUiSnapshot {
    return useSyncExternalStore(
        adapter.subscribe,
        adapter.getSnapshot,
        adapter.getSnapshot,
    );
}

/** Subscribe to an optional active adapter without inventing a fallback network. */
export function useOptionalStrictSwap(
    adapter: StrictSwapUiAdapter | null,
): StrictSwapUiSnapshot | null {
    return useSyncExternalStore(
        adapter?.subscribe ?? NOOP_SUBSCRIBE,
        adapter?.getSnapshot ?? NULL_SNAPSHOT,
        adapter?.getSnapshot ?? NULL_SNAPSHOT,
    );
}

const NOOP_SUBSCRIBE = (): (() => void) => () => undefined;
const NULL_SNAPSHOT = (): null => null;
