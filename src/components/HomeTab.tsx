/**
 * HomeTab — wallet home with Tokens / Collectibles sections.
 * Bulk transfers live in bottom navigation (not here).
 */

import React, { useState } from 'react';
import { ArrowUp, Download, ScanLine, ArrowRightLeft } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '../lib/utils';
import { MiniSparkline } from './MiniSparkline';
import { parseDiffPercent } from '../tokens/filterDisplayTokens';
import NftTab from './NftTab';
import type { NftItem } from '../nft/types';

export interface HomeToken {
    id?: string;
    name: string;
    symbol: string;
    displaySymbol?: string;
    balance: string;
    balanceLabel?: string;
    value: string;
    valueLabel?: string;
    icon?: string;
    price?: number;
    diff?: string;
    rawBalance?: number;
    sparkline?: number[];
    isNative?: boolean;
    masterAddress?: string;
    verification?: string;
}

interface HomeTabProps {
    darkMode: boolean;
    language: string;
    setShowSendModal: (v: boolean) => void;
    setShowReceiveModal: (v: boolean) => void;
    setShowSwapModal: (v: boolean) => void;
    onScanQr?: () => void;
    tokens: HomeToken[];
    onTokenClick: (token: HomeToken) => void;
    walletAddress: string;
    network: 'mainnet' | 'testnet';
    onRequestFetchNfts: (address: string, signal: AbortSignal) => Promise<NftItem[]>;
    onSendNft?: (params: {
        item: NftItem;
        recipient: string;
        comment: string;
        password: string;
    }) => Promise<void>;
}

type AssetSection = 'tokens' | 'collectibles';

const actions = [
    { id: 'send', icon: ArrowUp, labelEn: 'Send', labelAr: 'إرسال', color: 'blue' },
    { id: 'receive', icon: Download, labelEn: 'Receive', labelAr: 'استلام', color: 'green' },
    { id: 'swap', icon: ArrowRightLeft, labelEn: 'Swap', labelAr: 'تبديل', color: 'amber' },
    { id: 'scan', icon: ScanLine, labelEn: 'Link', labelAr: 'ربط', color: 'cyan' },
];

const actionColors: Record<string, { light: string; dark: string }> = {
    blue: {
        light: 'bg-blue-500 text-white shadow-md shadow-blue-500/20',
        dark: 'bg-blue-500/10 text-blue-400 ring-1 ring-blue-500/20',
    },
    green: {
        light: 'bg-emerald-500 text-white shadow-md shadow-emerald-500/20',
        dark: 'bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20',
    },
    cyan: {
        light: 'bg-cyan-500 text-white shadow-md shadow-cyan-500/20',
        dark: 'bg-cyan-500/10 text-cyan-400 ring-1 ring-cyan-500/20',
    },
    amber: {
        light: 'bg-amber-500 text-white shadow-md shadow-amber-500/20',
        dark: 'bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/20',
    },
};

function TokenSkeleton({ darkMode }: { darkMode: boolean }) {
    return (
        <div className={cn('glass-card divide-y overflow-hidden', darkMode ? 'divide-white/[0.06]' : 'divide-black/[0.04]')}>
            {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center justify-between px-4 py-3.5">
                    <div className="flex items-center gap-3">
                        <div className={cn('w-10 h-10 rounded-full animate-pulse', darkMode ? 'bg-white/5' : 'bg-gray-100')} />
                        <div className="space-y-2">
                            <div className={cn('h-3.5 w-16 rounded-md animate-pulse', darkMode ? 'bg-white/5' : 'bg-gray-100')} />
                            <div className={cn('h-3 w-10 rounded-md animate-pulse', darkMode ? 'bg-white/5' : 'bg-gray-100')} />
                        </div>
                    </div>
                    <div className="text-right space-y-2">
                        <div className={cn('h-3.5 w-14 rounded-md animate-pulse ml-auto', darkMode ? 'bg-white/5' : 'bg-gray-100')} />
                        <div className={cn('h-3 w-10 rounded-md animate-pulse ml-auto', darkMode ? 'bg-white/5' : 'bg-gray-100')} />
                    </div>
                </div>
            ))}
        </div>
    );
}

