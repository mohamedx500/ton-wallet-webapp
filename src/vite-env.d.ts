/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_TON_NETWORK?: 'mainnet' | 'testnet';
    readonly VITE_TONCENTER_API_KEY?: string;
    readonly VITE_TON_RPC_TIMEOUT_MS?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
