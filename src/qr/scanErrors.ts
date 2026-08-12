/**
 * User-facing scan and TON Connect error messages.
 *
 * Never exposes stack traces, bridge internals, or protocol secrets.
 */

import type { ScanResult } from './classifier';
import { TonConnectWalletError } from '../tonconnect/wallet/errors';
import { QrImageDecodeError } from './imageDecoder';
import { CameraSessionError } from './camera';
import { WalletExecutionError } from '../wallet/errors';

export function unsupportedScanMessage(language: string): string {
    return language === 'ar'
        ? 'رمز QR غير مدعوم أو غير صالح.'
        : 'Unsupported or invalid QR content.';
}

export function tonConnectErrorMessage(error: unknown, language = 'en'): string {
    const isAr = language === 'ar';

    if (error instanceof TonConnectWalletError) {
        switch (error.code) {
            case 'INVALID_CONNECT_LINK':
                return isAr ? 'رابط TON Connect غير صالح.' : 'Invalid TON Connect link.';
            case 'UNSUPPORTED_PROTOCOL_VERSION':
                return isAr ? 'إصدار TON Connect غير مدعوم.' : 'Unsupported TON Connect protocol version.';
            case 'INVALID_CONNECT_REQUEST':
                return isAr ? 'طلب الاتصال غير صالح.' : 'Invalid connection request.';
            case 'INVALID_MANIFEST':
                return isAr ? 'بيان التطبيق غير صالح.' : 'Invalid application manifest.';
            case 'MANIFEST_UNAVAILABLE':
                return isAr ? 'تعذر تحميل بيان التطبيق.' : 'Application manifest is unavailable.';
            case 'NETWORK_MISMATCH':
                return isAr ? 'الشبكة غير مدعومة لهذا الطلب.' : 'Unsupported network for this request.';
            case 'INVALID_SESSION':
                return error.message;
            case 'REPLAYED_APP_REQUEST':
                return isAr ? 'طلب مكرر أو منتهي.' : 'Duplicate or expired request.';
            default:
                return error.message;
        }
    }

    if (error instanceof QrImageDecodeError) {
        switch (error.code) {
            case 'IMAGE_UNSUPPORTED_FORMAT':
                return isAr ? 'صيغة الصورة غير مدعومة.' : 'Unsupported image format.';
            case 'IMAGE_TOO_LARGE':
                return isAr ? 'الصورة كبيرة جداً.' : 'The image is too large.';
            case 'IMAGE_EMPTY':
                return isAr ? 'الصورة فارغة.' : 'The image is empty.';
            case 'IMAGE_NO_QR':
                return isAr ? 'لم يتم العثور على رمز QR.' : 'No QR code was found in this image.';
            case 'IMAGE_MULTIPLE_QR':
                return isAr ? 'تم العثور على أكثر من رمز QR.' : 'Multiple QR codes were found.';
            case 'IMAGE_LOAD_FAILED':
            case 'IMAGE_DECODE_FAILED':
                return isAr ? 'تعذر قراءة الصورة.' : 'The image could not be decoded.';
            default:
                return error.message;
        }
    }

    if (error instanceof CameraSessionError) {
        switch (error.code) {
            case 'CAMERA_PERMISSION_DENIED':
                return isAr ? 'تم رفض إذن الكاميرا.' : 'Camera permission denied.';
            case 'CAMERA_NOT_FOUND':
                return isAr ? 'لم يتم العثور على كاميرا.' : 'No camera was found.';
            default:
                return isAr ? 'تعذر تشغيل الكاميرا.' : 'The camera failed to start.';
        }
    }

    if (error instanceof WalletExecutionError) {
        return error.message;
    }

    if (error instanceof Error) {
        if (/invalid password/i.test(error.message)) {
            return isAr ? 'كلمة مرور المحفظة غير صحيحة.' : 'Invalid wallet password.';
        }
        if (/failed to fetch|network|abort/i.test(error.message)) {
            return isAr ? 'تعذر تحميل بيان التطبيق.' : 'Application manifest is unavailable.';
        }
        if (error.message.trim().length > 0) {
            return error.message;
        }
    }

    return isAr ? 'حدث خطأ غير متوقع.' : 'An unexpected error occurred.';
}

export function classifyScanFailure(result: ScanResult, language = 'en'): string | null {
    if (result.kind !== 'UNSUPPORTED') return null;
    return unsupportedScanMessage(language);
}
