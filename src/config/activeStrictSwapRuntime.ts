import type { NetworkId } from '../core/chain';
import {
    LegacySecurityServiceSwapMnemonicDecryptor,
} from '../swap';
import type {
    LegacySecurityDecryptor,
    StrictSwapUiAdapter,
} from '../swap';
import type { SynchronousKeyValueStorage } from '../wallet';
import {
    ApplicationConfigError,
    decodeApplicationConfig,
} from './application';
import type { ApplicationEnvironment } from './application';
import {
    createStrictSwapApplication,
} from './strictSwapApplication';
import type { StrictSwapApplicationGraph, TonClientFactory } from './strictSwapApplication';

/** Narrow, secret-free active runtime made available to React. */
export interface ActiveStrictSwapRuntime {
    readonly network: NetworkId;
    readonly ui: StrictSwapUiAdapter;
    readonly graph: StrictSwapApplicationGraph;
}

export interface ActiveStrictSwapRuntimeOptions {
    readonly environment: ApplicationEnvironment;
    readonly storage: SynchronousKeyValueStorage;
    readonly security: LegacySecurityDecryptor;
    readonly clientFactory?: TonClientFactory;
    readonly clockMs?: () => number;
}

export type ActiveStrictSwapRuntimeState =
    | {
        readonly status: 'ready';
        readonly network: NetworkId;
        readonly ui: StrictSwapUiAdapter;
        readonly graph: StrictSwapApplicationGraph;
        readonly errorCode: null;
    }
    | {
        readonly status: 'unavailable';
        readonly network: null;
        readonly ui: null;
        readonly errorCode: string;
    };

/**
 * Compose the active strict swap runtime from explicit inputs.
 *
 * The complete graph remains private to this boundary. React receives only the
 * explicit network and the metadata-only UI adapter.
 */
export function createActiveStrictSwapRuntime(
    options: ActiveStrictSwapRuntimeOptions,
): ActiveStrictSwapRuntime {
    const config = decodeApplicationConfig(options.environment);
    const decryptor = new LegacySecurityServiceSwapMnemonicDecryptor(options.security);
    const graph = createStrictSwapApplication({
        config,
        storage: options.storage,
        decryptor,
        ...(options.clientFactory === undefined
            ? {}
            : { clientFactory: options.clientFactory }),
        ...(options.clockMs === undefined
            ? {}
            : { clockMs: options.clockMs }),
    });

    return Object.freeze({
        network: graph.network,
        ui: graph.ui,
        graph,
    });
}

/**
 * Cache both successful and failed composition so React Strict Mode cannot
 * duplicate clients, stores, or dependency graphs by rendering twice.
 */
export function createStrictSwapRuntimeOwner(
    create: () => ActiveStrictSwapRuntime,
): { readonly get: () => ActiveStrictSwapRuntimeState, readonly reset: () => void } {
    let state: ActiveStrictSwapRuntimeState | null = null;

    return Object.freeze({
        get(): ActiveStrictSwapRuntimeState {
            if (state !== null) return state;

            try {
                const runtime = create();
                state = Object.freeze({
                    status: 'ready',
                    network: runtime.network,
                    ui: runtime.ui,
                    graph: runtime.graph,
                    errorCode: null,
                });
            } catch (error) {
                state = Object.freeze({
                    status: 'unavailable',
                    network: null,
                    ui: null,
                    errorCode: safeInitializationErrorCode(error),
                });
            }

            return state;
        },
        reset(): void {
            state = null;
        }
    });
}

function safeInitializationErrorCode(error: unknown): string {
    if (error instanceof ApplicationConfigError) return error.code;
    return 'STRICT_SWAP_INITIALIZATION_FAILED';
}
