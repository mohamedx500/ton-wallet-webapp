import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { X, Copy, ExternalLink, ArrowDown, ArrowUp, Check, Eye, EyeOff, Loader2, Share2, Wallet, TriangleAlert, ChevronRight, ArrowLeftRight, XCircle, Lock, TrendingUp } from 'lucide-react';
import { cn } from '../lib/utils';
import { TON_TOKENS } from '../services/SwapService';

interface BaseModalProps {
    isOpen: boolean;
    onClose: () => void;
    darkMode: boolean;
    language: string;
}

interface ReceiveModalProps extends BaseModalProps {
    walletAddress: string;
    handleCopy: () => void;
    copied: boolean;
}

interface PhraseModalProps extends BaseModalProps {
    seedPhrase: string[];
    handleCopyPhrase: () => void;
    copiedPhrase: boolean;
}

interface TransactionModalProps {
    transaction: any;
    onClose: () => void;
    darkMode: boolean;
    language: string;
}

interface PasswordPromptModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (password: string) => void;
    darkMode: boolean;
    language: string;
    isLoading?: boolean;
    error?: string;
}

interface SelectWalletTypeModalProps {
    isOpen: boolean;
    onClose: () => void;
    currentType: string;
    onSelect: (type: string) => void;
    darkMode: boolean;
    language: string;
}

// CoinGecko ID mapping for price charts
const COINGECKO_IDS: Record<string, string> = {
    'TON': 'the-open-network',
    'USDT': 'tether',
    'USDC': 'usd-coin',
    'BTC': 'bitcoin',
    'ETH': 'ethereum',
    'NOT': 'notcoin',
    'DOGS': 'dogs-2',
    'MAJOR': 'major',
    'HMSTR': 'hamster-kombat',
};

const STABLECOINS = ['USDT', 'USDC', 'DAI', 'TUSD', 'BUSD', 'USDP', 'FRAX'];

const TIME_PERIODS = [
    { id: '15m', label: '15m', days: '1', note: '15 min' },
    { id: '1h', label: '1H', days: '1', note: '1 hour' },
    { id: '4h', label: '4H', days: '1', note: '4 hours' },
    { id: '1d', label: '1D', days: '1', note: '1 day' },
    { id: '1w', label: '1W', days: '7', note: '7 days' },
    { id: '1m', label: '1M', days: '30', note: '30 days' },
    { id: 'all', label: 'ALL', days: '365', note: '1 year' },
] as const;

interface PriceSparklineProps {
    symbol: string;
    darkMode: boolean;
    currentPrice?: number;
    diff?: string;
}

function PriceSparkline({ symbol, darkMode, currentPrice, diff }: PriceSparklineProps) {
    const [rawPrices, setRawPrices] = useState<[number, number][]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [period, setPeriod] = useState<string>('1d');
    const [hoverIdx, setHoverIdx] = useState<number | null>(null);
    const svgRef = useRef<SVGSVGElement>(null);

    useEffect(() => {
        setLoading(true);
        setError(false);
        setHoverIdx(null);

        const cgId = COINGECKO_IDS[symbol];
        if (!cgId) { setLoading(false); setError(true); return; }

        const cfg = TIME_PERIODS.find(t => t.id === period) || TIME_PERIODS[4];

        fetch(`https://api.coingecko.com/api/v3/coins/${cgId}/market_chart?vs_currency=usd&days=${cfg.days}`)
            .then(r => {
                if (!r.ok) throw new Error('API error');
                return r.json();
            })
            .then(data => {
                if (data.error) { setError(true); setLoading(false); return; }
                if (data.prices && Array.isArray(data.prices) && data.prices.length > 0) {
                    let pts = data.prices as [number, number][];
                    const now = Date.now();
                    if (period === '15m') pts = pts.filter(p => now - p[0] <= 15 * 60 * 1000);
                    else if (period === '1h') pts = pts.filter(p => now - p[0] <= 60 * 60 * 1000);
                    else if (period === '4h') pts = pts.filter(p => now - p[0] <= 4 * 60 * 60 * 1000);

                    if (pts.length < 2) {
                        // If filtered too aggressively, take last N points from the full dataset
                        const needed = period === '15m' ? 4 : period === '1h' ? 12 : 20;
                        pts = data.prices.slice(-Math.min(needed, data.prices.length));
                    }

                    const step = Math.max(1, Math.floor(pts.length / 80));
                    setRawPrices(pts.filter((_, i) => i % step === 0 || i === pts.length - 1));
                } else {
                    setError(true);
                }
                setLoading(false);
            })
            .catch(() => { setError(true); setLoading(false); });
    }, [symbol, period]);

    const prices = rawPrices.map(p => p[1]);
    const isUp = prices.length >= 2 ? prices[prices.length - 1] >= prices[0] : !diff?.includes('-');
    const pctChange = prices.length >= 2 ? ((prices[prices.length - 1] - prices[0]) / prices[0] * 100) : 0;

    const formatTime = (ts: number) => {
        const d = new Date(ts);
        if (period === '15m' || period === '1h' || period === '4h' || period === '1d') return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        if (period === '1w') return d.toLocaleDateString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
        return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    };

    // Shared price header (always visible)
    const priceHeader = (
        <div className="flex items-center justify-between mb-3">
            <div>
                {hoverIdx !== null && prices.length > 0 ? (
                    <>
                        <span className={cn("text-2xl font-bold tabular-nums", darkMode ? "text-white" : "text-black")}>
                            ${(hoverIdx !== null ? rawPrices[hoverIdx]?.[1] : currentPrice)?.toFixed(currentPrice && currentPrice < 0.01 ? 6 : 2)}
                        </span>
                        <p className={cn("text-xs mt-0.5 font-medium", darkMode ? "text-gray-500" : "text-gray-600")}>
                            {formatTime(rawPrices[hoverIdx]?.[0] || 0)}
                        </p>
                    </>
                ) : (
                    <>
                        <span className={cn("text-2xl font-bold tabular-nums", darkMode ? "text-white" : "text-black")}>
                            ${currentPrice?.toFixed(currentPrice < 0.01 ? 6 : 2) || '—'}
                        </span>
                        <p className={cn("text-xs mt-0.5 font-medium", darkMode ? "text-gray-500" : "text-gray-600")}>
                            Current Price
                        </p>
                    </>
                )}
            </div>
            <div className={cn(
                "flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold",
                (hoverIdx !== null ? (rawPrices[hoverIdx]?.[1] || 0) >= (rawPrices[0]?.[1] || 0) : isUp)
                    ? "text-green-500 bg-green-500/10"
                    : "text-red-500 bg-red-500/10"
            )}>
                {(hoverIdx !== null ? (rawPrices[hoverIdx]?.[1] || 0) >= (rawPrices[0]?.[1] || 0) : isUp)
                    ? <ArrowDown className="rotate-180" size={12} />
                    : <ArrowDown size={12} />
                }
                <span className="tabular-nums">
                    {hoverIdx !== null && prices.length >= 2
                        ? `${Math.abs(((rawPrices[hoverIdx]?.[1] || 0) - rawPrices[0][1]) / rawPrices[0][1] * 100).toFixed(2)}%`
                        : diff ? String(diff).replace('-', '') : `${Math.abs(pctChange).toFixed(2)}%`
                    }
                </span>
            </div>
        </div>
    );

    // Time period selector with animated indicator
    const periodSelector = (
        <div className={cn("p-1 flex gap-0.5 rounded-xl mb-3", darkMode ? "bg-white/[0.03] ring-1 ring-white/[0.06]" : "bg-gray-100/60 ring-1 ring-black/[0.03]")}>
            {TIME_PERIODS.map(t => (
                <button
                    key={t.id}
                    onClick={() => setPeriod(t.id)}
                    className={cn(
                        "relative flex-1 py-1 rounded-lg text-[10px] font-bold transition-colors z-[1]",
                        period === t.id ? "text-white" : darkMode ? "text-gray-500 hover:text-gray-300" : "text-gray-400 hover:text-gray-600"
                    )}
                >
                    {period === t.id && (
                        <motion.div
                            layoutId="chartPeriodBg"
                            className="absolute inset-0 rounded-lg bg-gradient-to-r from-blue-500 to-blue-600 shadow-sm"
                            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                        />
                    )}
                    <span className="relative z-[1]">{t.label}</span>
                </button>
            ))}
        </div>
    );

    if (loading) {
        return (
            <div className="w-full">
                {priceHeader}
                {periodSelector}
                <div className="flex items-center justify-center h-24">
                    <Loader2 size={18} className={cn("animate-spin", darkMode ? "text-gray-600" : "text-gray-300")} />
                </div>
            </div>
        );
    }

    if (error || prices.length < 2) {
        return (
            <div className="w-full">
                {priceHeader}
                {periodSelector}
                <div className={cn("flex items-center justify-center h-24 text-xs", darkMode ? "text-gray-600" : "text-gray-400")}>
                    No data available
                </div>
            </div>
        );
    }

    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max - min || 1;
    const w = 300;
    const h = 90;

    const pointCoords = prices.map((p, i) => ({
        x: (i / (prices.length - 1)) * w,
        y: h - ((p - min) / range) * (h - 8) - 4,
        price: p,
        time: rawPrices[i]?.[0] || 0,
    }));

    const polyPoints = pointCoords.map(p => `${p.x},${p.y}`).join(' ');
    const lineColor = isUp ? (darkMode ? '#22c55e' : '#16a34a') : (darkMode ? '#ef4444' : '#dc2626');
    const gradientId = `spark-${symbol}-${period}`;

    const handleSvgInteraction = (e: React.MouseEvent<SVGSVGElement> | React.TouchEvent<SVGSVGElement>) => {
        if (!svgRef.current || pointCoords.length === 0) return;
        const rect = svgRef.current.getBoundingClientRect();
        const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
        const relX = (clientX - rect.left) / rect.width;
        const idx = Math.round(relX * (pointCoords.length - 1));
        setHoverIdx(Math.max(0, Math.min(idx, pointCoords.length - 1)));
    };

    const hoverPoint = hoverIdx !== null ? pointCoords[hoverIdx] : null;

    return (
        <div className="w-full">
            {priceHeader}
            {periodSelector}

            {/* Chart */}
            <svg
                ref={svgRef}
                viewBox={`0 0 ${w} ${h}`}
                className="w-full h-24 cursor-crosshair"
                preserveAspectRatio="none"
                onMouseMove={handleSvgInteraction}
                onTouchMove={handleSvgInteraction}
                onMouseLeave={() => setHoverIdx(null)}
                onTouchEnd={() => setHoverIdx(null)}
            >
                <defs>
                    <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={lineColor} stopOpacity="0.2" />
                        <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
                    </linearGradient>
                </defs>
                <polygon
                    points={`0,${h} ${polyPoints} ${w},${h}`}
                    fill={`url(#${gradientId})`}
                />
                <polyline
                    points={polyPoints}
                    fill="none"
                    stroke={lineColor}
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
                {hoverPoint && (
                    <>
                        <line x1={hoverPoint.x} y1={0} x2={hoverPoint.x} y2={h} stroke={darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)'} strokeWidth="1" strokeDasharray="3,3" />
                        <circle cx={hoverPoint.x} cy={hoverPoint.y} r="4" fill={lineColor} stroke={darkMode ? '#1a1a2e' : '#fff'} strokeWidth="2" />
                    </>
                )}
            </svg>
        </div>
    );
}

