import { TonClient } from '@ton/ton';
import { sign, type KeyPair } from '@ton/crypto';
import { Cell } from '@ton/core';

import { TonClientChainAccess } from '../core/chain';
import { ChainBalanceReader } from '../core/jetton';
import { BlockchainDiagnostics } from '../observability';
import {
    BrowserPendingSwapReferenceStore,
    DexProviderRegistry,
    PasswordConfirmedSwapExecutor,
    PendingSwapRecoveryBootstrap,
    PendingSwapRecoveryCoordinator,
    SwapEngine,
    SwapExecutionCoordinator,
    SwapLifecycleService,
    SwapQuoteSession,
    StrictSwapUiAdapter,
    createDefaultRegistry,
} from '../swap';
import { WalletCoordinatorFactory } from '../swap/application/PasswordConfirmedSwapExecutor';
import type {
    ApprovedSwapCoordinatorFactory,
    SwapMnemonicDecryptor,
} from '../swap';
import {
    BrowserSubmissionReferenceStore,
    StandardWalletExecutionCoordinator,
    StandardWalletTransactionConfirmer,
    RoutingTransactionConfirmer,
    TonClientExternalMessageTransport,
    TonClientStandardWalletTransactionSource,
    TonClientTransactionBroadcaster,
    TonClientWalletAccountStateSource,
    VerifiedStandardWalletReplayReader,
    WalletExecutionCoordinator,
    WalletDescriptor,
    StandardWalletSigningAuthority,
    TransactionConfirmer,
} from '../wallet';
import { OfficialStandardWalletSigner } from '../wallet/OfficialStandardWalletSigner';
import { HighloadWalletSigner } from '../wallets/highload-v3/HighloadWalletSigner';
import { HighloadWalletExecutionCoordinator } from '../wallets/highload-v3/HighloadWalletExecutionCoordinator';
import { HighloadWalletTransactionConfirmer } from '../wallets/highload-v3/HighloadWalletTransactionConfirmer';
import { SwapApplicationError, SwapApplicationErrorCode } from '../swap/application/errors';
import type {
    SynchronousKeyValueStorage,
} from '../wallet';
import type { ApplicationConfig, ApplicationRpcConfig } from './application';

const STONFI_PROVIDER_ID = 'stonfi';

/** Creates one raw TonClient for the explicitly configured network. */
export interface TonClientFactory {
    create(config: ApplicationRpcConfig): TonClient;
}

export interface StrictSwapApplicationOptions {
    readonly config: ApplicationConfig;
    readonly storage: SynchronousKeyValueStorage;
    readonly decryptor: SwapMnemonicDecryptor;
    readonly clientFactory?: TonClientFactory;
    readonly diagnostics?: BlockchainDiagnostics;
    /** Injected wall clock in milliseconds. */
    readonly clockMs?: () => number;
}

/**
 * Complete inactive dependency graph for the audited standard-wallet STON.fi path.
 *
 * This graph is an internal composition artifact, not a React context contract. A later narrow
 * adapter will expose only quote, lifecycle, invalidation, and recovery operations to React.
 * The graph intentionally retains no password, mnemonic, signing authority, key material,
 * payload cell, signed envelope, or raw provider response.
 */
export interface StrictSwapApplicationGraph {
    readonly network: ApplicationConfig['network'];
    readonly client: TonClient;
    readonly chain: TonClientChainAccess;
    readonly registry: DexProviderRegistry;
    readonly balances: ChainBalanceReader;
    readonly engine: SwapEngine;
    readonly quoteSession: SwapQuoteSession;
    readonly replayReader: VerifiedStandardWalletReplayReader;
    readonly broadcaster: TonClientTransactionBroadcaster;
    readonly confirmer: TransactionConfirmer;
    readonly submissionStore: BrowserSubmissionReferenceStore;
    readonly pendingSwapStore: BrowserPendingSwapReferenceStore;
    readonly walletCoordinatorFactory: WalletCoordinatorFactory;
    readonly swapCoordinatorFactory: ApprovedSwapCoordinatorFactory;
    readonly passwordExecutor: PasswordConfirmedSwapExecutor;
    readonly lifecycle: SwapLifecycleService;
    readonly recoveryCoordinator: PendingSwapRecoveryCoordinator;
    readonly recovery: PendingSwapRecoveryBootstrap;
    readonly ui: StrictSwapUiAdapter;
}

/**
 * Build the strict graph once at the future application composition root.
 *
 * No dependency is installed into React and no network request is made by this function. All
 * long-lived components share the exact same network, client, stores, engine, confirmer, and
 * diagnostics instance. Signer-bearing wallet and swap coordinators are created transiently by
 * Stage C only after authenticated decryption and authority validation.
 */
