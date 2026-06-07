import type { VoiceMessage } from "./VoiceMessage.ts";

export interface VoiceOutput {
  speak(message: VoiceMessage): Promise<void>;
  stop(): Promise<void>;
  onFinished(callback: (id: string) => void): void;
}
