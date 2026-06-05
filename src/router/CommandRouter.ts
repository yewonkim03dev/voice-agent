import type { CodexStatus } from "../codex/CodexOutputEvent.ts";
import type { PermissionRequest } from "../permission/PermissionRequest.ts";
import type { AgentState } from "../runtime/AgentState.ts";
import type { Transcript } from "../speech/Transcript.ts";
import type { AgentCommand } from "./AgentCommand.ts";

export interface RouteInput {
  transcript: Transcript;
  state: AgentState;
  pendingPermission?: PermissionRequest;
  codexStatus: CodexStatus;
}

export interface RouteDecision {
  route:
    | "codex_prompt"
    | "permission_decision"
    | "runtime_control"
    | "status_query"
    | "ignore"
    | "clarify";
  confidence: number;
  command?: AgentCommand;
  reason?: string;
}

export interface CommandRouter {
  route(input: RouteInput): Promise<RouteDecision>;
}
