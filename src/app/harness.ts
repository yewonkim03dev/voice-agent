import { resolve } from "node:path";
import { stdin, stderr, stdout } from "node:process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { ClaudeCodeBackend } from "../claude/ClaudeCodeBackend.ts";
import type { AgentBackend, CodexProcessConfig } from "../codex/CodexBridge.ts";
import { CodexAppServerBackend } from "../codex/CodexAppServerBackend.ts";
import { initialCodexStatus, type CodexOutputEvent, type CodexStatus } from "../codex/CodexOutputEvent.ts";
import type { CodexPrompt } from "../codex/CodexPrompt.ts";
import { interpretApprovalSpeech } from "../permission/ApprovalSpeech.ts";
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
import { detectWakePhrase, type AgentTarget } from "../wake/WakePhraseRouter.ts";

type WriteLine = (line: string) => void;

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
  private idSequence = 0;
  private started = false;
  private currentSessionId: string | undefined;
  private passthroughState: AgentState = "BOOTING";
  private codexStatus: CodexStatus = initialCodexStatus;
  private pendingPermission: PermissionRequest | undefined;
  private lastSpokenText: string | undefined;
  private readonly passthroughOutputBuffers = new Map<string, string>();
  private readonly passthroughStructuredSpeechSessions = new Set<string>();
  private readonly scheduledVoiceTasks = new Set<Promise<void>>();

  constructor(options: TerminalHarnessOptions = {}) {
    this.now = options.now ?? Date.now;
    this.writeLine = options.writeLine ?? noop;
    this.backendLabel = options.backendLabel ?? "mock";
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
    this.printStartupBanner();
    if (this.runtime) {
      this.writeLine("  Type text to send a transcript, or /status, /permission <command>, /complete, /error <message>, /quit.");
    } else {
      this.writeLine("  Wake: 코덱스 <명령> / 클로드 <명령>");
      this.writeLine("  Plain text also passes through in development mode.");
      this.writeLine("  Approval: 허용 / 거부 / 이번 세션 동안 허용");
      this.writeLine("  Commands: /status /quit");
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

  async processTranscript(transcript: Transcript): Promise<void> {
    if (this.runtime) {
      await this.runtime.handleTranscript(transcript);
      return;
    }

    await this.handlePassthroughTranscript(transcript);
  }

  hasPendingApproval(): boolean {
    if (this.runtime) {
      return Boolean(this.runtime.getContext().pendingPermission);
    }

    return Boolean(this.pendingPermission);
  }

  async stopVoiceOutput(): Promise<void> {
    this.ttsPlaybackState.recordStopped(this.now());
    await this.voiceOutput.stop();
  }

  private bindPassthroughBackend(): void {
    this.backend.onOutput((event) => {
      void this.handlePassthroughOutput(event);
    });
    this.backend.onPermissionRequest((request) => {
      void this.handlePassthroughPermissionRequest(request);
    });
    this.backend.onStatus((status) => {
      this.codexStatus = status;
    });
  }

  private async handlePassthroughTranscript(transcript: Transcript): Promise<void> {
    const text = transcript.text.trim();

    if (this.pendingPermission) {
      await this.handleNativeApprovalSpeech(text);
      return;
    }

    if (this.shouldInterrupt(text)) {
      this.passthroughState = "INTERRUPTING";
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
      await this.speak(`${agentLabel(this.agentTarget)} 준비됐어.`, "status");
      return;
    }

    await this.sendPassthroughTranscript(wake ? withTranscriptText(transcript, promptText) : transcript);
  }

  private async sendPassthroughTranscript(transcript: Transcript): Promise<void> {
    const prompt: CodexPrompt = {
      sessionId: transcript.sessionId,
      text: transcript.text,
      language: transcript.language === "unknown" ? "mixed" : transcript.language,
      source: "voice",
      mode: "submit",
      metadata: {
        transcriptConfidence: transcript.confidence,
        spokenAt: transcript.endedAt
      }
    };

    this.passthroughState = "EXECUTING";
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

    const interpreted = interpretApprovalSpeech(text);

    if (interpreted.intent === "unknown") {
      await this.speak("허용인지 거부인지 다시 말해줘.", "permission");
      this.passthroughState = "CONFIRMING";
      return;
    }

    const decision: PermissionDecision = {
      requestId: pending.id,
      decision: interpreted.intent === "deny" ? "deny" : "allow",
      remember: interpreted.intent === "approve_session" || interpreted.intent === "approve_policy",
      scope: approvalScope(interpreted.intent),
      decidedBy: "voice",
      transcript: text
    };

    try {
      await this.backend.sendPermission(decision);
    } catch (error) {
      await this.speak(`${formatError(error)} 다시 말해줘.`, "warning");
      this.passthroughState = "CONFIRMING";
      return;
    }

    this.pendingPermission = undefined;
    this.codexStatus = {
      ...this.codexStatus,
      task: "thinking"
    };
    this.passthroughState = "WAITING_CODEX";
  }

  private async handlePassthroughPermissionRequest(request: PermissionRequest): Promise<void> {
    await this.flushPassthroughOutputBuffers(request.sessionId);
    this.pendingPermission = request;
    this.codexStatus = {
      ...this.codexStatus,
      task: "waiting_permission",
      currentTool: request.tool
    };
    this.passthroughState = "CONFIRMING";
    await this.speak(`${request.command ?? request.action} 실행 권한 필요해. 허용할까?`, "permission");
    this.passthroughState = "CONFIRMING";
  }

  private async handlePassthroughOutput(output: CodexOutputEvent): Promise<void> {
    const text = output.text ?? output.raw ?? "";

    if (output.type === "task_complete") {
      await this.flushPassthroughOutputBuffers(output.sessionId);
      this.pendingPermission = undefined;
      this.codexStatus = {
        ...this.codexStatus,
        task: "idle"
      };
      this.passthroughState = "IDLE";
      if (!this.passthroughStructuredSpeechSessions.has(output.sessionId)) {
        await this.speak("끝났어.", "completion");
      }
      this.passthroughStructuredSpeechSessions.delete(output.sessionId);
      return;
    }

    if (output.type === "error") {
      await this.flushPassthroughOutputBuffers(output.sessionId);
      this.passthroughState = "ERROR";
      await this.speak(text ? `오류 났어. ${text}` : "오류 났어.", "error");
      return;
    }

    if (text) {
      await this.bufferPassthroughOutput(output.type, output.sessionId, text);
    }
  }

  private async bufferPassthroughOutput(type: CodexOutputEvent["type"], sessionId: string, text: string): Promise<void> {
    const buffered = `${this.passthroughOutputBuffers.get(type) ?? ""}${text}`;
    const normalized = buffered.replace(/\r/g, "\n");
    const parts = normalized.split("\n");
    const completeLines = parts.slice(0, -1);
    const remainder = parts.at(-1) ?? "";

    if (completeLines.length > 0) {
      for (const line of completeLines) {
        this.handlePassthroughOutputLine(type, sessionId, line);
      }
      this.passthroughOutputBuffers.set(type, remainder);
      return;
    }

    if (remainder.length >= 2_000) {
      this.handlePassthroughOutputLine(type, sessionId, remainder);
      this.passthroughOutputBuffers.delete(type);
      return;
    }

    this.passthroughOutputBuffers.set(type, remainder);
  }

  private async flushPassthroughOutputBuffers(sessionId = this.currentBackendSessionId()): Promise<void> {
    for (const [type, text] of this.passthroughOutputBuffers) {
      for (const line of text.replace(/\r/g, "\n").split("\n")) {
        this.handlePassthroughOutputLine(type as CodexOutputEvent["type"], sessionId, line);
      }
    }

    this.passthroughOutputBuffers.clear();
  }

  private handlePassthroughOutputLine(type: CodexOutputEvent["type"], sessionId: string, line: string): void {
    const parsed = parseVoiceAgentEventLine(line);

    if (parsed) {
      this.handleVoiceAgentEvent(sessionId, parsed);
      return;
    }

    this.printAgentOutputBlock(type, line);
  }

  private handleVoiceAgentEvent(sessionId: string, event: VoiceAgentEvent): void {
    switch (event.type) {
      case "speech":
        this.printAgentOutputBlock("speech", event.text);
        this.passthroughStructuredSpeechSessions.add(sessionId);
        this.scheduleSpeak(event.text, "speech");
        return;
      case "command":
        this.printAgentOutputBlock("command", event.text);
        return;
      case "status":
        this.printAgentOutputBlock("status", event.text);
        if (event.text.length <= 80) this.scheduleSpeak(event.text, "status");
        return;
      case "error":
        this.printAgentOutputBlock("error", event.text);
        this.scheduleSpeak(event.text, "error");
        return;
    }
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

  private async speak(text: string, category: VoiceMessage["category"]): Promise<void> {
    this.lastSpokenText = text;
    const message: VoiceMessage = {
      id: this.createId("voice"),
      text,
      language: voiceMessageLanguage(text),
      priority: category === "permission" || category === "warning" ? "urgent" : "normal",
      interruptible: category !== "permission",
      category
    };

    this.ttsPlaybackState.recordStart(message, this.now());
    await this.voiceOutput.speak(message);
  }

  private scheduleSpeak(text: string, category: VoiceMessage["category"]): void {
    const task = this.speak(text, category);
    this.scheduledVoiceTasks.add(task);
    task.finally(() => {
      this.scheduledVoiceTasks.delete(task);
    });
  }

  private async handleSlashCommand(line: string): Promise<HarnessLineResult> {
    const { command, argument } = parseSlashCommand(line);

    switch (command) {
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
      case "/quit":
        await this.stop();
        this.writeLine("Harness stopped.");
        return "quit";
      default:
        this.writeLine(`[harness] unknown command: ${command}`);
        this.writeLine("Commands: /status, /permission <command>, /complete, /error <message>, /quit");
        return "continue";
    }
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
      this.currentSessionId = this.currentSessionId ?? this.createId("sess");
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
    return new TerminalHarness({
      ...options,
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
        writeLine: options.writeLine
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

function approvalScope(intent: ReturnType<typeof interpretApprovalSpeech>["intent"]): PermissionDecision["scope"] {
  switch (intent) {
    case "approve_session":
      return "session";
    case "approve_policy":
      return "tool";
    case "approve_once":
    case "deny":
    case "unknown":
      return "once";
  }
}

function agentLabel(target: AgentTarget): string {
  return target === "claude" ? "Claude" : "Codex";
}

function voiceMessageLanguage(text: string): VoiceMessage["language"] {
  return detectTranscriptLanguage(normalizeTranscriptText(text)) === "en" ? "en" : "ko";
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
