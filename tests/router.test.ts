import assert from "node:assert/strict";
import test from "node:test";

import { initialCodexStatus } from "../src/codex/CodexOutputEvent.ts";
import type { PermissionRequest } from "../src/permission/PermissionRequest.ts";
import { KeywordCommandRouter } from "../src/router/KeywordCommandRouter.ts";
import type { Transcript } from "../src/speech/Transcript.ts";

const router = new KeywordCommandRouter();

test("routes normal speech to a Codex prompt", async () => {
  const decision = await router.route({
    transcript: transcript("이 파일 refactor하고 test 돌려줘", "mixed", 0.94),
    state: "IDLE",
    codexStatus: initialCodexStatus
  });

  assert.equal(decision.route, "codex_prompt");
  assert.equal(decision.command?.type, "user_task");
});

test("ignores permission-like speech when no permission is pending", async () => {
  const decision = await router.route({
    transcript: transcript("허용", "ko", 0.96),
    state: "IDLE",
    codexStatus: initialCodexStatus
  });

  assert.equal(decision.route, "ignore");
});

test("routes permission speech only while confirming", async () => {
  const decision = await router.route({
    transcript: transcript("이번만 허용", "ko", 0.96),
    state: "CONFIRMING",
    pendingPermission: permissionRequest(),
    codexStatus: initialCodexStatus
  });

  assert.equal(decision.route, "permission_decision");
  assert.deepEqual(decision.command, {
    type: "permission",
    decision: "allow_once",
    scope: "current_command"
  });
});

test("requires higher confidence for permission decisions", async () => {
  const decision = await router.route({
    transcript: transcript("허용", "ko", 0.6),
    state: "CONFIRMING",
    pendingPermission: permissionRequest(),
    codexStatus: initialCodexStatus
  });

  assert.equal(decision.route, "clarify");
});

test("routes status questions to runtime status", async () => {
  const decision = await router.route({
    transcript: transcript("뭐 하는 중이야?", "ko", 0.91),
    state: "WAITING_CODEX",
    codexStatus: initialCodexStatus
  });

  assert.equal(decision.route, "status_query");
  assert.deepEqual(decision.command, {
    type: "control",
    action: "status"
  });
});

function transcript(text: string, language: Transcript["language"], confidence: number): Transcript {
  return {
    id: "tr_1",
    sessionId: "sess_1",
    text,
    normalizedText: text,
    language,
    confidence,
    startedAt: 100,
    endedAt: 200
  };
}

function permissionRequest(): PermissionRequest {
  return {
    id: "perm_1",
    sessionId: "sess_1",
    tool: "shell",
    action: "run_command",
    command: "npm test",
    riskLevel: "low",
    rawText: "Run command: npm test ?",
    createdAt: 100
  };
}
