import type { Language } from "../speech/Transcript.ts";

export type ResponseLanguage = "auto" | "ko" | "en";

export interface CodexPrompt {
  sessionId: string;
  text: string;
  language: Exclude<Language, "unknown">;
  responseLanguage?: ResponseLanguage;
  source: "voice";
  mode: "insert" | "submit";
  metadata?: {
    transcriptConfidence: number;
    spokenAt: number;
  };
}
