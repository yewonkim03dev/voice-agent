import { spawn, type SpawnOptionsWithoutStdio } from "node:child_process";

import type { PermissionDecision } from "../permission/PermissionDecision.ts";
import type { PermissionRequest } from "../permission/PermissionRequest.ts";
import type { AgentBackend, CodexProcessConfig } from "./CodexBridge.ts";
import type {
  CodexOutputEvent,
  CodexRateLimitSnapshot,
  CodexRateLimitWindow,
  CodexRateLimits,
  CodexStatus
} from "./CodexOutputEvent.ts";
import type { CodexPrompt } from "./CodexPrompt.ts";
import { voiceAgentProtocolPrompt } from "../voice/VoiceAgentEvent.ts";

type RequestId = string | number;
type WriteLine = (line: string) => void;
export type CodexApprovalPolicy = "on-request" | "untrusted" | "on-failure" | "never";

const MAX_TURN_SESSION_MAPPINGS = 200;
const DENIED_APPROVAL_RECOVERY_MS = 30_000;

interface ProcessReadable {
  on(event: "data", callback: (chunk: Buffer | string) => void): unknown;
}

interface ProcessWritable {
  end?(): unknown;
}

export interface CodexAppServerProcess {
  stdin: ProcessWritable;
  stdout: ProcessReadable;
  stderr: ProcessReadable;
  killed?: boolean;
  kill(signal?: NodeJS.Signals): boolean;
  on(event: "error", callback: (error: Error) => void): unknown;
  on(event: "exit", callback: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
}

export type SpawnCodexAppServerProcess = (
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio
) => CodexAppServerProcess;

interface WebSocketLike {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: { message?: string; type?: string }) => void) | null;
  onclose: (() => void) | null;
  send(data: string): void;
  close(): void;
}

type CreateWebSocket = (url: string) => WebSocketLike;

interface JsonRpcResponse {
  id: RequestId;
  result?: unknown;
  error?: {
    message: string;
  };
}

interface JsonRpcRequest {
  id?: RequestId;
  method?: string;
  params?: Record<string, unknown>;
}

interface PendingCodexApproval {
  rpcId: RequestId;
  requestMethod: string;
  threadId?: string;
  turnId?: string;
  itemId?: string;
  createdAt: number;
  resolved: boolean;
  responseKind: "decision" | "permissions" | "mcp_elicitation" | "tool_user_input";
  availableDecisions?: unknown[];
  additionalPermissions?: unknown;
  networkApprovalContext?: unknown;
  requestedPermissions?: unknown;
  proposedExecpolicyAmendment?: unknown;
  proposedNetworkPolicyAmendments?: unknown[];
  params: Record<string, unknown>;
  raw: Record<string, unknown>;
}

export interface CodexThreadStore {
  load(): Promise<string | undefined>;
  save(threadId: string): Promise<void>;
}

export interface CodexAppServerBackendOptions {
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  voiceAgentProtocol?: boolean;
  voiceAgentProtocolPrompt?: string;
  now?: () => number;
  writeLine?: WriteLine;
  spawnProcess?: SpawnCodexAppServerProcess;
  createWebSocket?: CreateWebSocket;
  startupTimeoutMs?: number;
  threadId?: string;
  alwaysStartNewThread?: boolean;
  threadStore?: CodexThreadStore;
  approvalPolicy?: CodexApprovalPolicy;
  deniedApprovalRecoveryMs?: number;
}

export class CodexAppServerBackend implements AgentBackend {
  private readonly command: string;
  private readonly args: string[];
  private readonly cwd: string;
  private readonly env: Record<string, string | undefined>;
  private readonly voiceAgentProtocol: boolean;
  private protocolPrompt: string;
  private readonly now: () => number;
  private readonly writeLine: WriteLine;
  private readonly spawnProcess: SpawnCodexAppServerProcess;
  private readonly createWebSocket: CreateWebSocket;
  private readonly startupTimeoutMs: number;
  private readonly configuredThreadId: string | undefined;
  private readonly alwaysStartNewThread: boolean;
  private readonly threadStore: CodexThreadStore | undefined;
  private readonly approvalPolicy: CodexApprovalPolicy;
  private readonly deniedApprovalRecoveryMs: number;
  private readonly outputListeners: Array<(event: CodexOutputEvent) => void> = [];
  private readonly permissionListeners: Array<(request: PermissionRequest) => void> = [];
  private readonly statusListeners: Array<(status: CodexStatus) => void> = [];
  private readonly pendingResponses = new Map<RequestId, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();
  private readonly pendingApprovals = new Map<string, PendingCodexApproval>();
  private child: CodexAppServerProcess | undefined;
  private socket: WebSocketLike | undefined;
  private rpcSequence = 0;
  private currentSessionId = "codex_app_server";
  private readonly turnSessions = new Map<string, string>();
  private readonly turnSessionOrder: string[] = [];
  private threadId: string | undefined;
  private turnId: string | undefined;
  private deniedApprovalRecoveryTimer: ReturnType<typeof setTimeout> | undefined;
  private deniedApprovalRecoveryTurnId: string | undefined;
  private rateLimits: CodexRateLimits | undefined;
  private status: CodexStatus = {
    process: "not_started",
    task: "idle"
  };

  constructor(options: CodexAppServerBackendOptions = {}) {
    this.command = options.command ?? "codex";
    this.args = options.args ?? ["app-server", "--listen", "ws://127.0.0.1:0"];
    this.cwd = options.cwd ?? process.cwd();
    this.env = {
      ...process.env,
      ...options.env
    };
    this.voiceAgentProtocol = options.voiceAgentProtocol ?? false;
    this.protocolPrompt = options.voiceAgentProtocolPrompt ?? voiceAgentProtocolPrompt;
    this.now = options.now ?? Date.now;
    this.writeLine = options.writeLine ?? noop;
    this.spawnProcess = options.spawnProcess ?? spawn;
    this.createWebSocket = options.createWebSocket ?? createDefaultWebSocket;
    this.startupTimeoutMs = options.startupTimeoutMs ?? 10_000;
    this.configuredThreadId = parseOptionalString(options.threadId);
    this.alwaysStartNewThread = options.alwaysStartNewThread === true;
    this.threadStore = options.threadStore;
    this.approvalPolicy = options.approvalPolicy ?? "on-request";
    this.deniedApprovalRecoveryMs = sanitizeRecoveryTimeout(options.deniedApprovalRecoveryMs);
  }

  async start(config?: CodexProcessConfig): Promise<void> {
    if (this.child) return;

    const command = config?.command ?? this.command;
    const args = config?.args ?? this.args;
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
      const child = this.spawnProcess(command, args, {
        cwd,
        env
      });
      this.child = child;
      this.writeLine(`[codex-app] started: ${command} ${args.join(" ")}`.trim());
      this.writeLine(`[codex-app] config approvalPolicy=${this.approvalPolicy} sandbox=workspace-write reviewer=user`);

      const endpoint = await this.waitForEndpoint(child);
      await this.connect(endpoint);
      await this.initialize();
      await this.openThread(cwd);

      this.publishStatus({
        process: "running",
        task: "idle",
        currentWorkingDirectory: cwd,
        ...(this.threadId ? { threadId: this.threadId } : {})
      });
      await this.refreshRateLimits();
    } catch (error) {
      this.socket?.close();
      this.socket = undefined;
      this.child?.kill("SIGTERM");
      this.child = undefined;
      this.publishStatus({
        ...this.status,
        process: "error",
        task: "idle"
      });
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.clearDeniedApprovalRecovery();
    this.socket?.close();
    this.socket = undefined;
    this.child?.stdin.end?.();
    this.child?.kill("SIGTERM");
    this.child = undefined;
    this.publishStatus({
      ...this.status,
      process: "exited",
      task: "idle"
    });
  }

