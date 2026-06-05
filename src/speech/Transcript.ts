export type Language = "ko" | "en" | "mixed" | "unknown";

export interface Transcript {
  id: string;
  sessionId: string;
  text: string;
  normalizedText: string;
  language: Language;
  confidence: number;
  alternatives?: Array<{
    text: string;
    confidence: number;
  }>;
  startedAt: number;
  endedAt: number;
}

export function normalizeTranscriptText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}
