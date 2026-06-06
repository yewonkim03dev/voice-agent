import { resolve } from "node:path";
import { stdin, stderr, stdout } from "node:process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { RecorderCommandAudioInput } from "../audio/RecorderCommandAudioInput.ts";
import type { AudioFrame, AudioInput } from "../audio/AudioFrame.ts";
import { AlwaysOnWakeGate, type AlwaysOnWakeGateEvent } from "../listening/AlwaysOnWakeGate.ts";
import { EndOfSpeechDetector } from "../listening/EndOfSpeechDetector.ts";
import { ManualRecordingGate } from "../listening/ManualRecordingGate.ts";
import { RecordingController } from "../recorder/RecordingController.ts";
import { UtteranceRecorder } from "../recorder/UtteranceRecorder.ts";
import type { UtteranceAudio } from "../recorder/UtteranceAudio.ts";
import { CommandSpeechProcessor } from "../speech/CommandSpeechProcessor.ts";
import type { SpeechProcessor } from "../speech/SpeechProcessor.ts";
import { withTranscriptText, type Transcript } from "../speech/Transcript.ts";
import { BargeInPolicy } from "../voice/BargeInPolicy.ts";
import { EchoGuard, type EchoGuardResult } from "../voice/EchoGuard.ts";
import type { VisualProvider } from "../visual/VisualConfig.ts";
import { VisualBridge, type VisualBridgeLike } from "../visual/VisualBridge.ts";
import { launchVisualCompanion } from "../visual/run-visual.ts";
import { detectConfiguredWakePhrase, normalizedWakePhrases } from "../wake/WakePhraseRouter.ts";
import { createCodexThreadStore } from "./codex-thread-config.ts";
import { createTerminalHarnessFromArgs, parseHarnessCliArgs, TerminalHarness } from "./harness.ts";
import {
  defaultMaxUtteranceSeconds,
  VoiceLocalSettingsStore,
  resolveVoiceHarnessConfig,
  sanitizeMaxUtteranceSeconds,
  type VoiceHarnessConfig,
  type VoiceSettingsPersistence
} from "./voice-config.ts";

type WriteLine = (line: string) => void;
const wakeFollowUpWindowMs = 10_000;

export interface VoiceHarnessRunnerOptions {
  terminalHarness: TerminalHarness;
  gate: ManualRecordingGate;
  recordingController: RecordingController;
  speechProcessor: SpeechProcessor;
  visualBridge?: VisualBridgeLike;
  writeLine?: WriteLine;
  debug?: boolean;
}

export interface AlwaysOnVoiceHarnessRunnerOptions {
  terminalHarness: TerminalHarness;
  audioInput: AudioInput;
  wakeGate: AlwaysOnWakeGate;
  speechProcessor: SpeechProcessor;
  wakePhrases: string[];
  visualBridge?: VisualBridgeLike;
  settingsPersistence?: VoiceSettingsPersistence;
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
  private readonly debug: boolean;
  private readonly settingsPersistence: VoiceSettingsPersistence | undefined;
  private readonly textContext: SupplementalTextBuffer;
  private readonly pendingTranscripts = new Set<Promise<void>>();
  private started = false;

  constructor(options: VoiceHarnessRunnerOptions) {
    this.terminalHarness = options.terminalHarness;
    this.gate = options.gate;
    this.recordingController = options.recordingController;
    this.speechProcessor = options.speechProcessor;
    this.writeLine = options.writeLine ?? noop;
    this.debug = options.debug ?? false;
    this.settingsPersistence = options.settingsPersistence;
    this.textContext = new SupplementalTextBuffer(this.writeLine, (entries) =>
      sendVisualContextEvent(options.visualBridge, entries)
    );
    bindVisualContextControls(this.textContext, options.visualBridge);
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
    this.writeLine("  /add <text> queues additional info for the next voice transcript.");
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
    if (!text) return "continue";

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

    const addContext = parseAddContextCommand(text);

    if (addContext.matched) {
      this.textContext.queue(addContext.argument);
      return "continue";
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
      await this.terminalHarness.processTranscript(this.textContext.apply(transcript), {
        visualQuestionText: transcript.text
      });
    } catch (error) {
      this.writeLine(`[voice:error] ${formatError(error)}`);
    }
  }

  private printTranscript(transcript: Transcript): void {
    this.writeLine(`[stt:${transcript.language}] ${transcript.text}`);
  }

