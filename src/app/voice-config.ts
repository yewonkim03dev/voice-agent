import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  sanitizeApprovalPhraseConfig,
  type ApprovalPhraseConfig
} from "../permission/ApprovalSpeech.ts";
import {
  sanitizeGestureWakeConfig,
  type GestureWakeConfig,
  type GestureWakeFileConfig
} from "../gesture/GestureWakeConfig.ts";
import type { VoiceTtsFileConfig } from "../voice/TtsConfig.ts";
import { normalizeStopPhrases } from "../voice/BargeInPolicy.ts";
import { defaultWakePhrases, normalizedWakePhrases } from "../wake/WakePhraseRouter.ts";

export const defaultVoiceConfigPath = ".voice-agent.local.json";
export const defaultVisualThinkingVolume = 0.32;
export const defaultMaxUtteranceSeconds = 15;
export const minMaxUtteranceSeconds = 5;
export const maxMaxUtteranceSeconds = 55;

export interface VoiceHarnessConfig {
  recorderCommand: string;
  sttCommand: string;
  wakeStreamCommand?: string;
  sampleRate: number;
  channels: number;
  wakePhrases: string[];
  stopPhrases: string[];
  approvalPhrases?: ApprovalPhraseConfig;
  gestureWake?: GestureWakeConfig;
  tts?: VoiceTtsFileConfig;
  visual?: VoiceVisualFileConfig;
}

export type VoiceVisualFileConfig = Partial<{
  thinkingVolume: string | number;
  responseLanguage: "auto" | "ko" | "en";
  chatHistoryEnabled: boolean;
  hudEnabled: boolean;
  hudCompact: boolean;
  popupPreferred: boolean;
  speakWakeRejectedWarnings: boolean;
  maxUtteranceSeconds: string | number;
}>;

export interface VoiceLocalSettingsOverride {
  wakePhrases?: string[];
  stopPhrases?: string[];
  approvalPhrases?: ApprovalPhraseConfig;
  gestureWake?: GestureWakeFileConfig;
  tts?: VoiceTtsFileConfig;
  visual?: VoiceVisualFileConfig;
  codexThreadId?: string | null;
  codexAlwaysStartNewThread?: boolean;
}

export interface VoiceSettingsPersistence {
  update(overrides: VoiceLocalSettingsOverride): Promise<void>;
  resetAll(): Promise<void>;
  resetGestureWake(): Promise<void>;
}

export interface VoiceHarnessResolution {
  config?: VoiceHarnessConfig;
  errors: string[];
  source?: "env" | "file";
}

export interface VoiceSetupDetection {
  config?: VoiceHarnessConfig;
  errors: string[];
  recorder?: string;
  stt?: string;
  providerIds?: string[];
}

export type CommandExists = (command: string) => boolean | Promise<boolean>;

export interface VoiceSetupProviderContext {
  commandExists: CommandExists;
  platform: NodeJS.Platform;
}

export interface VoiceSetupCandidate {
  providerId: string;
  recorderCommand?: string;
  sttCommand?: string;
  wakeStreamCommand?: string;
}

export interface VoiceSetupProvider {
  id: string;
  detect(context: VoiceSetupProviderContext): Promise<VoiceSetupCandidate | null>;
}

export async function resolveVoiceHarnessConfig(options: {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  configPath?: string;
} = {}): Promise<VoiceHarnessResolution> {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const configPath = options.configPath ?? defaultVoiceConfigPath;
  const envWakePhrases = parseOptionalWakePhrases(env.VOICE_AGENT_WAKE_PHRASES);
  const envConfig = configFromEnv(env);

  if (envConfig.config || envConfig.errors.length > 0) {
    return envConfig;
  }

  const fileConfig = await readVoiceConfigFile(resolve(cwd, configPath));
  if (fileConfig.config && envWakePhrases) {
    return {
      ...fileConfig,
      config: {
        ...fileConfig.config,
        wakePhrases: envWakePhrases
      }
    };
  }

  if (fileConfig.config || fileConfig.errors.length > 0) {
    return fileConfig;
  }

  return missingResolution();
}

