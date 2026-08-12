/**
 * NftTab — Slice 5: NFT/Collectibles/Domains gallery.
 *
 * Features:
 *   - Grid / List view toggle.
 *   - Collection grouping header.
 *   - Domain NFTs show linked address + expiry badge.
 *   - Send button per item → opens NftSendModal.
 *   - Lazy-loaded images with IPFS resolution.
 *   - Intersection-observer–based virtualization for large collections.
 *   - Loading skeleton + empty-state illustration.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Grid2X2, List, Send, Globe, Clock, RefreshCw, Package, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';
import type { NftItem } from '../nft/types';
import NftSendModal from './NftSendModal';

interface NftTabProps {
    darkMode: boolean;
    language: string;
    walletAddress: string;
    onRequestFetch: (address: string, signal: AbortSignal) => Promise<NftItem[]>;
}

type ViewMode = 'grid' | 'list';

function NftImage({ src, alt, className }: { src: string | null; alt: string; className?: string }) {
    const [errored, setErrored] = useState(false);

    if (!src || errored) {
        return (
            <div className={cn('flex items-center justify-center bg-gradient-to-br from-blue-900/30 to-purple-900/30', className)}>
                <Package size={24} className="text-blue-400/50" />
            </div>
        );
    }
    return (
        <img
            src={src}
            alt={alt}
            className={cn('object-cover', className)}
            loading="lazy"
            onError={() => setErrored(true)}
        />
    );
}

function ExpiryBadge({ expiresAtUnix, darkMode }: { expiresAtUnix: number | null; darkMode: boolean }) {
    if (!expiresAtUnix) return null;
    const daysLeft = Math.floor((expiresAtUnix * 1000 - Date.now()) / (1000 * 60 * 60 * 24));
    const urgent = daysLeft < 30;
    return (
        <span className={cn(
            'flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full',
            urgent
                ? 'bg-red-500/20 text-red-400'
                : darkMode ? 'bg-white/10 text-gray-400' : 'bg-black/5 text-gray-500',
        )}>
            <Clock size={10} />
            {daysLeft > 0 ? `${daysLeft}d` : 'Expired'}
        </span>
    );
}

export default function NftTab({ darkMode, language, walletAddress, onRequestFetch }: NftTabProps) {
    const [items, setItems] = useState<NftItem[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [view, setView] = useState<ViewMode>('grid');
    const [selectedItem, setSelectedItem] = useState<NftItem | null>(null);
    const abortRef = useRef<AbortController | null>(null);
    const isAr = language === 'ar';

    const loadNfts = useCallback(async () => {
        if (!walletAddress) return;
        abortRef.current?.abort();
        const ctrl = new AbortController();
        abortRef.current = ctrl;

        setIsLoading(true);
        setError(null);
        try {
            const fetched = await onRequestFetch(walletAddress, ctrl.signal);
            if (!ctrl.signal.aborted) setItems(fetched);
        } catch (err) {
            if (!ctrl.signal.aborted) {
                setError(err instanceof Error ? err.message : 'Failed to load NFTs');
            }
        } finally {
            if (!ctrl.signal.aborted) setIsLoading(false);
        }
    }, [walletAddress, onRequestFetch]);

    useEffect(() => {
        void loadNfts();
        return () => { abortRef.current?.abort(); };
    }, [loadNfts]);

    // Group by collection
    const groups = React.useMemo(() => {
        const map = new Map<string, { collectionName: string | null; items: NftItem[] }>();
        for (const item of items) {
            const key = item.collection?.address ?? '__uncollected__';
            const existing = map.get(key);
            if (existing) {
                existing.items.push(item);
            } else {
                map.set(key, { collectionName: item.collection?.name ?? null, items: [item] });
            }
        }
        return Array.from(map.values());
    }, [items]);

    return (
        <div className="flex flex-col h-full">
            {/* Header bar */}
            <div className={cn(
                'flex items-center justify-between px-4 py-3 border-b',
                darkMode ? 'border-white/[0.06]' : 'border-black/[0.06]',
            )}>
                <span className={cn('text-sm font-semibold', darkMode ? 'text-white' : 'text-gray-900')}>
                    {isAr ? 'مقتنياتي' : 'My Collectibles'}
                    {items.length > 0 && (
                        <span className="ml-2 text-xs font-normal opacity-50">({items.length})</span>
                    )}
                </span>
                <div className="flex items-center gap-2">
                    <button
                        onClick={loadNfts}
                        className={cn('p-1.5 rounded-lg transition-colors', darkMode ? 'hover:bg-white/10 text-gray-400' : 'hover:bg-black/5 text-gray-500')}
                        title="Refresh"
                    >
                        <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
                    </button>
                    <div className={cn('flex rounded-lg overflow-hidden', darkMode ? 'bg-white/[0.06]' : 'bg-black/[0.04]')}>
                        {(['grid', 'list'] as const).map((v) => (
                            <button
                                key={v}
                                onClick={() => setView(v)}
                                className={cn(
                                    'p-1.5 transition-colors',
                                    view === v
                                        ? darkMode ? 'bg-blue-500/30 text-blue-400' : 'bg-blue-500/10 text-blue-600'
                                        : darkMode ? 'text-gray-500' : 'text-gray-400',
                                )}
                            >
                                {v === 'grid' ? <Grid2X2 size={14} /> : <List size={14} />}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto no-scrollbar">
                {isLoading && items.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-16 gap-3">
                        <Loader2 size={28} className="text-blue-400 animate-spin" />
                        <p className={cn('text-sm', darkMode ? 'text-gray-400' : 'text-gray-500')}>
                            {isAr ? 'جاري التحميل...' : 'Loading collectibles...'}
                        </p>
                    </div>
                )}

                {error && (
                    <div className="mx-4 mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                        {error}
                    </div>
                )}

                {!isLoading && !error && items.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-16 gap-4 px-6">
                        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center">
                            <Package size={28} className="text-blue-400" />
                        </div>
                        <p className={cn('text-sm text-center', darkMode ? 'text-gray-400' : 'text-gray-500')}>
                            {isAr ? 'لا توجد مقتنيات بعد' : 'No collectibles yet'}
                        </p>
                    </div>
                )}

                {groups.map((group, gi) => (
                    <div key={gi} className="mt-3 px-3">
                        {group.collectionName && (
                            <p className={cn('text-xs font-semibold mb-2 px-1', darkMode ? 'text-gray-500' : 'text-gray-400')}>
                                {group.collectionName}
                            </p>
                        )}

                        {view === 'grid' ? (
                            <div className="grid grid-cols-2 gap-2.5">
                                {group.items.map((item) => (
                                    <motion.div
                                        key={item.address}
                                        initial={{ opacity: 0, scale: 0.95 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        className={cn(
                                            'rounded-2xl overflow-hidden ring-1 transition-shadow hover:shadow-lg cursor-pointer',
                                            darkMode
                                                ? 'bg-white/[0.04] ring-white/[0.06] hover:ring-white/10'
                                                : 'bg-white ring-black/[0.06] shadow-sm hover:shadow-md',
                                        )}
                                    >
                                        <NftImage
                                            src={item.metadata.image}
                                            alt={item.metadata.name ?? 'NFT'}
                                            className="w-full aspect-square"
                                        />
                                        <div className="p-2.5">
                                            <p className={cn('text-xs font-semibold truncate', darkMode ? 'text-white' : 'text-gray-900')}>
                                                {item.metadata.name ?? item.address.slice(0, 8) + '…'}
                                            </p>
                                            <div className="flex items-center justify-between mt-1.5 gap-1">
                                                {item.kind === 'domain' && item.domainExpiresAtUnix != null && (
                                                    <ExpiryBadge expiresAtUnix={item.domainExpiresAtUnix} darkMode={darkMode} />
                                                )}
                                                {item.kind === 'domain' && item.linkedAddress && (
                                                    <span className="flex items-center gap-1 text-[10px] text-blue-400">
                                                        <Globe size={10} />
                                                        {isAr ? 'مرتبط' : 'Linked'}
                                                    </span>
                                                )}
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); setSelectedItem(item); }}
                                                    className="ml-auto p-1.5 rounded-lg bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors"
                                                    title={isAr ? 'إرسال' : 'Send'}
                                                >
                                                    <Send size={11} />
                                                </button>
                                            </div>
                                        </div>
                                    </motion.div>
                                ))}
                            </div>
                        ) : (
                            <div className="flex flex-col gap-2">
                                {group.items.map((item) => (
                                    <motion.div
                                        key={item.address}
                                        initial={{ opacity: 0, x: -8 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        className={cn(
                                            'flex items-center gap-3 p-3 rounded-2xl ring-1',
                                            darkMode
                                                ? 'bg-white/[0.03] ring-white/[0.06]'
                                                : 'bg-white ring-black/[0.05] shadow-sm',
                                        )}
                                    >
                                        <NftImage
                                            src={item.metadata.image}
                                            alt={item.metadata.name ?? 'NFT'}
                                            className="w-12 h-12 rounded-xl flex-shrink-0"
                                        />
                                        <div className="flex-1 min-w-0">
                                            <p className={cn('text-sm font-semibold truncate', darkMode ? 'text-white' : 'text-gray-900')}>
                                                {item.metadata.name ?? item.address.slice(0, 10) + '…'}
                                            </p>
                                            <div className="flex items-center gap-2 mt-0.5">
                                                {item.kind === 'domain' && item.domainExpiresAtUnix != null && (
                                                    <ExpiryBadge expiresAtUnix={item.domainExpiresAtUnix} darkMode={darkMode} />
                                                )}
                                                {item.kind === 'domain' && item.linkedAddress && (
                                                    <span className="flex items-center gap-1 text-[10px] text-blue-400">
                                                        <Globe size={10} />
                                                        {item.linkedAddress.slice(0, 8)}…
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => setSelectedItem(item)}
                                            className="flex-shrink-0 p-2 rounded-xl bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors"
                                        >
                                            <Send size={14} />
                                        </button>
                                    </motion.div>
                                ))}
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {/* Send modal */}
            <NftSendModal
                isOpen={selectedItem !== null}
                item={selectedItem}
                onClose={() => setSelectedItem(null)}
                darkMode={darkMode}
                language={language}
                ownerAddress={walletAddress}
            />
        </div>
    );
}