  async sendPrompt(prompt: CodexPrompt): Promise<void> {
    if (!this.threadId) {
      throw new Error("Codex app-server thread is not ready.");
    }

    this.currentSessionId = prompt.sessionId;
    this.clearDeniedApprovalRecovery();
    this.writeLine(`[codex-app] turn/start ${prompt.sessionId}: ${prompt.text}`);
    this.publishStatus({
      ...this.status,
      task: "thinking"
    });

    const result = await this.sendRequest("turn/start", {
      threadId: this.threadId,
      input: this.createTurnInput(prompt),
      cwd: this.cwd,
      approvalPolicy: this.approvalPolicy,
      approvalsReviewer: "user"
    });
    const turn = asRecord(result).turn;
    const turnId = parseOptionalString(asRecord(turn).id);
    if (turnId) {
      this.turnId = turnId;
      this.rememberTurnSession(turnId, prompt.sessionId);
    }
  }

  setVoiceAgentProtocolPrompt(prompt: string): void {
    this.protocolPrompt = prompt;
  }

  async sendPermission(decision: PermissionDecision): Promise<void> {
    const pending = this.pendingApprovals.get(decision.requestId);

    if (pending === undefined) {
      throw new Error(`No pending Codex approval request for ${decision.requestId}.`);
    }

    const nativeResult = this.resolveNativeResponse(decision, pending);

    pending.resolved = true;
    this.pendingApprovals.delete(decision.requestId);
    this.writeLine(`[codex-app] approval ${decision.decision}: ${decision.requestId}`);
    this.sendResponse(pending.rpcId, nativeResult);

    const rejected = decision.decision === "deny" || decision.decision === "cancel";
    if (rejected) {
      this.scheduleDeniedApprovalRecovery(pending);
    } else {
      this.clearDeniedApprovalRecovery(pending.turnId);
    }

    this.publishStatus({
      ...this.status,
      task: "thinking",
      currentTool: decision.decision === "allow" ? this.status.currentTool : undefined
    });
  }

