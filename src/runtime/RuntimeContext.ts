import type { CodexStatus } from "../codex/CodexOutputEvent.ts";
import type { UserPreferences } from "../config/UserPreferences.ts";
import type { PermissionRequest } from "../permission/PermissionRequest.ts";
import type { Transcript } from "../speech/Transcript.ts";
import type { AgentState } from "./AgentState.ts";

export interface RuntimeContext {
  state: AgentState;
  activeSessionId?: string;
  codexStatus: CodexStatus;
  pendingPermission?: PermissionRequest;
  lastTranscript?: Transcript;
  lastSpokenText?: string;
  lastCodexOutput?: string;
  userPreferences: UserPreferences;
}
