import type { VoiceMessage } from "./VoiceMessage.ts";

export type TtsProviderName = "console" | "macos-apple";
export type TtsLanguage = "ko" | "en" | "auto";
export type TtsGender = "male" | "female" | "auto";

export interface TtsSpeakRequest {
  text: string;
  language: Exclude<VoiceMessage["language"], undefined>;
  voiceName?: string;
  gender: TtsGender;
  rate: number;
  pitch?: number;
  volume?: number;
}

export interface TtsVoiceInfo {
  identifier: string;
  name: string;
  language: string;
  gender?: TtsGender;
}

export interface TtsProvider {
  readonly name: TtsProviderName;
  speak(request: TtsSpeakRequest): Promise<void>;
  stop(): Promise<void>;
  listVoices?(): Promise<TtsVoiceInfo[]>;
}