  private printAudioDiagnostics(audio: UtteranceAudio): void {
    if (!this.debug) return;

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
  private readonly defaultWakePhrases: string[];
  private wakePhrases: string[];
  private readonly writeLine: WriteLine;
  private readonly debug: boolean;
  private readonly echoGuard: EchoGuard;
  private readonly bargeInPolicy: BargeInPolicy;
  private readonly now: () => number;
  private readonly createId: (prefix: string) => string;
  private readonly manualRecorder: UtteranceRecorder;
  private readonly textContext: SupplementalTextBuffer;
  private readonly pendingTranscripts = new Set<Promise<void>>();
  private manualRecording = false;
  private candidateVisualState = false;
  private started = false;
  private lastVolumeEventAt = 0;
  private wakeFollowUp:
    | {
        phrase: string;
        armedAt: number;
        expiresAt: number;
      }
    | undefined;

  constructor(options: AlwaysOnVoiceHarnessRunnerOptions) {
    this.terminalHarness = options.terminalHarness;
    this.audioInput = options.audioInput;
    this.wakeGate = options.wakeGate;
    this.speechProcessor = options.speechProcessor;
    this.defaultWakePhrases = normalizedWakePhrases(options.wakePhrases);
    this.wakePhrases = [...this.defaultWakePhrases];
    this.writeLine = options.writeLine ?? noop;
    this.debug = options.debug ?? false;
    this.echoGuard = options.echoGuard ?? new EchoGuard();
    this.bargeInPolicy = options.bargeInPolicy ?? new BargeInPolicy();
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? ((prefix) => `${prefix}_${this.now()}`);
    this.textContext = new SupplementalTextBuffer(this.writeLine, (entries) =>
      sendVisualContextEvent(options.visualBridge, entries)
    );
    bindVisualContextControls(this.textContext, options.visualBridge);
    bindVisualWakeSettingsControls(this, options.visualBridge);
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
    this.sendVisualWakeSettings();
    await this.audioInput.start();
    this.started = true;
    this.writeLine("  Voice input: always-on wake listening enabled.");
    this.writeLine(`  Wake phrases: ${this.wakePhrases.join(", ")}`);
    this.writeLine("  Manual fallback: /record to start, /record again to stop.");
    this.writeLine("  /add <text> queues additional info for the next voice transcript.");
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
    if (!text) return "continue";

    if (text === "/record") {
      this.toggleManualRecording();
      return "continue";
    }

    if (text === "/quit") {
      await this.stop();
      this.writeLine("Harness stopped.");
      return "quit";
    }

    const addContext = parseAddContextCommand(text);

    if (addContext.matched) {
      this.textContext.queue(addContext.argument);
      return "continue";
    }

    return this.terminalHarness.processLine(line);
  }

  async drain(): Promise<void> {
    await Promise.all([...this.pendingTranscripts]);
  }

  private consumeFrame(frame: AudioFrame): void {
    this.emitFrameVolume(frame);

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

      if (source === "manual") {
        this.printTranscript(transcript);
        await this.terminalHarness.processTranscript(this.textContext.apply(transcript), {
          visualQuestionText: transcript.text
        });
        return;
      }

      if (this.shouldShowCandidateTranscript(transcript)) {
        this.printTranscript(transcript);
      }
      await this.routeCandidateTranscript(transcript);
    } catch (error) {
      const details = formatError(error);
      if (!this.shouldSuppressTranscriptionError(source, details)) {
        this.writeLine(`[voice:error] ${details}`);
      }
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

    const wake = detectConfiguredWakePhrase(transcript.text, this.wakePhrases);

    if (!wake && await this.tryRouteWakeFollowUp(transcript)) {
      return;
    }

    if (this.terminalHarness.ttsPlaybackState.isSpeakingOrRecent(this.now())) {
      await this.routeSpeakingTranscript(transcript);
      return;
    }

    if (!wake) {
      this.writeLine("[wake:discard] no configured wake phrase matched.");
      if (!this.terminalHarness.isAgentRequestActive()) {
        const visualText = formatWakeRejectedVisualText(this.wakePhrases);
        await this.terminalHarness.speakWakeRejected("wake 명령어를 확인해 주세요.", visualText);
      }
      return;
    }

    await this.routeWakeMatch(transcript, wake);
  }

  private async routeWakeMatch(
    transcript: Transcript,
    wake: {
      phrase: string;
      commandText: string;
    }
  ): Promise<void> {
    this.writeLine(`[wake:matched] phrase="${wake.phrase}" command="${wake.commandText}"`);
    if (wake.strategy === "normalized" && wake.heardText && wake.normalizedText) {
      this.writeLine(`[wake:normalized] heard="${wake.heardText}" normalized="${wake.normalizedText}"`);
    }
    if (wake.strategy === "fuzzy" && wake.heardText && wake.distance !== undefined) {
      this.writeLine(`[wake:fuzzy] heard="${wake.heardText}" matched="${wake.phrase}" distance=${wake.distance}`);
    }
    this.terminalHarness.sendVisualEvent({
      op: "voice-agent-ui",
      type: "wake",
      phrase: wake.phrase
    });

    if (!wake.commandText) {
      this.armWakeFollowUp(wake.phrase);
    } else {
      this.clearWakeFollowUp();
      if (this.terminalHarness.isAgentRequestActive()) {
        await this.terminalHarness.prepareForNewAgentTurn("New wake command requested");
      }
    }

    const routedTranscript = withTranscriptText(transcript, wake.commandText);
    await this.terminalHarness.processTranscript(wake.commandText ? this.textContext.apply(routedTranscript) : routedTranscript, {
      visualQuestionText: wake.commandText || transcript.text
    });
  }

  private async tryRouteWakeFollowUp(transcript: Transcript): Promise<boolean> {
    const followUp = this.activeWakeFollowUp();

    if (!followUp) return false;

    if (this.terminalHarness.ttsPlaybackState.isSpeakingOrRecent(this.now())) {
      const echo = this.echoGuard.evaluate(transcript.text, this.terminalHarness.ttsPlaybackState, this.now());

      if (echo.echo) {
        this.writeLine(`[echo:discarded] similarity=${formatSimilarity(echo)} strategy=${echo.strategy}`);
        return true;
      }
    }

    this.clearWakeFollowUp();
    if (this.terminalHarness.ttsPlaybackState.isSpeakingOrRecent(this.now())) {
      await this.terminalHarness.stopVoiceOutput();
    }
    this.writeLine(`[wake:followup] phrase="${followUp.phrase}" command="${transcript.text.trim()}"`);
    await this.terminalHarness.processTranscript(this.textContext.apply(transcript), {
      visualQuestionText: transcript.text
    });
    return true;
  }

  private armWakeFollowUp(phrase: string): void {
    const armedAt = this.now();
    this.wakeFollowUp = {
      phrase,
      armedAt,
      expiresAt: armedAt + wakeFollowUpWindowMs
    };
    this.writeLine(`[wake:armed] phrase="${phrase}" timeoutMs=${wakeFollowUpWindowMs}`);
  }

  private activeWakeFollowUp(): { phrase: string; armedAt: number; expiresAt: number } | undefined {
    if (!this.wakeFollowUp) return undefined;

    if (this.wakeFollowUp.expiresAt < this.now()) {
      this.writeLine(`[wake:followup] expired phrase="${this.wakeFollowUp.phrase}"`);
      this.clearWakeFollowUp();
      return undefined;
    }

    return this.wakeFollowUp;
  }

  private clearWakeFollowUp(): void {
    this.wakeFollowUp = undefined;
  }

  updateWakePhrases(wakePhrases: readonly string[], options: { persist?: boolean } = {}): void {
    this.wakePhrases = normalizedWakePhrases(wakePhrases);
    this.clearWakeFollowUp();
    this.writeLine(`  Wake phrases: ${this.wakePhrases.join(", ") || "(none)"}`);
    this.sendVisualWakeSettings();
    if (options.persist !== false) {
      void this.persistWakePhrases();
    }
  }

  resetWakePhrases(): void {
    this.updateWakePhrases(this.defaultWakePhrases, {
      persist: false
    });
  }

  updateMaxUtteranceSeconds(value: unknown): void {
    const seconds = sanitizeMaxUtteranceSeconds(value);
    this.wakeGate.setMaxUtteranceMs(seconds * 1000);
    if (this.debug) {
      this.writeLine(`[wake:settings] maxUtteranceSeconds=${seconds}`);
    }
  }

  resetMaxUtteranceSeconds(): void {
    this.updateMaxUtteranceSeconds(defaultMaxUtteranceSeconds);
  }

  private sendVisualWakeSettings(): void {
    this.terminalHarness.sendVisualEvent({
      op: "voice-agent-ui",
      type: "settings",
      wakePhrases: [...this.wakePhrases]
    });
  }

  private async persistWakePhrases(): Promise<void> {
    try {
      await this.settingsPersistence?.update({
        wakePhrases: [...this.wakePhrases]
      });
    } catch (error) {
      this.writeLine(`[settings:error] ${formatError(error)}`);
    }
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
        this.sendBargeIgnoredVisualState();
        return;
      case "stop":
        await this.terminalHarness.stopActiveTurn("Stop requested from wake speech");
        this.writeLine(`[barge:stop] phrase="${decision.wake.phrase}"`);
        return;
      case "command":
        await this.terminalHarness.prepareForNewAgentTurn("New wake command requested");
        this.writeLine(`[barge:command] phrase="${decision.wake.phrase}" command="${decision.commandText}"`);
        await this.terminalHarness.processTranscript(this.textContext.apply(withTranscriptText(transcript, decision.commandText)), {
          visualQuestionText: decision.commandText
        });
        return;
    }
  }

