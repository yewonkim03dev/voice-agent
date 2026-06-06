export interface PermissionDecision {
  requestId: string;
  decision: "allow" | "deny";
  remember?: boolean;
  scope?: "once" | "session" | "tool" | "project" | "network";
  decidedBy: "voice" | "keyboard" | "policy";
  transcript?: string;
}
