import {
    createContext,
    useContext,
    useState,
    useEffect,
} from 'react';
import type { ReactNode } from 'react';

import {
    createActiveStrictSwapRuntime,
    createStrictSwapRuntimeOwner,
} from './config/activeStrictSwapRuntime';
import type {
    ActiveStrictSwapRuntimeState,
} from './config/activeStrictSwapRuntime';
// @ts-ignore — SecurityService is a legacy .js file
import { SecurityService } from './services/SecurityService.js';
import { useWallet } from './context/WalletContext';

const StrictSwapRuntimeContext = createContext<ActiveStrictSwapRuntimeState | null>(null);

let activeRuntime = createActiveStrictSwapRuntime({
    environment: {
        ...import.meta.env,
        VITE_TON_NETWORK: localStorage.getItem('ton-wallet:network') === 'testnet' ? 'testnet' : 'mainnet'
    },
    storage: window.localStorage,
    security: new SecurityService(),
});

const ACTIVE_STRICT_SWAP_RUNTIME = createStrictSwapRuntimeOwner(() => activeRuntime);

// Allow forcing a re-initialization of the runtime
export function resetStrictSwapRuntime() {
    activeRuntime = createActiveStrictSwapRuntime({
        environment: {
            ...import.meta.env,
            VITE_TON_NETWORK: localStorage.getItem('ton-wallet:network') === 'testnet' ? 'testnet' : 'mainnet'
        },
        storage: window.localStorage,
        security: new SecurityService(),
    });
    ACTIVE_STRICT_SWAP_RUNTIME.reset(); 
}

export interface StrictSwapProviderProps {
    readonly children: ReactNode;
}

/**
 * Installs one process-lifetime strict swap runtime without exposing its graph.
 * A missing or invalid explicit network disables only strict swaps; it does not
 * crash unrelated wallet functions or silently select a chain.
 */
export function StrictSwapProvider({ children }: StrictSwapProviderProps) {
    const { network } = useWallet();
    const [runtime, setRuntime] = useState(() => ACTIVE_STRICT_SWAP_RUNTIME.get());

    useEffect(() => {
        resetStrictSwapRuntime();
        setRuntime(ACTIVE_STRICT_SWAP_RUNTIME.get());
    }, [network]);

    return (
        <StrictSwapRuntimeContext.Provider value={runtime}>
            {children}
        </StrictSwapRuntimeContext.Provider>
    );
}

export function useStrictSwapRuntime(): ActiveStrictSwapRuntimeState {
    const runtime = useContext(StrictSwapRuntimeContext);
    if (runtime === null) {
        throw new Error('useStrictSwapRuntime must be used within StrictSwapProvider.');
    }
    return runtime;
}
