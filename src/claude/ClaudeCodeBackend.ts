import { spawn, type SpawnOptionsWithoutStdio } from "node:child_process";

import type { AgentBackend, CodexProcessConfig } from "../codex/CodexBridge.ts";
import type { CodexOutputEvent, CodexStatus } from "../codex/CodexOutputEvent.ts";
import type { CodexPrompt } from "../codex/CodexPrompt.ts";
import type { PermissionDecision } from "../permission/PermissionDecision.ts";
import type { PermissionRequest } from "../permission/PermissionRequest.ts";

type WriteLine = (line: string) => void;

interface ProcessReadable {
  on(event: "data", callback: (chunk: Buffer | string) => void): unknown;
}

interface ClaudeProbeProcess {
  stdout: ProcessReadable;
  stderr: ProcessReadable;
  kill(signal?: NodeJS.Signals): boolean;
  on(event: "error", callback: (error: Error) => void): unknown;
  on(event: "exit", callback: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
}

export type SpawnClaudeProbeProcess = (
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio
) => ClaudeProbeProcess;

export interface ClaudeCodeBackendOptions {
  command?: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
  now?: () => number;
  writeLine?: WriteLine;
  spawnProcess?: SpawnClaudeProbeProcess;
  startupTimeoutMs?: number;
}

export class ClaudeCodeBackend implements AgentBackend {
  private readonly command: string;
  private readonly cwd: string;
  private readonly env: Record<string, string | undefined>;
  private readonly now: () => number;
  private readonly writeLine: WriteLine;
  private readonly spawnProcess: SpawnClaudeProbeProcess;
  private readonly startupTimeoutMs: number;
  private readonly outputListeners: Array<(event: CodexOutputEvent) => void> = [];
  private readonly permissionListeners: Array<(request: PermissionRequest) => void> = [];
  private readonly statusListeners: Array<(status: CodexStatus) => void> = [];
  private status: CodexStatus = {
    process: "not_started",
    task: "idle"
  };

  constructor(options: ClaudeCodeBackendOptions = {}) {
    this.command = options.command ?? "claude";
    this.cwd = options.cwd ?? process.cwd();
    this.env = {
      ...process.env,
      ...options.env
    };
    this.now = options.now ?? Date.now;
    this.writeLine = options.writeLine ?? noop;
    this.spawnProcess = options.spawnProcess ?? spawn;
    this.startupTimeoutMs = options.startupTimeoutMs ?? 5_000;
  }

  async start(config?: CodexProcessConfig): Promise<void> {
    const command = config?.command ?? this.command;
    const cwd = config?.cwd ?? this.cwd;
    const env = {
      ...this.env,
      ...config?.env
    };

    this.publishStatus({
      process: "starting",
      task: "idle",
      currentWorkingDirectory: cwd
    });

    try {
      const probe = await this.probe(command, cwd, env);
      const message =
        `Claude Code CLI detected (${probe}), but this harness does not have a supported ` +
        "structured approval transport for Claude Code yet.";
      throw new Error(message);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.publishUnavailable(message);
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.publishStatus({
      ...this.status,
      process: "exited",
      task: "idle"
    });
  }

  async sendPrompt(_prompt: CodexPrompt): Promise<void> {
    throw new Error("Claude Code backend is not available.");
  }

  async sendPermission(_decision: PermissionDecision): Promise<void> {
    throw new Error("Claude Code backend is not available.");
  }

  async interrupt(_reason: string): Promise<void> {
    throw new Error("Claude Code backend is not available.");
  }

  onOutput(callback: (event: CodexOutputEvent) => void): void {
    this.outputListeners.push(callback);
  }

  onPermissionRequest(callback: (request: PermissionRequest) => void): void {
    this.permissionListeners.push(callback);
  }

  onStatus(callback: (status: CodexStatus) => void): void {
    this.statusListeners.push(callback);
  }

  private probe(command: string, cwd: string, env: Record<string, string | undefined>): Promise<string> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let output = "";
      const child = this.spawnProcess(command, ["--version"], {
        cwd,
        env
      });
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        fail(new Error(`Claude Code capability probe timed out after ${this.startupTimeoutMs}ms.`));
      }, this.startupTimeoutMs);
      const complete = (version: string): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(version);
      };
      const fail = (error: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      };

      child.stdout.on("data", (chunk) => {
        output += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        output += chunk.toString();
      });
      child.on("error", (error) => {
        fail(new Error(`Claude Code CLI could not start: ${error.message}`));
      });
      child.on("exit", (code, signal) => {
        if (code === 0) {
          complete(summarizeProbeOutput(output) || "version probe succeeded");
          return;
        }

        const reason = signal
          ? `Claude Code CLI exited from ${signal}.`
          : `Claude Code CLI exited with code ${code ?? 0}.`;
        const details = summarizeProbeOutput(output);
        fail(new Error(details ? `${reason} ${details}` : reason));
      });
    });
  }

  private publishUnavailable(message: string): void {
    this.writeLine(`[claude] ${message}`);
    this.outputListeners.forEach((listener) =>
      listener({
        sessionId: "claude",
        type: "error",
        text: message,
        timestamp: this.now()
      })
    );
    this.publishStatus({
      ...this.status,
      process: "error",
      task: "idle"
    });
  }

  private publishStatus(status: CodexStatus): void {
    this.status = status;
    this.statusListeners.forEach((listener) => listener(status));
  }
}

function summarizeProbeOutput(output: string): string {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const typeError = lines.find((line) => line.includes("TypeError:"));
  const nodeVersion = lines.find((line) => /^Node\.js v/u.test(line));
  const first = typeError ?? lines[0] ?? "";

  return [first, nodeVersion].filter(Boolean).join(" ");
}

function noop(_line: string): void {}