  async interrupt(reason: string): Promise<void> {
    this.writeLine(`[codex-app] interrupt: ${reason}`);
    this.clearDeniedApprovalRecovery();

    if (this.threadId && this.turnId) {
      await this.sendRequest("turn/interrupt", {
        threadId: this.threadId,
        turnId: this.turnId
      });
    }

    this.publishStatus({
      ...this.status,
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

  private waitForEndpoint(child: CodexAppServerProcess): Promise<string> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => fail(new Error("Timed out waiting for Codex app-server endpoint.")), this.startupTimeoutMs);
      const complete = (endpoint: string): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(endpoint);
      };
      const fail = (error: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      };

      child.stdout.on("data", (chunk) => {
        const text = chunk.toString();
        this.detectEndpoint(text, complete);
        this.writeVisibleProcessOutput("stdout", text);
      });
      child.stderr.on("data", (chunk) => {
        const text = chunk.toString();
        this.detectEndpoint(text, complete);
        this.writeVisibleProcessOutput("stderr", text);
      });
      child.on("error", fail);
      child.on("exit", (code, signal) => {
        this.child = undefined;
        if (!settled) {
          fail(new Error(signal ? `Codex app-server exited from ${signal}.` : `Codex app-server exited with code ${code ?? 0}.`));
        }
        this.publishStatus({
          ...this.status,
          process: code === 0 || signal ? "exited" : "error",
          task: "idle"
        });
      });
    });
  }

  private connect(endpoint: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = this.createWebSocket(endpoint);
      this.socket = socket;
      socket.onopen = () => resolve();
      socket.onerror = (event) => reject(new Error(event.message ?? event.type ?? "Codex app-server websocket error."));
      socket.onclose = () => {
        this.socket = undefined;
      };
      socket.onmessage = (event) => this.handleSocketMessage(event.data);
    });
  }

  private async initialize(): Promise<void> {
    await this.sendRequest("initialize", {
      clientInfo: {
        name: "voice-agent",
        title: "Voice Agent",
        version: "0.1.0"
      },
      capabilities: {
        experimentalApi: true
      }
    });
  }

  private async openThread(cwd: string): Promise<void> {
    if (this.alwaysStartNewThread) {
      this.writeLine("[codex-app] alwaysStartNewThread enabled. Starting a new thread.");
      await this.startThread(cwd);
      return;
    }

    const threadId = this.configuredThreadId ?? await this.loadStoredThreadId();

    if (threadId) {
      try {
        await this.resumeThread(cwd, threadId);
        return;
      } catch (error) {
        this.writeLine(`[codex-app] thread/resume failed for ${threadId}: ${formatError(error)}. Starting a new thread.`);
      }
    }

    await this.startThread(cwd);
  }

  private async resumeThread(cwd: string, threadId: string): Promise<void> {
    const result = await this.sendRequest("thread/resume", {
      threadId,
      cwd,
      approvalPolicy: this.approvalPolicy,
      approvalsReviewer: "user",
      sandbox: "workspace-write",
      persistExtendedHistory: true
    });
    const thread = asRecord(result).thread;
    await this.setThreadId(typeof asRecord(thread).id === "string" ? asRecord(thread).id : undefined, "thread/resume");
  }

  private async startThread(cwd: string): Promise<void> {
    const result = await this.sendRequest("thread/start", {
      cwd,
      approvalPolicy: this.approvalPolicy,
      approvalsReviewer: "user",
      sandbox: "workspace-write",
      experimentalRawEvents: false,
      persistExtendedHistory: true,
      sessionStartSource: "startup"
    });
    const thread = asRecord(result).thread;
    await this.setThreadId(typeof asRecord(thread).id === "string" ? asRecord(thread).id : undefined, "thread/start");
  }

  private async setThreadId(threadId: string | undefined, source: "thread/start" | "thread/resume"): Promise<void> {
    this.threadId = threadId;

    if (!this.threadId) {
      throw new Error("Codex app-server did not return a thread id.");
    }

    this.writeLine(`[codex-app] ${source} ${this.threadId}`);
    await this.saveStoredThreadId(this.threadId);
    this.publishStatus({
      ...this.status,
      threadId: this.threadId
    });
  }

  private async loadStoredThreadId(): Promise<string | undefined> {
    if (!this.threadStore) return undefined;

    try {
      return parseOptionalString(await this.threadStore.load());
    } catch (error) {
      this.writeLine(`[codex-app] could not read stored thread id: ${formatError(error)}`);
      return undefined;
    }
  }

  private async saveStoredThreadId(threadId: string): Promise<void> {
    if (!this.threadStore) return;

    try {
      await this.threadStore.save(threadId);
    } catch (error) {
      this.writeLine(`[codex-app] could not save thread id: ${formatError(error)}`);
    }
  }

  private sendRequest(method: string, params?: Record<string, unknown>, options: { timeoutMs?: number } = {}): Promise<unknown> {
    const socket = this.requireSocket();
    const id = `voice_${++this.rpcSequence}`;
    const message = {
      id,
      method,
      ...(params !== undefined ? { params } : {})
    };

    return new Promise((resolve, reject) => {
      let timer: NodeJS.Timeout | undefined;
      const clearTimer = (): void => {
        if (timer) clearTimeout(timer);
      };

      this.pendingResponses.set(id, {
        resolve: (value) => {
          clearTimer();
          resolve(value);
        },
        reject: (error) => {
          clearTimer();
          reject(error);
        }
      });
      if (options.timeoutMs !== undefined) {
        timer = setTimeout(() => {
          this.pendingResponses.delete(id);
          reject(new Error(`Timed out waiting for Codex app-server response to ${method}.`));
        }, options.timeoutMs);
      }
      socket.send(JSON.stringify(message));
    });
  }

  private createTurnInput(prompt: CodexPrompt): Array<{ type: "text"; text: string; text_elements: unknown[] }> {
    const input = [
      {
        type: "text" as const,
        text: prompt.text,
        text_elements: []
      }
    ];

    if (!this.voiceAgentProtocol) return input;

    const policy = responseLanguagePolicyPrompt(prompt.responseLanguage);

    return [
      {
        type: "text" as const,
        text: this.protocolPrompt,
        text_elements: []
      },
      ...(policy
        ? [
            {
              type: "text" as const,
              text: policy,
              text_elements: []
            }
          ]
        : []),
      ...input
    ];
  }

  private sendResponse(id: RequestId, result: Record<string, unknown>): void {
    this.requireSocket().send(
      JSON.stringify({
        id,
        result
      })
    );
  }

  private sendErrorResponse(id: RequestId, code: number, message: string): void {
    this.requireSocket().send(
      JSON.stringify({
        id,
        error: {
          code,
          message
        }
      })
    );
  }

  private handleSocketMessage(data: unknown): void {
    const message = parseMessage(data);

    if ("result" in message || "error" in message) {
      this.handleResponse(message as JsonRpcResponse);
      return;
    }

    this.handleRequestOrNotification(message as JsonRpcRequest);
  }

  private handleResponse(response: JsonRpcResponse): void {
    const pending = this.pendingResponses.get(response.id);
    if (!pending) return;

    this.pendingResponses.delete(response.id);

    if (response.error) {
      pending.reject(new Error(response.error.message));
      return;
    }

    pending.resolve(response.result);
  }

  private handleRequestOrNotification(message: JsonRpcRequest): void {
    switch (message.method) {
      case "item/commandExecution/requestApproval":
        this.handleCommandApprovalRequest(message);
        return;
      case "item/permissions/requestApproval":
        this.handlePermissionsApprovalRequest(message);
        return;
      case "item/fileChange/requestApproval":
        this.handleFileChangeApprovalRequest(message);
        return;
      case "mcpServer/elicitation/request":
        this.handleMcpServerElicitationRequest(message);
        return;
      case "item/tool/requestUserInput":
        this.handleToolRequestUserInput(message);
        return;
      case "item/agentMessage/delta":
      case "item/commandExecution/outputDelta":
        this.emitOutputForMessage(message, "stdout", String(message.params?.delta ?? ""));
        return;
      case "command/exec/outputDelta":
        this.emitCommandExecOutput(message);
        return;
      case "turn/started":
        this.handleTurnStarted(message);
        return;
      case "turn/completed":
        this.handleTurnCompleted(message);
        return;
      case "error":
        this.emitOutputForMessage(message, "error", String(asRecord(message.params?.error).message ?? "Codex app-server error"));
        return;
      case "thread/status/changed":
        this.publishStatus({
          ...this.status,
          task: this.status.task
        });
        return;
      case "serverRequest/resolved":
        this.handleServerRequestResolved(message);
        return;
      case "account/rateLimits/updated":
        this.handleAccountRateLimitsUpdated(message);
        return;
    }

    if (this.isApprovalRequest(message)) {
      this.handleApprovalRequest(message);
      return;
    }

    if (this.isMcpElicitationRequest(message)) {
      this.handleMcpServerElicitationRequest(message);
      return;
    }

    if (message.id !== undefined) {
      const method = message.method ?? "(missing method)";
      this.writeLine(`[codex-app] unhandled request: ${method}`);
      this.sendErrorResponse(message.id, -32601, `Voice Agent does not handle Codex app-server request ${method}.`);
    }
  }

  private handleCommandApprovalRequest(message: JsonRpcRequest): void {
    if (message.id === undefined) return;

    const params = asRecord(message.params);
    const command = typeof params.command === "string" ? params.command : undefined;
    const availableDecisions = optionalUnknownArray(params.availableDecisions ?? params.available_decisions);
    const additionalPermissions = params.additionalPermissions ?? params.additional_permissions;
    const networkApprovalContext = params.networkApprovalContext ?? params.network_approval_context;
    const proposedExecpolicyAmendment =
      params.proposedExecpolicyAmendment ?? params.proposed_execpolicy_amendment;
    const proposedNetworkPolicyAmendments = optionalUnknownArray(
      params.proposedNetworkPolicyAmendments ?? params.proposed_network_policy_amendments
    );
    const networkApproval = isNetworkApprovalParams(params);
    const request = this.createApprovalRequest(message, {
      tool: "shell",
      action: networkApproval ? "network_access" : "run_command",
      command,
      rawText: approvalRawText(params, command, networkApproval),
      riskLevel: "medium"
    });

    this.publishApprovalRequest(message, request, {
      responseKind: "decision",
      availableDecisions,
      additionalPermissions,
      networkApprovalContext,
      proposedExecpolicyAmendment,
      proposedNetworkPolicyAmendments,
      raw: params
    });
  }

  private handlePermissionsApprovalRequest(message: JsonRpcRequest): void {
    if (message.id === undefined) return;

    const params = asRecord(message.params);
    const requestedPermissions = params.permissions ?? params.requestedPermissions ?? params.requested_permissions;
    const networkApproval = hasEnabledNetworkPermission(requestedPermissions) || isNetworkReason(params.reason);
    const request = this.createApprovalRequest(message, {
      tool: "codex",
      action: networkApproval ? "network_permissions" : "request_permissions",
      rawText: approvalRawText(params, undefined, networkApproval),
      riskLevel: "medium"
    });

    this.publishApprovalRequest(message, request, {
      responseKind: "permissions",
      requestedPermissions,
      raw: params
    });
  }

  private handleFileChangeApprovalRequest(message: JsonRpcRequest): void {
    if (message.id === undefined) return;

    const params = asRecord(message.params);
    const grantRoot = parseOptionalString(params.grantRoot ?? params.grant_root);
    const reason = parseOptionalString(params.reason);
    const request = this.createApprovalRequest(message, {
      tool: "codex",
      action: "file_change",
      command: grantRoot ? `Allow file changes under ${grantRoot}` : undefined,
      rawText: reason ?? (grantRoot ? `Codex requests write access under ${grantRoot}.` : "Codex requests approval for file changes."),
      riskLevel: "medium",
      availableDecisions: ["accept", "acceptForSession", "decline", "cancel"]
    });

    this.publishApprovalRequest(message, request, {
      responseKind: "decision",
      availableDecisions: ["accept", "acceptForSession", "decline", "cancel"],
      raw: params
    });
  }

  private handleMcpServerElicitationRequest(message: JsonRpcRequest): void {
    if (message.id === undefined) return;

    const params = asRecord(message.params);
    const serverName = parseOptionalString(params.serverName ?? params.server_name) ?? "mcp";
    const request = this.createApprovalRequest(message, {
      tool: serverName,
      action: "mcp_elicitation",
      rawText: mcpElicitationRawText(params, serverName),
      riskLevel: "medium",
      availableDecisions: ["accept", "decline", "cancel"]
    });

    this.publishApprovalRequest(message, request, {
      responseKind: "mcp_elicitation",
      raw: params
    });
  }

  private handleToolRequestUserInput(message: JsonRpcRequest): void {
    if (message.id === undefined) return;

    const params = asRecord(message.params);
    const questions = Array.isArray(params.questions) ? params.questions : [];
    const request = this.createApprovalRequest(message, {
      tool: "codex",
      action: "request_user_input",
      rawText: toolUserInputRawText(questions),
      riskLevel: "medium"
    });

    this.publishApprovalRequest(message, request, {
      responseKind: "tool_user_input",
      raw: params
    });
  }

  private handleServerRequestResolved(message: JsonRpcRequest): void {
    const params = asRecord(message.params);
    const requestId = parseOptionalString(params.requestId ?? params.request_id);

    if (!requestId) return;

    this.pendingApprovals.delete(requestId);
    this.emitOutputForMessage(message, "approval_resolved", requestId);
  }

  private async refreshRateLimits(): Promise<void> {
    try {
      const result = await this.sendRequest("account/rateLimits/read", undefined, { timeoutMs: 1500 });
      this.updateRateLimitsFromRead(result);
    } catch (error) {
      this.writeLine(`[codex-app] rate limits unavailable: ${formatError(error)}`);
    }
  }

  private handleAccountRateLimitsUpdated(message: JsonRpcRequest): void {
    const snapshot = parseRateLimitSnapshot(asRecord(message.params).rateLimits, this.now());
    if (!snapshot) return;

    const byLimitId = { ...(this.rateLimits?.byLimitId ?? {}) };
    if (snapshot.limitId) {
      byLimitId[snapshot.limitId] = mergeRateLimitSnapshot(byLimitId[snapshot.limitId], snapshot);
    }

    const selected = selectRateLimitSnapshot(byLimitId, snapshot);
    this.rateLimits = {
      selected,
      ...(Object.keys(byLimitId).length > 0 ? { byLimitId } : {}),
      updatedAt: this.now()
    };
    this.publishStatus(this.status);
  }

  private updateRateLimitsFromRead(result: unknown): void {
    const record = asRecord(result);
    const byLimitId: Record<string, CodexRateLimitSnapshot> = {};
    const rawByLimitId = asRecord(record.rateLimitsByLimitId ?? record.rate_limits_by_limit_id);

    for (const [limitId, value] of Object.entries(rawByLimitId)) {
      const snapshot = parseRateLimitSnapshot(value, this.now(), limitId);
      if (snapshot) byLimitId[limitId] = snapshot;
    }

    const fallback = parseRateLimitSnapshot(record.rateLimits ?? record.rate_limits, this.now());
    if (fallback?.limitId && byLimitId[fallback.limitId] === undefined) {
      byLimitId[fallback.limitId] = fallback;
    }
    const selected = selectRateLimitSnapshot(byLimitId, fallback);
    if (!selected) return;

    this.rateLimits = {
      selected,
      ...(Object.keys(byLimitId).length > 0 ? { byLimitId } : {}),
      updatedAt: this.now()
    };
    this.publishStatus(this.status);
  }

  private handleApprovalRequest(message: JsonRpcRequest): void {
    if (message.id === undefined) return;

    const params = asRecord(message.params);
    const request = this.createApprovalRequest(message, {
      tool: parseOptionalString(params.tool) ?? "codex",
      action: parseOptionalString(params.action) ?? parseOptionalString(message.method) ?? "approval_request",
      command: parseOptionalString(params.command),
      rawText:
        parseOptionalString(params.reason) ??
        parseOptionalString(params.description) ??
        parseOptionalString(params.title) ??
        `Codex requests approval for ${message.method ?? "an action"}.`,
      riskLevel: "medium"
    });

    this.publishApprovalRequest(message, request, {
      responseKind: "decision",
      availableDecisions: optionalUnknownArray(params.availableDecisions ?? params.available_decisions),
      additionalPermissions: params.additionalPermissions ?? params.additional_permissions,
      networkApprovalContext: params.networkApprovalContext ?? params.network_approval_context,
      proposedExecpolicyAmendment: params.proposedExecpolicyAmendment ?? params.proposed_execpolicy_amendment,
      proposedNetworkPolicyAmendments: optionalUnknownArray(
        params.proposedNetworkPolicyAmendments ?? params.proposed_network_policy_amendments
      ),
      raw: params
    });
  }

  private createApprovalRequest(
    message: JsonRpcRequest,
    details: {
      tool: string;
      action: string;
      command?: string;
      rawText: string;
      riskLevel: PermissionRequest["riskLevel"];
      availableDecisions?: unknown[];
    }
  ): PermissionRequest {
    const params = asRecord(message.params);
    const threadId = extractThreadId(params);
    const turnId = extractTurnId(params);
    const itemId = extractItemId(params);
    const availableDecisions = details.availableDecisions ?? optionalUnknownArray(params.availableDecisions ?? params.available_decisions);
    return {
      id: String(message.id),
      sessionId: this.resolveSessionId(message),
      tool: details.tool,
      action: details.action,
      command: details.command,
      riskLevel: details.riskLevel,
      rawText: details.rawText,
      createdAt: this.now(),
      native: {
        backend: "codex",
        requestMethod: message.method,
        threadId,
        turnId,
        itemId,
        availableDecisions,
        additionalPermissions: params.additionalPermissions ?? params.additional_permissions,
        networkApprovalContext: params.networkApprovalContext ?? params.network_approval_context,
        requestedPermissions: params.permissions ?? params.requestedPermissions ?? params.requested_permissions,
        proposedExecpolicyAmendment: params.proposedExecpolicyAmendment ?? params.proposed_execpolicy_amendment,
        proposedNetworkPolicyAmendments: optionalUnknownArray(
          params.proposedNetworkPolicyAmendments ?? params.proposed_network_policy_amendments
        ),
        raw: params
      }
    };
  }

  private publishApprovalRequest(
    message: JsonRpcRequest,
    request: PermissionRequest,
    pending: Omit<
      PendingCodexApproval,
      "rpcId" | "requestMethod" | "threadId" | "turnId" | "itemId" | "createdAt" | "resolved" | "params"
    >
  ): void {
    if (message.id === undefined) return;
    if (this.pendingApprovals.has(request.id)) {
      this.writeLine(`[codex-app] duplicate approval request ignored: ${request.id}`);
      return;
    }

    const params = asRecord(message.params);
    this.pendingApprovals.set(request.id, {
      rpcId: message.id,
      requestMethod: message.method ?? "unknown",
      threadId: extractThreadId(params),
      turnId: extractTurnId(params),
      itemId: extractItemId(params),
      createdAt: request.createdAt,
      resolved: false,
      params,
      ...pending
    });
    this.writeLine(`[codex-app] approval requested: ${request.command ?? request.action}`);
    this.publishStatus({
      ...this.status,
      task: "waiting_permission",
      currentTool: request.tool
    });
    this.permissionListeners.forEach((listener) => listener(request));
  }

  private isApprovalRequest(message: JsonRpcRequest): boolean {
    if (message.id === undefined) return false;

    const params = asRecord(message.params);
    if (message.method?.includes("requestApproval")) return true;
    return optionalUnknownArray(params.availableDecisions ?? params.available_decisions) !== undefined;
  }

  private isMcpElicitationRequest(message: JsonRpcRequest): boolean {
    if (message.id === undefined) return false;

    const method = message.method ?? "";
    if (!/elicitation\/request$/u.test(method)) return false;

    const params = asRecord(message.params);
    return params.request !== undefined || params.serverName !== undefined || params.server_name !== undefined;
  }

  private emitCommandExecOutput(message: JsonRpcRequest): void {
    const params = asRecord(message.params);
    const stream = params.stream === "stderr" ? "stderr" : "stdout";
    const deltaBase64 = typeof params.deltaBase64 === "string" ? params.deltaBase64 : "";
    const text = deltaBase64 ? Buffer.from(deltaBase64, "base64").toString("utf8") : "";

    this.emitOutputForMessage(message, stream, text);
  }

  private handleTurnStarted(message: JsonRpcRequest): void {
    const turnId = extractTurnId(message.params);
    if (!turnId) return;

    this.turnId = turnId;
    this.rememberTurnSession(turnId, this.currentSessionId);
    this.publishStatus({
      ...this.status,
      task: "thinking"
    });
  }

  private handleTurnCompleted(message: JsonRpcRequest): void {
    const turnId = extractTurnId(message.params);
    const sessionId = this.resolveSessionId(message);
    this.emitOutput("task_complete", "Task complete", {
      sessionId,
      turnId
    });

    if (!turnId || turnId === this.turnId) {
      this.clearDeniedApprovalRecovery(turnId);
      this.turnId = undefined;
      this.publishStatus({
        ...this.status,
        task: "idle"
      });
    }
  }

  private emitOutputForMessage(message: JsonRpcRequest, type: CodexOutputEvent["type"], text: string): void {
    const turnId = extractTurnId(message.params);
    this.emitOutput(type, text, {
      sessionId: this.resolveSessionId(message),
      turnId
    });
  }

  private resolveSessionId(message: JsonRpcRequest): string {
    const turnId = extractTurnId(message.params);
    return (turnId ? this.turnSessions.get(turnId) : undefined) ?? this.currentSessionId;
  }

  private rememberTurnSession(turnId: string, sessionId: string): void {
    if (!this.turnSessions.has(turnId)) {
      this.turnSessionOrder.push(turnId);
    }
    this.turnSessions.set(turnId, sessionId);

    while (this.turnSessionOrder.length > MAX_TURN_SESSION_MAPPINGS) {
      const staleTurnId = this.turnSessionOrder.shift();
      if (staleTurnId) this.turnSessions.delete(staleTurnId);
    }
  }

  private emitOutput(
    type: CodexOutputEvent["type"],
    text: string,
    options: { sessionId?: string; turnId?: string } = {}
  ): void {
    if (!text) return;

    const event: CodexOutputEvent = {
      sessionId: options.sessionId ?? this.currentSessionId,
      type,
      text,
      ...(options.turnId ? { turnId: options.turnId } : {}),
      timestamp: this.now()
    };

    this.outputListeners.forEach((listener) => listener(event));
  }

  private publishStatus(status: CodexStatus): void {
    this.status = {
      ...status,
      ...(this.rateLimits ? { rateLimits: this.rateLimits } : {})
    };
    this.statusListeners.forEach((listener) => listener(this.status));
  }

  private scheduleDeniedApprovalRecovery(pending: PendingCodexApproval): void {
    this.clearDeniedApprovalRecovery();

    const turnId = pending.turnId ?? this.turnId;
    this.deniedApprovalRecoveryTurnId = turnId;
    this.deniedApprovalRecoveryTimer = setTimeout(() => {
      this.deniedApprovalRecoveryTimer = undefined;
      this.deniedApprovalRecoveryTurnId = undefined;

      if (this.pendingApprovals.size > 0) return;
      if (turnId && this.turnId && this.turnId !== turnId) return;
      if (this.status.task !== "thinking") return;

      if (turnId && this.turnId === turnId) {
        this.turnId = undefined;
      }

      this.writeLine(`[codex-app] denied approval recovery timeout after ${this.deniedApprovalRecoveryMs}ms`);
      this.publishStatus({
        ...this.status,
        task: "idle",
        currentTool: undefined
      });
    }, this.deniedApprovalRecoveryMs);
    this.deniedApprovalRecoveryTimer.unref?.();
  }

  private clearDeniedApprovalRecovery(turnId?: string): void {
    if (!this.deniedApprovalRecoveryTimer) return;
    if (turnId && this.deniedApprovalRecoveryTurnId && this.deniedApprovalRecoveryTurnId !== turnId) return;

    clearTimeout(this.deniedApprovalRecoveryTimer);
    this.deniedApprovalRecoveryTimer = undefined;
    this.deniedApprovalRecoveryTurnId = undefined;
  }

  private writeVisibleProcessOutput(type: "stdout" | "stderr", text: string): void {
    const visible = text.trim();
    if (visible) this.writeLine(`[codex-app:${type}] ${visible}`);
  }

  private detectEndpoint(text: string, complete: (endpoint: string) => void): void {
    const endpoint = text.match(/listening on:\s*(ws:\/\/[^\s]+)/)?.[1];
    if (endpoint) complete(endpoint);
  }

  private requireSocket(): WebSocketLike {
    if (!this.socket) {
      throw new Error("Codex app-server websocket is not connected.");
    }

    return this.socket;
  }

  private resolveNativeResponse(decision: PermissionDecision, pending: PendingCodexApproval): Record<string, unknown> {
    if (pending.responseKind === "permissions") {
      return this.resolvePermissionsResponse(decision, pending);
    }

    if (pending.responseKind === "mcp_elicitation") {
      return this.resolveMcpElicitationResponse(decision, pending);
    }

    if (pending.responseKind === "tool_user_input") {
      return this.resolveToolUserInputResponse(decision, pending);
    }

    return {
      decision: this.resolveNativeDecision(decision, pending)
    };
  }

  private resolveMcpElicitationResponse(decision: PermissionDecision, pending: PendingCodexApproval): Record<string, unknown> {
    if (decision.decision === "cancel") {
      return {
        action: "cancel",
        content: null,
        _meta: {}
      };
    }

    if (decision.decision === "deny") {
      return {
        action: "decline",
        content: null,
        _meta: {}
      };
    }

    if (isMcpUrlElicitation(pending.raw)) {
      return {
        action: "accept",
        content: null,
        _meta: {}
      };
    }

    return {
      action: "accept",
      content: mcpElicitationAcceptContent(pending.raw, decision.transcript),
      _meta: {}
    };
  }

  private resolveToolUserInputResponse(decision: PermissionDecision, pending: PendingCodexApproval): Record<string, unknown> {
    if (decision.decision !== "allow") {
      return {
        answers: {}
      };
    }

    return {
      answers: toolUserInputAnswers(pending.raw, decision.transcript)
    };
  }

  private resolvePermissionsResponse(decision: PermissionDecision, pending: PendingCodexApproval): Record<string, unknown> {
    if (decision.decision !== "allow") {
      return {
        permissions: {},
        scope: "turn"
      };
    }

    return {
      permissions: grantedPermissions(pending.requestedPermissions, pending.raw),
      scope: decision.scope === "session" || decision.scope === "network" ? "session" : "turn"
    };
  }

  private resolveNativeDecision(decision: PermissionDecision, pending: PendingCodexApproval): unknown {
    if (decision.decision === "cancel") {
      return this.requireAvailableDecision(pending, ["cancel", "decline", "reject", "deny"]);
    }

    if (decision.decision === "deny") {
      return this.requireAvailableDecision(pending, ["decline", "reject", "deny", "cancel"]);
    }

    if (decision.scope === "network") {
      const amendment = selectNetworkPolicyAmendment(pending.proposedNetworkPolicyAmendments);

      if (amendment !== undefined && supportsDecision(pending.availableDecisions, "applyNetworkPolicyAmendment")) {
        return {
          applyNetworkPolicyAmendment: {
            network_policy_amendment: amendment
          }
        };
      }

      throw new Error("Codex approval does not offer a persistent network-policy decision for this request.");
    }

    if (decision.scope === "tool" || decision.scope === "project") {
      if (
        pending.proposedExecpolicyAmendment !== undefined &&
        supportsDecision(pending.availableDecisions, "acceptWithExecpolicyAmendment")
      ) {
        return {
          acceptWithExecpolicyAmendment: {
            execpolicy_amendment: pending.proposedExecpolicyAmendment
          }
        };
      }

      throw new Error("Codex approval does not offer a persistent command-policy decision for this request.");
    }

    if (decision.remember || decision.scope === "session") {
      return this.requireAvailableDecision(pending, ["acceptForSession"]);
    }

    return this.requireAvailableDecision(pending, ["accept"]);
  }

  private requireAvailableDecision(
    pending: PendingCodexApproval,
    names: string[]
  ): string {
    const supported = names.find((name) => supportsDecision(pending.availableDecisions, name));

    if (supported) return supported;

    const available = describeAvailableDecisions(pending.availableDecisions);
    throw new Error(`Codex approval does not offer ${names.join(" or ")} for this request. Available: ${available}.`);
  }
}

