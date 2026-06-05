import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryAgentBackend, parseHarnessCliArgs, TerminalHarness } from "../src/app/harness.ts";

test("routes terminal text to the in-memory backend as a Codex prompt", async () => {
  const harness = createHarness();

  await harness.start();
  await harness.processLine("이 파일 리팩토링하고 테스트 돌려줘");

  const backend = harness.backend as InMemoryAgentBackend;
  assert.equal(backend.prompts.length, 1);
  assert.equal(backend.prompts[0].text, "이 파일 리팩토링하고 테스트 돌려줘");
  assert.equal(harness.runtime.getContext().state, "WAITING_CODEX");
});

test("allows a low-risk slash permission after a voice transcript decision", async () => {
  const harness = createHarness();

  await harness.start();
  await harness.processLine("/permission npm test");
  await harness.processLine("허용");

  const backend = harness.backend as InMemoryAgentBackend;
  assert.equal(backend.permissionRequests[0].command, "npm test");
  assert.equal(harness.runtime.getContext().pendingPermission, undefined);
  assert.equal(backend.permissions.length, 1);
  assert.equal(backend.permissions[0].decision, "allow");
  assert.equal(backend.permissions[0].transcript, "허용");
});

test("asks for stronger confirmation before allowing a high-risk slash permission", async () => {
  const harness = createHarness();

  await harness.start();
  await harness.processLine("/permission git push --force");
  await harness.processLine("허용");

  const backend = harness.backend as InMemoryAgentBackend;
  assert.equal(harness.runtime.getContext().state, "CONFIRMING");
  assert.equal(backend.permissionRequests[0].riskLevel, "medium");
  assert.equal(harness.runtime.getContext().pendingPermission?.riskLevel, "high");
  assert.equal(backend.permissions.length, 0);
  assert.equal(harness.voiceOutput.messages.at(-1)?.text, "위험도가 높아. 정말 실행할까?");
});

test("parses real harness mode with extra Codex app-server args", () => {
  assert.deepEqual(parseHarnessCliArgs(["--codex", "-c", "model=\"gpt-5-codex\""], "/repo"), {
    backendMode: "codex",
    codexCommand: "codex",
    codexArgs: ["app-server", "--listen", "ws://127.0.0.1:0", "-c", "model=\"gpt-5-codex\""],
    claudeCommand: "claude",
    cwd: "/repo"
  });
});

test("keeps --real as a Codex harness alias", () => {
  assert.equal(parseHarnessCliArgs(["--real"], "/repo").backendMode, "codex");
});

test("parses Claude harness mode", () => {
  assert.deepEqual(parseHarnessCliArgs(["--claude", "--claude-command", "claude-dev"], "/repo"), {
    backendMode: "claude",
    codexCommand: "codex",
    codexArgs: ["app-server", "--listen", "ws://127.0.0.1:0"],
    claudeCommand: "claude-dev",
    cwd: "/repo"
  });
});

test("pass-through Codex harness strips a wake phrase and forwards the rest", async () => {
  const backend = new InMemoryAgentBackend();
  const harness = createPassthroughHarness(backend);

  await harness.start();
  await harness.processLine("코덱스 간단한 npm test 돌려줘");

  assert.equal(backend.prompts.length, 1);
  assert.equal(backend.prompts[0].text, "간단한 npm test 돌려줘");
});

test("pass-through approval speech only acts while a native approval is pending", async () => {
  const backend = new InMemoryAgentBackend();
  const harness = createPassthroughHarness(backend);

  await harness.start();
  await harness.processLine("허용");

  assert.equal(backend.permissions.length, 0);
  assert.equal(backend.prompts[0].text, "허용");

  backend.emitPermissionRequest(backend.createPermissionRequest("npm test", "sess_1", "approval_1"));
  await Promise.resolve();
  await harness.processLine("음 글쎄");

  assert.equal(backend.permissions.length, 0);
  assert.equal(harness.voiceOutput.messages.at(-1)?.text, "허용인지 거부인지 다시 말해줘.");

  await harness.processLine("허용");

  assert.equal(backend.permissions.length, 1);
  assert.equal(backend.permissions[0].decision, "allow");
  assert.equal(backend.permissions[0].scope, "once");
});

test("pass-through approval speech can deny a native approval", async () => {
  const backend = new InMemoryAgentBackend();
  const harness = createPassthroughHarness(backend);

  await harness.start();
  backend.emitPermissionRequest(backend.createPermissionRequest("npm test", "sess_1", "approval_1"));
  await Promise.resolve();
  await harness.processLine("거부");

  assert.equal(backend.permissions.length, 1);
  assert.equal(backend.permissions[0].decision, "deny");
});

test("pass-through mode does not parse agent text into fake approval requests", async () => {
  const backend = new InMemoryAgentBackend();
  const harness = createPassthroughHarness(backend);

  await harness.start();
  backend.emitPermissionRequest(backend.createPermissionRequest("npm test", "sess_1", "approval_1"));
  await Promise.resolve();
  const messagesBeforeOutput = harness.voiceOutput.messages.length;

  backend.emitOutput({
    sessionId: "sess_1",
    type: "stdout",
    text: "approve_action 실행 권한 필요해. 허용할까?",
    timestamp: 1000
  });
  await Promise.resolve();

  assert.equal(harness.voiceOutput.messages.length, messagesBeforeOutput);

  await harness.processLine("허용");

  assert.equal(backend.permissions.length, 1);
  assert.equal(backend.permissions[0].requestId, "approval_1");
});

test("pass-through mode buffers token-sized agent output until completion", async () => {
  const backend = new InMemoryAgentBackend();
  const lines: string[] = [];
  const harness = createPassthroughHarness(backend, lines);

  await harness.start();
  backend.emitOutput({
    sessionId: "sess_1",
    type: "stdout",
    text: "실",
    timestamp: 1000
  });
  backend.emitOutput({
    sessionId: "sess_1",
    type: "stdout",
    text: "행했습니다.",
    timestamp: 1000
  });

  assert.equal(lines.some((line) => line.includes("[agent:stdout] 실행했습니다.")), false);

  backend.emitOutput({
    sessionId: "sess_1",
    type: "task_complete",
    text: "Task complete",
    timestamp: 1000
  });
  await Promise.resolve();

  assert.equal(lines.some((line) => line.includes("[agent:stdout] 실행했습니다.")), true);
});

test("pass-through mode maps interrupt phrases during active work", async () => {
  const backend = new InMemoryAgentBackend();
  const harness = createPassthroughHarness(backend);

  await harness.start();
  await harness.processLine("코덱스 npm test 돌려줘");
  await harness.processLine("멈춰");

  assert.equal(backend.prompts[0].text, "npm test 돌려줘");
  assert.equal(backend.interrupts.length, 1);
});

function createHarness(): TerminalHarness {
  let id = 0;

  return new TerminalHarness({
    now: () => 1000,
    createId: (prefix) => `${prefix}_${++id}`
  });
}

function createPassthroughHarness(backend: InMemoryAgentBackend, lines: string[] = []): TerminalHarness {
  let id = 0;

  return new TerminalHarness({
    backend,
    backendLabel: "codex-test",
    routingMode: "passthrough",
    agentTarget: "codex",
    now: () => 1000,
    createId: (prefix) => `${prefix}_${++id}`,
    writeLine: (line) => lines.push(line)
  });
}
