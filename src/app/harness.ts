import { resolve } from "node:path";
import { stdin, stderr, stdout } from "node:process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { ClaudeCodeBackend } from "../claude/ClaudeCodeBackend.ts";
import type { AgentBackend, CodexProcessConfig } from "../codex/CodexBridge.ts";
import { CodexAppServerBackend, type CodexApprovalPolicy } from "../codex/CodexAppServerBackend.ts";
import {
  initialCodexStatus,
  type CodexOutputEvent,
  type CodexRateLimitWindow,
  type CodexRateLimits,
  type CodexStatus
} from "../codex/CodexOutputEvent.ts";
import type { CodexPrompt } from "../codex/CodexPrompt.ts";
import {
  approvalPhraseSet,
  type ApprovalPhraseConfig,
  type ApprovalPhraseSet,
  interpretApprovalSpeech,
  normalizeApprovalSpeech
} from "../permission/ApprovalSpeech.ts";
import type { PermissionDecision } from "../permission/PermissionDecision.ts";
import type { PermissionRequest } from "../permission/PermissionRequest.ts";
import { RuntimeController } from "../runtime/RuntimeController.ts";
import type { AgentState } from "../runtime/AgentState.ts";
import {
  detectTranscriptLanguage,
  normalizeTranscriptText,
  withTranscriptText,
  type Transcript
} from "../speech/Transcript.ts";
import { ConsoleVoiceOutput, type InspectableVoiceOutput } from "../voice/ConsoleVoiceOutput.ts";
import { createVoiceOutput } from "../voice/createVoiceOutput.ts";
import {
  parseVoiceAgentEventLine,
  parseVoiceAgentEventSequence,
  voiceAgentProtocolPromptForSettings,
  type VoiceAgentEvent
} from "../voice/VoiceAgentEvent.ts";
import {
  parseOptionalNumber,
  parseTtsGender,
  parseTtsLanguage,
  parseTtsProvider,
  parseTtsRate,
  type TtsCliOptions,
  type VoiceTtsFileConfig
} from "../voice/TtsConfig.ts";
import type { VoiceMessage } from "../voice/VoiceMessage.ts";
import type { SpawnTtsProcess } from "../voice/MacosAppleTtsProvider.ts";
import { TtsPlaybackState } from "../voice/TtsPlaybackState.ts";
import type {
  VisualApprovalPhrases,
  VisualBridgeLike,
  VisualControlEvent,
  VisualEvent,
  VisualRuntimeSettings,
  VisualTtsSettings,
  VisualUiState
} from "../visual/VisualBridge.ts";
import { detectWakePhrase, type AgentTarget } from "../wake/WakePhraseRouter.ts";
import { createCodexThreadStore } from "./codex-thread-config.ts";
import {
  defaultMaxUtteranceSeconds,
  defaultVisualThinkingVolume,
  sanitizeMaxUtteranceSeconds,
  type VoiceSettingsPersistence,
  type VoiceVisualFileConfig
} from "./voice-config.ts";

type WriteLine = (line: string) => void;

const LATE_APPROVAL_SPEECH_GRACE_MS = 4_000;

interface SpeakVisualOptions {
  visualState?: VisualUiState;
  visualText?: string;
}

interface ProcessTranscriptOptions {
  visualQuestionText?: string;
  visualQuestionReferences?: string[];
}

export { ConsoleVoiceOutput } from "../voice/ConsoleVoiceOutput.ts";

export type HarnessLineResult = "continue" | "quit";

export interface InMemoryAgentBackendOptions {
  now?: () => number;
  writeLine?: WriteLine;
}

export class InMemoryAgentBackend implements AgentBackend {
  readonly prompts: CodexPrompt[] = [];
  readonly permissions: PermissionDecision[] = [];
  readonly interrupts: string[] = [];
  readonly outputs: CodexOutputEvent[] = [];
  readonly permissionRequests: PermissionRequest[] = [];
  readonly protocolPrompts: string[] = [];

  private readonly now: () => number;
  private readonly writeLine: WriteLine;
  private status: CodexStatus = {
    process: "not_started",
    task: "idle"
  };
  private readonly outputListeners: Array<(event: CodexOutputEvent) => void> = [];
  private readonly permissionListeners: Array<(request: PermissionRequest) => void> = [];
  private readonly statusListeners: Array<(status: CodexStatus) => void> = [];

  constructor(options: InMemoryAgentBackendOptions = {}) {
    this.now = options.now ?? Date.now;
    this.writeLine = options.writeLine ?? noop;
  }

  async start(config?: CodexProcessConfig): Promise<void> {
    this.publishStatus({
      process: "running",
      task: "idle",
      currentWorkingDirectory: config?.cwd
    });
  }

  async stop(): Promise<void> {
    this.publishStatus({
      ...this.status,
      process: "exited",
      task: "idle"
    });
  }

  async sendPrompt(prompt: CodexPrompt): Promise<void> {
    this.prompts.push(prompt);
    this.writeLine(`[backend] prompt ${prompt.sessionId}: ${prompt.text}`);
    this.publishStatus({
      ...this.status,
      process: "running",
      task: "thinking"
    });
  }

  setVoiceAgentProtocolPrompt(prompt: string): void {
    this.protocolPrompts.push(prompt);
  }

  async sendPermission(decision: PermissionDecision): Promise<void> {
    this.permissions.push(decision);
    this.writeLine(`[backend] permission ${decision.decision}: ${decision.requestId}`);
    this.publishStatus({
      ...this.status,
      process: "running",
      task: "thinking"
    });
  }

  async interrupt(reason: string): Promise<void> {
    this.interrupts.push(reason);
    this.writeLine(`[backend] interrupt: ${reason}`);
    this.publishStatus({
      ...this.status,
      process: "running",
      task: "idle"
    });
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

  recordOutput(event: CodexOutputEvent): void {
    this.outputs.push(event);
  }

  recordPermissionRequest(request: PermissionRequest): void {
    this.permissionRequests.push(request);
  }

  emitOutput(event: CodexOutputEvent): void {
    this.recordOutput(event);
    this.outputListeners.forEach((listener) => listener(event));
  }

  emitPermissionRequest(request: PermissionRequest): void {
    this.recordPermissionRequest(request);
    this.permissionListeners.forEach((listener) => listener(request));
  }

  emitStatus(status: CodexStatus): void {
    this.publishStatus(status);
  }

  createPermissionRequest(command: string, sessionId: string, id: string): PermissionRequest {
    const request: PermissionRequest = {
      id,
      sessionId,
      tool: "shell",
      action: "run_command",
      command,
      riskLevel: "medium",
      rawText: `Run command: ${command} ?`,
      createdAt: this.now()
    };

    this.recordPermissionRequest(request);
    return request;
  }

  private publishStatus(status: CodexStatus): void {
    this.status = status;
    this.statusListeners.forEach((listener) => listener(status));
  }
}

export interface TerminalHarnessOptions {
  now?: () => number;
  writeLine?: WriteLine;
  createId?: (prefix: string) => string;
  backend?: AgentBackend;
  backendLabel?: string;
  routingMode?: "runtime" | "passthrough";
  agentTarget?: AgentTarget;
  voiceOutput?: InspectableVoiceOutput;
  ttsCli?: TtsCliOptions;
  ttsConfig?: VoiceTtsFileConfig;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  cwd?: string;
  spawnTtsProcess?: SpawnTtsProcess;
  visualBridge?: VisualBridgeLike;
  visualConfig?: VoiceVisualFileConfig;
  settingsPersistence?: VoiceSettingsPersistence;
  approvalPhrases?: ApprovalPhraseConfig;
  codexThreadId?: string;
  codexAlwaysStartNewThread?: boolean;
  onExitRequest?: () => void | Promise<void>;
}

export class TerminalHarness {
  readonly backend: AgentBackend;
  readonly voiceOutput: InspectableVoiceOutput;
  readonly runtime: RuntimeController | undefined;
  readonly ttsPlaybackState: TtsPlaybackState;

  private readonly now: () => number;
  private readonly writeLine: WriteLine;
  private readonly createId: (prefix: string) => string;
  private readonly backendLabel: string;
  private readonly routingMode: "runtime" | "passthrough";
  private readonly agentTarget: AgentTarget;
  private readonly visualBridge: VisualBridgeLike | undefined;
  private readonly settingsPersistence: VoiceSettingsPersistence | undefined;
  private readonly onExitRequest: (() => void | Promise<void>) | undefined;
  private visualSettings: VisualRuntimeSettings;
  private approvalPhrases: ApprovalPhraseSet;
  private codexThreadId: string | undefined;
  private codexAlwaysStartNewThread: boolean;
  private idSequence = 0;
  private started = false;
  private exitRequested = false;
  private currentSessionId: string | undefined;
  private passthroughState: AgentState = "BOOTING";
  private codexStatus: CodexStatus = initialCodexStatus;
  private passthroughGeneration = 0;
  private activePassthroughGeneration: number | undefined;
  private readonly sessionGenerations = new Map<string, number>();
  private readonly interruptedPassthroughGenerations = new Set<number>();
  private pendingPermission: PermissionRequest | undefined;
  private readonly pendingPermissionQueue: PermissionRequest[] = [];
  private lastSpokenText: string | undefined;
  private lastVisualUsageText: string | undefined;
  private readonly passthroughOutputBuffers = new Map<string, string>();
  private readonly passthroughStructuredSpeechSessions = new Set<string>();
  private readonly passthroughPopupGenerations = new Set<string>();
  private readonly interruptedPassthroughSessions = new Set<string>();
  private readonly scheduledVoiceTasks = new Set<Promise<void>>();
  private voiceQueue: Promise<void> = Promise.resolve();
  private voiceGeneration = 0;
  private progressVoiceGeneration = 0;
  private readonly permissionCueMessageIds = new Set<string>();
  private ignoreApprovalSpeechUntil = 0;

