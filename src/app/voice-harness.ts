import { resolve } from "node:path";
import { stdin, stderr, stdout } from "node:process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { RecorderCommandAudioInput } from "../audio/RecorderCommandAudioInput.ts";
import type { AudioInput } from "../audio/AudioFrame.ts";
import { ManualRecordingGate } from "../listening/ManualRecordingGate.ts";
import { RecordingController } from "../recorder/RecordingController.ts";
import { UtteranceRecorder } from "../recorder/UtteranceRecorder.ts";
import type { UtteranceAudio } from "../recorder/UtteranceAudio.ts";
import { CommandSpeechProcessor } from "../speech/CommandSpeechProcessor.ts";
import type { SpeechProcessor } from "../speech/SpeechProcessor.ts";
import type { Transcript } from "../speech/Transcript.ts";
import { createTerminalHarnessFromArgs, TerminalHarness } from "./harness.ts";
import { resolveVoiceHarnessConfig, type VoiceHarnessConfig } from "./voice-config.ts";

type WriteLine = (line: string) => void;

export interface VoiceHarnessRunnerOptions {
  terminalHarness: TerminalHarness;
  gate: ManualRecordingGate;
  recordingController: RecordingController;
  speechProcessor: SpeechProcessor;
  writeLine?: WriteLine;
}

export class VoiceHarnessRunner {
  readonly terminalHarness: TerminalHarness;
  readonly gate: ManualRecordingGate;

  private readonly recordingController: RecordingController;
  private readonly speechProcessor: SpeechProcessor;
  private readonly writeLine: WriteLine;
  private readonly pendingTranscripts = new Set<Promise<void>>();
  private started = false;

  constructor(options: VoiceHarnessRunnerOptions) {
    this.terminalHarness = options.terminalHarness;
    this.gate = options.gate;
    this.recordingController = options.recordingController;
    this.speechProcessor = options.speechProcessor;
    this.writeLine = options.writeLine ?? noop;
    this.recordingController.onUtterance((audio) => {
      const task = this.transcribeAndRoute(audio).finally(() => {
        this.pendingTranscripts.delete(task);
      });
      this.pendingTranscripts.add(task);
    });
  }

  async start(): Promise<void> {
    if (this.started) return;

    await this.terminalHarness.start();
    await this.recordingController.start();
    this.started = true;
    this.writeLine("  Voice input: /record to start, /record again to stop.");
    this.writeLine("  STT output is printed as [stt:<language>] before routing.");
  }

  async stop(): Promise<void> {
    if (!this.started) return;

    await this.recordingController.stop();
    await this.drain();
    await this.terminalHarness.stop();
    this.started = false;
  }

  async processLine(line: string): Promise<"continue" | "quit"> {
    const text = line.trim();

    if (text === "/record") {
      this.gate.toggle();
      await this.recordingController.drain();
      this.writeLine(this.gate.isOpen ? "[voice] recording started. Type /record to stop." : "[voice] recording stopped.");
      return "continue";
    }

    if (text === "/quit") {
      await this.stop();
      this.writeLine("Harness stopped.");
      return "quit";
    }

    return this.terminalHarness.processLine(line);
  }

  async drain(): Promise<void> {
    await Promise.all([...this.pendingTranscripts]);
  }

  private async transcribeAndRoute(audio: UtteranceAudio): Promise<void> {
    try {
      this.printAudioDiagnostics(audio);
      const transcript = await this.speechProcessor.transcribe(audio);
      this.printTranscript(transcript);
      await this.terminalHarness.processTranscript(transcript);
    } catch (error) {
      this.writeLine(`[voice:error] ${formatError(error)}`);
    }
  }

  private printTranscript(transcript: Transcript): void {
    this.writeLine(`[stt:${transcript.language}] ${transcript.text}`);
  }

