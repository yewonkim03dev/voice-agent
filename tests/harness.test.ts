import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryAgentBackend, parseHarnessCliArgs, TerminalHarness } from "../src/app/harness.ts";
import { parseVoiceAgentEventLine, parseVoiceAgentEventSequence } from "../src/voice/VoiceAgentEvent.ts";
import type { VoiceMessage } from "../src/voice/VoiceMessage.ts";
import type { VisualBridgeLike, VisualControlEvent, VisualEvent } from "../src/visual/VisualBridge.ts";

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

test("tts-stop slash command stops current voice output", async () => {
  const lines: string[] = [];
  const voiceOutput = new StoppableVoiceOutput();
  const harness = new TerminalHarness({
    voiceOutput,
    now: () => 1000,
    createId: createTestId(),
    writeLine: (line) => lines.push(line)
  });

  await harness.start();
  await harness.processLine("/tts-stop");

  assert.equal(voiceOutput.stopCount, 1);
  assert.ok(lines.includes("[tts] stopped."));
});

test("visual control tts_stop stops current voice output", async () => {
  const voiceOutput = new StoppableVoiceOutput();
  const visualBridge = new FakeVisualBridge();
  const harness = new TerminalHarness({
    voiceOutput,
    visualBridge,
    now: () => 1000,
    createId: createTestId()
  });

  await harness.start();
  visualBridge.emitControl("tts_stop");
  await flushAsync();

  assert.equal(voiceOutput.stopCount, 1);
});