  private sendBargeIgnoredVisualState(): void {
    this.terminalHarness.restoreCurrentVisualState();
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
        this.candidateVisualState = this.shouldShowCandidateVisualState();
        if (this.candidateVisualState) this.sendListeningVisualState("listening");
        if (this.debug) {
          this.writeLine(
            `[wake:candidate] start preRollFrames=${event.preRollFrames} preRollBytes=${event.preRollBytes}`
          );
        }
        return;
      case "candidate_end":
        if (this.candidateVisualState) this.sendListeningVisualState("stt_processing");
        this.candidateVisualState = false;
        if (this.debug) {
          this.writeLine(
            `[wake:candidate] end reason=${event.reason} speechDurationMs=${event.speechDurationMs}`
          );
        }
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

  private sendListeningVisualState(state: "listening" | "stt_processing"): void {
    if (this.terminalHarness.ttsPlaybackState.isSpeaking()) {
      this.terminalHarness.sendVisualEvent({
        op: "voice-agent-ui",
        type: "state",
        state: "speaking"
      });
      return;
    }

    this.terminalHarness.sendVisualEvent({
      op: "voice-agent-ui",
      type: "state",
      state
    });
  }

  private shouldShowCandidateVisualState(): boolean {
    return Boolean(this.wakeFollowUp && this.wakeFollowUp.expiresAt >= this.now()) && !this.terminalHarness.isAgentRequestActive();
  }

  private shouldShowCandidateTranscript(transcript: Transcript): boolean {
    if (this.terminalHarness.hasPendingApproval()) return true;
    if (detectConfiguredWakePhrase(transcript.text, this.wakePhrases)) return true;
    if (this.wakeFollowUp && this.wakeFollowUp.expiresAt >= this.now()) return true;
    return !this.terminalHarness.isAgentRequestActive();
  }

  private shouldSuppressTranscriptionError(source: "candidate" | "manual", details: string): boolean {
    if (this.debug || source !== "candidate") return false;
    if (!this.terminalHarness.isAgentRequestActive()) return false;
    return /no transcript|no speech detected|produced no transcript/i.test(details);
  }

  private printTranscript(transcript: Transcript): void {
    this.terminalHarness.sendVisualEvent({
      op: "voice-agent-ui",
      type: "status",
      text: transcript.text
    });
    this.writeLine(`[stt:${transcript.language}] ${transcript.text}`);
  }

  private printAudioDiagnostics(audio: UtteranceAudio): void {
    if (!this.debug) return;

    const bytes = audio.data.byteLength;
    const durationMs = Math.max(0, audio.endedAt - audio.startedAt);
    const rms = audio.rms === undefined ? "n/a" : audio.rms.toFixed(4);
    const peak = audio.peak === undefined ? "n/a" : audio.peak.toFixed(4);

    this.writeLine(`[audio] bytes=${bytes} durationMs=${durationMs} rms=${rms} peak=${peak}`);
  }

  private emitFrameVolume(frame: AudioFrame): void {
    if (frame.timestamp - this.lastVolumeEventAt < 80) return;

    const metrics = pcm16Metrics(frame);
    if (!metrics) return;

    this.lastVolumeEventAt = frame.timestamp;
    this.terminalHarness.sendVisualEvent({
      op: "voice-agent-ui",
      type: "volume",
      rms: metrics.rms,
      peak: metrics.peak
    });
  }
}

export function createVoiceHarnessRunnerFromConfig(
  config: VoiceHarnessConfig,
  args: string[],
  options: {
    writeLine?: WriteLine;
    audioInput?: AudioInput;
    speechProcessor?: SpeechProcessor;
    visualBridge?: VisualBridgeLike;
    settingsPersistence?: VoiceSettingsPersistence;
    codexThreadId?: string;
    onExitRequest?: () => void | Promise<void>;
    now?: () => number;
    createId?: (prefix: string) => string;
    debug?: boolean;
  } = {}
): VoiceHarnessRunner {
  const writeLine = options.writeLine ?? noop;
  const harnessArgs = args.length === 0 ? ["--codex"] : args;
  const terminalHarness = createTerminalHarnessFromArgs(harnessArgs, {
    writeLine,
    now: options.now,
    createId: options.createId,
    ttsConfig: config.tts,
    visualConfig: config.visual,
    visualBridge: options.visualBridge,
    settingsPersistence: options.settingsPersistence,
    codexThreadId: options.codexThreadId,
    onExitRequest: options.onExitRequest
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
      createId: options.createId,
      diagnosticLine: options.debug ? writeLine : undefined
    });

  return new VoiceHarnessRunner({
    terminalHarness,
    gate,
    recordingController,
    speechProcessor,
    visualBridge: options.visualBridge,
    writeLine,
    debug: options.debug
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
    visualBridge?: VisualBridgeLike;
    settingsPersistence?: VoiceSettingsPersistence;
    codexThreadId?: string;
    onExitRequest?: () => void | Promise<void>;
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
    ttsConfig: config.tts,
    visualConfig: config.visual,
    visualBridge: options.visualBridge,
    settingsPersistence: options.settingsPersistence,
    codexThreadId: options.codexThreadId,
    onExitRequest: options.onExitRequest
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
      createId: options.createId,
      diagnosticLine: options.debug ? writeLine : undefined
    });

  return new AlwaysOnVoiceHarnessRunner({
    terminalHarness,
    audioInput,
    wakeGate:
      options.wakeGate ??
      new AlwaysOnWakeGate({
        now: options.now,
        createId: options.createId,
        detector: new EndOfSpeechDetector({
          maxUtteranceMs: sanitizeMaxUtteranceSeconds(config.visual?.maxUtteranceSeconds) * 1000
        })
      }),
    speechProcessor,
    wakePhrases: options.wakePhrases ?? config.wakePhrases,
    visualBridge: options.visualBridge,
    settingsPersistence: options.settingsPersistence,
    writeLine,
    debug: options.debug,
    now: options.now,
    createId: options.createId
  });
}

export interface VoiceHarnessCliOptions {
  alwaysOn: boolean;
  debug: boolean;
  visual: boolean;
  visualProvider?: VisualProvider;
  harnessArgs: string[];
}

export function parseVoiceHarnessCliArgs(args: string[]): VoiceHarnessCliOptions {
  const harnessArgs: string[] = [];
  let alwaysOn = false;
  let debug = false;
  let visual = false;
  let visualProvider: VisualProvider | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--always-on" || arg === "--wake") {
      alwaysOn = true;
      continue;
    }

