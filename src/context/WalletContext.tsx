import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
// @ts-ignore
import { WalletService } from '../services/WalletService';
// @ts-ignore
import { SecurityService } from '../services/SecurityService';
// @ts-ignore
import { TonApiService } from '../services/TonApiService';
import { AccountManager, WalletAccount } from '../services/AccountManager';

interface WalletContextType {
    isLoggedIn: boolean;
    hasPassword: boolean; // Computed from accounts existence, or specific active account
    walletAddress: string | null;
    balance: string;
    transactions: any[];
    isLoading: boolean;
    walletType: string;
    tokens: any[];
    totalBalanceUSDT: string;
    accounts: WalletAccount[];
    activeAccount: WalletAccount | null;

    // Actions
    createWallet: (password: string, mnemonic?: string[], name?: string) => Promise<string[]>; // Added name
    importWallet: (mnemonic: string[], password: string, name?: string) => Promise<void>; // Added name
    unlockWallet: (password: string) => Promise<boolean>;
    logout: () => void;
    sendTransaction: (recipient: string, amount: string, password: string, comment?: string) => Promise<any>;
    refreshData: () => Promise<void>;
    resetWallet: () => void;
    getDecryptedSeed: (password: string) => Promise<string[]>;
    getPrivateKey: (password: string) => Promise<string>;
    switchWalletType: (newType: string, password: string) => Promise<void>;

