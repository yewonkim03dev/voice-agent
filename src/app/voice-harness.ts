import { resolve } from "node:path";
import { stdin, stderr, stdout } from "node:process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { RecorderCommandAudioInput } from "../audio/RecorderCommandAudioInput.ts";
import type { AudioFrame, AudioInput } from "../audio/AudioFrame.ts";
import { AlwaysOnWakeGate, type AlwaysOnWakeGateEvent } from "../listening/AlwaysOnWakeGate.ts";
import { ManualRecordingGate } from "../listening/ManualRecordingGate.ts";
import { RecordingController } from "../recorder/RecordingController.ts";
import { UtteranceRecorder } from "../recorder/UtteranceRecorder.ts";
import type { UtteranceAudio } from "../recorder/UtteranceAudio.ts";
import { CommandSpeechProcessor } from "../speech/CommandSpeechProcessor.ts";
import type { SpeechProcessor } from "../speech/SpeechProcessor.ts";
import { withTranscriptText, type Transcript } from "../speech/Transcript.ts";
import { BargeInPolicy } from "../voice/BargeInPolicy.ts";
import { EchoGuard, type EchoGuardResult } from "../voice/EchoGuard.ts";
import { detectConfiguredWakePhrase, normalizedWakePhrases } from "../wake/WakePhraseRouter.ts";
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

export interface AlwaysOnVoiceHarnessRunnerOptions {
  terminalHarness: TerminalHarness;
  audioInput: AudioInput;
  wakeGate: AlwaysOnWakeGate;
  speechProcessor: SpeechProcessor;
  wakePhrases: string[];
  writeLine?: WriteLine;
  debug?: boolean;
  echoGuard?: EchoGuard;
  bargeInPolicy?: BargeInPolicy;
  now?: () => number;
  createId?: (prefix: string) => string;
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
      if (this.gate.isOpen) {
        await this.terminalHarness.stopVoiceOutput();
      }
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

export class AlwaysOnVoiceHarnessRunner {
  readonly terminalHarness: TerminalHarness;

  private readonly audioInput: AudioInput;
  private readonly wakeGate: AlwaysOnWakeGate;
  private readonly speechProcessor: SpeechProcessor;
  private readonly wakePhrases: string[];
  private readonly writeLine: WriteLine;
  private readonly debug: boolean;
  private readonly echoGuard: EchoGuard;
  private readonly bargeInPolicy: BargeInPolicy;
  private readonly now: () => number;
  private readonly createId: (prefix: string) => string;
  private readonly manualRecorder: UtteranceRecorder;
  private readonly pendingTranscripts = new Set<Promise<void>>();
  private manualRecording = false;
  private started = false;

  constructor(options: AlwaysOnVoiceHarnessRunnerOptions) {
    this.terminalHarness = options.terminalHarness;
    this.audioInput = options.audioInput;
    this.wakeGate = options.wakeGate;
    this.speechProcessor = options.speechProcessor;
    this.wakePhrases = normalizedWakePhrases(options.wakePhrases);
    this.writeLine = options.writeLine ?? noop;
    this.debug = options.debug ?? false;
    this.echoGuard = options.echoGuard ?? new EchoGuard();
    this.bargeInPolicy = options.bargeInPolicy ?? new BargeInPolicy();
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? ((prefix) => `${prefix}_${this.now()}`);
    this.manualRecorder = new UtteranceRecorder({
      now: this.now,
      createId: this.createId
    });
    this.audioInput.onFrame((frame) => this.consumeFrame(frame));
    this.wakeGate.onUtterance((audio) => this.queueTranscription(audio, "candidate"));
    this.wakeGate.onEvent((event) => this.printWakeEvent(event));
  }

  async start(): Promise<void> {
    if (this.started) return;

    await this.terminalHarness.start();
    await this.audioInput.start();
    this.started = true;
    this.writeLine("  Voice input: always-on wake listening enabled.");
    this.writeLine(`  Wake phrases: ${this.wakePhrases.join(", ")}`);
    this.writeLine("  Manual fallback: /record to start, /record again to stop.");
    this.writeLine("  STT output is printed as [stt:<language>] before routing.");
  }

