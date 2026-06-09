import type { PermissionDecision } from "../permission/PermissionDecision.ts";
import type { PermissionRequest } from "../permission/PermissionRequest.ts";
import type { CodexOutputEvent, CodexStatus } from "./CodexOutputEvent.ts";
import type { CodexPrompt } from "./CodexPrompt.ts";

export interface CodexProcessConfig {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export interface AgentBackend {
  start(config?: CodexProcessConfig): Promise<void>;
  stop(): Promise<void>;
  sendPrompt(prompt: CodexPrompt): Promise<void>;
  setVoiceAgentProtocolPrompt?(prompt: string): void;
  sendPermission(decision: PermissionDecision): Promise<void>;
  interrupt(reason: string): Promise<void>;
  onOutput(callback: (event: CodexOutputEvent) => void): void;
  onPermissionRequest(callback: (request: PermissionRequest) => void): void;
  onStatus(callback: (status: CodexStatus) => void): void;
}

export type CodexBridge = AgentBackend;
