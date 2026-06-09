import { spawn, type SpawnOptionsWithoutStdio } from "node:child_process";

import type { AudioFormat, AudioFrame, AudioInput, AudioInputStatus, AudioInputStatusEvent } from "./AudioFrame.ts";

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
  restartDelayMs?: number;
  statusHeartbeatTimeoutMs?: number;
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
  private readonly restartDelayMs: number;
  private readonly statusHeartbeatTimeoutMs: number;
  private readonly frameListeners: Array<(frame: AudioFrame) => void> = [];
  private readonly statusListeners: Array<(event: AudioInputStatusEvent) => void> = [];
  private child: RecorderProcess | undefined;
  private stderr = "";
  private stderrBuffer = "";
  private stopPromise: Promise<void> | undefined;
  private desiredRunning = false;
  private stopping = false;
  private restarting = false;
  private statusProtocolSeen = false;
  private lastStatusAt = 0;
  private restartTimer: ReturnType<typeof setTimeout> | undefined;
  private statusTimer: ReturnType<typeof setInterval> | undefined;

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
    this.restartDelayMs = options.restartDelayMs ?? 800;
    this.statusHeartbeatTimeoutMs = options.statusHeartbeatTimeoutMs ?? 180_000;
  }

  async start(): Promise<void> {
    if (this.child) return;
    this.desiredRunning = true;
    this.stopping = false;
    this.spawnRecorder();
  }

  async stop(): Promise<void> {
    this.desiredRunning = false;
    this.stopping = true;
    this.clearRestartTimer();
    this.clearStatusTimer();
    this.emitStatus("stopped");
    const child = this.child;
    if (!child) return;

    child.kill("SIGTERM");
    await this.stopPromise;
  }

  onFrame(callback: (frame: AudioFrame) => void): void {
    this.frameListeners.push(callback);
  }

  onStatus(callback: (event: AudioInputStatusEvent) => void): void {
    this.statusListeners.push(callback);
  }

  async reconnect(): Promise<void> {
    this.scheduleRestart("manual reconnect");
  }

  private spawnRecorder(): void {
    if (this.child) return;

    this.stderr = "";
    this.stderrBuffer = "";
    this.emitStatus("starting");
    const child = this.spawnProcess(this.command, [], {
      cwd: this.cwd,
      env: this.env,
      shell: true
    });
    this.child = child;
    this.ensureStatusTimer();
    this.stopPromise = new Promise((resolve, reject) => {
      child.stdout.on("data", (chunk) => this.emitFrame(Buffer.from(chunk)));
      child.stderr.on("data", (chunk) => this.handleStderr(chunk.toString()));
      child.on("error", (error) => {
        this.child = undefined;
        const message = `Recorder command failed: ${error.message}`;
        this.emitStatus("failed", message, true);
        if (this.desiredRunning && !this.stopping) {
          this.scheduleRestart(message);
          resolve();
          return;
        }
        reject(new Error(`Recorder command failed to start: ${error.message}`));
      });
      child.on("exit", (code, signal) => {
        this.child = undefined;
        if (this.stopping || !this.desiredRunning || code === 0 || signal) {
          resolve();
          return;
        }

        const details = this.stderr.trim();
        const message = details ? `Recorder command exited with code ${code}: ${details}` : `Recorder command exited with code ${code}.`;
        this.emitStatus("failed", message, true);
        this.scheduleRestart(message);
        resolve();
      });
    });
  }

  private handleStderr(chunk: string): void {
    this.stderr += chunk;
    this.stderrBuffer += chunk;

    while (true) {
      const lineEnd = this.stderrBuffer.indexOf("\n");
      if (lineEnd === -1) return;

      const line = this.stderrBuffer.slice(0, lineEnd).trim();
      this.stderrBuffer = this.stderrBuffer.slice(lineEnd + 1);
      if (!line) continue;

      const event = parseRecorderStatusLine(line, this.now);
      if (!event) continue;

      this.statusProtocolSeen = true;
      this.lastStatusAt = event.timestamp;
      this.emitStatusEvent(event);
      if (event.status === "failed" && event.fatal) {
        this.scheduleRestart(event.message ?? "fatal recorder error");
      }
    }
  }

  private ensureStatusTimer(): void {
    if (this.statusTimer || this.statusHeartbeatTimeoutMs <= 0) return;

    const intervalMs = Math.max(1_000, Math.min(30_000, Math.floor(this.statusHeartbeatTimeoutMs / 2)));
    this.statusTimer = setInterval(() => {
      if (!this.desiredRunning || !this.child || !this.statusProtocolSeen || this.lastStatusAt <= 0) return;
      if (this.now() - this.lastStatusAt <= this.statusHeartbeatTimeoutMs) return;

      this.scheduleRestart(`recorder heartbeat timed out after ${this.statusHeartbeatTimeoutMs}ms`);
    }, intervalMs);
    this.statusTimer.unref?.();
  }

  private clearStatusTimer(): void {
    if (!this.statusTimer) return;
    clearInterval(this.statusTimer);
    this.statusTimer = undefined;
  }

  private scheduleRestart(reason: string): void {
    if (!this.desiredRunning || this.restarting) return;

    this.restarting = true;
    this.emitStatus("restarting", reason);
    const child = this.child;
    this.child = undefined;
    if (child) child.kill("SIGTERM");

    this.clearRestartTimer();
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      this.restarting = false;
      if (!this.desiredRunning || this.stopping) return;
      this.spawnRecorder();
    }, this.restartDelayMs);
    this.restartTimer.unref?.();
  }

  private clearRestartTimer(): void {
    if (!this.restartTimer) return;
    clearTimeout(this.restartTimer);
    this.restartTimer = undefined;
  }

  private emitStatus(status: AudioInputStatus, message?: string, fatal?: boolean): void {
    this.emitStatusEvent({
      status,
      timestamp: this.now(),
      ...(message ? { message } : {}),
      ...(fatal !== undefined ? { fatal } : {})
    });
  }

  private emitStatusEvent(event: AudioInputStatusEvent): void {
    this.statusListeners.forEach((listener) => listener(event));
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

export function parseRecorderStatusLine(line: string, now: () => number = Date.now): AudioInputStatusEvent | null {
  const statusMatch = line.match(/^\[audio:status\]\s+([a-z_]+)(?:\s+([\s\S]*))?$/u);
  if (statusMatch) {
    const status = parseAudioInputStatus(statusMatch[1]);
    if (!status) return null;

    const message = statusMatch[2]?.trim();
    return {
      status,
      timestamp: now(),
      ...(message ? { message } : {})
    };
  }

  const errorMatch = line.match(/^\[audio:error\]\s*([\s\S]*)$/u);
  if (!errorMatch) return null;

  const message = errorMatch[1]?.trim() || "audio recorder error";
  return {
    status: "failed",
    timestamp: now(),
    message,
    fatal: /\bfatal\b|\bunrecoverable\b/iu.test(message)
  };
}

function parseAudioInputStatus(value: string | undefined): AudioInputStatus | null {
  switch (value) {
    case "starting":
    case "running":
    case "reconfiguring":
    case "waiting_device":
    case "restarted":
    case "failed":
    case "restarting":
    case "stopped":
      return value;
    default:
      return null;
  }
}
