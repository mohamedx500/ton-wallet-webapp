/**
 * Local QR decoder for uploaded image files.
 *
 * Uses an injected barcode detector — never uploads images to remote services.
 */

import type { QrBarcodeDetector } from './barcodeDetector';

export const QR_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

export const SUPPORTED_QR_IMAGE_TYPES = new Set([
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
]);

export type QrImageDecodeErrorCode =
    | 'IMAGE_UNSUPPORTED_FORMAT'
    | 'IMAGE_TOO_LARGE'
    | 'IMAGE_EMPTY'
    | 'IMAGE_LOAD_FAILED'
    | 'IMAGE_NO_QR'
    | 'IMAGE_MULTIPLE_QR'
    | 'IMAGE_DECODE_FAILED';

export class QrImageDecodeError extends Error {
    public readonly code: QrImageDecodeErrorCode;

    public constructor(code: QrImageDecodeErrorCode, message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = 'QrImageDecodeError';
        this.code = code;
    }
}

export interface ImageLoadResult {
    readonly width: number;
    readonly height: number;
    drawTo(canvas: HTMLCanvasElement): void;
}

export interface QrImageDecodeDependencies {
    readonly createImageLoadResult: (blob: Blob) => Promise<ImageLoadResult>;
    readonly createCanvas: (width: number, height: number) => HTMLCanvasElement;
}

const defaultDependencies: QrImageDecodeDependencies = {
    createImageLoadResult: (blob) => loadImageFromBlob(blob),
    createCanvas: (width, height) => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        return canvas;
    },
};

function loadImageFromBlob(blob: Blob): Promise<ImageLoadResult> {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const image = new Image();

        image.onload = () => {
            URL.revokeObjectURL(url);
            const width = image.naturalWidth;
            const height = image.naturalHeight;
            if (width <= 0 || height <= 0) {
                reject(new QrImageDecodeError('IMAGE_EMPTY', 'The selected image is empty.'));
                return;
            }
            resolve({
                width,
                height,
                drawTo(canvas) {
                    const context = canvas.getContext('2d');
                    if (!context) {
                        throw new QrImageDecodeError('IMAGE_DECODE_FAILED', 'The image could not be decoded.');
                    }
                    context.drawImage(image, 0, 0, width, height);
                },
            });
        };

        image.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new QrImageDecodeError('IMAGE_LOAD_FAILED', 'The selected image could not be loaded.'));
        };

        image.src = url;
    });
}

/**
 * Decode exactly one QR code from an uploaded image blob.
 *
 * Rejects with `QrImageDecodeError` for unsupported formats, empty images,
 * missing QR codes, or ambiguous multi-code images.
 */
export async function decodeQrFromImage(
    blob: Blob,
    detector: QrBarcodeDetector,
    dependencies: QrImageDecodeDependencies = defaultDependencies,
): Promise<string> {
    const mimeType = blob.type.toLowerCase();
    if (!SUPPORTED_QR_IMAGE_TYPES.has(mimeType)) {
        throw new QrImageDecodeError(
            'IMAGE_UNSUPPORTED_FORMAT',
            'Unsupported image format. Use PNG, JPG, or WebP.',
        );
    }

    if (blob.size <= 0) {
        throw new QrImageDecodeError('IMAGE_EMPTY', 'The selected image is empty.');
    }

    if (blob.size > QR_IMAGE_MAX_BYTES) {
        throw new QrImageDecodeError('IMAGE_TOO_LARGE', 'The selected image is too large.');
    }

    let image: ImageLoadResult;
    try {
        image = await dependencies.createImageLoadResult(blob);
    } catch (error) {
        if (error instanceof QrImageDecodeError) throw error;
        throw new QrImageDecodeError('IMAGE_LOAD_FAILED', 'The selected image could not be loaded.', { cause: error });
    }

    if (image.width <= 0 || image.height <= 0) {
        throw new QrImageDecodeError('IMAGE_EMPTY', 'The selected image is empty.');
    }

    const canvas = dependencies.createCanvas(image.width, image.height);
    try {
        image.drawTo(canvas);
    } catch (error) {
        if (error instanceof QrImageDecodeError) throw error;
        throw new QrImageDecodeError('IMAGE_DECODE_FAILED', 'The image could not be decoded.', { cause: error });
    }

    let codes: readonly { rawValue: string }[];
    try {
        codes = await detector.detect(canvas);
    } catch (error) {
        throw new QrImageDecodeError('IMAGE_DECODE_FAILED', 'The image could not be decoded.', { cause: error });
    }

    const values = [...new Set(codes.map((code) => code.rawValue.trim()).filter((value) => value.length > 0))];
    if (values.length === 0) {
        throw new QrImageDecodeError('IMAGE_NO_QR', 'No QR code was found in this image.');
    }
    if (values.length > 1) {
        throw new QrImageDecodeError('IMAGE_MULTIPLE_QR', 'Multiple QR codes were found. Use an image with one code.');
    }

    return values[0]!;
}
