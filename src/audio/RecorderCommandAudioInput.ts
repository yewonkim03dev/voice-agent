import { spawn, type SpawnOptionsWithoutStdio } from "node:child_process";

import type { AudioFormat, AudioFrame, AudioInput } from "./AudioFrame.ts";

interface ProcessReadable {
  on(event: "data", callback: (chunk: Buffer | string) => void): unknown;
}

interface RecorderProcess {
  stdout: ProcessReadable;
  stderr: ProcessReadable;
  kill(signal?: NodeJS.Signals): boolean;
  on(event: "error", callback: (error: Error) => void): unknown;
  on(event: "exit", callback: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
}

export type SpawnRecorderProcess = (
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio
) => RecorderProcess;

export interface RecorderCommandAudioInputOptions {
  command: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
  sampleRate?: number;
  channels?: number;
  format?: AudioFormat;
  now?: () => number;
  spawnProcess?: SpawnRecorderProcess;
}

export class RecorderCommandAudioInput implements AudioInput {
  private readonly command: string;
  private readonly cwd: string;
  private readonly env: Record<string, string | undefined>;
  private readonly sampleRate: number;
  private readonly channels: number;
  private readonly format: AudioFormat;
  private readonly now: () => number;
  private readonly spawnProcess: SpawnRecorderProcess;
  private readonly frameListeners: Array<(frame: AudioFrame) => void> = [];
  private child: RecorderProcess | undefined;
  private stderr = "";
  private stopPromise: Promise<void> | undefined;

  constructor(options: RecorderCommandAudioInputOptions) {
    this.command = options.command;
    this.cwd = options.cwd ?? process.cwd();
    this.env = {
      ...process.env,
      ...options.env
    };
    this.sampleRate = options.sampleRate ?? 16_000;
    this.channels = options.channels ?? 1;
    this.format = options.format ?? "pcm_s16le";
    this.now = options.now ?? Date.now;
    this.spawnProcess = options.spawnProcess ?? spawn;
  }

  async start(): Promise<void> {
    if (this.child) return;

    this.stderr = "";
    const child = this.spawnProcess(this.command, [], {
      cwd: this.cwd,
      env: this.env,
      shell: true
    });
    this.child = child;
    this.stopPromise = new Promise((resolve, reject) => {
      child.stdout.on("data", (chunk) => this.emitFrame(Buffer.from(chunk)));
      child.stderr.on("data", (chunk) => {
        this.stderr += chunk.toString();
      });
      child.on("error", (error) => {
        this.child = undefined;
        reject(new Error(`Recorder command failed to start: ${error.message}`));
      });
      child.on("exit", (code, signal) => {
        this.child = undefined;
        if (code === 0 || signal) {
          resolve();
          return;
        }

        const details = this.stderr.trim();
        reject(new Error(details ? `Recorder command exited with code ${code}: ${details}` : `Recorder command exited with code ${code}.`));
      });
    });
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (!child) return;

    child.kill("SIGTERM");
    await this.stopPromise;
  }

  onFrame(callback: (frame: AudioFrame) => void): void {
    this.frameListeners.push(callback);
  }

  private emitFrame(data: Buffer): void {
    if (data.byteLength === 0) return;

    const frame: AudioFrame = {
      timestamp: this.now(),
      sampleRate: this.sampleRate,
      channels: this.channels,
      format: this.format,
      data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
    };

    this.frameListeners.forEach((listener) => listener(frame));
  }
}
