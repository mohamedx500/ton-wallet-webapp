export {
    renderQrCode,
    QrRenderError,
    QR_MIN_SIZE,
    QR_MAX_SIZE,
    QR_MAX_TEXT_BYTES,
} from './renderer';
export type { QrRenderOptions, QrRenderErrorCode } from './renderer';

export {
    classifyScanResult,
    SCAN_MAX_TEXT_BYTES,
} from './classifier';
export type {
    ScanResult,
    ScanResultKind,
    TonConnectScanResult,
    TonTransferScanResult,
    UnsupportedScanResult,
} from './classifier';

export {
    CameraSessionController,
    CameraSessionError,
} from './camera';
export type {
    CameraSessionOptions,
    CameraSessionErrorCode,
    GetUserMediaSource,
    FrameSource,
    FrameSourceFactory,
    DecodedFrame,
} from './camera';

export {
    createBrowserBarcodeDetector,
    createJsQrBarcodeDetector,
    createQrBarcodeDetector,
    createBarcodeDetectorFrameSourceFactory,
} from './barcodeDetector';
export type { QrBarcodeDetector, QrDetectResult } from './barcodeDetector';

export {
    decodeQrFromImage,
    QrImageDecodeError,
    QR_IMAGE_MAX_BYTES,
    SUPPORTED_QR_IMAGE_TYPES,
} from './imageDecoder';
export type { QrImageDecodeErrorCode, QrImageDecodeDependencies, ImageLoadResult } from './imageDecoder';

export {
    tonConnectErrorMessage,
    unsupportedScanMessage,
    classifyScanFailure,
} from './scanErrors';
