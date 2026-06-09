import { spawn, type SpawnOptionsWithoutStdio } from "node:child_process";

import type { CameraGestureWatcher, GestureWatcherObservation, GestureWatcherStatus } from "./CameraGestureWatcher.ts";
import type { GestureCameraMode, GestureName, GestureWakeConfig } from "./GestureWakeConfig.ts";
import { isGestureName } from "./GestureWakeConfig.ts";

interface ProcessReadable {
  on(event: "data", callback: (chunk: Buffer | string) => void): unknown;
}

interface CameraGestureProcess {
  stdout: ProcessReadable;
  stderr: ProcessReadable;
  kill(signal?: NodeJS.Signals): boolean;
  on(event: "error", callback: (error: Error) => void): unknown;
  on(event: "exit", callback: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
}

export type SpawnCameraGestureProcess = (
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio
) => CameraGestureProcess;

export type CameraGestureWatcherLine =
  | {
      type: "gesture";
      gesture: GestureName;
      timestamp?: number;
      confidence?: number;
    }
  | GestureWatcherStatus;

export interface CommandCameraGestureWatcherOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  spawnProcess?: SpawnCameraGestureProcess;
  now?: () => number;
}

export class CommandCameraGestureWatcher implements CameraGestureWatcher {
  private readonly command: string;
  private readonly args: string[];
  private readonly cwd: string;
  private readonly env: Record<string, string | undefined>;
  private readonly spawnProcess: SpawnCameraGestureProcess;
  private readonly now: () => number;
  private readonly gestureListeners: Array<(observation: GestureWatcherObservation) => void> = [];
  private readonly statusListeners: Array<(status: GestureWatcherStatus) => void> = [];
  private config: GestureWakeConfig | undefined;
  private mode: GestureCameraMode = "off";
  private child: CameraGestureProcess | undefined;
  private stdoutBuffer = "";
  private stopping = false;

  constructor(options: CommandCameraGestureWatcherOptions) {
    this.command = options.command;
    this.args = options.args ?? [];
    this.cwd = options.cwd ?? process.cwd();
    this.env = {
      ...process.env,
      ...options.env
    };
    this.spawnProcess = options.spawnProcess ?? spawn;
    this.now = options.now ?? Date.now;
  }

  async start(config: GestureWakeConfig): Promise<void> {
    this.config = config;
    this.emitStatus({
      enabled: false,
      mode: "off",
      text: "camera gesture watcher ready"
    });
  }

  async stop(): Promise<void> {
    this.mode = "off";
    this.killChild();
    this.emitStatus({
      enabled: false,
      mode: "off"
    });
  }

  setMode(mode: GestureCameraMode): void {
    const previousMode = this.mode;
    this.mode = mode;
    if (!this.config || mode === "off") {
      this.killChild();
      this.emitStatus({
        enabled: false,
        mode: "off"
      });
      return;
    }

    if (this.child && previousMode === mode) return;
    this.startChild(mode);
  }

  onGesture(callback: (observation: GestureWatcherObservation) => void): void {
    this.gestureListeners.push(callback);
  }

  onStatus(callback: (status: GestureWatcherStatus) => void): void {
    this.statusListeners.push(callback);
  }

  private startChild(mode: GestureCameraMode): void {
    if (!this.config) return;

    this.killChild();
    this.stdoutBuffer = "";
    const fps = fpsForMode(mode, this.config);
    const args = [
      ...this.args,
      "--mode",
      mode,
      "--fps",
      String(fps),
      "--width",
      String(this.config.resolution.width),
      "--height",
      String(this.config.resolution.height)
    ];

    this.stopping = false;
    const child = this.spawnProcess(this.command, args, {
      cwd: this.cwd,
      env: this.env,
      shell: false
    });
    this.child = child;

    child.stdout.on("data", (chunk) => this.handleStdout(chunk.toString()));
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString().trim();
      if (!text) return;
      this.emitStatus({
        enabled: true,
        mode,
        text
      });
    });
    child.on("error", (error) => {
      if (this.child === child) this.child = undefined;
      this.emitStatus({
        enabled: false,
        mode: "off",
        text: `camera gesture watcher failed: ${error.message}`
      });
    });
    child.on("exit", (code, signal) => {
      if (this.child === child) this.child = undefined;
      if (this.stopping || this.mode === "off") return;
      this.emitStatus({
        enabled: false,
        mode: "off",
        text: `camera gesture watcher stopped code=${code ?? "null"} signal=${signal ?? "null"}`
      });
    });

    this.emitStatus({
      enabled: true,
      mode
    });
  }

  private killChild(): void {
    if (!this.child) return;
    this.stopping = true;
    this.child.kill("SIGTERM");
    this.child = undefined;
  }

  private handleStdout(text: string): void {
    this.stdoutBuffer += text;
    const lines = this.stdoutBuffer.split(/\r?\n/u);
    this.stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      const event = parseCameraGestureWatcherLine(line);
      if (!event) continue;
      if ("gesture" in event) {
        this.emitGesture({
          gesture: event.gesture,
          timestamp: event.timestamp ?? this.now(),
          ...(event.confidence !== undefined ? { confidence: event.confidence } : {})
        });
      } else {
        this.emitStatus(event);
      }
    }
  }

  private emitGesture(observation: GestureWatcherObservation): void {
    this.gestureListeners.forEach((listener) => listener(observation));
  }

  private emitStatus(status: GestureWatcherStatus): void {
    this.statusListeners.forEach((listener) => listener(status));
  }
}

export function parseCameraGestureWatcherLine(line: string): CameraGestureWatcherLine | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) return null;
  if (parsed.type === "gesture" && isGestureName(parsed.gesture)) {
    return {
      type: "gesture",
      gesture: parsed.gesture,
      ...(typeof parsed.timestamp === "number" && Number.isFinite(parsed.timestamp) ? { timestamp: parsed.timestamp } : {}),
      ...(typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence) ? { confidence: parsed.confidence } : {})
    };
  }

  if (parsed.type === "status") {
    const mode = isCameraMode(parsed.mode) ? parsed.mode : "off";
    return {
      enabled: parsed.enabled === true,
      mode,
      ...(typeof parsed.text === "string" ? { text: parsed.text } : {})
    };
  }

  return null;
}

function fpsForMode(mode: GestureCameraMode, config: GestureWakeConfig): number {
  if (mode === "emergency") return Math.max(1, Math.min(2, config.fps));
  if (mode === "listening") return Math.max(2, Math.min(5, config.fps));
  return config.fps;
}

function isCameraMode(value: unknown): value is GestureCameraMode {
  return value === "off" || value === "idle" || value === "listening" || value === "running" || value === "emergency";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
