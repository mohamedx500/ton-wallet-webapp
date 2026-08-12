/**
 * QrScanModal — Slice 6: Full-screen QR code scanner.
 *
 * Uses `src/qr/camera.ts` for camera access and `classifyScanResult()` for
 * decoding the scanned content. Fires `onTonConnect(link)` for `tc://` links
 * and `onTransfer(result)` for `ton://` transfer links.
 *
 * Design: dark glassmorphism full-screen overlay with animated scan crosshair,
 * result flash animation, and torch toggle button.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Flashlight, FlashlightOff, Camera } from 'lucide-react';
import { cn } from '../lib/utils';
import type { TonConnectLink } from '../tonconnect/wallet/types';

// Dynamic imports to avoid loading camera code until needed
type ClassifyResult =
    | { kind: 'ton-transfer'; address: string; amount?: string; comment?: string }
    | { kind: 'ton-connect'; link: TonConnectLink }
    | { kind: 'raw-address'; address: string }
    | { kind: 'unknown'; raw: string };

interface QrScanModalProps {
    isOpen: boolean;
    onClose: () => void;
    onTonConnect: (link: TonConnectLink) => void;
    onTransfer: (address: string, amount?: string, comment?: string) => void;
    onAddress: (address: string) => void;
    darkMode: boolean;
    language: string;
}

export default function QrScanModal({
    isOpen,
    onClose,
    onTonConnect,
    onTransfer,
    onAddress,
    darkMode,
    language,
}: QrScanModalProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const scanLoopRef = useRef<number | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [torchOn, setTorchOn] = useState(false);
    const [scanning, setScanning] = useState(false);
    const [detected, setDetected] = useState(false);
    const isAr = language === 'ar';

    const stopCamera = useCallback(() => {
        if (scanLoopRef.current !== null) {
            cancelAnimationFrame(scanLoopRef.current);
            scanLoopRef.current = null;
        }
        if (streamRef.current) {
            for (const track of streamRef.current.getTracks()) track.stop();
            streamRef.current = null;
        }
        setScanning(false);
    }, []);

    const handleResult = useCallback((raw: string) => {
        const decoded = raw.trim();
        setDetected(true);
        setTimeout(() => setDetected(false), 600);

        // Simple classification inline (avoids dynamic import complexity)
        if (decoded.startsWith('tc://') || decoded.startsWith('tonconnect://')) {
            // TON Connect link — parse and dispatch
            const url = new URL(decoded);
            const id = url.searchParams.get('id') ?? '';
            const r = url.searchParams.get('r') ?? '{}';
            stopCamera();
            onClose();
            try {
                const parsed = JSON.parse(r) as Record<string, unknown>;
                onTonConnect({
                    version: 2,
                    appClientId: id,
                    request: parsed as unknown as TonConnectLink['request'],
                    returnStrategy: { kind: 'none' },
                    traceId: null,
                });
            } catch {
                // ignore parse error
            }
            return;
        }

        if (decoded.startsWith('ton://transfer/') || decoded.startsWith('ton:')) {
            try {
                const url = new URL(decoded.replace('ton://', 'ton://'));
                const address = decoded.startsWith('ton://transfer/')
                    ? decoded.slice('ton://transfer/'.length).split('?')[0] ?? ''
                    : url.pathname.slice(1);
                const params = url.searchParams;
                const amount = params.get('amount') ?? undefined;
                const comment = params.get('text') ?? params.get('comment') ?? undefined;
                stopCamera();
                onClose();
                onTransfer(address, amount, comment);
                return;
            } catch {/* fall through */}
        }

        // Raw address (UQ…, EQ…, 0:…)
        if (/^(UQ|EQ|kQ|0:)[A-Za-z0-9_-]{46,}/.test(decoded)) {
            stopCamera();
            onClose();
            onAddress(decoded);
            return;
        }

        // Unknown — ignore and keep scanning
    }, [stopCamera, onClose, onTonConnect, onTransfer, onAddress]);

    const startCamera = useCallback(async () => {
        setError(null);
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
            });
            streamRef.current = stream;
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                await videoRef.current.play();
                setScanning(true);

                // Start scan loop using BarcodeDetector if available
                const BarcodeDetectorAPI = (window as unknown as { BarcodeDetector?: { isTypeSupported: (t: string) => Promise<boolean>; new (o: { formats: string[] }): { detect: (v: HTMLVideoElement) => Promise<Array<{ rawValue: string }>> } } }).BarcodeDetector;

                if (BarcodeDetectorAPI) {
                    const detector = new BarcodeDetectorAPI({ formats: ['qr_code'] });
                    const loop = async () => {
                        if (!streamRef.current || !videoRef.current) return;
                        try {
                            const codes = await detector.detect(videoRef.current);
                            if (codes.length > 0 && codes[0]?.rawValue) {
                                handleResult(codes[0].rawValue);
                                return; // stop looping after detection
                            }
                        } catch {/* continue */}
                        scanLoopRef.current = requestAnimationFrame(() => void loop());
                    };
                    scanLoopRef.current = requestAnimationFrame(() => void loop());
                } else {
                    // Fallback: canvas-based ZXing-style decode is not bundled.
                    // Show user a message that they need a browser with BarcodeDetector.
                    setError('QR scanning requires Chrome/Edge 88+ or a compatible browser.');
                }
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Camera access denied');
        }
    }, [handleResult]);

    useEffect(() => {
        if (isOpen) {
            void startCamera();
        } else {
            stopCamera();
        }
        return () => stopCamera();
    }, [isOpen, startCamera, stopCamera]);

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

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    className="fixed inset-0 z-[100] flex flex-col bg-black"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                >
                    {/* Camera feed */}
                    <video
                        ref={videoRef}
                        className="absolute inset-0 w-full h-full object-cover"
                        playsInline
                        muted
                    />
                    <canvas ref={canvasRef} className="hidden" />

                    {/* Dark overlay */}
                    <div className="absolute inset-0 bg-black/50" />

                    {/* Scan crosshair */}
                    <div className="absolute inset-0 flex items-center justify-center">
                        <div className="relative w-64 h-64">
                            {/* Corners */}
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
                            {/* Scan line */}
                            <motion.div
                                className="absolute left-2 right-2 h-0.5 bg-gradient-to-r from-transparent via-blue-400 to-transparent"
                                animate={{ top: ['10%', '90%', '10%'] }}
                                transition={{ duration: 2.5, repeat: Infinity, ease: 'linear' }}
                            />
                            {/* Detection flash */}
                            <AnimatePresence>
                                {detected && (
                                    <motion.div
                                        className="absolute inset-0 rounded-2xl bg-blue-400/30 border-2 border-blue-400"
                                        initial={{ opacity: 0, scale: 0.9 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        exit={{ opacity: 0 }}
                                    />
                                )}
                            </AnimatePresence>
                        </div>
                    </div>

                    {/* Instructions */}
                    <div className="absolute bottom-36 left-0 right-0 flex flex-col items-center gap-2 px-6">
                        <p className="text-white/80 text-sm text-center">
                            {isAr ? 'وجّه الكاميرا نحو رمز QR' : 'Point the camera at a QR code'}
                        </p>
                        {error && (
                            <p className="text-red-400 text-xs text-center">{error}</p>
                        )}
                    </div>

                    {/* Controls */}
                    <div className="absolute bottom-12 left-0 right-0 flex items-center justify-center gap-6">
                        <button
                            onClick={() => void toggleTorch()}
                            className="w-12 h-12 rounded-full bg-white/10 backdrop-blur-md flex items-center justify-center text-white hover:bg-white/20 transition-colors"
                        >
                            {torchOn ? <FlashlightOff size={20} /> : <Flashlight size={20} />}
                        </button>
                        <button
                            onClick={() => { stopCamera(); onClose(); }}
                            className="w-14 h-14 rounded-full bg-white/15 backdrop-blur-md flex items-center justify-center text-white hover:bg-white/25 transition-colors"
                        >
                            <X size={22} />
                        </button>
                    </div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