  private printAudioDiagnostics(audio: UtteranceAudio): void {
    const bytes = audio.data.byteLength;
    const durationMs = Math.max(0, audio.endedAt - audio.startedAt);
    const rms = audio.rms === undefined ? "n/a" : audio.rms.toFixed(4);
    const peak = audio.peak === undefined ? "n/a" : audio.peak.toFixed(4);

    this.writeLine(`[audio] bytes=${bytes} durationMs=${durationMs} rms=${rms} peak=${peak}`);
  }
}

export function createVoiceHarnessRunnerFromConfig(
  config: VoiceHarnessConfig,
  args: string[],
  options: {
    writeLine?: WriteLine;
    audioInput?: AudioInput;
    speechProcessor?: SpeechProcessor;
    now?: () => number;
    createId?: (prefix: string) => string;
  } = {}
): VoiceHarnessRunner {
  const writeLine = options.writeLine ?? noop;
  const harnessArgs = args.length === 0 ? ["--codex"] : args;
  const terminalHarness = createTerminalHarnessFromArgs(harnessArgs, {
    writeLine,
    now: options.now,
    createId: options.createId
  });
  const gate = new ManualRecordingGate({
    now: options.now
  });
  const audioInput =
    options.audioInput ??
    new RecorderCommandAudioInput({
      command: config.recorderCommand,
      sampleRate: config.sampleRate,
      channels: config.channels,
      now: options.now
    });
  const recordingController = new RecordingController({
    gate,
    audioInput,
    recorder: new UtteranceRecorder({
      now: options.now,
      createId: options.createId
    }),
    now: options.now,
    createId: options.createId
  });
  const speechProcessor =
    options.speechProcessor ??
    new CommandSpeechProcessor({
      commandTemplate: config.sttCommand,
      now: options.now,
      createId: options.createId
    });

  return new VoiceHarnessRunner({
    terminalHarness,
    gate,
    recordingController,
    speechProcessor,
    writeLine
  });
}

export async function runVoiceHarness(): Promise<void> {
  const writeLine = (line: string): void => {
    stdout.write(`${line}\n`);
  };
  const resolution = await resolveVoiceHarnessConfig();

  if (!resolution.config) {
    resolution.errors.forEach((error) => writeLine(`[voice:capability] ${error}`));
    process.exitCode = 1;
    return;
  }

  const runner = createVoiceHarnessRunnerFromConfig(resolution.config, defaultCodexArgs(process.argv.slice(2)), {
    writeLine
  });

  await runner.start();
  const readline = createInterface({
    input: stdin,
    output: stdout,
    prompt: "> "
  });
  promptIfOpen(readline);

  try {
    for await (const line of readline) {
      try {
        const result = await runner.processLine(line);
        if (result === "quit") break;
      } catch (error) {
        writeLine(`[harness:error] ${formatError(error)}`);
      }

      promptIfOpen(readline);
    }
  } finally {
    closeReadline(readline);
    await runner.stop();
  }
}

function defaultCodexArgs(args: string[]): string[] {
  if (args.some((arg) => arg === "--codex" || arg === "--real" || arg === "--mock" || arg === "--claude")) {
    return args;
  }

  return ["--codex", ...args];
}

function promptIfOpen(readline: ReturnType<typeof createInterface>): void {
  try {
    readline.prompt();
  } catch (error) {
    if (!isReadlineClosedError(error)) throw error;
  }
}

function closeReadline(readline: ReturnType<typeof createInterface>): void {
  try {
    readline.close();
  } catch (error) {
    if (!isReadlineClosedError(error)) throw error;
  }
}

function isReadlineClosedError(error: unknown): boolean {
  return error instanceof Error && /readline was closed/i.test(error.message);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function noop(_line: string): void {}

function isDirectEntrypoint(): boolean {
  if (!process.argv[1]) return false;
  return fileURLToPath(import.meta.url) === resolve(process.argv[1]);
}

if (isDirectEntrypoint()) {
  runVoiceHarness().catch((error: unknown) => {
    stderr.write(`[harness:fatal] ${formatError(error)}\n`);
    process.exitCode = 1;
  });
}
