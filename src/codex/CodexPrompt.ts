import type { Language } from "../speech/Transcript.ts";

export interface CodexPrompt {
  sessionId: string;
  text: string;
  language: Exclude<Language, "unknown">;
  source: "voice";
  mode: "insert" | "submit";
  metadata?: {
    transcriptConfidence: number;
    spokenAt: number;
  };
}
