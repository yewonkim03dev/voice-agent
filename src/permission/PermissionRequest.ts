export type PermissionRiskLevel = "low" | "medium" | "high" | "critical";

export type NativePermissionBackend = "codex" | "claude" | "mock";

export interface NativePermissionMetadata {
  backend: NativePermissionBackend;
  requestMethod?: string;
  availableDecisions?: unknown[];
  additionalPermissions?: unknown;
  networkApprovalContext?: unknown;
  requestedPermissions?: unknown;
  proposedExecpolicyAmendment?: unknown;
  proposedNetworkPolicyAmendments?: unknown[];
  raw?: Record<string, unknown>;
}

export interface PermissionRequest {
  id: string;
  sessionId: string;
  tool: string;
  action: string;
  command?: string;
  path?: string;
  riskLevel: PermissionRiskLevel;
  rawText: string;
  createdAt: number;
  expiresAt?: number;
  native?: NativePermissionMetadata;
}
