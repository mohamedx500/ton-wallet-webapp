import React, { useState } from 'react';
import { X, Plus, Wallet, MoreVertical, Trash2, Edit2, Check, UserPlus, LogOut } from 'lucide-react';
import { WalletAccount } from '../services/AccountManager';

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
            alert(language === 'ar' ? 'لا يمكن حذف الحساب الوحيد' : 'Cannot delete the only account');
            return;
        }
        setShowDeleteConfirm(id);
    };

    const confirmDelete = (id: string) => {
        onDeleteAccount(id);
        setShowDeleteConfirm(null);
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4" onClick={onClose}>
            <div className={`w-full max-w-sm ${darkMode ? 'bg-gray-900' : 'bg-white'} rounded-t-3xl sm:rounded-3xl p-6 animate-slide-up sm:animate-scale-up`} onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-6">
                    <h3 className={`text-xl font-bold ${darkMode ? 'text-white' : 'text-gray-800'}`}>
                        {language === 'ar' ? 'الحسابات' : 'Accounts'}
                    </h3>
                    <button onClick={onClose} className={`p-2 rounded-full ${darkMode ? 'hover:bg-gray-800 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}>
                        <X size={20} />
                    </button>
                </div>

                <div className="space-y-3 mb-6 max-h-[60vh] overflow-y-auto no-scrollbar">
                    {accounts.map(account => (
                        <div
                            key={account.id}
                            className={`group relative p-4 rounded-xl border transition-all ${activeAccount?.id === account.id
                                ? (darkMode ? 'bg-blue-900/20 border-blue-500/50' : 'bg-blue-50 border-blue-200')
                                : (darkMode ? 'bg-gray-800 border-gray-700 hover:border-gray-600' : 'bg-white border-gray-100 hover:border-gray-200 shadow-sm')
                                }`}
                        >
                            <div className="flex justify-between items-center mb-2">
                                {editingId === account.id ? (
                                    <div className="flex items-center gap-2 flex-1 mr-2">
                                        <input
                                            value={editName}
                                            onChange={e => setEditName(e.target.value)}
                                            className={`flex-1 px-2 py-1 text-sm rounded border ${darkMode ? 'bg-gray-700 border-gray-600 text-white' : 'bg-white border-gray-300'}`}
                                            autoFocus
                                            onKeyDown={e => e.key === 'Enter' && handleSaveEdit(account.id)}
                                        />
                                        <button onClick={() => handleSaveEdit(account.id)} className="p-1 rounded bg-green-100 text-green-600"><Check size={16} /></button>
                                    </div>
                                ) : (
                                    <div
                                        onClick={() => onSelectAccount(account.id)}
                                        className="flex-1 cursor-pointer"
                                    >
                                        <div className="flex items-center gap-2">
                                            <span className={`font-bold ${darkMode ? 'text-white' : 'text-gray-800'}`}>{account.name}</span>
                                            {activeAccount?.id === account.id && (
                                                <span className="bg-blue-100 text-blue-600 text-[10px] px-1.5 py-0.5 rounded-full font-bold">ACTIVE</span>
                                            )}
                                        </div>
                                        <div className={`text-xs mt-1 font-mono truncate max-w-[200px] ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                            {account.address ? `${account.address.slice(0, 4)}...${account.address.slice(-4)}` : '...'}
                                        </div>
                                    </div>
                                )}

                                <div className="flex items-center gap-1">
                                    <button
                                        onClick={() => handleStartEdit(account)}
                                        className={`p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition ${darkMode ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-100 text-gray-400'}`}
                                    >
                                        <Edit2 size={14} />
                                    </button>
                                    <button
                                        onClick={() => handleDeleteClick(account.id)}
                                        className={`p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition ${darkMode ? 'hover:bg-red-900/30 text-red-400' : 'hover:bg-red-50 text-red-500'}`}
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            </div>

                            {/* Delete Confirmation Overlay */}
                            {showDeleteConfirm === account.id && (
                                <div className={`absolute inset-0 rounded-xl flex items-center justify-between px-4 ${darkMode ? 'bg-gray-800' : 'bg-gray-50'}`}>
                                    <span className={`text-sm font-medium ${darkMode ? 'text-red-400' : 'text-red-600'}`}>
                                        {language === 'ar' ? 'تأكيد الحذف؟' : 'Confirm Delete?'}
                                    </span>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => setShowDeleteConfirm(null)}
                                            className={`px-3 py-1 text-xs rounded-lg font-medium ${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-gray-200 text-gray-600'}`}
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            onClick={() => confirmDelete(account.id)}
                                            className="px-3 py-1 text-xs rounded-lg font-medium bg-red-600 text-white"
                                        >
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
                    className={`w-full py-3 rounded-xl font-bold flex items-center justify-center gap-2 ${darkMode ? 'bg-blue-600 hover:bg-blue-500' : 'bg-blue-600 hover:bg-blue-700'} text-white transition`}
                >
                    <UserPlus size={20} />
                    {language === 'ar' ? 'إضافة حساب جديد' : 'Add New Account'}
                </button>
            </div>
        </div>
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
    const [step, setStep] = useState(1); // 1: Name/Type, 2: Password
    const [name, setName] = useState('');
    const [password, setPassword] = useState('');
    const [importMnemonic, setImportMnemonic] = useState('');
    const [loading, setLoading] = useState(false);

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
            // Reset
            setStep(1);
            setName('');
            setPassword('');
            setImportMnemonic('');
        } catch (e) {
            alert('Error adding account');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className={`w-full max-w-sm ${darkMode ? 'bg-gray-900' : 'bg-white'} rounded-3xl p-6`} onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-6">
                    <h3 className={`text-xl font-bold ${darkMode ? 'text-white' : 'text-gray-800'}`}>
                        {language === 'ar' ? 'إضافة حساب' : 'Add Account'}
                    </h3>
                    <button onClick={onClose} className={`p-2 rounded-full ${darkMode ? 'hover:bg-gray-800 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}>
                        <X size={20} />
                    </button>
                </div>

                {step === 1 ? (
                    <div className="space-y-4">
                        <div>
                            <label className={`text-sm font-medium ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>{language === 'ar' ? 'اسم المحفظة' : 'Wallet Name'}</label>
                            <input
                                value={name}
                                onChange={e => setName(e.target.value)}
                                className={`w-full p-3 rounded-xl border mt-2 ${darkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-gray-50 border-gray-200'}`}
                                placeholder="My New Wallet"
                                autoFocus
                            />
                        </div>
                        <div>
                            <label className={`text-sm font-medium ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>{language === 'ar' ? 'استيراد عبارة سرية (اختياري)' : 'Import Secret Phrase (Optional)'}</label>
                            <textarea
                                value={importMnemonic}
                                onChange={e => setImportMnemonic(e.target.value)}
                                className={`w-full p-3 rounded-xl border mt-2 h-24 ${darkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-gray-50 border-gray-200'}`}
                                placeholder="Leave empty to create new..."
                            />
                        </div>
                        <button onClick={handleNext} disabled={!name} className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold disabled:opacity-50">
                            {language === 'ar' ? 'التالي' : 'Next'}
                        </button>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div>
                            <label className={`text-sm font-medium ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>{language === 'ar' ? 'تعيين كلمة مرور' : 'Set Password'}</label>
                            <input
                                type="password"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                className={`w-full p-3 rounded-xl border mt-2 ${darkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-gray-50 border-gray-200'}`}
                                placeholder="********"
                                autoFocus
                                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                            />
                            <p className="text-xs text-gray-500 mt-2">Password specific to this account.</p>
                        </div>
                        <button onClick={handleSubmit} disabled={loading || !password} className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2">
                            {loading && <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>}
                            {language === 'ar' ? 'إنشاء' : 'Create'}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