interface TokenDetailsModalProps {
    isOpen: boolean;
    onClose: () => void;
    token: any; // { name, symbol, balance, value, icon, price }
    transactions: any[];
    darkMode: boolean;
    language: string;
    onSend?: () => void;
    onReceive?: () => void;
}

// Token Details Modal
export function TokenDetailsModal({ isOpen, onClose, token, transactions, darkMode, language, onSend, onReceive }: TokenDetailsModalProps) {
    if (!isOpen || !token) return null;

    // Filter transactions for this token
    // Include: regular transfers, swaps involving this token (either from or to), deposits, and withdrawals
    const tokenTxs = transactions.filter(tx => {
        // Regular token transfers (sent/received)
        if (tx.token === token.symbol || (token.symbol === 'TON' && !tx.token)) {
            return true;
        }

        // Swap transactions - include if token is either input or output
        if (tx.type === 'swap') {
            return tx.fromToken === token.symbol || tx.toToken === token.symbol;
        }

        // Deposit/Withdrawal - check jetton field as well
        if (tx.jetton === token.symbol) {
            return true;
        }

        return false;
    });

    return (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-end justify-center z-50 pointer-events-auto" onClick={onClose}>
            <div className={cn("w-full max-w-md rounded-t-3xl p-6 h-[80vh] flex flex-col animate-slide-up", darkMode ? "bg-[hsl(224,20%,8%)] ring-1 ring-white/5" : "bg-white/95 backdrop-blur-xl ring-1 ring-black/5")} onClick={(e) => e.stopPropagation()}>
                <div className={cn("w-10 h-1 rounded-full mx-auto mb-6 shrink-0", darkMode ? "bg-white/10" : "bg-gray-200")}></div>

                {/* Header */}
                {/* Header */}
                <div className="flex flex-col items-center mb-8 shrink-0">
                    <div className={cn("w-20 h-20 rounded-full flex items-center justify-center p-1 mb-4 ring-1", darkMode ? "bg-white/5 ring-white/10" : "bg-gray-50 ring-black/5")}>
                        <div className={cn("w-full h-full rounded-full overflow-hidden flex items-center justify-center", darkMode ? "bg-white/5" : "bg-white")}>
                            {token.icon && token.icon.startsWith && token.icon.startsWith('http') ? (
                                <img src={token.icon} alt={token.symbol} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).src = 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ton/info/logo.png'; }} />
                            ) : (
                                <span className="text-4xl">{token.icon}</span>
                            )}
                        </div>
                    </div>

                    <h3 className={cn("text-3xl font-bold mb-1", darkMode ? "text-white" : "text-black")}>
                        {token.balance} <span className="text-blue-500">{token.symbol}</span>
                    </h3>

                    <p className={cn("text-base font-semibold", darkMode ? "text-gray-400" : "text-gray-600")}>
                        {token.value}
                    </p>
                </div>

                {/* Price Chart with integrated price display - hidden for stablecoins */}
                {!STABLECOINS.includes(token.symbol) && (
                    <div className="glass-card p-4 mb-4 shrink-0">
                        <PriceSparkline symbol={token.symbol} darkMode={darkMode} currentPrice={token.price} diff={token.diff} />
                    </div>
                )}

                {/* Actions */}
                <div className="flex gap-3 mb-6 shrink-0">
                    <button
                        onClick={() => { onClose(); onSend?.(); }}
                        className="flex-1 bg-gradient-to-r from-blue-500 to-blue-600 text-white py-3 rounded-2xl font-semibold text-sm hover:from-blue-600 hover:to-blue-700 transition-all shadow-lg shadow-blue-500/20 active:scale-[0.98]"
                    >
                        {language === 'ar' ? 'إرسال' : 'Send'}
                    </button>
                    <button
                        onClick={() => { onClose(); onReceive?.(); }}
                        className="flex-1 bg-gradient-to-r from-green-500 to-green-600 text-white py-3 rounded-2xl font-semibold text-sm hover:from-green-600 hover:to-green-700 transition-all shadow-lg shadow-green-500/20 active:scale-[0.98]"
                    >
                        {language === 'ar' ? 'استلام' : 'Receive'}
                    </button>
                </div>

                {/* History */}
                <div className="flex-1 overflow-auto no-scrollbar">
                    <h4 className={cn("font-bold text-sm mb-3", darkMode ? "text-white" : "text-gray-800")}>
                        {language === 'ar' ? 'النشاط الأخير' : 'Recent Activity'}
                    </h4>
                    {tokenTxs.length > 0 ? (
                        <div className={cn("glass-card divide-y overflow-hidden", darkMode ? "divide-white/[0.06]" : "divide-black/[0.04]")}>
                            {tokenTxs.map((tx, i) => (
                                <div key={i} className={cn("flex items-center justify-between px-4 py-3", darkMode ? "hover:bg-white/[0.02]" : "hover:bg-black/[0.01]")}>
                                    <div className="flex items-center gap-3">
                                        <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center ring-1",
                                            tx.status === 'failed'
                                                ? (darkMode ? 'bg-red-500/10 text-red-400 ring-red-500/20' : 'bg-red-50 text-red-500 ring-red-100')
                                                : tx.type === 'received'
                                                    ? (darkMode ? 'bg-green-500/10 text-green-400 ring-green-500/20' : 'bg-green-50 text-green-600 ring-green-100')
                                                    : tx.type === 'swap'
                                                        ? (darkMode ? 'bg-blue-500/10 text-blue-400 ring-blue-500/20' : 'bg-blue-50 text-blue-600 ring-blue-100')
                                                        : (darkMode ? 'bg-white/5 text-gray-400 ring-white/10' : 'bg-gray-50 text-gray-500 ring-gray-100')
                                        )}>
                                            {tx.status === 'failed' ? <XCircle size={16} /> :
                                                tx.type === 'received' ? <ArrowDown size={16} /> :
                                                    tx.type === 'swap' ? <ArrowLeftRight size={16} /> :
                                                        <ArrowUp size={16} />}
                                        </div>
                                        <div>
                                            <p className={cn("text-sm font-semibold", darkMode ? "text-white" : "text-gray-800")}>
                                                {tx.status === 'failed' ? (language === 'ar' ? 'فشل' : 'Failed') :
                                                    tx.type === 'received' ? (language === 'ar' ? 'استلام' : 'Received') :
                                                        tx.type === 'swap' ? (language === 'ar' ? 'مبادلة' : 'Swap') :
                                                            (language === 'ar' ? 'إرسال' : 'Sent')}
                                            </p>
                                            <p className={cn("text-[11px]", darkMode ? "text-gray-600" : "text-gray-400")}>{tx.time}</p>
                                        </div>
                                    </div>
                                    <span className={cn("font-bold text-sm tabular-nums",
                                        tx.status === 'failed' ? 'text-red-500' :
                                        tx.type === 'received' ? 'text-green-500' :
                                        darkMode ? 'text-white' : 'text-gray-900'
                                    )}>
                                        {tx.type === 'received' ? '+' : tx.type === 'swap' ? '' : '-'}{tx.amount || '0.00'} {token.symbol}
                                    </span>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className={cn("glass-card text-center py-10", darkMode ? "text-gray-600" : "text-gray-400")}>
                            <p className="text-sm">No transactions</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// Select Wallet Type Modal
export function SelectWalletTypeModal({ isOpen, onClose, currentType, onSelect, darkMode, language }: SelectWalletTypeModalProps) {
    if (!isOpen) return null;

    const types = [
        { id: 'v5r1', name: 'Wallet V5R1', desc: 'Newest standard, low fees' },
        { id: 'v4r2', name: 'Wallet V4R2', desc: 'Standard usage' },
        { id: 'v3r2', name: 'Wallet V3R2', desc: 'Legacy version' },
        { id: 'highload-v3', name: 'Highload V3', desc: 'For high throughput' },
    ];

    return (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-end justify-center z-50" onClick={onClose}>
            <div className={cn("w-full max-w-md rounded-t-3xl p-6 animate-slide-up", darkMode ? "bg-[hsl(224,20%,8%)] ring-1 ring-white/5" : "bg-white/95 backdrop-blur-xl ring-1 ring-black/5")} onClick={(e) => e.stopPropagation()}>
                <div className={cn("w-10 h-1 rounded-full mx-auto mb-5", darkMode ? "bg-white/10" : "bg-gray-200")}></div>
                <h3 className={cn("text-base font-bold mb-4", darkMode ? "text-white" : "text-gray-900")}>
                    {language === 'ar' ? 'نوع المحفظة' : 'Wallet Version'}
                </h3>

                <div className="space-y-1.5">
                    {types.map((t) => (
                        <button
                            key={t.id}
                            onClick={() => onSelect(t.id)}
                            className={cn(
                                "w-full p-3.5 rounded-2xl flex items-center justify-between transition-all active:scale-[0.98]",
                                currentType === t.id
                                    ? darkMode ? "bg-blue-500/10 ring-1 ring-blue-500/30" : "bg-blue-50 ring-1 ring-blue-200"
                                    : darkMode ? "hover:bg-white/5" : "hover:bg-gray-50"
                            )}
                        >
                            <div className="text-left">
                                <p className={cn("text-sm font-semibold", currentType === t.id ? "text-blue-500" : darkMode ? "text-white" : "text-gray-900")}>
                                    {t.name}
                                </p>
                                <p className={cn("text-[11px]", darkMode ? "text-gray-500" : "text-gray-400")}>
                                    {t.desc}
                                </p>
                            </div>
                            {currentType === t.id && <Check className="text-blue-500" size={16} />}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}

// Password Prompt Modal
export function PasswordPromptModal({ isOpen, onClose, onConfirm, darkMode, language, isLoading, error }: PasswordPromptModalProps) {
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onConfirm(password);
        setPassword('');
    };

    return (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className={cn("w-full max-w-sm rounded-3xl p-6 animate-scale-in", darkMode ? "bg-[hsl(224,20%,8%)] ring-1 ring-white/5" : "bg-white/95 backdrop-blur-xl ring-1 ring-black/5")} onClick={(e) => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-5">
                    <h3 className={cn("text-base font-bold", darkMode ? "text-white" : "text-gray-900")}>
                        {language === 'ar' ? 'تأكيد كلمة المرور' : 'Confirm Password'}
                    </h3>
                    <button onClick={onClose} className={cn("p-1.5 rounded-xl transition", darkMode ? "hover:bg-white/5 text-gray-500" : "hover:bg-gray-100 text-gray-400")}>
                        <X size={18} />
                    </button>
                </div>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <p className={cn("text-xs", darkMode ? "text-gray-500" : "text-gray-400")}>
                        {language === 'ar' ? 'يرجى إدخال كلمة المرور لتأكيد المعاملة.' : 'Enter your password to confirm.'}
                    </p>
                    <div className="relative">
                        <Lock size={16} className={cn("absolute left-4 top-1/2 -translate-y-1/2", darkMode ? "text-gray-500" : "text-gray-400")} />
                        <input
                            type={showPassword ? 'text' : 'password'}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder={language === 'ar' ? 'كلمة المرور' : 'Password'}
                            className={cn("w-full pl-11 pr-12 py-3.5 rounded-2xl text-sm font-medium outline-none transition-all", darkMode ? "bg-white/5 border border-white/10 text-white placeholder:text-gray-500 focus:border-blue-500/50" : "bg-white/70 border border-gray-200/80 text-gray-900 placeholder:text-gray-400 focus:border-blue-400")}
                            autoFocus
                        />
                        <button type="button" onClick={() => setShowPassword(!showPassword)} className={cn("absolute right-4 top-1/2 -translate-y-1/2", darkMode ? "text-gray-500 hover:text-gray-300" : "text-gray-400 hover:text-gray-600")}>
                            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                    </div>
                    {error && <p className="text-red-500 text-xs text-center font-medium">{error}</p>}
                    <button disabled={isLoading} className="w-full bg-gradient-to-r from-blue-500 to-blue-600 text-white py-3.5 rounded-2xl font-semibold text-sm transition-all flex justify-center shadow-lg shadow-blue-500/20 active:scale-[0.98]">
                        {isLoading ? <Loader2 size={20} className="animate-spin" /> : (language === 'ar' ? 'تأكيد' : 'Confirm')}
                    </button>
                </form>
            </div>
        </div>
    );
}

interface SendModalProps extends BaseModalProps {
    onSend: (address: string, amount: string, comment?: string, token?: any) => void;
    tokens?: any[];
    walletAddress?: string;
}

// Send Modal
export function SendModal({ isOpen, onClose, darkMode, language, onSend, tokens = [], walletAddress }: SendModalProps) {
    const [step, setStep] = useState(1);
    const [address, setAddress] = useState('');
    const [comment, setComment] = useState('');
    const [amount, setAmount] = useState('');
    const [selectedAsset, setSelectedAsset] = useState<any>(null); // null = TON
    const [addressError, setAddressError] = useState('');

    // Validate TON address (EQ/UQ format, 48 chars, or .ton domain)
    const isValidTonAddress = (addr: string): boolean => {
        if (!addr) return false;
        // .ton domain
        if (addr.toLowerCase().endsWith('.ton')) return true;
        // Raw address: starts with EQ or UQ, 48 characters, base64
        const tonAddrRegex = /^(EQ|UQ)[a-zA-Z0-9_-]{46}$/;
        return tonAddrRegex.test(addr);
    };

    if (!isOpen) return null;

    // Reset on close... ideally in useEffect or wrapper
    // simplifying for now

    const handleNext = () => {
        if (step === 1) {
            if (!isValidTonAddress(address)) {
                setAddressError(language === 'ar' ? 'عنوان غير صالح' : 'Invalid TON address');
                return;
            }
            setAddressError('');
        }
        setStep(prev => prev + 1);
    };
    const handleBack = () => setStep(prev => prev - 1);

    // Default to TON if nothing selected, get the actual TON balance from tokens
    const tonToken = tokens.find(t => t.symbol === 'TON');
    const currentAsset = selectedAsset || {
        symbol: 'TON',
        icon: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ton/info/logo.png',
        balance: tonToken?.balance || '0.00',
        price: tonToken?.price || 0
    };

    return (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className={cn("w-full max-w-sm rounded-3xl p-6 animate-scale-in shadow-2xl relative overflow-hidden", darkMode ? "bg-[hsl(224,20%,8%)] ring-1 ring-white/5" : "bg-white/95 backdrop-blur-xl ring-1 ring-black/5")} onClick={(e) => e.stopPropagation()}>

                {/* Header with Back Button */}
                <div className="flex items-center justify-between mb-5">
                    {step > 1 ? (
                        <button onClick={handleBack} className={cn("p-2 rounded-xl transition", darkMode ? "hover:bg-white/5 text-gray-500" : "hover:bg-gray-100 text-gray-400")}>
                            <ArrowDown className="rotate-90" size={20} />
                        </button>
                    ) : <div className="w-9" />} {/* Spacer */}

                    <h3 className={cn("text-base font-bold", darkMode ? "text-white" : "text-gray-900")}>
                        {step === 1 && (language === 'ar' ? 'المستلم' : 'Recipient')}
                        {step === 2 && (language === 'ar' ? 'المبلغ' : 'Amount')}
                        {step === 3 && (language === 'ar' ? 'مراجعة' : 'Review')}
                    </h3>

                    <button onClick={onClose} className={cn("p-2 rounded-xl transition", darkMode ? "hover:bg-white/5 text-gray-500" : "hover:bg-gray-100 text-gray-400")}>
                        <X size={20} />
                    </button>
                </div>

                {/* Content based on Step */}
                <div className="min-h-[300px] flex flex-col">

                    {/* STEP 1: Address & Comment */}
                    {step === 1 && (
                        <div className="space-y-4 flex-1">
                            <div className="glass-card p-4">
                                <label className={cn("block text-[10px] font-bold uppercase tracking-wider mb-2", darkMode ? "text-gray-500" : "text-gray-400")}>
                                    {language === 'ar' ? 'إلى عنوان' : 'To Address'}
                                </label>
                                <input
                                    type="text"
                                    placeholder={language === 'ar' ? 'العنوان أو النطاق (.ton)...' : 'Address or domain (.ton)...'}
                                    value={address}
                                    onChange={(e) => { setAddress(e.target.value); setAddressError(''); }}
                                    className={cn("w-full px-3.5 py-3 rounded-xl font-mono text-sm outline-none transition-all", darkMode ? "bg-white/5 text-white placeholder:text-gray-600 ring-1 ring-white/10 focus:ring-blue-500/50" : "bg-gray-50 text-gray-900 placeholder:text-gray-400 ring-1 ring-gray-200 focus:ring-blue-400")}
                                    autoFocus
                                />
                                {addressError && (
                                    <p className="text-red-500 text-[11px] mt-1.5 font-medium">{addressError}</p>
                                )}
                            </div>
                            <div className="glass-card p-4">
                                <label className={cn("block text-[10px] font-bold uppercase tracking-wider mb-2", darkMode ? "text-gray-500" : "text-gray-400")}>
                                    {language === 'ar' ? 'تعليق (اختياري)' : 'Comment (Optional)'}
                                </label>
                                <textarea
                                    value={comment}
                                    onChange={(e) => setComment(e.target.value)}
                                    placeholder={language === 'ar' ? 'رسالة للمستلم...' : 'Message for recipient...'}
                                    className={cn("w-full px-3.5 py-3 rounded-xl text-sm resize-none h-20 outline-none transition-all", darkMode ? "bg-white/5 text-white placeholder:text-gray-600 ring-1 ring-white/10 focus:ring-blue-500/50" : "bg-gray-50 text-gray-900 placeholder:text-gray-400 ring-1 ring-gray-200 focus:ring-blue-400")}
                                />
                            </div>
                        </div>
                    )}

                    {/* STEP 2: Asset & Amount */}
                    {step === 2 && (
                        <div className="flex-1 flex flex-col">
                            {/* Token Selector */}
                            <div className="mb-5">
                                <label className={cn("block text-[10px] font-bold uppercase tracking-wider mb-2 ml-1", darkMode ? "text-gray-500" : "text-gray-400")}>
                                    {language === 'ar' ? 'العملة' : 'Asset'}
                                </label>
                                <div className="flex gap-2.5 overflow-x-auto no-scrollbar">
                                    <button
                                        onClick={() => setSelectedAsset(null)}
                                        className={cn(
                                            "flex items-center gap-2 px-3 py-1.5 rounded-full transition-all flex-shrink-0",
                                            !selectedAsset
                                                ? darkMode ? "bg-blue-500/15 text-blue-400 ring-1 ring-blue-500/30" : "bg-blue-50 text-blue-600 ring-1 ring-blue-200"
                                                : darkMode ? "bg-white/[0.04] text-gray-400 hover:bg-white/[0.07]" : "bg-gray-100/80 text-gray-500 hover:bg-gray-100"
                                        )}
                                    >
                                        <div className="w-6 h-6 rounded-full overflow-hidden flex items-center justify-center flex-shrink-0">
                                            <img src="https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ton/info/logo.png" alt="TON" className="w-full h-full object-cover" />
                                        </div>
                                        <span className="font-semibold text-sm">TON</span>
                                    </button>
                                    {tokens.map((t, i) => t.symbol !== 'TON' && (
                                        <button
                                            key={i}
                                            onClick={() => setSelectedAsset(t)}
                                            className={cn(
                                                "flex items-center gap-2 px-3 py-1.5 rounded-full transition-all flex-shrink-0",
                                                selectedAsset?.symbol === t.symbol
                                                    ? darkMode ? "bg-blue-500/15 text-blue-400 ring-1 ring-blue-500/30" : "bg-blue-50 text-blue-600 ring-1 ring-blue-200"
                                                    : darkMode ? "bg-white/[0.04] text-gray-400 hover:bg-white/[0.07]" : "bg-gray-100/80 text-gray-500 hover:bg-gray-100"
                                            )}
                                        >
                                            <div className="w-6 h-6 rounded-full overflow-hidden flex items-center justify-center flex-shrink-0">
                                                {t.icon && t.icon.startsWith && t.icon.startsWith('http') ? (
                                                    <img src={t.icon} alt={t.symbol} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).src = 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ton/info/logo.png'; }} />
                                                ) : (
                                                    <span className="text-xs">{t.icon}</span>
                                                )}
                                            </div>
                                            <span className="font-semibold text-sm">{t.symbol}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Amount Section */}
                            <div className="flex-1 flex flex-col items-center justify-center">
                                <div className="w-full mb-2">
                                    <div className="flex justify-between items-center mb-1 px-1">
                                        <span className={cn("text-[10px] font-bold uppercase tracking-wider", darkMode ? "text-gray-500" : "text-gray-400")}>
                                            {language === 'ar' ? 'المبلغ' : 'Amount'}
                                        </span>
                                        <button
                                            onClick={() => setAmount(currentAsset.balance || '0')}
                                            className={cn("text-[11px] font-semibold transition-colors", darkMode ? "text-gray-500 hover:text-blue-400" : "text-gray-400 hover:text-blue-500")}
                                        >
                                            {language === 'ar' ? 'الحد الأقصى' : 'Max'}: {currentAsset.balance}
                                        </button>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <input
                                            type="number"
                                            inputMode="decimal"
                                            placeholder="0"
                                            value={amount}
                                            onChange={(e) => setAmount(e.target.value)}
                                            style={{ MozAppearance: 'textfield' }}
                                            className={cn("flex-1 min-w-0 text-4xl font-bold bg-transparent outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none", darkMode ? "text-white placeholder:text-gray-700" : "text-gray-900 placeholder:text-gray-300")}
                                            autoFocus
                                        />
                                        <span className={cn("text-lg font-bold flex-shrink-0", darkMode ? "text-gray-500" : "text-gray-400")}>{currentAsset.symbol}</span>
                                    </div>
                                    <div className={cn("h-px w-full mt-2", darkMode ? "bg-white/10" : "bg-gray-200")} />
                                    {amount && parseFloat(amount) > 0 && (
                                        <p className={cn("text-xs mt-2 px-1", darkMode ? "text-gray-600" : "text-gray-400")}>
                                            ≈ ${(parseFloat(amount) * (currentAsset.price || 0)).toFixed(2)} USD
                                        </p>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* STEP 3: Review */}
                    {step === 3 && (
                        <div className="space-y-5 flex-1">
                            <div className="flex flex-col items-center justify-center py-3">
                                <div className="w-14 h-14 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl flex items-center justify-center mb-3 shadow-lg shadow-blue-500/25">
                                    <ArrowUp size={24} className="text-white" />
                                </div>
                                <h2 className={cn("text-sm font-medium", darkMode ? "text-gray-400" : "text-gray-500")}>
                                    {language === 'ar' ? 'تأكيد الإرسال' : 'Confirm sending'}
                                </h2>
                            </div>

                            <div className={cn("glass-card divide-y overflow-hidden", darkMode ? "divide-white/[0.06]" : "divide-black/[0.04]")}>
                                {/* Recipient */}
                                <div className="flex justify-between items-center px-4 py-3">
                                    <span className={cn("text-xs", darkMode ? "text-gray-500" : "text-gray-400")}>{language === 'ar' ? 'المستلم' : 'To'}</span>
                                    <span className={cn("font-bold text-sm font-mono", darkMode ? "text-white" : "text-gray-900")}>
                                        {address.slice(0, 6)}...{address.slice(-4)}
                                    </span>
                                </div>

                                {/* Amount */}
                                <div className="flex justify-between items-center px-4 py-3">
                                    <span className={cn("text-xs", darkMode ? "text-gray-500" : "text-gray-400")}>{language === 'ar' ? 'المبلغ' : 'Amount'}</span>
                                    <div className="text-right">
                                        <span className={cn("font-bold text-base", darkMode ? "text-white" : "text-gray-900")}>
                                            {amount} {currentAsset.symbol}
                                        </span>
                                        <p className={cn("text-[11px]", darkMode ? "text-gray-600" : "text-gray-400")}>≈ ${(parseFloat(amount) * (currentAsset.price || 0)).toFixed(2)}</p>
                                    </div>
                                </div>

                                {/* Fee */}
                                <div className="flex justify-between items-center px-4 py-3">
                                    <span className={cn("text-xs", darkMode ? "text-gray-500" : "text-gray-400")}>{language === 'ar' ? 'الرسوم' : 'Fee'}</span>
                                    <div className="text-right">
                                        <span className={cn("font-semibold text-sm", darkMode ? "text-gray-300" : "text-gray-700")}>
                                            0.0055 TON
                                        </span>
                                        <p className={cn("text-[11px]", darkMode ? "text-gray-600" : "text-gray-400")}>≈ $0.005</p>
                                    </div>
                                </div>

                                {comment && (
                                    <div className="flex justify-between items-start px-4 py-3">
                                        <span className={cn("text-xs", darkMode ? "text-gray-500" : "text-gray-400")}>{language === 'ar' ? 'تعليق' : 'Comment'}</span>
                                        <p className={cn("text-sm italic text-right max-w-[180px] break-words", darkMode ? "text-gray-400" : "text-gray-600")}>
                                            "{comment}"
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Footer Actions */}
                    <div className="mt-6">
                        {step < 3 ? (
                            <button
                                onClick={handleNext}
                                disabled={(!address || address.length < 3) && step === 1 || !amount && step === 2}
                                className="w-full bg-gradient-to-r from-blue-500 to-blue-600 text-white py-3.5 rounded-2xl font-semibold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-blue-500/20 active:scale-[0.98]"
                            >
                                {language === 'ar' ? 'متابعة' : 'Continue'}
                            </button>
                        ) : (
                            <button
                                onClick={() => onSend(address, amount, comment, selectedAsset)}
                                className="w-full bg-gradient-to-r from-blue-500 to-blue-600 text-white py-3.5 rounded-2xl font-semibold text-sm transition-all shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2 active:scale-[0.98]"
                            >
                                {language === 'ar' ? 'تأكيد وإرسال' : 'Confirm & Send'}
                                <ArrowUp size={18} />
                            </button>
                        )}
                    </div>

                </div>
            </div>
        </div>
    );
}

// Receive Modal
// Receive Modal
export function ReceiveModal({ isOpen, onClose, darkMode, language, walletAddress, handleCopy, copied }: ReceiveModalProps) {
    if (!isOpen) return null;

    const handleShare = async () => {
        if (navigator.share) {
            try {
                await navigator.share({
                    title: 'My TON Wallet Address',
                    text: walletAddress,
                });
            } catch (err) {
                console.error('Share failed:', err);
            }
        } else {
            handleCopy();
        }
    };

    return (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className={cn("w-full max-w-sm rounded-3xl p-6 animate-scale-in shadow-2xl", darkMode ? "bg-[hsl(224,20%,8%)] ring-1 ring-white/5" : "bg-white/95 backdrop-blur-xl ring-1 ring-black/5")} onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="flex justify-between items-center mb-6">
                    <div className="flex items-center gap-3">
                        <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center ring-1", darkMode ? "bg-blue-500/10 text-blue-400 ring-blue-500/20" : "bg-blue-50 text-blue-600 ring-blue-100")}>
                            <ArrowDown size={20} />
                        </div>
                        <div>
                            <h3 className={cn("text-base font-bold", darkMode ? "text-white" : "text-gray-900")}>
                                {language === 'ar' ? 'استلام' : 'Receive'}
                            </h3>
                            <p className={cn("text-[11px]", darkMode ? "text-gray-500" : "text-gray-400")}>
                                TON & Jettons
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className={cn("p-1.5 rounded-xl transition", darkMode ? "hover:bg-white/5 text-gray-500" : "hover:bg-gray-100 text-gray-400")}>
                        <X size={18} />
                    </button>
                </div>

                {/* QR Code Container */}
                <div className="flex flex-col items-center justify-center mb-8">
                    <div className="relative group">
                        {/* Card Effect */}
                        <div className={`absolute -inset-1 rounded-[26px] blur opacity-30 group-hover:opacity-50 transition duration-500 ${darkMode ? 'bg-gradient-to-r from-blue-600 to-purple-600' : 'bg-blue-200'}`}></div>

                        <div className={`relative w-64 h-64 ${darkMode ? 'bg-white' : 'bg-white'} p-4 rounded-[24px] shadow-sm flex items-center justify-center`}>
                            <img
                                src={`https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${walletAddress}`}
                                alt="QR Code"
                                className="w-full h-full object-contain rounded-xl"
                            />
                            {/* Logo Overlay */}
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                <div className="w-12 h-12 bg-white rounded-full p-1 shadow-md flex items-center justify-center overflow-hidden">
                                    <img src="https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ton/info/logo.png" alt="TON" className="w-full h-full object-cover" />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Address Container */}
                <div className="glass-card p-4 mb-6">
                    <p className={cn("text-[11px] text-center mb-2 font-medium", darkMode ? "text-gray-500" : "text-gray-400")}>
                        {language === 'ar' ? 'عنوان محفظتك' : 'Your Wallet Address'}
                    </p>
                    <p className={cn("text-sm text-center font-mono break-all font-medium", darkMode ? "text-gray-300" : "text-gray-700")}>
                        {walletAddress}
                    </p>
                </div>

                {/* Actions */}
                <div className="grid grid-cols-2 gap-3">
                    <button
                        onClick={handleCopy}
                        className={cn("flex items-center justify-center gap-2 py-3.5 rounded-2xl font-semibold text-sm transition-all active:scale-[0.98]", copied ? "bg-green-500 text-white shadow-lg shadow-green-500/20" : "bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg shadow-blue-500/20")}
                    >
                        {copied ? <Check size={16} /> : <Copy size={16} />}
                        <span>{copied ? (language === 'ar' ? 'تم النسخ' : 'Copied') : (language === 'ar' ? 'نسخ' : 'Copy')}</span>
                    </button>

                    <button
                        onClick={handleShare}
                        className={cn("flex items-center justify-center gap-2 py-3.5 rounded-2xl font-semibold text-sm transition-all active:scale-[0.98] glass-btn", darkMode ? "text-gray-300" : "text-gray-600")}
                    >
                        <Share2 size={16} />
                        <span>{language === 'ar' ? 'مشاركة' : 'Share'}</span>
                    </button>
                </div>
            </div>
        </div>
    );
}

// Buy Modal - Simple redirect to Changelly
interface BuyModalProps extends BaseModalProps {
    walletAddress: string;
}

export function BuyModal({ isOpen, onClose, darkMode, language, walletAddress }: BuyModalProps) {
    const handleGoToSite = () => {
        window.open('https://changelly.com/buy-crypto', '_blank', 'noopener,noreferrer');
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className={cn("w-full max-w-sm rounded-3xl overflow-hidden animate-scale-in shadow-2xl", darkMode ? "bg-[hsl(224,20%,8%)] ring-1 ring-white/5" : "bg-white/95 backdrop-blur-xl ring-1 ring-black/5")} onClick={(e) => e.stopPropagation()}>

                {/* Header */}
                <div className={`p-5 border-b ${darkMode ? 'border-gray-800' : 'border-gray-100'}`}>
                    <div className="flex justify-between items-center">
                        <h3 className={`text-lg font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                            {language === 'ar' ? 'شراء عملات رقمية' : 'Buy Crypto'}
                        </h3>
                        <button onClick={onClose} className={`p-2 rounded-full ${darkMode ? 'hover:bg-gray-800 text-gray-400' : 'hover:bg-gray-100 text-gray-500'} transition`}>
                            <X size={20} />
                        </button>
                    </div>
                </div>

                <div className="p-5">
                    {/* Changelly Provider Card */}
                    <button
                        onClick={handleGoToSite}
                        className={`w-full p-4 rounded-2xl ${darkMode ? 'bg-gray-800 hover:bg-gray-750' : 'bg-gray-50 hover:bg-gray-100'} transition group`}
                    >
                        <div className="flex items-center gap-4">
                            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center shadow-lg shadow-green-500/20">
                                <span className="text-white font-bold text-2xl">C</span>
                            </div>
                            <div className="flex-1 text-left">
                                <p className={`font-bold text-lg ${darkMode ? 'text-white' : 'text-gray-900'}`}>Changelly</p>
                                <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                    {language === 'ar' ? 'محرك تبادل فوري' : 'An instant swap engine'}
                                </p>
                            </div>
                            <ChevronRight size={20} className={`${darkMode ? 'text-gray-500' : 'text-gray-400'} group-hover:translate-x-1 transition-transform`} />
                        </div>
                    </button>
                </div>
            </div>
        </div>
    );
}
// Swap Modal - Real On-Chain Swap Interface
interface SwapModalProps extends BaseModalProps {
    walletAddress: string;
    tokens: any[];
    onSwapInitiated?: (swapData: any) => void;
}

export function SwapModal({ isOpen, onClose, darkMode, language, walletAddress, tokens, onSwapInitiated }: SwapModalProps) {
    const [fromToken, setFromToken] = useState('TON');
    const [toToken, setToToken] = useState('USDT');
    const [amount, setAmount] = useState('');
    const [selectedDex, setSelectedDex] = useState<'stonfi' | 'dedust'>('stonfi');
    const [showFromPicker, setShowFromPicker] = useState(false);
    const [showToPicker, setShowToPicker] = useState(false);
    const [isLoadingQuote, setIsLoadingQuote] = useState(false);
    const [quote, setQuote] = useState<any>(null);
    const [error, setError] = useState('');
    const [tokenSearch, setTokenSearch] = useState('');

    // Dynamic token list from STON.fi API
    const [availableTokens, setAvailableTokens] = useState<Array<{ symbol: string; name: string; icon: string; decimals: number; address: string }>>([]);
    const [isLoadingTokens, setIsLoadingTokens] = useState(false);
    const [displayLimit, setDisplayLimit] = useState(50); // Show only 50 initially for performance

    // Load available tokens from STON.fi when modal opens
    useEffect(() => {
        if (isOpen && availableTokens.length === 0) {
            loadAvailableTokens();
        }
    }, [isOpen]);

    const loadAvailableTokens = async () => {
        setIsLoadingTokens(true);
        try {
            console.log('[SwapModal] Loading tokens from STON.fi API...');
            const response = await fetch('https://api.ston.fi/v1/assets');

            if (response.ok) {
                const data = await response.json();

                if (data.asset_list && Array.isArray(data.asset_list)) {
                    // Filter tokens - more inclusive to catch all verified tokens:
                    // 1. Not blacklisted/deprecated
                    // 2. Has image, symbol, and contract address
                    // 3. Either has trading activity OR is a known token type (wton, jetton, etc)
                    const processedTokens = data.asset_list
                        .filter((a: any) =>
                            !a.blacklisted &&
                            !a.deprecated &&
                            a.image_url &&
                            a.symbol &&
                            a.contract_address
                        )
                        .sort((a: any, b: any) => {
                            // Sort by popularity_index (STON.fi's verified popularity metric)
                            // Then by dex_usd_price as fallback
                            const aPopularity = a.popularity_index || 0;
                            const bPopularity = b.popularity_index || 0;
                            if (aPopularity !== bPopularity) return bPopularity - aPopularity;
                            return (b.dex_usd_price || 0) - (a.dex_usd_price || 0);
                        })
                        .slice(0, 1000) // Top 1000 tokens by popularity
                        .map((asset: any) => ({
                            symbol: asset.symbol || 'Unknown',
                            name: asset.display_name || asset.symbol || 'Unknown',
                            icon: asset.image_url || 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ton/info/logo.png',
                            decimals: asset.decimals || 9,
                            address: asset.contract_address,
                        }));

                    console.log('[SwapModal] Loaded', processedTokens.length, 'tokens');
                    setAvailableTokens(processedTokens);
                }
            } else {
                console.error('[SwapModal] Failed to load tokens:', response.status);
                // Fallback to minimal list if API fails
                setAvailableTokens([
                    { symbol: 'TON', name: 'Toncoin', icon: 'https://asset.ston.fi/img/EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c/d6004ba1bb042d9224b37dacf17399d04ff64d4ae5a6a1fbc52ae3906545c2fc', decimals: 9, address: 'native' },
                    { symbol: 'USD₮', name: 'Tether USD', icon: 'https://asset.ston.fi/img/EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs/1a87edfee9a28b05578853952e5effb8cc30af1e0fb90043aa2ce19dce490849', decimals: 6, address: 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs' },
                ]);
            }
        } catch (error) {
            console.error('[SwapModal] Error loading tokens:', error);
            // Fallback to minimal list if API fails
            setAvailableTokens([
                { symbol: 'TON', name: 'Toncoin', icon: 'https://asset.ston.fi/img/EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c/d6004ba1bb042d9224b37dacf17399d04ff64d4ae5a6a1fbc52ae3906545c2fc', decimals: 9, address: 'native' },
                { symbol: 'USD₮', name: 'Tether USD', icon: 'https://asset.ston.fi/img/EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs/1a87edfee9a28b05578853952e5effb8cc30af1e0fb90043aa2ce19dce490849', decimals: 6, address: 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs' },
            ]);
        } finally {
            setIsLoadingTokens(false);
        }
    };

    const dexProviders = [
        { id: 'stonfi' as const, name: 'STON.fi' },
        { id: 'dedust' as const, name: 'DeDust' },
    ];

    const getToken = (symbol: string) => {
        // First try to find in availableTokens (from API)
        const token = availableTokens.find(t => t.symbol === symbol);
        if (token) return token;

        // Fallback to TON_TOKENS from SwapService
        const fallbackToken = TON_TOKENS[symbol];
        if (fallbackToken) {
            return {
                symbol: fallbackToken.symbol,
                name: fallbackToken.name,
                icon: fallbackToken.icon,
                decimals: fallbackToken.decimals,
                address: fallbackToken.address
            };
        }

        return undefined;
    };

    const getBalance = (symbol: string) => {
        const token = tokens.find(t => t.symbol === symbol);
        return token?.rawBalance || 0;
    };

    const handleSwapTokens = () => {
        const temp = fromToken;
        setFromToken(toToken);
        setToToken(temp);
        setQuote(null);
    };

    // Fetch quote when amount changes - using the new SwapService
    const fetchQuote = async () => {
        if (!amount || parseFloat(amount) <= 0 || fromToken === toToken) {
            setQuote(null);
            return;
        }

        setIsLoadingQuote(true);
        setError('');

        try {
            // Import the SwapService dynamically
            const { swapService } = await import('../services/SwapService');

            // Get the best quote from both DEXes (STON.fi and DeDust)
            const result = await swapService.getBestQuote(fromToken, toToken, amount);

            // Use the best quote
            const bestQuote = result.bestQuote;

            // Calculate rate for display
            const inputNum = parseFloat(bestQuote.inputAmount);
            const outputNum = parseFloat(bestQuote.outputAmount);
            const rate = inputNum > 0 ? (outputNum / inputNum).toFixed(4) : '0';

            setQuote({
                provider: bestQuote.provider,
                fromToken: bestQuote.fromToken,
                toToken: bestQuote.toToken,
                inputAmount: bestQuote.inputAmount,
                outputAmount: bestQuote.outputAmount,
                minOutputAmount: bestQuote.minOutputAmount,
                priceImpact: bestQuote.priceImpact || '< 0.1%',
                fee: bestQuote.fee || '~0.3%',
                rate: `1 ${fromToken} ≈ ${rate} ${toToken}`,
                isEstimate: bestQuote.isEstimate,
                poolAddress: bestQuote.poolAddress,
                allQuotes: result.allQuotes, // Store all quotes for comparison
                rawData: bestQuote.rawData, // CRITICAL: Preserve API response data for swap building
            });

            // Update selected DEX to match best quote
            setSelectedDex(bestQuote.provider);
        } catch (err: any) {
            console.warn('[SwapModal] Quote error, using fallback:', err);

            // Fallback to approximate prices if SwapService fails
            // Updated to current market rates (Jan 2026)
            const fallbackPrices: Record<string, number> = {
                TON: 1.85,   // ~$1.85 per TON
                USDT: 1.0,
                NOT: 0.0006,
                DOGS: 0.00005,
                CATI: 0.06,
                STON: 0.40,
                HMSTR: 0.003,
                MAJOR: 0.13,
                JETTON: 0.06,
                REDO: 0.05,
            };

            const fromPrice = fallbackPrices[fromToken] || 1;
            const toPrice = fallbackPrices[toToken] || 1;
            const inputAmount = parseFloat(amount);
            const outputAmount = (inputAmount * fromPrice / toPrice);
            const minOutput = outputAmount * 0.99;
            const toDecimals = getToken(toToken)?.decimals || 6;

            setQuote({
                provider: selectedDex,
                fromToken,
                toToken,
                inputAmount: amount,
                outputAmount: outputAmount.toFixed(toDecimals > 6 ? 4 : 2),
                minOutputAmount: minOutput.toFixed(toDecimals > 6 ? 4 : 2),
                priceImpact: '< 0.1%',
                fee: '~0.3%',
                rate: `1 ${fromToken} ≈ ${(fromPrice / toPrice).toFixed(4)} ${toToken}`,
                isEstimate: true,
            });
        } finally {
            setIsLoadingQuote(false);
        }
    };

    // Debounce quote fetching when amount/tokens change
    React.useEffect(() => {
        const timer = setTimeout(() => {
            if (amount && parseFloat(amount) > 0) {
                fetchQuote();
            }
        }, 500);
        return () => clearTimeout(timer);
    }, [amount, fromToken, toToken, selectedDex]);

    // Auto-refresh prices every 10 seconds
    const [refreshCountdown, setRefreshCountdown] = React.useState(10);

    React.useEffect(() => {
        if (!isOpen || !amount || parseFloat(amount) <= 0) {
            setRefreshCountdown(10);
            return;
        }

        // Countdown timer
        const countdownInterval = setInterval(() => {
            setRefreshCountdown(prev => {
                if (prev <= 1) {
                    return 10; // Reset countdown
                }
                return prev - 1;
            });
        }, 1000);

        // Refresh prices every 10 seconds
        const refreshInterval = setInterval(() => {
            if (amount && parseFloat(amount) > 0 && !isLoadingQuote) {
                fetchQuote();
            }
        }, 10000);

        return () => {
            clearInterval(countdownInterval);
            clearInterval(refreshInterval);
        };
    }, [isOpen, amount, fromToken, toToken, selectedDex]);

    // Reset countdown when quote is manually fetched
    const handleManualRefresh = () => {
        setRefreshCountdown(10);
        if (amount && parseFloat(amount) > 0) {
            fetchQuote();
        }
    };

    const handleMaxClick = () => {
        const balance = getBalance(fromToken);

        // Calculate fee based on swap direction
        let fee = 0;
        if (fromToken === 'TON') {
            // TON -> Jetton swap: need to reserve gas (0.25 TON) + small buffer (0.05)
            fee = 0.30; // Conservative estimate: 0.25 for swap + 0.05 buffer
        } else if (toToken === 'TON') {
            // Jetton -> TON swap: gas is paid from balance after swap, so can use full jetton balance
            fee = 0;
        } else {
            // Jetton -> Jetton swap: no TON deduction needed from jetton balance
            fee = 0;
        }

        const max = Math.max(0, balance - fee);
        setAmount(max.toString());
    };

    const handleSwap = () => {
        if (!quote || !amount || parseFloat(amount) <= 0) return;

        const balance = getBalance(fromToken);
        if (parseFloat(amount) > balance) {
            setError(language === 'ar' ? 'رصيد غير كافي' : 'Insufficient balance');
            return;
        }

        // Trigger swap - this will open password modal for confirmation
        if (onSwapInitiated) {
            onSwapInitiated({
                fromToken,
                toToken,
                amount,
                minOutput: quote.minOutputAmount,
                provider: selectedDex,
                quote,
            });
        }
        onClose();
    };

    if (!isOpen) return null;

    const fromTokenData = getToken(fromToken);
    const toTokenData = getToken(toToken);
    const balance = getBalance(fromToken);
    const hasInsufficientBalance = parseFloat(amount || '0') > balance;

    return (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className={cn("w-full max-w-sm rounded-3xl animate-scale-in shadow-2xl", darkMode ? "bg-[hsl(224,20%,8%)] ring-1 ring-white/5" : "bg-white/95 backdrop-blur-xl ring-1 ring-black/5")} onClick={(e) => e.stopPropagation()}>

                {/* Header */}
                <div className={cn("p-4 border-b", darkMode ? "border-white/[0.06]" : "border-gray-100")}>
                    <div className="flex justify-between items-center">
                        <h3 className={cn("text-base font-bold", darkMode ? "text-white" : "text-gray-900")}>
                            {language === 'ar' ? 'تبديل' : 'Swap'}
                        </h3>
                        <button onClick={onClose} className={cn("p-1.5 rounded-xl transition", darkMode ? "hover:bg-white/5 text-gray-500" : "hover:bg-gray-100 text-gray-400")}>
                            <X size={18} />
                        </button>
                    </div>
                </div>

                <div className="p-4">
                    {/* Send Section */}
                    <div className={cn("glass-card p-3 mb-2")}>
                        <div className="flex justify-between items-center mb-2">
                            <span className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                                {language === 'ar' ? 'أرسل' : 'Send'}
                            </span>
                            <div className="flex items-center gap-2">
                                <span className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                                    {language === 'ar' ? 'الرصيد:' : 'Balance:'} {balance.toFixed(4)}
                                </span>
                                <button
                                    onClick={handleMaxClick}
                                    className="text-xs text-blue-500 font-semibold hover:text-blue-400"
                                >
                                    MAX
                                </button>
                            </div>
                        </div>
                        <div className="flex items-center gap-3 overflow-hidden">
                            <button
                                onClick={() => { setShowFromPicker(!showFromPicker); setShowToPicker(false); }}
                                className={cn("flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-full flex-shrink-0 transition-all", darkMode ? "bg-white/[0.06] hover:bg-white/[0.1] ring-1 ring-white/[0.08]" : "bg-gray-100 hover:bg-gray-200/80")}
                            >
                                <div className="w-7 h-7 rounded-full overflow-hidden flex items-center justify-center flex-shrink-0">
                                    <img
                                        src={fromTokenData?.icon}
                                        alt={fromToken}
                                        className="w-full h-full object-cover"
                                        onError={(e) => { (e.target as HTMLImageElement).src = 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ton/info/logo.png'; }}
                                    />
                                </div>
                                <span className={cn("font-bold text-sm", darkMode ? 'text-white' : 'text-gray-900')}>{fromToken}</span>
                                <ChevronRight size={14} className={darkMode ? 'text-gray-500' : 'text-gray-400'} />
                            </button>
                            <input
                                type="number"
                                inputMode="decimal"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                placeholder="0"
                                style={{ MozAppearance: 'textfield' }}
                                className={`flex-1 min-w-0 text-right text-2xl font-bold bg-transparent outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${hasInsufficientBalance
                                    ? 'text-red-500'
                                    : darkMode ? 'text-white' : 'text-gray-900'
                                    }`}
                            />
                        </div>
                    </div>

                    {/* Token Picker - From */}
                    {showFromPicker && (
                        <div className="glass-card mb-2 overflow-hidden">
                            {/* Search Input */}
                            <div className={cn("p-2 border-b", darkMode ? "border-white/[0.06]" : "border-black/[0.04]")}>
                                <input
                                    type="text"
                                    value={tokenSearch}
                                    onChange={(e) => setTokenSearch(e.target.value)}
                                    placeholder={language === 'ar' ? 'بحث عن التوكن...' : 'Search tokens...'}
                                    className={cn("w-full px-3 py-2 rounded-xl text-sm outline-none", darkMode ? "bg-white/5 text-white placeholder:text-gray-500 border border-white/10 focus:border-blue-500/50" : "bg-white text-gray-900 placeholder:text-gray-400 border border-gray-200 focus:border-blue-400")}
                                    autoFocus
                                />
                            </div>
                            {/* Loading State or Token List */}
                            {isLoadingTokens ? (
                                <div className={`p-6 flex flex-col items-center justify-center ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                    <Loader2 size={24} className="animate-spin mb-2" />
                                    <span className="text-sm">{language === 'ar' ? 'جارٍ التحميل...' : 'Loading tokens...'}</span>
                                </div>
                            ) : (
                                <div className="max-h-48 overflow-y-auto">
                                    {availableTokens
                                        .filter(t => t.symbol !== toToken)
                                        .filter(t => {
                                            if (!tokenSearch) return true;
                                            const search = tokenSearch.toLowerCase();
                                            return t.symbol.toLowerCase().includes(search) || t.name.toLowerCase().includes(search);
                                        })
                                        .slice(0, tokenSearch ? 100 : displayLimit) // Show more when searching
                                        .map((t) => (
                                            <button
                                                key={t.address || t.symbol}
                                                onClick={() => { setFromToken(t.symbol); setShowFromPicker(false); setQuote(null); setTokenSearch(''); }}
                                                className={cn("w-full flex items-center gap-3 p-3 transition", darkMode ? "hover:bg-white/[0.03]" : "hover:bg-black/[0.02]")}
                                            >
                                                <div className="w-6 h-6 rounded-full overflow-hidden bg-gray-200 flex items-center justify-center flex-shrink-0">
                                                    <img
                                                        src={t.icon}
                                                        alt={t.symbol}
                                                        className="w-full h-full object-cover"
                                                        onError={(e) => { (e.target as HTMLImageElement).src = 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ton/info/logo.png'; }}
                                                    />
                                                </div>
                                                <div className="flex flex-col items-start">
                                                    <span className={`font-medium ${darkMode ? 'text-white' : 'text-gray-800'}`}>{t.symbol}</span>
                                                    <span className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>{t.name}</span>
                                                </div>
                                                <span className={`text-sm ml-auto ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                                                    {getBalance(t.symbol).toFixed(4)}
                                                </span>
                                            </button>
                                        ))}
                                    {availableTokens.filter(t => t.symbol !== toToken).filter(t => {
                                        if (!tokenSearch) return true;
                                        const search = tokenSearch.toLowerCase();
                                        return t.symbol.toLowerCase().includes(search) || t.name.toLowerCase().includes(search);
                                    }).length === 0 && (
                                            <div className={`p-4 text-center ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                                                {language === 'ar' ? 'لا توجد نتائج' : 'No tokens found'}
                                            </div>
                                        )}
                                    {/* Show More Button */}
                                    {!tokenSearch && availableTokens.filter(t => t.symbol !== toToken).length > displayLimit && (
                                        <button
                                            onClick={() => setDisplayLimit(prev => prev + 50)}
                                            className={`w-full p-2 text-sm ${darkMode ? 'text-blue-400 hover:bg-gray-700' : 'text-blue-600 hover:bg-gray-100'} transition`}
                                        >
                                            {language === 'ar' ? 'عرض المزيد' : 'Show More'} ({displayLimit} / {availableTokens.length})
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Swap Direction */}
                    <div className="flex justify-center my-2 relative z-10">
                        <button
                            onClick={handleSwapTokens}
                            className={cn("p-2.5 rounded-xl ring-1 shadow-sm transition-all active:scale-90 active:rotate-180", darkMode ? "bg-white/5 hover:bg-white/10 ring-white/10 text-gray-300" : "bg-white hover:bg-gray-50 ring-black/[0.06] text-gray-600 shadow-md")}
                        >
                            <ArrowDown size={18} strokeWidth={2.5} />
                        </button>
                    </div>

                    {/* Receive Section */}
                    <div className={cn("glass-card p-3 mb-3")}>
                        <div className="flex justify-between items-center mb-2">
                            <span className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                                {language === 'ar' ? 'استلم' : 'Receive'}
                            </span>
                            <span className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                                {language === 'ar' ? 'الرصيد:' : 'Balance:'} {getBalance(toToken).toFixed(4)}
                            </span>
                        </div>
                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => { setShowToPicker(!showToPicker); setShowFromPicker(false); }}
                                className={cn("flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-full flex-shrink-0 transition-all", darkMode ? "bg-white/[0.06] hover:bg-white/[0.1] ring-1 ring-white/[0.08]" : "bg-gray-100 hover:bg-gray-200/80")}
                            >
                                <div className="w-7 h-7 rounded-full overflow-hidden flex items-center justify-center flex-shrink-0">
                                    <img
                                        src={toTokenData?.icon}
                                        alt={toToken}
                                        className="w-full h-full object-cover"
                                        onError={(e) => { (e.target as HTMLImageElement).src = 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ton/info/logo.png'; }}
                                    />
                                </div>
                                <span className={cn("font-bold text-sm", darkMode ? 'text-white' : 'text-gray-900')}>{toToken}</span>
                                <ChevronRight size={14} className={darkMode ? 'text-gray-500' : 'text-gray-400'} />
                            </button>
                            <div className="flex-1 text-right">
                                {isLoadingQuote ? (
                                    <Loader2 size={20} className={`animate-spin ml-auto ${darkMode ? 'text-gray-500' : 'text-gray-400'}`} />
                                ) : (
                                    <span className={`text-2xl font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                                        {quote ? quote.outputAmount : '0'}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Token Picker - To */}
                    {showToPicker && (
                        <div className="glass-card mb-3 overflow-hidden">
                            {/* Search Input */}
                            <div className={cn("p-2 border-b", darkMode ? "border-white/[0.06]" : "border-black/[0.04]")}>
                                <input
                                    type="text"
                                    value={tokenSearch}
                                    onChange={(e) => setTokenSearch(e.target.value)}
                                    placeholder={language === 'ar' ? 'بحث عن التوكن...' : 'Search tokens...'}
                                    className={cn("w-full px-3 py-2 rounded-xl text-sm outline-none", darkMode ? "bg-white/5 text-white placeholder:text-gray-500 border border-white/10 focus:border-blue-500/50" : "bg-white text-gray-900 placeholder:text-gray-400 border border-gray-200 focus:border-blue-400")}
                                    autoFocus
                                />
                            </div>
                            {/* Loading State or Token List */}
                            {isLoadingTokens ? (
                                <div className={`p-6 flex flex-col items-center justify-center ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                                    <Loader2 size={24} className="animate-spin mb-2" />
                                    <span className="text-sm">{language === 'ar' ? 'جارٍ التحميل...' : 'Loading tokens...'}</span>
                                </div>
                            ) : (
                                <div className="max-h-48 overflow-y-auto">
                                    {availableTokens
                                        .filter(t => t.symbol !== fromToken)
                                        .filter(t => {
                                            if (!tokenSearch) return true;
                                            const search = tokenSearch.toLowerCase();
                                            return t.symbol.toLowerCase().includes(search) || t.name.toLowerCase().includes(search);
                                        })
                                        .slice(0, tokenSearch ? 100 : displayLimit) // Show more when searching
                                        .map((t) => (
                                            <button
                                                key={t.address || t.symbol}
                                                onClick={() => { setToToken(t.symbol); setShowToPicker(false); setQuote(null); setTokenSearch(''); }}
                                                className={cn("w-full flex items-center gap-3 p-3 transition", darkMode ? "hover:bg-white/[0.03]" : "hover:bg-black/[0.02]")}
                                            >
                                                <div className="w-6 h-6 rounded-full overflow-hidden bg-gray-200 flex items-center justify-center flex-shrink-0">
                                                    <img
                                                        src={t.icon}
                                                        alt={t.symbol}
                                                        className="w-full h-full object-cover"
                                                        onError={(e) => { (e.target as HTMLImageElement).src = 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ton/info/logo.png'; }}
                                                    />
                                                </div>
                                                <div className="flex flex-col items-start">
                                                    <span className={`font-medium ${darkMode ? 'text-white' : 'text-gray-800'}`}>{t.symbol}</span>
                                                    <span className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>{t.name}</span>
                                                </div>
                                            </button>
                                        ))}
                                    {availableTokens.filter(t => t.symbol !== fromToken).filter(t => {
                                        if (!tokenSearch) return true;
                                        const search = tokenSearch.toLowerCase();
                                        return t.symbol.toLowerCase().includes(search) || t.name.toLowerCase().includes(search);
                                    }).length === 0 && (
                                            <div className={`p-4 text-center ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                                                {language === 'ar' ? 'لا توجد نتائج' : 'No tokens found'}
                                            </div>
                                        )}
                                    {/* Show More Button */}
                                    {!tokenSearch && availableTokens.filter(t => t.symbol !== fromToken).length > displayLimit && (
                                        <button
                                            onClick={() => setDisplayLimit(prev => prev + 50)}
                                            className={`w-full p-2 text-sm ${darkMode ? 'text-blue-400 hover:bg-gray-700' : 'text-blue-600 hover:bg-gray-100'} transition`}
                                        >
                                            {language === 'ar' ? 'عرض المزيد' : 'Show More'} ({displayLimit} / {availableTokens.length})
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Quote Info */}
                    {quote && !isLoadingQuote && (
                        <div className="glass-card p-3 mb-3">
                            {/* Rate with refresh indicator */}
                            <div className="flex justify-between items-center text-xs mb-1">
                                <span className={darkMode ? 'text-gray-500' : 'text-gray-400'}>{language === 'ar' ? 'السعر' : 'Rate'}</span>
                                <div className="flex items-center gap-2">
                                    <span className={darkMode ? 'text-gray-300' : 'text-gray-600'}>{quote.rate}</span>
                                    <button
                                        onClick={handleManualRefresh}
                                        className={`p-1 rounded-full hover:bg-gray-700/50 transition ${isLoadingQuote ? 'animate-spin' : ''}`}
                                        title={`${language === 'ar' ? 'تحديث' : 'Refresh'} (${refreshCountdown}s)`}
                                    >
                                        <ArrowLeftRight size={12} className={darkMode ? 'text-gray-400' : 'text-gray-500'} />
                                    </button>
                                </div>
                            </div>
                            <div className="flex justify-between text-xs mb-1">
                                <span className={darkMode ? 'text-gray-500' : 'text-gray-400'}>{language === 'ar' ? 'الحد الأدنى' : 'Min. received'}</span>
                                <span className={darkMode ? 'text-gray-300' : 'text-gray-600'}>{quote.minOutputAmount} {toToken}</span>
                            </div>
                            <div className="flex justify-between text-xs mb-1">
                                <span className={darkMode ? 'text-gray-500' : 'text-gray-400'}>{language === 'ar' ? 'المنصة' : 'Provider'}</span>
                                <span className={darkMode ? 'text-gray-300' : 'text-gray-600'}>{selectedDex === 'stonfi' ? 'STON.fi' : 'DeDust'}</span>
                            </div>
                            {/* Live update indicator */}
                            <div className="flex items-center justify-center gap-1 mt-2 pt-2 border-t border-gray-700/50">
                                <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></div>
                                <span className={`text-[10px] ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                                    {language === 'ar' ? `تحديث تلقائي خلال ${refreshCountdown} ثانية` : `Auto-update in ${refreshCountdown}s`}
                                </span>
                            </div>
                        </div>
                    )}

                    {/* DEX Selection */}
                    <div className={cn("glass-card p-1 flex gap-1 mb-3")}>
                        {dexProviders.map((dex) => (
                            <button
                                key={dex.id}
                                onClick={() => { setSelectedDex(dex.id); setQuote(null); }}
                                className={cn(
                                    "flex-1 py-2 rounded-xl text-xs font-bold transition-all",
                                    selectedDex === dex.id
                                        ? "bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-sm"
                                        : darkMode ? "text-gray-500 hover:text-gray-300" : "text-gray-500 hover:text-gray-700"
                                )}
                            >
                                {dex.name}
                            </button>
                        ))}
                    </div>

                    {/* Error Message */}
                    {error && (
                        <div className="p-2 mb-3 rounded-lg bg-red-500/10 border border-red-500/30">
                            <p className="text-red-500 text-sm text-center">{error}</p>
                        </div>
                    )}

                    {/* Swap Button */}
                    <button
                        onClick={handleSwap}
                        disabled={!quote || !amount || parseFloat(amount) <= 0 || hasInsufficientBalance || isLoadingQuote}
                        className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-blue-500 to-blue-600 text-white font-semibold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20 active:scale-[0.98]"
                    >
                        {isLoadingQuote ? (
                            <Loader2 size={18} className="animate-spin" />
                        ) : hasInsufficientBalance ? (
                            language === 'ar' ? 'رصيد غير كافي' : 'Insufficient Balance'
                        ) : (
                            <>
                                <ArrowLeftRight size={16} />
                                {language === 'ar' ? 'تبديل' : 'Swap'}
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div >
    );
}


// Backup Modal
interface BackupModalProps extends BaseModalProps {
    onShowPhrase: () => void;
    onShowPrivateKey: () => void;
}

export function BackupModal({ isOpen, onClose, darkMode, language, onShowPhrase, onShowPrivateKey }: BackupModalProps) {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className={cn("w-full max-w-sm rounded-3xl p-6 animate-scale-in", darkMode ? "bg-[hsl(224,20%,8%)] ring-1 ring-white/5" : "bg-white/95 backdrop-blur-xl ring-1 ring-black/5")} onClick={(e) => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-5">
                    <h3 className={cn("text-base font-bold", darkMode ? "text-white" : "text-gray-900")}>{language === 'ar' ? 'النسخ الاحتياطي' : 'Backup'}</h3>
                    <button onClick={onClose} className={cn("p-1.5 rounded-xl transition", darkMode ? "hover:bg-white/5 text-gray-500" : "hover:bg-gray-100 text-gray-400")}>
                        <X size={18} />
                    </button>
                </div>
                <div className="space-y-3">
                    <div className={cn("p-3.5 rounded-2xl text-xs leading-relaxed", darkMode ? "bg-amber-500/5 text-amber-400/80 ring-1 ring-amber-500/10" : "bg-amber-50 text-amber-700 ring-1 ring-amber-200/50")}>
                        {language === 'ar' ? 'قم بحفظ العبارة السرية في مكان آمن. لا تشاركها مع أي أحد أبداً.' : 'Save your secret phrase in a safe place. Never share it with anyone.'}
                    </div>
                    <button onClick={onShowPhrase} className="w-full bg-gradient-to-r from-blue-500 to-blue-600 text-white py-3 rounded-2xl font-semibold text-sm shadow-lg shadow-blue-500/20 active:scale-[0.98] transition-all">
                        {language === 'ar' ? 'عرض العبارة السرية' : 'Show Secret Phrase'}
                    </button>
                    <button onClick={onShowPrivateKey} className={cn("w-full py-3 rounded-2xl font-semibold text-sm transition-all active:scale-[0.98]", darkMode ? "glass-btn text-gray-300" : "glass-btn text-gray-600")}>
                        {language === 'ar' ? 'عرض المفتاح الخاص' : 'Show Private Key'}
                    </button>
                    <button className={cn("w-full py-3 rounded-2xl font-semibold text-sm transition-all active:scale-[0.98]", darkMode ? "glass-btn text-gray-300" : "glass-btn text-gray-600")}>
                        {language === 'ar' ? 'حفظ في Google Drive' : 'Save to Google Drive'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// Phrase Modal
export function PhraseModal({ isOpen, onClose, darkMode, language, seedPhrase, handleCopyPhrase, copiedPhrase }: PhraseModalProps) {
    if (!isOpen) return null;
    return (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-end justify-center z-50" onClick={onClose}>
            <div className={cn("w-full max-w-md rounded-t-3xl p-6 animate-slide-up max-h-[90vh] overflow-y-auto no-scrollbar", darkMode ? "bg-[hsl(224,20%,8%)] ring-1 ring-white/5" : "bg-white/95 backdrop-blur-xl ring-1 ring-black/5")} onClick={(e) => e.stopPropagation()}>
                <div className={cn("w-10 h-1 rounded-full mx-auto mb-5", darkMode ? "bg-white/10" : "bg-gray-200")}></div>

                <div className="flex justify-between items-center mb-5">
                    <h3 className={cn("text-base font-bold", darkMode ? "text-white" : "text-gray-900")}>{language === 'ar' ? 'العبارة السرية' : 'Secret Phrase'}</h3>
                    <button
                        onClick={handleCopyPhrase}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition ${darkMode ? 'bg-blue-950 text-blue-400 hover:bg-blue-900' : 'bg-blue-50 text-blue-600 hover:bg-blue-100'
                            }`}
                    >
                        {copiedPhrase ? <Check size={16} /> : <Copy size={16} />}
                        {copiedPhrase ? (language === 'ar' ? 'تم النسخ' : 'Copied') : (language === 'ar' ? 'نسخ' : 'Copy')}
                    </button>
                </div>

                <div className={`grid grid-cols-2 gap-3 mb-6`}>
                    {seedPhrase.map((word, index) => (
                        <div key={index} className={`relative flex items-center gap-3 p-3.5 rounded-2xl border transition-all hover:shadow-md ${darkMode ? 'bg-gray-800/50 border-gray-700' : 'bg-white border-gray-100 shadow-sm'}`}>
                            <span className={`flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold ${darkMode ? 'bg-gray-700 text-gray-400' : 'bg-blue-50 text-blue-600'}`}>
                                {index + 1}
                            </span>
                            <span className={`font-bold tracking-wide ${darkMode ? 'text-white' : 'text-gray-800'}`}>
                                {word}
                            </span>
                        </div>
                    ))}
                </div>

                <div className={`flex items-start gap-3 p-4 rounded-xl mb-6 ${darkMode ? 'bg-red-500/10 border border-red-500/20' : 'bg-red-50 border border-red-100'}`}>
                    <TriangleAlert className="text-red-500 shrink-0" size={20} />
                    <p className={`text-xs font-medium leading-relaxed ${darkMode ? 'text-red-400' : 'text-red-600'}`}>
                        {language === 'ar'
                            ? 'تحذير: لا تقم بتصوير الشاشة. أي شخص يملك هذه الكلمات يمكنه الوصول لأموالك.'
                            : 'Warning: Do not take screenshots. Anyone with these words can access your funds.'}
                    </p>
                </div>

                <button onClick={onClose} className={`w-full py-4 rounded-xl font-bold ${darkMode ? 'bg-gray-800 text-white hover:bg-gray-700' : 'bg-gray-100 text-gray-900 hover:bg-gray-200'} transition`}>
                    {language === 'ar' ? 'إغلاق' : 'Close'}
                </button>
            </div>
        </div>
    );
}

// Transaction Modal
export function TransactionModal({ transaction, onClose, darkMode, language }: TransactionModalProps) {
    if (!transaction) return null;

    const getIconConfig = () => {
        if (transaction.status === 'failed') return { icon: <XCircle size={22} />, bg: darkMode ? 'bg-red-500/10 text-red-400 ring-red-500/20' : 'bg-red-50 text-red-500 ring-red-100' };
        if (transaction.type === 'received') return { icon: <ArrowDown size={22} />, bg: darkMode ? 'bg-green-500/10 text-green-400 ring-green-500/20' : 'bg-green-50 text-green-600 ring-green-100' };
        if (transaction.type === 'swap') return { icon: <ArrowLeftRight size={22} />, bg: darkMode ? 'bg-blue-500/10 text-blue-400 ring-blue-500/20' : 'bg-blue-50 text-blue-600 ring-blue-100' };
        return { icon: <ArrowUp size={22} />, bg: darkMode ? 'bg-white/5 text-gray-400 ring-white/10' : 'bg-gray-50 text-gray-500 ring-gray-100' };
    };

    const { icon, bg } = getIconConfig();
    const addr = transaction.type === 'received' ? transaction.from : transaction.to;

    return (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-end justify-center z-50" onClick={onClose}>
            <div className={cn("w-full max-w-sm rounded-t-3xl p-6 animate-slide-up shadow-2xl", darkMode ? "bg-[hsl(224,20%,8%)] ring-1 ring-white/5" : "bg-white/95 backdrop-blur-xl ring-1 ring-black/5")} onClick={(e) => e.stopPropagation()}>
                <div className={cn("w-10 h-1 rounded-full mx-auto mb-6", darkMode ? "bg-white/10" : "bg-gray-200")} />

                {/* Header */}
                <div className="text-center mb-6">
                    <div className={cn("w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3 ring-1", bg)}>
                        {icon}
                    </div>
                    <h2 className={cn("text-3xl font-bold mb-0.5 tracking-tight", darkMode ? "text-white" : "text-black")}>
                        {transaction.amount || '0.00'} <span className={cn("text-xl font-semibold", darkMode ? "text-gray-400" : "text-gray-600")}>{transaction.token}</span>
                    </h2>
                    <p className={cn("text-sm font-medium", darkMode ? "text-gray-500" : "text-gray-600")}>
                        {transaction.time}
                    </p>
                </div>

                {/* Details Card */}
                <div className={cn("glass-card divide-y overflow-hidden mb-6", darkMode ? "divide-white/[0.06]" : "divide-black/[0.04]")}>
                    {/* Status */}
                    <div className="flex justify-between items-center px-4 py-3">
                        <span className={cn("text-xs", darkMode ? "text-gray-500" : "text-gray-400")}>
                            {language === 'ar' ? 'الحالة' : 'Status'}
                        </span>
                        <div className="flex items-center gap-1.5">
                            <div className={cn("w-1.5 h-1.5 rounded-full", transaction.status === 'failed' ? "bg-red-500" : "bg-green-500")} />
                            <span className={cn("text-sm font-semibold", transaction.status === 'failed' ? "text-red-500" : "text-green-500")}>
                                {transaction.status === 'failed'
                                    ? (language === 'ar' ? 'فشل' : 'Failed')
                                    : (language === 'ar' ? 'مكتمل' : 'Completed')}
                            </span>
                        </div>
                    </div>

                    {/* Fee */}
                    <div className="flex justify-between items-center px-4 py-3">
                        <span className={cn("text-xs", darkMode ? "text-gray-500" : "text-gray-400")}>
                            {language === 'ar' ? 'الرسوم' : 'Fee'}
                        </span>
                        <span className={cn("text-sm font-semibold tabular-nums", darkMode ? "text-gray-300" : "text-gray-700")}>
                            {transaction.fee || '0'} TON
                        </span>
                    </div>

                    {/* Address */}
                    <div className="px-4 py-3">
                        <div className="flex items-center justify-between mb-1">
                            <span className={cn("text-[10px] font-bold uppercase tracking-wider", darkMode ? "text-gray-500" : "text-gray-400")}>
                                {transaction.type === 'received'
                                    ? (language === 'ar' ? 'من' : 'From')
                                    : transaction.type === 'swap'
                                        ? (language === 'ar' ? 'المبادل' : 'Router')
                                        : (language === 'ar' ? 'إلى' : 'To')}
                            </span>
                            <button
                                onClick={() => navigator.clipboard.writeText(addr)}
                                className={cn("p-1.5 rounded-lg transition-colors", darkMode ? "text-gray-600 hover:text-gray-400 hover:bg-white/5" : "text-gray-400 hover:text-gray-600 hover:bg-gray-100")}
                            >
                                <Copy size={13} />
                            </button>
                        </div>
                        <p className={cn("text-[13px] font-mono break-all leading-relaxed", darkMode ? "text-gray-300" : "text-gray-600")}>
                            {addr}
                        </p>
                    </div>

                    {/* Hash */}
                    <div className="px-4 py-3">
                        <div className="flex items-center justify-between mb-1">
                            <span className={cn("text-[10px] font-bold uppercase tracking-wider", darkMode ? "text-gray-500" : "text-gray-400")}>
                                {language === 'ar' ? 'المعرف' : 'Hash'}
                            </span>
                            <button
                                onClick={() => navigator.clipboard.writeText(transaction.hash)}
                                className={cn("p-1.5 rounded-lg transition-colors", darkMode ? "text-gray-600 hover:text-gray-400 hover:bg-white/5" : "text-gray-400 hover:text-gray-600 hover:bg-gray-100")}
                            >
                                <Copy size={13} />
                            </button>
                        </div>
                        <p className={cn("text-[11px] font-mono break-all leading-relaxed", darkMode ? "text-gray-500" : "text-gray-500")}>
                            {transaction.hash}
                        </p>
                    </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2.5">
                    <button
                        onClick={() => window.open(`https://tonviewer.com/transaction/${transaction.hash}`, '_blank')}
                        className={cn("flex-1 py-3.5 rounded-2xl font-semibold text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98]", darkMode ? "bg-white/[0.06] text-white ring-1 ring-white/[0.08] hover:bg-white/[0.08]" : "bg-gray-100 text-gray-900 ring-1 ring-black/[0.04] hover:bg-gray-200/80")}
                    >
                        <ExternalLink size={15} />
                        <span>{language === 'ar' ? 'المستكشف' : 'Explorer'}</span>
                    </button>
                    <button
                        onClick={onClose}
                        className="flex-1 bg-gradient-to-r from-blue-500 to-blue-600 text-white py-3.5 rounded-2xl font-semibold text-sm transition-all shadow-lg shadow-blue-500/20 active:scale-[0.98]"
                    >
                        {language === 'ar' ? 'إغلاق' : 'Close'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// Private Key Modal
interface PrivateKeyModalProps {
    isOpen: boolean;
    onClose: () => void;
    darkMode: boolean;
    language: string;
    privateKey: string;
}

export function PrivateKeyModal({ isOpen, onClose, darkMode, language, privateKey }: PrivateKeyModalProps) {
    const [copied, setCopied] = useState(false);
    if (!isOpen) return null;
    const handleCopy = () => {
        navigator.clipboard.writeText(privateKey);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };
    return (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className={`w-full max-w-sm ${darkMode ? 'bg-[hsl(224,20%,8%)] ring-1 ring-white/5' : 'bg-white/95 backdrop-blur-xl ring-1 ring-black/5'} rounded-3xl p-6 animate-scale-in`} onClick={(e) => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-6">
                    <h3 className={`text-base font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}>{language === 'ar' ? 'المفتاح الخاص' : 'Private Key'}</h3>
                    <button onClick={onClose} className={`p-2 rounded-full ${darkMode ? 'hover:bg-white/5 text-gray-500' : 'hover:bg-gray-100 text-gray-400'}`}>
                        <X size={20} />
                    </button>
                </div>
                <div className="space-y-4">
                    <div className={`p-4 rounded-xl break-all font-mono text-xs ${darkMode ? 'bg-gray-800 text-gray-200' : 'bg-gray-100 text-gray-800'}`}>
                        {privateKey}
                    </div>
                    <button onClick={handleCopy} className={`w-full py-3 rounded-xl font-bold flex items-center justify-center gap-2 ${copied ? 'bg-green-600 text-white' : 'bg-blue-600 text-white hover:bg-blue-700'} transition`}>
                        {copied ? <Check size={18} /> : <Copy size={18} />}
                        {copied ? (language === 'ar' ? 'تم النسخ' : 'Copied') : (language === 'ar' ? 'نسخ المفتاح' : 'Copy Key')}
                    </button>
                    <div className={`p-3 rounded-xl flex items-start gap-2 ${darkMode ? 'bg-red-900/20 text-red-400' : 'bg-red-50 text-red-600'}`}>
                        <TriangleAlert size={18} className="shrink-0 mt-0.5" />
                        <span className="text-xs font-medium leading-tight">{language === 'ar' ? 'تحذير: لا تشارك هذا المفتاح مع أي شخص. يمكنه سرقة أموالك.' : 'Warning: Never share this key. Anyone with it can access your funds.'}</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
