export type AgentState =
  | "BOOTING"
  | "IDLE"
  | "LISTENING"
  | "TRANSCRIBING"
  | "THINKING"
  | "CONFIRMING"
  | "EXECUTING"
  | "WAITING_CODEX"
  | "INTERRUPTING"
  | "SPEAKING"
  | "ERROR"
  | "SHUTDOWN";

export type MVPState =
  | "IDLE"
  | "LISTENING"
  | "TRANSCRIBING"
  | "CONFIRMING"
  | "WAITING_CODEX"
  | "SPEAKING"
  | "ERROR";
