export type AgentTarget = "codex" | "claude";

export interface WakePhraseMatch {
  target: AgentTarget;
  phrase: string;
  commandText: string;
}

export interface ConfiguredWakePhraseMatch {
  phrase: string;
  commandText: string;
}

export const defaultWakePhrases = ["코덱스", "클로드", "codex", "claude", "hey codex", "hey claude"];

const wakePatterns: Array<{
  target: AgentTarget;
  pattern: RegExp;
}> = [
  {
    target: "codex",
    pattern: /^(?:(?:야|헤이|hey)\s+)?(코덱스|codex)(?:야)?(?:$|[\s,.:;!?，。]+)([\s\S]*)$/iu
  },
  {
    target: "claude",
    pattern: /^(?:(?:야|헤이|hey)\s+)?(클로드|claude)(?:야)?(?:$|[\s,.:;!?，。]+)([\s\S]*)$/iu
  }
];

export function detectWakePhrase(text: string): WakePhraseMatch | null {
  const trimmed = text.trim();

  for (const wake of wakePatterns) {
    const match = trimmed.match(wake.pattern);
    if (!match) continue;

    return {
      target: wake.target,
      phrase: match[1] ?? "",
      commandText: (match[2] ?? "").trim()
    };
  }

  return null;
}

export function detectConfiguredWakePhrase(
  text: string,
  wakePhrases: readonly string[] = defaultWakePhrases
): ConfiguredWakePhraseMatch | null {
  const trimmed = text.trim();
  const phrases = normalizedWakePhrases(wakePhrases);

  for (const phrase of phrases) {
    const match = trimmed.match(configuredWakePattern(phrase));
    if (!match) continue;

    return {
      phrase,
      commandText: (match[1] ?? "").trim()
    };
  }

  return null;
}

export function normalizedWakePhrases(wakePhrases: readonly string[]): string[] {
  return [...new Set(wakePhrases.map((phrase) => phrase.trim()).filter(Boolean))]
    .sort((left, right) => right.length - left.length);
}

function configuredWakePattern(phrase: string): RegExp {
  const escaped = escapeRegex(phrase).replace(/\s+/gu, "\\s+");
  return new RegExp(`^${escaped}(?:야)?(?:$|[\\s,.:;!?，。]+)([\\s\\S]*)$`, "iu");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
