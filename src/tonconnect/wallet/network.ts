import type { NetworkId } from '../../core/chain';
import { TonConnectWalletError } from './errors';

const GLOBAL_IDS: Readonly<Record<NetworkId, string>> = Object.freeze({
    mainnet: '-239',
    testnet: '-3',
});

export function toTonConnectNetworkId(network: NetworkId): string {
    return GLOBAL_IDS[network];
}

export function assertTonConnectNetwork(
    expected: NetworkId,
    actual: string,
): void {
    if (actual !== GLOBAL_IDS[expected]) {
        throw new TonConnectWalletError(
            'NETWORK_MISMATCH',
            'The TON Connect request targets a different TON network.',
            { expectedNetwork: expected },
        );
    }
}