    // Multi-Account Actions
    selectAccount: (id: string) => void;
    addAccount: (name: string, mnemonic: string[], password: string) => Promise<void>;
    renameAccount: (id: string, name: string) => void;
    deleteAccount: (id: string) => void;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export function WalletProvider({ children }: { children: ReactNode }) {
    // Services
    const [walletService] = useState(() => new WalletService());
    const [securityService] = useState(() => new SecurityService());
    const [tonApiService] = useState(() => new TonApiService());
    const [accountManager] = useState(() => new AccountManager());

    // State
    const [accounts, setAccounts] = useState<WalletAccount[]>([]);
    const [activeAccount, setActiveAccount] = useState<WalletAccount | null>(null);

    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [walletAddress, setWalletAddress] = useState<string | null>(null);
    const [balance, setBalance] = useState('0.00');
    const [transactions, setTxs] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [walletType, setWalletType] = useState('v4r2'); // From active account
    const [tokens, setTokens] = useState<any[]>([]);
    const [totalBalanceUSDT, setTotalBalanceUSDT] = useState('0.00');

    // Init Accounts
    useEffect(() => {
        const loadAccounts = () => {
            const list = accountManager.getAccounts();
            setAccounts(list);
            const activeId = accountManager.getActiveAccountId();
            if (activeId) {
                const active = list.find(a => a.id === activeId);
                if (active) {
                    setActiveAccount(active);
                    setWalletType(active.type);
                    if (active.address) setWalletAddress(active.address);
                } else {
                    // If active ID invalid, pick first
                    if (list.length > 0) {
                        selectAccount(list[0].id);
                    }
                }
            } else if (list.length > 0) {
                selectAccount(list[0].id);
            }
        };
        loadAccounts();
    }, []);

    // Helper to refresh data
    const sendTransaction = async (recipient: string, amount: string, password: string, comment?: string) => {
        setIsLoading(true);
        try {
            if (!activeAccount) throw new Error('No active account');

            // Verify Password
            localStorage.setItem('wallet_password_hash', activeAccount.passwordHash);
            const isValid = await securityService.verifyPassword(password);
            if (!isValid) throw new Error('Invalid password');

            // Decrypt
            const seedStr = await securityService.decryptData(activeAccount.encryptedSeed, password);
            const mnemonic = seedStr.split(' ');

            // Send
            const res = await walletService.sendTransaction(mnemonic, activeAccount.type, recipient, amount, comment || '');

            setTimeout(refreshData, 5000);
            return res;
        } catch (e) {
            throw e;
        } finally {
            setIsLoading(false);
        }
    };

    const refreshData = async () => {
        if (!walletAddress) return;
        try {
            // 1. Get Rates
            const rates = await tonApiService.getRates();
            const tonPrice = rates.ton.price;
            const tonDiff = rates.ton.diff;
            const usdtPrice = rates.usdt.price;
            const usdtDiff = rates.usdt.diff;

            // 2. Get TON Balance
            const balNano = await tonApiService.getBalance(walletAddress);
            const balTon = balNano / 1e9;
            setBalance(balTon.toFixed(2));

            // 3. Get Jettons
            const jettons = await tonApiService.getJettons(walletAddress);

            // 4. Build Tokens List
            const tokenList: any[] = [];

            // Add TON
            tokenList.push({
                name: 'Toncoin',
                symbol: 'TON',
                balance: balTon.toFixed(2),
                value: `$${(balTon * tonPrice).toFixed(2)}`,
                icon: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ton/info/logo.png',
                price: tonPrice,
                diff: tonDiff,
                rawBalance: balTon
            });

            // Add USDT/Others
            let totalUsd = balTon * tonPrice;

            jettons.forEach((j: any) => {
                const amount = j.balance / Math.pow(10, j.jetton.decimals);
                const symbol = j.jetton.symbol;
                const price = symbol === 'USDT' ? usdtPrice : 0;
                const val = amount * price;

                totalUsd += val;

                tokenList.push({
                    name: j.jetton.name,
                    symbol: symbol,
                    balance: amount.toFixed(2),
                    value: `$${val.toFixed(2)}`,
                    icon: j.jetton.image,
                    price: price,
                    diff: symbol === 'USDT' ? usdtDiff : '0.00%',
                    rawBalance: amount
                });
            });

            // If USDT not found
            if (!tokenList.find(t => t.symbol === 'USDT')) {
                tokenList.push({
                    name: 'USD Tether',
                    symbol: 'USDT',
                    balance: '0.00',
                    value: '$0.00',
                    icon: 'https://tether.to/images/logoCircle.png',
                    price: usdtPrice,
                    diff: usdtDiff,
                    rawBalance: 0
                });
            }

            setTokens(tokenList);
            setTotalBalanceUSDT(totalUsd.toFixed(2));

            // 5. Get Transactions
            const txs = await tonApiService.getTransactions(walletAddress);
            const formattedTxs = txs.map((tx: any) => ({
                ...tx,
                type: tx.type || (tx.in_msg?.destination === walletAddress ? 'received' : 'sent'),
                amount: tx.amount || (tx.in_msg?.value ? (tx.in_msg.value / 1e9).toFixed(2) : '0.00'),
                token: tx.token || 'TON',
                time: tx.time || new Date(tx.utime * 1000).toLocaleString(),
                status: 'completed'
            }));

            setTxs(formattedTxs);
        } catch (e) {
            console.error(e);
        }
    };

    // Periodical Refresh
    useEffect(() => {
        if (isLoggedIn && walletAddress) {
            refreshData();
            const interval = setInterval(refreshData, 10000);
            return () => clearInterval(interval);
        }
    }, [isLoggedIn, walletAddress]);

    // Actions

    const selectAccount = (id: string) => {
        const account = accountManager.getAccount(id);
        if (account) {
            accountManager.setActiveAccountId(id);
            setActiveAccount(account);
            setWalletType(account.type);
            // Don't lock session when switching - allow seamless switching
            // Just update the address and refresh data
            setWalletAddress(account.address || null);
            setBalance('0.00');
            setTxs([]);
            setTokens([]);
            // Keep logged in if already logged in
            // Data will refresh automatically via useEffect
        }
    };

    // Legacy support: createWallet acts as "Add active account" if none, or new one
    // We'll update usage to "Create/Add Account"
    const createWallet = async (password: string, existingMnemonic?: string[], name: string = 'My Wallet') => {
        setIsLoading(true);
        try {
            const mnemonic = existingMnemonic || await walletService.generateMnemonic();
            await addAccount(name, mnemonic, password);
            return mnemonic;
        } catch (e) {
            console.error(e);
            throw e;
        } finally {
            setIsLoading(false);
        }
    };

    const importWallet = async (mnemonic: string[], password: string, name: string = 'Imported Wallet') => {
        await addAccount(name, mnemonic, password);
    };

    const addAccount = async (name: string, mnemonic: string[], password: string) => {
        setIsLoading(true);
        try {
            // Generate new mnemonic if not provided
            const actualMnemonic = mnemonic.length > 0 ? mnemonic : await walletService.generateMnemonic();

            // Setup password and get security data (hash + salt)
            await securityService.setupPassword(password);
            const securityData = securityService.getSecurityData();

            // Encrypt seed
            const seedStr = actualMnemonic.join(' ');
            const encrypted = await securityService.encryptData(seedStr, password);

            // Get Address
            const wallet = await walletService.importWallet(actualMnemonic, 'v4r2');

            // Add to Manager - store full security data (hash + salt)
            const newAccount = accountManager.addAccount({
                name,
                type: 'v4r2',
                encryptedSeed: encrypted,
                passwordHash: JSON.stringify(securityData), // Store full security data
                address: wallet.address
            });

            // Refresh list
            setAccounts(accountManager.getAccounts());

            // Select it
            selectAccount(newAccount.id);

            // Auto Login
            setIsLoggedIn(true);
            setWalletAddress(wallet.address);
        } catch (e) {
            throw e;
        } finally {
            setIsLoading(false);
        }
    };

    const unlockWallet = async (password: string) => {
        setIsLoading(true);
        try {
            if (!activeAccount) throw new Error('No active account');

            // Verify password by attempting to decrypt the seed
            // If decryption succeeds, password is correct
            let seedStr: string;
            try {
                seedStr = await securityService.decryptData(activeAccount.encryptedSeed, password);
            } catch (e) {
                // Decryption failed = wrong password
                return false;
            }

            const mnemonic = seedStr.split(' ');

            // Validate that we got a proper mnemonic (24 words)
            if (mnemonic.length !== 24) {
                return false;
            }

            const type = activeAccount.type;
            const wallet = await walletService.importWallet(mnemonic, type);
            setWalletAddress(wallet.address);

            // Update address in storage if missing
            if (!activeAccount.address) {
                accountManager.updateAccount(activeAccount.id, { address: wallet.address });
                setAccounts(accountManager.getAccounts());
            }

            setIsLoggedIn(true);
            return true;
        } catch (e) {
            return false;
        } finally {
            setIsLoading(false);
        }
    };

    const getDecryptedSeed = async (password: string) => {
        if (!activeAccount) throw new Error('No active account');
        setIsLoading(true);
        try {
            // Verify by attempting decryption - will throw if password wrong
            const seedStr = await securityService.decryptData(activeAccount.encryptedSeed, password);
            const mnemonic = seedStr.split(' ');

            if (mnemonic.length !== 24) {
                throw new Error('Invalid password');
            }

            return mnemonic;
        } catch (e) {
            throw new Error('Invalid password');
        } finally {
            setIsLoading(false);
        }
    };

    const getPrivateKey = async (password: string) => {
        // Reuse getDecryptedSeed logic
        const mnemonic = await getDecryptedSeed(password);
        return await walletService.getPrivateKey(mnemonic);
    };

    const switchWalletType = async (newType: string, password: string) => {
        if (!activeAccount) return;
        setIsLoading(true);
        try {
            const mnemonic = await getDecryptedSeed(password); // Verifies pwd

            // Re-import
            const wallet = await walletService.importWallet(mnemonic, newType);

            // Update Account
            accountManager.updateAccount(activeAccount.id, { type: newType, address: wallet.address });
            setAccounts(accountManager.getAccounts());

            // Update State
            setWalletAddress(wallet.address);
            setWalletType(newType);
            setActiveAccount({ ...activeAccount, type: newType, address: wallet.address });

            await refreshData();
        } catch (e) {
            throw e;
        } finally {
            setIsLoading(false);
        }
    };

    const renameAccount = (id: string, name: string) => {
        accountManager.updateAccount(id, { name });
        setAccounts(accountManager.getAccounts());
        if (activeAccount && activeAccount.id === id) {
            setActiveAccount({ ...activeAccount, name });
        }
    };

    const deleteAccount = (id: string) => {
        accountManager.deleteAccount(id);
        const updated = accountManager.getAccounts();
        setAccounts(updated);

        if (activeAccount && activeAccount.id === id) {
            if (updated.length > 0) {
                selectAccount(updated[0].id);
            } else {
                setActiveAccount(null);
                setIsLoggedIn(false);
                setWalletAddress(null);
                setBalance('0.00');
            }
        }
    };

    const logout = () => {
        // Delete the current account and switch to next
        const currentId = activeAccount?.id;
        if (!currentId) return;

        // Delete the current account from storage
        accountManager.deleteAccount(currentId);

        // Get remaining accounts
        const remainingAccounts = accountManager.getAccounts();
        setAccounts(remainingAccounts);

        if (remainingAccounts.length > 0) {
            // Switch to the next available account (stay logged in)
            selectAccount(remainingAccounts[0].id);
        } else {
            // No other accounts - fully log out and show initial screen
            setIsLoggedIn(false);
            setWalletAddress(null);
            setTxs([]);
            setBalance('0.00');
            setTokens([]);
            setActiveAccount(null);
        }
    };

    const resetWallet = () => {
        setIsLoggedIn(false);
        setWalletAddress(null);
        setTxs([]);
        setBalance('0.00');
        setAccounts([]);
        setActiveAccount(null);
        localStorage.clear();
        securityService.clearSecurityData();
    };

    return (
        <WalletContext.Provider value={{
            isLoggedIn,
            hasPassword: accounts.length > 0, // Simplified: if we have accounts, we have setup
            walletAddress,
            balance,
            transactions,
            isLoading,
            walletType,
            tokens,
            totalBalanceUSDT,
            accounts,
            activeAccount,
            createWallet,
            importWallet,
            unlockWallet,
            logout,
            sendTransaction,
            refreshData,
            resetWallet,
            getDecryptedSeed,
            getPrivateKey,
            switchWalletType,
            selectAccount,
            addAccount,
            renameAccount,
            deleteAccount
        }}>
            {children}
        </WalletContext.Provider>
    );
}

export function useWallet() {
    const context = useContext(WalletContext);
    if (!context) throw new Error('useWallet must be used within WalletProvider');
    return context;
}