  constructor(options: TerminalHarnessOptions = {}) {
    this.now = options.now ?? Date.now;
    this.writeLine = options.writeLine ?? noop;
    this.backendLabel = options.backendLabel ?? "mock";
    this.visualBridge = options.visualBridge;
    this.settingsPersistence = options.settingsPersistence;
    this.onExitRequest = options.onExitRequest;
    this.visualSettings = visualRuntimeSettingsFromFile(options.visualConfig);
    this.approvalPhrases = approvalPhraseSet(options.approvalPhrases);
    this.codexThreadId = parseOptionalThreadId(options.codexThreadId);
    this.codexAlwaysStartNewThread = options.codexAlwaysStartNewThread === true;
    this.routingMode =
      options.routingMode ??
      (options.backend && this.backendLabel !== "mock" ? "passthrough" : "runtime");
    this.agentTarget =
      options.agentTarget ?? (this.backendLabel.includes("claude") ? "claude" : "codex");
    this.createId =
      options.createId ??
      ((prefix) => `${prefix}_${this.now()}_${++this.idSequence}`);
    this.backend =
      options.backend ??
      new InMemoryAgentBackend({
        now: this.now,
        writeLine: this.writeLine
      });
    this.voiceOutput =
      options.voiceOutput ??
      createVoiceOutput({
        cli: options.ttsCli,
        file: options.ttsConfig,
        env: options.env,
        platform: options.platform,
        writeLine: this.writeLine,
        cwd: options.cwd,
        spawnTtsProcess: options.spawnTtsProcess
      });
    this.ttsPlaybackState = new TtsPlaybackState({
      now: this.now
    });
    this.voiceOutput.onFinished((id) => {
      this.ttsPlaybackState.recordFinished(id, this.now());
      this.restoreVisualStateAfterSpeech();
      this.playPermissionReadyCue(id);
    });
    this.updateBackendProtocolPrompt();
    this.visualBridge?.onControl((event) => {
      void this.handleVisualControl(event);
    });

    if (this.routingMode === "runtime") {
      this.runtime = new RuntimeController({
        backend: this.backend,
        voiceOutput: this.voiceOutput,
        now: this.now,
        createId: this.createId
      });
    } else {
      this.bindPassthroughBackend();
    }
  }

  async start(): Promise<void> {
    if (this.started) return;

    if (this.runtime) {
      await this.runtime.start();
    } else {
      this.passthroughState = "BOOTING";
      await this.backend.start();
      this.passthroughState = "IDLE";
    }

    this.started = true;
    this.sendVisualEvent({
      op: "voice-agent-ui",
      type: "state",
      state: "idle"
    });
    this.sendVisualTtsSettings();
    this.printStartupBanner();
    if (this.runtime) {
      this.writeLine("  Type text to send a transcript, or /help for terminal commands.");
    } else {
      this.writeLine("  Wake: 코덱스 <명령> / 클로드 <명령>");
      this.writeLine("  Plain text also passes through in development mode.");
      this.writeLine("  Approval: 허용 / 거부 / 이번 세션 동안 허용");
      this.writeLine("  Commands: /help /status /tts-stop /quit");
    }
  }

  async stop(): Promise<void> {
    if (!this.started) return;

    if (this.runtime) {
      await this.runtime.stop();
    } else {
      await this.flushPassthroughOutputBuffers();
      await this.backend.stop();
      this.passthroughState = "SHUTDOWN";
    }

    this.sendVisualEvent({
      op: "voice-agent-ui",
      type: "state",
      state: "shutdown"
    });
    this.started = false;
  }

  async processLine(line: string): Promise<HarnessLineResult> {
    const text = line.trim();
    if (!text) return "continue";

    if (text.startsWith("/")) {
      return this.handleSlashCommand(text);
    }

    await this.processTranscript(this.createTranscript(text));
    return "continue";
  }

  async processTranscript(transcript: Transcript, options: ProcessTranscriptOptions = {}): Promise<void> {
    if (this.runtime) {
      await this.runtime.handleTranscript(transcript);
      return;
    }

    await this.handlePassthroughTranscript(transcript, options);
  }

  hasPendingApproval(): boolean {
    if (this.runtime) {
      return Boolean(this.runtime.getContext().pendingPermission);
    }

    return Boolean(this.pendingPermission || this.pendingPermissionQueue.length > 0);
  }

  isAgentRequestActive(): boolean {
    if (this.runtime) {
      return !["IDLE", "LISTENING"].includes(this.runtime.getContext().state);
    }

    return (
      ["EXECUTING", "WAITING_CODEX", "CONFIRMING", "INTERRUPTING"].includes(this.passthroughState) ||
      this.codexStatus.task !== "idle"
    );
  }

  async stopVoiceOutput(): Promise<void> {
    await this.cancelQueuedVoiceOutput();
    this.restoreCurrentVisualState();
  }

  async stopActiveTurn(reason: string): Promise<void> {
    await this.cancelQueuedVoiceOutput();
    this.clearStalePassthroughOutput();

    try {
      if (this.runtime) {
        if (this.isAgentRequestActive()) {
          await this.runtime.interruptActiveTurn(reason);
        }
      } else if (this.isAgentRequestActive()) {
        this.passthroughState = "INTERRUPTING";
        this.markCurrentPassthroughSessionInterrupted();
        await this.backend.interrupt(reason);
        this.clearPendingPermissions();
        this.codexStatus = {
          ...this.codexStatus,
          task: "idle"
        };
        this.passthroughState = "IDLE";
      }
    } catch (error) {
      this.sendVisualEvent({
        op: "voice-agent-ui",
        type: "error",
        text: `stop failed: ${formatError(error)}`
      });
      await this.speak(`정지 실패. ${formatError(error)}`, "error");
      return;
    }

    this.sendVisualQuestion("");
    this.sendVisualState("idle");
    await this.speak("정지했어.", "status");
  }

  async prepareForNewAgentTurn(reason: string): Promise<void> {
    await this.cancelQueuedVoiceOutput();
    this.clearStalePassthroughOutput();

    if (!this.isAgentRequestActive()) return;

    if (this.runtime) {
      await this.runtime.interruptActiveTurn(reason);
      return;
    }

    this.passthroughState = "INTERRUPTING";
    this.markCurrentPassthroughSessionInterrupted();
    await this.backend.interrupt(reason);
    this.clearPendingPermissions();
    this.codexStatus = {
      ...this.codexStatus,
      task: "idle"
    };
    this.passthroughState = "IDLE";
  }

  async speakWakeRejected(text: string, visualText: string): Promise<void> {
    if (this.visualSettings.speakWakeRejectedWarnings === false) {
      this.writeLine(`[voice:warning] ${text}`);
      this.sendVisualState("wake_rejected", visualText);
      return;
    }

    await this.speak(text, "warning", {
      visualState: "wake_rejected",
      visualText
    });
  }

  restoreCurrentVisualState(): void {
    if (this.ttsPlaybackState.isSpeaking()) {
      this.sendVisualEvent({
        op: "voice-agent-ui",
        type: "state",
        state: "speaking",
        ...(this.lastSpokenText ? { text: this.lastSpokenText } : {})
      });
      return;
    }

    this.sendVisualState(this.currentVisualState());
  }

  private bindPassthroughBackend(): void {
    this.backend.onOutput((event) => {
      void this.handlePassthroughOutput(event);
    });
    this.backend.onPermissionRequest((request) => {
      void this.handlePassthroughPermissionRequest(request);
    });
    this.backend.onStatus((status) => {
      const wasWaitingForCodex = this.passthroughState === "WAITING_CODEX" || this.passthroughState === "EXECUTING";
      this.codexStatus = status;
      if (status.rateLimits) {
        this.sendVisualUsage(status.rateLimits);
      }
      if (status.threadId && status.threadId !== this.codexThreadId) {
        this.codexThreadId = status.threadId;
        this.sendVisualTtsSettings();
      }
      if (
        wasWaitingForCodex &&
        status.process === "running" &&
        status.task === "idle" &&
        !this.pendingPermission &&
        this.pendingPermissionQueue.length === 0
      ) {
        this.passthroughState = "IDLE";
        this.sendVisualQuestion("");
      }
      this.sendVisualState(status.task === "waiting_permission" ? "approval_pending" : statusToVisualState(status.task));
    });
  }

  private async handlePassthroughTranscript(transcript: Transcript, options: ProcessTranscriptOptions = {}): Promise<void> {
    const text = transcript.text.trim();

    if (this.pendingPermission) {
      await this.handleNativeApprovalSpeech(text);
      return;
    }

    if (this.shouldIgnoreLateApprovalSpeech(text)) {
      this.writeLine(`[voice:permission] ignored late approval speech: ${text}`);
      return;
    }

    if (this.shouldInterrupt(text)) {
      this.passthroughState = "INTERRUPTING";
      this.clearStalePassthroughOutput();
      this.markCurrentPassthroughSessionInterrupted();
      await this.backend.interrupt(text);
      await this.speak("멈출게.", "status");
      this.passthroughState = "IDLE";
      return;
    }

    const wake = detectWakePhrase(text);

    if (wake && wake.target !== this.agentTarget) {
      await this.speak(`${agentLabel(wake.target)} 모드는 현재 harness에 연결되어 있지 않아.`, "warning");
      return;
    }

    const promptText = wake ? wake.commandText : text;

    if (!promptText) {
      this.passthroughState = "LISTENING";
      this.writeLine("[voice:cue] wake ready \u0007");
      this.sendVisualState("listening");
      return;
    }

    await this.sendPassthroughTranscript(wake ? withTranscriptText(transcript, promptText) : transcript, {
      visualQuestionText: options.visualQuestionText ?? promptText,
      visualQuestionReferences: options.visualQuestionReferences
    });
  }

  private shouldIgnoreLateApprovalSpeech(text: string): boolean {
    return this.now() <= this.ignoreApprovalSpeechUntil && isExactApprovalPhrase(text, this.approvalPhrases);
  }

  private async sendPassthroughTranscript(transcript: Transcript, options: ProcessTranscriptOptions = {}): Promise<void> {
    this.startAgentTurn();
    const generation = ++this.passthroughGeneration;
    this.passthroughPopupGenerations.delete(popupGenerationKey(transcript.sessionId, generation));
    this.activePassthroughGeneration = generation;
    this.currentSessionId = transcript.sessionId;
    this.sessionGenerations.set(transcript.sessionId, generation);
    const prompt: CodexPrompt = {
      sessionId: transcript.sessionId,
      text: transcript.text,
      language: transcript.language === "unknown" ? "mixed" : transcript.language,
      responseLanguage: this.visualSettings.responseLanguage ?? "auto",
      source: "voice",
      mode: "submit",
      metadata: {
        transcriptConfidence: transcript.confidence,
        spokenAt: transcript.endedAt
      }
    };

    this.passthroughState = "EXECUTING";
    this.sendVisualQuestion(options.visualQuestionText ?? transcript.text, options.visualQuestionReferences);
    this.sendVisualState("submitting", "sending to agent");
    await this.backend.sendPrompt(prompt);
    this.codexStatus = {
      ...this.codexStatus,
      task: "thinking"
    };
    this.passthroughState = "WAITING_CODEX";
  }