    if (arg === "--debug") {
      debug = true;
      continue;
    }

    if (arg === "--visual") {
      visual = true;
      continue;
    }

    if (arg === "--visual-provider") {
      const value = args[++index] as VisualProvider | undefined;
      if (value === "auto" || value === "qtqml" || value === "macos-native") {
        visualProvider = value;
      }
      continue;
    }

    harnessArgs.push(arg);
  }

  return {
    alwaysOn,
    debug,
    visual,
    ...(visualProvider ? { visualProvider } : {}),
    harnessArgs
  };
}

export function shouldWriteDefaultVoiceHarnessLine(line: string): boolean {
  const visible = stripAnsi(line).trimStart();
  if (!visible.trim()) return true;

  if (visible.startsWith("[agent:")) return true;
  if (/^\[stt:(ko|en|mixed|unknown)\]/u.test(visible)) return true;
  if (/^\[voice:(ack|permission|completion|speech|status|error|warning)\]/u.test(visible)) return true;
  if (visible.startsWith("[voice:context]")) return true;
  if (visible.startsWith("[voice:capability]")) return true;
  if (visible.startsWith("[codex-app] config ")) return true;
  if (visible.startsWith("[harness")) return true;
  if (visible.startsWith("[status]")) return true;
  if (visible.startsWith("[tts]")) return true;
  if (visible.startsWith("[visual] unavailable")) return true;
  if (visible.startsWith("[voice]")) return true;
  if (visible === "Harness stopped.") return true;

  if (
    visible.includes("VOICE AGENT HARNESS READY") ||
    visible.startsWith("+---") ||
    visible.startsWith("|") ||
    visible.startsWith("backend:") ||
    visible.startsWith("mode:") ||
    visible.startsWith("agent:") ||
    visible.startsWith("Local layer ") ||
    visible.startsWith("Wake:") ||
    visible.startsWith("Plain text ") ||
    visible.startsWith("Approval:") ||
    visible.startsWith("Commands:") ||
    visible.startsWith("Voice input:") ||
    visible.startsWith("Wake phrases:") ||
    visible.startsWith("Manual fallback:") ||
    visible.startsWith("/add ") ||
    visible.startsWith("STT output ")
  ) {
    return true;
  }

  return false;
}

