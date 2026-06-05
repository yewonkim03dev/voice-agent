export type AgentTarget = "codex" | "claude";

export interface WakePhraseMatch {
  target: AgentTarget;
  phrase: string;
  commandText: string;
  strategy?: WakeMatchStrategy;
  heardText?: string;
  normalizedText?: string;
  distance?: number;
}

export interface ConfiguredWakePhraseMatch {
  phrase: string;
  commandText: string;
  strategy?: WakeMatchStrategy;
  heardText?: string;
  normalizedText?: string;
  distance?: number;
}

export const defaultWakePhrases = ["코덱스", "클로드", "codex", "claude", "hey codex", "hey claude"];

export type WakeMatchStrategy = "exact" | "normalized" | "fuzzy";

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
      commandText: (match[2] ?? "").trim(),
      strategy: "exact"
    };
  }

  const fuzzy = detectConfiguredWakePhrase(trimmed, defaultTargetedWakePhrases.map((phrase) => phrase.phrase));
  if (fuzzy) {
    const target = defaultTargetedWakePhrases.find((phrase) => phrase.phrase === fuzzy.phrase)?.target;
    if (target) {
      return {
        ...fuzzy,
        target
      };
    }
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
      commandText: (match[1] ?? "").trim(),
      strategy: "exact"
    };
  }

  return detectFuzzyConfiguredWakePhrase(trimmed, phrases);
}

export function normalizedWakePhrases(wakePhrases: readonly string[]): string[] {
  return [...new Set(wakePhrases.map((phrase) => phrase.trim()).filter(Boolean))]
    .sort((left, right) => right.length - left.length);
}

function configuredWakePattern(phrase: string): RegExp {
  const escaped = escapeRegex(phrase).replace(/\s+/gu, "\\s+");
  return new RegExp(`^${escaped}(?:야)?(?:$|[\\s,.:;!?，。]+)([\\s\\S]*)$`, "iu");
}

const defaultTargetedWakePhrases: Array<{
  target: AgentTarget;
  phrase: string;
}> = [
  { target: "codex", phrase: "코덱스" },
  { target: "codex", phrase: "codex" },
  { target: "codex", phrase: "hey codex" },
  { target: "codex", phrase: "헤이 코덱스" },
  { target: "codex", phrase: "야 코덱스" },
  { target: "claude", phrase: "클로드" },
  { target: "claude", phrase: "claude" },
  { target: "claude", phrase: "hey claude" },
  { target: "claude", phrase: "헤이 클로드" },
  { target: "claude", phrase: "야 클로드" }
];

function detectFuzzyConfiguredWakePhrase(
  text: string,
  phrases: readonly string[]
): ConfiguredWakePhraseMatch | null {
  const tokens = leadingTokens(text);
  if (tokens.length === 0) return null;

  for (const phrase of phrases) {
    const phraseComparable = wakeComparable(phrase);
    const maxTokens = Math.min(tokens.length, Math.max(1, phraseComparable.length + 1));

    for (let tokenCount = 1; tokenCount <= maxTokens; tokenCount += 1) {
      const heardText = tokens.slice(0, tokenCount).map((token) => token.text).join(" ");
      const normalizedText = wakeCandidateComparable(heardText);

      if (!normalizedText) continue;

      if (normalizedText === phraseComparable) {
        return {
          phrase,
          commandText: commandAfterTokens(text, tokens, tokenCount),
          strategy: "normalized",
          heardText,
          normalizedText,
          distance: 0
        };
      }

      const distance = levenshteinDistance(normalizedText, phraseComparable);
      if (isAcceptableWakeDistance(normalizedText, phraseComparable, distance)) {
        return {
          phrase,
          commandText: commandAfterTokens(text, tokens, tokenCount),
          strategy: "fuzzy",
          heardText,
          normalizedText,
          distance
        };
      }
    }
  }

  return null;
}

function leadingTokens(text: string): Array<{ text: string; start: number; end: number }> {
  return [...text.matchAll(/\S+/gu)].map((match) => {
    const start = match.index ?? 0;
    const value = match[0] ?? "";

    return {
      text: value,
      start,
      end: start + value.length
    };
  });
}

function commandAfterTokens(
  text: string,
  tokens: Array<{ text: string; start: number; end: number }>,
  tokenCount: number
): string {
  const lastToken = tokens[tokenCount - 1];
  if (!lastToken) return "";

  return text
    .slice(lastToken.end)
    .replace(/^[\s,.:;!?，。]+/u, "")
    .replace(/^야(?:$|[\s,.:;!?，。]+)/u, "")
    .trim();
}

function wakeComparable(value: string): string {
  return value.toLowerCase().replace(/[\s,.:;!?，。]+/gu, "");
}

function wakeCandidateComparable(value: string): string {
  return stripVocativeYa(wakeComparable(value));
}

function stripVocativeYa(value: string): string {
  if (value.length <= 1) return value;
  return /[가-힣]야$/u.test(value) ? value.slice(0, -1) : value;
}

function isAcceptableWakeDistance(candidate: string, phrase: string, distance: number): boolean {
  if (distance === 0) return true;
  if (phrase.length <= 2) return false;
  if (phrase.length <= 8 && candidate.length !== phrase.length) return false;

  return distance <= (phrase.length > 8 ? 2 : 1);
}

function levenshteinDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = Array.from({ length: right.length + 1 }, () => 0);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const cost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + cost
      );
    }

    for (let index = 0; index < current.length; index += 1) {
      previous[index] = current[index];
    }
  }

  return previous[right.length] ?? 0;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
