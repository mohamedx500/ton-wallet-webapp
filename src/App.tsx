import React, { useState } from 'react';
import { useWallet } from './context/WalletContext';
import LoginScreen from './components/LoginScreen';
import WalletHeader from './components/WalletHeader';
import BottomNavigation from './components/BottomNavigation';
import HomeTab from './components/HomeTab';
import ActivityTab from './components/ActivityTab';
import SettingsTab from './components/SettingsTab';
import { SendModal, ReceiveModal, BuyModal, BackupModal, PhraseModal, TransactionModal, PasswordPromptModal, SelectWalletTypeModal, TokenDetailsModal, PrivateKeyModal, SwapModal } from './components/WalletModals';
import { AccountsModal, AddAccountModal } from './components/AccountModals';
import NetworkBanner from './components/NetworkBanner';


export default function TonWallet() {
    // Context State
    const { isLoggedIn, balance, transactions, walletAddress, sendTransaction, logout, isLoading, walletType, getDecryptedSeed, getPrivateKey, switchWalletType, tokens, totalBalanceUSDT, accounts, activeAccount, selectAccount, addAccount, renameAccount, deleteAccount } = useWallet();

    // UI State
    const [activeTab, setActiveTab] = useState('home');
    const [copied, setCopied] = useState(false);
    const [showSendModal, setShowSendModal] = useState(false);
    const [showReceiveModal, setShowReceiveModal] = useState(false);
    const [showBuyModal, setShowBuyModal] = useState(false);
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
    const [passwordAction, setPasswordAction] = useState<'transaction' | 'viewSeed' | 'switchType' | 'viewPrivateKey' | 'swap' | null>(null);
    const [pendingTx, setPendingTx] = useState<{ recipient: string; amount: string; comment?: string } | null>(null);
    const [pendingSwap, setPendingSwap] = useState<{ fromToken: string; toToken: string; amount: string; minOutput: string; provider: string; quote: any } | null>(null);
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
        // We can ignore token for now or pass it to pendingTx if we want to handle jettons later in context
        setPendingTx({ recipient: to, amount: amt, comment: comment });
        setShowSendModal(false);
        setPasswordAction('transaction');
        setShowPasswordModal(true);
    };

    // Swap Logic
    const handleSwapInitiated = (swapData: any) => {
        setPendingSwap(swapData);
        setShowSwapModal(false);
        setPasswordAction('swap');
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
                await sendTransaction(pendingTx.recipient, pendingTx.amount, password, pendingTx.comment);
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
                setShowPasswordModal(false);
                setPasswordAction(null);
                alert(`Switched to ${pendingWalletType}`);
            } catch (e: any) {
                setTxError(e.message || 'Failed to switch wallet type');
            } finally {
                setIsSeedLoading(false);
            }
        } else if (passwordAction === 'swap') {
            if (!pendingSwap) return;
            setIsSeedLoading(true);
            try {
                // Import swapService
                const { swapService } = await import('./services/SwapService.js');

                // Build swap transaction
                let swapTx: any;
                if (pendingSwap.provider === 'stonfi') {
                    swapTx = await swapService.buildStonfiSwapTransaction(
                        walletAddress,
                        pendingSwap.fromToken,
                        pendingSwap.toToken,
                        pendingSwap.amount,
                        pendingSwap.minOutput
                    );
                } else {
                    swapTx = await swapService.buildDedustSwapTransaction(
                        walletAddress,
                        pendingSwap.fromToken,
                        pendingSwap.toToken,
                        pendingSwap.amount,
                        pendingSwap.minOutput,
                        pendingSwap.quote?.poolAddress
                    );
                }

                // Execute the swap
                if (swapTx && swapTx.type === 'jetton_transfer') {
                    // For Jetton swaps, we need to use sendJettonTransfer
                    // This is more complex - for now show info
                    const swapInfo = `${pendingSwap.amount} ${pendingSwap.fromToken} → ${pendingSwap.quote.outputAmount} ${pendingSwap.toToken}`;
                    alert(`Jetton-to-Jetton/TON swaps require additional implementation.\n\n${swapInfo}\nProvider: ${pendingSwap.provider === 'stonfi' ? 'STON.fi' : 'DeDust'}`);
                } else if (swapTx && swapTx.to && swapTx.value) {
                    // TON -> Jetton swap - send TON to router
                    // Convert nanoTON string to TON with proper decimal handling
                    const valueInNano = BigInt(swapTx.value);
                    const wholeTon = valueInNano / BigInt(1e9);
                    const remainder = valueInNano % BigInt(1e9);
                    const decimalPart = remainder.toString().padStart(9, '0');
                    const amountInTon = `${wholeTon}.${decimalPart}`.replace(/\.?0+$/, '') || '0';

                    console.log('Swap transaction:', { to: swapTx.to, value: swapTx.value, amountInTon });

                    if (parseFloat(amountInTon) <= 0) {
                        throw new Error('Invalid swap amount');
                    }

                    await sendTransaction(swapTx.to, amountInTon, password, '');

                    alert(`Swap initiated!\n\n${pendingSwap.amount} ${pendingSwap.fromToken} → ${pendingSwap.quote.outputAmount} ${pendingSwap.toToken}\n\nPlease check your transaction history in a few minutes.`);
                } else {
                    throw new Error('Failed to build swap transaction');
                }

                setShowPasswordModal(false);
                setPendingSwap(null);
                setPasswordAction(null);
            } catch (e: any) {
                setTxError(e.message || 'Swap failed');
            } finally {
                setIsSeedLoading(false);
            }
        }
    };



    if (!isLoggedIn) {
        return <LoginScreen darkMode={darkMode} />;
    }

    return (
        <div className={`min-h-screen ${darkMode ? 'bg-black' : 'bg-gradient-to-br from-blue-50 to-indigo-50'} p-4 flex items-center justify-center`} dir={language === 'ar' ? 'rtl' : 'ltr'}>
            {/* Network Status Banner */}
            <NetworkBanner darkMode={darkMode} />

            <div className={`w-full max-w-md ${darkMode ? 'bg-gray-950' : 'bg-white'} rounded-3xl shadow-2xl overflow-hidden flex flex-col h-[85vh] relative`}>

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
                            setShowBuyModal={setShowBuyModal}
                            setShowSwapModal={setShowSwapModal}
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
                <BuyModal
                    isOpen={showBuyModal}
                    onClose={() => setShowBuyModal(false)}
                    darkMode={darkMode}
                    language={language}
                    walletAddress={walletAddress || ''}
                />
                <SwapModal
                    isOpen={showSwapModal}
                    onClose={() => setShowSwapModal(false)}
                    darkMode={darkMode}
                    language={language}
                    walletAddress={walletAddress || ''}
                    tokens={tokens}
                    onSwapInitiated={handleSwapInitiated}
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
            </div>
        </div>
    );
}