export async function runVoiceHarness(): Promise<void> {
  const cli = parseVoiceHarnessCliArgs(process.argv.slice(2));
  const rawWriteLine = (line: string): void => {
    stdout.write(`${line}\n`);
  };
  const writeLine = cli.debug
    ? rawWriteLine
    : (line: string): void => {
        if (shouldWriteDefaultVoiceHarnessLine(line)) rawWriteLine(line);
      };
  const resolution = await resolveVoiceHarnessConfig();

  if (!resolution.config) {
    resolution.errors.forEach((error) => writeLine(`[voice:capability] ${error}`));
    process.exitCode = 1;
    return;
  }

  const args = defaultCodexArgs(cli.harnessArgs);
  const visualBridge = cli.visual ? new VisualBridge({ writeLine }) : undefined;
  const settingsPersistence = new VoiceLocalSettingsStore();
  const codexThreadId = await loadCodexThreadIdForVisual(writeLine, parseHarnessCliArgs(args).cwd);
  let shutdownRequested = false;
  let readline: ReturnType<typeof createInterface> | undefined;
  const requestShutdown = (): void => {
    shutdownRequested = true;
    if (readline) closeReadline(readline);
  };

  if (visualBridge) {
    try {
      const url = await visualBridge.start();
      await launchVisualCompanion({
        url,
        provider: cli.visualProvider,
        writeLine
      });
    } catch (error) {
      writeLine(`[visual] unavailable: ${formatError(error)}`);
    }
  }
  const runner = cli.alwaysOn
    ? createAlwaysOnVoiceHarnessRunnerFromConfig(resolution.config, args, {
        writeLine,
        debug: cli.debug,
        visualBridge,
        settingsPersistence,
        codexThreadId,
        onExitRequest: requestShutdown
      })
    : createVoiceHarnessRunnerFromConfig(resolution.config, args, {
        writeLine,
        debug: cli.debug,
        visualBridge,
        settingsPersistence,
        codexThreadId,
        onExitRequest: requestShutdown
      });

  await runner.start();
  readline = createInterface({
    input: stdin,
    output: stdout,
    prompt: "> "
  });
  if (shutdownRequested) closeReadline(readline);
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
    await visualBridge?.stop();
  }
}

