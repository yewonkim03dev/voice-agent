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

export function detectTranscriptLanguage(text: string): Language {
  const hasKorean = /[ㄱ-ㅎㅏ-ㅣ가-힣]/u.test(text);
  const hasLatin = /[a-z]/i.test(text);

  if (hasKorean && hasLatin) return "mixed";
  if (hasKorean) return "ko";
  if (hasLatin) return "en";
  return "unknown";
}

export function withTranscriptText(transcript: Transcript, text: string): Transcript {
  const normalizedText = normalizeTranscriptText(text);

  return {
    ...transcript,
    text,
    normalizedText,
    language: detectTranscriptLanguage(normalizedText)
  };
}
