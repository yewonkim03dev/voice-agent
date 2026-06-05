import type { ActivationEvent } from "../wake/ActivationEvent.ts";
import type { AgentBackend } from "../codex/CodexBridge.ts";
import type { CodexOutputEvent } from "../codex/CodexOutputEvent.ts";
import { initialCodexStatus } from "../codex/CodexOutputEvent.ts";
import type { CodexPrompt } from "../codex/CodexPrompt.ts";
import type { PermissionParser } from "../codex/PermissionParser.ts";
import { TextPermissionParser } from "../codex/PermissionParser.ts";
import { defaultUserPreferences, type UserPreferences } from "../config/UserPreferences.ts";
import type { PermissionDecision } from "../permission/PermissionDecision.ts";
import type { PermissionRequest } from "../permission/PermissionRequest.ts";
import type { SafetyPolicy } from "../permission/SafetyPolicy.ts";
import { KeywordSafetyPolicy } from "../permission/SafetyPolicy.ts";
import type { CommandRouter, RouteDecision } from "../router/CommandRouter.ts";
import { KeywordCommandRouter } from "../router/KeywordCommandRouter.ts";
import type { ControlCommand, PermissionCommand, UserTaskCommand } from "../router/AgentCommand.ts";
import type { Transcript } from "../speech/Transcript.ts";
import type { VoiceOutput } from "../voice/VoiceOutput.ts";
import type { VoiceMessage } from "../voice/VoiceMessage.ts";
import type { AgentState } from "./AgentState.ts";
import type { RuntimeContext } from "./RuntimeContext.ts";

export interface RuntimeControllerOptions {
  backend: AgentBackend;
  voiceOutput: VoiceOutput;
  router?: CommandRouter;
  safetyPolicy?: SafetyPolicy;
  permissionParser?: PermissionParser;
  userPreferences?: Partial<UserPreferences>;
  now?: () => number;
  createId?: (prefix: string) => string;
}

export class RuntimeController {
  private readonly backend: AgentBackend;
  private readonly voiceOutput: VoiceOutput;
  private readonly router: CommandRouter;
  private readonly safetyPolicy: SafetyPolicy;
  private readonly permissionParser: PermissionParser;
  private readonly now: () => number;
  private readonly createId: (prefix: string) => string;
  private readonly context: RuntimeContext;

  constructor(options: RuntimeControllerOptions) {
    this.backend = options.backend;
    this.voiceOutput = options.voiceOutput;
    this.router = options.router ?? new KeywordCommandRouter();
    this.safetyPolicy = options.safetyPolicy ?? new KeywordSafetyPolicy();
    this.permissionParser = options.permissionParser ?? new TextPermissionParser();
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? ((prefix) => `${prefix}_${this.now()}`);
    this.context = {
      state: "BOOTING",
      codexStatus: initialCodexStatus,
      userPreferences: {
        ...defaultUserPreferences,
        ...options.userPreferences
      }
    };

    this.backend.onOutput((event) => {
      void this.handleCodexOutput(event);
    });
    this.backend.onPermissionRequest((request) => {
      void this.handlePermissionRequest(request);
    });
    this.backend.onStatus((status) => {
      this.context.codexStatus = status;
    });
  }

  getContext(): RuntimeContext {
    return {
      ...this.context,
      userPreferences: { ...this.context.userPreferences }
    };
  }

  async start(): Promise<void> {
    this.context.state = "BOOTING";
    await this.backend.start();
    this.context.state = "IDLE";
  }

  async stop(): Promise<void> {
    await this.backend.stop();
    this.context.state = "SHUTDOWN";
  }

  handleActivation(activation: ActivationEvent): void {
    if (this.context.state === "SHUTDOWN") return;

    const shouldReuseSession =
      activation.mode === "barge_in" &&
      Boolean(this.context.activeSessionId) &&
      this.context.state === "WAITING_CODEX";

    this.context.activeSessionId = shouldReuseSession
      ? this.context.activeSessionId
      : this.createId("sess");
    this.context.state = "LISTENING";
  }

  async handleTranscript(transcript: Transcript): Promise<RouteDecision> {
    const routeState = this.context.state;
    this.context.lastTranscript = transcript;
    this.context.activeSessionId = transcript.sessionId;
    this.context.state = "THINKING";

    const decision = await this.router.route({
      transcript,
      state: routeState,
      pendingPermission: this.context.pendingPermission,
      codexStatus: this.context.codexStatus
    });

    if (decision.route === "permission_decision") {
      this.context.state = routeState;
    }

    await this.applyRouteDecision(decision, transcript);
    return decision;
  }

  async handleCodexOutput(output: CodexOutputEvent): Promise<void> {
    this.context.lastCodexOutput = output.text ?? output.raw ?? this.context.lastCodexOutput;

    const parsedPermission = this.permissionParser.parse(output);
    if (parsedPermission) {
      await this.handlePermissionRequest(parsedPermission);
      return;
    }

    if (output.type === "task_complete") {
      await this.speak("끝났어.", "completion");
      this.context.pendingPermission = undefined;
      this.context.codexStatus = {
        ...this.context.codexStatus,
        task: "idle"
      };
      this.context.state = "IDLE";
      return;
    }

    if (output.type === "error") {
      await this.speak("오류 났어.", "error");
      this.context.state = "ERROR";
    }
  }

  async handlePermissionRequest(request: PermissionRequest): Promise<void> {
    const classified = this.safetyPolicy.classifyPermission(request);
    this.context.pendingPermission = classified;
    this.context.codexStatus = {
      ...this.context.codexStatus,
      task: "waiting_permission",
      currentTool: classified.tool
    };
    this.context.state = "CONFIRMING";

    const message =
      classified.riskLevel === "critical"
        ? "위험한 명령이라 음성으로는 허용할 수 없어."
        : `${classified.command ? "명령" : "작업"} 실행 권한 필요해. 허용할까?`;

    await this.speak(message, classified.riskLevel === "critical" ? "warning" : "permission");
    this.context.state = "CONFIRMING";
  }

