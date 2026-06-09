import { resolve } from "node:path";
import { stdin, stderr, stdout } from "node:process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { RecorderCommandAudioInput } from "../audio/RecorderCommandAudioInput.ts";
import type { AudioFrame, AudioInput, AudioInputStatus, AudioInputStatusEvent } from "../audio/AudioFrame.ts";
import {
  NoopCameraGestureWatcher,
  StaticCameraPermissionManager,
  type CameraGestureWatcher,
  type CameraPermissionManager,
  type CameraPermissionStatus,
  type GestureWatcherObservation,
  type GestureWatcherStatus
} from "../gesture/CameraGestureWatcher.ts";
import { CommandCameraPermissionManager } from "../gesture/CommandCameraPermissionManager.ts";
import { CommandHandLandmarkProvider } from "../gesture/CommandHandLandmarkProvider.ts";
import { GestureActionStateMachine, type GestureTrigger } from "../gesture/GestureActionStateMachine.ts";
import {
  customGestureNameFromLabel,
  gestureWakeConfigForRuntime,
  isCustomGestureName,
  sanitizeGestureWakeConfig,
  type CustomGestureTemplate,
  type GestureCameraMode,
  type GestureWakeFileConfig,
  type GestureRuntimeState,
  type GestureWakeConfig
} from "../gesture/GestureWakeConfig.ts";
import { LandmarkCameraGestureWatcher } from "../gesture/LandmarkCameraGestureWatcher.ts";
import { AlwaysOnWakeGate, type AlwaysOnWakeGateEvent } from "../listening/AlwaysOnWakeGate.ts";
import { EndOfSpeechDetector } from "../listening/EndOfSpeechDetector.ts";
import { ManualRecordingGate } from "../listening/ManualRecordingGate.ts";
import { RecordingController } from "../recorder/RecordingController.ts";
import { UtteranceRecorder } from "../recorder/UtteranceRecorder.ts";
import type { UtteranceAudio } from "../recorder/UtteranceAudio.ts";
import { CommandSpeechProcessor } from "../speech/CommandSpeechProcessor.ts";
import type { SpeechProcessor } from "../speech/SpeechProcessor.ts";
import { detectTranscriptLanguage, normalizeTranscriptText, withTranscriptText, type Transcript } from "../speech/Transcript.ts";
import { BargeInPolicy } from "../voice/BargeInPolicy.ts";
import { EchoGuard, type EchoGuardResult } from "../voice/EchoGuard.ts";
import type { VisualProvider } from "../visual/VisualConfig.ts";
import { VisualBridge, type VisualBridgeLike } from "../visual/VisualBridge.ts";
import { launchVisualCompanion } from "../visual/run-visual.ts";
import { createWakeStreamDetectorFromConfig } from "../wake/createWakeStreamDetector.ts";
import { NoopWakeStreamDetector, type WakeStreamDetector, type WakeStreamEvent } from "../wake/WakeStreamDetector.ts";
import { detectConfiguredWakePhrase, normalizedWakePhrases } from "../wake/WakePhraseRouter.ts";
import { readCodexThreadSettings } from "./codex-thread-config.ts";
import { createTerminalHarnessFromArgs, parseHarnessCliArgs, TerminalHarness } from "./harness.ts";
import {
  defaultVoiceConfigPath,
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
  settingsPersistence?: VoiceSettingsPersistence;
  writeLine?: WriteLine;
  debug?: boolean;
}

export interface AlwaysOnVoiceHarnessRunnerOptions {
  terminalHarness: TerminalHarness;
  audioInput: AudioInput;
  wakeGate: AlwaysOnWakeGate;
  wakeStreamDetector?: WakeStreamDetector;
  speechProcessor: SpeechProcessor;
  wakePhrases: string[];
  visualBridge?: VisualBridgeLike;
  settingsPersistence?: VoiceSettingsPersistence;
  writeLine?: WriteLine;
  debug?: boolean;
  echoGuard?: EchoGuard;
  bargeInPolicy?: BargeInPolicy;
  gestureWake?: GestureWakeConfig;
  cameraGestureEnabled?: boolean;
  cameraGestureWatcher?: CameraGestureWatcher;
  cameraPermissionManager?: CameraPermissionManager;
  now?: () => number;
  createId?: (prefix: string) => string;
  wakeFollowUpWindowMs?: number;
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
    bindVisualDirectGoControls((text) => this.routeDirectText(text), options.visualBridge);
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
    this.writeLine("  /help shows available terminal commands.");
    this.writeLine("  /add <text> queues additional info for the next voice transcript.");
    this.writeLine("  /refs lists queued additional info.");
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

    if (isHelpCommand(text)) {
      this.printHelp();
      return "continue";
    }

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

    if (isShowContextCommand(text)) {
      this.textContext.show();
      return "continue";
    }