function parseMessage(data: unknown): Record<string, unknown> {
  if (typeof data === "string") return JSON.parse(data) as Record<string, unknown>;
  if (data instanceof Buffer) return JSON.parse(data.toString()) as Record<string, unknown>;
  return JSON.parse(String(data)) as Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function parseRateLimitSnapshot(value: unknown, now: number, fallbackLimitId?: string): CodexRateLimitSnapshot | undefined {
  const record = asRecord(value);
  const primary = parseRateLimitWindow(record.primary, now);
  const secondary = parseRateLimitWindow(record.secondary, now);
  if (!primary && !secondary) return undefined;

  const limitId = parseOptionalString(record.limitId ?? record.limit_id) ?? fallbackLimitId;
  const limitName = parseOptionalString(record.limitName ?? record.limit_name);
  const planType = parseOptionalString(record.planType ?? record.plan_type);

  return {
    ...(limitId ? { limitId } : {}),
    ...(limitName ? { limitName } : {}),
    ...(planType ? { planType } : {}),
    ...(primary ? { primary } : {}),
    ...(secondary ? { secondary } : {}),
    text: formatRateLimitText(primary, secondary)
  };
}

function parseRateLimitWindow(value: unknown, now: number): CodexRateLimitWindow | undefined {
  const record = asRecord(value);
  const usedPercent = parseFiniteNumber(record.usedPercent ?? record.used_percent);
  if (usedPercent === undefined) return undefined;

  const windowDurationMins = parseFiniteNumber(record.windowDurationMins ?? record.window_duration_mins);
  const resetsAt = parseFiniteNumber(record.resetsAt ?? record.resets_at);
  const clampedUsedPercent = clampNumber(usedPercent, 0, 100);

  return {
    label: formatRateLimitWindowLabel(windowDurationMins),
    usedPercent: roundOne(clampedUsedPercent),
    remainingPercent: roundOne(100 - clampedUsedPercent),
    ...(windowDurationMins !== undefined ? { windowDurationMins } : {}),
    ...(resetsAt !== undefined ? { resetsAt } : {}),
    ...(resetsAt !== undefined ? { resetIn: formatResetIn(resetsAt, now) } : {})
  };
}

function mergeRateLimitSnapshot(
  previous: CodexRateLimitSnapshot | undefined,
  next: CodexRateLimitSnapshot
): CodexRateLimitSnapshot {
  const merged = {
    ...(previous ?? {}),
    ...next,
    ...(next.primary ? { primary: next.primary } : previous?.primary ? { primary: previous.primary } : {}),
    ...(next.secondary ? { secondary: next.secondary } : previous?.secondary ? { secondary: previous.secondary } : {})
  };

  return {
    ...merged,
    text: formatRateLimitText(merged.primary, merged.secondary)
  };
}

function selectRateLimitSnapshot(
  byLimitId: Record<string, CodexRateLimitSnapshot>,
  fallback: CodexRateLimitSnapshot | undefined
): CodexRateLimitSnapshot | undefined {
  return byLimitId.codex ?? byLimitId["codex-gpt-5"] ?? byLimitId["codex_gpt_5"] ?? fallback ?? Object.values(byLimitId)[0];
}

function formatRateLimitText(
  primary: CodexRateLimitWindow | undefined,
  secondary: CodexRateLimitWindow | undefined
): string {
  return [primary, secondary]
    .filter((window): window is CodexRateLimitWindow => Boolean(window))
    .map((window) => {
      const reset = window.resetIn ? `, reset ${window.resetIn}` : "";
      return `${window.label} ${formatPercent(window.remainingPercent)}% left${reset}`;
    })
    .join(" · ");
}

function formatRateLimitWindowLabel(durationMins: number | undefined): string {
  if (durationMins === undefined) return "usage";
  if (durationMins === 300) return "5h";
  if (durationMins === 10080) return "1w";
  if (durationMins % 10080 === 0) return `${durationMins / 10080}w`;
  if (durationMins % 1440 === 0) return `${durationMins / 1440}d`;
  if (durationMins % 60 === 0) return `${durationMins / 60}h`;
  return `${durationMins}m`;
}

function formatResetIn(resetsAt: number, now: number): string {
  const resetMs = resetsAt > 1_000_000_000_000 ? resetsAt : resetsAt * 1000;
  const remainingMs = Math.max(0, resetMs - now);
  const totalMins = Math.ceil(remainingMs / 60_000);
  if (totalMins <= 0) return "now";

  const days = Math.floor(totalMins / 1440);
  const hours = Math.floor((totalMins % 1440) / 60);
  const mins = totalMins % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function formatPercent(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/u, "");
}

function parseFiniteNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}

function optionalUnknownArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function parseStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function parseOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function extractThreadId(value: unknown): string | undefined {
  const params = asRecord(value);
  const direct = parseOptionalString(params.threadId ?? params.thread_id);
  if (direct) return direct;

  const thread = asRecord(params.thread);
  const threadId = parseOptionalString(thread.id ?? thread.threadId ?? thread.thread_id);
  if (threadId) return threadId;

  const item = asRecord(params.item);
  return parseOptionalString(item.threadId ?? item.thread_id);
}

function extractTurnId(value: unknown): string | undefined {
  const params = asRecord(value);
  const direct = parseOptionalString(params.turnId ?? params.turn_id);
  if (direct) return direct;

  const turn = asRecord(params.turn);
  const turnId = parseOptionalString(turn.id ?? turn.turnId ?? turn.turn_id);
  if (turnId) return turnId;

  const item = asRecord(params.item);
  return parseOptionalString(item.turnId ?? item.turn_id);
}

function extractItemId(value: unknown): string | undefined {
  const params = asRecord(value);
  const direct = parseOptionalString(params.itemId ?? params.item_id);
  if (direct) return direct;

  const item = asRecord(params.item);
  return parseOptionalString(item.id ?? item.itemId ?? item.item_id);
}

function approvalRawText(params: Record<string, unknown>, command: string | undefined, networkApproval: boolean): string {
  const reason = parseOptionalString(params.reason);
  const networkContext = asRecord(params.networkApprovalContext ?? params.network_approval_context);
  const host = parseOptionalString(networkContext.host);

  if (networkApproval) {
    const parts = ["Codex requests network access"];
    if (host) parts.push(`to ${host}`);
    if (command) parts.push(`for: ${command}`);
    if (reason) parts.push(`Reason: ${reason}`);
    return parts.join(". ");
  }

  if (command) return `Run command: ${command} ?`;
  return reason ?? "Codex requests approval.";
}

