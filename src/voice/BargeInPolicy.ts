import { detectConfiguredWakePhrase, type ConfiguredWakePhraseMatch } from "../wake/WakePhraseRouter.ts";

export type BargeInDecision =
  | {
      action: "ignore";
      reason: "no_wake" | "wake_only";
      wake?: ConfiguredWakePhraseMatch;
    }
  | {
      action: "stop";
      reason: "stop_intent";
      wake: ConfiguredWakePhraseMatch;
    }
  | {
      action: "command";
      reason: "new_command";
      wake: ConfiguredWakePhraseMatch;
      commandText: string;
    };

export interface BargeInPolicyOptions {
  stopPhrases?: string[];
}

const defaultStopPhrases = [
  "멈춰",
  "멈춰줘",
  "그만",
  "그만해",
  "잠깐",
  "중지",
  "중단",
  "취소",
  "취소해",
  "stop",
  "cancel",
  "pause",
  "hold on",
  "wait"
];

export class BargeInPolicy {
  private readonly stopPhrases: string[];

  constructor(options: BargeInPolicyOptions = {}) {
    this.stopPhrases = options.stopPhrases ?? defaultStopPhrases;
  }

  decide(text: string, wakePhrases: readonly string[]): BargeInDecision {
    const wake = detectConfiguredWakePhrase(text, wakePhrases);

    if (!wake) {
      return {
        action: "ignore",
        reason: "no_wake"
      };
    }

    const commandText = wake.commandText.trim();

    if (!commandText) {
      return {
        action: "ignore",
        reason: "wake_only",
        wake
      };
    }

    if (isStopIntent(commandText, this.stopPhrases)) {
      return {
        action: "stop",
        reason: "stop_intent",
        wake
      };
    }

    return {
      action: "command",
      reason: "new_command",
      wake,
      commandText
    };
  }
}

function isStopIntent(text: string, stopPhrases: readonly string[]): boolean {
  const normalized = normalizeForBargeIn(text);
  return stopPhrases.some((phrase) => {
    const normalizedPhrase = normalizeForBargeIn(phrase);
    return normalized === normalizedPhrase || normalized.includes(normalizedPhrase);
  });
}

function normalizeForBargeIn(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{Script=Hangul}\p{Script=Latin}\p{Number}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
