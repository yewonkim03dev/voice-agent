import type { RuntimeContext } from "../runtime/RuntimeContext.ts";
import type { PermissionRequest, PermissionRiskLevel } from "./PermissionRequest.ts";

export interface SafetyPolicy {
  classifyPermission(request: PermissionRequest): PermissionRequest;
  canAutoAllow(request: PermissionRequest, context: RuntimeContext): boolean;
  requiresSecondConfirmation(request: PermissionRequest): boolean;
  canVoiceApprove(request: PermissionRequest): boolean;
}

const riskRank: Record<PermissionRiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3
};

export class KeywordSafetyPolicy implements SafetyPolicy {
  classifyPermission(request: PermissionRequest): PermissionRequest {
    const text = `${request.command ?? ""}\n${request.path ?? ""}\n${request.rawText}`.toLowerCase();
    const detected = detectRisk(text);

    if (!detected) return request;

    const preserveExplicitHighRisk =
      (request.riskLevel === "high" || request.riskLevel === "critical") &&
      riskRank[request.riskLevel] > riskRank[detected];

    return {
      ...request,
      riskLevel: preserveExplicitHighRisk ? request.riskLevel : detected
    };
  }

  canAutoAllow(_request: PermissionRequest, _context: RuntimeContext): boolean {
    return false;
  }

  requiresSecondConfirmation(request: PermissionRequest): boolean {
    return request.riskLevel === "high";
  }

  canVoiceApprove(request: PermissionRequest): boolean {
    return request.riskLevel !== "critical";
  }
}

function detectRisk(text: string): PermissionRiskLevel | null {
  if (
    /\brm\s+-rf\b/.test(text) ||
    /\bcurl\b.*\|\s*(sh|bash)\b/.test(text) ||
    /\b(secret|password|private key|authorization header)\b/.test(text)
  ) {
    return "critical";
  }

  if (
    /\bsudo\b/.test(text) ||
    /\bchmod\s+-r\b/.test(text) ||
    /\bchown\s+-r\b/.test(text) ||
    /\bgit\s+push\b.*(?:^|\s)--force\b/.test(text) ||
    /\bkubectl\s+apply\b/.test(text) ||
    /\bterraform\s+apply\b/.test(text) ||
    /\bdeploy\b/.test(text)
  ) {
    return "high";
  }

  if (
    /\b(npm|pnpm|yarn|bun)\s+(install|add)\b/.test(text) ||
    /\.env\b/.test(text) ||
    /\bwrite\b|\bedit\b|\bmodify\b/.test(text)
  ) {
    return "medium";
  }

  if (
    /\b(npm|pnpm|yarn|bun)\s+(test|run\s+test|lint|run\s+lint)\b/.test(text) ||
    /\b(go\s+test|cargo\s+test|pytest)\b/.test(text) ||
    /\b(read|cat|ls|rg|grep)\b/.test(text)
  ) {
    return "low";
  }

  return null;
}