  private async handleNativeApprovalSpeech(text: string): Promise<void> {
    const pending = this.pendingPermission;
    if (!pending) return;

    const interpreted = interpretApprovalSpeech(text, this.approvalPhrases);
    let intent = interpreted.intent;

    if (intent === "unknown" && canUseTranscriptAsNativeInput(pending)) {
      intent = "approve_once";
    }

    if (intent === "unknown") {
      await this.speak("허용인지 거부인지 다시 말해줘.", "permission");
      this.passthroughState = "CONFIRMING";
      return;
    }

    const decision: PermissionDecision = {
      requestId: pending.id,
      decision: intent === "deny" ? "deny" : intent === "cancel" ? "cancel" : "allow",
      remember: intent === "approve_session" || intent === "approve_policy",
      scope: approvalScope(intent),
      decidedBy: "voice",
      transcript: text
    };

    try {
      await this.backend.sendPermission(decision);
    } catch (error) {
      await this.speak(unsupportedApprovalGuidance(intent, pending, error), "warning");
      this.passthroughState = "CONFIRMING";
      return;
    }

    if (decision.decision === "allow") {
      this.emitNativeMcpUrlReference(pending, "approved");
    }

    this.ignoreApprovalSpeechUntil = this.now() + LATE_APPROVAL_SPEECH_GRACE_MS;
    this.pendingPermission = undefined;
    if (await this.activateNextPendingPermission()) {
      return;
    }

    const nextTask = this.codexStatus.task === "waiting_permission" ? "thinking" : this.codexStatus.task;
    this.codexStatus = {
      ...this.codexStatus,
      task: nextTask,
      currentTool: decision.decision === "allow" ? this.codexStatus.currentTool : undefined
    };
    this.passthroughState = nextTask === "idle" ? "IDLE" : "WAITING_CODEX";
    this.sendVisualState(statusToVisualState(nextTask));
  }

  private async handlePassthroughPermissionRequest(request: PermissionRequest): Promise<void> {
    const generation = this.sessionGenerations.get(request.sessionId);
    if (this.isInterruptedPassthroughOutput(request.sessionId, generation) || this.isStaleForActivePassthroughTurn(request.sessionId, generation)) {
      this.writeLine(`[agent:stale:permission] ${request.command ?? request.action}`);
      this.sendVisualEvent({
        op: "voice-agent-ui",
        type: "command",
        text: `[stale permission] ${request.command ?? request.action}`
      });
      return;
    }

    await this.flushPassthroughOutputBuffers(request.sessionId);

    if (this.pendingPermission || this.pendingPermissionQueue.length > 0) {
      this.pendingPermissionQueue.push(request);
      if (!this.pendingPermission) {
        await this.activateNextPendingPermission();
      }
      return;
    }

    await this.activatePendingPermission(request);
  }

  private async activateNextPendingPermission(): Promise<boolean> {
    const next = this.pendingPermissionQueue.shift();
    if (!next) return false;

    await this.activatePendingPermission(next);
    return true;
  }

  private async activatePendingPermission(request: PermissionRequest): Promise<void> {
    this.pendingPermission = request;
    const permissionTarget = permissionTargetLabel(request);
    if (request.command) {
      this.sendVisualEvent({
        op: "voice-agent-ui",
        type: "command",
        text: request.command
      });
    }
    this.emitNativeMcpUrlReference(request, "requested");
    this.sendVisualEvent({
      op: "voice-agent-ui",
      type: "approval",
      text: approvalVisualText(permissionTarget, request, this.approvalPhrases)
    });
    this.codexStatus = {
      ...this.codexStatus,
      task: "waiting_permission",
      currentTool: request.tool
    };
    this.passthroughState = "CONFIRMING";
    await this.speak(permissionPromptText(permissionTarget), "permission");
    this.passthroughState = "CONFIRMING";
  }

  private async handlePassthroughOutput(output: CodexOutputEvent): Promise<void> {
    const text = output.text ?? output.raw ?? "";

    if (output.type === "approval_resolved") {
      this.clearResolvedPendingPermission(text);
      return;
    }

    const outputGeneration = this.sessionGenerations.get(output.sessionId);
    const interrupted = this.isInterruptedPassthroughOutput(output.sessionId, outputGeneration);
    const staleForActiveTurn = this.isStaleForActivePassthroughTurn(output.sessionId, outputGeneration);

    if (output.type === "task_complete") {
      if (interrupted || staleForActiveTurn) {
        await this.flushPassthroughOutputBuffers(output.sessionId, {
          stale: true
        });
        this.clearInterruptedPassthroughOutput(output.sessionId, outputGeneration);
        this.sessionGenerations.delete(output.sessionId);
        return;
      }

      await this.flushPassthroughOutputBuffers(output.sessionId);
      this.codexStatus = {
        ...this.codexStatus,
        task: "idle"
      };
      this.passthroughState = "IDLE";
      this.clearPendingPermissions();
      if (outputGeneration !== undefined && outputGeneration === this.activePassthroughGeneration) {
        this.activePassthroughGeneration = undefined;
      }
      if (outputGeneration !== undefined) {
        this.passthroughPopupGenerations.delete(popupGenerationKey(output.sessionId, outputGeneration));
      }
      this.sessionGenerations.delete(output.sessionId);
      this.sendVisualQuestion("");
      if (!this.passthroughStructuredSpeechSessions.has(output.sessionId)) {
        await this.speak("끝났어.", "completion");
      }
      this.passthroughStructuredSpeechSessions.delete(output.sessionId);
      return;
    }

    if (interrupted || staleForActiveTurn) {
      if (text) {
        this.handleStalePassthroughOutput(output.type, text);
      }
      return;
    }

    if (output.type === "error") {
      await this.flushPassthroughOutputBuffers(output.sessionId);
      this.passthroughState = "ERROR";
      this.sendVisualQuestion("");
      this.sendVisualEvent({
        op: "voice-agent-ui",
        type: "error",
        text: text || "오류 났어."
      });
      await this.speak(text ? `오류 났어. ${text}` : "오류 났어.", "error");
      return;
    }

    if (text) {
      await this.bufferPassthroughOutput(output.type, output.sessionId, text);
    }
  }

  private async bufferPassthroughOutput(type: CodexOutputEvent["type"], sessionId: string, text: string): Promise<void> {
    const key = passthroughOutputBufferKey(sessionId, type);
    const buffered = `${this.passthroughOutputBuffers.get(key) ?? ""}${text}`;
    const normalized = buffered.replace(/\r/g, "\n");
    const parts = normalized.split("\n");
    const completeLines = parts.slice(0, -1);
    const remainder = parts.at(-1) ?? "";

    if (completeLines.length > 0) {
      for (const line of completeLines) {
        this.handlePassthroughOutputLine(type, sessionId, line);
      }
      if (this.tryHandleStructuredPassthroughOutput(type, sessionId, remainder) || !remainder) {
        this.passthroughOutputBuffers.delete(key);
      } else {
        this.passthroughOutputBuffers.set(key, remainder);
      }
      return;
    }

    if (this.tryHandleStructuredPassthroughOutput(type, sessionId, remainder)) {
      this.passthroughOutputBuffers.delete(key);
      return;
    }

    if (remainder.length >= 2_000) {
      this.handlePassthroughOutputLine(type, sessionId, remainder);
      this.passthroughOutputBuffers.delete(key);
      return;
    }

    this.passthroughOutputBuffers.set(key, remainder);
  }

  private tryHandleStructuredPassthroughOutput(
    type: CodexOutputEvent["type"],
    sessionId: string,
    text: string
  ): boolean {
    const parsed = parseVoiceAgentEventSequence(text) ?? parseVoiceAgentEventLine(text);

    if (Array.isArray(parsed)) {
      for (const event of parsed) {
        this.handleVoiceAgentEvent(sessionId, event);
      }
      return true;
    }

    if (parsed) {
      this.handleVoiceAgentEvent(sessionId, parsed);
      return true;
    }

    return false;
  }

  private async flushPassthroughOutputBuffers(
    sessionId = this.currentBackendSessionId(),
    options: { stale?: boolean } = {}
  ): Promise<void> {
    for (const [key, text] of [...this.passthroughOutputBuffers]) {
      const parsed = parsePassthroughOutputBufferKey(key);
      if (parsed.sessionId !== sessionId) continue;

      for (const line of text.replace(/\r/g, "\n").split("\n")) {
        if (options.stale) {
          this.handleStalePassthroughOutput(parsed.type, line);
        } else {
          this.handlePassthroughOutputLine(parsed.type, sessionId, line);
        }
      }
      this.passthroughOutputBuffers.delete(key);
    }
  }

  private handlePassthroughOutputLine(type: CodexOutputEvent["type"], sessionId: string, line: string): void {
    const parsed = parseVoiceAgentEventSequence(line) ?? parseVoiceAgentEventLine(line);

    if (Array.isArray(parsed)) {
      for (const event of parsed) {
        this.handleVoiceAgentEvent(sessionId, event);
      }
      return;
    }

    if (parsed) {
      this.handleVoiceAgentEvent(sessionId, parsed);
      return;
    }

    this.printAgentOutputBlock(type, line);
  }

  private handleStalePassthroughOutput(type: CodexOutputEvent["type"], text: string): void {
    const normalized = text.replace(/\r/g, "\n").trim();
    if (!normalized) return;

    const parsed = parseVoiceAgentEventSequence(normalized) ?? parseVoiceAgentEventLine(normalized);

    if (Array.isArray(parsed)) {
      for (const event of parsed) {
        this.handleStaleVoiceAgentEvent(event);
      }
      return;
    }

    if (parsed) {
      this.handleStaleVoiceAgentEvent(parsed);
      return;
    }

    for (const line of normalized.split("\n")) {
      const visible = line.trimEnd();
      if (!visible) continue;
      this.printAgentOutputBlock(`stale:${type}`, visible);
      this.sendVisualEvent({
        op: "voice-agent-ui",
        type: "command",
        text: `[stale ${type}] ${visible}`
      });
    }
  }

  private handleStaleVoiceAgentEvent(event: VoiceAgentEvent): void {
    if (event.type === "popup") {
      this.writeLine("[agent:stale:popup] ignored stale popup");
      this.sendVisualEvent({
        op: "voice-agent-ui",
        type: "status",
        text: "stale popup ignored"
      });
      return;
    }

    this.printAgentOutputBlock(`stale:${event.type}`, event.text);
    this.sendVisualEvent({
      op: "voice-agent-ui",
      type: "command",
      text: `[stale ${event.type}] ${event.text}`
    });
  }

  private handleVoiceAgentEvent(sessionId: string, event: VoiceAgentEvent): void {
    switch (event.type) {
      case "speech":
        this.printAgentOutputBlock("speech", event.text);
        this.sendVisualEvent({
          op: "voice-agent-ui",
          type: "status",
          text: event.text
        });
        this.passthroughStructuredSpeechSessions.add(sessionId);
        this.scheduleStructuredSpeech(event);
        return;
      case "command":
        this.printAgentOutputBlock("command", event.text);
        this.sendVisualEvent({
          op: "voice-agent-ui",
          type: "command",
          text: event.text
        });
        return;
      case "status":
        this.printAgentOutputBlock("status", event.text);
        this.sendVisualEvent({
          op: "voice-agent-ui",
          type: "status",
          text: event.text
        });
        return;
      case "error":
        this.printAgentOutputBlock("error", event.text);
        this.sendVisualEvent({
          op: "voice-agent-ui",
          type: "error",
          text: event.text
        });
        this.scheduleSpeak(event.text, "error");
        return;
      case "popup":
        this.handlePopupVoiceAgentEvent(sessionId, event);
        return;
    }
  }

