export type ActivationMode = "wake_word" | "hotkey" | "barge_in" | "manual";

export interface ActivationEvent {
  mode: ActivationMode;
  phrase?: string;
  confidence?: number;
  timestamp: number;
}