export async function detectVoiceSetup(
  commandExists: CommandExists,
  options: {
    platform?: NodeJS.Platform;
    providers?: VoiceSetupProvider[];
  } = {}
): Promise<VoiceSetupDetection> {
  const platform = options.platform ?? process.platform;
  const providers = options.providers ?? defaultVoiceSetupProviders;
  const candidates = await detectCandidates(providers, {
    commandExists,
    platform
  });
  const recorderCandidate = candidates.find((candidate) => candidate.recorderCommand);
  const sttCandidate = candidates.find((candidate) => candidate.sttCommand);
  const wakeStreamCandidate = candidates.find((candidate) => candidate.wakeStreamCommand);
  const recorder = recorderCandidate?.recorderCommand;
  const stt = sttCandidate?.sttCommand;
  const wakeStream = wakeStreamCandidate?.wakeStreamCommand;
  const errors: string[] = [];

  if (!recorder) {
    errors.push("No supported microphone recorder found. On macOS, make sure /usr/bin/swift is available; otherwise install SoX (`rec`) or set VOICE_AGENT_RECORDER_COMMAND manually.");
  }

  if (!stt) {
    errors.push("No supported local STT found. On macOS, make sure /usr/bin/swift is available for Apple Speech; otherwise install/configure whisper-cli or set VOICE_AGENT_STT_COMMAND manually.");
  }

  if (!recorder || !stt) {
    return {
      errors,
      recorder,
      stt,
      providerIds: candidates.map((candidate) => candidate.providerId)
    };
  }

  return {
    config: {
      recorderCommand: recorder,
      sttCommand: stt,
      ...(wakeStream ? { wakeStreamCommand: wakeStream } : {}),
      sampleRate: 16_000,
      channels: 1,
      wakePhrases: defaultWakePhrases,
      stopPhrases: normalizeStopPhrases(undefined)
    },
    errors,
    recorder,
    stt,
    providerIds: [...new Set([
      recorderCandidate.providerId,
      sttCandidate.providerId,
      ...(wakeStreamCandidate ? [wakeStreamCandidate.providerId] : [])
    ])]
  };
}

export async function writeVoiceConfigFile(
  config: VoiceHarnessConfig,
  options: {
    cwd?: string;
    configPath?: string;
  } = {}
): Promise<string> {
  const cwd = options.cwd ?? process.cwd();
  const configPath = options.configPath ?? defaultVoiceConfigPath;
  const fullPath = resolve(cwd, configPath);
  const existing = await readJsonObject(fullPath);
  const body = `${JSON.stringify(
    {
      ...existing,
      ...config
    },
    null,
    2
  )}\n`;

  await writeFile(fullPath, body, "utf8");
  return fullPath;
}

export class VoiceLocalSettingsStore implements VoiceSettingsPersistence {
  private readonly cwd: string;
  private readonly configPath: string;
  private queue: Promise<void> = Promise.resolve();

  constructor(options: {
    cwd?: string;
    configPath?: string;
  } = {}) {
    this.cwd = options.cwd ?? process.cwd();
    this.configPath = options.configPath ?? defaultVoiceConfigPath;
  }

  update(overrides: VoiceLocalSettingsOverride): Promise<void> {
    this.queue = this.queue
      .catch(() => {})
      .then(() => updateVoiceLocalSettings(overrides, {
        cwd: this.cwd,
        configPath: this.configPath
      }));
    return this.queue;
  }

  resetAll(): Promise<void> {
    this.queue = this.queue
      .catch(() => {})
      .then(() => resetVoiceLocalSettings({
        cwd: this.cwd,
        configPath: this.configPath
      }));
    return this.queue;
  }

  resetGestureWake(): Promise<void> {
    this.queue = this.queue
      .catch(() => {})
      .then(() => resetVoiceGestureWakeSettings({
        cwd: this.cwd,
        configPath: this.configPath
      }));
    return this.queue;
  }
}

export async function updateVoiceLocalSettings(
  overrides: VoiceLocalSettingsOverride,
  options: {
    cwd?: string;
    configPath?: string;
  } = {}
): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const configPath = options.configPath ?? defaultVoiceConfigPath;
  const fullPath = resolve(cwd, configPath);
  const existing = await readJsonObject(fullPath);
  const next: Record<string, unknown> = { ...existing };

  if (overrides.wakePhrases !== undefined) {
    next.wakePhrases = normalizedWakePhrases(overrides.wakePhrases);
  }

  if (overrides.stopPhrases !== undefined) {
    next.stopPhrases = normalizeStopPhrases(overrides.stopPhrases);
  }

  if (overrides.approvalPhrases !== undefined) {
    next.approvalPhrases = sanitizeApprovalPhraseConfig(overrides.approvalPhrases);
  }

  if (overrides.gestureWake !== undefined) {
    next.gestureWake = sanitizeGestureWakeConfig(overrides.gestureWake);
  }

  if (overrides.tts !== undefined) {
    next.tts = {
      ...readNestedObject(existing.tts),
      ...overrides.tts
    };
  }

  if (overrides.visual !== undefined) {
    next.visual = {
      ...readNestedObject(existing.visual),
      ...overrides.visual
    };
  }

  if (overrides.codexThreadId !== undefined || overrides.codexAlwaysStartNewThread !== undefined) {
    const codex = readNestedObject(existing.codex);

    if (overrides.codexThreadId !== undefined) {
      const threadId = parseOptionalString(overrides.codexThreadId);

      if (threadId) {
        codex.threadId = threadId;
      } else {
        delete codex.threadId;
      }
    }

    if (overrides.codexAlwaysStartNewThread !== undefined) {
      if (overrides.codexAlwaysStartNewThread) {
        codex.alwaysStartNewThread = true;
      } else {
        delete codex.alwaysStartNewThread;
      }
    }

    if (Object.keys(codex).length > 0) {
      next.codex = codex;
    } else {
      delete next.codex;
    }
  }

  await writeJsonObject(fullPath, next);
}

