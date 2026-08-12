import { describe, expect, it, vi } from 'vitest';
import { CameraSessionController, CameraSessionError } from '../../src/qr/camera';
import type {
    DecodedFrame,
    FrameSource,
    FrameSourceFactory,
    GetUserMediaSource,
} from '../../src/qr/camera';

// ---------------------------------------------------------------------------
// Test helpers / fakes
// ---------------------------------------------------------------------------

function fakeVideo(): HTMLVideoElement {
    return {
        srcObject: null,
        play: vi.fn().mockResolvedValue(undefined),
    } as unknown as HTMLVideoElement;
}

function fakeTrack(): MediaStreamTrack {
    return { stop: vi.fn() } as unknown as MediaStreamTrack;
}

function fakeStream(tracks: MediaStreamTrack[] = []): MediaStream {
    return {
        getTracks: () => tracks,
    } as unknown as MediaStream;
}

function fakeMediaDevices(stream: MediaStream): GetUserMediaSource {
    return {
        getUserMedia: vi.fn().mockResolvedValue(stream),
    };
}

function failingMediaDevices(error: Error): GetUserMediaSource {
    return {
        getUserMedia: vi.fn().mockRejectedValue(error),
    };
}

function fakeFrameSource(): { frameSource: FrameSource; factory: FrameSourceFactory; triggerFrame: (text: string) => void } {
    let capturedCallback: ((frame: DecodedFrame) => void) | null = null;
    const frameSource: FrameSource = { stop: vi.fn() };
    const factory: FrameSourceFactory = {
        create(_video, onFrame) {
            capturedCallback = onFrame;
            return frameSource;
        },
    };
    const triggerFrame = (text: string) => {
        capturedCallback?.({ text });
    };
    return { frameSource, factory, triggerFrame };
}

// ---------------------------------------------------------------------------
// start / stop lifecycle
// ---------------------------------------------------------------------------

