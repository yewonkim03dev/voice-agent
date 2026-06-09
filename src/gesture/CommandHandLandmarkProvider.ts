import { spawn, type SpawnOptionsWithoutStdio } from "node:child_process";

import type {
  HandLandmark,
  HandLandmarkFrame,
  HandLandmarkName,
  HandLandmarkProvider
} from "./HandLandmarkProvider.ts";
import type { GestureCameraMode } from "./GestureWakeConfig.ts";

interface ProcessReadable {
  on(event: "data", callback: (chunk: Buffer | string) => void): unknown;
}

interface HandLandmarkProcess {
  stdout: ProcessReadable;
  stderr: ProcessReadable;
  kill(signal?: NodeJS.Signals): boolean;
  on(event: "error", callback: (error: Error) => void): unknown;
  on(event: "exit", callback: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
}

export type SpawnHandLandmarkProcess = (
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio
) => HandLandmarkProcess;

export type HandLandmarkProviderLine =
  | {
      type: "landmarks";
      timestamp?: number;
      landmarks: HandLandmark[];
    }
  | {
      type: "status";
      enabled: boolean;
      mode: GestureCameraMode;
      text?: string;
    };

export interface CommandHandLandmarkProviderOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  spawnProcess?: SpawnHandLandmarkProcess;
  now?: () => number;
}

export class CommandHandLandmarkProvider implements HandLandmarkProvider {
  private readonly command: string;
  private readonly args: string[];
  private readonly cwd: string;
  private readonly env: Record<string, string | undefined>;
  private readonly spawnProcess: SpawnHandLandmarkProcess;
  private readonly now: () => number;
  private child: HandLandmarkProcess | undefined;
  private stdoutBuffer = "";
  private readonly stoppingChildren = new WeakSet<HandLandmarkProcess>();

  constructor(options: CommandHandLandmarkProviderOptions) {
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

  async start(options: Parameters<HandLandmarkProvider["start"]>[0]): Promise<void> {
    this.stopChild();
    this.stdoutBuffer = "";
    const mode = options.mode ?? "idle";
    const args = [
      ...this.args,
      "--mode",
      mode,
      "--fps",
      String(options.fps),
      "--width",
      String(options.width),
      "--height",
      String(options.height)
    ];

    const child = this.spawnProcess(this.command, args, {
      cwd: this.cwd,
      env: this.env,
      shell: false
    });
    this.child = child;

    child.stdout.on("data", (chunk) => this.handleStdout(chunk.toString(), options));
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString().trim();
      if (!text) return;
      options.onStatus?.({
        enabled: false,
        mode,
        text
      });
    });
    child.on("error", (error) => {
      if (this.child === child) this.child = undefined;
      options.onError?.(error);
    });
    child.on("exit", (code, signal) => {
      const stopping = this.stoppingChildren.has(child);
      this.stoppingChildren.delete(child);
      if (this.child === child) this.child = undefined;
      if (stopping) return;
      options.onError?.(new Error(`hand landmark provider stopped code=${code ?? "null"} signal=${signal ?? "null"}`));
    });
  }

  async stop(): Promise<void> {
    this.stopChild();
  }

  private stopChild(): void {
    if (!this.child) return;
    const child = this.child;
    this.stoppingChildren.add(child);
    child.kill("SIGTERM");
    this.child = undefined;
  }

  private handleStdout(text: string, options: Parameters<HandLandmarkProvider["start"]>[0]): void {
    this.stdoutBuffer += text;
    const lines = this.stdoutBuffer.split(/\r?\n/u);
    this.stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      const event = parseHandLandmarkProviderLine(line);
      if (!event) continue;
      if (event.type === "landmarks") {
        options.onFrame({
          timestamp: event.timestamp ?? this.now(),
          landmarks: event.landmarks
        });
      } else {
        options.onStatus?.(event);
      }
    }
  }
}

export function parseHandLandmarkProviderLine(line: string): HandLandmarkProviderLine | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) return null;
  if (parsed.type === "status") {
    return {
      type: "status",
      enabled: parsed.enabled === true,
      mode: isCameraMode(parsed.mode) ? parsed.mode : "off",
      ...(typeof parsed.text === "string" ? { text: parsed.text } : {})
    };
  }

  if (parsed.type !== "landmarks" || !Array.isArray(parsed.landmarks)) return null;
  const landmarks = parsed.landmarks.map(parseHandLandmark).filter((landmark): landmark is HandLandmark => landmark !== null);
  return {
    type: "landmarks",
    landmarks,
    ...(typeof parsed.timestamp === "number" && Number.isFinite(parsed.timestamp) ? { timestamp: parsed.timestamp } : {})
  };
}

function parseHandLandmark(value: unknown): HandLandmark | null {
  if (!isRecord(value) || !isHandLandmarkName(value.name)) return null;
  if (typeof value.x !== "number" || typeof value.y !== "number" || typeof value.confidence !== "number") return null;
  if (!Number.isFinite(value.x) || !Number.isFinite(value.y) || !Number.isFinite(value.confidence)) return null;
  return {
    name: value.name,
    x: value.x,
    y: value.y,
    confidence: value.confidence
  };
}

function isHandLandmarkName(value: unknown): value is HandLandmarkName {
  return (
    value === "wrist" ||
    value === "thumbCMC" ||
    value === "thumbMP" ||
    value === "thumbIP" ||
    value === "thumbTip" ||
    value === "indexMCP" ||
    value === "indexPIP" ||
    value === "indexDIP" ||
    value === "indexTip" ||
    value === "middleMCP" ||
    value === "middlePIP" ||
    value === "middleDIP" ||
    value === "middleTip" ||
    value === "ringMCP" ||
    value === "ringPIP" ||
    value === "ringDIP" ||
    value === "ringTip" ||
    value === "littleMCP" ||
    value === "littlePIP" ||
    value === "littleDIP" ||
    value === "littleTip"
  );
}

function isCameraMode(value: unknown): value is GestureCameraMode {
  return value === "off" || value === "idle" || value === "listening" || value === "running" || value === "emergency";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
