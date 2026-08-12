import { createJettonAsset, TON_ASSET } from '../../src/assets/fungible';
import type { JettonTransferIntent, NativeTonTransferIntent } from '../../src/transfer';

export const OWNER = `0:${'00'.repeat(32)}`;
export const RECIPIENT = `0:${'11'.repeat(32)}`;
export const JETTON_MASTER = `0:${'22'.repeat(32)}`;
export const SENDER_JETTON_WALLET = `0:${'33'.repeat(32)}`;
export const QUERY_ID = 0x0102_0304_0506_0708n;

export const SIX_DECIMAL_JETTON = createJettonAsset({
    master: JETTON_MASTER,
    symbol: 'TEST6',
    name: 'Test Six',
    decimals: 6,
    trust: 'builtin',
});

export function nativeIntent(
    overrides: Partial<NativeTonTransferIntent> = {},
): NativeTonTransferIntent {
    return Object.freeze({
        kind: 'native-ton',
        network: 'mainnet',
        asset: TON_ASSET,
        recipient: RECIPIENT,
        amount: 1_250_000_000n,
        attachedTon: 1_250_000_000n,
        bounce: false,
        purpose: 'Send 1.25 TON',
        ...overrides,
    });
}

export function jettonIntent(
    overrides: Partial<JettonTransferIntent> = {},
): JettonTransferIntent {
    return Object.freeze({
        kind: 'jetton',
        network: 'mainnet',
        asset: SIX_DECIMAL_JETTON,
        recipient: RECIPIENT,
        amount: 1_250_000n,
        attachedTon: 50_000_000n,
        bounce: true,
        purpose: 'Send 1.25 TEST6',
        ownerAddress: OWNER,
        senderJettonWalletAddress: SENDER_JETTON_WALLET,
        responseDestination: OWNER,
        queryId: QUERY_ID,
        forwardTonAmount: 10_000_000n,
        ...overrides,
    });
}
