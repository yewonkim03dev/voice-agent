import type { Language } from "./Transcript.ts";

export interface LanguagePolicy {
  inputLanguage: Language;
  responseLanguage: "ko" | "en";
  commandLanguage: "preserve" | "translate_to_en" | "translate_to_ko";
}

export function detectLanguageFromText(text: string): Language {
  const hasKorean = /[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(text);
  const hasEnglish = /[A-Za-z]/.test(text);

  if (hasKorean && hasEnglish) return "mixed";
  if (hasKorean) return "ko";
  if (hasEnglish) return "en";
  return "unknown";
}

export function languagePolicyFor(inputLanguage: Language): LanguagePolicy {
  if (inputLanguage === "en") {
    return {
      inputLanguage,
      responseLanguage: "en",
      commandLanguage: "preserve"
    };
  }

  return {
    inputLanguage,
    responseLanguage: "ko",
    commandLanguage: "preserve"
  };
}
