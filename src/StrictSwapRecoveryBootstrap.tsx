import { useEffect } from 'react';

import type { ActiveStrictSwapRuntimeState } from './config/activeStrictSwapRuntime';
import { addressKey } from './core/address';

const RECOVERY_CONCURRENCY = 4;
const WALLET_CONFIRMATION_TIMEOUT_MS = 60_000;
const WALLET_CONFIRMATION_POLL_INTERVAL_MS = 2_000;
const DEX_OUTCOME_TIMEOUT_MS = 180_000;
const DEX_OUTCOME_POLL_INTERVAL_MS = 3_000;

export interface StrictSwapRecoveryBootstrapProps {
    readonly runtime: ActiveStrictSwapRuntimeState;
    readonly accountId: string;
    readonly accountAddress: string;
    readonly walletAddress: string;
}

/**
 * Starts metadata-only pending-swap recovery after login for one stable account.
 * It receives no account ciphertext or signing authority and delegates only to
 * the process-lifetime strict adapter's recovery operation.
 */
export function StrictSwapRecoveryBootstrap({
    runtime,
    accountId,
    accountAddress,
    walletAddress,
}: StrictSwapRecoveryBootstrapProps) {
    useEffect(() => {
        if (runtime.status !== 'ready' || accountId.trim().length === 0) return;

        let ownerKey: string;
        try {
            ownerKey = addressKey(accountAddress);
            if (addressKey(walletAddress) !== ownerKey) return;
        } catch {
            return;
        }

        void runtime.ui.recover(accountAddress, {
            concurrency: RECOVERY_CONCURRENCY,
            wallet: {
                timeoutMs: WALLET_CONFIRMATION_TIMEOUT_MS,
                pollIntervalMs: WALLET_CONFIRMATION_POLL_INTERVAL_MS,
            },
            outcome: {
                timeoutMs: DEX_OUTCOME_TIMEOUT_MS,
                pollIntervalMs: DEX_OUTCOME_POLL_INTERVAL_MS,
            },
        }).catch(() => undefined);
    }, [
        accountAddress,
        accountId,
        runtime,
        walletAddress,
    ]);

    return null;
}
