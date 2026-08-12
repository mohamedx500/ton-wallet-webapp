import { describe, expect, it, vi } from 'vitest';
import {
    decodeQrFromImage,
    QrImageDecodeError,
    type ImageLoadResult,
    type QrImageDecodeDependencies,
} from '../../src/qr/imageDecoder';
import type { QrBarcodeDetector } from '../../src/qr/barcodeDetector';

function pngBlob(size = 128): Blob {
    return new Blob([new Uint8Array(size)], { type: 'image/png' });
}

function jpegBlob(size = 128): Blob {
    return new Blob([new Uint8Array(size)], { type: 'image/jpeg' });
}

function fakeDetector(values: readonly string[]): QrBarcodeDetector {
    return {
        detect: vi.fn().mockResolvedValue(values.map((rawValue) => ({ rawValue }))),
    };
}

function fakeDependencies(image: ImageLoadResult): QrImageDecodeDependencies {
    return {
        createImageLoadResult: vi.fn().mockResolvedValue(image),
        createCanvas: vi.fn().mockReturnValue({} as HTMLCanvasElement),
    };
}

const loadedImage: ImageLoadResult = {
    width: 100,
    height: 100,
    drawTo: vi.fn(),
};

describe('decodeQrFromImage', () => {
    it('decodes a valid single QR from a PNG image', async () => {
        const text = 'tc://?v=2&id=' + 'a'.repeat(64);
        const detector = fakeDetector([text]);
        const deps = fakeDependencies(loadedImage);

        await expect(decodeQrFromImage(pngBlob(), detector, deps)).resolves.toBe(text);
    });

    it('accepts JPEG screenshots', async () => {
        const text = 'hello';
        const detector = fakeDetector([text]);
        const deps = fakeDependencies(loadedImage);

        await expect(decodeQrFromImage(jpegBlob(), detector, deps)).resolves.toBe('hello');
    });

    it('rejects unsupported formats', async () => {
        const blob = new Blob([new Uint8Array(8)], { type: 'image/gif' });
        await expect(
            decodeQrFromImage(blob, fakeDetector([]), fakeDependencies(loadedImage)),
        ).rejects.toSatisfy(
            (error: unknown) => error instanceof QrImageDecodeError && error.code === 'IMAGE_UNSUPPORTED_FORMAT',
        );
    });

    it('rejects empty images', async () => {
        await expect(
            decodeQrFromImage(new Blob([], { type: 'image/png' }), fakeDetector([]), fakeDependencies(loadedImage)),
        ).rejects.toSatisfy(
            (error: unknown) => error instanceof QrImageDecodeError && error.code === 'IMAGE_EMPTY',
        );
    });

    it('rejects images with no QR code', async () => {
        const detector = fakeDetector([]);
        const deps = fakeDependencies(loadedImage);

        await expect(decodeQrFromImage(pngBlob(), detector, deps)).rejects.toSatisfy(
            (error: unknown) => error instanceof QrImageDecodeError && error.code === 'IMAGE_NO_QR',
        );
    });

    it('rejects images with multiple distinct QR codes', async () => {
        const detector = fakeDetector(['first', 'second']);
        const deps = fakeDependencies(loadedImage);

        await expect(decodeQrFromImage(pngBlob(), detector, deps)).rejects.toSatisfy(
            (error: unknown) => error instanceof QrImageDecodeError && error.code === 'IMAGE_MULTIPLE_QR',
        );
    });

    it('deduplicates identical detections from screenshot-style images', async () => {
        const text = 'tc://?v=2&id=' + 'b'.repeat(64);
        const detector = fakeDetector([text, text]);
        const deps = fakeDependencies(loadedImage);

        await expect(decodeQrFromImage(pngBlob(), detector, deps)).resolves.toBe(text);
    });

    it('rejects zero-dimension images', async () => {
        const deps = fakeDependencies({
            width: 0,
            height: 0,
            drawTo: vi.fn(),
        });

        await expect(
            decodeQrFromImage(pngBlob(), fakeDetector(['x']), deps),
        ).rejects.toSatisfy(
            (error: unknown) => error instanceof QrImageDecodeError && error.code === 'IMAGE_EMPTY',
        );
    });
});