export async function resetVoiceLocalSettings(options: {
  cwd?: string;
  configPath?: string;
} = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const configPath = options.configPath ?? defaultVoiceConfigPath;
  const fullPath = resolve(cwd, configPath);
  const existing = await readJsonObject(fullPath);
  const next: Record<string, unknown> = { ...existing };
  const visual = readNestedObject(existing.visual);

  delete next.wakePhrases;
  delete next.stopPhrases;
  delete next.approvalPhrases;
  delete next.gestureWake;
  delete next.tts;
  delete visual.thinkingVolume;
  delete visual.responseLanguage;
  delete visual.chatHistoryEnabled;
  delete visual.hudEnabled;
  delete visual.hudCompact;
  delete visual.popupPreferred;
  delete visual.speakWakeRejectedWarnings;
  delete visual.maxUtteranceSeconds;

  const codex = readNestedObject(existing.codex);
  delete codex.alwaysStartNewThread;

  if (Object.keys(visual).length > 0) {
    next.visual = visual;
  } else {
    delete next.visual;
  }

  if (Object.keys(codex).length > 0) {
    next.codex = codex;
  } else {
    delete next.codex;
  }

  await writeJsonObject(fullPath, next);
}

export async function resetVoiceGestureWakeSettings(options: {
  cwd?: string;
  configPath?: string;
} = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const configPath = options.configPath ?? defaultVoiceConfigPath;
  const fullPath = resolve(cwd, configPath);
  const existing = await readJsonObject(fullPath);
  const next: Record<string, unknown> = { ...existing };

  delete next.gestureWake;

  await writeJsonObject(fullPath, next);
}

function configFromEnv(env: NodeJS.ProcessEnv): VoiceHarnessResolution {
  const recorderCommand = env.VOICE_AGENT_RECORDER_COMMAND?.trim() ?? "";
  const sttCommand = env.VOICE_AGENT_STT_COMMAND?.trim() ?? "";
  const wakeStreamCommand = env.VOICE_AGENT_WAKE_STREAM_COMMAND?.trim() ?? "";
  const wakePhrases = parseWakePhrases(env.VOICE_AGENT_WAKE_PHRASES);
  const stopPhrases = parseStopPhrases(env.VOICE_AGENT_STOP_PHRASES);

  if (!recorderCommand && !sttCommand) {
    return {
      errors: []
    };
  }

  const errors: string[] = [];

  if (!recorderCommand) {
    errors.push(missingRecorderMessage());
  }

  if (!sttCommand) {
    errors.push(missingSttMessage());
  }

  if (errors.length > 0) {
    return {
      errors,
      source: "env"
    };
  }

  return {
    config: {
      recorderCommand,
      sttCommand,
      ...(wakeStreamCommand ? { wakeStreamCommand } : {}),
      sampleRate: parsePositiveInteger(env.VOICE_AGENT_SAMPLE_RATE, 16_000),
      channels: parsePositiveInteger(env.VOICE_AGENT_CHANNELS, 1),
      wakePhrases,
      stopPhrases
    },
    errors,
    source: "env"
  };
}

