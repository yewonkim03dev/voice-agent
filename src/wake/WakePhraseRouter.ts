export type AgentTarget = "codex" | "claude";

export interface WakePhraseMatch {
  target: AgentTarget;
  phrase: string;
  commandText: string;
}

const wakePatterns: Array<{
  target: AgentTarget;
  pattern: RegExp;
}> = [
  {
    target: "codex",
    pattern: /^(?:(?:야|헤이|hey)\s+)?(코덱스|codex)(?:야)?(?:$|[\s,.:;!?，。]+)(.*)$/iu
  },
  {
    target: "claude",
    pattern: /^(?:(?:야|헤이|hey)\s+)?(클로드|claude)(?:야)?(?:$|[\s,.:;!?，。]+)(.*)$/iu
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
