import type { ActivationEvent } from "../wake/ActivationEvent.ts";

export interface UtteranceAudio {
  id: string;
  sessionId: string;
  startedAt: number;
  endedAt: number;
  sampleRate: number;
  channels: number;
  data: ArrayBuffer;
  vadSegments: Array<{
    startMs: number;
    endMs: number;
  }>;
}

export interface RecorderConfig {
  preRollMs: number;
  maxUtteranceMs: number;
  silenceEndMs: number;
  minSpeechMs: number;
}

export interface SessionRecorder {
  begin(sessionId: string, activation: ActivationEvent): void;
  consume(frame: import("../audio/AudioFrame.ts").AudioFrame): void;
  cancel(reason: string): void;
  onUtterance(callback: (audio: UtteranceAudio) => void): void;
}
