import type { VoiceHarnessConfig } from "../app/voice-config.ts";
import { CommandWakeStreamDetector } from "./CommandWakeStreamDetector.ts";
import { NoopWakeStreamDetector, type WakeStreamDetector } from "./WakeStreamDetector.ts";

export interface CreateWakeStreamDetectorOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  diagnosticLine?: (line: string) => void;
  now?: () => number;
}

export function createWakeStreamDetectorFromConfig(
  config: VoiceHarnessConfig,
  options: CreateWakeStreamDetectorOptions = {}
): WakeStreamDetector {
  const command = config.wakeStreamCommand?.trim() || inferMacosWakeStreamCommand(config, options.platform ?? process.platform);
  if (!command) return new NoopWakeStreamDetector();

  return new CommandWakeStreamDetector({
    command,
    cwd: options.cwd,
    env: {
      ...options.env,
      VOICE_AGENT_WAKE_STREAM_SAMPLE_RATE: String(config.sampleRate),
      VOICE_AGENT_WAKE_STREAM_CHANNELS: String(config.channels)
    },
    provider: command.includes("macos-wake-partial.swift") ? "apple-speech-partial" : "command-partial",
    wakePhrases: config.wakePhrases,
    diagnosticLine: options.diagnosticLine,
    now: options.now
  });
}

function inferMacosWakeStreamCommand(config: VoiceHarnessConfig, platform: NodeJS.Platform): string | undefined {
  if (platform !== "darwin") return undefined;
  if (!config.recorderCommand.includes("macos-record-pcm.swift") && !config.sttCommand.includes("macos-transcribe.swift")) {
    return undefined;
  }

  return "swift src/wake/macos-wake-partial.swift";
}
