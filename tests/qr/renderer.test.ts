import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QR_MAX_SIZE, QR_MAX_TEXT_BYTES, QR_MIN_SIZE, QrRenderError, renderQrCode } from '../../src/qr/renderer';

// ---------------------------------------------------------------------------
// Fake canvas element — we replace qrcode.toCanvas with a spy, so the canvas
// object itself only needs to satisfy the HTMLCanvasElement type structurally.
// ---------------------------------------------------------------------------

function fakeCanvas(): HTMLCanvasElement {
    return {} as HTMLCanvasElement;
}

// ---------------------------------------------------------------------------
// Mock qrcode module
// ---------------------------------------------------------------------------

vi.mock('qrcode', () => ({
    toCanvas: vi.fn().mockResolvedValue(undefined),
}));

async function getToCanvasMock() {
    const mod = await import('qrcode');
    return vi.mocked(mod.toCanvas);
}

describe('renderQrCode', () => {
    beforeEach(async () => {
        const mod = await import('qrcode');
        vi.mocked(mod.toCanvas).mockClear();
        vi.mocked(mod.toCanvas).mockResolvedValue(undefined);
    });

    it('calls toCanvas with the supplied text and default size', async () => {
        const spy = await getToCanvasMock();
        const canvas = fakeCanvas();

        await renderQrCode(canvas, 'EQAbc123');

        expect(spy).toHaveBeenCalledOnce();
        const [calledCanvas, calledText, calledOptions] = spy.mock.calls[0]!;
        expect(calledCanvas).toBe(canvas);
        expect(calledText).toBe('EQAbc123');
        expect((calledOptions as { width: number }).width).toBe(256);
    });

    it('passes explicit size to toCanvas', async () => {
        const spy = await getToCanvasMock();

        await renderQrCode(fakeCanvas(), 'hello', { size: 128 });

        const [, , opts] = spy.mock.calls[0]!;
        expect((opts as { width: number }).width).toBe(128);
    });

    it('passes explicit errorCorrectionLevel to toCanvas', async () => {
        const spy = await getToCanvasMock();

        await renderQrCode(fakeCanvas(), 'hello', { errorCorrectionLevel: 'H' });

        const [, , opts] = spy.mock.calls[0]!;
        expect((opts as { errorCorrectionLevel: string }).errorCorrectionLevel).toBe('H');
    });

    it('rejects with QR_TEXT_EMPTY for empty string', async () => {
        await expect(renderQrCode(fakeCanvas(), '')).rejects.toSatisfy(
            (e: unknown) => e instanceof QrRenderError && e.code === 'QR_TEXT_EMPTY',
        );
    });

    it('rejects with QR_TEXT_EMPTY for non-string', async () => {
        await expect(
            renderQrCode(fakeCanvas(), null as unknown as string),
        ).rejects.toSatisfy(
            (e: unknown) => e instanceof QrRenderError && e.code === 'QR_TEXT_EMPTY',
        );
    });

    it('rejects with QR_TEXT_TOO_LARGE for oversized input', async () => {
        const big = 'a'.repeat(QR_MAX_TEXT_BYTES + 1);
        await expect(renderQrCode(fakeCanvas(), big)).rejects.toSatisfy(
            (e: unknown) => e instanceof QrRenderError && e.code === 'QR_TEXT_TOO_LARGE',
        );
    });

    it('rejects with QR_SIZE_INVALID for size below minimum', async () => {
        await expect(
            renderQrCode(fakeCanvas(), 'hello', { size: QR_MIN_SIZE - 1 }),
        ).rejects.toSatisfy(
            (e: unknown) => e instanceof QrRenderError && e.code === 'QR_SIZE_INVALID',
        );
    });

    it('rejects with QR_SIZE_INVALID for size above maximum', async () => {
        await expect(
            renderQrCode(fakeCanvas(), 'hello', { size: QR_MAX_SIZE + 1 }),
        ).rejects.toSatisfy(
            (e: unknown) => e instanceof QrRenderError && e.code === 'QR_SIZE_INVALID',
        );
    });

    it('rejects with QR_SIZE_INVALID for fractional size', async () => {
        await expect(
            renderQrCode(fakeCanvas(), 'hello', { size: 128.5 }),
        ).rejects.toSatisfy(
            (e: unknown) => e instanceof QrRenderError && e.code === 'QR_SIZE_INVALID',
        );
    });

    it('accepts minimum and maximum valid sizes', async () => {
        await expect(renderQrCode(fakeCanvas(), 'x', { size: QR_MIN_SIZE })).resolves.toBeUndefined();
        await expect(renderQrCode(fakeCanvas(), 'x', { size: QR_MAX_SIZE })).resolves.toBeUndefined();
    });

    it('wraps toCanvas rejection in QR_RENDER_FAILED', async () => {
        const spy = await getToCanvasMock();
        spy.mockRejectedValueOnce(new Error('canvas error'));

        await expect(renderQrCode(fakeCanvas(), 'hello')).rejects.toSatisfy(
            (e: unknown) => e instanceof QrRenderError && e.code === 'QR_RENDER_FAILED',
        );
    });

    it('never constructs a remote URL', async () => {
        const spy = await getToCanvasMock();

        // Intercept any URL construction
        const originalURL = globalThis.URL;
        let constructedUrls: string[] = [];
        const MockURL = class extends originalURL {
            constructor(input: string, base?: string | URL) {
                super(input, base);
                constructedUrls.push(input);
            }
        };
        globalThis.URL = MockURL as unknown as typeof URL;

        try {
            await renderQrCode(fakeCanvas(), 'EQtest');
        } finally {
            globalThis.URL = originalURL;
        }

        expect(constructedUrls.every((u) => !u.includes('qrserver') && !u.includes('http'))).toBe(true);
    });
});
