export interface CodexOutputEvent {
  sessionId: string;
  type:
    | "stdout"
    | "stderr"
    | "tool_call"
    | "permission_request"
    | "approval_resolved"
    | "task_complete"
    | "error";
  text?: string;
  raw?: string;
  turnId?: string;
  timestamp: number;
}

export interface CodexStatus {
  process: "not_started" | "starting" | "running" | "exited" | "error";
  task: "idle" | "thinking" | "editing" | "running_command" | "waiting_permission";
  currentWorkingDirectory?: string;
  currentTool?: string;
  threadId?: string;
  rateLimits?: CodexRateLimits;
}

export interface CodexRateLimits {
  selected?: CodexRateLimitSnapshot;
  byLimitId?: Record<string, CodexRateLimitSnapshot>;
  updatedAt: number;
}

export interface CodexRateLimitSnapshot {
  limitId?: string;
  limitName?: string;
  planType?: string;
  primary?: CodexRateLimitWindow;
  secondary?: CodexRateLimitWindow;
  text: string;
}

export interface CodexRateLimitWindow {
  label: string;
  usedPercent: number;
  remainingPercent: number;
  windowDurationMins?: number;
  resetsAt?: number;
  resetIn?: string;
}

export const initialCodexStatus: CodexStatus = {
  process: "not_started",
  task: "idle"
};
