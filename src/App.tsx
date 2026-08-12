import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useWallet } from './context/WalletContext';
import LoginScreen from './components/LoginScreen';
import WalletHeader from './components/WalletHeader';
import BottomNavigation from './components/BottomNavigation';
import HomeTab from './components/HomeTab';
import ActivityTab from './components/ActivityTab';
import SettingsTab from './components/SettingsTab';
import NftTab from './components/NftTab';
import LinkWalletModal from './components/LinkWalletModal';
import TonConnectRequestModal from './components/TonConnectRequestModal';
import TonConnectConnectModal from './components/TonConnectConnectModal';
import ConnectedAppsModal from './components/ConnectedAppsModal';
import { SendModal, ReceiveModal, BackupModal, PhraseModal, TransactionModal, PasswordPromptModal, SelectWalletTypeModal, TokenDetailsModal, PrivateKeyModal, SwapModal } from './components/WalletModals';
import { AccountsModal, AddAccountModal } from './components/AccountModals';
import NetworkBanner from './components/NetworkBanner';
import MultiSendModal from './components/MultiSend/MultiSendModal';
import { useMultiSend } from './context/MultiSendContext';
import { StrictSwapRecoveryBootstrap } from './StrictSwapRecoveryBootstrap';
import { useStrictSwapRuntime } from './StrictSwapProvider';
import { TonConnectWalletService } from './tonconnect/wallet/TonConnectWalletService';
import type { TonConnectPendingRequest } from './tonconnect/wallet/TonConnectWalletService';
import { TonConnectWalletError } from './tonconnect/wallet/errors';
import { browserFetchManifestText } from './tonconnect/browser/fetchManifestText';
import { WalletService } from './services/WalletService';
import { isSameAddress } from './core/address';
import { walletDescriptorForAccountType } from './wallet/standardWalletDescriptor';
import type { WalletContractVersion } from './wallet/types';
import type { NftItem } from './nft/types';
import type { TonConnectLink, TonConnectManifest, TonConnectSessionDescriptor } from './tonconnect/wallet/types';
import { tonConnectErrorMessage } from './qr';
import { PasswordConfirmedTransactionExecutor } from './tonconnect/PasswordConfirmedTransactionExecutor';
import { TransferExecutor } from './transfer/TransferExecutor';
import { Cell } from '@ton/core';
import { sign } from '@ton/crypto';

