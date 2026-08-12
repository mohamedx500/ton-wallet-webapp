/**
 * Opt-in camera session controller.
 *
 * Owns the entire lifecycle of a camera stream:
 *   - Requests permission via injected `getUserMedia` (never called until `start()`).
 *   - Feeds frames to an injected decoder factory.
 *   - Deduplicates consecutively repeated decoded strings.
 *   - Delivers each new unique scan to the caller via `onScan`.
 *   - Cleans up all media tracks on `stop()` or on error.
 *
 * Security contract:
 *   - Camera is opt-in: `start()` is never called implicitly.
 *   - Scanned text is delivered raw; the caller must classify it before acting.
 *   - No automatic navigation, transaction execution, or state mutation.
 *   - No scan results are stored, persisted, or logged.
 *   - All injected browser boundaries are accepted as constructor arguments so
 *     tests can supply fakes without touching globals.
 *
 * Frame deduplication:
 *   - Identical consecutive decoded strings are suppressed.
 *   - A new unique value always fires `onScan` regardless of history.
 */

// ─── injected browser boundary types ─────────────────────────────────────────

/** Minimal subset of `MediaDevices` needed by this controller. */
export interface GetUserMediaSource {
    getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
}

/** A single decoded frame from the camera. */
export interface DecodedFrame {
    readonly text: string;
}

/**
 * A running frame source that delivers decoded frames.
 * `stop()` must release all associated resources (animation loops, workers, etc.).
 */
export interface FrameSource {
    stop(): void;
}

/**
 * Factory that attaches a frame-decoding loop to a `<video>` element and
 * calls `onFrame` for each successfully decoded frame.
 */
export interface FrameSourceFactory {
    create(
        video: HTMLVideoElement,
        onFrame: (frame: DecodedFrame) => void,
    ): FrameSource;
}

// ─── camera session options ───────────────────────────────────────────────────

export interface CameraSessionOptions {
    /** `MediaDevices`-compatible object. In production: the browser's media devices. */
    readonly mediaDevices: GetUserMediaSource;
    /** Factory that creates a frame decoder for a given video element. */
    readonly frameSourceFactory: FrameSourceFactory;
    /** Called with each new (deduplicated) scan result. Must not throw. */
    readonly onScan: (text: string) => void;
    /** Called when the session ends due to a non-permission error. Must not throw. */
    readonly onError?: (error: CameraSessionError) => void;
    /** Preferred camera facing mode. Defaults to 'environment' (rear camera). */
    readonly facingMode?: 'environment' | 'user';
}

// ─── error types ──────────────────────────────────────────────────────────────

export type CameraSessionErrorCode =
    | 'CAMERA_PERMISSION_DENIED'
    | 'CAMERA_NOT_FOUND'
    | 'CAMERA_START_FAILED'
    | 'CAMERA_ALREADY_RUNNING';

export class CameraSessionError extends Error {
    public readonly code: CameraSessionErrorCode;

    public constructor(code: CameraSessionErrorCode, message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = 'CameraSessionError';
        this.code = code;
    }
}

// ─── session state ────────────────────────────────────────────────────────────

type SessionState =
    | { readonly status: 'idle' }
    | { readonly status: 'running'; readonly stream: MediaStream; readonly frameSource: FrameSource }
    | { readonly status: 'stopped' };

// ─── controller ──────────────────────────────────────────────────────────────

/**
 * Manages a single camera scan session.
 *
 * Instantiate once per scan UI lifecycle. After `stop()` the instance is spent;
 * create a new one for the next session.
 */
export class CameraSessionController {
    private readonly options: CameraSessionOptions;
    private state: SessionState = { status: 'idle' };
    private lastDecodedText: string | null = null;

    public constructor(options: CameraSessionOptions) {
        this.options = options;
    }

    /** Whether the session is actively scanning. */
    public get isRunning(): boolean {
        return this.state.status === 'running';
    }

    /**
     * Request camera access and start scanning.
     *
     * Resolves when the stream is active and the frame loop has started.
     * Rejects with `CameraSessionError` on permission denial, missing device,
     * or double-start.
     */
    public async start(videoElement: HTMLVideoElement): Promise<void> {
        if (this.state.status === 'running') {
            throw new CameraSessionError(
                'CAMERA_ALREADY_RUNNING',
                'A camera session is already running.',
            );
        }
        if (this.state.status === 'stopped') {
            throw new CameraSessionError(
                'CAMERA_START_FAILED',
                'This camera session has been stopped and cannot be restarted.',
            );
        }

        let stream: MediaStream;
        try {
            stream = await this.options.mediaDevices.getUserMedia({
                video: {
                    facingMode: { ideal: this.options.facingMode ?? 'environment' },
                },
                audio: false,
            });
        } catch (cause) {
            const code = isPermissionDenied(cause)
                ? 'CAMERA_PERMISSION_DENIED'
                : isNotFound(cause)
                    ? 'CAMERA_NOT_FOUND'
                    : 'CAMERA_START_FAILED';
            throw new CameraSessionError(
                code,
                friendlyMessage(code),
                { cause },
            );
        }

        videoElement.srcObject = stream;
        try {
            await videoElement.play();
        } catch (cause) {
            stopAllTracks(stream);
            throw new CameraSessionError(
                'CAMERA_START_FAILED',
                'The camera video element failed to start.',
                { cause },
            );
        }

        const frameSource = this.options.frameSourceFactory.create(
            videoElement,
            (frame) => this.handleFrame(frame),
        );

        this.state = { status: 'running', stream, frameSource };
    }

    /**
     * Stop scanning, release all media tracks, and detach the video source.
     *
     * Safe to call from any state; idempotent after the first call.
     */
    public stop(): void {
        const current = this.state;
        this.state = { status: 'stopped' };

        if (current.status === 'running') {
            current.frameSource.stop();
            stopAllTracks(current.stream);
        }
    }

    // ─── internal ────────────────────────────────────────────────────────────

    private handleFrame(frame: DecodedFrame): void {
        if (frame.text === this.lastDecodedText) return;
        this.lastDecodedText = frame.text;
        try {
            this.options.onScan(frame.text);
        } catch {
            // onScan must not throw; swallow silently to keep the scan loop alive
        }
    }
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function stopAllTracks(stream: MediaStream): void {
    for (const track of stream.getTracks()) {
        track.stop();
    }
}

function isPermissionDenied(cause: unknown): boolean {
    return (
        cause instanceof Error
        && (cause.name === 'NotAllowedError' || cause.name === 'PermissionDeniedError')
    );
}

function isNotFound(cause: unknown): boolean {
    return (
        cause instanceof Error
        && (cause.name === 'NotFoundError' || cause.name === 'DevicesNotFoundError')
    );
}

function friendlyMessage(code: CameraSessionErrorCode): string {
    switch (code) {
        case 'CAMERA_PERMISSION_DENIED': return 'Camera permission was denied.';
        case 'CAMERA_NOT_FOUND': return 'No camera device was found.';
        case 'CAMERA_START_FAILED': return 'The camera failed to start.';
        case 'CAMERA_ALREADY_RUNNING': return 'A camera session is already running.';
    }
}