  private handlePopupVoiceAgentEvent(sessionId: string, event: VoiceAgentEvent): void {
    if (this.visualSettings.popupPreferred !== true) {
      this.writeLine("[agent:popup:ignored] popup preference disabled");
      return;
    }

    const generation = this.sessionGenerations.get(sessionId);
    const key = popupGenerationKey(sessionId, generation);
    if (this.passthroughPopupGenerations.has(key)) {
      this.writeLine("[agent:popup:ignored] duplicate popup for this turn");
      return;
    }

    this.passthroughPopupGenerations.add(key);
    const title = typeof event.raw.title === "string" ? event.raw.title.trim() : "";
    const format = event.raw.format === "plain" ? "plain" : "markdown";
    this.writeLine(`[agent:popup] ${title || "popup opened"}`);
    this.sendVisualEvent({
      op: "voice-agent-ui",
      type: "popup",
      text: event.text,
      ...(title ? { title } : {}),
      format
    });
    this.sendVisualEvent({
      op: "voice-agent-ui",
      type: "status",
      text: "popup opened"
    });
  }

  private printAgentOutputBlock(type: string, text: string): void {
    const visible = text.trimEnd();
    if (!visible) return;

    if (visible.includes("\n")) {
      this.writeLine(`[agent:${type}]\n${visible}`);
      return;
    }

    this.writeLine(`[agent:${type}] ${visible}`);
  }

  private shouldInterrupt(text: string): boolean {
    if (this.passthroughState !== "WAITING_CODEX" && this.passthroughState !== "EXECUTING") {
      return false;
    }

    const normalized = text.trim().replace(/\s+/g, " ").toLowerCase();
    return ["멈춰", "그만", "취소해", "잠깐", "stop", "cancel", "hold on"].some((phrase) =>
      normalized.includes(phrase)
    );
  }

  private async speak(
    text: string,
    category: VoiceMessage["category"],
    visualOptions: SpeakVisualOptions = {}
  ): Promise<void> {
    const message: VoiceMessage = {
      id: this.createId("voice"),
      text,
      language: voiceMessageLanguage(text),
      priority: category === "warning" ? "urgent" : "normal",
      interruptible: category !== "permission",
      category
    };

    if (message.priority === "urgent") {
      this.voiceGeneration += 1;
      this.voiceQueue = Promise.resolve();
      this.permissionCueMessageIds.clear();
      this.ttsPlaybackState.recordStopped(this.now());
      await this.voiceOutput.stop();
      this.ttsPlaybackState.recordQueued(message, this.now());
      await this.speakQueuedMessage(message, this.voiceGeneration, visualOptions);
      return;
    }

    this.ttsPlaybackState.recordQueued(message, this.now());
    const generation = this.voiceGeneration;
    const task = this.voiceQueue
      .catch(() => {})
      .then(() => this.speakQueuedMessage(message, generation, visualOptions));

    this.voiceQueue = task.catch(() => {});
    await task;
  }

  private async cancelQueuedVoiceOutput(): Promise<void> {
    this.voiceGeneration += 1;
    this.progressVoiceGeneration += 1;
    this.voiceQueue = Promise.resolve();
    this.permissionCueMessageIds.clear();
    this.ttsPlaybackState.recordStopped(this.now());
    await this.voiceOutput.stop();
  }

  private startAgentTurn(): void {
    this.progressVoiceGeneration += 1;
  }

  private clearStalePassthroughOutput(): void {
    this.progressVoiceGeneration += 1;
    this.passthroughOutputBuffers.clear();
    this.passthroughStructuredSpeechSessions.clear();
  }

  private clearPendingPermissions(): void {
    this.pendingPermission = undefined;
    this.pendingPermissionQueue.length = 0;
  }

  private clearResolvedPendingPermission(requestId: string): void {
    if (!requestId) return;

    if (this.pendingPermission?.id === requestId) {
      this.pendingPermission = undefined;
      void this.activateNextPendingPermission();
      return;
    }

    const index = this.pendingPermissionQueue.findIndex((request) => request.id === requestId);
    if (index !== -1) this.pendingPermissionQueue.splice(index, 1);
  }

  private markCurrentPassthroughSessionInterrupted(): void {
    if (this.runtime) return;
    const sessionId = this.currentBackendSessionId();
    const generation = this.sessionGenerations.get(sessionId);
    this.interruptedPassthroughSessions.add(sessionId);
    if (generation !== undefined) {
      this.interruptedPassthroughGenerations.add(generation);
      if (this.activePassthroughGeneration === generation) {
        this.activePassthroughGeneration = undefined;
      }
    }
  }

  private isInterruptedPassthroughOutput(sessionId: string, generation: number | undefined): boolean {
    return (
      this.interruptedPassthroughSessions.has(sessionId) ||
      (generation !== undefined && this.interruptedPassthroughGenerations.has(generation))
    );
  }

  private isStaleForActivePassthroughTurn(sessionId: string, generation: number | undefined): boolean {
    if (this.activePassthroughGeneration === undefined) return false;
    if (generation === undefined) return false;
    if (generation === this.activePassthroughGeneration) return false;
    return this.sessionGenerations.has(sessionId);
  }

  private clearInterruptedPassthroughOutput(sessionId: string, generation: number | undefined): void {
    this.interruptedPassthroughSessions.delete(sessionId);
    if (generation !== undefined) {
      this.interruptedPassthroughGenerations.delete(generation);
    }
    this.passthroughStructuredSpeechSessions.delete(sessionId);
  }

  private async speakQueuedMessage(
    message: VoiceMessage,
    generation: number,
    visualOptions: SpeakVisualOptions = {}
  ): Promise<void> {
    if (generation !== this.voiceGeneration) return;

    this.lastSpokenText = message.text;
    if (message.category === "permission") {
      this.permissionCueMessageIds.add(message.id);
    }
    this.ttsPlaybackState.recordStart(message, this.now());
    if (visualOptions.visualState) {
      this.sendVisualEvent({
        op: "voice-agent-ui",
        type: "state",
        state: visualOptions.visualState,
        text: visualOptions.visualText ?? message.text
      });
      await this.voiceOutput.speak(message);
      return;
    }

    if (message.category === "permission" && this.currentVisualState() === "approval_pending") {
      this.sendVisualState("approval_pending");
      await this.voiceOutput.speak(message);
      return;
    }

    this.sendVisualEvent({
      op: "voice-agent-ui",
      type: "state",
      state: "speaking",
      text: message.text
    });
    await this.voiceOutput.speak(message);
  }

  private restoreVisualStateAfterSpeech(): void {
    this.restoreCurrentVisualState();
  }

  private playPermissionReadyCue(id: string): void {
    if (!this.permissionCueMessageIds.delete(id)) return;
    if (!this.hasPendingApproval()) return;

    this.writeLine("[voice:cue] approval ready \u0007");
  }

  private scheduleSpeak(text: string, category: VoiceMessage["category"]): void {
    const task = this.speak(text, category);
    this.scheduledVoiceTasks.add(task);
    task.finally(() => {
      this.scheduledVoiceTasks.delete(task);
    });
  }

  private scheduleStructuredSpeech(event: VoiceAgentEvent): void {
    if (event.role === "progress") {
      this.scheduleProgressSpeak(event.text);
      return;
    }

    if (event.role === "final") {
      this.progressVoiceGeneration += 1;
      this.scheduleSpeak(event.text, "completion");
      return;
    }

    this.scheduleSpeak(event.text, "speech");
  }

  private scheduleProgressSpeak(text: string): void {
    const message: VoiceMessage = {
      id: this.createId("voice"),
      text,
      language: voiceMessageLanguage(text),
      priority: "low",
      interruptible: true,
      category: "speech"
    };
    const generation = this.voiceGeneration;
    const progressGeneration = ++this.progressVoiceGeneration;
    this.ttsPlaybackState.recordQueued(message, this.now());
    const task = this.voiceQueue
      .catch(() => {})
      .then(() => {
        if (generation !== this.voiceGeneration || progressGeneration !== this.progressVoiceGeneration) return undefined;
        return this.speakQueuedMessage(message, generation);
      });

    this.voiceQueue = task.catch(() => {});
    this.scheduledVoiceTasks.add(task);
    task.finally(() => {
      this.scheduledVoiceTasks.delete(task);
    });
  }

  private async handleSlashCommand(line: string): Promise<HarnessLineResult> {
    const { command, argument } = parseSlashCommand(line);

    switch (command) {
      case "/help":
        this.printHelp();
        return "continue";
      case "/status":
        this.printStatus();
        return "continue";
      case "/permission":
        await this.requestPermission(argument);
        return "continue";
      case "/complete":
        await this.handleMockOutput("task_complete", "Task complete");
        return "continue";
      case "/error":
        await this.handleMockOutput("error", argument || "Harness error");
        return "continue";
      case "/tts-stop":
        await this.stopVoiceOutput();
        this.writeLine("[tts] stopped.");
        return "continue";
      case "/quit":
        await this.stop();
        this.writeLine("Harness stopped.");
        return "quit";
      default:
        this.writeLine(`[harness] unknown command: ${command}`);
        this.writeLine("Type /help to show available commands.");
        return "continue";
    }
  }

  private printHelp(): void {
    this.writeLine("Commands:");
    this.writeLine("  /help shows this command list.");
    this.writeLine("  /status shows the current agent status.");
    if (this.runtime) {
      this.writeLine("  /permission <command> asks for a mock command approval.");
      this.writeLine("  /complete emits a mock task completion.");
      this.writeLine("  /error <message> emits a mock harness error.");
    }
    this.writeLine("  /tts-stop stops current TTS playback.");
    this.writeLine("  /quit exits Voice Agent.");
  }

  private async requestPermission(command: string): Promise<void> {
    if (!command) {
      this.writeLine("[harness] usage: /permission <command>");
      return;
    }

    if (!this.runtime) {
      this.writeLine("[harness] /permission is only available with the mock backend. In real mode, wait for the agent to request permission.");
      return;
    }

    const request = createPermissionRequest(command, this.currentBackendSessionId(), this.createId("perm"), this.now());

    if (!recordPermissionRequest(this.backend, request)) {
      this.writeLine("[harness] /permission is only available with the mock backend. In real mode, wait for Codex to request permission.");
      return;
    }

    await this.runtime.handlePermissionRequest(request);
  }