async function readVoiceConfigFile(configPath: string): Promise<VoiceHarnessResolution> {
  let raw: string;

  try {
    raw = await readFile(configPath, "utf8");
  } catch (error) {
    if (isNotFound(error)) {
      return {
        errors: []
      };
    }

    return {
      errors: [`Could not read voice config file ${configPath}: ${formatError(error)}`],
      source: "file"
    };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<VoiceHarnessConfig> & Record<string, unknown>;
    if (!hasVoiceConfigFields(parsed)) {
      return {
        errors: []
      };
    }

    const recorderCommand = typeof parsed.recorderCommand === "string" ? parsed.recorderCommand.trim() : "";
    const sttCommand = typeof parsed.sttCommand === "string" ? parsed.sttCommand.trim() : "";
    const wakeStreamCommand = typeof parsed.wakeStreamCommand === "string" ? parsed.wakeStreamCommand.trim() : "";
    const errors: string[] = [];

    if (!recorderCommand) errors.push(`Voice config file ${configPath} is missing recorderCommand.`);
    if (!sttCommand) errors.push(`Voice config file ${configPath} is missing sttCommand.`);

    if (errors.length > 0) {
      return {
        errors,
        source: "file"
      };
    }

    return {
      config: {
        recorderCommand,
        sttCommand,
        ...(wakeStreamCommand ? { wakeStreamCommand } : {}),
        sampleRate: parsePositiveInteger(String(parsed.sampleRate ?? ""), 16_000),
        channels: parsePositiveInteger(String(parsed.channels ?? ""), 1),
        wakePhrases: parseWakePhrases(parsed.wakePhrases),
        stopPhrases: parseStopPhrases(parsed.stopPhrases),
        approvalPhrases: parseApprovalPhrases(parsed.approvalPhrases),
        gestureWake: parseGestureWakeConfig(parsed.gestureWake),
        tts: parseTtsFileConfig(parsed),
        visual: parseVisualFileConfig(parsed)
      },
      errors,
      source: "file"
    };
  } catch (error) {
    return {
      errors: [`Could not parse voice config file ${configPath}: ${formatError(error)}`],
      source: "file"
    };
  }
}

function missingResolution(): VoiceHarnessResolution {
  return {
    errors: [missingRecorderMessage(), missingSttMessage()]
  };
}

function missingRecorderMessage(): string {
  return "Missing microphone capability: run npm run setup:voice or set VOICE_AGENT_RECORDER_COMMAND to a command that streams 16kHz mono pcm_s16le audio to stdout.";
}

function missingSttMessage(): string {
  return "Missing STT capability: run npm run setup:voice or set VOICE_AGENT_STT_COMMAND to a local STT/Whisper command template containing {audio}.";
}

async function readJsonObject(path: string): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch (error) {
    if (isNotFound(error)) return {};
    throw error;
  }
}

async function writeJsonObject(path: string, value: Record<string, unknown>): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readNestedObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

function hasVoiceConfigFields(parsed: Record<string, unknown>): boolean {
  return "recorderCommand" in parsed ||
    "sttCommand" in parsed ||
    "wakeStreamCommand" in parsed ||
    "sampleRate" in parsed ||
    "channels" in parsed ||
    "wakePhrases" in parsed ||
    "stopPhrases" in parsed ||
    "approvalPhrases" in parsed ||
    "gestureWake" in parsed ||
    "tts" in parsed ||
    "visual" in parsed;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseWakePhrases(value: unknown): string[] {
  return parseOptionalWakePhrases(value) ?? defaultWakePhrases;
}

function parseStopPhrases(value: unknown): string[] {
  return normalizeStopPhrases(parsePhraseArray(value));
}

function parseTtsFileConfig(parsed: Partial<VoiceHarnessConfig> & Record<string, unknown>): VoiceTtsFileConfig | undefined {
  const tts = parsed.tts;
  if (tts && typeof tts === "object" && !Array.isArray(tts)) {
    return tts as VoiceTtsFileConfig;
  }

  return undefined;
}

function parseApprovalPhrases(value: unknown): ApprovalPhraseConfig | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;

  const record = value as Record<string, unknown>;
  return sanitizeApprovalPhraseConfig({
    onceApprove: parsePhraseArray(record.onceApprove),
    deny: parsePhraseArray(record.deny),
    cancel: parsePhraseArray(record.cancel),
    sessionApprove: parsePhraseArray(record.sessionApprove),
    policyApprove: parsePhraseArray(record.policyApprove),
    networkPolicyApprove: parsePhraseArray(record.networkPolicyApprove)
  });
}

function parseGestureWakeConfig(value: unknown): GestureWakeConfig | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return sanitizeGestureWakeConfig(value);
}