  async stop(): Promise<void> {
    if (!this.started) return;

    if (this.manualRecording) {
      this.finishManualRecording();
    } else {
      this.wakeGate.flush();
    }

    await this.audioInput.stop();
    await this.drain();
    await this.terminalHarness.stop();
    this.started = false;
  }

  async processLine(line: string): Promise<"continue" | "quit"> {
    const text = line.trim();

    if (text === "/record") {
      this.toggleManualRecording();
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

  private consumeFrame(frame: AudioFrame): void {
    if (this.manualRecording) {
      this.manualRecorder.consume(frame);
      return;
    }

    this.wakeGate.consume(frame);
  }

  private toggleManualRecording(): void {
    if (this.manualRecording) {
      this.finishManualRecording();
      this.writeLine("[voice] recording stopped.");
      return;
    }

    this.wakeGate.reset();
    void this.terminalHarness.stopVoiceOutput();
    this.manualRecorder.begin(this.createId("voice_sess"), {
      mode: "manual",
      timestamp: this.now()
    });
    this.manualRecording = true;
    this.writeLine("[voice] recording started. Type /record to stop.");
  }

  private finishManualRecording(): void {
    if (!this.manualRecording) return;

    const audio = this.manualRecorder.finish();
    this.manualRecording = false;
    this.queueTranscription(audio, "manual");
  }

  private queueTranscription(audio: UtteranceAudio, source: "candidate" | "manual"): void {
    const task = this.transcribeAndRoute(audio, source).finally(() => {
      this.pendingTranscripts.delete(task);
    });
    this.pendingTranscripts.add(task);
  }

  private async transcribeAndRoute(audio: UtteranceAudio, source: "candidate" | "manual"): Promise<void> {
    try {
      this.printAudioDiagnostics(audio);
      const transcript = await this.speechProcessor.transcribe(audio);
      this.printTranscript(transcript);

      if (source === "manual") {
        await this.terminalHarness.processTranscript(transcript);
        return;
      }

      await this.routeCandidateTranscript(transcript);
    } catch (error) {
      this.writeLine(`[voice:error] ${formatError(error)}`);
    } finally {
      this.releaseAudio(audio, source);
    }
  }

  private async routeCandidateTranscript(transcript: Transcript): Promise<void> {
    if (this.terminalHarness.hasPendingApproval()) {
      this.writeLine("[wake:approval] pending native approval; routing speech without wake phrase.");
      await this.terminalHarness.processTranscript(transcript);
      return;
    }

    if (this.terminalHarness.ttsPlaybackState.isSpeakingOrRecent(this.now())) {
      await this.routeSpeakingTranscript(transcript);
      return;
    }

    const wake = detectConfiguredWakePhrase(transcript.text, this.wakePhrases);

    if (!wake) {
      this.writeLine("[wake:discard] no configured wake phrase matched.");
      return;
    }

    this.writeLine(`[wake:matched] phrase="${wake.phrase}" command="${wake.commandText}"`);
    await this.terminalHarness.processTranscript(withTranscriptText(transcript, wake.commandText));
  }

  private async routeSpeakingTranscript(transcript: Transcript): Promise<void> {
    const echo = this.echoGuard.evaluate(transcript.text, this.terminalHarness.ttsPlaybackState, this.now());

    if (echo.echo) {
      this.writeLine(`[echo:discarded] similarity=${formatSimilarity(echo)} strategy=${echo.strategy}`);
      return;
    }

    const decision = this.bargeInPolicy.decide(transcript.text, this.wakePhrases);

    switch (decision.action) {
      case "ignore":
        this.writeLine(`[barge:ignored] reason=${decision.reason}`);
        return;
      case "stop":
        await this.terminalHarness.stopVoiceOutput();
        this.writeLine(`[barge:stop] phrase="${decision.wake.phrase}"`);
        return;
      case "command":
        await this.terminalHarness.stopVoiceOutput();
        this.writeLine(`[barge:command] phrase="${decision.wake.phrase}" command="${decision.commandText}"`);
        await this.terminalHarness.processTranscript(withTranscriptText(transcript, decision.commandText));
        return;
    }
  }

  private releaseAudio(audio: UtteranceAudio, source: "candidate" | "manual"): void {
    const releasedBytes = audio.data.byteLength;
    audio.data = new ArrayBuffer(0);
    audio.vadSegments.length = 0;

    if (this.debug) {
      this.writeLine(`[voice:debug] released ${source} utterance bytes=${releasedBytes}`);
    }
  }

  private printWakeEvent(event: AlwaysOnWakeGateEvent): void {
    switch (event.type) {
      case "candidate_start":
        this.writeLine(
          `[wake:candidate] start preRollFrames=${event.preRollFrames} preRollBytes=${event.preRollBytes}`
        );
        return;
      case "candidate_end":
        this.writeLine(
          `[wake:candidate] end reason=${event.reason} speechDurationMs=${event.speechDurationMs}`
        );
        return;
      case "buffer_cleanup":
        if (this.debug) {
          this.writeLine(
            `[wake:debug] cleanup source=${event.source} releasedBytes=${event.releasedBytes}`
          );
        }
        return;
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
    createId: options.createId,
    ttsConfig: config.tts
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

export function createAlwaysOnVoiceHarnessRunnerFromConfig(
  config: VoiceHarnessConfig,
  args: string[],
  options: {
    writeLine?: WriteLine;
    audioInput?: AudioInput;
    speechProcessor?: SpeechProcessor;
    wakeGate?: AlwaysOnWakeGate;
    wakePhrases?: string[];
    debug?: boolean;
    now?: () => number;
    createId?: (prefix: string) => string;
  } = {}
): AlwaysOnVoiceHarnessRunner {
  const writeLine = options.writeLine ?? noop;
  const harnessArgs = args.length === 0 ? ["--codex"] : args;
  const terminalHarness = createTerminalHarnessFromArgs(harnessArgs, {
    writeLine,
    now: options.now,
    createId: options.createId,
    ttsConfig: config.tts
  });
  const audioInput =
    options.audioInput ??
    new RecorderCommandAudioInput({
      command: config.recorderCommand,
      sampleRate: config.sampleRate,
      channels: config.channels,
      now: options.now
    });
  const speechProcessor =
    options.speechProcessor ??
    new CommandSpeechProcessor({
      commandTemplate: config.sttCommand,
      now: options.now,
      createId: options.createId
    });

  return new AlwaysOnVoiceHarnessRunner({
    terminalHarness,
    audioInput,
    wakeGate:
      options.wakeGate ??
      new AlwaysOnWakeGate({
        now: options.now,
        createId: options.createId
      }),
    speechProcessor,
    wakePhrases: options.wakePhrases ?? config.wakePhrases,
    writeLine,
    debug: options.debug,
    now: options.now,
    createId: options.createId
  });
}

export interface VoiceHarnessCliOptions {
  alwaysOn: boolean;
  debug: boolean;
  harnessArgs: string[];
}

export function parseVoiceHarnessCliArgs(args: string[]): VoiceHarnessCliOptions {
  const harnessArgs: string[] = [];
  let alwaysOn = false;
  let debug = false;

  for (const arg of args) {
    if (arg === "--always-on" || arg === "--wake") {
      alwaysOn = true;
      continue;
    }

    if (arg === "--debug") {
      debug = true;
      continue;
    }

    harnessArgs.push(arg);
  }

  return {
    alwaysOn,
    debug,
    harnessArgs
  };
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

  const cli = parseVoiceHarnessCliArgs(process.argv.slice(2));
  const args = defaultCodexArgs(cli.harnessArgs);
  const runner = cli.alwaysOn
    ? createAlwaysOnVoiceHarnessRunnerFromConfig(resolution.config, args, {
        writeLine,
        debug: cli.debug
      })
    : createVoiceHarnessRunnerFromConfig(resolution.config, args, {
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

function formatSimilarity(result: EchoGuardResult): string {
  return result.similarity.toFixed(3);
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
