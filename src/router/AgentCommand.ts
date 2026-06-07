import type { Language } from "../speech/Transcript.ts";

export type AgentCommand =
  | UserTaskCommand
  | PermissionCommand
  | ControlCommand
  | DictationCommand
  | ClarificationCommand
  | NoopCommand;

export interface UserTaskCommand {
  type: "user_task";
  sessionId: string;
  text: string;
  language: Exclude<Language, "unknown">;
  target: "codex";
  priority: "normal" | "high";
  requiresPreAck: boolean;
}

export interface PermissionCommand {
  type: "permission";
  decision: "allow" | "deny" | "allow_once" | "always_allow" | "deny_once";
  scope?: "current_command" | "current_session" | "tool" | "directory";
  reason?: string;
}

export interface ControlCommand {
  type: "control";
  action:
    | "stop"
    | "pause"
    | "resume"
    | "repeat"
    | "status"
    | "cancel_speech"
    | "new_session"
    | "shutdown";
}

export interface DictationCommand {
  type: "dictation";
  text: string;
}

export interface ClarificationCommand {
  type: "clarification";
  reason: string;
}

export interface NoopCommand {
  type: "noop";
  reason: string;
}
