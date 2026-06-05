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
  private readonly queuedIds = new Set<string>();
  private readonly speakingIds = new Set<string>();

  constructor(options: TtsPlaybackStateOptions = {}) {
    this.maxAgeMs = options.maxAgeMs ?? 10_000;
    this.maxChunks = options.maxChunks ?? 5;
    this.recentGraceMs = options.recentGraceMs ?? 2_000;
    this.now = options.now ?? Date.now;
  }

  recordQueued(message: VoiceMessage, timestamp = this.now()): void {
    this.queuedIds.add(message.id);
    this.chunks.push({
      id: message.id,
      text: message.text,
      startedAt: timestamp
    });
    this.prune(timestamp);
  }

  recordStart(message: VoiceMessage, timestamp = this.now()): void {
    this.queuedIds.delete(message.id);
    this.speakingIds.add(message.id);
    const queued = this.chunks.findLast((candidate) => candidate.id === message.id);
    if (queued) {
      queued.text = message.text;
      queued.startedAt = timestamp;
      queued.endedAt = undefined;
    } else {
      this.chunks.push({
        id: message.id,
        text: message.text,
        startedAt: timestamp
      });
    }
    this.prune(timestamp);
  }

  recordFinished(id: string, timestamp = this.now()): void {
    this.queuedIds.delete(id);
    this.speakingIds.delete(id);
    const chunk = this.chunks.findLast((candidate) => candidate.id === id);
    if (chunk) chunk.endedAt = timestamp;
    this.prune(timestamp);
  }

  recordStopped(timestamp = this.now()): void {
    for (const id of new Set([...this.queuedIds, ...this.speakingIds])) {
      const chunk = this.chunks.findLast((candidate) => candidate.id === id);
      if (chunk && chunk.endedAt === undefined) chunk.endedAt = timestamp;
    }

    this.queuedIds.clear();
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
      this.queuedIds.delete(chunk.id);
      this.speakingIds.delete(chunk.id);
      this.chunks.shift();
    }
  }
}
