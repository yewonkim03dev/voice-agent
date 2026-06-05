import type { AudioFrame } from "../audio/AudioFrame.ts";

export type SpeechEndReason = "silence" | "max_duration" | "flush";

export type EndOfSpeechEvent =
  | {
      type: "speech_start";
      timestamp: number;
      rms: number;
      peak: number;
    }
  | {
      type: "speech_end";
      timestamp: number;
      reason: SpeechEndReason;
      speechDurationMs: number;
      tooShort: boolean;
      rms: number;
      peak: number;
    };

export interface EndOfSpeechDetectorOptions {
  speechStartRms?: number;
  speechStartPeak?: number;
  silenceRms?: number;
  silencePeak?: number;
  silenceEndMs?: number;
  minSpeechMs?: number;
  maxUtteranceMs?: number;
}

export interface AudioLevels {
  rms: number;
  peak: number;
}

export class EndOfSpeechDetector {
  private readonly speechStartRms: number;
  private readonly speechStartPeak: number;
  private readonly silenceRms: number;
  private readonly silencePeak: number;
  private readonly silenceEndMs: number;
  private readonly minSpeechMs: number;
  private readonly maxUtteranceMs: number;
  private speaking = false;
  private startedAt = 0;
  private lastSpeechAt = 0;
  private lastFrameAt = 0;
  private lastLevels: AudioLevels = {
    rms: 0,
    peak: 0
  };

  constructor(options: EndOfSpeechDetectorOptions = {}) {
    this.speechStartRms = options.speechStartRms ?? 0.012;
    this.speechStartPeak = options.speechStartPeak ?? 0.04;
    this.silenceRms = options.silenceRms ?? 0.008;
    this.silencePeak = options.silencePeak ?? 0.025;
    this.silenceEndMs = options.silenceEndMs ?? 900;
    this.minSpeechMs = options.minSpeechMs ?? 120;
    this.maxUtteranceMs = options.maxUtteranceMs ?? 15_000;
  }

  get isSpeaking(): boolean {
    return this.speaking;
  }

  consume(frame: AudioFrame): EndOfSpeechEvent[] {
    const levels = audioLevels(frame);
    const timestamp = frame.timestamp;
    this.lastFrameAt = timestamp;
    this.lastLevels = levels;
    const events: EndOfSpeechEvent[] = [];
    const speechFrame = this.isSpeechFrame(levels);
    const silenceFrame = this.isSilenceFrame(levels);

    if (!this.speaking) {
      if (speechFrame) {
        this.speaking = true;
        this.startedAt = timestamp;
        this.lastSpeechAt = timestamp;
        events.push({
          type: "speech_start",
          timestamp,
          ...levels
        });
      }

      return events;
    }

    if (!silenceFrame) {
      this.lastSpeechAt = timestamp;
    }

    const speechDurationMs = Math.max(0, this.lastSpeechAt - this.startedAt);
    const totalDurationMs = Math.max(0, timestamp - this.startedAt);

    if (totalDurationMs >= this.maxUtteranceMs) {
      events.push(this.end(timestamp, "max_duration", speechDurationMs, levels));
      return events;
    }

    if (timestamp - this.lastSpeechAt >= this.silenceEndMs) {
      events.push(this.end(timestamp, "silence", speechDurationMs, levels));
    }

    return events;
  }

  flush(timestamp = this.lastFrameAt): EndOfSpeechEvent[] {
    if (!this.speaking) return [];

    return [
      this.end(
        timestamp,
        "flush",
        Math.max(0, this.lastSpeechAt - this.startedAt),
        this.lastLevels
      )
    ];
  }

  reset(): void {
    this.speaking = false;
    this.startedAt = 0;
    this.lastSpeechAt = 0;
    this.lastFrameAt = 0;
    this.lastLevels = {
      rms: 0,
      peak: 0
    };
  }

  private end(
    timestamp: number,
    reason: SpeechEndReason,
    speechDurationMs: number,
    levels: AudioLevels
  ): EndOfSpeechEvent {
    this.speaking = false;

    return {
      type: "speech_end",
      timestamp,
      reason,
      speechDurationMs,
      tooShort: speechDurationMs < this.minSpeechMs,
      ...levels
    };
  }

  private isSpeechFrame(levels: AudioLevels): boolean {
    return levels.rms >= this.speechStartRms || levels.peak >= this.speechStartPeak;
  }

  private isSilenceFrame(levels: AudioLevels): boolean {
    return levels.rms <= this.silenceRms && levels.peak <= this.silencePeak;
  }
}

export function audioLevels(frame: AudioFrame): AudioLevels {
  if (frame.rms !== undefined) {
    return {
      rms: frame.rms,
      peak: peakForFrame(frame)
    };
  }

  return calculateAudioLevels(frame);
}

function peakForFrame(frame: AudioFrame): number {
  return calculateAudioLevels(frame).peak;
}

function calculateAudioLevels(frame: AudioFrame): AudioLevels {
  if (frame.format !== "pcm_s16le" || frame.data.byteLength < 2) {
    return {
      rms: 0,
      peak: 0
    };
  }

  const data = Buffer.from(frame.data);
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
    rms: Math.sqrt(sumSquares / Math.max(1, samples)),
    peak
  };
}
