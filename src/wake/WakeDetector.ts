import type { AudioFrame } from "../audio/AudioFrame.ts";
import type { ActivationEvent } from "./ActivationEvent.ts";

export interface WakeDetector {
  consume(frame: AudioFrame): void;
  onActivation(callback: (event: ActivationEvent) => void): void;
  setEnabled(enabled: boolean): void;
}
