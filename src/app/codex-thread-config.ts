import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { defaultVoiceConfigPath } from "./voice-config.ts";

export interface CodexThreadStore {
  load(): Promise<string | undefined>;
  save(threadId: string): Promise<void>;
}

export interface CodexThreadSettings {
  threadId?: string;
  alwaysStartNewThread: boolean;
}

export function createCodexThreadStore(options: {
  cwd?: string;
  configPath?: string;
  env?: NodeJS.ProcessEnv;
} = {}): CodexThreadStore {
  const cwd = options.cwd ?? process.cwd();
  const configPath = options.configPath ?? defaultVoiceConfigPath;
  const env = options.env ?? process.env;
  const envThreadId = parseCodexThreadId(env.VOICE_AGENT_CODEX_THREAD_ID);
  const fullPath = resolve(cwd, configPath);

  return {
    async load(): Promise<string | undefined> {
      if (envThreadId) return envThreadId;
      const settings = await readCodexThreadSettings(fullPath);
      return settings.alwaysStartNewThread ? undefined : settings.threadId;
    },
    async save(threadId: string): Promise<void> {
      if (envThreadId) return;
      await writeCodexThreadId(fullPath, threadId);
    }
  };
}

export async function readCodexThreadId(configPath: string): Promise<string | undefined> {
  return (await readCodexThreadSettings(configPath)).threadId;
}

export async function readCodexThreadSettings(configPath: string): Promise<CodexThreadSettings> {
  const parsed = await readJsonObject(configPath);
  const codex = parsed.codex;

  if (!codex || typeof codex !== "object" || Array.isArray(codex)) {
    return {
      alwaysStartNewThread: false
    };
  }

  const record = codex as Record<string, unknown>;
  const threadId = parseCodexThreadId(record.threadId);

  return {
    ...(threadId ? { threadId } : {}),
    alwaysStartNewThread: record.alwaysStartNewThread === true
  };
}

export async function writeCodexThreadId(configPath: string, threadId: string): Promise<void> {
  const parsed = await readJsonObject(configPath);
  const codex = parsed.codex && typeof parsed.codex === "object" && !Array.isArray(parsed.codex)
    ? parsed.codex as Record<string, unknown>
    : {};
  const body = `${JSON.stringify(
    {
      ...parsed,
      codex: {
        ...codex,
        threadId
      }
    },
    null,
    2
  )}\n`;

  await writeFile(configPath, body, "utf8");
}

function parseCodexThreadId(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function readJsonObject(path: string): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch (error) {
    if (isNotFound(error)) return {};
    throw error;
  }
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
