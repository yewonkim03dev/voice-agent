export type PermissionRiskLevel = "low" | "medium" | "high" | "critical";

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
}