  private async handleMockOutput(type: "task_complete" | "error", text: string): Promise<void> {
    if (!this.runtime) {
      this.writeLine(`[harness] /${type === "task_complete" ? "complete" : "error"} is only available with the mock backend.`);
      return;
    }

    const output: CodexOutputEvent = {
      sessionId: this.currentBackendSessionId(),
      type,
      text,
      timestamp: this.now()
    };

    recordOutput(this.backend, output);
    await this.runtime.handleCodexOutput(output);
  }

  private createTranscript(text: string): Transcript {
    const now = this.now();
    const normalizedText = normalizeTranscriptText(text);

    return {
      id: this.createId("tr"),
      sessionId: this.currentTranscriptSessionId(),
      text,
      normalizedText,
      language: detectTranscriptLanguage(normalizedText),
      confidence: 0.99,
      startedAt: now,
      endedAt: now
    };
  }

  private currentTranscriptSessionId(): string {
    if (!this.runtime) {
      if (this.pendingPermission) {
        this.currentSessionId = this.pendingPermission.sessionId;
        return this.currentSessionId;
      }

      if (["EXECUTING", "WAITING_CODEX", "CONFIRMING"].includes(this.passthroughState) && this.currentSessionId) {
        return this.currentSessionId;
      }

      this.currentSessionId = this.createId("sess");
      return this.currentSessionId;
    }

    const context = this.runtime.getContext();

    if (context.pendingPermission) {
      this.currentSessionId = context.pendingPermission.sessionId;
      return this.currentSessionId;
    }

    if (context.state === "WAITING_CODEX" && context.activeSessionId) {
      this.currentSessionId = context.activeSessionId;
      return this.currentSessionId;
    }

    this.currentSessionId = this.createId("sess");
    return this.currentSessionId;
  }

  private currentBackendSessionId(): string {
    if (!this.runtime) {
      this.currentSessionId = this.currentSessionId ?? this.createId("sess");
      return this.currentSessionId;
    }

    const context = this.runtime.getContext();
    this.currentSessionId = context.activeSessionId ?? this.currentSessionId ?? this.createId("sess");
    return this.currentSessionId;
  }

  private printStatus(): void {
    if (!this.runtime) {
      const session = this.currentSessionId ? ` session=${this.currentSessionId}` : "";
      const pending = this.pendingPermission
        ? ` pending=${this.pendingPermission.command ?? this.pendingPermission.action} risk=${this.pendingPermission.riskLevel}`
        : "";

      this.writeLine(
        `[status] state=${this.passthroughState} agent=${this.agentTarget} backend=${this.backendLabel} ` +
          `codex=${this.codexStatus.process}/${this.codexStatus.task}${session}${pending}`
      );
      return;
    }

    const context = this.runtime.getContext();
    const session = context.activeSessionId ? ` session=${context.activeSessionId}` : "";
    const pending = context.pendingPermission
      ? ` pending=${context.pendingPermission.command ?? context.pendingPermission.action} risk=${context.pendingPermission.riskLevel}`
      : "";

    this.writeLine(
      `[status] state=${context.state} codex=${context.codexStatus.process}/${context.codexStatus.task}${session}${pending}`
    );
  }

  private async handleVisualControl(event: VisualControlEvent): Promise<void> {
    switch (event.action) {
      case "tts_stop":
        await this.stopVoiceOutput();
        return;
      case "mic_toggle":
        return;
      case "emergency_stop":
        await this.requestEmergencyStop();
        return;
      case "clear_commands":
        this.sendVisualEvent({
          op: "voice-agent-ui",
          type: "status",
          text: "commands cleared"
        });
        return;
      case "add_context":
      case "clear_context":
      case "show_context":
      case "update_wake_phrases":
        return;
      case "update_approval_phrases":
        await this.updateApprovalPhrases(event.approvalPhrases ?? {});
        return;
      case "reset_settings":
        await this.resetVisualSettings();
        return;
      case "update_codex_thread_id":
        await this.updateCodexThreadSettings(event.codexThreadId ?? event.text ?? "", event.codexAlwaysStartNewThread);
        return;
      case "update_tts_settings":
        await this.updateTtsSettings(event.tts ?? {});
        return;
      case "update_visual_settings":
        await this.updateVisualSettings(event.visual ?? {});
        return;
      case "exit":
        await this.requestExit();
        return;
    }
  }

  private async requestEmergencyStop(): Promise<void> {
    await this.cancelQueuedVoiceOutput();
    this.clearStalePassthroughOutput();

    this.writeLine(`[visual] emergency stop requested for ${this.agentTarget}.`);
    this.sendVisualEvent({
      op: "voice-agent-ui",
      type: "status",
      text: "emergency stop requested"
    });

    try {
      if (this.runtime) {
        await this.runtime.interruptActiveTurn("Emergency stop requested from visual");
      } else {
        this.passthroughState = "INTERRUPTING";
        this.markCurrentPassthroughSessionInterrupted();
        await this.backend.interrupt("Emergency stop requested from visual");
        this.clearPendingPermissions();
        this.codexStatus = {
          ...this.codexStatus,
          task: "idle"
        };
        this.passthroughState = "IDLE";
      }
    } catch (error) {
      if (!this.runtime) {
        this.passthroughState = "ERROR";
      }
      this.sendVisualEvent({
        op: "voice-agent-ui",
        type: "error",
        text: `emergency stop failed: ${formatError(error)}`
      });
      await this.speak(`정지 실패. ${formatError(error)}`, "error");
      return;
    }

    this.sendVisualQuestion("");
    this.sendVisualState("idle");
    await this.speak("정지했어.", "status");
  }

  private async requestExit(): Promise<void> {
    if (this.exitRequested) return;

    this.exitRequested = true;
    this.writeLine("[visual] exit requested. Shutting down harness.");

    if (this.onExitRequest) {
      await this.onExitRequest();
      return;
    }

    await this.stop();
  }

  sendVisualEvent(event: VisualEvent): void {
    this.visualBridge?.send(event);
  }

  private emitNativeMcpUrlReference(request: PermissionRequest, phase: "requested" | "approved"): void {
    const url = nativeMcpElicitationUrl(request);
    if (!url) return;

    const text = `${phase === "approved" ? "MCP URL approved" : "MCP URL requested"}:\n${url}`;
    this.printAgentOutputBlock("command", text);
    this.sendVisualEvent({
      op: "voice-agent-ui",
      type: "command",
      text
    });
  }

  private sendVisualTtsSettings(): void {
    this.sendVisualEvent({
      op: "voice-agent-ui",
      type: "settings",
      tts: this.currentVisualTtsSettings(),
      visual: this.currentVisualRuntimeSettings(),
      approvalPhrases: this.currentVisualApprovalPhrases(),
      codexThreadId: this.codexThreadId ?? "",
      codexAlwaysStartNewThread: this.codexAlwaysStartNewThread
    });
  }

  private sendVisualUsage(rateLimits: CodexRateLimits): void {
    const selected = rateLimits.selected;
    const text = selected?.text ?? "";
    if (!text || text === this.lastVisualUsageText) return;

    this.lastVisualUsageText = text;
    this.sendVisualEvent({
      op: "voice-agent-ui",
      type: "usage",
      text,
      ...(selected?.primary ? { primaryText: formatVisualRateLimitWindow(selected.primary) } : {}),
      ...(selected?.secondary ? { secondaryText: formatVisualRateLimitWindow(selected.secondary) } : {}),
      updatedAt: rateLimits.updatedAt
    });
  }

  private async updateTtsSettings(settings: VisualTtsSettings): Promise<void> {
    const sanitized = sanitizeVisualTtsSettings(settings);
    const applied = this.voiceOutput.updateSettings?.(sanitized) ?? sanitized;
    this.sendVisualEvent({
      op: "voice-agent-ui",
      type: "settings",
      tts: visualTtsSettingsFromVoiceOutput(applied)
    });
    await this.persistSettings({
      tts: ttsFileConfigFromVisualSettings(visualTtsSettingsFromVoiceOutput(applied))
    });
    this.sendVisualEvent({
      op: "voice-agent-ui",
      type: "status",
      text: "TTS settings updated"
    });
  }

  private async resetVisualSettings(): Promise<void> {
    const applied = this.voiceOutput.updateSettings?.(defaultVisualTtsSettings()) ?? defaultVisualTtsSettings();
    this.visualSettings = defaultVisualRuntimeSettings();
    this.approvalPhrases = approvalPhraseSet();
    this.codexAlwaysStartNewThread = false;
    await this.persistResetSettings();
    this.sendVisualEvent({
      op: "voice-agent-ui",
      type: "settings",
      tts: visualTtsSettingsFromVoiceOutput(applied),
      visual: this.currentVisualRuntimeSettings(),
      approvalPhrases: this.currentVisualApprovalPhrases(),
      codexAlwaysStartNewThread: this.codexAlwaysStartNewThread
    });
    this.sendVisualEvent({
      op: "voice-agent-ui",
      type: "status",
      text: "TTS settings restored"
    });
  }

  private async updateVisualSettings(settings: VisualRuntimeSettings): Promise<void> {
    this.visualSettings = sanitizeVisualRuntimeSettings(settings, this.visualSettings);
    this.updateBackendProtocolPrompt();
    this.sendVisualEvent({
      op: "voice-agent-ui",
      type: "settings",
      visual: this.currentVisualRuntimeSettings()
    });
    await this.persistSettings({
      visual: this.currentVisualRuntimeSettings()
    });
  }

  private updateBackendProtocolPrompt(): void {
    this.backend.setVoiceAgentProtocolPrompt?.(voiceAgentProtocolPromptForSettings({
      popupPreferred: this.visualSettings.popupPreferred === true
    }));
  }

  private async updateApprovalPhrases(phrases: VisualApprovalPhrases): Promise<void> {
    this.approvalPhrases = approvalPhraseSet(phrases);
    const approvalPhrases = this.currentVisualApprovalPhrases();
    this.sendVisualEvent({
      op: "voice-agent-ui",
      type: "settings",
      approvalPhrases
    });
    await this.persistSettings({
      approvalPhrases
    });
    if (this.currentVisualState() === "approval_pending") {
      this.sendVisualState("approval_pending");
    }
  }

  private async updateCodexThreadSettings(threadId: string, alwaysStartNewThread?: boolean): Promise<void> {
    this.codexThreadId = parseOptionalThreadId(threadId);
    if (alwaysStartNewThread !== undefined) {
      this.codexAlwaysStartNewThread = alwaysStartNewThread;
    }
    this.sendVisualEvent({
      op: "voice-agent-ui",
      type: "settings",
      codexThreadId: this.codexThreadId ?? "",
      codexAlwaysStartNewThread: this.codexAlwaysStartNewThread
    });
    await this.persistSettings({
      codexThreadId: this.codexThreadId ?? null,
      codexAlwaysStartNewThread: this.codexAlwaysStartNewThread
    });
    this.sendVisualEvent({
      op: "voice-agent-ui",
      type: "status",
      text: this.codexAlwaysStartNewThread
        ? "Codex will start a new thread on next restart"
        : this.codexThreadId
          ? "Codex will resume the saved thread on next restart"
          : "Codex thread id cleared"
    });
  }

