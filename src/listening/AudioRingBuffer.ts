import type { AudioFrame } from "../audio/AudioFrame.ts";

export interface AudioRingBufferOptions {
  maxDurationMs: number;
  maxBytes: number;
}

export class AudioRingBuffer {
  private readonly maxDurationMs: number;
  private readonly maxBytes: number;
  private readonly frames: AudioFrame[] = [];
  private bytes = 0;

  constructor(options: AudioRingBufferOptions) {
    this.maxDurationMs = Math.max(0, options.maxDurationMs);
    this.maxBytes = Math.max(0, options.maxBytes);
  }

  get byteLength(): number {
    return this.bytes;
  }

  get frameCount(): number {
    return this.frames.length;
  }

  get durationMs(): number {
    const first = this.frames[0];
    const last = this.frames.at(-1);
    if (!first || !last) return 0;

    return Math.max(0, last.timestamp - first.timestamp);
  }

  push(frame: AudioFrame): void {
    if (this.maxDurationMs === 0 || this.maxBytes === 0) return;

    const cloned = cloneAudioFrame(frame);
    this.frames.push(cloned);
    this.bytes += cloned.data.byteLength;
    this.trim();
  }

  snapshot(): AudioFrame[] {
    return this.frames.map(cloneAudioFrame);
  }

  clear(): number {
    const released = this.bytes;
    this.frames.length = 0;
    this.bytes = 0;
    return released;
  }

  private trim(): void {
    const latest = this.frames.at(-1);
    if (!latest) return;

    while (this.frames.length > 0 && this.bytes > this.maxBytes) {
      this.shift();
    }

    while (this.frames.length > 0 && latest.timestamp - this.frames[0].timestamp > this.maxDurationMs) {
      this.shift();
    }
  }

  private shift(): void {
    const removed = this.frames.shift();
    if (!removed) return;
    this.bytes -= removed.data.byteLength;
  }
}

export function cloneAudioFrame(frame: AudioFrame): AudioFrame {
  const data = frame.data.slice(0);

  return {
    ...frame,
    data
  };
}
