import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export const defaultVoiceSessionHistoryPath = ".voice-agent.history.json";

export interface VoiceChatHistoryEntry {
  role: "user" | "assistant";
  kind: string;
  text: string;
  createdAt: number;
}

export interface VoicePopupHistoryEntry {
  id: string;
  title: string;
  text: string;
  format: "markdown" | "plain";
  createdAt: number;
}

export interface VoiceSessionHistorySnapshot {
  chatHistory: VoiceChatHistoryEntry[];
  popups: VoicePopupHistoryEntry[];
}

export interface VoiceSessionHistoryPersistence {
  load(threadId: string): Promise<VoiceSessionHistorySnapshot>;
  save(threadId: string, snapshot: VoiceSessionHistorySnapshot): Promise<void>;
}

export class VoiceSessionHistoryStore implements VoiceSessionHistoryPersistence {
  private readonly cwd: string;
  private readonly historyPath: string;
  private queue: Promise<void> = Promise.resolve();

  constructor(options: {
    cwd?: string;
    historyPath?: string;
  } = {}) {
    this.cwd = options.cwd ?? process.cwd();
    this.historyPath = options.historyPath ?? defaultVoiceSessionHistoryPath;
  }

  async load(threadId: string): Promise<VoiceSessionHistorySnapshot> {
    const store = await readHistoryFile(this.fullPath());
    return sanitizeSnapshot(readRecord(store.threads)?.[threadId]);
  }

  save(threadId: string, snapshot: VoiceSessionHistorySnapshot): Promise<void> {
    this.queue = this.queue
      .catch(() => {})
      .then(async () => {
        const fullPath = this.fullPath();
        const store = await readHistoryFile(fullPath);
        const threads = readRecord(store.threads);
        threads[threadId] = {
          updatedAt: Date.now(),
          chatHistory: snapshot.chatHistory.map((entry) => ({ ...entry })),
          popups: snapshot.popups.map((entry) => ({ ...entry }))
        };
        await writeFile(fullPath, `${JSON.stringify({ version: 1, threads }, null, 2)}\n`, "utf8");
      });
    return this.queue;
  }

  private fullPath(): string {
    return resolve(this.cwd, this.historyPath);
  }
}

async function readHistoryFile(path: string): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return readRecord(parsed);
  } catch (error) {
    if (isNotFound(error)) return {};
    throw error;
  }
}

function sanitizeSnapshot(value: unknown): VoiceSessionHistorySnapshot {
  const record = readRecord(value);
  return {
    chatHistory: parseChatHistory(record.chatHistory),
    popups: parsePopupHistory(record.popups)
  };
}

function parseChatHistory(value: unknown): VoiceChatHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => readRecord(entry))
    .map((entry) => {
      const role = entry.role === "user" ? "user" : entry.role === "assistant" ? "assistant" : undefined;
      const text = typeof entry.text === "string" ? entry.text.trim() : "";
      if (!role || !text) return undefined;
      return {
        role,
        kind: typeof entry.kind === "string" && entry.kind.trim() ? entry.kind.trim() : "status",
        text,
        createdAt: parseTimestamp(entry.createdAt)
      };
    })
    .filter((entry): entry is VoiceChatHistoryEntry => Boolean(entry))
    .slice(-20);
}

function parsePopupHistory(value: unknown): VoicePopupHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => readRecord(entry))
    .map((entry) => {
      const text = typeof entry.text === "string" ? entry.text.trim() : "";
      if (!text) return undefined;
      return {
        id: typeof entry.id === "string" && entry.id.trim() ? entry.id.trim() : `popup_${parseTimestamp(entry.createdAt)}`,
        title: typeof entry.title === "string" && entry.title.trim() ? entry.title.trim() : "Popup",
        text,
        format: entry.format === "plain" ? "plain" : "markdown",
        createdAt: parseTimestamp(entry.createdAt)
      };
    })
    .filter((entry): entry is VoicePopupHistoryEntry => Boolean(entry))
    .slice(0, 10);
}

function parseTimestamp(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Date.now();
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