function mcpElicitationRawText(params: Record<string, unknown>, serverName: string): string {
  const request = asRecord(params.request);
  const schema = mcpElicitationSchema(params);
  const mode = parseOptionalString(params.mode ?? request.mode);
  const url = parseOptionalString(params.url ?? request.url);
  const title =
    parseOptionalString(request.title ?? params.title) ??
    parseOptionalString(schema.title);
  const message =
    parseOptionalString(request.message ?? request.prompt ?? request.description ?? params.message ?? params.reason) ??
    parseOptionalString(schema.description);
  const fields = mcpElicitationFieldSummary(schema);
  const urlLine = mode === "url" && url ? `URL: ${url}` : undefined;

  const parts = [title && title !== message ? title : undefined, message, urlLine, fields].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join("\n") : `MCP server ${serverName} requests input.`;
}

function mcpElicitationAcceptContent(raw: Record<string, unknown>, transcript?: string): Record<string, unknown> {
  const schema = mcpElicitationSchema(raw);
  const properties = asRecord(schema.properties);
  const required = parseStringArray(schema.required);
  const explicitAnswers = mcpExplicitFieldAnswers(schema, transcript);
  const content: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(properties)) {
    const propertySchema = asRecord(value);
    const selected = mcpAcceptValue(propertySchema) ?? explicitAnswers[key];
    if (selected !== undefined || required.includes(key)) {
      if (selected === undefined) {
        throw new Error(`MCP elicitation requires explicit input for field "${key}".`);
      }
      content[key] = selected;
    }
  }

  return content;
}