    return this.terminalHarness.processLine(line);
  }

  async drain(): Promise<void> {
    await Promise.all([...this.pendingTranscripts]);
  }

  private printHelp(): void {
    this.writeLine("Commands:");
    this.writeLine("  /help shows this command list.");
    this.writeLine("  /record starts or stops manual recording.");
    this.writeLine("  /add <text> queues additional info for the next voice transcript.");
    this.writeLine("  /refs lists queued additional info.");
    this.writeLine("  /status shows the current agent status.");
    this.writeLine("  /tts-stop stops current TTS playback.");
    this.writeLine("  /quit exits Voice Agent.");
  }

  private async routeDirectText(text: string): Promise<void> {
    const trimmed = text.trim();
    const directText = trimmed || directTextFromContextEntries(this.textContext.takeEntries());

    if (!directText) {
      this.writeLine("[voice:direct] usage: enter text to send.");
      return;
    }

    const transcript = createDirectTranscript(directText);
    const applied = trimmed ? this.textContext.applyWithEntries(transcript) : { transcript, entries: [] };
    await this.terminalHarness.processTranscript(applied.transcript, {
      visualQuestionText: directText,
      visualQuestionReferences: applied.entries
    });
  }

  private async transcribeAndRoute(audio: UtteranceAudio): Promise<void> {
    try {
      this.printAudioDiagnostics(audio);
      const transcript = await this.speechProcessor.transcribe(audio);
      this.printTranscript(transcript);
      const applied = this.textContext.applyWithEntries(transcript);
      await this.terminalHarness.processTranscript(applied.transcript, {
        visualQuestionText: transcript.text,
        visualQuestionReferences: applied.entries
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
  private readonly wakeStreamDetector: WakeStreamDetector;
  private readonly speechProcessor: SpeechProcessor;
  private readonly defaultWakePhrases: string[];
  private wakePhrases: string[];
  private readonly writeLine: WriteLine;
  private readonly debug: boolean;
  private readonly settingsPersistence: VoiceSettingsPersistence | undefined;
  private readonly echoGuard: EchoGuard;
  private readonly bargeInPolicy: BargeInPolicy;
  private readonly now: () => number;
  private readonly createId: (prefix: string) => string;
  private readonly wakeFollowUpWindowMs: number;
  private readonly manualRecorder: UtteranceRecorder;
  private readonly textContext: SupplementalTextBuffer;
  private readonly cameraGestureEnabledByCli: boolean;
  private gestureWake: GestureWakeConfig;
  private readonly cameraGestureWatcher: CameraGestureWatcher;
  private readonly cameraPermissionManager: CameraPermissionManager;
  private gestureStateMachine: GestureActionStateMachine;
  private readonly pendingTranscripts = new Set<Promise<void>>();
  private readonly pendingSettingsWrites = new Set<Promise<void>>();
  private readonly pendingCameraTasks = new Set<Promise<void>>();
  private manualRecording = false;
  private micEnabled = true;
  private candidateVisualState = false;
  private provisionalWake: WakeStreamEvent | undefined;
  private recentProvisionalWakeCue: WakeStreamEvent | undefined;
  private audioInputStatus: AudioInputStatus = "running";
  private audioRecoveryActive = false;
  private cameraGestureActive = false;
  private cameraGestureSuspended = false;
  private cameraSettingsGeneration = 0;
  private cameraDiagnosticUntil = 0;
  private lastCameraDiagnosticAt = 0;
  private cameraDiagnosticObservations = 0;
  private lastCameraStatusLine = "";
  private started = false;
  private lastVolumeEventAt = 0;
  private wakeFollowUp:
    | {
        phrase: string;
        armedAt: number;
        expiresAt: number;
        inputStarted: boolean;
      }
    | undefined;
  private wakeFollowUpTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: AlwaysOnVoiceHarnessRunnerOptions) {
    this.terminalHarness = options.terminalHarness;
    this.audioInput = options.audioInput;
    this.wakeGate = options.wakeGate;
    this.wakeStreamDetector = options.wakeStreamDetector ?? new NoopWakeStreamDetector();
    this.speechProcessor = options.speechProcessor;
    this.defaultWakePhrases = normalizedWakePhrases(options.wakePhrases);
    this.wakePhrases = [...this.defaultWakePhrases];
    this.writeLine = options.writeLine ?? noop;
    this.debug = options.debug ?? false;
    this.settingsPersistence = options.settingsPersistence;
    this.echoGuard = options.echoGuard ?? new EchoGuard();
    this.bargeInPolicy = options.bargeInPolicy ?? new BargeInPolicy();
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? ((prefix) => `${prefix}_${this.now()}`);
    this.wakeFollowUpWindowMs = options.wakeFollowUpWindowMs ?? wakeFollowUpWindowMs;
    this.cameraGestureEnabledByCli = options.cameraGestureEnabled === true;
    this.gestureWake = gestureWakeConfigForRuntime(options.gestureWake, this.cameraGestureEnabledByCli);
    this.cameraGestureWatcher = options.cameraGestureWatcher ?? createDefaultCameraGestureWatcher();
    this.cameraPermissionManager = options.cameraPermissionManager ?? createDefaultCameraPermissionManager();
    this.gestureStateMachine = new GestureActionStateMachine({
      config: this.gestureWake,
      now: this.now
    });
    this.textContext = new SupplementalTextBuffer(this.writeLine, (entries) =>
      sendVisualContextEvent(options.visualBridge, entries)
    );
    bindVisualContextControls(this.textContext, options.visualBridge);
    bindVisualDirectGoControls((text) => this.routeDirectText(text), options.visualBridge);
    bindVisualWakeSettingsControls(this, options.visualBridge);
    this.manualRecorder = new UtteranceRecorder({
      now: this.now,
      createId: this.createId
    });
    this.audioInput.onFrame((frame) => this.consumeFrame(frame));
    this.audioInput.onStatus?.((event) => this.handleAudioInputStatus(event));
    this.wakeStreamDetector.onWake((event) => this.handleProvisionalWake(event));
    this.terminalHarness.onAgentActivityChange(() => {
      this.refreshGestureRuntimeState();
    });
    this.cameraGestureWatcher.onGesture((event) => {
      void this.handleGestureObservation(event);
    });
    this.cameraGestureWatcher.onStatus((event) => this.handleCameraStatus(event));
    this.wakeStreamDetector.updateWakePhrases?.(this.wakePhrases);
    this.wakeGate.onUtterance((audio) => this.queueTranscription(audio, "candidate"));
    this.wakeGate.onEvent((event) => this.printWakeEvent(event));
  }

  async start(): Promise<void> {
    if (this.started) return;

    await this.terminalHarness.start();
    this.sendVisualWakeSettings();
    this.sendVisualMicSettings();
    this.sendVisualGestureSettings();
    await this.audioInput.start();
    await this.startCameraGestureIfEnabled();
    this.started = true;
    this.writeLine("  Voice input: always-on wake listening enabled.");
    this.writeLine(`  Wake phrases: ${this.wakePhrases.join(", ")}`);
    this.writeLine("  Manual fallback: /record to start, /record again to stop.");
    this.writeLine("  /help shows available terminal commands.");
    this.writeLine("  /mic toggles microphone listening on/off.");
    this.writeLine("  /mic-reconnect rebuilds or restarts microphone input.");
    this.writeLine("  /cam toggles camera gesture wake on/off.");
    this.writeLine("  /cam-test shows camera gesture test steps and current status.");
    this.writeLine("  /gesture-add <name> captures a custom camera gesture template.");
    this.writeLine("  /gesture-reset clears local gesture mappings and custom templates.");
    this.writeLine("  /add <text> queues additional info for the next voice transcript.");
    this.writeLine("  /refs lists queued additional info.");
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
    await this.wakeStreamDetector.stop?.();
    this.cameraGestureActive = false;
    await this.cameraGestureWatcher.stop();
    await this.drain();
    await this.drainSettingsWrites();
    this.clearWakeFollowUp();
    await this.terminalHarness.stop();
    this.started = false;
  }

  async processLine(line: string): Promise<"continue" | "quit"> {
    const text = line.trim();
    if (!text) return "continue";

    if (isHelpCommand(text)) {
      this.printHelp();
      return "continue";
    }

    if (text === "/record") {
      this.toggleManualRecording();
      return "continue";
    }

    if (isMicToggleCommand(text)) {
      this.toggleMicInput();
      return "continue";
    }

    if (isMicReconnectCommand(text)) {
      await this.reconnectAudioInput("manual command");
      return "continue";
    }

    if (isCameraToggleCommand(text)) {
      await this.toggleCameraGestureInput();
      return "continue";
    }

    if (isCameraTestCommand(text)) {
      await this.printCameraGestureTest();
      return "continue";
    }

    const gestureCapture = parseGestureCaptureCommand(text);
    if (gestureCapture.matched) {
      await this.captureCustomGestureTemplate(gestureCapture.argument);
      return "continue";
    }

    const gestureDelete = parseGestureDeleteCommand(text);
    if (gestureDelete.matched) {
      this.deleteCustomGestureTemplate(gestureDelete.argument);
      return "continue";
    }

    if (isCustomGestureClearCommand(text)) {
      this.clearCustomGestureTemplates();
      return "continue";
    }

    if (isGestureResetCommand(text)) {
      this.resetGestureWakeSettings();
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

    if (isShowContextCommand(text)) {
      this.textContext.show();
      return "continue";
    }

    return this.terminalHarness.processLine(line);
  }

  async drain(): Promise<void> {
    await Promise.all([...this.pendingTranscripts]);
    await this.drainCameraTasks();
    await this.drainSettingsWrites();
  }

  private printHelp(): void {
    this.writeLine("Commands:");
    this.writeLine("  /help shows this command list.");
    this.writeLine("  /record starts or stops manual recording.");
    this.writeLine("  /mic toggles microphone listening on/off.");
    this.writeLine("  /mic-reconnect rebuilds or restarts microphone input.");
    this.writeLine("  /cam toggles camera gesture wake on/off.");
    this.writeLine("  /cam-test shows camera gesture test steps and current status.");
    this.writeLine("  /gesture-add <name> captures a custom camera gesture template.");
    this.writeLine("  /gesture-delete <name> deletes one custom camera gesture template.");
    this.writeLine("  /gesture-clear-custom deletes all custom camera gesture templates.");
    this.writeLine("  /gesture-reset clears local gesture mappings and custom templates.");
    this.writeLine("  /add <text> queues additional info for the next voice transcript.");
    this.writeLine("  /refs lists queued additional info.");
    this.writeLine("  /status shows the current agent status.");
    this.writeLine("  /tts-stop stops current TTS playback.");
    this.writeLine("  /quit exits Voice Agent.");
  }

  private async printCameraGestureTest(): Promise<void> {
    this.refreshGestureRuntimeState();
    this.cameraDiagnosticUntil = this.now() + 15_000;
    this.lastCameraDiagnosticAt = 0;
    this.cameraDiagnosticObservations = 0;
    this.writeLine(
      `[camera:test] cli=${this.cameraGestureEnabledByCli} enabled=${this.gestureWake.enabled} active=${this.cameraGestureActive} mode=${this.gestureStateMachine.getCameraMode()} wake=${this.gestureWake.bindings.wake} stop=${this.gestureWake.bindings.stop} holdMs=${this.gestureWake.holdMs} cooldownMs=${this.gestureWake.cooldownMs} runningMode=${this.gestureWake.runningMode}`
    );
    this.writeLine("[camera:test] macOS should show the camera-in-use indicator only after the hand landmark provider reports that the camera session started.");

    if (!this.cameraGestureEnabledByCli) {
      this.writeLine("[camera:test] restart Voice Agent with --cam to enable camera gesture wake.");
      return;
    }

    const permission = this.cameraGestureActive ? "authorized" : await this.cameraPermissionManager.requestPermission();
    this.writeLine(`[camera:test] permission=${permission}`);
    if (permission !== "authorized") {
      this.writeLine(`[camera:test] ${cameraPermissionGuidance(permission)}`);
      return;
    }

    if (!this.cameraGestureActive) {
      this.writeLine("[camera:test] camera permission is authorized, but the watcher is not active; restart with --cam and check startup logs.");
      return;
    }

    this.writeLine(
      `[camera:test] hold ${this.gestureWake.bindings.wake} for at least ${this.gestureWake.holdMs}ms; HUD should enter listening.`
    );
    this.writeLine(
      `[camera:test] while listening, hold ${this.gestureWake.bindings.stop} for at least ${this.gestureWake.holdMs}ms; HUD should return to idle.`
    );
    this.writeLine("[camera:test] while approval is pending, hold the configured approval gesture to answer through the approval bridge.");
    this.writeLine("[camera:test] live observation logging is enabled for 15s. If no [camera:observe] lines appear, the camera helper is not producing hand landmark frames.");
  }

  private consumeFrame(frame: AudioFrame): void {
    if (!this.micEnabled) return;

    this.emitFrameVolume(frame);

    if (this.manualRecording) {
      this.manualRecorder.consume(frame);
      return;
    }

    this.wakeGate.consume(frame);
    this.wakeStreamDetector.consume(frame);
  }

  private toggleManualRecording(): void {
    if (!this.micEnabled) {
      this.writeLine("[voice:mic] microphone is off. Type /mic to turn it on.");
      this.sendVisualMicSettings();
      return;
    }

    if (this.manualRecording) {
      this.finishManualRecording();
      this.writeLine("[voice] recording stopped.");
      return;
    }

    this.wakeGate.reset();
    this.wakeStreamDetector.reset();
    this.provisionalWake = undefined;
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
    const provisionalWake = source === "candidate" ? this.provisionalWake : undefined;
    const task = this.transcribeAndRoute(audio, source, provisionalWake).finally(() => {
      this.pendingTranscripts.delete(task);
    });
    this.pendingTranscripts.add(task);
  }

  private async transcribeAndRoute(
    audio: UtteranceAudio,
    source: "candidate" | "manual",
    provisionalWake?: WakeStreamEvent
  ): Promise<void> {
    try {
      this.printAudioDiagnostics(audio);
      const transcript = await this.speechProcessor.transcribe(audio);

      if (source === "manual") {
        this.printTranscript(transcript);
        const applied = this.textContext.applyWithEntries(transcript);
        await this.processTranscriptAndRefreshGestureState(applied.transcript, {
          visualQuestionText: transcript.text,
          visualQuestionReferences: applied.entries
        });
        return;
      }

      if (this.shouldShowCandidateTranscript(transcript)) {
        this.printTranscript(transcript);
      }
      await this.routeCandidateTranscript(transcript, provisionalWake);
    } catch (error) {
      const details = formatError(error);
      if (source === "candidate") {
        this.cancelWakeFollowUpCandidate(details);
      }
      if (!this.shouldSuppressTranscriptionError(source, details)) {
        this.writeLine(`[voice:error] ${details}`);
      }
    } finally {
      this.releaseAudio(audio, source);
    }
  }

  private async routeCandidateTranscript(transcript: Transcript, provisionalWake?: WakeStreamEvent): Promise<void> {
    if (this.terminalHarness.hasPendingApproval()) {
      this.writeLine("[wake:approval] pending native approval; routing speech without wake phrase.");
      await this.processTranscriptAndRefreshGestureState(transcript);
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
      if (provisionalWake) {
        this.writeLine(`[wake:stream] false_positive phrase="${provisionalWake.phrase}" text="${transcript.text.trim()}"`);
        this.recentProvisionalWakeCue = undefined;
        this.terminalHarness.sendVisualEvent({
          op: "voice-agent-ui",
          type: "state",
          state: "idle"
        });
        return;
      }

      this.writeLine("[wake:discard] no configured wake phrase matched.");
      if (!this.terminalHarness.isAgentRequestActive()) {
        const visualText = formatWakeRejectedVisualText(this.wakePhrases);
        await this.terminalHarness.speakWakeRejected("wake 명령어를 확인해 주세요.", visualText);
      }
      return;
    }

    const suppressWakeCue =
      provisionalWake !== undefined ||
      (this.recentProvisionalWakeCue !== undefined && this.recentProvisionalWakeCue.phrase === wake.phrase);
    this.recentProvisionalWakeCue = undefined;
    await this.routeWakeMatch(transcript, wake, {
      suppressWakeCue
    });
  }

  private async routeWakeMatch(
    transcript: Transcript,
    wake: {
      phrase: string;
      commandText: string;
    },
    options: { suppressWakeCue?: boolean } = {}
  ): Promise<void> {
    this.writeLine(`[wake:matched] phrase="${wake.phrase}" command="${wake.commandText}"`);
    if (wake.strategy === "normalized" && wake.heardText && wake.normalizedText) {
      this.writeLine(`[wake:normalized] heard="${wake.heardText}" normalized="${wake.normalizedText}"`);
    }
    if (wake.strategy === "fuzzy" && wake.heardText && wake.distance !== undefined) {
      this.writeLine(`[wake:fuzzy] heard="${wake.heardText}" matched="${wake.phrase}" distance=${wake.distance}`);
    }
    if (options.suppressWakeCue !== true) {
      this.terminalHarness.sendVisualEvent({
        op: "voice-agent-ui",
        type: "wake",
        phrase: wake.phrase
      });
    }

    if (!wake.commandText) {
      this.armWakeFollowUp(wake.phrase);
    } else {
      this.clearWakeFollowUp();
      if (this.terminalHarness.isAgentRequestActive()) {
        await this.terminalHarness.prepareForNewAgentTurn("New wake command requested");
      }
    }

    const routedTranscript = withTranscriptText(transcript, wake.commandText);
    const applied = wake.commandText
      ? this.textContext.applyWithEntries(routedTranscript)
      : { transcript: routedTranscript, entries: [] };
    await this.processTranscriptAndRefreshGestureState(applied.transcript, {
      visualQuestionText: wake.commandText || transcript.text,
      visualQuestionReferences: applied.entries
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
    const applied = this.textContext.applyWithEntries(transcript);
    await this.processTranscriptAndRefreshGestureState(applied.transcript, {
      visualQuestionText: transcript.text,
      visualQuestionReferences: applied.entries
    });
    return true;
  }

  private armWakeFollowUp(phrase: string): void {
    const armedAt = this.now();
    this.clearWakeFollowUp();
    this.wakeFollowUp = {
      phrase,
      armedAt,
      expiresAt: armedAt + this.wakeFollowUpWindowMs,
      inputStarted: false
    };
    this.wakeFollowUpTimer = setTimeout(() => {
      this.expireWakeFollowUp(phrase);
    }, this.wakeFollowUpWindowMs);
    this.writeLine(`[wake:armed] phrase="${phrase}" timeoutMs=${this.wakeFollowUpWindowMs}`);
  }

  private activeWakeFollowUp(): { phrase: string; armedAt: number; expiresAt: number; inputStarted: boolean } | undefined {
    if (!this.wakeFollowUp) return undefined;

    if (!this.wakeFollowUp.inputStarted && this.wakeFollowUp.expiresAt < this.now()) {
      this.expireWakeFollowUp(this.wakeFollowUp.phrase);
      return undefined;
    }

    return this.wakeFollowUp;
  }

  private captureWakeFollowUpCandidate(): boolean {
    const followUp = this.activeWakeFollowUp();
    if (!followUp) return false;

    followUp.inputStarted = true;
    this.clearWakeFollowUpTimer();
    return true;
  }

  private expireWakeFollowUp(phrase: string): void {
    const followUp = this.wakeFollowUp;
    if (!followUp || followUp.phrase !== phrase || followUp.inputStarted) return;

    this.writeLine(`[wake:followup] expired phrase="${followUp.phrase}"`);
    this.clearWakeFollowUp();
    if (!this.terminalHarness.hasPendingApproval() && !this.terminalHarness.isAgentRequestActive()) {
      this.terminalHarness.sendVisualEvent({
        op: "voice-agent-ui",
        type: "state",
        state: "idle"
      });
    }
  }

  private cancelWakeFollowUpCandidate(reason: string): void {
    const followUp = this.wakeFollowUp;
    if (!followUp?.inputStarted) return;

    this.writeLine(`[wake:followup] canceled phrase="${followUp.phrase}" reason="${compactLogText(reason)}"`);
    this.clearWakeFollowUp();
    if (!this.terminalHarness.hasPendingApproval() && !this.terminalHarness.isAgentRequestActive()) {
      this.terminalHarness.sendVisualEvent({
        op: "voice-agent-ui",
        type: "state",
        state: "idle"
      });
    }
  }

  private clearWakeFollowUp(): void {
    this.clearWakeFollowUpTimer();
    this.wakeFollowUp = undefined;
  }

  private clearWakeFollowUpTimer(): void {
    if (!this.wakeFollowUpTimer) return;
    clearTimeout(this.wakeFollowUpTimer);
    this.wakeFollowUpTimer = undefined;
  }

  toggleMicInput(enabled = !this.micEnabled): void {
    if (this.micEnabled === enabled) {
      this.sendVisualMicSettings();
      return;
    }

    this.micEnabled = enabled;
    if (!enabled) {
      if (this.manualRecording) {
        this.manualRecorder.cancel("mic disabled");
        this.manualRecording = false;
      }
      this.wakeGate.reset();
      this.wakeStreamDetector.reset();
      this.provisionalWake = undefined;
      this.recentProvisionalWakeCue = undefined;
      this.candidateVisualState = false;
      this.clearWakeFollowUp();
    }

    this.terminalHarness.sendVisualEvent({
      op: "voice-agent-ui",
      type: "state",
      state: "idle",
      text: enabled ? "microphone on" : "microphone off"
    });
    this.writeLine(`[voice:mic] ${enabled ? "on" : "off"}`);
    this.sendVisualMicSettings();

    if (enabled && shouldReconnectAudioInput(this.audioInputStatus)) {
      void this.reconnectAudioInput("mic enabled");
    }
  }

  async toggleCameraGestureInput(enabled = this.cameraGestureSuspended || !this.cameraGestureActive): Promise<void> {
    if (!this.cameraGestureEnabledByCli) {
      this.cameraGestureSuspended = true;
      this.writeLine("[camera:toggle] restart Voice Agent with --cam to enable camera gestures.");
      this.sendVisualCameraStatus("off", "camera gesture wake unavailable without --cam");
      return;
    }

    if (!enabled) {
      this.cameraGestureSuspended = true;
      this.cameraGestureActive = false;
      await this.cameraGestureWatcher.stop();
      this.gestureStateMachine.setState("idle");
      this.writeLine("[camera:toggle] off");
      this.sendVisualCameraStatus("off", "camera gesture wake off");
      return;
    }

    this.cameraGestureSuspended = false;
    this.writeLine("[camera:toggle] on");
    if (!this.cameraGestureActive) {
      await this.startCameraGestureIfEnabled();
      return;
    }

    this.refreshGestureRuntimeState();
  }

  private async reconnectAudioInput(reason: string): Promise<void> {
    this.writeLine(`[audio:reconnect] ${reason}`);
    this.terminalHarness.sendVisualEvent({
      op: "voice-agent-ui",
      type: "state",
      state: "idle",
      text: "audio reconnecting"
    });
    await this.audioInput.reconnect?.();
  }

  private handleAudioInputStatus(event: AudioInputStatusEvent): void {
    this.audioInputStatus = event.status;
    const suffix = event.message ? ` ${event.message}` : "";
    this.writeLine(`[audio:status] ${event.status}${suffix}`);

    switch (event.status) {
      case "reconfiguring":
        this.audioRecoveryActive = true;
        this.sendAudioRecoveryVisualState("audio reconnecting");
        return;
      case "waiting_device":
        this.audioRecoveryActive = true;
        this.sendAudioRecoveryVisualState("waiting for microphone");
        return;
      case "failed":
      case "restarting":
        this.audioRecoveryActive = true;
        this.sendAudioRecoveryVisualState("audio input restarting");
        return;
      case "restarted":
      case "running":
        if (this.audioRecoveryActive) {
          this.audioRecoveryActive = false;
          this.sendAudioRecoveryVisualState("audio ready");
        }
        return;
      case "starting":
      case "stopped":
        return;
    }
  }

  private sendAudioRecoveryVisualState(text: string): void {
    this.terminalHarness.sendVisualEvent({
      op: "voice-agent-ui",
      type: "state",
      state: "idle",
      text
    });
  }

  private async startCameraGestureIfEnabled(): Promise<void> {
    this.sendVisualCameraStatus(
      "off",
      this.isCameraGestureRuntimeEnabled() ? "camera gesture wake pending" : "camera gesture wake off"
    );
    if (!this.isCameraGestureRuntimeEnabled()) return;

    const permission = await this.cameraPermissionManager.requestPermission();
    if (permission !== "authorized") {
      this.cameraGestureActive = false;
      this.writeLine(`[camera:permission] ${permission}`);
      this.sendVisualCameraStatus("off", cameraPermissionGuidance(permission));
      return;
    }

    await this.cameraGestureWatcher.start(this.gestureWake);
    this.cameraGestureActive = true;
    this.refreshGestureRuntimeState();
  }

  private handleCameraStatus(status: GestureWatcherStatus): void {
    const text = status.text ? ` text="${status.text}"` : "";
    const line = `[camera:status] enabled=${status.enabled} mode=${status.mode}${text}`;
    if (line !== this.lastCameraStatusLine) {
      this.lastCameraStatusLine = line;
      this.writeLine(line);
    }
    this.sendVisualCameraStatus(status.mode, status.text);
  }

  private async handleGestureObservation(observation: GestureWatcherObservation): Promise<void> {
    if (!this.isCameraGestureRuntimeEnabled() || !this.cameraGestureActive) return;
    this.refreshGestureRuntimeState();

    const trigger = this.gestureStateMachine.observe(observation);
    this.printCameraObservationDiagnostic(observation, trigger);
    if (!trigger) return;

    this.writeLine(`[camera:gesture] action=${trigger.action} gesture=${trigger.gesture} state=${trigger.state}`);

    switch (trigger.action) {
      case "wake":
        this.handleGestureWake(trigger);
        return;
      case "stop":
        await this.handleGestureStop(trigger);
        return;
      case "approval.once":
      case "approval.deny":
      case "approval.session":
      case "approval.policy":
        await this.handleGestureApproval(trigger);
        return;
    }
  }

  private printCameraObservationDiagnostic(observation: GestureWatcherObservation, trigger: GestureTrigger | null): void {
    if (this.now() > this.cameraDiagnosticUntil && observation.timestamp > this.cameraDiagnosticUntil) return;
    if (observation.gesture === "none" && observation.timestamp - this.lastCameraDiagnosticAt < 500) return;

    this.cameraDiagnosticObservations += 1;
    this.lastCameraDiagnosticAt = observation.timestamp;
    const confidence = observation.confidence === undefined ? "n/a" : observation.confidence.toFixed(2);
    this.writeLine(
      `[camera:observe] #${this.cameraDiagnosticObservations} gesture=${observation.gesture} confidence=${confidence} state=${this.gestureStateMachine.getState()} trigger=${trigger?.action ?? "none"}`
    );
  }

  private handleGestureWake(trigger: GestureTrigger): void {
    if (trigger.state !== "idle") return;
    if (this.terminalHarness.hasPendingApproval() || this.terminalHarness.isAgentRequestActive()) return;

    this.armWakeFollowUp(`gesture:${trigger.gesture}`);
    this.terminalHarness.sendVisualEvent({
      op: "voice-agent-ui",
      type: "wake",
      phrase: trigger.gesture
    });
    this.writeLine("[voice:cue] gesture wake ready \u0007");
    this.sendListeningVisualState("listening");
    this.refreshGestureRuntimeState();
  }

  private async handleGestureStop(trigger: GestureTrigger): Promise<void> {
    if (trigger.state === "running") {
      await this.terminalHarness.stopActiveTurn("Stop requested from camera gesture");
      this.refreshGestureRuntimeState();
      return;
    }

    if (trigger.state === "listening") {
      if (this.manualRecording) {
        this.manualRecorder.cancel("camera gesture stop");
        this.manualRecording = false;
      }
      this.wakeGate.reset();
      this.wakeStreamDetector.reset();
      this.provisionalWake = undefined;
      this.candidateVisualState = false;
      this.clearWakeFollowUp();
      this.terminalHarness.sendVisualEvent({
        op: "voice-agent-ui",
        type: "state",
        state: "idle",
        text: "camera gesture cancelled"
      });
      this.refreshGestureRuntimeState();
    }
  }

  private async handleGestureApproval(trigger: GestureTrigger): Promise<void> {
    if (trigger.state !== "pending_approval") return;
    const text = approvalTextForGestureAction(trigger.action);
    await this.processTranscriptAndRefreshGestureState(createDirectTranscript(text, this.now, this.createId));
  }

  private refreshGestureRuntimeState(): void {
    if (!this.isCameraGestureRuntimeEnabled() || !this.cameraGestureActive) {
      this.cameraGestureWatcher.setMode("off");
      this.sendVisualCameraStatus("off");
      return;
    }
    const state = this.currentGestureRuntimeState();
    this.gestureStateMachine.setState(state);
    const mode = this.gestureStateMachine.getCameraMode();
    this.cameraGestureWatcher.setMode(mode);
    this.sendVisualCameraStatus(mode);
  }

  private currentGestureRuntimeState(): GestureRuntimeState {
    if (this.terminalHarness.hasPendingApproval()) return "pending_approval";
    if (this.terminalHarness.isAgentRequestActive()) return "running";
    if (this.manualRecording || this.candidateVisualState || this.activeWakeFollowUp() || this.provisionalWake) return "listening";
    return "idle";
  }

  private sendVisualCameraStatus(mode: GestureCameraMode, text?: string): void {
    this.terminalHarness.sendVisualEvent({
      op: "voice-agent-ui",
      type: "camera",
      enabled: this.isCameraGestureRuntimeEnabled() && mode !== "off",
      mode,
      wakeGesture: this.gestureWake.bindings.wake,
      stopGesture: this.gestureWake.bindings.stop,
      runningMode: this.gestureWake.runningMode,
      ...(text ? { text } : {})
    });
  }

  private isCameraGestureRuntimeEnabled(): boolean {
    return this.gestureWake.enabled && !this.cameraGestureSuspended;
  }

  private handleProvisionalWake(event: WakeStreamEvent): void {
    if (!this.micEnabled) return;
    if (this.manualRecording) return;
    if (this.provisionalWake) return;
    if (this.activeWakeFollowUp()) return;
    if (this.terminalHarness.hasPendingApproval()) return;
    if (this.terminalHarness.isAgentRequestActive()) return;
    if (this.terminalHarness.ttsPlaybackState.isSpeakingOrRecent(this.now())) return;

    this.provisionalWake = event;
    this.recentProvisionalWakeCue = event;
    this.writeLine(
      `[wake:stream] provisional provider=${event.provider} phrase="${event.phrase}" strategy=${event.strategy}`
    );
    this.terminalHarness.sendVisualEvent({
      op: "voice-agent-ui",
      type: "wake",
      phrase: event.phrase
    });
    this.sendListeningVisualState("listening");
  }

  updateWakePhrases(wakePhrases: readonly string[], options: { persist?: boolean } = {}): void {
    this.wakePhrases = normalizedWakePhrases(wakePhrases);
    this.wakeStreamDetector.updateWakePhrases?.(this.wakePhrases);
    this.clearWakeFollowUp();
    this.writeLine(`  Wake phrases: ${this.wakePhrases.join(", ") || "(none)"}`);
    this.sendVisualWakeSettings();
    if (options.persist !== false) {
      this.trackSettingsWrite(this.persistWakePhrases([...this.wakePhrases]));
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

  resetGestureWakeSettings(options: { persist?: boolean } = {}): void {
    this.gestureWake = gestureWakeConfigForRuntime(undefined, this.cameraGestureEnabledByCli);
    this.gestureStateMachine = new GestureActionStateMachine({
      config: this.gestureWake,
      now: this.now
    });
    this.writeLine("[camera:settings] local gesture settings cleared");
    this.sendVisualGestureSettings();
    this.reconfigureCameraGestureAfterSettingsUpdate();
    if (options.persist !== false) {
      this.trackSettingsWrite(this.persistGestureWakeReset());
    }
  }

  updateGestureWakeSettings(settings: GestureWakeFileConfig, options: { persist?: boolean } = {}): void {
    const sanitized = sanitizeGestureWakeConfig(settings);
    this.gestureWake = gestureWakeConfigForRuntime(sanitized, this.cameraGestureEnabledByCli);
    this.gestureStateMachine = new GestureActionStateMachine({
      config: this.gestureWake,
      now: this.now
    });
    this.writeLine(
      `[camera:settings] wake=${this.gestureWake.bindings.wake} stop=${this.gestureWake.bindings.stop} runningMode=${this.gestureWake.runningMode}`
    );
    this.sendVisualGestureSettings();
    this.reconfigureCameraGestureAfterSettingsUpdate();
    if (options.persist !== false) {
      this.trackSettingsWrite(this.persistGestureWakeSettings(sanitized));
    }
  }

  async captureCustomGestureTemplate(label: string): Promise<void> {
    const trimmed = label.trim();
    if (!trimmed) {
      this.writeLine("[camera:capture] usage: /gesture-add <name>");
      this.sendVisualCameraStatus(this.gestureStateMachine.getCameraMode(), "custom gesture name required");
      return;
    }

    if (!this.cameraGestureEnabledByCli || !this.gestureWake.enabled) {
      this.writeLine("[camera:capture] restart Voice Agent with --cam to capture custom gestures.");
      this.sendVisualCameraStatus("off", "camera gesture capture requires --cam");
      return;
    }

    if (this.cameraGestureSuspended) {
      this.writeLine("[camera:capture] camera gesture wake is off. Type /cam to turn it on.");
      this.sendVisualCameraStatus("off", "camera gesture wake off");
      return;
    }

    if (!this.cameraGestureActive) {
      await this.startCameraGestureIfEnabled();
    }

    if (!this.cameraGestureActive) {
      this.writeLine("[camera:capture] camera gesture watcher is not active.");
      this.sendVisualCameraStatus("off", "camera gesture watcher is not active");
      return;
    }

    if (!this.cameraGestureWatcher.captureCustomGestureTemplate) {
      this.writeLine("[camera:capture] current camera watcher does not expose hand landmark templates.");
      this.sendVisualCameraStatus(this.gestureStateMachine.getCameraMode(), "custom gesture capture is unavailable");
      return;
    }

    this.refreshGestureRuntimeState();
    const name = customGestureNameFromLabel(trimmed);
    this.writeLine(`[camera:capture] ready name=${name} label="${trimmed}" hold gesture for 1500ms \u0007`);
    this.sendVisualCameraStatus(this.gestureStateMachine.getCameraMode(), `capturing custom gesture: ${trimmed}`);

    try {
      const template = await this.cameraGestureWatcher.captureCustomGestureTemplate({
        name,
        label: trimmed,
        durationMs: 1500,
        minSamples: 3,
        threshold: 0.22
      });
      await this.saveCustomGestureTemplate(template);
      this.writeLine(`[camera:capture] saved name=${template.name} label="${template.label}" samples=${template.samples}`);
      this.sendVisualCameraStatus(this.gestureStateMachine.getCameraMode(), `saved custom gesture: ${template.label}`);
    } catch (error) {
      this.writeLine(`[camera:capture] failed: ${formatError(error)}`);
      this.sendVisualCameraStatus(this.gestureStateMachine.getCameraMode(), `custom gesture capture failed: ${formatError(error)}`);
    }
  }

  deleteCustomGestureTemplate(nameOrLabel: string, options: { persist?: boolean } = {}): void {
    const name = resolveCustomGestureTemplateName(nameOrLabel, this.gestureWake.customGestures);
    if (!name) {
      this.writeLine("[camera:custom] usage: /gesture-delete <name>");
      this.sendVisualCameraStatus(this.gestureStateMachine.getCameraMode(), "custom gesture name required");
      return;
    }

    const customGestures = this.gestureWake.customGestures.filter((template) => template.name !== name);
    if (customGestures.length === this.gestureWake.customGestures.length) {
      this.writeLine(`[camera:custom] no custom gesture named ${name}`);
      this.sendVisualGestureSettings();
      return;
    }

    const sanitized = sanitizeGestureWakeConfig({
      ...this.gestureWake,
      bindings: gestureBindingsWithoutCustomNames(this.gestureWake.bindings, new Set([name])),
      customGestures
    });
    this.gestureWake = gestureWakeConfigForRuntime(sanitized, this.cameraGestureEnabledByCli);
    this.gestureStateMachine = new GestureActionStateMachine({
      config: this.gestureWake,
      now: this.now
    });
    this.writeLine(`[camera:custom] deleted name=${name}`);
    this.sendVisualGestureSettings();
    this.reconfigureCameraGestureAfterSettingsUpdate();
    if (options.persist !== false) {
      this.trackSettingsWrite(this.persistGestureWakeSettings({
        ...sanitized,
        enabled: false
      }));
    }
  }

  clearCustomGestureTemplates(options: { persist?: boolean } = {}): void {
    const deletedNames = new Set(this.gestureWake.customGestures.map((template) => template.name));
    if (deletedNames.size === 0) {
      this.writeLine("[camera:custom] no custom gestures to delete");
      this.sendVisualGestureSettings();
      return;
    }

    const sanitized = sanitizeGestureWakeConfig({
      ...this.gestureWake,
      bindings: gestureBindingsWithoutCustomNames(this.gestureWake.bindings, deletedNames),
      customGestures: []
    });
    this.gestureWake = gestureWakeConfigForRuntime(sanitized, this.cameraGestureEnabledByCli);
    this.gestureStateMachine = new GestureActionStateMachine({
      config: this.gestureWake,
      now: this.now
    });
    this.writeLine(`[camera:custom] deleted ${deletedNames.size} custom gesture(s)`);
    this.sendVisualGestureSettings();
    this.reconfigureCameraGestureAfterSettingsUpdate();
    if (options.persist !== false) {
      this.trackSettingsWrite(this.persistGestureWakeSettings({
        ...sanitized,
        enabled: false
      }));
    }
  }

  private async saveCustomGestureTemplate(template: CustomGestureTemplate): Promise<void> {
    const customGestures = [
      ...this.gestureWake.customGestures.filter((existing) => existing.name !== template.name),
      template
    ];
    const sanitized = sanitizeGestureWakeConfig({
      ...this.gestureWake,
      customGestures
    });
    this.gestureWake = gestureWakeConfigForRuntime(sanitized, this.cameraGestureEnabledByCli);
    this.gestureStateMachine = new GestureActionStateMachine({
      config: this.gestureWake,
      now: this.now
    });
    await this.cameraGestureWatcher.start(this.gestureWake);
    this.refreshGestureRuntimeState();
    this.sendVisualGestureSettings();
    this.trackSettingsWrite(this.persistGestureWakeSettings({
      ...sanitized,
      enabled: false
    }));
  }

  private reconfigureCameraGestureAfterSettingsUpdate(): void {
    this.cameraSettingsGeneration += 1;
    const generation = this.cameraSettingsGeneration;

    if (!this.isCameraGestureRuntimeEnabled() || !this.cameraGestureActive) {
      this.refreshGestureRuntimeState();
      return;
    }

    const config = this.gestureWake;
    this.trackCameraTask(
      (async () => {
        await this.cameraGestureWatcher.stop();
        if (
          generation !== this.cameraSettingsGeneration ||
          !this.started ||
          !this.cameraGestureActive ||
          !this.isCameraGestureRuntimeEnabled()
        ) {
          return;
        }
        await this.cameraGestureWatcher.start(config);
        if (generation !== this.cameraSettingsGeneration) return;
        this.refreshGestureRuntimeState();
      })().catch((error) => {
        this.cameraGestureActive = false;
        this.writeLine(`[camera:error] ${formatError(error)}`);
        this.sendVisualCameraStatus("off", "camera gesture watcher failed to reconfigure");
      })
    );
  }

  private sendVisualWakeSettings(): void {
    this.terminalHarness.sendVisualEvent({
      op: "voice-agent-ui",
      type: "settings",
      wakePhrases: [...this.wakePhrases]
    });
  }

  private sendVisualGestureSettings(): void {
    this.terminalHarness.sendVisualEvent({
      op: "voice-agent-ui",
      type: "settings",
      gestureWake: {
        enabled: this.gestureWake.enabled,
        fps: this.gestureWake.fps,
        resolution: this.gestureWake.resolution.label,
        holdMs: this.gestureWake.holdMs,
        cooldownMs: this.gestureWake.cooldownMs,
        runningMode: this.gestureWake.runningMode,
        bindings: { ...this.gestureWake.bindings },
        customGestures: this.gestureWake.customGestures.map((template) => ({
          ...template,
          vector: [...template.vector]
        }))
      }
    });
  }

  private sendVisualMicSettings(): void {
    this.terminalHarness.sendVisualEvent({
      op: "voice-agent-ui",
      type: "settings",
      micEnabled: this.micEnabled
    });
  }

  private trackSettingsWrite(write: Promise<void>): void {
    const task = write.finally(() => {
      this.pendingSettingsWrites.delete(task);
    });
    this.pendingSettingsWrites.add(task);
  }

  private trackCameraTask(task: Promise<void>): void {
    const tracked = task.finally(() => {
      this.pendingCameraTasks.delete(tracked);
    });
    this.pendingCameraTasks.add(tracked);
  }

  private async drainCameraTasks(): Promise<void> {
    while (this.pendingCameraTasks.size > 0) {
      await Promise.all([...this.pendingCameraTasks]);
    }
  }

  private async drainSettingsWrites(): Promise<void> {
    while (this.pendingSettingsWrites.size > 0) {
      await Promise.all([...this.pendingSettingsWrites]);
    }
  }

  private async persistWakePhrases(wakePhrases: string[]): Promise<void> {
    try {
      await this.settingsPersistence?.update({
        wakePhrases
      });
    } catch (error) {
      this.writeLine(`[settings:error] ${formatError(error)}`);
    }
  }

  private async persistGestureWakeSettings(gestureWake: GestureWakeFileConfig): Promise<void> {
    try {
      await this.settingsPersistence?.update({
        gestureWake
      });
    } catch (error) {
      this.writeLine(`[settings:error] ${formatError(error)}`);
    }
  }

  private async persistGestureWakeReset(): Promise<void> {
    try {
      await this.settingsPersistence?.resetGestureWake();
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
        this.refreshGestureRuntimeState();
        return;
      case "command":
        await this.terminalHarness.prepareForNewAgentTurn("New wake command requested");
        this.writeLine(`[barge:command] phrase="${decision.wake.phrase}" command="${decision.commandText}"`);
        const applied = this.textContext.applyWithEntries(withTranscriptText(transcript, decision.commandText));
        await this.processTranscriptAndRefreshGestureState(applied.transcript, {
          visualQuestionText: decision.commandText,
          visualQuestionReferences: applied.entries
        });
        return;
    }
  }

  private sendBargeIgnoredVisualState(): void {
    this.terminalHarness.restoreCurrentVisualState();
  }

  private async routeDirectText(text: string): Promise<void> {
    const trimmed = text.trim();
    const directText = trimmed || directTextFromContextEntries(this.textContext.takeEntries());

    if (!directText) {
      this.writeLine("[voice:direct] usage: enter text to send.");
      return;
    }

    const transcript = createDirectTranscript(directText, this.now, this.createId);
    const applied = trimmed ? this.textContext.applyWithEntries(transcript) : { transcript, entries: [] };
    await this.processTranscriptAndRefreshGestureState(applied.transcript, {
      visualQuestionText: directText,
      visualQuestionReferences: applied.entries
    });
  }

  private async processTranscriptAndRefreshGestureState(
    transcript: Transcript,
    options: {
      visualQuestionText?: string;
      visualQuestionReferences?: string[];
    } = {}
  ): Promise<void> {
    await this.terminalHarness.processTranscript(transcript, options);
    this.refreshGestureRuntimeState();
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
        this.provisionalWake = undefined;
        this.wakeStreamDetector.reset();
        this.candidateVisualState = this.captureWakeFollowUpCandidate() || this.shouldShowCandidateVisualState();
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
    return !this.shouldSuppressBackgroundCandidateFeedback();
  }

  private shouldSuppressTranscriptionError(source: "candidate" | "manual", details: string): boolean {
    if (this.debug || source !== "candidate") return false;
    if (!this.shouldSuppressBackgroundCandidateFeedback()) return false;
    return /no transcript|no speech detected|produced no transcript/i.test(details);
  }

  private shouldSuppressBackgroundCandidateFeedback(): boolean {
    return this.terminalHarness.isAgentRequestActive() || this.terminalHarness.ttsPlaybackState.isSpeakingOrRecent(this.now());
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
    codexAlwaysStartNewThread?: boolean;
    cameraGestureEnabled?: boolean;
    cameraGestureWatcher?: CameraGestureWatcher;
    cameraPermissionManager?: CameraPermissionManager;
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
    approvalPhrases: config.approvalPhrases,
    visualBridge: options.visualBridge,
    settingsPersistence: options.settingsPersistence,
    codexThreadId: options.codexThreadId,
    codexAlwaysStartNewThread: options.codexAlwaysStartNewThread,
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
    wakeStreamDetector?: WakeStreamDetector;
    wakePhrases?: string[];
    debug?: boolean;
    visualBridge?: VisualBridgeLike;
    settingsPersistence?: VoiceSettingsPersistence;
    codexThreadId?: string;
    codexAlwaysStartNewThread?: boolean;
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
    approvalPhrases: config.approvalPhrases,
    visualBridge: options.visualBridge,
    settingsPersistence: options.settingsPersistence,
    codexThreadId: options.codexThreadId,
    codexAlwaysStartNewThread: options.codexAlwaysStartNewThread,
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
    wakeStreamDetector: options.wakeStreamDetector ?? createWakeStreamDetectorFromConfig(config, {
      diagnosticLine: options.debug ? writeLine : undefined,
      now: options.now
    }),
    wakePhrases: options.wakePhrases ?? config.wakePhrases,
    visualBridge: options.visualBridge,
    settingsPersistence: options.settingsPersistence,
    gestureWake: config.gestureWake,
    cameraGestureEnabled: options.cameraGestureEnabled,
    cameraGestureWatcher: options.cameraGestureWatcher,
    cameraPermissionManager: options.cameraPermissionManager,
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
  cameraGesture: boolean;
  visualProvider?: VisualProvider;
  harnessArgs: string[];
}

export function parseVoiceHarnessCliArgs(args: string[]): VoiceHarnessCliOptions {
  const harnessArgs: string[] = [];
  let alwaysOn = false;
  let debug = false;
  let visual = false;
  let cameraGesture = false;
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

    if (arg === "--cam") {
      cameraGesture = true;
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
    cameraGesture,
    ...(visualProvider ? { visualProvider } : {}),
    harnessArgs
  };
}

export function shouldWriteDefaultVoiceHarnessLine(line: string): boolean {
  const visible = stripAnsi(line).trimStart();
  if (!visible.trim()) return true;

  if (visible.startsWith("[agent:")) return true;
  if (/^\[stt:(ko|en|mixed|unknown)\]/u.test(visible)) return true;
  if (/^\[voice:(ack|permission|completion|speech|status|error|warning|cue)\]/u.test(visible)) return true;
  if (visible.startsWith("[voice:context]")) return true;
  if (visible.startsWith("[voice:capability]")) return true;
  if (visible.startsWith("[settings:error]")) return true;
  if (visible.startsWith("[camera:")) return true;
  if (visible.startsWith("[codex-app] config ")) return true;
  if (visible.startsWith("[harness")) return true;
  if (visible.startsWith("[status]")) return true;
  if (visible.startsWith("[tts]")) return true;
  if (visible.startsWith("[visual] unavailable")) return true;
  if (visible.startsWith("[voice:context]")) return true;
  if (visible.startsWith("[voice]")) return true;
  if (visible === "Harness stopped.") return true;
  if (visible.startsWith("Type /help ")) return true;
  if (isVisibleHelpCommandLine(visible)) return true;

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
    visible.startsWith("/help ") ||
    visible.startsWith("/cam-test ") ||
    visible.startsWith("/add ") ||
    visible.startsWith("/refs ") ||
    visible.startsWith("STT output ")
  ) {
    return true;
  }

  return false;
}

function isVisibleHelpCommandLine(visible: string): boolean {
  return /^\/(?:help|status|permission|complete|error|tts-stop|quit|record|mic|mic-reconnect|cam|camera|camera-toggle|cam-test|camera-test|gesture-add|gesture-capture|gesture-delete|gesture-remove|gesture-rm|gesture-clear-custom|gestures-clear-custom|gesture-delete-all|gestures-delete-all|gesture-reset|gesture-clear|add|refs)(?:\s|$)/u.test(visible);
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
  const codexThreadSettings = await loadCodexThreadSettingsForVisual(writeLine, parseHarnessCliArgs(args).cwd);
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
        codexThreadId: codexThreadSettings.threadId,
        codexAlwaysStartNewThread: codexThreadSettings.alwaysStartNewThread,
        cameraGestureEnabled: cli.cameraGesture,
        onExitRequest: requestShutdown
      })
    : createVoiceHarnessRunnerFromConfig(resolution.config, args, {
        writeLine,
        debug: cli.debug,
        visualBridge,
        settingsPersistence,
        codexThreadId: codexThreadSettings.threadId,
        codexAlwaysStartNewThread: codexThreadSettings.alwaysStartNewThread,
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

async function loadCodexThreadSettingsForVisual(
  writeLine: WriteLine,
  cwd: string
): Promise<{ threadId?: string; alwaysStartNewThread: boolean }> {
  try {
    return await readCodexThreadSettings(resolve(cwd, defaultVoiceConfigPath));
  } catch (error) {
    writeLine(`[settings:error] ${formatError(error)}`);
    return {
      alwaysStartNewThread: false
    };
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

function cameraPermissionGuidance(status: CameraPermissionStatus): string {
  switch (status) {
    case "denied":
    case "restricted":
      return "Camera gesture wake disabled. System Settings → Privacy & Security → Camera → allow this app";
    case "not_determined":
      return "Camera gesture wake disabled because camera permission was not granted.";
    case "unavailable":
      return "Camera gesture wake unavailable on this runtime.";
    case "authorized":
      return "Camera gesture wake enabled.";
  }
}

function createDefaultCameraPermissionManager(): CameraPermissionManager {
  if (process.platform === "darwin") {
    return new CommandCameraPermissionManager({
      command: "swift src/gesture/macos-camera-permission.swift",
      env: swiftHelperEnv()
    });
  }

  return new StaticCameraPermissionManager("unavailable");
}

function createDefaultCameraGestureWatcher(): CameraGestureWatcher {
  if (process.platform === "darwin") {
    return new LandmarkCameraGestureWatcher({
      createProvider: () =>
        new CommandHandLandmarkProvider({
          command: "swift",
          args: ["src/gesture/macos-camera-gesture.swift"],
          env: swiftHelperEnv()
        })
    });
  }

  return new NoopCameraGestureWatcher();
}

function swiftHelperEnv(): Record<string, string> {
  return {
    CLANG_MODULE_CACHE_PATH: "/private/tmp/voice-agent-swift-module-cache"
  };
}

function approvalTextForGestureAction(action: GestureTrigger["action"]): string {
  switch (action) {
    case "approval.once":
      return "허용";
    case "approval.deny":
      return "거부";
    case "approval.session":
      return "이번 세션 동안 허용";
    case "approval.policy":
      return "같은 명령 계속 허용";
    case "wake":
    case "stop":
      return "";
  }
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

  show(): void {
    this.writeLine(formatSupplementalTextList(this.entries));
  }

  snapshot(): string[] {
    return [...this.entries];
  }

  apply(transcript: Transcript): Transcript {
    return this.applyWithEntries(transcript).transcript;
  }

  applyWithEntries(transcript: Transcript): { transcript: Transcript; entries: string[] } {
    const entries = this.takeEntries();
    if (entries.length === 0) {
      return {
        transcript,
        entries: []
      };
    }

    return {
      transcript: withTranscriptText(transcript, appendSupplementalText(transcript.text, entries)),
      entries
    };
  }

  takeEntries(): string[] {
    if (this.entries.length === 0) return [];

    const entries = this.entries.splice(0);
    this.writeLine(`[voice:context] applied ${entries.length} item(s).`);
    this.emitChange();
    return entries;
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
      return;
    }

    if (event.action === "show_context") {
      textContext.show();
      sendVisualContextList(visualBridge, textContext.snapshot());
    }
  });
}

function bindVisualDirectGoControls(
  onDirectGo: (text: string) => void | Promise<void>,
  visualBridge: VisualBridgeLike | undefined
): void {
  visualBridge?.onControl((event) => {
    if (event.action !== "direct_go") return;
    void onDirectGo(event.text ?? "");
  });
}

function bindVisualWakeSettingsControls(
  runner: Pick<AlwaysOnVoiceHarnessRunner, "updateWakePhrases" | "resetWakePhrases" | "updateMaxUtteranceSeconds" | "resetMaxUtteranceSeconds" | "updateGestureWakeSettings" | "resetGestureWakeSettings" | "captureCustomGestureTemplate" | "deleteCustomGestureTemplate" | "clearCustomGestureTemplates" | "toggleMicInput" | "toggleCameraGestureInput">,
  visualBridge: VisualBridgeLike | undefined
): void {
  visualBridge?.onControl((event) => {
    if (event.action === "mic_toggle") {
      runner.toggleMicInput(event.micEnabled);
      return;
    }

    if (event.action === "camera_toggle") {
      void runner.toggleCameraGestureInput();
      return;
    }

    if (event.action === "update_wake_phrases") {
      runner.updateWakePhrases(event.wakePhrases ?? []);
      return;
    }

    if (event.action === "update_gesture_wake_settings") {
      runner.updateGestureWakeSettings(event.gestureWake ?? {});
      return;
    }

    if (event.action === "capture_gesture_template") {
      void runner.captureCustomGestureTemplate(event.text ?? "");
      return;
    }

    if (event.action === "delete_gesture_template") {
      runner.deleteCustomGestureTemplate(event.text ?? "");
      return;
    }

    if (event.action === "clear_custom_gesture_templates") {
      runner.clearCustomGestureTemplates();
      return;
    }

    if (event.action === "reset_gesture_wake_settings") {
      runner.resetGestureWakeSettings();
      return;
    }

    if (event.action === "reset_settings") {
      runner.resetWakePhrases();
      runner.resetMaxUtteranceSeconds();
      runner.resetGestureWakeSettings();
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

function sendVisualContextList(visualBridge: VisualBridgeLike | undefined, entries: string[]): void {
  visualBridge?.send({
    op: "voice-agent-ui",
    type: "context_list",
    entries
  });
}

function noopContextChange(_entries: string[]): void {}

function appendSupplementalText(text: string, entries: string[]): string {
  const base = text.trim();
  const context = entries.map((entry) => `- ${entry}`).join("\n");

  return `${base}\n\n추가 정보:\n${context}`;
}

function directTextFromContextEntries(entries: string[]): string {
  return entries.map((entry) => entry.trim()).filter(Boolean).join("\n\n");
}

function createDirectTranscript(
  text: string,
  now: () => number = Date.now,
  createId: (prefix: string) => string = (prefix) => `${prefix}_${now()}`
): Transcript {
  const timestamp = now();
  const normalizedText = normalizeTranscriptText(text);

  return {
    id: createId("direct_tr"),
    sessionId: createId("direct_sess"),
    text,
    normalizedText,
    language: detectTranscriptLanguage(normalizedText),
    confidence: 1,
    startedAt: timestamp,
    endedAt: timestamp
  };
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

function parseGestureCaptureCommand(text: string): { matched: boolean; argument: string } {
  const match = text.match(/^\/(?:gesture-add|gesture-capture)(?:\s+([\s\S]*))?$/iu);

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

function parseGestureDeleteCommand(text: string): { matched: boolean; argument: string } {
  const match = text.match(/^\/(?:gesture-delete|gesture-remove|gesture-rm)(?:\s+([\s\S]*))?$/iu);

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

function isCustomGestureClearCommand(text: string): boolean {
  return /^\/(?:gesture-clear-custom|gestures-clear-custom|gesture-delete-all|gestures-delete-all)$/iu.test(text.trim());
}

function resolveCustomGestureTemplateName(
  value: string,
  templates: CustomGestureTemplate[]
): CustomGestureTemplate["name"] | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (isCustomGestureName(trimmed)) return trimmed;
  const lower = trimmed.toLocaleLowerCase();
  const match = templates.find((template) => (
    template.label.toLocaleLowerCase() === lower ||
    template.name.slice("custom:".length).toLocaleLowerCase() === lower
  ));
  if (match) return match.name;
  return customGestureNameFromLabel(trimmed);
}

function gestureBindingsWithoutCustomNames(
  bindings: GestureWakeConfig["bindings"],
  deletedNames: Set<string>
): GestureWakeFileConfig["bindings"] {
  const next: GestureWakeFileConfig["bindings"] = { ...bindings };
  if (deletedNames.has(bindings.wake)) {
    next.wake = "open_palm";
  }
  if (deletedNames.has(bindings.stop)) {
    next.stop = "thumbs_down";
  }

  for (const action of ["approval.once", "approval.deny", "approval.session", "approval.policy"] as const) {
    if (bindings[action] !== undefined && deletedNames.has(bindings[action])) {
      next[action] = "none";
    }
  }

  return next;
}

function isGestureResetCommand(text: string): boolean {
  return /^\/(?:gesture-reset|gesture-clear|gestures-reset|gestures-clear)$/iu.test(text.trim());
}

function isShowContextCommand(text: string): boolean {
  return /^\/(?:refs?|references|context)$/iu.test(text.trim());
}

function isMicToggleCommand(text: string): boolean {
  return /^\/(?:mic|mic-toggle|microphone)$/iu.test(text.trim());
}

function isCameraToggleCommand(text: string): boolean {
  return /^\/(?:cam|camera|camera-toggle)$/iu.test(text.trim());
}

function isHelpCommand(text: string): boolean {
  return /^\/(?:help|commands|\?)$/iu.test(text.trim());
}

function isMicReconnectCommand(text: string): boolean {
  return /^\/(?:mic-reconnect|microphone-reconnect|audio-reconnect)$/iu.test(text.trim());
}

function isCameraTestCommand(text: string): boolean {
  return /^\/(?:cam-test|camera-test)$/iu.test(text.trim());
}

function shouldReconnectAudioInput(status: AudioInputStatus): boolean {
  return status === "waiting_device" || status === "failed" || status === "reconfiguring" || status === "restarting";
}

function formatSupplementalTextList(entries: readonly string[]): string {
  if (entries.length === 0) return "[voice:context] No references queued.";

  return [
    "[voice:context] queued references:",
    ...entries.map((entry, index) => `${index + 1}. ${entry}`)
  ].join("\n");
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function compactLogText(text: string): string {
  const compact = text.trim().replace(/\s+/gu, " ");
  if (compact.length <= 120) return compact;
  return `${compact.slice(0, 117).trimEnd()}...`;
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