export default function TonWallet() {
    // Context State
    const { isLoggedIn, transactions, walletAddress, sendTransaction, logout, isLoading, walletType, getDecryptedSeed, getPrivateKey, switchWalletType, tokens, totalBalanceUSDT, accounts, activeAccount, selectAccount, addAccount, renameAccount, deleteAccount, refreshData, network, setNetwork } = useWallet();
    const { openModal: openMultiSend } = useMultiSend();
    const strictSwapRuntime = useStrictSwapRuntime();

    // UI State
    const [activeTab, setActiveTab] = useState('home');
    const [copied, setCopied] = useState(false);
    const [showSendModal, setShowSendModal] = useState(false);
    const [showReceiveModal, setShowReceiveModal] = useState(false);
    const [showSwapModal, setShowSwapModal] = useState(false);
    const [activityFilter, setActivityFilter] = useState('all');
    const [darkMode, setDarkMode] = useState(false);
    const [notifications, setNotifications] = useState(true);
    const [language, setLanguage] = useState('en');
    const [showBackupModal, setShowBackupModal] = useState(false);
    const [showPhraseModal, setShowPhraseModal] = useState(false);
    const [copiedPhrase, setCopiedPhrase] = useState(false);
    const [selectedTransaction, setSelectedTransaction] = useState<any>(null);

    // Transaction & Security Flow State
    const [showPasswordModal, setShowPasswordModal] = useState(false);
    const [passwordAction, setPasswordAction] = useState<'transaction' | 'viewSeed' | 'switchType' | 'viewPrivateKey' | null>(null);
    const [pendingTx, setPendingTx] = useState<{ recipient: string; amount: string; comment?: string; token?: any } | null>(null);
    const [txError, setTxError] = useState('');
    const [decryptedSeed, setDecryptedSeed] = useState<string[]>([]);
    const [isSeedLoading, setIsSeedLoading] = useState(false);

    // Accounts
    const [showAccountsModal, setShowAccountsModal] = useState(false);
    const [showAddAccountModal, setShowAddAccountModal] = useState(false);

    const [showWalletTypeModal, setShowWalletTypeModal] = useState(false);
    const [pendingWalletType, setPendingWalletType] = useState('');

    // Token Details
    const [selectedToken, setSelectedToken] = useState<any>(null);
    const [showTokenModal, setShowTokenModal] = useState(false);
    const [showPrivateKeyModal, setShowPrivateKeyModal] = useState(false);
    const [privateKey, setPrivateKey] = useState('');

    // ── Link Wallet ──────────────────────────────────────────────────────────
    const [showLinkModal, setShowLinkModal] = useState(false);

    // ── TON Connect ──────────────────────────────────────────────────────────
    const tcServiceRef = useRef<TonConnectWalletService | null>(null);
    const walletServiceRef = useRef(new WalletService());
    const [pendingTcRequest, setPendingTcRequest] = useState<TonConnectPendingRequest | null>(null);
    const [showTcModal, setShowTcModal] = useState(false);
    const [pendingConnectLink, setPendingConnectLink] = useState<TonConnectLink | null>(null);
    const [connectManifest, setConnectManifest] = useState<TonConnectManifest | null>(null);
    const [connectManifestLoading, setConnectManifestLoading] = useState(false);
    const [connectError, setConnectError] = useState<string | null>(null);
    const [connectConnecting, setConnectConnecting] = useState(false);
    const [showConnectModal, setShowConnectModal] = useState(false);
    const [showConnectedApps, setShowConnectedApps] = useState(false);
    const [connectedSessions, setConnectedSessions] = useState<readonly TonConnectSessionDescriptor[]>([]);
    const [connectedAppsLoading, setConnectedAppsLoading] = useState(false);

    // Initialize TC service whenever network changes
    useEffect(() => {
        const svc = new TonConnectWalletService({
            network,
            manifestTextFetcher: browserFetchManifestText,
        });
        svc.setRequestHandler((pending) => {
            setPendingTcRequest(pending);
            setShowTcModal(true);
        });
        tcServiceRef.current = svc;
        setConnectedSessions([]);
    }, [network]);

    // Restore persisted TON Connect sessions for the active account
    useEffect(() => {
        const svc = tcServiceRef.current;
        const accountId = activeAccount?.id;
        if (!svc || !accountId || !isLoggedIn) {
            setConnectedSessions([]);
            return;
        }
        let cancelled = false;
        void svc.restoreSessionsForAccount(accountId).then((sessions) => {
            if (!cancelled) setConnectedSessions(sessions);
        }).catch(() => {
            if (!cancelled) setConnectedSessions(svc.getSessionsForAccount(accountId));
        });
        return () => { cancelled = true; };
    }, [activeAccount?.id, isLoggedIn, network]);

    const refreshConnectedSessions = useCallback(() => {
        const svc = tcServiceRef.current;
        const accountId = activeAccount?.id;
        if (!svc || !accountId) {
            setConnectedSessions([]);
            return;
        }
        setConnectedSessions(svc.getSessionsForAccount(accountId));
    }, [activeAccount?.id]);

    const openConnectedApps = useCallback(() => {
        const svc = tcServiceRef.current;
        const accountId = activeAccount?.id;
        setShowConnectedApps(true);
        if (!svc || !accountId) {
            setConnectedSessions([]);
            return;
        }
        setConnectedAppsLoading(true);
        void svc.restoreSessionsForAccount(accountId)
            .then((sessions) => setConnectedSessions(sessions))
            .catch(() => setConnectedSessions(svc.getSessionsForAccount(accountId)))
            .finally(() => setConnectedAppsLoading(false));
    }, [activeAccount?.id]);

    const handleDisconnectApp = useCallback(async (walletClientId: string) => {
        const svc = tcServiceRef.current;
        if (!svc) return;
        await svc.disconnectSession(walletClientId);
        refreshConnectedSessions();
    }, [refreshConnectedSessions]);

    const handleNftSend = useCallback(async ({ item, recipient, comment, password }: {
        item: NftItem;
        recipient: string;
        comment: string;
        password: string;
    }) => {
        if (strictSwapRuntime.status !== 'ready' || !activeAccount) {
            throw new Error('Secure runtime not available');
        }
        const executor = new TransferExecutor({
            network,
            decryptor: {
                decrypt: async (_enc: unknown, pw: string) => {
                    return (await getDecryptedSeed(pw)).join(' ');
                },
            },
            walletCoordinatorFactory: strictSwapRuntime.graph.walletCoordinatorFactory,
            signerClock: () => Math.floor(Date.now() / 1000),
        });

        await executor.send({
            kind: 'nft',
            network,
            nftAddress: item.address,
            recipient,
            responseDestination: activeAccount.address,
            forwardAmount: 50_000_000n,
            attachedTon: 70_000_000n,
            forwardPayload: comment || '',
            purpose: `Transfer NFT ${item.metadata?.name || 'NFT'}`,
        } as any, {
            address: activeAccount.address,
            wallet: walletDescriptorForAccountType(
                activeAccount.type as WalletContractVersion,
                activeAccount.address,
            ),
            encryptedMnemonic: activeAccount.encryptedSeed as any,
        } as any, password);
    }, [activeAccount, getDecryptedSeed, network, strictSwapRuntime]);

    // Handle a validated TON Connect link from scan, upload, or paste
    const handleTonConnectLinkDecoded = useCallback((link: TonConnectLink) => {
        const svc = tcServiceRef.current;
        if (!svc || !activeAccount) return;

        setPendingConnectLink(link);
        setConnectManifest(null);
        setConnectError(null);
        setConnectManifestLoading(true);
        setShowConnectModal(true);

        void svc.previewConnectLink(link)
            .then((manifest) => {
                setConnectManifest(manifest);
                setConnectError(null);
            })
            .catch((err: unknown) => {
                setConnectError(tonConnectErrorMessage(err, language));
            })
            .finally(() => {
                setConnectManifestLoading(false);
            });
    }, [activeAccount, language]);

    const handleTonConnectApproved = useCallback(async (password: string) => {
        const link = pendingConnectLink;
        const svc = tcServiceRef.current;
        if (!link || !svc || !walletAddress || !activeAccount) return;

        setConnectConnecting(true);
        setConnectError(null);

        let secretKey: Buffer | null = null;
        try {
            const mnemonic = await getDecryptedSeed(password);
            const walletVersion = activeAccount.type as WalletContractVersion;
            const imported = await walletServiceRef.current.importWallet(
                mnemonic,
                walletVersion,
                network === 'testnet',
            );
            if (!isSameAddress(imported.address, activeAccount.address)) {
                throw new TonConnectWalletError(
                    'INVALID_SESSION',
                    'The active account does not match the selected wallet version. Change wallet type in Settings, then connect again.',
                );
            }

            const resolvedAddress = imported.address;
            const keyPair = imported.keyPair;
            secretKey = keyPair.secretKey;

            svc.clearSessionsForAccount(activeAccount.id);

            const walletDesc = walletDescriptorForAccountType(walletVersion, resolvedAddress);

            const proofAuthority = {
                walletAddress: resolvedAddress,
                sign: async (hash: Uint8Array) => {
                    const signature = sign(Buffer.from(hash), keyPair.secretKey);
                    return new Uint8Array(signature);
                },
            };

            await svc.handleConnectLink(
                link,
                activeAccount.id,
                resolvedAddress,
                walletDesc,
                keyPair.publicKey,
                proofAuthority,
            );

            setShowConnectModal(false);
            setPendingConnectLink(null);
            setConnectManifest(null);
            setConnectError(null);
            refreshConnectedSessions();
        } catch (err: unknown) {
            setConnectError(tonConnectErrorMessage(err, language));
        } finally {
            secretKey?.fill(0);
            setConnectConnecting(false);
        }
    }, [activeAccount, getDecryptedSeed, language, network, pendingConnectLink, refreshConnectedSessions, walletAddress]);

    const handleConnectModalClose = useCallback(() => {
        setShowConnectModal(false);
        setPendingConnectLink(null);
        setConnectManifest(null);
        setConnectError(null);
        setConnectManifestLoading(false);
        setConnectConnecting(false);
    }, []);

    const handleCopy = () => {
        // Actually copy the wallet address to clipboard
        if (walletAddress) {
            navigator.clipboard.writeText(walletAddress);
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleCopyPhrase = () => {
        // Actually copy the seed phrase to clipboard
        if (decryptedSeed.length > 0) {
            navigator.clipboard.writeText(decryptedSeed.join(' '));
        }
        setCopiedPhrase(true);
        setTimeout(() => setCopiedPhrase(false), 2000);
    };

    // Send Logic
    const handleSendInitiated = (to: string, amt: string, comment?: string, token?: any) => {
        setPendingTx({ recipient: to, amount: amt, comment: comment, token: token });
        setShowSendModal(false);
        setPasswordAction('transaction');
        setShowPasswordModal(true);
    };

    // Wallet Type Logic
    const handleWalletTypeSelect = (type: string) => {
        if (type === walletType) {
            setShowWalletTypeModal(false);
            return;
        }
        setPendingWalletType(type);
        setShowWalletTypeModal(false);
        setPasswordAction('switchType');
        setShowPasswordModal(true);
    };

    // View Seed Logic
    const handleViewSeedInitiated = () => {
        setDecryptedSeed([]);
        setPasswordAction('viewSeed');
        setShowPasswordModal(true);
    };

    const handleViewPrivateKeyInitiated = () => {
        setPrivateKey('');
        setPasswordAction('viewPrivateKey');
        setShowPasswordModal(true);
    };

    const handlePasswordConfirm = async (password: string) => {
        setTxError('');

        if (passwordAction === 'transaction') {
            if (!pendingTx) return;
            try {
                await sendTransaction(pendingTx.recipient, pendingTx.amount, password, pendingTx.comment, pendingTx.token);
                setShowPasswordModal(false);
                setPendingTx(null);
                setPasswordAction(null);
                alert('Transaction Sent!');
            } catch (e: any) {
                setTxError(e.message || 'Transaction failed');
            }
        } else if (passwordAction === 'viewSeed') {
            setIsSeedLoading(true);
            try {
                const seed = await getDecryptedSeed(password);
                setDecryptedSeed(seed);
                setShowPasswordModal(false);
                setPasswordAction(null);
                setShowPhraseModal(true);
            } catch (e: any) {
                // If invalid password, keep modal open and show error
                setTxError(e.message || 'Invalid password');
                // Do NOT close modal
            } finally {
                setIsSeedLoading(false);
            }
        } else if (passwordAction === 'viewPrivateKey') {
            setIsSeedLoading(true);
            try {
                const pk = await getPrivateKey(password);
                setPrivateKey(pk);
                setShowPasswordModal(false);
                setPasswordAction(null);
                setShowPrivateKeyModal(true);
            } catch (e: any) {
                setTxError(e.message || 'Invalid password');
            } finally {
                setIsSeedLoading(false);
            }
        } else if (passwordAction === 'switchType') {
            setIsSeedLoading(true); // Reuse loading state
            try {
                await switchWalletType(pendingWalletType, password);
                tcServiceRef.current?.clearSessionsForAccount(activeAccount?.id ?? '');
                setShowPasswordModal(false);
                setPasswordAction(null);
                alert(`Switched to ${pendingWalletType}`);
            } catch (e: any) {
                setTxError(e.message || 'Failed to switch wallet type');
            } finally {
                setIsSeedLoading(false);
            }
        }
    };



    if (!isLoggedIn) {
        return <LoginScreen darkMode={darkMode} />;
    }

    return (
        <div className={`min-h-screen ${darkMode ? 'dark bg-[hsl(224,20%,5%)]' : 'bg-gradient-to-br from-slate-50 via-blue-50/40 to-indigo-50/30'} p-4 flex items-center justify-center`} dir={language === 'ar' ? 'rtl' : 'ltr'}>
            {activeAccount?.address && walletAddress && (
                <StrictSwapRecoveryBootstrap
                    runtime={strictSwapRuntime}
                    accountId={activeAccount.id}
                    accountAddress={activeAccount.address}
                    walletAddress={walletAddress}
                />
            )}
            {/* Network Status Banner */}
            <NetworkBanner darkMode={darkMode} network={network} />

            <div
                data-wallet-shell
                className={`w-full max-w-md ${darkMode ? 'bg-[hsl(228,18%,7%)] ring-1 ring-white/[0.06] shadow-[0_0_60px_-15px_rgba(0,0,0,0.5)]' : 'bg-white/80 backdrop-blur-xl ring-1 ring-black/[0.08] shadow-2xl'} rounded-3xl overflow-hidden flex flex-col h-[85vh] relative`}
            >
                <WalletHeader
                    darkMode={darkMode}
                    language={language}
                    walletType={walletType}
                    activeTab={activeTab}
                    totalBalance={totalBalanceUSDT}
                    walletAddress={walletAddress || ''}
                    copied={copied}
                    handleCopy={handleCopy}
                    accountName={activeAccount?.name || 'My Wallet'}
                    onAccountsClick={() => setShowAccountsModal(true)}
                />

                <div className="flex-1 overflow-y-auto no-scrollbar relative pb-10">
                    {activeTab === 'home' && (
                        <HomeTab
                            darkMode={darkMode}
                            language={language}
                            setShowSendModal={setShowSendModal}
                            setShowReceiveModal={setShowReceiveModal}
                            setShowSwapModal={setShowSwapModal}
                            onMultiSendClick={openMultiSend}
                            onScanQr={() => setShowLinkModal(true)}
                            tokens={tokens}
                            onTokenClick={(token) => {
                                setSelectedToken(token);
                                setShowTokenModal(true);
                            }}
                        />
                    )}

                    {activeTab === 'activity' && (
                        <ActivityTab
                            darkMode={darkMode}
                            language={language}
                            activityFilter={activityFilter}
                            setActivityFilter={setActivityFilter}
                            activities={transactions}
                            setSelectedTransaction={setSelectedTransaction}
                        />
                    )}

                    {activeTab === 'collectibles' && (
                        <NftTab
                            darkMode={darkMode}
                            language={language}
                            walletAddress={walletAddress ?? ''}
                            network={network}
                            onRequestFetch={async (address, signal) => {
                                const { NftService } = await import('./nft/NftService');
                                const svc = new NftService({ network });
                                return svc.fetchAll(address, { signal });
                            }}
                            onSendNft={handleNftSend}
                        />
                    )}

                    {activeTab === 'settings' && (
                        <SettingsTab
                            darkMode={darkMode}
                            setDarkMode={setDarkMode}
                            language={language}
                            setLanguage={setLanguage}
                            walletType={walletType}
                            notifications={notifications}
                            setNotifications={setNotifications}
                            setShowBackupModal={setShowBackupModal}
                            setShowPhraseModal={handleViewSeedInitiated}
                            onLogout={() => {
                                logout();
                                setActiveTab('home');
                            }}
                            onWalletTypeClick={() => setShowWalletTypeModal(true)}
                            onConnectedAppsClick={openConnectedApps}
                            connectedAppsCount={connectedSessions.length}
                            network={network}
                            onNetworkChange={setNetwork}
                        />
                    )}
                </div>

                <BottomNavigation
                    darkMode={darkMode}
                    activeTab={activeTab}
                    setActiveTab={setActiveTab}
                    language={language}
                />

                <SendModal
                    isOpen={showSendModal}
                    onClose={() => setShowSendModal(false)}
                    darkMode={darkMode}
                    language={language}
                    onSend={handleSendInitiated}
                    tokens={tokens}
                    walletAddress={walletAddress || ''}
                />
                <ReceiveModal
                    isOpen={showReceiveModal}
                    onClose={() => setShowReceiveModal(false)}
                    darkMode={darkMode}
                    language={language}
                    walletAddress={walletAddress || ''}
                    handleCopy={handleCopy}
                    copied={copied}
                />
                <SwapModal
                    isOpen={showSwapModal}
                    onClose={() => setShowSwapModal(false)}
                    darkMode={darkMode}
                    language={language}
                    walletAddress={walletAddress || ''}
                    walletType={walletType}
                    accountId={activeAccount?.id ?? null}
                    activeAccount={activeAccount as unknown}
                    tokens={tokens}
                    onTerminalRefresh={refreshData}
                    appNetwork={network}
                />
                <BackupModal
                    isOpen={showBackupModal}
                    onClose={() => setShowBackupModal(false)}
                    darkMode={darkMode}
                    language={language}
                    onShowPhrase={() => {
                        setShowBackupModal(false);
                        handleViewSeedInitiated();
                    }}
                    onShowPrivateKey={() => {
                        setShowBackupModal(false);
                        handleViewPrivateKeyInitiated();
                    }}
                />
                <PhraseModal
                    isOpen={showPhraseModal}
                    onClose={() => setShowPhraseModal(false)}
                    darkMode={darkMode}
                    language={language}
                    seedPhrase={decryptedSeed.length > 0 ? decryptedSeed : ["Loading..."]}
                    handleCopyPhrase={handleCopyPhrase}
                    copiedPhrase={copiedPhrase}
                />
                <TransactionModal
                    transaction={selectedTransaction}
                    onClose={() => setSelectedTransaction(null)}
                    darkMode={darkMode}
                    language={language}
                />
                <PrivateKeyModal
                    isOpen={showPrivateKeyModal}
                    onClose={() => setShowPrivateKeyModal(false)}
                    darkMode={darkMode}
                    language={language}
                    privateKey={privateKey}
                />
                <PasswordPromptModal
                    isOpen={showPasswordModal}
                    onClose={() => setShowPasswordModal(false)}
                    error={txError}
                    onConfirm={handlePasswordConfirm}
                    darkMode={darkMode}
                    language={language}
                    isLoading={isLoading || isSeedLoading}
                />
                <SelectWalletTypeModal
                    isOpen={showWalletTypeModal}
                    onClose={() => setShowWalletTypeModal(false)}
                    currentType={walletType}
                    onSelect={handleWalletTypeSelect}
                    darkMode={darkMode}
                    language={language}
                />
                <TokenDetailsModal
                    isOpen={showTokenModal}
                    onClose={() => setShowTokenModal(false)}
                    token={selectedToken}
                    transactions={transactions}
                    darkMode={darkMode}
                    language={language}
                    onSend={() => setShowSendModal(true)}
                    onReceive={() => setShowReceiveModal(true)}
                />
                {/* Account Modals */}
                <AccountsModal
                    isOpen={showAccountsModal}
                    onClose={() => setShowAccountsModal(false)}
                    accounts={accounts}
                    activeAccount={activeAccount}
                    onSelectAccount={(id) => {
                        selectAccount(id);
                        setShowAccountsModal(false);
                    }}
                    onAddAccount={() => {
                        setShowAccountsModal(false);
                        setShowAddAccountModal(true);
                    }}
                    onDeleteAccount={deleteAccount}
                    onRenameAccount={renameAccount}
                    darkMode={darkMode}
                    language={language}
                />
                <AddAccountModal
                    isOpen={showAddAccountModal}
                    onClose={() => setShowAddAccountModal(false)}
                    onAdd={async (name, password, mnemonic) => {
                        await addAccount(name, mnemonic || [], password);
                    }}
                    darkMode={darkMode}
                    language={language}
                />
                {/* Multi-Send Modal */}
                <MultiSendModal darkMode={darkMode} language={language} />

                {/* ── Link Wallet Modal ────────────────────────────────────── */}
                <LinkWalletModal
                    isOpen={showLinkModal}
                    onClose={() => setShowLinkModal(false)}
                    network={network}
                    onTonConnect={handleTonConnectLinkDecoded}
                    onTransfer={(address, amount, comment) => {
                        setShowLinkModal(false);
                        setShowSendModal(true);
                        console.info('[QR] Transfer to', address, amount, comment);
                    }}
                    onAddress={(address) => {
                        setShowLinkModal(false);
                        setShowSendModal(true);
                        console.info('[QR] Address', address);
                    }}
                    darkMode={darkMode}
                    language={language}
                />

                {/* ── TON Connect Connection Approval ────────────────────── */}
                <TonConnectConnectModal
                    isOpen={showConnectModal}
                    link={pendingConnectLink}
                    manifest={connectManifest}
                    walletLabel={activeAccount?.name ?? walletAddress ?? ''}
                    loading={connectManifestLoading}
                    connecting={connectConnecting}
                    error={connectError}
                    darkMode={darkMode}
                    language={language}
                    onClose={handleConnectModalClose}
                    onConnect={handleTonConnectApproved}
                    onReject={handleConnectModalClose}
                />

                <ConnectedAppsModal
                    isOpen={showConnectedApps}
                    sessions={connectedSessions}
                    loading={connectedAppsLoading}
                    darkMode={darkMode}
                    language={language}
                    onClose={() => setShowConnectedApps(false)}
                    onDisconnect={handleDisconnectApp}
                />

                {/* ── TON Connect Request Modal ────────────────────────────── */}
                <TonConnectRequestModal
                    isOpen={showTcModal}
                    pending={pendingTcRequest}
                    onClose={() => { setShowTcModal(false); setPendingTcRequest(null); }}
                    darkMode={darkMode}
                    language={language}
                    onApprove={async (pending, password) => {
                        const first = pending.request.params[0];
                        if (!first) return undefined;

                        const parsed = JSON.parse(first) as { messages?: Array<{ address: string; amount: string; payload?: string; stateInit?: string }>; valid_until?: number };
                        const msgs = parsed.messages ?? [];

                        if (strictSwapRuntime.status !== 'ready') {
                            throw new Error("Secure runtime not available");
                        }

                        const graph = strictSwapRuntime.status === 'ready' ? strictSwapRuntime.graph : ({} as any);

                        // Fake a decryptor using the app's standard password-based key service
                        // We extract this from useWallet's decrypted seed logic
                        const executor = new PasswordConfirmedTransactionExecutor({
                            network,
                            decryptor: {
                                decrypt: async (enc: any, pw: string) => {
                                    // Hack: use the legacy decryption via useWallet indirectly or provide a stub
                                    // In a real app we'd inject the SecurityService directly.
                                    return (await getDecryptedSeed(pw)).join(' ');
                                }
                            },
                            walletCoordinatorFactory: graph.walletCoordinatorFactory,
                            signerClock: () => Math.floor(Date.now() / 1000)
                        });

                        const res = await executor.execute({
                            transaction: {
                                network,
                                wallet: pending.session.walletDescriptor,
                                messages: msgs.map(msg => ({
                                    to: msg.address,
                                    value: BigInt(msg.amount),
                                    bounce: true,
                                    purpose: 'TON Connect Transaction',
                                    body: msg.payload ? Cell.fromBase64(msg.payload) : undefined
                                })),
                                validUntilUnix: parsed.valid_until ?? (Math.floor(Date.now() / 1000) + 300),
                                correlationId: crypto.randomUUID(),
                            },
                            account: {
                                address: pending.session.accountAddress,
                                wallet: activeAccount!.type === 'highload-v3' ? {
                                    kind: 'highload-v3',
                                    version: 'highload-v3',
                                    address: activeAccount!.address,
                                    subwalletId: 4269,
                                    timeoutSeconds: 300,
                                } : {
                                    kind: 'standard',
                                    version: activeAccount!.type as any,
                                    address: activeAccount!.address,
                                    subwalletId: 698983191,
                                } as any,
                                encryptedMnemonic: activeAccount!.encryptedSeed as any,
                            },
                            password
                        });

                        return res.txHash ?? undefined;
                    }}
                />
            </div>
        </div>
    );
}