function stripAnsi(text: string): string {
  return text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/gu, "");
}

function defaultCodexArgs(args: string[]): string[] {
  if (args.some((arg) => arg === "--codex" || arg === "--real" || arg === "--mock" || arg === "--claude")) {
    return args;
  }

  return ["--codex", ...args];
}

async function loadCodexThreadIdForVisual(writeLine: WriteLine, cwd: string): Promise<string | undefined> {
  try {
    return await createCodexThreadStore({ cwd }).load();
  } catch (error) {
    writeLine(`[settings:error] ${formatError(error)}`);
    return undefined;
  }
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

type SupplementalTextChange = (entries: string[]) => void;

class SupplementalTextBuffer {
  private readonly writeLine: WriteLine;
  private readonly onChange: SupplementalTextChange;
  private readonly entries: string[] = [];

  constructor(writeLine: WriteLine, onChange: SupplementalTextChange = noopContextChange) {
    this.writeLine = writeLine;
    this.onChange = onChange;
  }

  queue(text: string): void {
    if (!text) {
      this.writeLine("[voice:context] usage: /add <text>");
      return;
    }

    this.entries.push(text);
    this.writeLine(`[voice:context] queued ${this.entries.length} item(s).`);
    this.emitChange();
  }

  clear(): void {
    if (this.entries.length === 0) {
      this.writeLine("[voice:context] already empty.");
      this.emitChange();
      return;
    }

    const count = this.entries.splice(0).length;
    this.writeLine(`[voice:context] cleared ${count} item(s).`);
    this.emitChange();
  }

  apply(transcript: Transcript): Transcript {
    if (this.entries.length === 0) return transcript;

    const entries = this.entries.splice(0);
    this.writeLine(`[voice:context] applied ${entries.length} item(s).`);
    this.emitChange();
    return withTranscriptText(transcript, appendSupplementalText(transcript.text, entries));
  }

  private emitChange(): void {
    this.onChange([...this.entries]);
  }
}

function bindVisualContextControls(textContext: SupplementalTextBuffer, visualBridge: VisualBridgeLike | undefined): void {
  visualBridge?.onControl((event) => {
    if (event.action === "add_context") {
      const text = (event.text ?? "").trim();
      const addContext = parseAddContextCommand(text);
      textContext.queue(addContext.matched ? addContext.argument : text);
      return;
    }

    if (event.action === "clear_context") {
      textContext.clear();
    }
  });
}

function bindVisualWakeSettingsControls(
  runner: Pick<AlwaysOnVoiceHarnessRunner, "updateWakePhrases" | "resetWakePhrases" | "updateMaxUtteranceSeconds" | "resetMaxUtteranceSeconds">,
  visualBridge: VisualBridgeLike | undefined
): void {
  visualBridge?.onControl((event) => {
    if (event.action === "update_wake_phrases") {
      runner.updateWakePhrases(event.wakePhrases ?? []);
      return;
    }

    if (event.action === "reset_settings") {
      runner.resetWakePhrases();
      runner.resetMaxUtteranceSeconds();
      return;
    }

    if (event.action === "update_visual_settings" && event.visual?.maxUtteranceSeconds !== undefined) {
      runner.updateMaxUtteranceSeconds(event.visual.maxUtteranceSeconds);
    }
  });
}

function sendVisualContextEvent(visualBridge: VisualBridgeLike | undefined, entries: string[]): void {
  visualBridge?.send({
    op: "voice-agent-ui",
    type: "context",
    entries
  });
}

function noopContextChange(_entries: string[]): void {}

function appendSupplementalText(text: string, entries: string[]): string {
  const base = text.trim();
  const context = entries.map((entry) => `- ${entry}`).join("\n");

  return `${base}\n\n추가 정보:\n${context}`;
}

function formatWakeRejectedVisualText(wakePhrases: string[]): string {
  const phrases = [...new Set(wakePhrases.map((phrase) => phrase.trim()).filter(Boolean))];
  const phraseText = phrases.length > 0 ? phrases.join(" / ") : "설정된 wake 명령어 없음";

  return `wake 명령어를 확인해 주세요.\n유효한 wake 명령어:\n${phraseText}`;
}

function parseAddContextCommand(text: string): { matched: boolean; argument: string } {
  const match = text.match(/^\/add(?:\s+([\s\S]*))?$/u);

  if (!match) {
    return {
      matched: false,
      argument: ""
    };
  }

  return {
    matched: true,
    argument: (match[1] ?? "").trim()
  };
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatSimilarity(result: EchoGuardResult): string {
  return result.similarity.toFixed(3);
}

function pcm16Metrics(frame: AudioFrame): { rms: number; peak: number } | null {
  if (frame.format !== "pcm_s16le") return null;

  const data = Buffer.from(frame.data);
  if (data.byteLength < 2) return null;

  let sumSquares = 0;
  let peak = 0;
  let samples = 0;

  for (let offset = 0; offset + 1 < data.byteLength; offset += 2) {
    const value = data.readInt16LE(offset) / 32768;
    const magnitude = Math.abs(value);
    sumSquares += value * value;
    peak = Math.max(peak, magnitude);
    samples += 1;
  }

  return {
    rms: samples === 0 ? 0 : Math.sqrt(sumSquares / samples),
    peak
  };
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