function mcpExplicitFieldAnswers(schema: Record<string, unknown>, transcript: string | undefined): Record<string, unknown> {
  const text = transcript?.trim();
  if (!text || isStandaloneMcpApprovalIntent(text)) {
    return {};
  }

  const properties = asRecord(schema.properties);
  const required = parseStringArray(schema.required);
  const answers: Record<string, unknown> = {};
  const missingRequired = required.filter((key) => mcpAcceptValue(asRecord(properties[key])) === undefined);

  for (const [key, value] of Object.entries(properties)) {
    const propertySchema = asRecord(value);
    const label = parseOptionalString(propertySchema.title) ?? key;
    const explicit = extractLabeledMcpAnswer(text, [key, label]);
    if (explicit !== undefined) answers[key] = coerceMcpExplicitAnswer(explicit, propertySchema);
  }

  if (missingRequired.length === 1 && answers[missingRequired[0]] === undefined) {
    answers[missingRequired[0]] = coerceMcpExplicitAnswer(text, asRecord(properties[missingRequired[0]]));
  }

  return answers;
}

function extractLabeledMcpAnswer(text: string, labels: string[]): string | undefined {
  for (const label of labels) {
    const escaped = escapeRegExp(label);
    const match = text.match(new RegExp(`(?:^|[\\n,;])\\s*${escaped}\\s*(?:[:=]|은|는|:)?\\s*(.+?)(?=$|[\\n,;])`, "iu"));
    const value = match?.[1]?.trim();
    if (value) return value;
  }

  return undefined;
}

function coerceMcpExplicitAnswer(text: string, schema: Record<string, unknown>): unknown {
  switch (schema.type) {
    case "boolean":
      if (/^(true|yes|y|1|on|허용|승인|예|네)$/iu.test(text)) return true;
      if (/^(false|no|n|0|off|거부|아니|아니오)$/iu.test(text)) return false;
      return text;
    case "integer": {
      const parsed = parseFiniteNumber(text);
      return parsed === undefined ? text : Math.trunc(parsed);
    }
    case "number":
      return parseFiniteNumber(text) ?? text;
    case "array":
      return text.split(",").map((item) => item.trim()).filter(Boolean);
    case "object":
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return text;
      }
    default:
      return text;
  }
}

function mcpElicitationSchema(raw: Record<string, unknown>): Record<string, unknown> {
  const request = asRecord(raw.request);
  return asRecord(raw.requestedSchema ?? raw.requested_schema ?? raw.schema ?? request.requestedSchema ?? request.requested_schema ?? request.schema);
}

function isMcpUrlElicitation(raw: Record<string, unknown>): boolean {
  const request = asRecord(raw.request);
  return parseOptionalString(raw.mode ?? request.mode) === "url" || parseOptionalString(raw.url ?? request.url) !== undefined;
}

function mcpElicitationFieldSummary(schema: Record<string, unknown>): string | undefined {
  const properties = asRecord(schema.properties);
  if (Object.keys(properties).length === 0) return undefined;

  const required = new Set(parseStringArray(schema.required));
  const fields = Object.entries(properties).map(([key, value]) => {
    const propertySchema = asRecord(value);
    const label = parseOptionalString(propertySchema.title) ?? key;
    const choices = mcpSchemaChoices(propertySchema);
    const defaultValue = propertySchema.default !== undefined ? ` default=${String(propertySchema.default)}` : "";
    const suffix = [
      required.has(key) ? "required" : undefined,
      choices.length > 0 ? `choices=${choices.join(" / ")}` : undefined
    ].filter(Boolean).join(", ");
    return `${label}${defaultValue}${suffix ? ` (${suffix})` : ""}`;
  });
  return `Fields: ${fields.join("; ")}`;
}

function mcpSchemaChoices(schema: Record<string, unknown>): string[] {
  const enumValues = optionalUnknownArray(schema.enum);
  if (enumValues) return enumValues.map(String);

  const options = optionalUnknownArray(schema.oneOf) ?? optionalUnknownArray(schema.anyOf);
  if (!options) return [];

  return options
    .map((option) => {
      const record = asRecord(option);
      return parseOptionalString(record.title) ?? parseOptionalString(record.description) ?? (record.const !== undefined ? String(record.const) : undefined);
    })
    .filter((value): value is string => Boolean(value));
}

function toolUserInputRawText(questions: unknown[]): string {
  if (questions.length === 0) return "Codex requests user input.";

  const lines = questions.map((question, index) => {
    const record = asRecord(question);
    const prompt = parseOptionalString(record.question ?? record.prompt ?? record.text ?? record.label) ?? `Question ${index + 1}`;
    const id = parseOptionalString(record.id);
    const options = Array.isArray(record.options)
      ? record.options.map((option) => parseOptionalString(asRecord(option).label) ?? parseOptionalString(asRecord(option).value) ?? parseOptionalString(option)).filter((value): value is string => Boolean(value))
      : [];
    return `${id ? `${id}: ` : ""}${prompt}${options.length > 0 ? ` (${options.join(" / ")})` : ""}`;
  });
  return lines.join("\n");
}

