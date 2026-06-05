import assert from "node:assert/strict";
import test from "node:test";

import { TextPermissionParser } from "../src/codex/PermissionParser.ts";
import { KeywordSafetyPolicy } from "../src/permission/SafetyPolicy.ts";

const parser = new TextPermissionParser();
const policy = new KeywordSafetyPolicy();

test("parses a shell command permission prompt", () => {
  const request = parser.parse({
    sessionId: "sess_1",
    type: "stdout",
    text: "Run command: npm test ?",
    timestamp: 100
  });

  assert.equal(request?.tool, "shell");
  assert.equal(request?.action, "run_command");
  assert.equal(request?.command, "npm test");
});

test("classifies common test commands as low risk", () => {
  const request = policy.classifyPermission({
    id: "perm_1",
    sessionId: "sess_1",
    tool: "shell",
    action: "run_command",
    command: "npm test",
    riskLevel: "medium",
    rawText: "Run command: npm test ?",
    createdAt: 100
  });

  assert.equal(request.riskLevel, "low");
  assert.equal(policy.canVoiceApprove(request), true);
  assert.equal(policy.requiresSecondConfirmation(request), false);
});

test("requires a second confirmation for high risk commands", () => {
  const request = policy.classifyPermission({
    id: "perm_1",
    sessionId: "sess_1",
    tool: "shell",
    action: "run_command",
    command: "git push --force",
    riskLevel: "medium",
    rawText: "Run command: git push --force ?",
    createdAt: 100
  });

  assert.equal(request.riskLevel, "high");
  assert.equal(policy.canVoiceApprove(request), true);
  assert.equal(policy.requiresSecondConfirmation(request), true);
});

test("blocks critical commands from voice approval", () => {
  const request = policy.classifyPermission({
    id: "perm_1",
    sessionId: "sess_1",
    tool: "shell",
    action: "run_command",
    command: "rm -rf .",
    riskLevel: "medium",
    rawText: "Run command: rm -rf . ?",
    createdAt: 100
  });

  assert.equal(request.riskLevel, "critical");
  assert.equal(policy.canVoiceApprove(request), false);
});
