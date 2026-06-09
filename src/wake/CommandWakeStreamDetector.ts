import { spawn, type SpawnOptionsWithoutStdio } from "node:child_process";

import type { AudioFrame } from "../audio/AudioFrame.ts";
import { detectConfiguredWakePhrase, normalizedWakePhrases } from "./WakePhraseRouter.ts";
import type { WakeStreamCallback, WakeStreamDetector, WakeStreamEvent } from "./WakeStreamDetector.ts";

interface ProcessReadable {
  on(event: "data", callback: (chunk: Buffer | string) => void): unknown;
}

interface ProcessWritable {
  write(chunk: Buffer): boolean;
  end(): void;
  on(event: "error", callback: (error: Error) => void): unknown;
}

interface WakeStreamProcess {
  stdin: ProcessWritable;
  stdout: ProcessReadable;
  stderr: ProcessReadable;
  kill(signal?: NodeJS.Signals): boolean;
  on(event: "error", callback: (error: Error) => void): unknown;
  on(event: "exit", callback: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
}

export type SpawnWakeStreamProcess = (
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio
) => WakeStreamProcess;

export interface CommandWakeStreamDetectorOptions {
  command: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
  provider?: string;
  wakePhrases?: readonly string[];
  spawnProcess?: SpawnWakeStreamProcess;
  diagnosticLine?: (line: string) => void;
  now?: () => number;
}

interface WakePartialResult {
  text: string;
  confidence?: number;
  provider?: string;
}

export class CommandWakeStreamDetector implements WakeStreamDetector {
  private readonly command: string;
  private readonly cwd: string;
  private readonly env: Record<string, string | undefined>;
  private readonly provider: string;
  private readonly spawnProcess: SpawnWakeStreamProcess;
  private readonly diagnosticLine: ((line: string) => void) | undefined;
  private readonly now: () => number;
  private readonly callbacks: WakeStreamCallback[] = [];
  private wakePhrases: string[];
  private child: WakeStreamProcess | undefined;
  private stdoutBuffer = "";
  private emitted = false;

  constructor(options: CommandWakeStreamDetectorOptions) {
    this.command = options.command;
    this.cwd = options.cwd ?? process.cwd();
    this.env = {
      ...process.env,
      ...options.env
    };
    this.provider = options.provider ?? "command-partial";
    this.wakePhrases = normalizedWakePhrases(options.wakePhrases ?? []);
    this.spawnProcess = options.spawnProcess ?? spawn;
    this.diagnosticLine = options.diagnosticLine;
    this.now = options.now ?? Date.now;
  }

  consume(frame: AudioFrame): void {
    if (frame.format !== "pcm_s16le") return;

    const child = this.ensureStarted();
    if (!child) return;

    child.stdin.write(Buffer.from(frame.data));
  }

  reset(): void {
    this.emitted = false;
  }

  onWake(callback: WakeStreamCallback): void {
    this.callbacks.push(callback);
  }

  updateWakePhrases(wakePhrases: readonly string[]): void {
    this.wakePhrases = normalizedWakePhrases(wakePhrases);
    this.reset();
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (!child) return;

    child.stdin.end();
    child.kill("SIGTERM");
    this.child = undefined;
  }

  private ensureStarted(): WakeStreamProcess | undefined {
    if (this.child) return this.child;

    try {
      const child = this.spawnProcess(this.command, [], {
        cwd: this.cwd,
        env: this.env,
        shell: true
      });
      this.child = child;
      child.stdout.on("data", (chunk) => this.handleStdout(chunk.toString()));
      child.stderr.on("data", (chunk) => this.handleDiagnostics(chunk.toString()));
      child.stdin.on("error", (error) => this.diagnosticLine?.(`[wake:stream] stdin_error ${error.message}`));
      child.on("error", (error) => {
        this.diagnosticLine?.(`[wake:stream] process_error ${error.message}`);
        this.child = undefined;
      });
      child.on("exit", (code, signal) => {
        if (code && !signal) {
          this.diagnosticLine?.(`[wake:stream] process_exit code=${code}`);
        }
        this.child = undefined;
        this.stdoutBuffer = "";
      });
      return child;
    } catch (error) {
      this.diagnosticLine?.(`[wake:stream] start_error ${formatError(error)}`);
      return undefined;
    }
  }

  private handleStdout(chunk: string): void {
    this.stdoutBuffer += chunk;

    while (true) {
      const lineEnd = this.stdoutBuffer.indexOf("\n");
      if (lineEnd === -1) return;

      const line = this.stdoutBuffer.slice(0, lineEnd).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(lineEnd + 1);
      if (!line) continue;

      this.handlePartialLine(line);
    }
  }

  private handlePartialLine(line: string): void {
    const partial = parsePartialLine(line);
    if (!partial) {
      this.diagnosticLine?.(`[wake:stream] ignored_partial ${line}`);
      return;
    }

    this.handlePartial(partial);
  }

  private handlePartial(partial: WakePartialResult): void {
    if (this.emitted) return;

    const wake = detectConfiguredWakePhrase(partial.text, this.wakePhrases);
    if (!wake) return;

    this.emitted = true;
    const event: WakeStreamEvent = {
      phrase: wake.phrase,
      text: partial.text,
      provider: partial.provider ?? this.provider,
      timestamp: this.now(),
      strategy: wake.strategy ?? "exact",
      ...(partial.confidence !== undefined ? { confidence: partial.confidence } : {})
    };

    this.callbacks.forEach((callback) => callback(event));
  }

  private handleDiagnostics(chunk: string): void {
    for (const line of chunk.split(/\r?\n/u)) {
      const trimmed = line.trim();
      if (trimmed) this.diagnosticLine?.(trimmed);
    }
  }
}

function parsePartialLine(line: string): WakePartialResult | null {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    if (typeof parsed.text !== "string" || !parsed.text.trim()) return null;

    return {
      text: parsed.text.trim(),
      ...(typeof parsed.confidence === "number" ? { confidence: parsed.confidence } : {}),
      ...(typeof parsed.provider === "string" && parsed.provider.trim()
        ? { provider: parsed.provider.trim() }
        : {})
    };
  } catch {
    const text = line.trim();
    return text ? { text } : null;
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
