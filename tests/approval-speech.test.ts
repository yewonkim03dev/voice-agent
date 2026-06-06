import assert from "node:assert/strict";
import test from "node:test";

import { interpretApprovalSpeech } from "../src/permission/ApprovalSpeech.ts";

test("interprets one-shot approval phrases", () => {
  assert.equal(interpretApprovalSpeech("허용").intent, "approve_once");
  assert.equal(interpretApprovalSpeech("go ahead").intent, "approve_once");
});

test("interprets session and policy approval phrases before generic allow", () => {
  assert.equal(interpretApprovalSpeech("이번 세션 동안 허용").intent, "approve_session");
  assert.equal(interpretApprovalSpeech("같은 명령 계속 허용").intent, "approve_policy");
  assert.equal(interpretApprovalSpeech("같은 네트워크 계속 허용").intent, "approve_network_policy");
  assert.equal(interpretApprovalSpeech("allow this host").intent, "approve_network_policy");
});

test("interprets denial phrases and treats mixed speech as unknown", () => {
  assert.equal(interpretApprovalSpeech("거부").intent, "deny");
  assert.equal(interpretApprovalSpeech("허용하지 마").intent, "unknown");
  assert.equal(interpretApprovalSpeech("음 글쎄").intent, "unknown");
});

test("interprets configured approval phrases", () => {
  const phrases = {
    onceApprove: ["진짜 해"],
    deny: ["멈춰줘"],
    sessionApprove: ["오늘은 허용"]
  };

  assert.equal(interpretApprovalSpeech("진짜 해", phrases).intent, "approve_once");
  assert.equal(interpretApprovalSpeech("오늘은 허용", phrases).intent, "approve_session");
  assert.equal(interpretApprovalSpeech("멈춰줘", phrases).intent, "deny");
  assert.equal(interpretApprovalSpeech("허용", phrases).intent, "unknown");
});
