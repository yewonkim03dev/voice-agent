export type ApprovalSpeechIntent =
  | "approve_once"
  | "approve_session"
  | "approve_policy"
  | "approve_network_policy"
  | "deny"
  | "unknown";

export interface ApprovalSpeechResult {
  intent: ApprovalSpeechIntent;
  text: string;
}

export interface ApprovalPhraseConfig {
  onceApprove?: string[];
  deny?: string[];
  sessionApprove?: string[];
  policyApprove?: string[];
  networkPolicyApprove?: string[];
}

export interface ApprovalPhraseSet {
  onceApprove: string[];
  deny: string[];
  sessionApprove: string[];
  policyApprove: string[];
  networkPolicyApprove: string[];
}

export const policyApprovePhrases = [
  "같은 명령 계속 허용",
  "앞으로 이 명령은 허용",
  "이 명령 계속 허용",
  "항상 이 명령 허용",
  "remember this command"
];

export const networkPolicyApprovePhrases = [
  "같은 네트워크 계속 허용",
  "이 네트워크 계속 허용",
  "이 호스트 허용",
  "이 호스트 계속 허용",
  "깃허브 계속 허용",
  "github 계속 허용",
  "allow this host",
  "allow this network",
  "remember this host"
];

export const sessionApprovePhrases = [
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

export const onceApprovePhrases = [
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

export const denyPhrases = [
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

export function interpretApprovalSpeech(text: string, phraseConfig: ApprovalPhraseConfig = {}): ApprovalSpeechResult {
  const normalized = normalizeApprovalSpeech(text);
  const phrases = approvalPhraseSet(phraseConfig);
  const denies = containsAny(normalized, phrases.deny);
  const approvesNetworkPolicy = containsAny(normalized, phrases.networkPolicyApprove);
  const approvesPolicy = containsAny(normalized, phrases.policyApprove);
  const approvesSession = containsAny(normalized, phrases.sessionApprove);
  const approvesOnce = containsAny(normalized, phrases.onceApprove);
  const approves = approvesNetworkPolicy || approvesPolicy || approvesSession || approvesOnce;

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

  if (approvesNetworkPolicy) {
    return {
      intent: "approve_network_policy",
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

export function approvalPhraseSet(config: ApprovalPhraseConfig = {}): ApprovalPhraseSet {
  return {
    onceApprove: normalizePhraseList(config.onceApprove, onceApprovePhrases),
    deny: normalizePhraseList(config.deny, denyPhrases),
    sessionApprove: normalizePhraseList(config.sessionApprove, sessionApprovePhrases),
    policyApprove: normalizePhraseList(config.policyApprove, policyApprovePhrases),
    networkPolicyApprove: normalizePhraseList(config.networkPolicyApprove, networkPolicyApprovePhrases)
  };
}

export function sanitizeApprovalPhraseConfig(config: ApprovalPhraseConfig = {}): ApprovalPhraseConfig {
  return {
    onceApprove: normalizePhraseList(config.onceApprove, onceApprovePhrases),
    deny: normalizePhraseList(config.deny, denyPhrases),
    sessionApprove: normalizePhraseList(config.sessionApprove, sessionApprovePhrases),
    policyApprove: normalizePhraseList(config.policyApprove, policyApprovePhrases),
    networkPolicyApprove: normalizePhraseList(config.networkPolicyApprove, networkPolicyApprovePhrases)
  };
}

function containsAny(text: string, phrases: string[]): boolean {
  return phrases.some((phrase) => text.includes(phrase));
}

function normalizePhraseList(values: string[] | undefined, fallback: string[]): string[] {
  const source = values && values.length > 0 ? values : fallback;
  const result: string[] = [];

  for (const value of source) {
    const phrase = normalizeApprovalSpeech(value);
    if (phrase && !result.includes(phrase)) {
      result.push(phrase);
    }
  }

  return result;
}