export function createStrictSwapApplication(
    options: StrictSwapApplicationOptions,
): StrictSwapApplicationGraph {
    const { config } = options;
    const clockMs = options.clockMs ?? Date.now;
    const diagnostics = options.diagnostics ?? new BlockchainDiagnostics({ clock: clockMs });
    const client = (options.clientFactory ?? DEFAULT_TON_CLIENT_FACTORY).create(config.rpc);
    const chain = new TonClientChainAccess(client, config.network);
    const registry = createDefaultRegistry(chain);
    const balances = new ChainBalanceReader(chain);
    const engine = new SwapEngine({
        chain,
        registry,
        balances,
        clock: clockMs,
    });
    const quoteSession = new SwapQuoteSession({
        engine,
        providerId: STONFI_PROVIDER_ID,
        clock: clockMs,
    });

    const replayReader = new VerifiedStandardWalletReplayReader(
        new TonClientWalletAccountStateSource(client, config.network),
    );
    const broadcaster = new TonClientTransactionBroadcaster({
        network: config.network,
        transport: new TonClientExternalMessageTransport(client),
        clock: clockMs,
    });
    const transactionSource = new TonClientStandardWalletTransactionSource(client, config.network);
    const standardConfirmer = new StandardWalletTransactionConfirmer({
        source: transactionSource,
        clock: clockMs,
    });
    const highloadConfirmer = new HighloadWalletTransactionConfirmer({
        source: transactionSource,
        client,
        clock: clockMs,
    });
    const confirmer = new RoutingTransactionConfirmer(standardConfirmer, highloadConfirmer);
    const submissionStore = new BrowserSubmissionReferenceStore({ storage: options.storage });
    const pendingSwapStore = new BrowserPendingSwapReferenceStore({ storage: options.storage });
    const clockUnix = (): number => Math.floor(clockMs() / 1_000);

    const walletCoordinatorFactory: WalletCoordinatorFactory = Object.freeze({
        network: config.network,
        create(keyPair: KeyPair, wallet: WalletDescriptor): WalletExecutionCoordinator {
            if (wallet.kind === 'standard') {
                const authority: StandardWalletSigningAuthority = Object.freeze({
                    publicKey: keyPair.publicKey,
                    sign(message: Cell): Promise<Buffer> {
                        return Promise.resolve(sign(message.hash(), keyPair.secretKey));
                    },
                });
                const signer = new OfficialStandardWalletSigner({
                    authority,
                    clock: clockUnix,
                });
                return new StandardWalletExecutionCoordinator({
                    network: config.network,
                    replayReader,
                    signer,
                    broadcaster,
                    store: submissionStore,
                    confirmer,
                    diagnostics,
                    clock: clockUnix,
                });
            } else if (wallet.kind === 'highload-v3') {
                const signer = new HighloadWalletSigner({
                    client,
                    clock: clockUnix,
                });
                return new HighloadWalletExecutionCoordinator({
                    signer,
                    broadcaster,
                    confirmer: highloadConfirmer,
                    referenceStore: submissionStore,
                    keyPair,
                    clock: clockUnix,
                });
            } else {
                throw new SwapApplicationError(SwapApplicationErrorCode.UnsupportedHighloadV3, 'Unsupported wallet kind');
            }
        },
    });
    const swapCoordinatorFactory: ApprovedSwapCoordinatorFactory = Object.freeze({
        network: config.network,
        create(wallet: WalletExecutionCoordinator): SwapExecutionCoordinator {
            return new SwapExecutionCoordinator({
                network: config.network,
                engine,
                wallet,
                recoveryStore: pendingSwapStore,
                diagnostics,
                clock: clockMs,
            });
        },
    });
    const passwordExecutor = new PasswordConfirmedSwapExecutor({
        network: config.network,
        decryptor: options.decryptor,
        walletCoordinatorFactory,
        swapCoordinatorFactory,
        signerClock: clockUnix,
    });
    const lifecycle = new SwapLifecycleService(passwordExecutor);
    const recoveryCoordinator = new PendingSwapRecoveryCoordinator({
        network: config.network,
        store: pendingSwapStore,
        walletConfirmer: confirmer,
        engine,
        diagnostics,
    });
    const recovery = new PendingSwapRecoveryBootstrap(recoveryCoordinator);
    const ui = new StrictSwapUiAdapter({
        network: config.network,
        quoteSession,
        lifecycle,
        recovery,
    });

    return Object.freeze({
        network: config.network,
        client,
        chain,
        registry,
        balances,
        engine,
        quoteSession,
        replayReader,
        broadcaster,
        confirmer,
        submissionStore,
        pendingSwapStore,
        walletCoordinatorFactory,
        swapCoordinatorFactory,
        passwordExecutor,
        lifecycle,
        recoveryCoordinator,
        recovery,
        ui,
    });
}

const DEFAULT_TON_CLIENT_FACTORY: TonClientFactory = Object.freeze({
    create(config: ApplicationRpcConfig): TonClient {
        return new TonClient({
            endpoint: config.endpoint,
            timeout: config.timeoutMs,
            ...(config.apiKey === undefined ? {} : { apiKey: config.apiKey }),
        });
    },
});
