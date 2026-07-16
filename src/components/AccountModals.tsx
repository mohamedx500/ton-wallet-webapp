import React, { useState } from 'react';
import { X, Trash2, Pencil, Check, UserPlus, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { WalletAccount } from '../services/AccountManager';
import ModalShell from './ModalShell';
import { useToast } from './Toast';

interface AccountsModalProps {
    isOpen: boolean;
    onClose: () => void;
    accounts: WalletAccount[];
    activeAccount: WalletAccount | null;
    onSelectAccount: (id: string) => void;
    onAddAccount: () => void;
    onDeleteAccount: (id: string) => void;
    onRenameAccount: (id: string, name: string) => void;
    darkMode: boolean;
    language: string;
}

export function AccountsModal({
    isOpen, onClose, accounts, activeAccount, onSelectAccount, onAddAccount, onDeleteAccount, onRenameAccount, darkMode, language
}: AccountsModalProps) {
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');
    const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
    const toast = useToast();

    if (!isOpen) return null;

    const handleStartEdit = (account: WalletAccount) => {
        setEditingId(account.id);
        setEditName(account.name);
        setShowDeleteConfirm(null);
    };

    const handleSaveEdit = (id: string) => {
        if (editName.trim()) {
            onRenameAccount(id, editName.trim());
        }
        setEditingId(null);
    };

    const handleDeleteClick = (id: string) => {
        if (accounts.length <= 1) {
            toast.warning(language === 'ar' ? 'لا يمكن حذف الحساب الوحيد' : 'Cannot delete the only account');
            return;
        }
        setShowDeleteConfirm(id);
    };

    const confirmDelete = (id: string) => {
        onDeleteAccount(id);
        setShowDeleteConfirm(null);
    };

    return (
        <ModalShell isOpen={isOpen} onClose={onClose} position="bottom">
            <div className={cn("rounded-t-3xl sm:rounded-3xl p-6", darkMode ? "bg-[hsl(224,20%,8%)] ring-1 ring-white/5" : "bg-white/95 backdrop-blur-xl ring-1 ring-black/5")}>
                <div className="flex justify-between items-center mb-5">
                    <h3 className={cn("text-lg font-bold", darkMode ? "text-white" : "text-gray-900")}>
                        {language === 'ar' ? 'الحسابات' : 'Accounts'}
                    </h3>
                    <button onClick={onClose} className={cn("p-1.5 rounded-xl transition", darkMode ? "hover:bg-white/5 text-gray-500" : "hover:bg-gray-100 text-gray-400")}>
                        <X size={18} />
                    </button>
                </div>

                <div className="space-y-1.5 mb-5 max-h-[60vh] overflow-y-auto no-scrollbar">
                    {accounts.map(account => (
                        <div
                            key={account.id}
                            className={cn(
                                "group relative p-3.5 rounded-2xl transition-all",
                                activeAccount?.id === account.id
                                    ? darkMode ? "bg-blue-500/10 ring-1 ring-blue-500/20" : "bg-blue-50 ring-1 ring-blue-200"
                                    : darkMode ? "hover:bg-white/5" : "hover:bg-gray-50"
                            )}
                        >
                            <div className="flex justify-between items-center">
                                {editingId === account.id ? (
                                    <div className="flex items-center gap-2 flex-1 mr-2">
                                        <input
                                            value={editName}
                                            onChange={e => setEditName(e.target.value)}
                                            className={cn("flex-1 px-3 py-1.5 text-sm rounded-xl outline-none", darkMode ? "bg-white/5 border border-white/10 text-white" : "bg-white border border-gray-200")}
                                            autoFocus
                                            onKeyDown={e => e.key === 'Enter' && handleSaveEdit(account.id)}
                                        />
                                        <button onClick={() => handleSaveEdit(account.id)} className="p-1.5 rounded-lg bg-blue-500/10 text-blue-500"><Check size={14} /></button>
                                    </div>
                                ) : (
                                    <div onClick={() => onSelectAccount(account.id)} className="flex-1 cursor-pointer">
                                        <div className="flex items-center gap-2">
                                            <span className={cn("text-sm font-semibold", darkMode ? "text-white" : "text-gray-900")}>{account.name}</span>
                                            {activeAccount?.id === account.id && (
                                                <span className={cn("text-[9px] px-1.5 py-0.5 rounded-md font-bold", darkMode ? "bg-blue-500/15 text-blue-400" : "bg-blue-100 text-blue-600")}>ACTIVE</span>
                                            )}
                                        </div>
                                        <p className={cn("text-[11px] mt-0.5 font-mono", darkMode ? "text-gray-600" : "text-gray-400")}>
                                            {account.address ? `${account.address.slice(0, 4)}...${account.address.slice(-4)}` : '...'}
                                        </p>
                                    </div>
                                )}

                                <div className="flex items-center gap-0.5">
                                    <button
                                        onClick={() => handleStartEdit(account)}
                                        className={cn("p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition", darkMode ? "hover:bg-white/5 text-gray-500" : "hover:bg-gray-100 text-gray-400")}
                                    >
                                        <Pencil size={13} />
                                    </button>
                                    <button
                                        onClick={() => handleDeleteClick(account.id)}
                                        className={cn("p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition", darkMode ? "hover:bg-red-500/10 text-red-400" : "hover:bg-red-50 text-red-500")}
                                    >
                                        <Trash2 size={13} />
                                    </button>
                                </div>
                            </div>

                            {showDeleteConfirm === account.id && (
                                <div className={cn("absolute inset-0 rounded-2xl flex items-center justify-between px-4", darkMode ? "bg-[hsl(224,20%,10%)]" : "bg-white")}>
                                    <span className={cn("text-sm font-medium", darkMode ? "text-red-400" : "text-red-600")}>
                                        {language === 'ar' ? 'تأكيد الحذف؟' : 'Delete?'}
                                    </span>
                                    <div className="flex gap-2">
                                        <button onClick={() => setShowDeleteConfirm(null)} className={cn("px-3 py-1.5 text-xs rounded-lg font-semibold", darkMode ? "bg-white/5 text-gray-400" : "bg-gray-100 text-gray-500")}>
                                            Cancel
                                        </button>
                                        <button onClick={() => confirmDelete(account.id)} className="px-3 py-1.5 text-xs rounded-lg font-semibold bg-red-500 text-white">
                                            Delete
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>

                <button
                    onClick={onAddAccount}
                    className="w-full py-3 rounded-2xl font-semibold text-sm flex items-center justify-center gap-2 bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg shadow-blue-500/20 active:scale-[0.98] transition-all"
                >
                    <UserPlus size={16} strokeWidth={2} />
                    {language === 'ar' ? 'إضافة حساب جديد' : 'Add Account'}
                </button>
            </div>
        </ModalShell>
    );
}

interface AddAccountModalProps {
    isOpen: boolean;
    onClose: () => void;
    onAdd: (name: string, password: string, mnemonic?: string[]) => Promise<void>;
    darkMode: boolean;
    language: string;
}

export function AddAccountModal({ isOpen, onClose, onAdd, darkMode, language }: AddAccountModalProps) {
    const [step, setStep] = useState(1);
    const [name, setName] = useState('');
    const [password, setPassword] = useState('');
    const [importMnemonic, setImportMnemonic] = useState('');
    const [loading, setLoading] = useState(false);
    const toast = useToast();

    if (!isOpen) return null;

    const handleNext = () => {
        if (step === 1 && name) setStep(2);
    };

    const handleSubmit = async () => {
        if (!password) return;
        setLoading(true);
        try {
            const mnemonic = importMnemonic ? importMnemonic.split(' ') : undefined;
            await onAdd(name, password, mnemonic);
            onClose();
            setStep(1);
            setName('');
            setPassword('');
            setImportMnemonic('');
        } catch (e) {
            toast.error('Error adding account');
        } finally {
            setLoading(false);
        }
    };

    const inputClass = cn(
        "w-full px-4 py-3 rounded-2xl text-sm font-medium outline-none transition-all mt-2",
        darkMode ? "bg-white/5 border border-white/10 text-white placeholder:text-gray-600 focus:border-blue-500/50" : "bg-white/70 border border-gray-200/80 text-gray-900 placeholder:text-gray-400 focus:border-blue-400"
    );

    return (
        <ModalShell isOpen={isOpen} onClose={onClose}>
            <div className={cn("rounded-3xl p-6", darkMode ? "bg-[hsl(224,20%,8%)] ring-1 ring-white/5" : "bg-white/95 backdrop-blur-xl ring-1 ring-black/5")}>
                <div className="flex justify-between items-center mb-5">
                    <h3 className={cn("text-lg font-bold", darkMode ? "text-white" : "text-gray-900")}>
                        {language === 'ar' ? 'إضافة حساب' : 'Add Account'}
                    </h3>
                    <button onClick={onClose} className={cn("p-1.5 rounded-xl transition", darkMode ? "hover:bg-white/5 text-gray-500" : "hover:bg-gray-100 text-gray-400")}>
                        <X size={18} />
                    </button>
                </div>

                {step === 1 ? (
                    <div className="space-y-4">
                        <div>
                            <label className={cn("text-[11px] font-bold uppercase tracking-wider", darkMode ? "text-gray-500" : "text-gray-400")}>{language === 'ar' ? 'اسم المحفظة' : 'Wallet Name'}</label>
                            <input value={name} onChange={e => setName(e.target.value)} className={inputClass} placeholder="My New Wallet" autoFocus />
                        </div>
                        <div>
                            <label className={cn("text-[11px] font-bold uppercase tracking-wider", darkMode ? "text-gray-500" : "text-gray-400")}>{language === 'ar' ? 'استيراد عبارة سرية (اختياري)' : 'Import Phrase (Optional)'}</label>
                            <textarea value={importMnemonic} onChange={e => setImportMnemonic(e.target.value)} className={cn(inputClass, "h-24 resize-none font-mono")} placeholder="Leave empty to create new..." />
                        </div>
                        <button onClick={handleNext} disabled={!name} className="w-full py-3 rounded-2xl font-semibold text-sm bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg shadow-blue-500/20 disabled:opacity-50 active:scale-[0.98] transition-all">
                            {language === 'ar' ? 'التالي' : 'Next'}
                        </button>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div>
                            <label className={cn("text-[11px] font-bold uppercase tracking-wider", darkMode ? "text-gray-500" : "text-gray-400")}>{language === 'ar' ? 'تعيين كلمة مرور' : 'Set Password'}</label>
                            <input type="password" value={password} onChange={e => setPassword(e.target.value)} className={inputClass} placeholder="********" autoFocus onKeyDown={e => e.key === 'Enter' && handleSubmit()} autoComplete="new-password" />
                            <p className={cn("text-[11px] mt-2", darkMode ? "text-gray-600" : "text-gray-400")}>Password specific to this account.</p>
                        </div>
                        <button onClick={handleSubmit} disabled={loading || !password} className="w-full py-3 rounded-2xl font-semibold text-sm bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg shadow-blue-500/20 disabled:opacity-50 flex items-center justify-center gap-2 active:scale-[0.98] transition-all">
                            {loading && <Loader2 size={16} className="animate-spin" />}
                            {language === 'ar' ? 'إنشاء' : 'Create'}
                        </button>
                    </div>
                )}
            </div>
        </ModalShell>
    );
}
