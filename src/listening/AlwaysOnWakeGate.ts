import type { AudioFrame } from "../audio/AudioFrame.ts";
import { UtteranceRecorder } from "../recorder/UtteranceRecorder.ts";
import type { UtteranceAudio } from "../recorder/UtteranceAudio.ts";
import { AudioRingBuffer } from "./AudioRingBuffer.ts";
import { EndOfSpeechDetector, type EndOfSpeechEvent } from "./EndOfSpeechDetector.ts";

export type AlwaysOnWakeGateEvent =
  | {
      type: "candidate_start";
      timestamp: number;
      preRollFrames: number;
      preRollBytes: number;
    }
  | {
      type: "candidate_end";
      timestamp: number;
      reason: "silence" | "max_duration" | "flush";
      speechDurationMs: number;
    }
  | {
      type: "buffer_cleanup";
      timestamp: number;
      releasedBytes: number;
      source: "pre_roll" | "candidate";
    };

export interface AlwaysOnWakeGateOptions {
  preRollMs?: number;
  maxPreRollBytes?: number;
  now?: () => number;
  createId?: (prefix: string) => string;
  recorder?: UtteranceRecorder;
  detector?: EndOfSpeechDetector;
  ringBuffer?: AudioRingBuffer;
}

export class AlwaysOnWakeGate {
  private readonly now: () => number;
  private readonly createId: (prefix: string) => string;
  private readonly recorder: UtteranceRecorder;
  private readonly detector: EndOfSpeechDetector;
  private readonly ringBuffer: AudioRingBuffer;
  private readonly utteranceListeners: Array<(audio: UtteranceAudio) => void> = [];
  private readonly eventListeners: Array<(event: AlwaysOnWakeGateEvent) => void> = [];
  private active = false;

  constructor(options: AlwaysOnWakeGateOptions = {}) {
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? ((prefix) => `${prefix}_${this.now()}`);
    this.recorder =
      options.recorder ??
      new UtteranceRecorder({
        now: this.now,
        createId: this.createId
      });
    this.detector = options.detector ?? new EndOfSpeechDetector();
    this.ringBuffer =
      options.ringBuffer ??
      new AudioRingBuffer({
        maxDurationMs: options.preRollMs ?? 1_000,
        maxBytes: options.maxPreRollBytes ?? 128 * 1024
      });
  }

  get bufferedBytes(): number {
    return this.ringBuffer.byteLength;
  }

  get bufferedFrameCount(): number {
    return this.ringBuffer.frameCount;
  }

  get isCandidateOpen(): boolean {
    return this.active;
  }

  setMaxUtteranceMs(value: number): void {
    this.detector.setMaxUtteranceMs(value);
  }

  consume(frame: AudioFrame): void {
    const events = this.detector.consume(frame);
    const started = events.some((event) => event.type === "speech_start");

    if (started) {
      this.openCandidate(frame, events.find((event) => event.type === "speech_start"));
    }

    if (this.active) {
      this.recorder.consume(frame);
    }

    const end = events.find((event) => event.type === "speech_end");
    if (end) {
      this.closeCandidate(end);
      return;
    }

    if (!this.active && !started) {
      this.ringBuffer.push(frame);
    }
  }

  flush(): void {
    for (const event of this.detector.flush(this.now())) {
      if (event.type === "speech_end") this.closeCandidate(event);
    }
  }

  reset(): void {
    if (this.active) {
      this.recorder.cancel("reset");
      this.active = false;
    }

    const releasedBytes = this.ringBuffer.clear();
    this.detector.reset();
    if (releasedBytes > 0) {
      this.emitEvent({
        type: "buffer_cleanup",
        timestamp: this.now(),
        releasedBytes,
        source: "pre_roll"
      });
    }
  }

  onUtterance(callback: (audio: UtteranceAudio) => void): void {
    this.utteranceListeners.push(callback);
  }

  onEvent(callback: (event: AlwaysOnWakeGateEvent) => void): void {
    this.eventListeners.push(callback);
  }

  private openCandidate(frame: AudioFrame, event: EndOfSpeechEvent | undefined): void {
    if (this.active) return;

    const preRoll = this.ringBuffer.snapshot();
    const preRollBytes = this.ringBuffer.clear();
    const firstFrame = preRoll[0] ?? frame;
    this.recorder.begin(this.createId("voice_sess"), {
      mode: "wake_word",
      timestamp: firstFrame.timestamp,
      confidence: event?.type === "speech_start" ? event.peak : undefined
    });
    for (const preRollFrame of preRoll) {
      this.recorder.consume(preRollFrame);
    }
    this.active = true;
    this.emitEvent({
      type: "candidate_start",
      timestamp: frame.timestamp,
      preRollFrames: preRoll.length,
      preRollBytes
    });
    if (preRollBytes > 0) {
      this.emitEvent({
        type: "buffer_cleanup",
        timestamp: frame.timestamp,
        releasedBytes: preRollBytes,
        source: "pre_roll"
      });
    }
  }

  private closeCandidate(event: EndOfSpeechEvent & { type: "speech_end" }): void {
    if (!this.active) return;

    this.active = false;
    this.emitEvent({
      type: "candidate_end",
      timestamp: event.timestamp,
      reason: event.reason,
      speechDurationMs: event.speechDurationMs
    });

    if (event.tooShort) {
      this.recorder.cancel("speech_too_short");
      return;
    }

    const audio = this.recorder.finish();
    this.utteranceListeners.forEach((listener) => listener(audio));
  }

  private emitEvent(event: AlwaysOnWakeGateEvent): void {
    this.eventListeners.forEach((listener) => listener(event));
  }
}
