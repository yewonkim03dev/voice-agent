import { spawn, type SpawnOptionsWithoutStdio } from "node:child_process";

import type { CameraPermissionManager, CameraPermissionStatus } from "./CameraGestureWatcher.ts";

interface ProcessReadable {
  on(event: "data", callback: (chunk: Buffer | string) => void): unknown;
}

interface CameraPermissionProcess {
  stdout: ProcessReadable;
  stderr: ProcessReadable;
  on(event: "error", callback: (error: Error) => void): unknown;
  on(event: "exit", callback: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
}

export type SpawnCameraPermissionProcess = (
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio
) => CameraPermissionProcess;

export interface CommandCameraPermissionManagerOptions {
  command: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
  spawnProcess?: SpawnCameraPermissionProcess;
}

export class CommandCameraPermissionManager implements CameraPermissionManager {
  private readonly command: string;
  private readonly cwd: string;
  private readonly env: Record<string, string | undefined>;
  private readonly spawnProcess: SpawnCameraPermissionProcess;

  constructor(options: CommandCameraPermissionManagerOptions) {
    this.command = options.command;
    this.cwd = options.cwd ?? process.cwd();
    this.env = {
      ...process.env,
      ...options.env
    };
    this.spawnProcess = options.spawnProcess ?? spawn;
  }

  requestPermission(): Promise<CameraPermissionStatus> {
    return new Promise((resolve) => {
      let stdout = "";
      const child = this.spawnProcess(this.command, [], {
        cwd: this.cwd,
        env: this.env,
        shell: true
      });

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", () => {});
      child.on("error", () => {
        resolve("unavailable");
      });
      child.on("exit", (code) => {
        if (code !== 0) {
          resolve("unavailable");
          return;
        }
        resolve(parseCameraPermissionStatus(stdout));
      });
    });
  }
}

export function parseCameraPermissionStatus(text: string): CameraPermissionStatus {
  const normalized = text.trim().toLowerCase().replaceAll("-", "_");
  if (normalized === "authorized") return "authorized";
  if (normalized === "not_determined") return "not_determined";
  if (normalized === "denied") return "denied";
  if (normalized === "restricted") return "restricted";
  return "unavailable";
}
