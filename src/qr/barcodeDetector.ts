/**
 * Injectable QR barcode detector used by the camera frame loop and image upload flow.
 *
 * Prefers the browser BarcodeDetector API when available, otherwise falls back to
 * the bundled jsQR library for fully local decoding.
 */

import jsQR from 'jsqr';
import type { DecodedFrame, FrameSource, FrameSourceFactory } from './camera';

export interface QrDetectResult {
    readonly rawValue: string;
}

export interface QrBarcodeDetector {
    detect(source: ImageBitmap | HTMLVideoElement | HTMLCanvasElement): Promise<readonly QrDetectResult[]>;
}

type BarcodeDetectorConstructor = new (options: { formats: string[] }) => {
    detect(source: ImageBitmap | HTMLVideoElement | HTMLCanvasElement): Promise<Array<{ rawValue: string }>>;
};

let scratchCanvas: HTMLCanvasElement | null = null;

function readBarcodeDetectorConstructor(): BarcodeDetectorConstructor | null {
    const candidate = (globalThis as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
    return candidate ?? null;
}

function getScratchCanvas(width: number, height: number): HTMLCanvasElement {
    if (!scratchCanvas) {
        scratchCanvas = document.createElement('canvas');
    }
    scratchCanvas.width = width;
    scratchCanvas.height = height;
    return scratchCanvas;
}

async function readImageData(source: ImageBitmap | HTMLVideoElement | HTMLCanvasElement): Promise<ImageData | null> {
    if (source instanceof HTMLCanvasElement) {
        const context = source.getContext('2d');
        if (!context || source.width <= 0 || source.height <= 0) return null;
        return context.getImageData(0, 0, source.width, source.height);
    }

    const width = source instanceof HTMLVideoElement ? source.videoWidth : source.width;
    const height = source instanceof HTMLVideoElement ? source.videoHeight : source.height;
    if (width <= 0 || height <= 0) return null;

    const canvas = getScratchCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(source, 0, 0, width, height);
    return context.getImageData(0, 0, width, height);
}

/** Returns a browser BarcodeDetector wrapper, or null when unsupported. */
export function createBrowserBarcodeDetector(): QrBarcodeDetector | null {
    const BarcodeDetectorAPI = readBarcodeDetectorConstructor();
    if (!BarcodeDetectorAPI) return null;

    const detector = new BarcodeDetectorAPI({ formats: ['qr_code'] });
    return {
        detect: async (source) => {
            const codes = await detector.detect(source);
            return codes.map((code) => ({ rawValue: code.rawValue }));
        },
    };
}

/** Local jsQR-based detector — works in browsers without BarcodeDetector. */
export function createJsQrBarcodeDetector(): QrBarcodeDetector {
    return {
        detect: async (source) => {
            const imageData = await readImageData(source);
            if (!imageData) return [];
            const result = jsQR(imageData.data, imageData.width, imageData.height);
            if (!result?.data) return [];
            return [{ rawValue: result.data }];
        },
    };
}

/** Preferred detector: native BarcodeDetector when available, otherwise jsQR. */
export function createQrBarcodeDetector(): QrBarcodeDetector {
    return createBrowserBarcodeDetector() ?? createJsQrBarcodeDetector();
}

/** Frame loop factory that decodes QR codes from a live camera feed. */
export function createBarcodeDetectorFrameSourceFactory(detector: QrBarcodeDetector): FrameSourceFactory {
    return {
        create(video, onFrame) {
            let active = true;
            let frameHandle: number | null = null;

            const loop = async () => {
                if (!active) return;
                try {
                    const codes = await detector.detect(video);
                    const first = codes[0];
                    if (first?.rawValue) {
                        const frame: DecodedFrame = { text: first.rawValue };
                        onFrame(frame);
                        return;
                    }
                } catch {
                    // Keep scanning on transient decode failures.
                }
                if (active) {
                    frameHandle = requestAnimationFrame(() => void loop());
                }
            };

            frameHandle = requestAnimationFrame(() => void loop());

            const frameSource: FrameSource = {
                stop() {
                    active = false;
                    if (frameHandle !== null) {
                        cancelAnimationFrame(frameHandle);
                        frameHandle = null;
                    }
                },
            };

            return frameSource;
        },
    };
}