/** Format unit market price (not portfolio value). */
function formatUnitPrice(price: number | undefined): string | null {
    if (price == null || !(price > 0) || !Number.isFinite(price)) return null;
    if (price < 0.01) return `$${price.toPrecision(3)}`;
    if (price < 1) return `$${price.toFixed(4)}`;
    return `$${price.toFixed(2)}`;
}

/** Compact sparkline points from existing price + 24h change when history arrays are absent. */
function sparklineFromPriceDiff(price: number | undefined, diffPct: number | null): number[] | null {
    if (price == null || !(price > 0) || diffPct == null) return null;
    const start = price / (1 + diffPct / 100);
    if (!Number.isFinite(start) || start <= 0) return null;
    const points: number[] = [];
    for (let i = 0; i < 8; i++) {
        const t = i / 7;
        // Slight ease so the gradient chart isn't a perfectly flat diagonal
        const eased = t * t * (3 - 2 * t);
        points.push(start + (price - start) * eased);
    }
    return points;
}

function TokenRow({
    token,
    darkMode,
    onClick,
    index,
}: {
    token: HomeToken;
    darkMode: boolean;
    onClick: () => void;
    index: number;
}) {
    const title = token.displaySymbol || token.symbol;
    const balanceText = token.balanceLabel ?? token.balance;
    const unitPrice = formatUnitPrice(token.price);
    const diffPct = parseDiffPercent(token.diff);
    const diffPositive = diffPct == null ? true : diffPct >= 0;
    const diffLabel = (() => {
        if (diffPct == null) return null;
        const abs = Math.abs(diffPct).toFixed(2);
        return `${diffPct >= 0 ? '+' : '-'}${abs}%`;
    })();
    const sparkPoints =
        token.sparkline && token.sparkline.length >= 2
            ? token.sparkline
            : sparklineFromPriceDiff(token.price, diffPct);

    return (
        <motion.button
            type="button"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, delay: Math.min(index * 0.03, 0.24), ease: 'easeOut' }}
            onClick={onClick}
            className={cn(
                'w-full flex items-center gap-3 px-4 py-3 transition-all active:scale-[0.99] text-left',
                darkMode ? 'hover:bg-white/[0.03]' : 'hover:bg-black/[0.02]',
            )}
        >
            <div
                className={cn(
                    'w-10 h-10 rounded-full flex items-center justify-center text-lg overflow-hidden flex-shrink-0',
                    darkMode ? 'bg-white/5 ring-1 ring-white/10' : 'bg-gray-50 ring-1 ring-black/[0.06]',
                )}
            >
                {token.icon && typeof token.icon === 'string' && token.icon.startsWith('http') ? (
                    <img
                        src={token.icon}
                        alt={title}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                            (e.target as HTMLImageElement).onerror = null;
                            (e.target as HTMLImageElement).src =
                                'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ton/info/logo.png';
                        }}
                    />
                ) : (
                    token.icon
                )}
            </div>

            {/* Symbol + unit price + 24h change */}
            <div className="flex-1 min-w-0 self-center">
                <p className={cn('text-sm font-semibold truncate', darkMode ? 'text-white' : 'text-gray-900')}>
                    {title}
                </p>
                <div className="flex items-baseline gap-1.5 mt-0.5 min-w-0">
                    {unitPrice ? (
                        <span className={cn('text-xs tabular-nums', darkMode ? 'text-gray-500' : 'text-gray-400')}>
                            {unitPrice}
                        </span>
                    ) : (
                        <span className={cn('text-xs', darkMode ? 'text-gray-600' : 'text-gray-400')}>—</span>
                    )}
                    {diffLabel && (
                        <span
                            className={cn(
                                'text-[11px] tabular-nums font-semibold',
                                diffPositive ? 'text-emerald-500' : 'text-red-500',
                            )}
                        >
                            {diffLabel}
                        </span>
                    )}
                </div>
            </div>

            {/* Holding balance + gradient sparkline */}
            <div className="shrink-0 flex flex-col items-end gap-0.5">
                <span className={cn('text-sm font-bold tabular-nums', darkMode ? 'text-white' : 'text-gray-900')}>
                    {balanceText}
                </span>
                <MiniSparkline points={sparkPoints} positive={diffPositive} width={64} height={20} />
            </div>
        </motion.button>
    );
}

