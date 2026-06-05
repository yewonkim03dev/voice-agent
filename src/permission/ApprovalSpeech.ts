export type ApprovalSpeechIntent =
  | "approve_once"
  | "approve_session"
  | "approve_policy"
  | "deny"
  | "unknown";

export interface ApprovalSpeechResult {
  intent: ApprovalSpeechIntent;
  text: string;
}

const policyApprovePhrases = [
  "같은 명령 계속 허용",
  "앞으로 이 명령은 허용",
  "이 명령 계속 허용",
  "항상 이 명령 허용",
  "remember this command"
];

const sessionApprovePhrases = [
  "이번 세션 동안 허용",
  "이번 세션은 허용",
  "세션 동안 허용",
  "다음부터 묻지 마",
  "다음부터 묻지마",
  "계속 허용",
  "always allow",
  "allow for session",
  "accept for session"
];

const onceApprovePhrases = [
  "허용",
  "승인",
  "응",
  "그래",
  "좋아",
  "진행해",
  "실행해",
  "해도 돼",
  "해도돼",
  "yes",
  "approve",
  "allow",
  "go ahead",
  "ok",
  "okay"
];

const denyPhrases = [
  "거부",
  "아니",
  "안 돼",
  "안돼",
  "하지 마",
  "하지마",
  "취소",
  "멈춰",
  "no",
  "deny",
  "reject",
  "cancel",
  "stop"
];

export function interpretApprovalSpeech(text: string): ApprovalSpeechResult {
  const normalized = normalizeApprovalSpeech(text);
  const denies = containsAny(normalized, denyPhrases);
  const approvesPolicy = containsAny(normalized, policyApprovePhrases);
  const approvesSession = containsAny(normalized, sessionApprovePhrases);
  const approvesOnce = containsAny(normalized, onceApprovePhrases);
  const approves = approvesPolicy || approvesSession || approvesOnce;

  if (!normalized || (approves && denies)) {
    return {
      intent: "unknown",
      text: normalized
    };
  }

  if (denies) {
    return {
      intent: "deny",
      text: normalized
    };
  }

  if (approvesPolicy) {
    return {
      intent: "approve_policy",
      text: normalized
    };
  }

  if (approvesSession) {
    return {
      intent: "approve_session",
      text: normalized
    };
  }

  if (approvesOnce) {
    return {
      intent: "approve_once",
      text: normalized
    };
  }

  return {
    intent: "unknown",
    text: normalized
  };
}

export function normalizeApprovalSpeech(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function containsAny(text: string, phrases: string[]): boolean {
  return phrases.some((phrase) => text.includes(phrase));
}
