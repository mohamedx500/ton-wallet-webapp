import { v4 as uuidv4 } from 'uuid';

export interface WalletAccount {
    id: string;
    name: string;
    type: string;
    encryptedSeed: any;
    passwordHash: string;
    address: string;
    color?: string;
}

const STORAGE_KEY = 'wallet_accounts';
const ACTIVE_ACCOUNT_KEY = 'wallet_active_account_id';

export class AccountManager {
    constructor() {
        this.migrateLegacyWallet();
    }

    private getStoredAccounts(): WalletAccount[] {
        try {
            const data = localStorage.getItem(STORAGE_KEY);
            return data ? JSON.parse(data) : [];
        } catch {
            return [];
        }
    }

    private saveStoredAccounts(accounts: WalletAccount[]) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts));
    }

    private migrateLegacyWallet() {
        const accounts = this.getStoredAccounts();
        if (accounts.length > 0) return;

        const legacySeed = localStorage.getItem('wallet_encrypted_seed');
        const legacyHash = localStorage.getItem('wallet_password_hash');
        const legacyType = localStorage.getItem('wallet_type') || 'v4r2';

        if (legacySeed && legacyHash) {
            console.log('Migrating legacy wallet to Account #1');
            const newAccount: WalletAccount = {
                id: uuidv4(),
                name: 'Main Wallet',
                type: legacyType,
                encryptedSeed: JSON.parse(legacySeed),
                passwordHash: legacyHash,
                address: '',
                color: 'blue'
            };
            this.saveStoredAccounts([newAccount]);
            localStorage.setItem(ACTIVE_ACCOUNT_KEY, newAccount.id);
        }
    }

    getAccounts(): WalletAccount[] {
        return this.getStoredAccounts();
    }

    getAccount(id: string): WalletAccount | undefined {
        return this.getStoredAccounts().find(a => a.id === id);
    }

    addAccount(account: Omit<WalletAccount, 'id'>): WalletAccount {
        const accounts = this.getStoredAccounts();
        const newAccount = { ...account, id: uuidv4() };
        accounts.push(newAccount);
        this.saveStoredAccounts(accounts);
        return newAccount;
    }

    updateAccount(id: string, updates: Partial<WalletAccount>) {
        const accounts = this.getStoredAccounts();
        const index = accounts.findIndex(a => a.id === id);
        if (index !== -1) {
            accounts[index] = { ...accounts[index], ...updates };
            this.saveStoredAccounts(accounts);
        }
    }

    deleteAccount(id: string) {
        const accounts = this.getStoredAccounts().filter(a => a.id !== id);
        this.saveStoredAccounts(accounts);

        if (this.getActiveAccountId() === id) {
            localStorage.removeItem(ACTIVE_ACCOUNT_KEY);
        }
    }

    setActiveAccountId(id: string) {
        localStorage.setItem(ACTIVE_ACCOUNT_KEY, id);
    }

    getActiveAccountId(): string | null {
        return localStorage.getItem(ACTIVE_ACCOUNT_KEY);
    }
}
