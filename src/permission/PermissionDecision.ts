export interface PermissionDecision {
  requestId: string;
  decision: "allow" | "deny";
  remember?: boolean;
  scope?: "once" | "session" | "tool" | "project";
  decidedBy: "voice" | "keyboard" | "policy";
  transcript?: string;
}