function toolUserInputAnswers(raw: Record<string, unknown>, transcript: string | undefined): Record<string, unknown> {
  const questions = Array.isArray(raw.questions) ? raw.questions : [];
  const answerText = transcript?.trim() || "허용";
  const answers: Record<string, unknown> = {};

  for (const [index, question] of questions.entries()) {
    const record = asRecord(question);
    const id = parseOptionalString(record.id) ?? `question_${index + 1}`;
    answers[id] = toolUserInputAnswer(record, answerText);
  }

  return answers;
}

function toolUserInputAnswer(question: Record<string, unknown>, answerText: string): unknown {
  const options = Array.isArray(question.options) ? question.options : [];
  if (options.length === 0) return { answers: [answerText] };

  const normalized = normalizeForChoice(answerText);
  const option = options.map(asRecord).find((candidate) => {
    const label = parseOptionalString(candidate.label);
    return label ? normalizeForChoice(label).includes(normalized) : false;
  }) ?? options.map(asRecord).find((candidate) => {
    const label = parseOptionalString(candidate.label);
    return label ? isPositiveMcpApprovalValue(label) : false;
  }) ?? asRecord(options[0]);

  return {
    answers: [parseOptionalString(option.label) ?? answerText]
  };
}

function normalizeForChoice(value: string): string {
  return value.toLowerCase().replace(/\s+/gu, "");
}

function mcpAcceptValue(schema: Record<string, unknown>): unknown {
  if (schema.const !== undefined) return schema.const;
  if (schema.default !== undefined) return schema.default;

  const enumValues = optionalUnknownArray(schema.enum);
  if (enumValues && enumValues.length > 0) {
    return (
      enumValues.find(isPositiveMcpApprovalValue) ??
      enumValues.find((value) => !isNegativeMcpApprovalValue(value)) ??
      enumValues[0]
    );
  }

  const option = selectMcpAcceptOption(optionalUnknownArray(schema.oneOf)) ?? selectMcpAcceptOption(optionalUnknownArray(schema.anyOf));
  if (option !== undefined) return option;

  return undefined;
}

function selectMcpAcceptOption(options: unknown[] | undefined): unknown {
  if (!options || options.length === 0) return undefined;

  const records = options.map(asRecord).filter((option) => Object.keys(option).length > 0);
  const positive = records.find((option) =>
    isPositiveMcpApprovalValue(option.const) ||
    isPositiveMcpApprovalValue(option.title) ||
    isPositiveMcpApprovalValue(option.description)
  );
  const fallback = positive ?? records.find((option) =>
    !isNegativeMcpApprovalValue(option.const) &&
    !isNegativeMcpApprovalValue(option.title) &&
    !isNegativeMcpApprovalValue(option.description)
  ) ?? records[0];

  if (fallback.const !== undefined) return fallback.const;
  if (fallback.default !== undefined) return fallback.default;
  return undefined;
}

function isPositiveMcpApprovalValue(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return /\b(allow|approve|accept|yes|confirm|ok)\b|허용|승인|동의|확인/iu.test(value);
}

function isNegativeMcpApprovalValue(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return /\b(deny|decline|reject|cancel|no)\b|거부|취소|반려|불허|거절/iu.test(value);
}

function isCancelMcpApprovalValue(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return /\b(cancel|stop)\b|취소|멈춰|중단/iu.test(value);
}

function isStandaloneMcpApprovalIntent(value: string): boolean {
  const text = value.trim();
  return /^(allow|approve|accept|yes|confirm|ok|허용|승인|동의|확인)$/iu.test(text) ||
    /^(deny|decline|reject|no|거부|반려|불허|거절)$/iu.test(text) ||
    /^(cancel|stop|취소|멈춰|중단)$/iu.test(text);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function isNetworkApprovalParams(params: Record<string, unknown>): boolean {
  return (
    hasEnabledNetworkPermission(params.additionalPermissions ?? params.additional_permissions) ||
    Object.keys(asRecord(params.networkApprovalContext ?? params.network_approval_context)).length > 0 ||
    optionalUnknownArray(params.proposedNetworkPolicyAmendments ?? params.proposed_network_policy_amendments) !== undefined ||
    isNetworkReason(params.reason)
  );
}

function hasEnabledNetworkPermission(value: unknown): boolean {
  const permissions = asRecord(value);
  const network = asRecord(permissions.network);
  return network.enabled === true;
}

function isNetworkReason(value: unknown): boolean {
  const reason = parseOptionalString(value);
  return reason ? /\b(network|dns|host|github|connection|connect|internet)\b|네트워크|디엔에스|깃허브|호스트|접속|연결/iu.test(reason) : false;
}

function grantedPermissions(requestedPermissions: unknown, raw: Record<string, unknown>): Record<string, unknown> {
  const requested = asRecord(requestedPermissions);
  const permissions: Record<string, unknown> = {};

  if (hasEnabledNetworkPermission(requested)) {
    permissions.network = {
      enabled: true
    };
  }

  if (requested.fileSystem !== undefined || requested.file_system !== undefined) {
    permissions.fileSystem = requested.fileSystem ?? requested.file_system;
  }

  if (Object.keys(permissions).length > 0) return permissions;

  if (isNetworkReason(raw.reason)) {
    return {
      network: {
        enabled: true
      }
    };
  }

  return {};
}

function selectNetworkPolicyAmendment(amendments: unknown[] | undefined): unknown {
  if (!amendments || amendments.length === 0) return undefined;

  return amendments.find((amendment) => asRecord(amendment).action === "allow") ?? amendments[0];
}

function supportsDecision(availableDecisions: unknown[] | undefined, name: string): boolean {
  if (!availableDecisions || availableDecisions.length === 0) return true;

  return availableDecisions.some((decision) => {
    if (typeof decision === "string") return decision === name;

    const record = asRecord(decision);
    if (record.decision === name || record.type === name || record.name === name) return true;
    return Object.prototype.hasOwnProperty.call(record, name);
  });
}

function describeAvailableDecisions(availableDecisions: unknown[] | undefined): string {
  if (!availableDecisions || availableDecisions.length === 0) return "legacy app-server did not list choices";
  return availableDecisions
    .map((decision) => {
      if (typeof decision === "string") return decision;
      const record = asRecord(decision);
      return String(record.decision ?? record.type ?? record.name ?? Object.keys(record)[0] ?? "unknown");
    })
    .join(", ");
}

function createDefaultWebSocket(url: string): WebSocketLike {
  if (typeof WebSocket === "undefined") {
    throw new Error("This Node.js runtime does not provide a global WebSocket client.");
  }

  return new WebSocket(url) as WebSocketLike;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function responseLanguagePolicyPrompt(language: CodexPrompt["responseLanguage"]): string | undefined {
  switch (language) {
    case "ko":
      return "Runtime policy: Reply to the user in Korean, regardless of the input language.";
    case "en":
      return "Runtime policy: Reply to the user in English, regardless of the input language.";
    case "auto":
      return "Runtime policy: Reply in the user's language unless the task explicitly asks for another language.";
    default:
      return undefined;
  }
}

function sanitizeRecoveryTimeout(value: number | undefined): number {
  if (value === undefined) return DENIED_APPROVAL_RECOVERY_MS;
  if (!Number.isFinite(value) || value <= 0) return DENIED_APPROVAL_RECOVERY_MS;
  return Math.max(1, Math.floor(value));
}

function noop(_line: string): void {}
