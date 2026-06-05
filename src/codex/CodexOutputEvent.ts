export interface CodexOutputEvent {
  sessionId: string;
  type:
    | "stdout"
    | "stderr"
    | "tool_call"
    | "permission_request"
    | "task_complete"
    | "error";
  text?: string;
  raw?: string;
  timestamp: number;
}

export interface CodexStatus {
  process: "not_started" | "starting" | "running" | "exited" | "error";
  task: "idle" | "thinking" | "editing" | "running_command" | "waiting_permission";
  currentWorkingDirectory?: string;
  currentTool?: string;
}

export const initialCodexStatus: CodexStatus = {
  process: "not_started",
  task: "idle"
};