  private currentVisualTtsSettings(): VisualTtsSettings {
    return visualTtsSettingsFromVoiceOutput(this.voiceOutput.getSettings?.() ?? {});
  }

  private currentVisualRuntimeSettings(): VisualRuntimeSettings {
    return {
      thinkingVolume: this.visualSettings.thinkingVolume ?? defaultVisualThinkingVolume,
      responseLanguage: this.visualSettings.responseLanguage ?? "auto",
      chatHistoryEnabled: this.visualSettings.chatHistoryEnabled ?? true,
      hudEnabled: this.visualSettings.hudEnabled ?? true,
      hudCompact: this.visualSettings.hudCompact ?? false,
      popupPreferred: this.visualSettings.popupPreferred ?? false,
      speakWakeRejectedWarnings: this.visualSettings.speakWakeRejectedWarnings ?? true,
      maxUtteranceSeconds: this.visualSettings.maxUtteranceSeconds ?? defaultMaxUtteranceSeconds
    };
  }

  private currentVisualApprovalPhrases(): VisualApprovalPhrases {
    return {
      onceApprove: [...this.approvalPhrases.onceApprove],
      deny: [...this.approvalPhrases.deny],
      cancel: [...this.approvalPhrases.cancel],
      sessionApprove: [...this.approvalPhrases.sessionApprove],
      policyApprove: [...this.approvalPhrases.policyApprove],
      networkPolicyApprove: [...this.approvalPhrases.networkPolicyApprove]
    };
  }

  private async persistSettings(overrides: {
    tts?: ReturnType<typeof ttsFileConfigFromVisualSettings>;
    visual?: VoiceVisualFileConfig;
    approvalPhrases?: ApprovalPhraseConfig;
    codexThreadId?: string | null;
    codexAlwaysStartNewThread?: boolean;
  }): Promise<void> {
    try {
      await this.settingsPersistence?.update(overrides);
    } catch (error) {
      this.writeLine(`[settings:error] ${formatError(error)}`);
    }
  }

  private async persistResetSettings(): Promise<void> {
    try {
      await this.settingsPersistence?.resetAll();
    } catch (error) {
      this.writeLine(`[settings:error] ${formatError(error)}`);
    }
  }

  private sendVisualState(state: VisualUiState, text?: string): void {
    const visualState = state === "idle" && this.isAgentRequestActive() ? this.currentVisualState() : state;
    const visualText = text ?? (visualState === "approval_pending" ? this.currentApprovalVisualText() : undefined);

    if (visualState === "approval_pending") {
      this.sendVisualEvent({
        op: "voice-agent-ui",
        type: "state",
        state: visualState,
        ...(visualText ? { text: visualText } : {})
      });
      return;
    }

    if (visualState !== "speaking" && visualState !== "shutdown" && this.ttsPlaybackState.isSpeaking()) {
      this.sendVisualEvent({
        op: "voice-agent-ui",
        type: "state",
        state: "speaking",
        ...(this.lastSpokenText ? { text: this.lastSpokenText } : {})
      });
      return;
    }

    this.sendVisualEvent({
      op: "voice-agent-ui",
      type: "state",
      state: visualState,
      ...(visualText ? { text: visualText } : {})
    });
  }

  private sendVisualQuestion(text: string, references?: string[]): void {
    this.sendVisualEvent({
      op: "voice-agent-ui",
      type: "question",
      text: compactVisualQuestion(text),
      ...(references && references.length > 0 ? { references: references.map((entry) => entry.trim()).filter(Boolean) } : {})
    });
  }

  currentVisualState(): VisualUiState {
    if (this.runtime) {
      const context = this.runtime.getContext();
      if (context.pendingPermission) return "approval_pending";
      const statusState = statusToVisualState(context.codexStatus.task);
      if (statusState !== "idle") return statusState;
      return runtimeStateToVisualState(context.state);
    }

    if (this.pendingPermission) return "approval_pending";
    const statusState = statusToVisualState(this.codexStatus.task);
    if (statusState !== "idle") return statusState;
    return runtimeStateToVisualState(this.passthroughState);
  }

  private currentApprovalVisualText(): string | undefined {
    const request = this.runtime?.getContext().pendingPermission ?? this.pendingPermission;
    if (!request) return undefined;
    return approvalVisualText(request.command ? "명령" : "작업", request, this.approvalPhrases);
  }