function parseVisualFileConfig(parsed: Partial<VoiceHarnessConfig> & Record<string, unknown>): VoiceVisualFileConfig | undefined {
  const visual = parsed.visual;
  if (!visual || typeof visual !== "object" || Array.isArray(visual)) return undefined;
  const record = visual as Record<string, unknown>;

  return {
    ...(parseVisualThinkingVolume(record.thinkingVolume) !== undefined
      ? { thinkingVolume: parseVisualThinkingVolume(record.thinkingVolume) }
      : {}),
    ...(parseVisualResponseLanguage(record.responseLanguage)
      ? { responseLanguage: parseVisualResponseLanguage(record.responseLanguage) }
      : {}),
    ...(typeof record.chatHistoryEnabled === "boolean" ? { chatHistoryEnabled: record.chatHistoryEnabled } : {}),
    ...(typeof record.hudEnabled === "boolean" ? { hudEnabled: record.hudEnabled } : {}),
    ...(typeof record.hudCompact === "boolean" ? { hudCompact: record.hudCompact } : {}),
    ...(typeof record.popupPreferred === "boolean" ? { popupPreferred: record.popupPreferred } : {}),
    ...(typeof record.speakWakeRejectedWarnings === "boolean"
      ? { speakWakeRejectedWarnings: record.speakWakeRejectedWarnings }
      : {}),
    ...(parseVisualMaxUtteranceSeconds(record.maxUtteranceSeconds) !== undefined
      ? { maxUtteranceSeconds: parseVisualMaxUtteranceSeconds(record.maxUtteranceSeconds) }
      : {})
  };
}

function parsePhraseArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const parsed = value
      .filter((phrase): phrase is string => typeof phrase === "string")
      .map((phrase) => phrase.trim())
      .filter(Boolean);
    return parsed.length > 0 ? parsed : undefined;
  }

  if (typeof value === "string") {
    const parsed = value
      .split(/[,;\n]/u)
      .map((phrase) => phrase.trim())
      .filter(Boolean);
    return parsed.length > 0 ? parsed : undefined;
  }

  return undefined;
}

function parseVisualThinkingVolume(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return clamp(value, 0, 0.8);
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? clamp(parsed, 0, 0.8) : undefined;
}

function parseVisualMaxUtteranceSeconds(value: unknown): number | undefined {
  if (typeof value !== "number" && typeof value !== "string") return undefined;
  if (typeof value === "string" && value.trim() === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(value.trim());
  return Number.isFinite(parsed) ? sanitizeMaxUtteranceSeconds(parsed) : undefined;
}

export function sanitizeMaxUtteranceSeconds(
  value: unknown,
  fallback = defaultMaxUtteranceSeconds
): number {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim() !== ""
      ? Number(value.trim())
      : Number.NaN;

  return Number.isFinite(parsed)
    ? clamp(parsed, minMaxUtteranceSeconds, maxMaxUtteranceSeconds)
    : fallback;
}

function parseVisualResponseLanguage(value: unknown): VoiceVisualFileConfig["responseLanguage"] | undefined {
  return value === "auto" || value === "ko" || value === "en" ? value : undefined;
}

function parseOptionalWakePhrases(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const parsed = normalizedWakePhrases(value.filter((phrase): phrase is string => typeof phrase === "string"));
    return parsed.length > 0 ? parsed : undefined;
  }

  if (typeof value === "string") {
    const parsed = normalizedWakePhrases(value.split(/[,;\n]/u));
    return parsed.length > 0 ? parsed : undefined;
  }

  return undefined;
}

function parseOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

async function detectCandidates(
  providers: VoiceSetupProvider[],
  context: VoiceSetupProviderContext
): Promise<VoiceSetupCandidate[]> {
  const candidates: VoiceSetupCandidate[] = [];

  for (const provider of providers) {
    const candidate = await provider.detect(context);
    if (candidate) candidates.push(candidate);
  }

  return candidates;
}

export const defaultVoiceSetupProviders: VoiceSetupProvider[] = [
  {
    id: "macos-swift",
    async detect(context) {
      if (context.platform !== "darwin") return null;
      if (!(await context.commandExists("swift"))) return null;

      return {
        providerId: "macos-swift",
        recorderCommand: "exec swift src/audio/macos-record-pcm.swift",
        sttCommand: "swift src/speech/macos-transcribe.swift {audio}",
        wakeStreamCommand: "swift src/wake/macos-wake-partial.swift"
      };
    }
  },
  {
    id: "sox-whisper",
    async detect(context) {
      const candidate: VoiceSetupCandidate = {
        providerId: "sox-whisper"
      };

      if (await context.commandExists("rec")) {
        candidate.recorderCommand = "rec -q -t raw -b 16 -e signed-integer -c 1 -r 16000 -";
      }

      if (await context.commandExists("whisper-cli")) {
        candidate.sttCommand = "whisper-cli -nt -f {audio}";
      } else if (await context.commandExists("whisper")) {
        candidate.sttCommand = "whisper {audio} --language auto --output_format txt --output_dir /tmp && cat /tmp/$(basename {audio} .wav).txt";
      }

      return candidate.recorderCommand || candidate.sttCommand ? candidate : null;
    }
  }
];