  private async applyRouteDecision(decision: RouteDecision, transcript: Transcript): Promise<void> {
    switch (decision.route) {
      case "codex_prompt":
        await this.handleUserTask(decision.command as UserTaskCommand, transcript);
        return;
      case "permission_decision":
        await this.handlePermissionCommand(decision.command as PermissionCommand, transcript);
        return;
      case "runtime_control":
      case "status_query":
        await this.handleControlCommand(decision.command as ControlCommand);
        return;
      case "clarify":
        await this.speak("잘 못 들었어. 다시 말해줘.", "error");
        this.context.state = "IDLE";
        return;
      case "ignore":
        this.context.state = this.context.pendingPermission ? "CONFIRMING" : "IDLE";
        return;
    }
  }

  private async handleUserTask(command: UserTaskCommand, transcript: Transcript): Promise<void> {
    if (command.requiresPreAck && this.context.userPreferences.voiceAckEnabled) {
      await this.speak("알겠어. 실행할게.", "ack");
    }

    this.context.state = "EXECUTING";
    const prompt: CodexPrompt = {
      sessionId: command.sessionId,
      text: this.buildPromptText(command, transcript),
      language: command.language,
      source: "voice",
      mode: this.context.userPreferences.autoSubmit ? "submit" : "insert",
      metadata: {
        transcriptConfidence: transcript.confidence,
        spokenAt: transcript.endedAt
      }
    };

    await this.backend.sendPrompt(prompt);
    this.context.codexStatus = {
      ...this.context.codexStatus,
      task: "thinking"
    };
    this.context.state = "WAITING_CODEX";
  }

  private async handlePermissionCommand(command: PermissionCommand, transcript: Transcript): Promise<void> {
    const pending = this.context.pendingPermission;
    if (!pending || this.context.state !== "CONFIRMING") {
      this.context.state = "IDLE";
      return;
    }

    const wantsAllow =
      command.decision === "allow" ||
      command.decision === "allow_once" ||
      command.decision === "always_allow";

    if (wantsAllow && !this.safetyPolicy.canVoiceApprove(pending)) {
      await this.speak("위험한 명령이라 음성으로는 허용할 수 없어.", "warning");
      this.context.state = "CONFIRMING";
      return;
    }

    if (wantsAllow && this.safetyPolicy.requiresSecondConfirmation(pending) && !isStrongConfirmation(transcript.text)) {
      await this.speak("위험도가 높아. 정말 실행할까?", "warning");
      this.context.state = "CONFIRMING";
      return;
    }

    const decision: PermissionDecision = {
      requestId: pending.id,
      decision: wantsAllow ? "allow" : "deny",
      remember: command.decision === "always_allow",
      scope: command.decision === "always_allow" ? "session" : "once",
      decidedBy: "voice",
      transcript: transcript.text
    };

    await this.backend.sendPermission(decision);
    this.context.pendingPermission = undefined;
    this.context.codexStatus = {
      ...this.context.codexStatus,
      task: "thinking"
    };
    this.context.state = "WAITING_CODEX";
  }

  private async handleControlCommand(command: ControlCommand): Promise<void> {
    switch (command.action) {
      case "status":
        await this.speak(this.statusMessage(), "status");
        this.context.state = this.context.pendingPermission ? "CONFIRMING" : this.context.state;
        return;
      case "repeat":
        await this.speak(this.context.lastSpokenText ?? "아직 말한 내용이 없어.", "status");
        return;
      case "stop":
        this.context.state = "INTERRUPTING";
        await this.backend.interrupt("User requested stop by voice");
        await this.speak("멈출게.", "status");
        this.context.pendingPermission = undefined;
        this.context.state = "IDLE";
        return;
      case "shutdown":
        await this.speak("종료할게.", "status");
        await this.stop();
        return;
      case "pause":
      case "resume":
      case "cancel_speech":
      case "new_session":
        await this.speak("아직 지원하지 않아.", "warning");
        this.context.state = this.context.pendingPermission ? "CONFIRMING" : "IDLE";
        return;
    }
  }

  private buildPromptText(command: UserTaskCommand, transcript: Transcript): string {
    switch (this.context.userPreferences.commandPromptMode) {
      case "normalized_instruction":
        return transcript.normalizedText;
      case "bilingual_instruction":
        return `User instruction (${command.language}): ${command.text}`;
      case "raw_transcript":
        return command.text;
    }
  }

  private statusMessage(): string {
    if (this.context.pendingPermission) {
      return "권한 응답을 기다리는 중이야.";
    }

    if (this.context.state === "WAITING_CODEX") {
      return "코덱스 작업을 기다리는 중이야.";
    }

    return "대기 중이야.";
  }

  private async speak(
    text: string,
    category: VoiceMessage["category"],
    priority: VoiceMessage["priority"] = "normal"
  ): Promise<void> {
    const previousState: AgentState = this.context.state;
    this.context.state = "SPEAKING";
    this.context.lastSpokenText = text;
    await this.voiceOutput.speak({
      id: this.createId("voice"),
      text,
      language: this.context.userPreferences.responseLanguage === "en" ? "en" : "ko",
      priority,
      interruptible: category !== "permission",
      category
    });
    this.context.state = previousState;
  }
}

function isStrongConfirmation(text: string): boolean {
  const normalized = text.toLowerCase();
  return ["진짜", "정말", "확실", "really", "confirm"].some((keyword) => normalized.includes(keyword));
}