describe('CameraSessionController lifecycle', () => {
    it('is not running before start()', () => {
        const controller = new CameraSessionController({
            mediaDevices: fakeMediaDevices(fakeStream()),
            frameSourceFactory: fakeFrameSource().factory,
            onScan: vi.fn(),
        });
        expect(controller.isRunning).toBe(false);
    });

    it('is running after start()', async () => {
        const { factory } = fakeFrameSource();
        const controller = new CameraSessionController({
            mediaDevices: fakeMediaDevices(fakeStream()),
            frameSourceFactory: factory,
            onScan: vi.fn(),
        });

        await controller.start(fakeVideo());

        expect(controller.isRunning).toBe(true);
    });

    it('is not running after stop()', async () => {
        const { factory } = fakeFrameSource();
        const controller = new CameraSessionController({
            mediaDevices: fakeMediaDevices(fakeStream()),
            frameSourceFactory: factory,
            onScan: vi.fn(),
        });

        await controller.start(fakeVideo());
        controller.stop();

        expect(controller.isRunning).toBe(false);
    });

    it('stops all media tracks on stop()', async () => {
        const track1 = fakeTrack();
        const track2 = fakeTrack();
        const stream = fakeStream([track1, track2]);
        const { factory } = fakeFrameSource();
        const controller = new CameraSessionController({
            mediaDevices: fakeMediaDevices(stream),
            frameSourceFactory: factory,
            onScan: vi.fn(),
        });

        await controller.start(fakeVideo());
        controller.stop();

        expect(vi.mocked(track1.stop)).toHaveBeenCalledOnce();
        expect(vi.mocked(track2.stop)).toHaveBeenCalledOnce();
    });

    it('calls frameSource.stop() on stop()', async () => {
        const { frameSource, factory } = fakeFrameSource();
        const controller = new CameraSessionController({
            mediaDevices: fakeMediaDevices(fakeStream()),
            frameSourceFactory: factory,
            onScan: vi.fn(),
        });

        await controller.start(fakeVideo());
        controller.stop();

        expect(vi.mocked(frameSource.stop)).toHaveBeenCalledOnce();
    });

    it('stop() is idempotent', async () => {
        const track = fakeTrack();
        const { factory } = fakeFrameSource();
        const controller = new CameraSessionController({
            mediaDevices: fakeMediaDevices(fakeStream([track])),
            frameSourceFactory: factory,
            onScan: vi.fn(),
        });

        await controller.start(fakeVideo());
        controller.stop();
        controller.stop(); // second call must not throw

        expect(vi.mocked(track.stop)).toHaveBeenCalledOnce();
    });

    it('stop() before start() is safe', () => {
        const controller = new CameraSessionController({
            mediaDevices: fakeMediaDevices(fakeStream()),
            frameSourceFactory: fakeFrameSource().factory,
            onScan: vi.fn(),
        });
        expect(() => controller.stop()).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// Permission and device errors
// ---------------------------------------------------------------------------

describe('CameraSessionController permission errors', () => {
    it('throws CAMERA_PERMISSION_DENIED for NotAllowedError', async () => {
        const err = new Error('Permission denied');
        err.name = 'NotAllowedError';
        const controller = new CameraSessionController({
            mediaDevices: failingMediaDevices(err),
            frameSourceFactory: fakeFrameSource().factory,
            onScan: vi.fn(),
        });

        await expect(controller.start(fakeVideo())).rejects.toSatisfy(
            (e: unknown) =>
                e instanceof CameraSessionError && e.code === 'CAMERA_PERMISSION_DENIED',
        );
    });

    it('throws CAMERA_PERMISSION_DENIED for PermissionDeniedError', async () => {
        const err = new Error('Denied');
        err.name = 'PermissionDeniedError';
        const controller = new CameraSessionController({
            mediaDevices: failingMediaDevices(err),
            frameSourceFactory: fakeFrameSource().factory,
            onScan: vi.fn(),
        });

        await expect(controller.start(fakeVideo())).rejects.toSatisfy(
            (e: unknown) =>
                e instanceof CameraSessionError && e.code === 'CAMERA_PERMISSION_DENIED',
        );
    });

    it('throws CAMERA_NOT_FOUND for NotFoundError', async () => {
        const err = new Error('Not found');
        err.name = 'NotFoundError';
        const controller = new CameraSessionController({
            mediaDevices: failingMediaDevices(err),
            frameSourceFactory: fakeFrameSource().factory,
            onScan: vi.fn(),
        });

        await expect(controller.start(fakeVideo())).rejects.toSatisfy(
            (e: unknown) => e instanceof CameraSessionError && e.code === 'CAMERA_NOT_FOUND',
        );
    });

    it('throws CAMERA_START_FAILED for other getUserMedia errors', async () => {
        const controller = new CameraSessionController({
            mediaDevices: failingMediaDevices(new Error('unknown')),
            frameSourceFactory: fakeFrameSource().factory,
            onScan: vi.fn(),
        });

        await expect(controller.start(fakeVideo())).rejects.toSatisfy(
            (e: unknown) =>
                e instanceof CameraSessionError && e.code === 'CAMERA_START_FAILED',
        );
    });

    it('throws CAMERA_ALREADY_RUNNING on double start()', async () => {
        const { factory } = fakeFrameSource();
        const controller = new CameraSessionController({
            mediaDevices: fakeMediaDevices(fakeStream()),
            frameSourceFactory: factory,
            onScan: vi.fn(),
        });

        await controller.start(fakeVideo());

        await expect(controller.start(fakeVideo())).rejects.toSatisfy(
            (e: unknown) =>
                e instanceof CameraSessionError && e.code === 'CAMERA_ALREADY_RUNNING',
        );
    });

    it('throws CAMERA_START_FAILED when restarting after stop()', async () => {
        const { factory } = fakeFrameSource();
        const controller = new CameraSessionController({
            mediaDevices: fakeMediaDevices(fakeStream()),
            frameSourceFactory: factory,
            onScan: vi.fn(),
        });

        await controller.start(fakeVideo());
        controller.stop();

        await expect(controller.start(fakeVideo())).rejects.toSatisfy(
            (e: unknown) =>
                e instanceof CameraSessionError && e.code === 'CAMERA_START_FAILED',
        );
    });

    it('stops stream tracks when video.play() fails', async () => {
        const track = fakeTrack();
        const stream = fakeStream([track]);
        const video = {
            srcObject: null,
            play: vi.fn().mockRejectedValue(new Error('play failed')),
        } as unknown as HTMLVideoElement;

        const controller = new CameraSessionController({
            mediaDevices: fakeMediaDevices(stream),
            frameSourceFactory: fakeFrameSource().factory,
            onScan: vi.fn(),
        });

        await expect(controller.start(video)).rejects.toBeDefined();
        expect(vi.mocked(track.stop)).toHaveBeenCalledOnce();
    });
});

// ---------------------------------------------------------------------------
// Frame deduplication
// ---------------------------------------------------------------------------

describe('CameraSessionController frame deduplication', () => {
    it('delivers the first scan result', async () => {
        const onScan = vi.fn();
        const { factory, triggerFrame } = fakeFrameSource();
        const controller = new CameraSessionController({
            mediaDevices: fakeMediaDevices(fakeStream()),
            frameSourceFactory: factory,
            onScan,
        });

        await controller.start(fakeVideo());
        triggerFrame('EQAbc');

        expect(onScan).toHaveBeenCalledOnce();
        expect(onScan).toHaveBeenCalledWith('EQAbc');
    });

    it('suppresses identical consecutive frames', async () => {
        const onScan = vi.fn();
        const { factory, triggerFrame } = fakeFrameSource();
        const controller = new CameraSessionController({
            mediaDevices: fakeMediaDevices(fakeStream()),
            frameSourceFactory: factory,
            onScan,
        });

        await controller.start(fakeVideo());
        triggerFrame('EQAbc');
        triggerFrame('EQAbc');
        triggerFrame('EQAbc');

        expect(onScan).toHaveBeenCalledOnce();
    });

    it('delivers a new value after a duplicate run', async () => {
        const onScan = vi.fn();
        const { factory, triggerFrame } = fakeFrameSource();
        const controller = new CameraSessionController({
            mediaDevices: fakeMediaDevices(fakeStream()),
            frameSourceFactory: factory,
            onScan,
        });

        await controller.start(fakeVideo());
        triggerFrame('first');
        triggerFrame('first');
        triggerFrame('second');

        expect(onScan).toHaveBeenCalledTimes(2);
        expect(onScan.mock.calls[0]![0]).toBe('first');
        expect(onScan.mock.calls[1]![0]).toBe('second');
    });

    it('does not navigate or execute — onScan only receives text', async () => {
        const receivedTexts: unknown[] = [];
        const { factory, triggerFrame } = fakeFrameSource();
        const controller = new CameraSessionController({
            mediaDevices: fakeMediaDevices(fakeStream()),
            frameSourceFactory: factory,
            onScan: (text) => receivedTexts.push(text),
        });

        await controller.start(fakeVideo());
        triggerFrame('tc://?v=2&id=somelink');

        // onScan receives only the raw string; no routing or execution happens here
        expect(receivedTexts).toEqual(['tc://?v=2&id=somelink']);
    });

    it('keeps the scan loop alive when onScan throws', async () => {
        let callCount = 0;
        const { factory, triggerFrame } = fakeFrameSource();
        const controller = new CameraSessionController({
            mediaDevices: fakeMediaDevices(fakeStream()),
            frameSourceFactory: factory,
            onScan: () => {
                callCount += 1;
                throw new Error('boom');
            },
        });

        await controller.start(fakeVideo());

        expect(() => {
            triggerFrame('first');
            triggerFrame('second'); // new unique text — should still fire
        }).not.toThrow();

        expect(callCount).toBe(2);
    });
});
