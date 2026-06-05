import type { VoiceMessage } from "./VoiceMessage.ts";

export interface TtsPlaybackChunk {
  id: string;
  text: string;
  startedAt: number;
  endedAt?: number;
}

export interface TtsPlaybackStateOptions {
  maxAgeMs?: number;
  maxChunks?: number;
  recentGraceMs?: number;
  now?: () => number;
}

export class TtsPlaybackState {
  private readonly maxAgeMs: number;
  private readonly maxChunks: number;
  private readonly recentGraceMs: number;
  private readonly now: () => number;
  private readonly chunks: TtsPlaybackChunk[] = [];
  private readonly speakingIds = new Set<string>();

  constructor(options: TtsPlaybackStateOptions = {}) {
    this.maxAgeMs = options.maxAgeMs ?? 10_000;
    this.maxChunks = options.maxChunks ?? 5;
    this.recentGraceMs = options.recentGraceMs ?? 2_000;
    this.now = options.now ?? Date.now;
  }

  recordStart(message: VoiceMessage, timestamp = this.now()): void {
    this.speakingIds.add(message.id);
    this.chunks.push({
      id: message.id,
      text: message.text,
      startedAt: timestamp
    });
    this.prune(timestamp);
  }

  recordFinished(id: string, timestamp = this.now()): void {
    this.speakingIds.delete(id);
    const chunk = this.chunks.findLast((candidate) => candidate.id === id);
    if (chunk) chunk.endedAt = timestamp;
    this.prune(timestamp);
  }

  recordStopped(timestamp = this.now()): void {
    for (const id of this.speakingIds) {
      const chunk = this.chunks.findLast((candidate) => candidate.id === id);
      if (chunk && chunk.endedAt === undefined) chunk.endedAt = timestamp;
    }

    this.speakingIds.clear();
    this.prune(timestamp);
  }

  isSpeaking(): boolean {
    return this.speakingIds.size > 0;
  }

  isSpeakingOrRecent(timestamp = this.now()): boolean {
    return this.isSpeaking() || this.recentChunks(timestamp).length > 0;
  }

  recentChunks(timestamp = this.now()): TtsPlaybackChunk[] {
    this.prune(timestamp);
    return this.chunks.filter((chunk) => timestamp - (chunk.endedAt ?? chunk.startedAt) <= this.maxAgeMs);
  }

  recentTexts(timestamp = this.now()): string[] {
    return this.recentChunks(timestamp).map((chunk) => chunk.text);
  }

  recentlyEnded(timestamp = this.now()): boolean {
    return this.chunks.some((chunk) => {
      if (chunk.endedAt === undefined) return true;
      return timestamp - chunk.endedAt <= this.recentGraceMs;
    });
  }

  private prune(timestamp: number): void {
    while (this.chunks.length > 0) {
      const chunk = this.chunks[0];
      const reference = chunk.endedAt ?? chunk.startedAt;
      if (timestamp - reference <= this.maxAgeMs && this.chunks.length <= this.maxChunks) break;
      this.speakingIds.delete(chunk.id);
      this.chunks.shift();
    }
  }
}
