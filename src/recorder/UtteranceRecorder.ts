import type { AudioFormat, AudioFrame } from "../audio/AudioFrame.ts";
import type { ActivationEvent } from "../wake/ActivationEvent.ts";
import type { UtteranceAudio } from "./UtteranceAudio.ts";

export interface UtteranceRecorderOptions {
  now?: () => number;
  createId?: (prefix: string) => string;
}

export class UtteranceRecorder {
  private readonly now: () => number;
  private readonly createId: (prefix: string) => string;
  private sessionId: string | undefined;
  private startedAt = 0;
  private endedAt = 0;
  private sampleRate = 16_000;
  private channels = 1;
  private format: AudioFormat = "pcm_s16le";
  private readonly chunks: Buffer[] = [];
  private readonly utteranceListeners: Array<(audio: UtteranceAudio) => void> = [];

  constructor(options: UtteranceRecorderOptions = {}) {
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? ((prefix) => `${prefix}_${this.now()}`);
  }

  begin(sessionId: string, activation: ActivationEvent): void {
    this.sessionId = sessionId;
    this.startedAt = activation.timestamp;
    this.endedAt = activation.timestamp;
    this.sampleRate = 16_000;
    this.channels = 1;
    this.format = "pcm_s16le";
    this.chunks.length = 0;
  }

  consume(frame: AudioFrame): void {
    if (!this.sessionId) return;

    this.sampleRate = frame.sampleRate;
    this.channels = frame.channels;
    this.format = frame.format;
    this.endedAt = frame.timestamp;
    this.chunks.push(Buffer.from(frame.data));
  }

  finish(): UtteranceAudio {
    if (!this.sessionId) {
      throw new Error("Cannot finish recording before it starts.");
    }

    const data = Buffer.concat(this.chunks);
    const audio: UtteranceAudio = {
      id: this.createId("utt"),
      sessionId: this.sessionId,
      startedAt: this.startedAt,
      endedAt: this.endedAt || this.now(),
      sampleRate: this.sampleRate,
      channels: this.channels,
      format: this.format,
      data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
      ...audioLevels(data, this.format),
      vadSegments: [
        {
          startMs: 0,
          endMs: Math.max(0, (this.endedAt || this.now()) - this.startedAt)
        }
      ]
    };

    this.sessionId = undefined;
    this.chunks.length = 0;
    this.utteranceListeners.forEach((listener) => listener(audio));
    return audio;
  }

  cancel(_reason: string): void {
    this.sessionId = undefined;
    this.chunks.length = 0;
  }

  onUtterance(callback: (audio: UtteranceAudio) => void): void {
    this.utteranceListeners.push(callback);
  }
}

function audioLevels(data: Buffer, format: AudioFormat): { rms?: number; peak?: number } {
  if (format !== "pcm_s16le" || data.byteLength < 2) {
    return {};
  }

  let sumSquares = 0;
  let peak = 0;
  const samples = Math.floor(data.byteLength / 2);

  for (let offset = 0; offset + 1 < data.byteLength; offset += 2) {
    const normalized = data.readInt16LE(offset) / 32768;
    const absolute = Math.abs(normalized);
    sumSquares += normalized * normalized;
    if (absolute > peak) peak = absolute;
  }

  return {
    rms: Math.sqrt(sumSquares / samples),
    peak
  };
}
