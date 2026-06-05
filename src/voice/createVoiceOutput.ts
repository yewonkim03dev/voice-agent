import { ConsoleVoiceOutput, type InspectableVoiceOutput } from "./ConsoleVoiceOutput.ts";
import { MacosAppleTtsProvider, type SpawnTtsProcess } from "./MacosAppleTtsProvider.ts";
import { resolveTtsConfig, type TtsCliOptions, type VoiceTtsFileConfig } from "./TtsConfig.ts";
import { TtsVoiceOutput } from "./TtsVoiceOutput.ts";

type WriteLine = (line: string) => void;

export interface CreateVoiceOutputOptions {
  cli?: TtsCliOptions;
  file?: VoiceTtsFileConfig;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  writeLine?: WriteLine;
  cwd?: string;
  spawnTtsProcess?: SpawnTtsProcess;
}

export function createVoiceOutput(options: CreateVoiceOutputOptions = {}): InspectableVoiceOutput {
  const config = resolveTtsConfig({
    cli: options.cli,
    file: options.file,
    env: options.env,
    platform: options.platform
  });

  if (!config.enabled || config.provider === "console") {
    return new ConsoleVoiceOutput({
      writeLine: options.writeLine
    });
  }

  return new TtsVoiceOutput({
    provider: new MacosAppleTtsProvider({
      cwd: options.cwd,
      env: options.env,
      spawnProcess: options.spawnTtsProcess
    }),
    writeLine: options.writeLine,
    language: config.language,
    voiceName: config.voiceName,
    gender: config.gender,
    rate: config.rate,
    pitch: config.pitch,
    volume: config.volume
  });
}
