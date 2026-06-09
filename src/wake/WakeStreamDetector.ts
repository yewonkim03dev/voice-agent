import type { AudioFrame } from "../audio/AudioFrame.ts";
import type { WakeMatchStrategy } from "./WakePhraseRouter.ts";

export interface WakeStreamEvent {
  phrase: string;
  text: string;
  provider: string;
  timestamp: number;
  strategy: WakeMatchStrategy | "partial";
  confidence?: number;
}

export type WakeStreamCallback = (event: WakeStreamEvent) => void;

export interface WakeStreamDetector {
  consume(frame: AudioFrame): void;
  reset(): void;
  onWake(callback: WakeStreamCallback): void;
  updateWakePhrases?(wakePhrases: readonly string[]): void;
  stop?(): void | Promise<void>;
}

export class NoopWakeStreamDetector implements WakeStreamDetector {
  consume(_frame: AudioFrame): void {}

  reset(): void {}

  onWake(_callback: WakeStreamCallback): void {}

  updateWakePhrases(_wakePhrases: readonly string[]): void {}
}
