/**
 * NftDetailModal — in-shell NFT / domain detail screen (Tonkeeper-style).
 *
 * Portals into [data-wallet-shell] so it fills the phone frame (no clipped
 * bottom sheet / scrollbar). Keeps transfer via NftSendModal.
 */

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
    ChevronLeft,
    Package,
    BadgeCheck,
    ExternalLink,
    Globe,
    Loader2,
    ChevronDown,
    ChevronUp,
    Copy,
    Check,
} from 'lucide-react';
import { Address } from '@ton/core';
import { cn } from '../lib/utils';
import type { NftItem } from '../nft/types';
import { DomainService } from '../nft/DomainService';
import NftSendModal from './NftSendModal';

interface NftDetailModalProps {
    isOpen: boolean;
    item: NftItem | null;
    onClose: () => void;
    darkMode: boolean;
    language: string;
    ownerAddress: string;
    network: 'mainnet' | 'testnet';
    onSend?: (params: {
        item: NftItem;
        recipient: string;
        comment: string;
        password: string;
    }) => Promise<void>;
}

/** Getgems / Tonviewer expect bounceable user-friendly addresses (EQ…), not raw 0:hex. */
export function toNftMarketAddress(address: string, testOnly = false): string {
    return Address.parse(address).toString({
        bounceable: true,
        urlSafe: true,
        testOnly,
    });
}

function shortAddress(value: string | null | undefined, bounceable = false): string {
    if (!value) return '—';
    try {
        const friendly = Address.parse(value).toString({ bounceable, urlSafe: true });
        return `${friendly.slice(0, 4)}…${friendly.slice(-4)}`;
    } catch {
        if (value.length < 12) return value;
        return `${value.slice(0, 4)}…${value.slice(-4)}`;
    }
}