test("visual exit control requests full harness shutdown", async () => {
  const backend = new InMemoryAgentBackend();
  const lines: string[] = [];
  const visualBridge = new FakeVisualBridge();
  let exitRequests = 0;
  const harness = createPassthroughHarness(backend, lines, visualBridge, () => {
    exitRequests += 1;
  });

  await harness.start();
  visualBridge.emitControl("exit");
  await flushAsync();

  assert.equal(exitRequests, 1);
  assert.equal(backend.prompts.length, 0);
  assert.equal(lines.includes("[visual] exit requested. Shutting down harness."), true);
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

test("parses a fixed Codex thread id without forwarding it to app-server", () => {
  assert.deepEqual(parseHarnessCliArgs(["--codex", "--codex-thread-id", "thread_saved", "-c", "model=\"gpt\""], "/repo"), {
    backendMode: "codex",
    codexCommand: "codex",
    codexArgs: ["app-server", "--listen", "ws://127.0.0.1:0", "-c", "model=\"gpt\""],
    codexThreadId: "thread_saved",
    claudeCommand: "claude",
    cwd: "/repo"
  });
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

test("pass-through permission prompt keeps raw commands out of TTS", async () => {
  const backend = new InMemoryAgentBackend();
  const visualBridge = new FakeVisualBridge();
  const harness = createPassthroughHarness(backend, [], visualBridge);

  await harness.start();
  backend.emitPermissionRequest(backend.createPermissionRequest("/bin/zsh -lc 'npm test'", "sess_1", "approval_1"));
  await flushAsync();

  assert.equal(harness.voiceOutput.messages.at(-1)?.text, "명령 실행 권한 필요해. 허용할까?");
  assert.equal(harness.voiceOutput.messages.at(-1)?.text.includes("/bin/zsh"), false);
  assert.deepEqual(visualBridge.events.find((event) => event.type === "command"), {
    op: "voice-agent-ui",
    type: "command",
    text: "/bin/zsh -lc 'npm test'"
  });
  assert.deepEqual(visualBridge.events.find((event) => event.type === "approval"), {
    op: "voice-agent-ui",
    type: "approval",
    text: "명령 실행 권한 필요해."
  });
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

test("parses voice-agent NDJSON speech events", () => {
  assert.deepEqual(parseVoiceAgentEventLine(
    '{"op":"voice-agent","type":"speech","text":"확인했어."}'
  ), {
    op: "voice-agent",
    type: "speech",
    text: "확인했어.",
    raw: {
      op: "voice-agent",
      type: "speech",
      text: "확인했어."
    }
  });
  assert.equal(parseVoiceAgentEventLine("plain text"), null);
  assert.equal(parseVoiceAgentEventLine('{"op":"other","type":"speech","text":"no"}'), null);
});

test("parses adjacent voice-agent events defensively", () => {
  assert.deepEqual(parseVoiceAgentEventSequence(
    '{"op":"voice-agent","type":"status","text":"확인 중이야."}{"op":"voice-agent","type":"speech","text":"확인했어."}'
  )?.map((event) => ({
    type: event.type,
    text: event.text
  })), [
    {
      type: "status",
      text: "확인 중이야."
    },
    {
      type: "speech",
      text: "확인했어."
    }
  ]);
  assert.equal(parseVoiceAgentEventSequence('raw {"op":"voice-agent","type":"speech","text":"no"}'), null);
});

test("pass-through mode routes voice-agent speech events to TTS immediately", async () => {
  const backend = new InMemoryAgentBackend();
  const lines: string[] = [];
  const harness = createPassthroughHarness(backend, lines);

  await harness.start();
  backend.emitOutput({
    sessionId: "sess_1",
    type: "stdout",
    text: '{"op":"voice-agent","type":"speech","text":"확인했어. 테스트부터 돌려볼게."}\n',
    timestamp: 1000
  });
  await flushAsync();

  assert.equal(harness.voiceOutput.messages.at(-1)?.text, "확인했어. 테스트부터 돌려볼게.");
  assert.equal(lines.some((line) => line.includes("[agent:speech] 확인했어. 테스트부터 돌려볼게.")), true);
});

test("pass-through mode displays command events without speaking them", async () => {
  const backend = new InMemoryAgentBackend();
  const lines: string[] = [];
  const visualBridge = new FakeVisualBridge();
  const harness = createPassthroughHarness(backend, lines, visualBridge);

  await harness.start();
  backend.emitOutput({
    sessionId: "sess_1",
    type: "stdout",
    text: '{"op":"voice-agent","type":"command","text":"npm test"}\n',
    timestamp: 1000
  });
  await flushAsync();

  assert.equal(harness.voiceOutput.messages.length, 0);
  assert.equal(lines.some((line) => line.includes("[agent:command] npm test")), true);
  assert.deepEqual(visualBridge.events.find((event) => event.type === "command"), {
    op: "voice-agent-ui",
    type: "command",
    text: "npm test"
  });
});

test("pass-through mode handles status and error events", async () => {
  const backend = new InMemoryAgentBackend();
  const lines: string[] = [];
  const visualBridge = new FakeVisualBridge();
  const harness = createPassthroughHarness(backend, lines, visualBridge);

  await harness.start();
  backend.emitOutput({
    sessionId: "sess_1",
    type: "stdout",
    text:
      '{"op":"voice-agent","type":"status","text":"테스트 실행 중이야."}\n' +
      '{"op":"voice-agent","type":"error","text":"테스트 실행에 실패했어."}\n',
    timestamp: 1000
  });
  await flushAsync();

  assert.deepEqual(harness.voiceOutput.messages.map((message) => message.text), ["테스트 실행에 실패했어."]);
  assert.equal(lines.some((line) => line.includes("[agent:status] 테스트 실행 중이야.")), true);
  assert.equal(lines.some((line) => line.includes("[agent:error] 테스트 실행에 실패했어.")), true);
  assert.equal(visualBridge.events.some((event) => event.type === "status"), true);
  assert.equal(visualBridge.events.some((event) => event.type === "error"), true);
});

test("pass-through mode recovers adjacent structured events", async () => {
  const backend = new InMemoryAgentBackend();
  const lines: string[] = [];
  const visualBridge = new FakeVisualBridge();
  const harness = createPassthroughHarness(backend, lines, visualBridge);

  await harness.start();
  backend.emitOutput({
    sessionId: "sess_1",
    type: "stdout",
    text:
      '{"op":"voice-agent","type":"status","text":"작업 폴더를 확인해 볼게요."}' +
      '{"op":"voice-agent","type":"speech","text":"작업 폴더 확인했습니다."}\n',
    timestamp: 1000
  });
  await flushAsync();

  assert.equal(lines.some((line) => line.includes("[agent:stdout]")), false);
  assert.equal(lines.some((line) => line.includes("[agent:status] 작업 폴더를 확인해 볼게요.")), true);
  assert.equal(lines.some((line) => line.includes("[agent:speech] 작업 폴더 확인했습니다.")), true);
  assert.deepEqual(harness.voiceOutput.messages.map((message) => message.text), ["작업 폴더 확인했습니다."]);
  assert.equal(visualBridge.events.some((event) => event.type === "status"), true);
  assert.equal(visualBridge.events.some((event) => event.type === "speech"), true);
});

test("pass-through mode keeps invalid JSON and mixed raw stdout as raw fallback", async () => {
  const backend = new InMemoryAgentBackend();
  const lines: string[] = [];
  const harness = createPassthroughHarness(backend, lines);

  await harness.start();
  backend.emitOutput({
    sessionId: "sess_1",
    type: "stdout",
    text:
      "raw before\n" +
      '{"op":"voice-agent","type":"speech","text":"중간 보고야."}\n' +
      "{not-json}\n" +
      "raw after",
    timestamp: 1000
  });
  backend.emitOutput({
    sessionId: "sess_1",
    type: "task_complete",
    text: "Task complete",
    timestamp: 1000
  });
  await flushAsync();

  assert.equal(lines.some((line) => line.includes("[agent:stdout] raw before")), true);
  assert.equal(lines.some((line) => line.includes("[agent:speech] 중간 보고야.")), true);
  assert.equal(lines.some((line) => line.includes("[agent:stdout] {not-json}")), true);
  assert.equal(lines.some((line) => line.includes("[agent:stdout] raw after")), true);
  assert.equal(harness.voiceOutput.messages.some((message) => message.text === "중간 보고야."), true);
});

test("pass-through mode skips generic completion after structured speech", async () => {
  const backend = new InMemoryAgentBackend();
  const harness = createPassthroughHarness(backend);

  await harness.start();
  backend.emitOutput({
    sessionId: "sess_1",
    type: "stdout",
    text: '{"op":"voice-agent","type":"speech","text":"끝났어. 전부 통과했어."}\n',
    timestamp: 1000
  });
  backend.emitOutput({
    sessionId: "sess_1",
    type: "task_complete",
    text: "Task complete",
    timestamp: 1000
  });
  await flushAsync();

  assert.deepEqual(harness.voiceOutput.messages.map((message) => message.text), [
    "끝났어. 전부 통과했어."
  ]);
});

test("pass-through permission prompts still work after voice-agent events", async () => {
  const backend = new InMemoryAgentBackend();
  const harness = createPassthroughHarness(backend);

  await harness.start();
  backend.emitOutput({
    sessionId: "sess_1",
    type: "stdout",
    text: '{"op":"voice-agent","type":"speech","text":"권한을 확인할게."}\n',
    timestamp: 1000
  });
  backend.emitPermissionRequest(backend.createPermissionRequest("npm test", "sess_1", "approval_1"));
  await flushAsync();
  await harness.processLine("허용");

  assert.equal(backend.permissions.length, 1);
  assert.equal(backend.permissions[0].decision, "allow");
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

function createTestId(): (prefix: string) => string {
  let id = 0;
  return (prefix) => `${prefix}_${++id}`;
}

function createPassthroughHarness(
  backend: InMemoryAgentBackend,
  lines: string[] = [],
  visualBridge?: VisualBridgeLike,
  onExitRequest?: () => void | Promise<void>
): TerminalHarness {
  let id = 0;

  return new TerminalHarness({
    backend,
    backendLabel: "codex-test",
    routingMode: "passthrough",
    agentTarget: "codex",
    now: () => 1000,
    createId: (prefix) => `${prefix}_${++id}`,
    writeLine: (line) => lines.push(line),
    visualBridge,
    onExitRequest
  });
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

class StoppableVoiceOutput {
  readonly messages: VoiceMessage[] = [];
  private readonly finishedListeners: Array<(id: string) => void> = [];
  stopCount = 0;

  async speak(message: VoiceMessage): Promise<void> {
    this.messages.push(message);
    this.finishedListeners.forEach((listener) => listener(message.id));
  }

  async stop(): Promise<void> {
    this.stopCount += 1;
  }

  onFinished(callback: (id: string) => void): void {
    this.finishedListeners.push(callback);
  }
}

class FakeVisualBridge implements VisualBridgeLike {
  readonly events: VisualEvent[] = [];
  private readonly controlListeners: Array<(event: VisualControlEvent) => void> = [];

  send(event: VisualEvent): void {
    this.events.push(event);
  }

  onControl(callback: (event: VisualControlEvent) => void): void {
    this.controlListeners.push(callback);
  }

  emitControl(action: VisualControlEvent["action"]): void {
    this.controlListeners.forEach((listener) =>
      listener({
        op: "voice-agent-ui",
        type: "control",
        action
      })
    );
  }
}
