import { spawn, type SpawnOptionsWithoutStdio } from "node:child_process";

import type { PermissionDecision } from "../permission/PermissionDecision.ts";
import type { PermissionRequest } from "../permission/PermissionRequest.ts";
import type { AgentBackend, CodexProcessConfig } from "./CodexBridge.ts";
import type { CodexOutputEvent, CodexStatus } from "./CodexOutputEvent.ts";
import type { CodexPrompt } from "./CodexPrompt.ts";

type RequestId = string | number;
type WriteLine = (line: string) => void;

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
  availableDecisions?: unknown[];
  proposedExecpolicyAmendment?: unknown;
  proposedNetworkPolicyAmendments?: unknown[];
  raw: Record<string, unknown>;
}

export interface CodexAppServerBackendOptions {
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  now?: () => number;
  writeLine?: WriteLine;
  spawnProcess?: SpawnCodexAppServerProcess;
  createWebSocket?: CreateWebSocket;
  startupTimeoutMs?: number;
}

export class CodexAppServerBackend implements AgentBackend {
  private readonly command: string;
  private readonly args: string[];
  private readonly cwd: string;
  private readonly env: Record<string, string | undefined>;
  private readonly now: () => number;
  private readonly writeLine: WriteLine;
  private readonly spawnProcess: SpawnCodexAppServerProcess;
  private readonly createWebSocket: CreateWebSocket;
  private readonly startupTimeoutMs: number;
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
  private threadId: string | undefined;
  private turnId: string | undefined;
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
    this.now = options.now ?? Date.now;
    this.writeLine = options.writeLine ?? noop;
    this.spawnProcess = options.spawnProcess ?? spawn;
    this.createWebSocket = options.createWebSocket ?? createDefaultWebSocket;
    this.startupTimeoutMs = options.startupTimeoutMs ?? 10_000;
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

      const endpoint = await this.waitForEndpoint(child);
      await this.connect(endpoint);
      await this.initialize();
      await this.startThread(cwd);

      this.publishStatus({
        process: "running",
        task: "idle",
        currentWorkingDirectory: cwd
      });
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
    this.writeLine(`[codex-app] turn/start ${prompt.sessionId}: ${prompt.text}`);
    this.publishStatus({
      ...this.status,
      task: "thinking"
    });

