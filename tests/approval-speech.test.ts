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
});

test("interprets denial phrases and treats mixed speech as unknown", () => {
  assert.equal(interpretApprovalSpeech("거부").intent, "deny");
  assert.equal(interpretApprovalSpeech("허용하지 마").intent, "unknown");
  assert.equal(interpretApprovalSpeech("음 글쎄").intent, "unknown");
});
