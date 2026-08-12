/**
 * LinkWalletModal — connect a wallet via camera scan, uploaded QR image, or pasted link.
 *
 * All TON Connect URIs are classified through `classifyScanResult()` and routed into
 * the existing wallet-side TON Connect session flow. Plain address/payment QR codes
 * continue through the transfer/address handlers and never create TON Connect sessions.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    X,
    Flashlight,
    FlashlightOff,
    Camera,
    Upload,
    Link2,
    ChevronLeft,
    Loader2,
} from 'lucide-react';
import { cn } from '../lib/utils';
import type { NetworkId } from '../core/chain';
import type { TonConnectLink } from '../tonconnect/wallet/types';
import {
    CameraSessionController,
    CameraSessionError,
    classifyScanResult,
    createBarcodeDetectorFrameSourceFactory,
    createQrBarcodeDetector,
    decodeQrFromImage,
    tonConnectErrorMessage,
    classifyScanFailure,
    unsupportedScanMessage,
} from '../qr';

type LinkMode = 'menu' | 'camera' | 'upload' | 'paste';

interface LinkWalletModalProps {
    isOpen: boolean;
    onClose: () => void;
    network: NetworkId;
    onTonConnect: (link: TonConnectLink) => void;
    onTransfer: (address: string, amount?: string, comment?: string) => void;
    onAddress: (address: string) => void;
    darkMode: boolean;
    language: string;
}

function tryRawAddress(raw: string): string | null {
    const decoded = raw.trim();
    if (/^(UQ|EQ|kQ|0:)[A-Za-z0-9_-]{46,}/.test(decoded)) {
        return decoded;
    }
    return null;
}

function tonTransferFromUnsupported(raw: string): { address: string; amount?: string; comment?: string } | null {
    const trimmed = raw.trim();
    if (!trimmed.startsWith('ton://transfer/') && !trimmed.startsWith('ton:')) {
        return null;
    }
    try {
        const url = new URL(trimmed.replace('ton://', 'ton://'));
        const address = trimmed.startsWith('ton://transfer/')
            ? trimmed.slice('ton://transfer/'.length).split('?')[0] ?? ''
            : url.pathname.slice(1);
        const params = url.searchParams;
        return {
            address,
            amount: params.get('amount') ?? undefined,
            comment: params.get('text') ?? params.get('comment') ?? undefined,
        };
    } catch {
        return null;
    }
}

export default function LinkWalletModal({
    isOpen,
    onClose,
    network,
    onTonConnect,
    onTransfer,
    onAddress,
    darkMode,
    language,
}: LinkWalletModalProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const cameraControllerRef = useRef<CameraSessionController | null>(null);
    const streamRef = useRef<MediaStream | null>(null);

    const [mode, setMode] = useState<LinkMode>('menu');
    const [error, setError] = useState<string | null>(null);
    const [torchOn, setTorchOn] = useState(false);
    const [detected, setDetected] = useState(false);
    const [pasteValue, setPasteValue] = useState('');
    const [uploading, setUploading] = useState(false);

    const isAr = language === 'ar';

    const resetLocalState = useCallback(() => {
        setMode('menu');
        setError(null);
        setTorchOn(false);
        setDetected(false);
        setPasteValue('');
        setUploading(false);
    }, []);

    const stopCamera = useCallback(() => {
        cameraControllerRef.current?.stop();
        cameraControllerRef.current = null;
        if (streamRef.current) {
            for (const track of streamRef.current.getTracks()) track.stop();
            streamRef.current = null;
        }
    }, []);

    const handleClose = useCallback(() => {
        stopCamera();
        resetLocalState();
        onClose();
    }, [onClose, resetLocalState, stopCamera]);

    const dispatchScanText = useCallback((raw: string, pasteOnly = false) => {
        const result = classifyScanResult(raw, network);

        if (result.kind === 'TON_CONNECT_LINK') {
            stopCamera();
            resetLocalState();
            onClose();
            onTonConnect(result.link);
            return;
        }

        if (result.kind === 'TON_TRANSFER') {
            stopCamera();
            resetLocalState();
            onClose();
            onTransfer(
                result.address,
                result.amountNano === null ? undefined : result.amountNano.toString(),
                result.comment ?? undefined,
            );
            return;
        }

        if (pasteOnly) {
            setError(classifyScanFailure(result, language) ?? unsupportedScanMessage(language));
            return;
        }

        const transferFallback = tonTransferFromUnsupported(raw);
        if (transferFallback) {
            stopCamera();
            resetLocalState();
            onClose();
            onTransfer(transferFallback.address, transferFallback.amount, transferFallback.comment);
            return;
        }

        const address = tryRawAddress(raw);
        if (address) {
            stopCamera();
            resetLocalState();
            onClose();
            onAddress(address);
            return;
        }

        setDetected(true);
        setTimeout(() => setDetected(false), 600);
        setError(classifyScanFailure(result, language) ?? unsupportedScanMessage(language));
    }, [language, network, onAddress, onClose, onTonConnect, onTransfer, resetLocalState, stopCamera]);

    const startCamera = useCallback(async () => {
        setError(null);
        const detector = createQrBarcodeDetector();

        const video = videoRef.current;
        if (!video) return;

        const controller = new CameraSessionController({
            mediaDevices: navigator.mediaDevices,
            frameSourceFactory: createBarcodeDetectorFrameSourceFactory(detector),
            onScan: (text) => dispatchScanText(text),
            onError: (cameraError) => {
                setError(tonConnectErrorMessage(cameraError, language));
            },
        });

        cameraControllerRef.current = controller;
        try {
            await controller.start(video);
            streamRef.current = video.srcObject as MediaStream | null;
        } catch (err) {
            const message = err instanceof CameraSessionError || err instanceof Error
                ? tonConnectErrorMessage(err, language)
                : tonConnectErrorMessage(new CameraSessionError('CAMERA_START_FAILED', 'The camera failed to start.'), language);
            setError(message);
        }
    }, [dispatchScanText, isAr, language]);

    useEffect(() => {
        if (!isOpen) {
            stopCamera();
            resetLocalState();
            return;
        }

        if (mode === 'camera') {
            void startCamera();
        } else {
            stopCamera();
        }

        return () => stopCamera();
    }, [isOpen, mode, resetLocalState, startCamera, stopCamera]);

    const toggleTorch = async () => {
        if (!streamRef.current) return;
        const track = streamRef.current.getVideoTracks()[0];
        if (!track) return;
        const capabilities = track.getCapabilities() as MediaTrackCapabilities & { torch?: boolean };
        if (!capabilities.torch) return;
        const newState = !torchOn;
        await track.applyConstraints({ advanced: [{ torch: newState } as MediaTrackConstraintSet] });
        setTorchOn(newState);
    };

    const handleUpload = async (file: File | null) => {
        if (!file) return;
        setUploading(true);
        setError(null);

        try {
            const detector = createQrBarcodeDetector();
            const text = await decodeQrFromImage(file, detector);
            dispatchScanText(text);
        } catch (err) {
            setError(tonConnectErrorMessage(err, language));
        } finally {
            setUploading(false);
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    };

    const handlePasteSubmit = () => {
        const trimmed = pasteValue.trim();
        if (!trimmed) {
            setError(isAr ? 'الصق رابط TON Connect.' : 'Paste a TON Connect link.');
            return;
        }
        setError(null);
        dispatchScanText(trimmed, true);
    };

    const sheetClass = cn(
        'w-full max-w-md rounded-t-3xl p-6 ring-1',
        darkMode ? 'bg-[hsl(228,18%,8%)] ring-white/[0.08]' : 'bg-white ring-black/[0.06]',
    );

    const menuButtonClass = cn(
        'w-full flex items-center gap-3 px-4 py-3.5 rounded-xl text-sm font-semibold transition-all active:scale-[0.99]',
        darkMode ? 'bg-white/[0.05] text-white hover:bg-white/[0.08]' : 'bg-gray-50 text-gray-900 hover:bg-gray-100',
    );

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    className={cn(
                        'fixed inset-0 z-[100] flex flex-col',
                        mode === 'camera' ? 'bg-black' : 'items-end justify-center bg-black/60 backdrop-blur-sm',
                    )}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                >
                    {mode === 'camera' ? (
                        <>
                            <video
                                ref={videoRef}
                                className="absolute inset-0 w-full h-full object-cover"
                                playsInline
                                muted
                            />
                            <div className="absolute inset-0 bg-black/50" />
                            <div className="absolute inset-0 flex items-center justify-center">
                                <div className="relative w-64 h-64">
                                    {['tl', 'tr', 'bl', 'br'].map((corner) => (
                                        <motion.div
                                            key={corner}
                                            className={cn(
                                                'absolute w-8 h-8 border-2 border-blue-400',
                                                corner === 'tl' && 'top-0 left-0 border-r-0 border-b-0 rounded-tl-xl',
                                                corner === 'tr' && 'top-0 right-0 border-l-0 border-b-0 rounded-tr-xl',
                                                corner === 'bl' && 'bottom-0 left-0 border-r-0 border-t-0 rounded-bl-xl',
                                                corner === 'br' && 'bottom-0 right-0 border-l-0 border-t-0 rounded-br-xl',
                                            )}
                                            animate={{ opacity: detected ? 0 : 1 }}
                                        />
                                    ))}
                                    <motion.div
                                        className="absolute left-2 right-2 h-0.5 bg-gradient-to-r from-transparent via-blue-400 to-transparent"
                                        animate={{ top: ['10%', '90%', '10%'] }}
                                        transition={{ duration: 2.5, repeat: Infinity, ease: 'linear' }}
                                    />
                                </div>
                            </div>
                            <div className="absolute top-12 left-0 right-0 flex items-center justify-between px-5">
                                <button
                                    onClick={() => { stopCamera(); setMode('menu'); setError(null); }}
                                    className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white"
                                >
                                    <ChevronLeft size={20} />
                                </button>
                                <p className="text-white text-sm font-semibold">
                                    {isAr ? 'مسح بالكاميرا' : 'Scan with Camera'}
                                </p>
                                <div className="w-10" />
                            </div>
                            <div className="absolute bottom-36 left-0 right-0 flex flex-col items-center gap-2 px-6">
                                <p className="text-white/80 text-sm text-center">
                                    {isAr ? 'وجّه الكاميرا نحو رمز QR' : 'Point the camera at a QR code'}
                                </p>
                                {error && <p className="text-red-400 text-xs text-center">{error}</p>}
                            </div>
                            <div className="absolute bottom-12 left-0 right-0 flex items-center justify-center gap-6">
                                <button
                                    onClick={() => void toggleTorch()}
                                    className="w-12 h-12 rounded-full bg-white/10 backdrop-blur-md flex items-center justify-center text-white hover:bg-white/20 transition-colors"
                                >
                                    {torchOn ? <FlashlightOff size={20} /> : <Flashlight size={20} />}
                                </button>
                                <button
                                    onClick={handleClose}
                                    className="w-14 h-14 rounded-full bg-white/15 backdrop-blur-md flex items-center justify-center text-white hover:bg-white/25 transition-colors"
                                >
                                    <X size={22} />
                                </button>
                            </div>
                        </>
                    ) : (
                        <motion.div
                            className={sheetClass}
                            initial={{ y: '100%' }}
                            animate={{ y: 0 }}
                            exit={{ y: '100%' }}
                            transition={{ type: 'spring', stiffness: 340, damping: 32 }}
                        >
                            <div className="flex items-center justify-between mb-5">
                                {mode !== 'menu' ? (
                                    <button
                                        onClick={() => { setMode('menu'); setError(null); setPasteValue(''); }}
                                        className="p-2 rounded-xl text-gray-400 hover:bg-white/10 transition-colors"
                                    >
                                        <ChevronLeft size={18} />
                                    </button>
                                ) : (
                                    <div className="w-9" />
                                )}
                                <p className={cn('text-base font-bold', darkMode ? 'text-white' : 'text-gray-900')}>
                                    {isAr ? 'ربط المحفظة' : 'Link Wallet'}
                                </p>
                                <button onClick={handleClose} className="p-2 rounded-xl text-gray-400 hover:bg-white/10 transition-colors">
                                    <X size={18} />
                                </button>
                            </div>

                            {mode === 'menu' && (
                                <div className="flex flex-col gap-3">
                                    <button className={menuButtonClass} onClick={() => setMode('camera')}>
                                        <Camera size={18} className="text-cyan-400" />
                                        {isAr ? 'مسح بالكاميرا' : 'Scan with Camera'}
                                    </button>
                                    <button className={menuButtonClass} onClick={() => fileInputRef.current?.click()}>
                                        <Upload size={18} className="text-cyan-400" />
                                        {isAr ? 'رفع صورة QR' : 'Upload QR Image'}
                                    </button>
                                    <button className={menuButtonClass} onClick={() => setMode('paste')}>
                                        <Link2 size={18} className="text-cyan-400" />
                                        {isAr ? 'لصق رابط TON Connect' : 'Paste TON Connect Link'}
                                    </button>
                                    <div className={cn('border-t pt-4 mt-1', darkMode ? 'border-white/[0.08]' : 'border-black/[0.06]')}>
                                        <p className="text-xs text-gray-400 text-center">
                                            {isAr ? 'مدعوم: TON Connect v2' : 'Supported: TON Connect v2'}
                                        </p>
                                    </div>
                                </div>
                            )}

                            {mode === 'paste' && (
                                <div className="flex flex-col gap-3">
                                    <textarea
                                        value={pasteValue}
                                        onChange={(event) => setPasteValue(event.target.value)}
                                        placeholder={isAr ? 'tc://?v=2&...' : 'tc://?v=2&...'}
                                        rows={4}
                                        className={cn(
                                            'w-full px-4 py-3 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/50',
                                            darkMode ? 'bg-white/[0.05] text-white border border-white/[0.08]' : 'bg-gray-50 text-gray-900 border border-gray-200',
                                        )}
                                    />
                                    <button
                                        onClick={handlePasteSubmit}
                                        className="w-full py-3.5 rounded-xl bg-gradient-to-r from-blue-500 to-blue-600 text-white text-sm font-semibold"
                                    >
                                        {isAr ? 'متابعة' : 'Continue'}
                                    </button>
                                </div>
                            )}

                            {mode === 'upload' && uploading && (
                                <div className="flex items-center justify-center gap-2 py-6 text-sm text-gray-400">
                                    <Loader2 size={18} className="animate-spin" />
                                    {isAr ? 'جاري فك QR...' : 'Decoding QR…'}
                                </div>
                            )}

                            {error && (
                                <p className="text-red-400 text-xs text-center mt-3">{error}</p>
                            )}

                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/png,image/jpeg,image/jpg,image/webp"
                                className="hidden"
                                onChange={(event) => {
                                    setMode('upload');
                                    void handleUpload(event.target.files?.[0] ?? null);
                                }}
                            />
                        </motion.div>
                    )}
                </motion.div>
            )}
        </AnimatePresence>
    );
}
