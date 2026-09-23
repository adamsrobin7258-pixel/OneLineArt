import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, Quality, WebMOutputFormat, getFirstEncodableVideoCodec, type VideoCodec } from 'mediabunny';
import { ExportError, type Size, type VideoCapability, type VideoEncoderPort, type VideoEncodingSession } from '../../../core';

/**
 * Codec preference: H.264 in MP4 plays everywhere (incl. iOS photo library and
 * messengers); VP9/AV1/VP8 in WebM where no H.264 encoder exists (e.g. open-
 * source Chromium builds). Decided per device by asking the encoder itself.
 */
const CODEC_PREFERENCE: readonly VideoCodec[] = ['avc', 'vp9', 'av1', 'vp8'];
const CONTAINER: Readonly<Record<string, { readonly container: 'mp4' | 'webm'; readonly mimeType: string; readonly extension: string }>> = {
  avc: { container: 'mp4', mimeType: 'video/mp4', extension: 'mp4' },
  vp9: { container: 'webm', mimeType: 'video/webm', extension: 'webm' },
  av1: { container: 'webm', mimeType: 'video/webm', extension: 'webm' },
  vp8: { container: 'webm', mimeType: 'video/webm', extension: 'webm' },
};
/** Line art has fine detail; 'high' keeps thin lines crisp without huge files. */
const VIDEO_QUALITY = 'high';
/** Seconds between key frames (seeking in players). */
const KEY_FRAME_INTERVAL_S = 2;

export const hasWebCodecs = (): boolean => typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';

/** Session whose surface the frames are drawn on before `addFrame`. */
export interface BrowserVideoSession extends VideoEncodingSession<Blob> {
  readonly ctx: CanvasRenderingContext2D;
}

async function chooseCodec(size: Size): Promise<VideoCodec | null> {
  return getFirstEncodableVideoCodec([...CODEC_PREFERENCE], { width: size.width, height: size.height, quality: new Quality(VIDEO_QUALITY) });
}

/**
 * WebCodecs encoder + MP4/WebM muxer (mediabunny). Frames are encoded as they
 * are added (awaiting encoder backpressure), so only the compressed file grows
 * in memory — never a list of raw frames.
 */
/** Encoder port whose sessions expose the drawing surface. */
export interface BrowserVideoEncoder extends VideoEncoderPort<Blob> {
  open(config: { readonly size: Size; readonly fps: number }): Promise<BrowserVideoSession>;
}

export const webCodecsEncoder: BrowserVideoEncoder = {
  async probe(size: Size): Promise<VideoCapability> {
    if (!hasWebCodecs()) return { supported: false, reason: 'encoder-unavailable' };
    const codec = await chooseCodec(size).catch(() => null);
    if (!codec) return { supported: false, reason: 'codec-unsupported' };
    return { supported: true, codec, ...CONTAINER[codec]! };
  },

  async open({ size, fps }): Promise<BrowserVideoSession> {
    if (!hasWebCodecs()) throw new ExportError('encoder-unavailable');
    const codec = await chooseCodec(size);
    if (!codec) throw new ExportError('codec-unsupported', `No encoder for ${size.width}×${size.height}`);
    const info = CONTAINER[codec]!;
    const canvas = new OffscreenCanvas(size.width, size.height);
    const ctx = canvas.getContext('2d', { alpha: false }) as unknown as CanvasRenderingContext2D | null;
    if (!ctx) throw new ExportError('out-of-memory', 'Canvas allocation failed');
    const target = new BufferTarget();
    const output = new Output({
      format: info.container === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(),
      target,
    });
    const source = new CanvasSource(canvas, { codec, quality: new Quality(VIDEO_QUALITY), keyFrameInterval: KEY_FRAME_INTERVAL_S });
    output.addVideoTrack(source, { frameRate: fps });
    const release = () => {
      canvas.width = 0;
      canvas.height = 0;
    };
    try {
      await output.start();
    } catch (error) {
      release();
      throw new ExportError('codec-unsupported', error instanceof Error ? error.message : String(error), { cause: error });
    }
    return {
      ctx,
      async addFrame(timestampMs, durationMs) {
        await source.add(timestampMs / 1000, durationMs / 1000);
      },
      async finish() {
        try {
          source.close();
          await output.finalize();
          const buffer = target.buffer;
          if (!buffer || buffer.byteLength === 0) throw new ExportError('encoding-failed', 'Empty video');
          return { data: new Blob([buffer], { type: info.mimeType }), sizeBytes: buffer.byteLength, mimeType: info.mimeType };
        } finally {
          release();
        }
      },
      async cancel() {
        try {
          await output.cancel();
        } finally {
          release();
        }
      },
    };
  },
};
