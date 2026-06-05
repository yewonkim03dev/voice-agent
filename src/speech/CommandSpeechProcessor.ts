import { spawn, type SpawnOptionsWithoutStdio } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { encodePcmS16leWav } from "../audio/WavEncoder.ts";
import type { UtteranceAudio } from "../recorder/UtteranceAudio.ts";
import { normalizeTranscriptText, type Language, type Transcript } from "./Transcript.ts";
import type { SpeechProcessor } from "./SpeechProcessor.ts";

interface ProcessReadable {
  on(event: "data", callback: (chunk: Buffer | string) => void): unknown;
}

interface SpeechProcess {
  stdout: ProcessReadable;
  stderr: ProcessReadable;
  on(event: "error", callback: (error: Error) => void): unknown;
  on(event: "exit", callback: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
}

export type SpawnSpeechProcess = (
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio
) => SpeechProcess;

export interface CommandSpeechProcessorOptions {
  commandTemplate: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
  now?: () => number;
  createId?: (prefix: string) => string;
  spawnProcess?: SpawnSpeechProcess;
}

export class CommandSpeechProcessor implements SpeechProcessor {
  private readonly commandTemplate: string;
  private readonly cwd: string;
  private readonly env: Record<string, string | undefined>;
  private readonly now: () => number;
  private readonly createId: (prefix: string) => string;
  private readonly spawnProcess: SpawnSpeechProcess;

  constructor(options: CommandSpeechProcessorOptions) {
    this.commandTemplate = options.commandTemplate;
    this.cwd = options.cwd ?? process.cwd();
    this.env = {
      ...process.env,
      ...options.env
    };
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? ((prefix) => `${prefix}_${this.now()}`);
    this.spawnProcess = options.spawnProcess ?? spawn;
  }

  async transcribe(audio: UtteranceAudio): Promise<Transcript> {
    if (audio.format && audio.format !== "pcm_s16le") {
      throw new Error(`CommandSpeechProcessor only supports pcm_s16le audio, got ${audio.format}.`);
    }

    const dir = await mkdtemp(join(tmpdir(), "voice-agent-stt-"));
    const audioPath = join(dir, `${audio.id}.wav`);

    try {
      await writeFile(audioPath, encodePcmS16leWav(audio));
      const result = await this.runCommand(audioPath);
      return this.createTranscript(audio, result);
    } finally {
      await rm(dir, {
        force: true,
        recursive: true
      });
    }
  }

  private runCommand(audioPath: string): Promise<string> {
    const command = this.commandTemplate.replaceAll("{audio}", shellQuote(audioPath));

    return new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      const child = this.spawnProcess(command, [], {
        cwd: this.cwd,
        env: this.env,
        shell: true
      });

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
        for (const line of chunk.toString().split(/\r?\n/)) {
          const trimmed = line.trim();
          if (trimmed.startsWith("[stt:")) {
            console.error(trimmed);
          }
        }
      });
      child.on("error", (error) => {
        reject(new Error(`STT command failed to start: ${error.message}`));
      });
      child.on("exit", (code, signal) => {
        if (code === 0) {
          resolve(stdout.trim());
          return;
        }

        const reason = signal ? `STT command exited from ${signal}.` : `STT command exited with code ${code ?? 0}.`;
        const details = nonDiagnosticStderr(stderr);
        reject(new Error(details ? `${reason} ${details}` : reason));
      });
    });
  }

  private createTranscript(audio: UtteranceAudio, output: string): Transcript {
    const parsed = parseSttOutput(output);
    const text = parsed.text;
    const normalizedText = normalizeTranscriptText(text);

    if (!text) {
      throw new Error("STT command produced empty transcript text.");
    }

    return {
      id: this.createId("tr"),
      sessionId: audio.sessionId,
      text,
      normalizedText,
      language: parsed.language ?? detectLanguage(normalizedText),
      confidence: parsed.confidence ?? 0.99,
      startedAt: audio.startedAt,
      endedAt: audio.endedAt
    };
  }
}

function parseSttOutput(output: string): { text: string; language?: Language; confidence?: number } {
  try {
    const parsed = JSON.parse(output) as {
      text?: unknown;
      language?: unknown;
      confidence?: unknown;
    };

    if (typeof parsed.text === "string") {
      return {
        text: parsed.text.trim(),
        language: isLanguage(parsed.language) ? parsed.language : undefined,
        confidence: typeof parsed.confidence === "number" ? parsed.confidence : undefined
      };
    }
  } catch {
    // Plain stdout is the fallback format for simple local STT commands.
  }

  return {
    text: output.trim()
  };
}

function detectLanguage(text: string): Language {
  const hasKorean = /[ㄱ-ㅎㅏ-ㅣ가-힣]/u.test(text);
  const hasLatin = /[a-z]/i.test(text);

  if (hasKorean && hasLatin) return "mixed";
  if (hasKorean) return "ko";
  if (hasLatin) return "en";
  return "unknown";
}

function isLanguage(value: unknown): value is Language {
  return value === "ko" || value === "en" || value === "mixed" || value === "unknown";
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function nonDiagnosticStderr(stderr: string): string {
  return stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("[stt:"))
    .join("\n")
    .trim();
}
