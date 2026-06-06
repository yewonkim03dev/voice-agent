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
}

export const initialCodexStatus: CodexStatus = {
  process: "not_started",
  task: "idle"
};
