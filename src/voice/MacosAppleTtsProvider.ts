import { spawn, type SpawnOptionsWithoutStdio } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { TtsProvider, TtsSpeakRequest, TtsVoiceInfo } from "./TtsProvider.ts";

interface ProcessReadable {
  on(event: "data", callback: (chunk: Buffer | string) => void): unknown;
}

interface TtsProcess {
  stdout: ProcessReadable;
  stderr: ProcessReadable;
  kill(signal?: NodeJS.Signals): boolean;
  on(event: "error", callback: (error: Error) => void): unknown;
  on(event: "exit", callback: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
}

export type SpawnTtsProcess = (
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio
) => TtsProcess;

export interface MacosAppleTtsProviderOptions {
  helperPath?: string;
  moduleCachePath?: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
  spawnProcess?: SpawnTtsProcess;
}

export class MacosAppleTtsProvider implements TtsProvider {
  readonly name = "macos-apple" as const;

  private readonly helperPath: string;
  private readonly moduleCachePath: string;
  private readonly cwd: string;
  private readonly env: Record<string, string | undefined>;
  private readonly spawnProcess: SpawnTtsProcess;
  private current: Promise<void> | undefined;
  private child: TtsProcess | undefined;

  constructor(options: MacosAppleTtsProviderOptions = {}) {
    this.helperPath = options.helperPath ?? defaultHelperPath();
    this.moduleCachePath = options.moduleCachePath ?? "/private/tmp/voice-agent-swift-module-cache";
    this.cwd = options.cwd ?? process.cwd();
    this.env = {
      ...process.env,
      ...options.env
    };
    this.spawnProcess = options.spawnProcess ?? spawn;
  }

  async speak(request: TtsSpeakRequest): Promise<void> {
    await this.stop();
    const args = this.argsForSpeak(request);
    this.current = this.run(args);

    try {
      await this.current;
    } finally {
      this.current = undefined;
    }
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (!child) return;

    child.kill("SIGTERM");
    await this.current?.catch(() => {});
  }

  async listVoices(): Promise<TtsVoiceInfo[]> {
    const output = await this.run(["-module-cache-path", this.moduleCachePath, this.helperPath, "--list-voices"], {
      captureStdout: true
    });

    try {
      return JSON.parse(output) as TtsVoiceInfo[];
    } catch {
      return [];
    }
  }

  private argsForSpeak(request: TtsSpeakRequest): string[] {
    const args = [
      "-module-cache-path",
      this.moduleCachePath,
      this.helperPath,
      "--text",
      request.text,
      "--language",
      request.language,
      "--gender",
      request.gender,
      "--rate",
      String(request.rate)
    ];

    if (request.voiceName) args.push("--voice", request.voiceName);
    if (request.pitch !== undefined) args.push("--pitch", String(request.pitch));
    if (request.volume !== undefined) args.push("--volume", String(request.volume));

    return args;
  }

  private run(args: string[], options: { captureStdout?: boolean } = {}): Promise<string> {
    return new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      const child = this.spawnProcess("swift", args, {
        cwd: this.cwd,
        env: this.env
      });
      this.child = child;

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        const text = chunk.toString();
        stderr += text;
        if (isDebugEnabled(this.env.VOICE_AGENT_TTS_DEBUG)) process.stderr.write(text);
      });
      child.on("error", (error) => {
        if (this.child === child) this.child = undefined;
        reject(new Error(`macOS TTS helper failed to start: ${error.message}`));
      });
      child.on("exit", (code, signal) => {
        if (this.child === child) this.child = undefined;

        if (code === 0 || signal) {
          resolve(options.captureStdout ? stdout.trim() : "");
          return;
        }

        const details = stderr.trim();
        reject(new Error(details ? `macOS TTS helper exited with code ${code}: ${details}` : `macOS TTS helper exited with code ${code}.`));
      });
    });
  }
}

function defaultHelperPath(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "macos-speak.swift");
}

function isDebugEnabled(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes" || value?.toLowerCase() === "on";
}
