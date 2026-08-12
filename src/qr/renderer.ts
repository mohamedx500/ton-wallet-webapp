/**
 * Local QR code renderer — no remote service, no data leakage.
 *
 * Wraps `qrcode.toCanvas` with explicit input bounds and a typed result so
 * callers never have to reason about the underlying library's error surface.
 *
 * Security contract:
 *   - The `text` argument is encoded locally by the qrcode library.
 *   - Nothing is sent over the network.
 *   - The caller is responsible for supplying only public, non-secret text
 *     (wallet receive addresses or approved URIs).
 */

import { toCanvas } from 'qrcode';

/** Pixels — must be a positive integer. */
export const QR_MIN_SIZE = 64;
export const QR_MAX_SIZE = 512;
export const QR_MAX_TEXT_BYTES = 2_953; // QR version 40, byte mode capacity

const UTF8 = new TextEncoder();

export type QrRenderErrorCode =
    | 'QR_TEXT_EMPTY'
    | 'QR_TEXT_TOO_LARGE'
    | 'QR_SIZE_INVALID'
    | 'QR_RENDER_FAILED';

export class QrRenderError extends Error {
    public readonly code: QrRenderErrorCode;

    public constructor(code: QrRenderErrorCode, message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = 'QrRenderError';
        this.code = code;
    }
}

export interface QrRenderOptions {
    /** Canvas pixel dimension (width = height). Defaults to 256. Must be within [QR_MIN_SIZE, QR_MAX_SIZE]. */
    readonly size?: number;
    /** Error-correction level. Defaults to 'M'. */
    readonly errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
}

/**
 * Render a QR code for `text` into `canvas` using the local qrcode library.
 *
 * Rejects with `QrRenderError` if the input is out of bounds or rendering fails.
 * Never constructs a remote URL.
 */
export async function renderQrCode(
    canvas: HTMLCanvasElement,
    text: string,
    options: QrRenderOptions = {},
): Promise<void> {
    if (typeof text !== 'string' || text.length === 0) {
        throw new QrRenderError('QR_TEXT_EMPTY', 'QR code text must not be empty.');
    }
    if (UTF8.encode(text).byteLength > QR_MAX_TEXT_BYTES) {
        throw new QrRenderError('QR_TEXT_TOO_LARGE', 'QR code text exceeds the maximum byte length.');
    }

    const size = options.size ?? 256;
    if (!Number.isInteger(size) || size < QR_MIN_SIZE || size > QR_MAX_SIZE) {
        throw new QrRenderError(
            'QR_SIZE_INVALID',
            `QR canvas size must be an integer between ${QR_MIN_SIZE} and ${QR_MAX_SIZE}.`,
        );
    }

    try {
        await toCanvas(canvas, text, {
            width: size,
            margin: 1,
            errorCorrectionLevel: options.errorCorrectionLevel ?? 'M',
            color: { dark: '#000000ff', light: '#ffffffff' },
        });
    } catch (cause) {
        throw new QrRenderError('QR_RENDER_FAILED', 'QR code rendering failed.', { cause });
    }
}