export default function HomeTab({
    darkMode,
    language,
    setShowSendModal,
    setShowReceiveModal,
    setShowSwapModal,
    onScanQr,
    tokens,
    onTokenClick,
    walletAddress,
    network,
    onRequestFetchNfts,
    onSendNft,
}: HomeTabProps) {
    const isAr = language === 'ar';
    const [section, setSection] = useState<AssetSection>('tokens');

    const actionHandlers: Record<string, () => void> = {
        send: () => setShowSendModal(true),
        receive: () => setShowReceiveModal(true),
        swap: () => setShowSwapModal(true),
        scan: () => onScanQr?.(),
    };

    return (
        <>
            <div className="px-5 pt-5 pb-3">
                <div className={cn('glass-card p-2.5 grid grid-cols-4 gap-1.5')}>
                    {actions.map(({ id, icon: Icon, labelEn, labelAr, color }) => (
                        <button
                            key={id}
                            type="button"
                            onClick={actionHandlers[id]}
                            className={cn(
                                'flex flex-col items-center justify-center py-2 rounded-xl transition-all active:scale-95',
                                darkMode ? 'hover:bg-white/5' : 'hover:bg-black/[0.03]',
                            )}
                        >
                            <div
                                className={cn(
                                    'w-11 h-11 rounded-[14px] flex items-center justify-center mb-1.5',
                                    darkMode ? actionColors[color].dark : actionColors[color].light,
                                )}
                            >
                                <Icon size={20} strokeWidth={2} />
                            </div>
                            <span
                                className={cn(
                                    'text-[10px] font-semibold tracking-tight',
                                    darkMode ? 'text-gray-400' : 'text-gray-600',
                                )}
                            >
                                {isAr ? labelAr : labelEn}
                            </span>
                        </button>
                    ))}
                </div>
            </div>

            <div className="px-5 pb-2">
                <div
                    className={cn(
                        'flex gap-1 p-1 mb-3 rounded-xl',
                        darkMode ? 'bg-white/[0.04]' : 'bg-gray-100/80',
                    )}
                >
                    {(
                        [
                            { id: 'tokens' as const, en: 'Tokens', ar: 'التوكينات' },
                            { id: 'collectibles' as const, en: 'Collectibles', ar: 'المقتنيات' },
                        ] as const
                    ).map((tab) => {
                        const active = section === tab.id;
                        return (
                            <button
                                key={tab.id}
                                type="button"
                                onClick={() => setSection(tab.id)}
                                className={cn(
                                    'flex-1 py-2 rounded-lg text-[13px] font-semibold transition-colors',
                                    active
                                        ? darkMode
                                            ? 'bg-white/10 text-white'
                                            : 'bg-white text-gray-900 shadow-sm'
                                        : darkMode
                                            ? 'text-gray-500 hover:text-gray-300'
                                            : 'text-gray-500 hover:text-gray-700',
                                )}
                            >
                                {isAr ? tab.ar : tab.en}
                            </button>
                        );
                    })}
                </div>
            </div>

            {section === 'tokens' ? (
                <div className="px-5 pb-6">
                    {tokens.length === 0 ? (
                        <TokenSkeleton darkMode={darkMode} />
                    ) : (
                        <div
                            className={cn(
                                'glass-card divide-y overflow-hidden',
                                darkMode ? 'divide-white/[0.06]' : 'divide-black/[0.04]',
                            )}
                        >
                            {tokens.map((token, idx) => (
                                <TokenRow
                                    key={token.id || token.masterAddress || `${token.symbol}-${idx}`}
                                    token={token}
                                    darkMode={darkMode}
                                    index={idx}
                                    onClick={() => onTokenClick(token)}
                                />
                            ))}
                        </div>
                    )}
                </div>
            ) : (
                <div className="pb-6">
                    <NftTab
                        darkMode={darkMode}
                        language={language}
                        walletAddress={walletAddress}
                        network={network}
                        onRequestFetch={onRequestFetchNfts}
                        onSendNft={onSendNft}
                    />
                </div>
            )}
        </>
    );
}
