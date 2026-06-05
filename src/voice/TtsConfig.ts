import type { TtsGender, TtsLanguage, TtsProviderName } from "./TtsProvider.ts";

export interface TtsCliOptions {
  enabled?: boolean;
  provider?: TtsProviderName;
  language?: TtsLanguage;
  voiceName?: string;
  gender?: TtsGender;
  rate?: number;
  pitch?: number;
  volume?: number;
}

export interface VoiceTtsConfig {
  enabled: boolean;
  provider: TtsProviderName;
  language: TtsLanguage;
  voiceName?: string;
  gender: TtsGender;
  rate: number;
  pitch?: number;
  volume?: number;
}

export type VoiceTtsFileConfig = Partial<{
  enabled: boolean;
  provider: TtsProviderName;
  language: TtsLanguage;
  voice: string;
  voiceName: string;
  gender: TtsGender;
  rate: string | number;
  pitch: string | number;
  volume: string | number;
}>;

export interface ResolveTtsConfigOptions {
  cli?: TtsCliOptions;
  file?: VoiceTtsFileConfig;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

export function resolveTtsConfig(options: ResolveTtsConfigOptions = {}): VoiceTtsConfig {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const file = normalizeFileConfig(options.file);
  const envConfig = configFromEnv(env);
  const merged: TtsCliOptions = {
    ...file,
    ...envConfig,
    ...options.cli
  };
  const enabled = resolveEnabled(merged, file, envConfig, options.cli);
  const provider = merged.provider ?? (platform === "darwin" ? "macos-apple" : "console");

  if (!enabled) {
    return {
      enabled: false,
      provider: "console",
      language: merged.language ?? "auto",
      voiceName: merged.voiceName,
      gender: merged.gender ?? "auto",
      rate: merged.rate ?? defaultTtsRate("fast"),
      pitch: merged.pitch,
      volume: merged.volume
    };
  }

  return {
    enabled: true,
    provider: provider === "macos-apple" && platform !== "darwin" ? "console" : provider,
    language: merged.language ?? "auto",
    voiceName: merged.voiceName,
    gender: merged.gender ?? "auto",
    rate: merged.rate ?? defaultTtsRate("fast"),
    pitch: merged.pitch,
    volume: merged.volume
  };
}

export function parseTtsRate(value: string | number | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  if (typeof value === "number") return clampRate(value);

  switch (value.trim().toLowerCase()) {
    case "slow":
      return defaultTtsRate("slow");
    case "normal":
      return defaultTtsRate("normal");
    case "fast":
      return defaultTtsRate("fast");
    default: {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? clampRate(parsed) : undefined;
    }
  }
}

export function defaultTtsRate(label: "slow" | "normal" | "fast"): number {
  switch (label) {
    case "slow":
      return 0.42;
    case "normal":
      return 0.5;
    case "fast":
      return 0.56;
  }
}

export function parseTtsProvider(value: string | undefined): TtsProviderName | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "console" || normalized === "macos-apple") return normalized;
  return undefined;
}

export function parseTtsLanguage(value: string | undefined): TtsLanguage | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "ko" || normalized === "en" || normalized === "auto") return normalized;
  return undefined;
}

export function parseTtsGender(value: string | undefined): TtsGender | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "male" || normalized === "female" || normalized === "auto") return normalized;
  return undefined;
}

export function parseTtsBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;

  switch (value.trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
    case "enabled":
      return true;
    case "0":
    case "false":
    case "no":
    case "off":
    case "disabled":
      return false;
    default:
      return undefined;
  }
}

export function parseOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeFileConfig(file: VoiceTtsFileConfig | undefined): TtsCliOptions {
  if (!file) return {};

  return {
    enabled: parseTtsBoolean(file.enabled),
    provider: parseTtsProvider(file.provider),
    language: parseTtsLanguage(file.language),
    voiceName: typeof file.voiceName === "string" ? file.voiceName : typeof file.voice === "string" ? file.voice : undefined,
    gender: parseTtsGender(file.gender),
    rate: parseTtsRate(file.rate),
    pitch: parseOptionalNumber(file.pitch),
    volume: parseOptionalNumber(file.volume)
  };
}

function configFromEnv(env: NodeJS.ProcessEnv): TtsCliOptions {
  return {
    enabled: parseTtsBoolean(env.VOICE_AGENT_TTS_ENABLED),
    provider: parseTtsProvider(env.VOICE_AGENT_TTS_PROVIDER),
    voiceName: env.VOICE_AGENT_TTS_VOICE?.trim() || undefined,
    gender: parseTtsGender(env.VOICE_AGENT_TTS_GENDER),
    rate: parseTtsRate(env.VOICE_AGENT_TTS_RATE),
    pitch: parseOptionalNumber(env.VOICE_AGENT_TTS_PITCH),
    volume: parseOptionalNumber(env.VOICE_AGENT_TTS_VOLUME)
  };
}

function resolveEnabled(
  merged: TtsCliOptions,
  file: TtsCliOptions,
  env: TtsCliOptions,
  cli: TtsCliOptions | undefined
): boolean {
  if (cli?.enabled !== undefined) return cli.enabled;
  if (env.enabled !== undefined) return env.enabled;
  if (file.enabled !== undefined) return file.enabled;
  return Boolean(merged.provider || merged.voiceName || merged.rate || merged.gender !== undefined);
}

function clampRate(value: number): number {
  return Math.min(1, Math.max(0.1, value));
}
