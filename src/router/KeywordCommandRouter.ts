import type { ControlCommand } from "./AgentCommand.ts";
import type { CommandRouter, RouteDecision, RouteInput } from "./CommandRouter.ts";

const normalCommandThreshold = 0.5;
const permissionThreshold = 0.75;

export class KeywordCommandRouter implements CommandRouter {
  async route(input: RouteInput): Promise<RouteDecision> {
    const text = normalize(input.transcript.normalizedText || input.transcript.text);

    if (!text) {
      return ignore("Empty transcript");
    }

    if (input.pendingPermission && input.state === "CONFIRMING") {
      return routePermission(text, input.transcript.confidence);
    }

    if (looksLikePermissionResponse(text)) {
      return ignore("No pending permission");
    }

    const control = routeControl(text, input.transcript.confidence);
    if (control) return control;

    if (input.transcript.confidence < normalCommandThreshold || input.transcript.language === "unknown") {
      return {
        route: "clarify",
        confidence: input.transcript.confidence,
        command: {
          type: "clarification",
          reason: "Low confidence or unknown language"
        },
        reason: "Low confidence or unknown language"
      };
    }

    return {
      route: "codex_prompt",
      confidence: input.transcript.confidence,
      command: {
        type: "user_task",
        sessionId: input.transcript.sessionId,
        text,
        language: input.transcript.language,
        target: "codex",
        priority: "normal",
        requiresPreAck: true
      }
    };
  }
}

function routePermission(text: string, confidence: number): RouteDecision {
  if (confidence < permissionThreshold) {
    return {
      route: "clarify",
      confidence,
      command: {
        type: "clarification",
        reason: "Permission response confidence is too low"
      },
      reason: "Permission response confidence is too low"
    };
  }

  if (containsAny(text, ["계속 허용", "항상 허용", "always allow", "remember allow"])) {
    return {
      route: "permission_decision",
      confidence,
      command: {
        type: "permission",
        decision: "always_allow",
        scope: "current_session"
      }
    };
  }

  if (containsAny(text, ["이번만 허용", "허용", "승인", "좋아", "응", "yes", "allow", "approve", "go ahead"])) {
    return {
      route: "permission_decision",
      confidence,
      command: {
        type: "permission",
        decision: "allow_once",
        scope: "current_command"
      }
    };
  }

  if (containsAny(text, ["거부", "안 돼", "안돼", "하지 마", "스킵", "no", "deny", "reject", "skip"])) {
    return {
      route: "permission_decision",
      confidence,
      command: {
        type: "permission",
        decision: "deny_once",
        scope: "current_command"
      }
    };
  }

  return {
    route: "clarify",
    confidence,
    command: {
      type: "clarification",
      reason: "Permission response was not allow or deny"
    },
    reason: "Permission response was not allow or deny"
  };
}

function routeControl(text: string, confidence: number): RouteDecision | null {
  if (containsAny(text, ["뭐 하는 중", "뭐하고", "상태", "status"])) {
    return control("status", confidence, "status_query");
  }

  if (containsAny(text, ["다시 말", "repeat"])) {
    return control("repeat", confidence, "runtime_control");
  }

  if (containsAny(text, ["잠깐 멈춰", "pause"])) {
    return control("pause", confidence, "runtime_control");
  }

  if (containsAny(text, ["계속해", "resume"])) {
    return control("resume", confidence, "runtime_control");
  }

  if (containsAny(text, ["멈춰", "중지", "stop", "cancel"])) {
    return control("stop", confidence, "runtime_control");
  }

  if (containsAny(text, ["새로 시작", "new session"])) {
    return control("new_session", confidence, "runtime_control");
  }

  if (containsAny(text, ["종료", "shutdown", "quit"])) {
    return control("shutdown", confidence, "runtime_control");
  }

  return null;
}

function control(
  action: ControlCommand["action"],
  confidence: number,
  route: "runtime_control" | "status_query"
): RouteDecision {
  return {
    route,
    confidence,
    command: {
      type: "control",
      action
    }
  };
}

function looksLikePermissionResponse(text: string): boolean {
  return containsAny(text, [
    "허용",
    "승인",
    "거부",
    "이번만",
    "계속 허용",
    "always allow",
    "allow",
    "approve",
    "deny",
    "reject"
  ]);
}

function containsAny(text: string, needles: string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function ignore(reason: string): RouteDecision {
  return {
    route: "ignore",
    confidence: 1,
    command: {
      type: "noop",
      reason
    },
    reason
  };
}
