export type CodexPromptMode =
  | "raw_transcript"
  | "normalized_instruction"
  | "bilingual_instruction";

export interface UserPreferences {
  wakePhrases: string[];
  responseLanguage: "auto" | "ko" | "en";
  voiceAckEnabled: boolean;
  autoSubmit: boolean;
  commandPromptMode: CodexPromptMode;
  permissionVoiceApproval: boolean;
  requireWakeWordForInterrupt: boolean;
  ttsVerbosity: "minimal" | "normal" | "verbose";
}

export const defaultUserPreferences: UserPreferences = {
  wakePhrases: ["코덱스", "hey codex"],
  responseLanguage: "auto",
  voiceAckEnabled: true,
  autoSubmit: true,
  commandPromptMode: "raw_transcript",
  permissionVoiceApproval: true,
  requireWakeWordForInterrupt: false,
  ttsVerbosity: "minimal"
};
