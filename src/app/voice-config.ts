import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export const defaultVoiceConfigPath = ".voice-agent.local.json";

export interface VoiceHarnessConfig {
  recorderCommand: string;
  sttCommand: string;
  sampleRate: number;
  channels: number;
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
  const envConfig = configFromEnv(env);

  if (envConfig.config || envConfig.errors.length > 0) {
    return envConfig;
  }

  const fileConfig = await readVoiceConfigFile(resolve(cwd, configPath));
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
  const recorder = recorderCandidate?.recorderCommand;
  const stt = sttCandidate?.sttCommand;
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
      sampleRate: 16_000,
      channels: 1
    },
    errors,
    recorder,
    stt,
    providerIds: [...new Set([recorderCandidate.providerId, sttCandidate.providerId])]
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
  const body = `${JSON.stringify(config, null, 2)}\n`;

  await writeFile(fullPath, body, "utf8");
  return fullPath;
}

function configFromEnv(env: NodeJS.ProcessEnv): VoiceHarnessResolution {
  const recorderCommand = env.VOICE_AGENT_RECORDER_COMMAND?.trim() ?? "";
  const sttCommand = env.VOICE_AGENT_STT_COMMAND?.trim() ?? "";

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
      sampleRate: parsePositiveInteger(env.VOICE_AGENT_SAMPLE_RATE, 16_000),
      channels: parsePositiveInteger(env.VOICE_AGENT_CHANNELS, 1)
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
    const parsed = JSON.parse(raw) as Partial<VoiceHarnessConfig>;
    const recorderCommand = typeof parsed.recorderCommand === "string" ? parsed.recorderCommand.trim() : "";
    const sttCommand = typeof parsed.sttCommand === "string" ? parsed.sttCommand.trim() : "";
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
        sampleRate: parsePositiveInteger(String(parsed.sampleRate ?? ""), 16_000),
        channels: parsePositiveInteger(String(parsed.channels ?? ""), 1)
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

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
        sttCommand: "swift src/speech/macos-transcribe.swift {audio}"
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
