/**
 * CSVImportButton Component
 *
 * Parses CSV files with columns: address, amount, comment, coin.
 * Populates the multi-send rows via context dispatch.
 * Supports drag-and-drop and file picker.
 */

import React, { useCallback, useRef, useState } from 'react';
import { Upload, FileText, AlertCircle } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useMultiSend } from '../../context/MultiSendContext';
import { NATIVE_TON } from '../../types/multisend';
import { useWalletCoins } from './CoinSelectorDropdown';
import type { CoinInfo } from '../../types/multisend';

/**
 * Parse a CSV string into an array of transfer row data.
 * Expected format: address,amount,comment,coin
 * Header row is optional and auto-detected.
 */
function parseCSV(text: string, availableCoins: CoinInfo[]): Array<{
    address: string;
    amount: string;
    comment: string;
    coin: CoinInfo;
}> {
    const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

    if (lines.length === 0) return [];

    // Detect and skip header row
    const firstLine = lines[0].toLowerCase();
    const hasHeader =
        firstLine.includes('address') ||
        firstLine.includes('recipient') ||
        firstLine.includes('amount');

    const dataLines = hasHeader ? lines.slice(1) : lines;

    return dataLines.map((line) => {
        // Handle quoted CSV fields
        const fields: string[] = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                fields.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        fields.push(current.trim());

        const [address = '', amount = '', comment = '', coinSymbol = ''] = fields;

        // Resolve coin from symbol (match against user's wallet coins)
        const matchedCoin = availableCoins.find(
            (c) => c.symbol.toLowerCase() === coinSymbol.toLowerCase()
        );

        return {
            address,
            amount,
            comment,
            coin: matchedCoin || NATIVE_TON,
        };
    });
}

const CSVImportButton: React.FC = () => {
    const { dispatch } = useMultiSend();
    const walletCoins = useWalletCoins();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [error, setError] = useState<string | null>(null);
    const [importCount, setImportCount] = useState<number | null>(null);

    const processFile = useCallback(
        (file: File) => {
            setError(null);
            setImportCount(null);

            if (!file.name.endsWith('.csv') && !file.name.endsWith('.txt')) {
                setError('Please upload a .csv or .txt file');
                return;
            }

            if (file.size > 5 * 1024 * 1024) {
                setError('File too large (max 5MB)');
                return;
            }

            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const text = e.target?.result as string;
                    const parsed = parseCSV(text, walletCoins);

                    if (parsed.length === 0) {
                        setError('No valid rows found in CSV');
                        return;
                    }

                    dispatch({
                        type: 'IMPORT_ROWS',
                        payload: parsed,
                    });

                    setImportCount(parsed.length);
                    setTimeout(() => setImportCount(null), 3000);
                } catch (err) {
                    setError('Failed to parse CSV file');
                }
            };
            reader.onerror = () => setError('Failed to read file');
            reader.readAsText(file);
        },
        [dispatch]
    );

    const handleFileChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const file = e.target.files?.[0];
            if (file) processFile(file);
            // Reset input so the same file can be re-imported
            e.target.value = '';
        },
        [processFile]
    );

    const handleClick = useCallback(() => {
        fileInputRef.current?.click();
    }, []);

    return (
        <div className="relative">
            {/* Hidden file input */}
            <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.txt"
                onChange={handleFileChange}
                className="hidden"
            />

            {/* Visible button */}
            <button
                type="button"
                onClick={handleClick}
                className={cn(
                    'flex items-center gap-2 px-3.5 py-2 rounded-full transition-all duration-300',
                    'text-sm font-semibold border-none',
                    'bg-gray-100 dark:bg-white/[0.04] text-gray-600 dark:text-gray-400',
                    'hover:bg-gray-200 dark:hover:bg-white/[0.08] hover:text-gray-900 dark:hover:text-gray-200'
                )}
            >
                <Upload className="w-4 h-4" />
                CSV
            </button>

            {/* Success toast */}
            {importCount !== null && (
                <div className="absolute left-0 top-full mt-2 z-50 px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 whitespace-nowrap">
                    <p className="text-xs text-emerald-400 flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5" />
                        Imported {importCount} rows
                    </p>
                </div>
            )}

            {/* Error toast */}
            {error && (
                <div className="absolute left-0 top-full mt-2 z-50 px-3 py-1.5 rounded-lg bg-red-500/15 border border-red-500/30 whitespace-nowrap">
                    <p className="text-xs text-red-400 flex items-center gap-1.5">
                        <AlertCircle className="w-3.5 h-3.5" />
                        {error}
                    </p>
                </div>
            )}
        </div>
    );
};

export default React.memo(CSVImportButton);