  private printStartupBanner(): void {
    const accent = "\x1b[1;36m";
    const dim = "\x1b[2m";
    const reset = "\x1b[0m";
    const mode = this.runtime ? "MOCK RUNTIME" : "REAL PASS-THROUGH";
    const agent = this.runtime ? "mock" : this.agentTarget.toUpperCase();

    this.writeLine("");
    this.writeLine(`${accent}+------------------------------------------------------+${reset}`);
    this.writeLine(`${accent}|              VOICE AGENT HARNESS READY              |${reset}`);
    this.writeLine(`${accent}+------------------------------------------------------+${reset}`);
    this.writeLine(`  backend: ${this.backendLabel}`);
    this.writeLine(`  mode:    ${mode}`);
    this.writeLine(`  agent:   ${agent}`);
    this.writeLine(`${dim}  Local layer does not classify coding intent in real mode.${reset}`);
    this.writeLine("");
  }
}

export async function runTerminalHarness(): Promise<void> {
  const writeLine = (line: string): void => {
    stdout.write(`${line}\n`);
  };
  const harness = createTerminalHarnessFromArgs(process.argv.slice(2), { writeLine });

  await harness.start();
  const readline = createInterface({
    input: stdin,
    output: stdout,
    prompt: "> "
  });
  promptIfOpen(readline);

  try {
    for await (const line of readline) {
      try {
        const result = await harness.processLine(line);
        if (result === "quit") break;
      } catch (error) {
        writeLine(`[harness:error] ${formatError(error)}`);
      }

      promptIfOpen(readline);
    }
  } finally {
    closeReadline(readline);
    await harness.stop();
  }
}

export interface HarnessCliOptions {
  backendMode: "mock" | "codex" | "claude";
  codexCommand: string;
  codexArgs: string[];
  codexApprovalPolicy?: CodexApprovalPolicy;
  codexThreadId?: string;
  claudeCommand: string;
  cwd: string;
  tts?: TtsCliOptions;
}

export function createTerminalHarnessFromArgs(
  args: string[],
  options: Omit<TerminalHarnessOptions, "backend" | "backendLabel"> = {}
): TerminalHarness {
  const cli = parseHarnessCliArgs(args);

  if (cli.backendMode === "codex") {
    const envCodexThreadId = parseOptionalThreadId((options.env ?? process.env).VOICE_AGENT_CODEX_THREAD_ID);
    const codexThreadId = parseOptionalThreadId(cli.codexThreadId ?? envCodexThreadId ?? options.codexThreadId);
    const codexAlwaysStartNewThread = options.codexAlwaysStartNewThread === true && !cli.codexThreadId && !envCodexThreadId;
    const codexApprovalPolicy = resolveCodexApprovalPolicy(cli.codexApprovalPolicy, options.env);

    return new TerminalHarness({
      ...options,
      codexThreadId,
      codexAlwaysStartNewThread,
      ttsCli: cli.tts,
      cwd: cli.cwd,
      backendLabel: "codex",
      routingMode: "passthrough",
      agentTarget: "codex",
      backend: new CodexAppServerBackend({
        command: cli.codexCommand,
        args: cli.codexArgs,
        cwd: cli.cwd,
        voiceAgentProtocol: true,
        now: options.now,
        writeLine: options.writeLine,
        threadId: codexAlwaysStartNewThread ? undefined : codexThreadId,
        alwaysStartNewThread: codexAlwaysStartNewThread,
        approvalPolicy: codexApprovalPolicy,
        threadStore: createCodexThreadStore({
          cwd: cli.cwd,
          env: options.env
        })
      })
    });
  }

  if (cli.backendMode === "claude") {
    return new TerminalHarness({
      ...options,
      ttsCli: cli.tts,
      cwd: cli.cwd,
      backendLabel: "claude",
      routingMode: "passthrough",
      agentTarget: "claude",
      backend: new ClaudeCodeBackend({
        command: cli.claudeCommand,
        cwd: cli.cwd,
        now: options.now,
        writeLine: options.writeLine
      })
    });
  }

  return new TerminalHarness({
    ...options,
    ttsCli: cli.tts,
    cwd: cli.cwd,
    backendLabel: "mock",
    routingMode: "runtime",
    agentTarget: "codex"
  });
}

export function parseHarnessCliArgs(args: string[], defaultCwd = process.cwd()): HarnessCliOptions {
  const separator = args.indexOf("--");
  const harnessArgs = separator === -1 ? args : args.slice(0, separator);
  const extraCodexArgs = separator === -1 ? [] : args.slice(separator + 1);
  let backendMode: HarnessCliOptions["backendMode"] = "mock";
  let codexCommand = "codex";
  let codexApprovalPolicy: CodexApprovalPolicy | undefined;
  let codexThreadId: string | undefined;
  let claudeCommand = "claude";
  let cwd = defaultCwd;
  let tts: TtsCliOptions | undefined;

  for (let index = 0; index < harnessArgs.length; index += 1) {
    const arg = harnessArgs[index];

    switch (arg) {
      case "--mock":
        backendMode = "mock";
        break;
      case "--codex":
      case "--real":
        backendMode = "codex";
        break;
      case "--claude":
        backendMode = "claude";
        break;
      case "--codex-command":
        codexCommand = requiredValue(harnessArgs, ++index, "--codex-command");
        break;
      case "--codex-thread-id":
        codexThreadId = requiredValue(harnessArgs, ++index, "--codex-thread-id");
        break;
      case "--codex-approval-policy":
        codexApprovalPolicy = parseRequiredCodexApprovalPolicy(requiredValue(harnessArgs, ++index, "--codex-approval-policy"));
        break;
      case "--claude-command":
        claudeCommand = requiredValue(harnessArgs, ++index, "--claude-command");
        break;
      case "--cwd":
        cwd = requiredValue(harnessArgs, ++index, "--cwd");
        break;
      case "--tts":
        tts = {
          ...tts,
          enabled: true
        };
        break;
      case "--no-tts":
        tts = {
          ...tts,
          enabled: false
        };
        break;
      case "--tts-provider":
        tts = {
          ...tts,
          enabled: true,
          provider: parseRequiredTtsProvider(requiredValue(harnessArgs, ++index, "--tts-provider"))
        };
        break;
      case "--tts-voice":
        tts = {
          ...tts,
          enabled: true,
          voiceName: requiredValue(harnessArgs, ++index, "--tts-voice")
        };
        break;
      case "--tts-gender":
        tts = {
          ...tts,
          enabled: true,
          gender: parseRequiredTtsGender(requiredValue(harnessArgs, ++index, "--tts-gender"))
        };
        break;
      case "--tts-rate":
        tts = {
          ...tts,
          enabled: true,
          rate: parseRequiredTtsRate(requiredValue(harnessArgs, ++index, "--tts-rate"))
        };
        break;
      case "--tts-language":
        tts = {
          ...tts,
          enabled: true,
          language: parseRequiredTtsLanguage(requiredValue(harnessArgs, ++index, "--tts-language"))
        };
        break;
      case "--tts-pitch":
        tts = {
          ...tts,
          enabled: true,
          pitch: parseRequiredNumber(requiredValue(harnessArgs, ++index, "--tts-pitch"), "--tts-pitch")
        };
        break;
      case "--tts-volume":
        tts = {
          ...tts,
          enabled: true,
          volume: parseRequiredNumber(requiredValue(harnessArgs, ++index, "--tts-volume"), "--tts-volume")
        };
        break;
      default:
        extraCodexArgs.push(arg);
    }
  }

  return {
    backendMode,
    codexCommand,
    codexArgs: ["app-server", "--listen", "ws://127.0.0.1:0", ...extraCodexArgs],
    ...(codexApprovalPolicy ? { codexApprovalPolicy } : {}),
    ...(codexThreadId ? { codexThreadId } : {}),
    claudeCommand,
    cwd,
    ...(tts ? { tts } : {})
  };
}

function parseSlashCommand(line: string): { command: string; argument: string } {
  const firstSpace = line.search(/\s/);

  if (firstSpace === -1) {
    return {
      command: line.toLowerCase(),
      argument: ""
    };
  }

  return {
    command: line.slice(0, firstSpace).toLowerCase(),
    argument: line.slice(firstSpace).trim()
  };
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

function createPermissionRequest(command: string, sessionId: string, id: string, now: number): PermissionRequest {
  return {
    id,
    sessionId,
    tool: "shell",
    action: "run_command",
    command,
    riskLevel: "medium",
    rawText: `Run command: ${command} ?`,
    createdAt: now
  };
}

function recordPermissionRequest(backend: AgentBackend, request: PermissionRequest): boolean {
  const recorder = backend as AgentBackend & {
    recordPermissionRequest?: (permissionRequest: PermissionRequest) => void;
  };

  if (!recorder.recordPermissionRequest) return false;

  recorder.recordPermissionRequest(request);
  return true;
}

function recordOutput(backend: AgentBackend, output: CodexOutputEvent): void {
  const recorder = backend as AgentBackend & {
    recordOutput?: (event: CodexOutputEvent) => void;
  };

  recorder.recordOutput?.(output);
}

function requiredValue(args: string[], index: number, option: string): string {
  const value = args[index];

  if (!value) {
    throw new Error(`${option} requires a value.`);
  }

  return value;
}

function parseOptionalThreadId(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

function resolveCodexApprovalPolicy(cliValue: CodexApprovalPolicy | undefined, env: NodeJS.ProcessEnv | undefined): CodexApprovalPolicy {
  const envValue = parseCodexApprovalPolicy(env?.VOICE_AGENT_CODEX_APPROVAL_POLICY ?? process.env.VOICE_AGENT_CODEX_APPROVAL_POLICY);
  return cliValue ?? envValue ?? "on-request";
}

function parseRequiredCodexApprovalPolicy(value: string): CodexApprovalPolicy {
  const policy = parseCodexApprovalPolicy(value);
  if (!policy) throw new Error(`Unsupported --codex-approval-policy value: ${value}.`);
  return policy;
}

function parseCodexApprovalPolicy(value: string | undefined): CodexApprovalPolicy | undefined {
  const normalized = value?.trim();
  if (
    normalized === "on-request" ||
    normalized === "untrusted" ||
    normalized === "on-failure" ||
    normalized === "never"
  ) {
    return normalized;
  }

  return undefined;
}

function parseRequiredTtsProvider(value: string): NonNullable<TtsCliOptions["provider"]> {
  const provider = parseTtsProvider(value);
  if (!provider) throw new Error(`Unsupported --tts-provider value: ${value}.`);
  return provider;
}

function parseRequiredTtsGender(value: string): NonNullable<TtsCliOptions["gender"]> {
  const gender = parseTtsGender(value);
  if (!gender) throw new Error(`Unsupported --tts-gender value: ${value}.`);
  return gender;
}

function parseRequiredTtsLanguage(value: string): NonNullable<TtsCliOptions["language"]> {
  const language = parseTtsLanguage(value);
  if (!language) throw new Error(`Unsupported --tts-language value: ${value}.`);
  return language;
}

function parseRequiredTtsRate(value: string): number {
  const rate = parseTtsRate(value);
  if (rate === undefined) throw new Error(`Unsupported --tts-rate value: ${value}.`);
  return rate;
}

function parseRequiredNumber(value: string, option: string): number {
  const parsed = parseOptionalNumber(value);
  if (parsed === undefined) throw new Error(`${option} requires a numeric value.`);
  return parsed;
}

function sanitizeVisualTtsSettings(settings: VisualTtsSettings): VisualTtsSettings {
  return {
    ...(settings.language ? { language: settings.language } : {}),
    ...(settings.voiceName !== undefined ? { voiceName: settings.voiceName.trim() } : {}),
    ...(settings.gender ? { gender: settings.gender } : {}),
    ...(settings.rate !== undefined ? { rate: clamp(settings.rate, 0.1, 1) } : {}),
    ...(settings.pitch !== undefined ? { pitch: clamp(settings.pitch, 0.5, 2) } : {}),
    ...(settings.volume !== undefined ? { volume: clamp(settings.volume, 0, 1) } : {})
  };
}

function defaultVisualTtsSettings(): VisualTtsSettings {
  return {
    language: "auto",
    voiceName: "",
    gender: "auto",
    rate: 0.56,
    pitch: 1,
    volume: 1
  };
}

function defaultVisualRuntimeSettings(): VisualRuntimeSettings {
  return {
    thinkingVolume: defaultVisualThinkingVolume,
    responseLanguage: "auto",
    chatHistoryEnabled: true,
    hudEnabled: true,
    hudCompact: false,
    popupPreferred: false,
    speakWakeRejectedWarnings: true,
    maxUtteranceSeconds: defaultMaxUtteranceSeconds
  };
}

function visualTtsSettingsFromVoiceOutput(settings: VisualTtsSettings): VisualTtsSettings {
  return {
    language: settings.language ?? "auto",
    ...(settings.voiceName ? { voiceName: settings.voiceName } : {}),
    gender: settings.gender ?? "auto",
    rate: settings.rate ?? 0.56,
    ...(settings.pitch !== undefined ? { pitch: settings.pitch } : { pitch: 1 }),
    ...(settings.volume !== undefined ? { volume: settings.volume } : { volume: 1 })
  };
}

function visualRuntimeSettingsFromFile(settings: VoiceVisualFileConfig | undefined): VisualRuntimeSettings {
  return sanitizeVisualRuntimeSettings({
    thinkingVolume: parsePersistedNumber(settings?.thinkingVolume),
    responseLanguage: parseVisualResponseLanguage(settings?.responseLanguage),
    chatHistoryEnabled: typeof settings?.chatHistoryEnabled === "boolean" ? settings.chatHistoryEnabled : undefined,
    hudEnabled: typeof settings?.hudEnabled === "boolean" ? settings.hudEnabled : undefined,
    hudCompact: typeof settings?.hudCompact === "boolean" ? settings.hudCompact : undefined,
    popupPreferred: typeof settings?.popupPreferred === "boolean" ? settings.popupPreferred : undefined,
    speakWakeRejectedWarnings: typeof settings?.speakWakeRejectedWarnings === "boolean"
      ? settings.speakWakeRejectedWarnings
      : undefined,
    maxUtteranceSeconds: settings?.maxUtteranceSeconds !== undefined
      ? sanitizeMaxUtteranceSeconds(settings.maxUtteranceSeconds)
      : undefined
  }, defaultVisualRuntimeSettings());
}

function sanitizeVisualRuntimeSettings(
  settings: VisualRuntimeSettings,
  fallback: VisualRuntimeSettings = defaultVisualRuntimeSettings()
): VisualRuntimeSettings {
  return {
    thinkingVolume: settings.thinkingVolume === undefined
      ? fallback.thinkingVolume ?? defaultVisualThinkingVolume
      : clamp(settings.thinkingVolume, 0, 0.8),
    responseLanguage: settings.responseLanguage ?? fallback.responseLanguage ?? "auto",
    chatHistoryEnabled: settings.chatHistoryEnabled ?? fallback.chatHistoryEnabled ?? true,
    hudEnabled: settings.hudEnabled ?? fallback.hudEnabled ?? true,
    hudCompact: settings.hudCompact ?? fallback.hudCompact ?? false,
    popupPreferred: settings.popupPreferred ?? fallback.popupPreferred ?? false,
    speakWakeRejectedWarnings: settings.speakWakeRejectedWarnings ?? fallback.speakWakeRejectedWarnings ?? true,
    maxUtteranceSeconds: settings.maxUtteranceSeconds === undefined
      ? fallback.maxUtteranceSeconds ?? defaultMaxUtteranceSeconds
      : sanitizeMaxUtteranceSeconds(settings.maxUtteranceSeconds, fallback.maxUtteranceSeconds ?? defaultMaxUtteranceSeconds)
  };
}

function parseVisualResponseLanguage(value: unknown): VisualRuntimeSettings["responseLanguage"] | undefined {
  return value === "auto" || value === "ko" || value === "en" ? value : undefined;
}

function ttsFileConfigFromVisualSettings(settings: VisualTtsSettings): VoiceTtsFileConfig {
  return {
    enabled: true,
    language: settings.language ?? "auto",
    voiceName: settings.voiceName ?? "",
    gender: settings.gender ?? "auto",
    rate: settings.rate ?? 0.56,
    pitch: settings.pitch ?? 1,
    volume: settings.volume ?? 1
  };
}

function parsePersistedNumber(value: string | number | undefined): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function canUseTranscriptAsNativeInput(request: PermissionRequest): boolean {
  if (request.action === "request_user_input" || request.native?.requestMethod === "item/tool/requestUserInput") {
    return true;
  }

  if (request.action !== "mcp_elicitation" && request.native?.requestMethod !== "mcpServer/elicitation/request") {
    return false;
  }

  const raw = asRecord(request.native?.raw);
  const schema = nativeMcpElicitationSchema(raw);
  const properties = asRecord(schema.properties);
  const required = parseNativeStringArray(schema.required);
  return required.some((key) => !nativeMcpFieldHasInferableValue(asRecord(properties[key])));
}

function nativeMcpElicitationUrl(request: PermissionRequest): string | undefined {
  if (request.action !== "mcp_elicitation" && request.native?.requestMethod !== "mcpServer/elicitation/request") {
    return undefined;
  }

  const raw = asRecord(request.native?.raw);
  const nested = asRecord(raw.request);
  const mode = parseNativeString(raw.mode ?? nested.mode);
  const url = parseNativeString(raw.url ?? nested.url);
  return mode === "url" ? url : undefined;
}

function nativeMcpElicitationSchema(raw: Record<string, unknown>): Record<string, unknown> {
  const request = asRecord(raw.request);
  return asRecord(raw.requestedSchema ?? raw.requested_schema ?? raw.schema ?? request.requestedSchema ?? request.requested_schema ?? request.schema);
}

function nativeMcpFieldHasInferableValue(schema: Record<string, unknown>): boolean {
  if (schema.const !== undefined || schema.default !== undefined) return true;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return true;
  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) return true;
  return Array.isArray(schema.anyOf) && schema.anyOf.length > 0;
}

function parseNativeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function parseNativeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isExactApprovalPhrase(text: string, phrases: ApprovalPhraseSet): boolean {
  const normalized = normalizeApprovalSpeech(text);
  return [
    ...phrases.onceApprove,
    ...phrases.deny,
    ...phrases.cancel,
    ...phrases.sessionApprove,
    ...phrases.policyApprove,
    ...phrases.networkPolicyApprove
  ].includes(normalized);
}

function approvalScope(intent: ReturnType<typeof interpretApprovalSpeech>["intent"]): PermissionDecision["scope"] {
  switch (intent) {
    case "approve_session":
      return "session";
    case "approve_policy":
      return "tool";
    case "approve_network_policy":
      return "network";
    case "approve_once":
    case "deny":
    case "cancel":
    case "unknown":
      return "once";
  }
}

function unsupportedApprovalGuidance(
  intent: ReturnType<typeof interpretApprovalSpeech>["intent"],
  request: PermissionRequest,
  error: unknown
): string {
  const decisions = request.native?.availableDecisions;

  if (intent === "approve_session" && !supportsNativeDecision(decisions, "acceptForSession")) {
    const alternatives = ["한 번만 허용은 허용"];
    if (supportsNativeDecision(decisions, "acceptWithExecpolicyAmendment")) {
      alternatives.push("같은 명령 계속 허용은 같은 명령 계속 허용");
    }
    if (supportsAnyNativeDecision(decisions, ["cancel", "decline", "reject", "deny"])) {
      alternatives.push("거부는 거부");
    }
    return `이번 요청은 세션 허용을 지원하지 않아. ${alternatives.join(", ")} 중 하나로 다시 말해줘.`;
  }

  if (intent === "approve_policy" && !supportsNativeDecision(decisions, "acceptWithExecpolicyAmendment")) {
    return "이번 요청은 같은 명령 계속 허용을 지원하지 않아. 한 번만 허용하려면 허용, 거부하려면 거부라고 말해줘.";
  }

  if (intent === "approve_network_policy" && !supportsNativeDecision(decisions, "applyNetworkPolicyAmendment")) {
    return "이번 요청은 같은 네트워크 계속 허용을 지원하지 않아. 한 번만 허용하려면 허용, 세션 동안 허용하려면 이번 세션 동안 허용, 거부하려면 거부라고 말해줘.";
  }

  return `${formatError(error)} 다시 말해줘.`;
}

function supportsNativeDecision(decisions: unknown[] | undefined, name: string): boolean {
  return decisions?.some((decision) => decision === name || Object.prototype.hasOwnProperty.call(asRecord(decision), name)) ?? false;
}

function supportsAnyNativeDecision(decisions: unknown[] | undefined, names: string[]): boolean {
  return names.some((name) => supportsNativeDecision(decisions, name));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function agentLabel(target: AgentTarget): string {
  return target === "claude" ? "Claude" : "Codex";
}

function voiceMessageLanguage(text: string): VoiceMessage["language"] {
  return detectTranscriptLanguage(normalizeTranscriptText(text)) === "en" ? "en" : "ko";
}

function statusToVisualState(task: CodexStatus["task"]): VisualUiState {
  switch (task) {
    case "thinking":
      return "thinking";
    case "editing":
    case "running_command":
      return "running";
    case "waiting_permission":
      return "approval_pending";
    case "idle":
    default:
      return "idle";
  }
}

function formatVisualRateLimitWindow(window: CodexRateLimitWindow): string {
  const reset = window.resetIn ? `, reset ${window.resetIn}` : "";
  return `${window.label} ${formatVisualPercent(window.remainingPercent)}% left${reset}`;
}

function formatVisualPercent(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/u, "");
}

function approvalVisualText(
  permissionTarget: string,
  request: PermissionRequest | undefined,
  phrases: ApprovalPhraseSet
): string {
  const lines = [
    permissionTarget === "네트워크" ? "네트워크 권한 필요해." : `${permissionTarget} 실행 권한 필요해.`,
    `허용: ${phrases.onceApprove.join(" / ")}`,
    `거부: ${phrases.deny.join(" / ")}`,
    `취소: ${phrases.cancel.join(" / ")}`
  ];

  if (supportsSessionApproval(request)) {
    lines.push(`세션 허용: ${phrases.sessionApprove.join(" / ")}`);
  }
  if (supportsToolApproval(request)) {
    lines.push(`계속 허용: ${phrases.policyApprove.join(" / ")}`);
  }

  if (permissionTarget === "네트워크") {
    const host = parseNativeNetworkHost(request);
    if (host) lines.push(`대상: ${host}`);
    if (request?.rawText) lines.push(`사유: ${request.rawText}`);
    const choices = describeNativeChoices(request?.native?.availableDecisions);
    if (choices) lines.push(`Codex 선택지: ${choices}`);
    if (supportsNetworkApproval(request)) {
      lines.push(`네트워크 계속 허용: ${phrases.networkPolicyApprove.join(" / ")}`);
    }
  } else if (permissionTarget === "작업") {
    if (request?.rawText) lines.push(`사유: ${request.rawText}`);
    const choices = describeNativeChoices(request?.native?.availableDecisions);
    if (choices) lines.push(`Codex 선택지: ${choices}`);
  }

  return lines.join("\n");
}

function permissionPromptText(permissionTarget: string): string {
  if (permissionTarget === "네트워크") return "네트워크 권한이 필요해. 허용할까?";
  return `${permissionTarget} 실행 권한 필요해. 허용할까?`;
}

function permissionTargetLabel(request: PermissionRequest): string {
  if (isNativeNetworkPermissionRequest(request)) return "네트워크";
  return request.command ? "명령" : "작업";
}

function supportsSessionApproval(request: PermissionRequest | undefined): boolean {
  if (!request) return false;
  if (request.action === "request_permissions" || request.action === "network_permissions" || request.action === "file_change") return true;
  return supportsNativeDecision(request.native?.availableDecisions, "acceptForSession");
}

function supportsToolApproval(request: PermissionRequest | undefined): boolean {
  return supportsNativeDecision(request?.native?.availableDecisions, "acceptWithExecpolicyAmendment");
}

function supportsNetworkApproval(request: PermissionRequest | undefined): boolean {
  return supportsNativeDecision(request?.native?.availableDecisions, "applyNetworkPolicyAmendment") ||
    ((request?.native?.proposedNetworkPolicyAmendments?.length ?? 0) > 0);
}

function isNativeNetworkPermissionRequest(request: PermissionRequest): boolean {
  const native = request.native;
  if (!native) return false;

  return (
    request.action.includes("network") ||
    hasEnabledNetworkPermission(native.additionalPermissions) ||
    hasEnabledNetworkPermission(native.requestedPermissions) ||
    Object.keys(asRecord(native.networkApprovalContext)).length > 0 ||
    (native.proposedNetworkPolicyAmendments?.length ?? 0) > 0 ||
    /\b(network|dns|host|github|connection|connect|internet)\b|네트워크|디엔에스|깃허브|호스트|접속|연결/iu.test(request.rawText)
  );
}

function hasEnabledNetworkPermission(value: unknown): boolean {
  const permissions = asRecord(value);
  const network = asRecord(permissions.network);
  return network.enabled === true;
}

function passthroughOutputBufferKey(sessionId: string, type: CodexOutputEvent["type"]): string {
  return `${sessionId}\u0000${type}`;
}

function popupGenerationKey(sessionId: string, generation: number | undefined): string {
  return `${sessionId}\u0000${generation ?? "unknown"}`;
}

function parsePassthroughOutputBufferKey(key: string): { sessionId: string; type: CodexOutputEvent["type"] } {
  const separator = key.lastIndexOf("\u0000");
  if (separator === -1) {
    return {
      sessionId: "",
      type: key as CodexOutputEvent["type"]
    };
  }

  return {
    sessionId: key.slice(0, separator),
    type: key.slice(separator + 1) as CodexOutputEvent["type"]
  };
}

function parseNativeNetworkHost(request: PermissionRequest | undefined): string | undefined {
  const host = asRecord(request?.native?.networkApprovalContext).host;
  return typeof host === "string" && host.trim() ? host.trim() : undefined;
}

function compactVisualQuestion(text: string): string {
  const firstSection = text.split(/\n\s*추가 정보:\s*\n/u)[0] ?? text;
  const normalized = firstSection.trim().replace(/\s+/g, " ");
  if (normalized.length <= 180) return normalized;
  return `${normalized.slice(0, 177).trimEnd()}...`;
}

function describeNativeChoices(decisions: unknown[] | undefined): string | undefined {
  if (!decisions || decisions.length === 0) return undefined;

  return decisions
    .map((decision) => {
      if (typeof decision === "string") return decision;
      const record = asRecord(decision);
      return String(record.decision ?? record.type ?? record.name ?? Object.keys(record)[0] ?? "unknown");
    })
    .join(", ");
}

function runtimeStateToVisualState(state: AgentState): VisualUiState {
  switch (state) {
    case "TRANSCRIBING":
      return "stt_processing";
    case "EXECUTING":
      return "submitting";
    case "THINKING":
    case "WAITING_CODEX":
    case "INTERRUPTING":
      return "thinking";
    case "CONFIRMING":
      return "approval_pending";
    case "SPEAKING":
      return "speaking";
    case "ERROR":
      return "error";
    case "SHUTDOWN":
      return "shutdown";
    case "BOOTING":
    case "IDLE":
    case "LISTENING":
    default:
      return "idle";
  }
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
  runTerminalHarness().catch((error: unknown) => {
    stderr.write(`[harness:fatal] ${formatError(error)}\n`);
    process.exitCode = 1;
  });
}
