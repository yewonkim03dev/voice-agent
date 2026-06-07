import type { TtsPlaybackState } from "./TtsPlaybackState.ts";

export interface EchoGuardOptions {
  substringThreshold?: number;
  tokenOverlapThreshold?: number;
  editSimilarityThreshold?: number;
  maxEditDistanceLength?: number;
}

export interface EchoGuardResult {
  echo: boolean;
  similarity: number;
  strategy: "none" | "substring" | "token_overlap" | "edit_similarity";
  matchedText?: string;
}

export class EchoGuard {
  private readonly substringThreshold: number;
  private readonly tokenOverlapThreshold: number;
  private readonly editSimilarityThreshold: number;
  private readonly maxEditDistanceLength: number;

  constructor(options: EchoGuardOptions = {}) {
    this.substringThreshold = options.substringThreshold ?? 0.86;
    this.tokenOverlapThreshold = options.tokenOverlapThreshold ?? 0.75;
    this.editSimilarityThreshold = options.editSimilarityThreshold ?? 0.82;
    this.maxEditDistanceLength = options.maxEditDistanceLength ?? 300;
  }

  evaluate(sttText: string, playbackState: TtsPlaybackState, timestamp?: number): EchoGuardResult {
    const stt = normalizeForEcho(sttText);
    if (stt.length < 2) return noEcho();

    let best = noEcho();

    for (const text of playbackState.recentTexts(timestamp)) {
      const tts = normalizeForEcho(text);
      if (tts.length < 2) continue;

      const substring = substringSimilarity(stt, tts);
      if (substring >= this.substringThreshold) {
        return {
          echo: true,
          similarity: substring,
          strategy: "substring",
          matchedText: text
        };
      }

      if (substring > best.similarity) {
        best = {
          echo: false,
          similarity: substring,
          strategy: "substring",
          matchedText: text
        };
      }

      const overlap = tokenOverlap(stt, tts);
      if (overlap >= this.tokenOverlapThreshold) {
        return {
          echo: true,
          similarity: overlap,
          strategy: "token_overlap",
          matchedText: text
        };
      }

      if (overlap > best.similarity) {
        best = {
          echo: false,
          similarity: overlap,
          strategy: "token_overlap",
          matchedText: text
        };
      }

      if (stt.length <= this.maxEditDistanceLength && tts.length <= this.maxEditDistanceLength) {
        const edit = editSimilarity(stt, tts);
        if (edit >= this.editSimilarityThreshold) {
          return {
            echo: true,
            similarity: edit,
            strategy: "edit_similarity",
            matchedText: text
          };
        }

        if (edit > best.similarity) {
          best = {
            echo: false,
            similarity: edit,
            strategy: "edit_similarity",
            matchedText: text
          };
        }
      }
    }

    return best;
  }
}

export function normalizeForEcho(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{Script=Hangul}\p{Script=Latin}\p{Number}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenOverlap(left: string, right: string): number {
  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  if (leftTokens.length === 0 || rightTokens.length === 0) return 0;

  const rightSet = new Set(rightTokens);
  const overlap = leftTokens.filter((token) => rightSet.has(token)).length;
  return overlap / Math.min(leftTokens.length, rightTokens.length);
}

export function editSimilarity(left: string, right: string): number {
  const maxLength = Math.max(left.length, right.length);
  if (maxLength === 0) return 1;
  const distance = levenshteinDistance(left, right);
  return 1 - distance / maxLength;
}

function substringSimilarity(left: string, right: string): number {
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) {
    return Math.min(left.length, right.length) / Math.max(left.length, right.length);
  }

  return 0;
}

function tokens(text: string): string[] {
  return normalizeForEcho(text)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}

function levenshteinDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = Array<number>(right.length + 1).fill(0);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        current[rightIndex - 1] + 1,
        previous[rightIndex - 1] + substitutionCost
      );
    }

    for (let index = 0; index < previous.length; index += 1) {
      previous[index] = current[index];
    }
  }

  return previous[right.length] ?? 0;
}

function noEcho(): EchoGuardResult {
  return {
    echo: false,
    similarity: 0,
    strategy: "none"
  };
}