    const result = await this.sendRequest("turn/start", {
      threadId: this.threadId,
      input: [
        {
          type: "text",
          text: prompt.text,
          text_elements: []
        }
      ],
      cwd: this.cwd,
      approvalPolicy: "untrusted",
      approvalsReviewer: "user"
    });
    const turn = asRecord(result).turn;
    this.turnId = typeof asRecord(turn).id === "string" ? asRecord(turn).id : this.turnId;
  }

  async sendPermission(decision: PermissionDecision): Promise<void> {
    const pending = this.pendingApprovals.get(decision.requestId);

    if (pending === undefined) {
      throw new Error(`No pending Codex approval request for ${decision.requestId}.`);
    }

    const nativeDecision = this.resolveNativeDecision(decision, pending);

    this.pendingApprovals.delete(decision.requestId);
    this.writeLine(`[codex-app] approval ${decision.decision}: ${decision.requestId}`);
    this.sendResponse(pending.rpcId, {
      decision: nativeDecision
    });
    this.publishStatus({
      ...this.status,
      task: "thinking"
    });
  }

  async interrupt(reason: string): Promise<void> {
    this.writeLine(`[codex-app] interrupt: ${reason}`);

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

  private async startThread(cwd: string): Promise<void> {
    const result = await this.sendRequest("thread/start", {
      cwd,
      approvalPolicy: "untrusted",
      approvalsReviewer: "user",
      sandbox: "workspace-write",
      experimentalRawEvents: false,
      persistExtendedHistory: true,
      sessionStartSource: "startup"
    });
    const thread = asRecord(result).thread;
    this.threadId = typeof asRecord(thread).id === "string" ? asRecord(thread).id : undefined;

    if (!this.threadId) {
      throw new Error("Codex app-server did not return a thread id.");
    }
  }

  private sendRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    const socket = this.requireSocket();
    const id = `voice_${++this.rpcSequence}`;
    const message = {
      id,
      method,
      params
    };

    return new Promise((resolve, reject) => {
      this.pendingResponses.set(id, { resolve, reject });
      socket.send(JSON.stringify(message));
    });
  }

  private sendResponse(id: RequestId, result: Record<string, unknown>): void {
    this.requireSocket().send(
      JSON.stringify({
        id,
        result
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
      case "item/agentMessage/delta":
      case "item/commandExecution/outputDelta":
        this.emitOutput("stdout", String(message.params?.delta ?? ""));
        return;
      case "command/exec/outputDelta":
        this.emitCommandExecOutput(message);
        return;
      case "turn/completed":
        this.emitOutput("task_complete", "Task complete");
        this.publishStatus({
          ...this.status,
          task: "idle"
        });
        return;
      case "error":
        this.emitOutput("error", String(asRecord(message.params?.error).message ?? "Codex app-server error"));
        return;
      case "thread/status/changed":
        this.publishStatus({
          ...this.status,
          task: this.status.task
        });
        return;
    }
  }

  private handleCommandApprovalRequest(message: JsonRpcRequest): void {
    if (message.id === undefined) return;

    const params = asRecord(message.params);
    const requestId = String(message.id);
    const command = typeof params.command === "string" ? params.command : undefined;
    const availableDecisions = optionalUnknownArray(params.availableDecisions ?? params.available_decisions);
    const proposedExecpolicyAmendment =
      params.proposedExecpolicyAmendment ?? params.proposed_execpolicy_amendment;
    const proposedNetworkPolicyAmendments = optionalUnknownArray(
      params.proposedNetworkPolicyAmendments ?? params.proposed_network_policy_amendments
    );
    const request: PermissionRequest = {
      id: requestId,
      sessionId: this.currentSessionId,
      tool: "shell",
      action: "run_command",
      command,
      riskLevel: "medium",
      rawText: command ? `Run command: ${command} ?` : String(params.reason ?? "Codex requests command approval."),
      createdAt: this.now(),
      native: {
        backend: "codex",
        requestMethod: message.method,
        availableDecisions,
        proposedExecpolicyAmendment,
        proposedNetworkPolicyAmendments,
        raw: params
      }
    };

    this.pendingApprovals.set(request.id, {
      rpcId: message.id,
      requestMethod: message.method,
      availableDecisions,
      proposedExecpolicyAmendment,
      proposedNetworkPolicyAmendments,
      raw: params
    });
    this.writeLine(`[codex-app] approval requested: ${request.command ?? request.action}`);
    this.publishStatus({
      ...this.status,
      task: "waiting_permission",
      currentTool: "shell"
    });
    this.permissionListeners.forEach((listener) => listener(request));
  }

  private emitCommandExecOutput(message: JsonRpcRequest): void {
    const params = asRecord(message.params);
    const stream = params.stream === "stderr" ? "stderr" : "stdout";
    const deltaBase64 = typeof params.deltaBase64 === "string" ? params.deltaBase64 : "";
    const text = deltaBase64 ? Buffer.from(deltaBase64, "base64").toString("utf8") : "";

    this.emitOutput(stream, text);
  }

  private emitOutput(type: CodexOutputEvent["type"], text: string): void {
    if (!text) return;

    const event: CodexOutputEvent = {
      sessionId: this.currentSessionId,
      type,
      text,
      timestamp: this.now()
    };

    this.outputListeners.forEach((listener) => listener(event));
  }

  private publishStatus(status: CodexStatus): void {
    this.status = status;
    this.statusListeners.forEach((listener) => listener(status));
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

  private resolveNativeDecision(decision: PermissionDecision, pending: PendingCodexApproval): unknown {
    if (decision.decision === "deny") {
      return this.requireAvailableDecision(pending, ["decline", "reject", "deny", "cancel"]);
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

function optionalUnknownArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
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

function noop(_line: string): void {}