function formatExpiryDate(unix: number | null, language: string): string {
    if (unix == null) return '—';
    return new Date(unix * 1000).toLocaleDateString(language === 'ar' ? 'ar' : 'en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    });
}

function daysUntil(unix: number | null): number | null {
    if (unix == null) return null;
    return Math.floor((unix * 1000 - Date.now()) / (1000 * 60 * 60 * 24));
}

export function explorerNftUrl(address: string, network: 'mainnet' | 'testnet'): string {
    const host = network === 'testnet' ? 'https://testnet.tonviewer.com' : 'https://tonviewer.com';
    return `${host}/${toNftMarketAddress(address, network === 'testnet')}`;
}

export function marketNftUrl(address: string, network: 'mainnet' | 'testnet'): string {
    if (network === 'testnet') return explorerNftUrl(address, network);
    return `https://getgems.io/nft/${toNftMarketAddress(address, false)}`;
}

function ExpandableText({
    text,
    darkMode,
    language,
}: {
    text: string;
    darkMode: boolean;
    language: string;
}) {
    const [expanded, setExpanded] = useState(false);
    const isLong = text.length > 110;
    const shown = !isLong || expanded ? text : `${text.slice(0, 110).trimEnd()}…`;
    const isAr = language === 'ar';

    return (
        <p className={cn('text-[13px] leading-relaxed', darkMode ? 'text-gray-400' : 'text-gray-500')}>
            {shown}
            {isLong && (
                <button
                    type="button"
                    onClick={() => setExpanded((v) => !v)}
                    className="ml-1 text-blue-500 font-semibold inline-flex items-center gap-0.5 align-middle"
                >
                    {expanded ? (isAr ? 'أقل' : 'Less') : (isAr ? 'المزيد' : 'More')}
                    {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </button>
            )}
        </p>
    );
}

function DetailRow({
    label,
    value,
    darkMode,
    copyValue,
}: {
    label: string;
    value: string;
    darkMode: boolean;
    copyValue?: string;
}) {
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        if (!copyValue) return;
        try {
            await navigator.clipboard.writeText(copyValue);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
        } catch {
            /* ignore */
        }
    };

    return (
        <div className="flex items-center justify-between gap-3 min-h-[42px]">
            <span className={cn('text-[13px] shrink-0', darkMode ? 'text-gray-500' : 'text-gray-400')}>{label}</span>
            <button
                type="button"
                onClick={copyValue ? () => void handleCopy() : undefined}
                disabled={!copyValue}
                className={cn(
                    'text-[13px] font-medium text-right truncate max-w-[62%] inline-flex items-center gap-1.5',
                    copyValue && 'active:opacity-70',
                    darkMode ? 'text-white' : 'text-gray-900',
                )}
            >
                <span className="truncate font-mono text-[12px] tracking-tight">{value}</span>
                {copyValue && (
                    copied
                        ? <Check size={12} className="text-green-500 shrink-0" />
                        : <Copy size={12} className={cn('shrink-0', darkMode ? 'text-gray-500' : 'text-gray-400')} />
                )}
            </button>
        </div>
    );
}

function useWalletShell(isOpen: boolean): HTMLElement | null {
    const [shell, setShell] = useState<HTMLElement | null>(() =>
        typeof document !== 'undefined'
            ? document.querySelector<HTMLElement>('[data-wallet-shell]')
            : null,
    );

    useEffect(() => {
        if (!isOpen && shell) return;
        setShell(document.querySelector<HTMLElement>('[data-wallet-shell]'));
    }, [isOpen, shell]);

    return shell;
}

export default function NftDetailModal({
    isOpen,
    item,
    onClose,
    darkMode,
    language,
    ownerAddress,
    network,
    onSend,
}: NftDetailModalProps) {
    const isAr = language === 'ar';
    const shell = useWalletShell(isOpen);
    const [showSend, setShowSend] = useState(false);
    const [enriched, setEnriched] = useState<NftItem | null>(null);
    const [enriching, setEnriching] = useState(false);

    useEffect(() => {
        if (!isOpen || !item) {
            setEnriched(null);
            setShowSend(false);
            return;
        }
        setEnriched(item);
        if (item.kind !== 'domain' || !item.domainName) return;

        let cancelled = false;
        setEnriching(true);
        void (async () => {
            try {
                const dns = new DomainService({ network });
                const info = await dns.resolve(item.domainName!);
                if (cancelled || !info) return;
                setEnriched(Object.freeze({
                    ...item,
                    linkedAddress: info.linkedAddress,
                    domainExpiresAtUnix: info.expiresAtUnix,
                    ownerAddress: info.ownerAddress || item.ownerAddress,
                }));
            } finally {
                if (!cancelled) setEnriching(false);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [isOpen, item, network]);

    const display = enriched ?? item;
    if (!display) return null;

    const title = display.metadata.name ?? display.domainName ?? shortAddress(display.address, true);
    const collectionName = display.collection?.name
        ?? (display.kind === 'domain' ? 'TON DNS Domains' : null);
    const collectionDescription = display.collection?.description
        ?? (display.kind === 'domain' ? '*.ton domains' : null);
    const daysLeft = daysUntil(display.domainExpiresAtUnix);
    const contractFriendly = (() => {
        try {
            return toNftMarketAddress(display.address, network === 'testnet');
        } catch {
            return display.address;
        }
    })();
    const ownerFriendly = (() => {
        try {
            return Address.parse(display.ownerAddress).toString({ bounceable: false, urlSafe: true });
        } catch {
            return display.ownerAddress;
        }
    })();

    const panelBg = darkMode ? 'bg-[hsl(228,18%,7%)]' : 'bg-white';
    const secondaryBtn = cn(
        'w-full h-12 rounded-2xl text-[14px] font-semibold transition-colors inline-flex items-center justify-center gap-2',
        darkMode ? 'bg-white/[0.08] text-white active:bg-white/12' : 'bg-[#EEF0F3] text-gray-900 active:bg-gray-200',
    );

    const screen = (
        <AnimatePresence>
            {isOpen && !showSend && (
                <motion.div
                    className={cn('absolute inset-0 z-[120] flex flex-col', panelBg)}
                    initial={{ x: '100%' }}
                    animate={{ x: 0 }}
                    exit={{ x: '100%' }}
                    transition={{ type: 'spring', stiffness: 420, damping: 38 }}
                >
                    {/* Top bar */}
                    <div className="shrink-0 flex items-center px-3 pt-3 pb-1">
                        <button
                            type="button"
                            onClick={onClose}
                            className={cn(
                                'w-9 h-9 rounded-full flex items-center justify-center',
                                darkMode ? 'text-white hover:bg-white/10' : 'text-gray-800 hover:bg-black/5',
                            )}
                        >
                            <ChevronLeft size={22} />
                        </button>
                    </div>

                    {/* Scrollable body — scrollbar hidden */}
                    <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar">
                        <div className="px-4">
                            {/* Image — Tonkeeper-style inset rounded preview */}
                            <div className={cn(
                                'relative w-full aspect-square rounded-2xl overflow-hidden',
                                darkMode ? 'bg-white/5' : 'bg-gray-100',
                            )}>
                                {display.metadata.image ? (
                                    <img
                                        src={display.metadata.image}
                                        alt={title}
                                        className="w-full h-full object-cover"
                                    />
                                ) : display.kind === 'domain' ? (
                                    <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-gradient-to-b from-white to-gray-100 text-gray-900">
                                        <Globe size={28} className="text-gray-700" />
                                        <p className="text-lg font-bold px-4 text-center">{title}</p>
                                        <span className="text-xs text-gray-500 flex items-center gap-1">
                                            TON DNS <BadgeCheck size={12} className="text-blue-500" />
                                        </span>
                                    </div>
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-blue-900/30 to-purple-900/30">
                                        <Package size={40} className="text-blue-400/50" />
                                    </div>
                                )}
                            </div>

                            <h1 className={cn(
                                'mt-4 text-[22px] font-bold leading-snug tracking-tight break-words',
                                darkMode ? 'text-white' : 'text-gray-900',
                            )}>
                                {title}
                            </h1>

                            {collectionName && (
                                <p className={cn(
                                    'mt-1 text-[13px] font-medium flex items-center gap-1',
                                    darkMode ? 'text-gray-400' : 'text-gray-500',
                                )}>
                                    {collectionName}
                                    {(display.verified || display.kind === 'domain') && (
                                        <BadgeCheck size={14} className="text-blue-500" />
                                    )}
                                </p>
                            )}

                            {display.metadata.description && (
                                <div className="mt-2.5">
                                    <ExpandableText
                                        text={display.metadata.description}
                                        darkMode={darkMode}
                                        language={language}
                                    />
                                </div>
                            )}

                            {collectionDescription
                                && collectionDescription !== display.metadata.description
                                && (
                                    <div className="mt-5">
                                        <p className={cn(
                                            'text-[15px] font-semibold mb-1',
                                            darkMode ? 'text-white' : 'text-gray-900',
                                        )}>
                                            {isAr ? 'عن المجموعة' : 'About collection'}
                                        </p>
                                        <ExpandableText
                                            text={collectionDescription}
                                            darkMode={darkMode}
                                            language={language}
                                        />
                                    </div>
                                )}

                            {display.kind === 'domain' && daysLeft != null && (
                                <p className={cn('text-center text-xs mt-4', darkMode ? 'text-gray-500' : 'text-gray-400')}>
                                    {enriching ? (
                                        <span className="inline-flex items-center gap-1">
                                            <Loader2 size={12} className="animate-spin" />
                                            {isAr ? 'جاري التحديث…' : 'Updating…'}
                                        </span>
                                    ) : daysLeft > 0
                                        ? (isAr ? `ينتهي خلال ${daysLeft} يوم` : `Expires in ${daysLeft} days`)
                                        : (isAr ? 'منتهي' : 'Expired')}
                                </p>
                            )}

                            <div className="mt-6 mb-2">
                                <div className="flex items-center justify-between mb-2">
                                    <p className={cn(
                                        'text-[15px] font-semibold',
                                        darkMode ? 'text-white' : 'text-gray-900',
                                    )}>
                                        {isAr ? 'التفاصيل' : 'Details'}
                                    </p>
                                    <a
                                        href={explorerNftUrl(display.address, network)}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-[13px] text-blue-500 font-semibold inline-flex items-center gap-1"
                                    >
                                        {isAr ? 'عرض المعاملة' : 'View Transaction'}
                                        <ExternalLink size={12} />
                                    </a>
                                </div>

                                <div className="space-y-0.5">
                                    <DetailRow
                                        label={isAr ? 'المالك' : 'Owner'}
                                        value={shortAddress(display.ownerAddress, false)}
                                        copyValue={ownerFriendly}
                                        darkMode={darkMode}
                                    />
                                    {display.kind === 'domain' && (
                                        <DetailRow
                                            label={isAr ? 'تاريخ الانتهاء' : 'Expiration date'}
                                            value={formatExpiryDate(display.domainExpiresAtUnix, language)}
                                            darkMode={darkMode}
                                        />
                                    )}
                                    <DetailRow
                                        label={isAr ? 'عنوان العقد' : 'Contract address'}
                                        value={shortAddress(display.address, true)}
                                        copyValue={contractFriendly}
                                        darkMode={darkMode}
                                    />
                                    {display.metadata.attributes.map((attr) => (
                                        <DetailRow
                                            key={`${attr.trait_type}:${attr.value}`}
                                            label={attr.trait_type}
                                            value={attr.value}
                                            darkMode={darkMode}
                                        />
                                    ))}
                                </div>
                            </div>

                            {/* Scroll breathing room above sticky footer */}
                            <div className="h-4" />
                        </div>
                    </div>

                    {/* Sticky actions — always visible, never clipped */}
                    <div className={cn(
                        'shrink-0 px-4 pt-3 pb-5 space-y-2.5 border-t',
                        darkMode
                            ? 'border-white/[0.06] bg-[hsl(228,18%,7%)]'
                            : 'border-black/[0.05] bg-white',
                    )}>
                        <button
                            type="button"
                            onClick={() => setShowSend(true)}
                            className="w-full h-12 rounded-2xl bg-blue-500 text-white text-[14px] font-semibold hover:bg-blue-600 active:scale-[0.99] transition-all"
                        >
                            {isAr ? 'تحويل' : 'Transfer'}
                        </button>
                        <a
                            href={marketNftUrl(display.address, network)}
                            target="_blank"
                            rel="noreferrer"
                            className={secondaryBtn}
                        >
                            {isAr ? 'عرض في سوق NFT' : 'View on NFT Market'}
                            <ExternalLink size={14} className="opacity-60" />
                        </a>
                        {display.kind === 'domain' && display.linkedAddress && (
                            <div className={secondaryBtn}>
                                {isAr ? 'مرتبط بـ' : 'Linked with'} {shortAddress(display.linkedAddress)}
                            </div>
                        )}
                        {display.kind === 'domain' && display.domainExpiresAtUnix != null && (
                            <div className={secondaryBtn}>
                                {isAr ? 'تجديد حتى' : 'Renew until'}{' '}
                                {formatExpiryDate(display.domainExpiresAtUnix, language)}
                            </div>
                        )}
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );

    return (
        <>
            {shell ? createPortal(screen, shell) : null}

            <NftSendModal
                isOpen={showSend}
                item={display}
                onClose={() => setShowSend(false)}
                darkMode={darkMode}
                language={language}
                ownerAddress={ownerAddress}
                onSend={onSend}
            />
        </>
    );
}
