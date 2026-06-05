import assert from "node:assert/strict";
import test from "node:test";

import type { AgentBackend } from "../src/codex/CodexBridge.ts";
import type { CodexOutputEvent, CodexStatus } from "../src/codex/CodexOutputEvent.ts";
import type { CodexPrompt } from "../src/codex/CodexPrompt.ts";
import type { PermissionDecision } from "../src/permission/PermissionDecision.ts";
import type { PermissionRequest } from "../src/permission/PermissionRequest.ts";
import { RuntimeController } from "../src/runtime/RuntimeController.ts";
import type { Transcript } from "../src/speech/Transcript.ts";
import type { VoiceMessage } from "../src/voice/VoiceMessage.ts";
import type { VoiceOutput } from "../src/voice/VoiceOutput.ts";

test("sends a user task to Codex and waits for output", async () => {
  const backend = new MemoryBackend();
  const voice = new MemoryVoiceOutput();
  const runtime = createRuntime(backend, voice);

  await runtime.start();
  await runtime.handleTranscript(transcript("테스트 돌려줘", "ko", 0.95));

  assert.equal(runtime.getContext().state, "WAITING_CODEX");
  assert.equal(backend.prompts.length, 1);
  assert.equal(backend.prompts[0].text, "테스트 돌려줘");
  assert.equal(voice.messages.at(-1)?.text, "알겠어. 실행할게.");
});

test("turns a Codex permission prompt into a voice-approved decision", async () => {
  const backend = new MemoryBackend();
  const voice = new MemoryVoiceOutput();
  const runtime = createRuntime(backend, voice);

  await runtime.start();
  await runtime.handleCodexOutput({
    sessionId: "sess_1",
    type: "stdout",
    text: "Run command: npm test ?",
    timestamp: 100
  });

  assert.equal(runtime.getContext().state, "CONFIRMING");
  assert.equal(runtime.getContext().pendingPermission?.riskLevel, "low");

  await runtime.handleTranscript(transcript("허용", "ko", 0.96));

  assert.equal(runtime.getContext().state, "WAITING_CODEX");
  assert.equal(runtime.getContext().pendingPermission, undefined);
  assert.deepEqual(backend.permissions[0], {
    requestId: "perm_sess_1_100",
    decision: "allow",
    remember: false,
    scope: "once",
    decidedBy: "voice",
    transcript: "허용"
  });
});

test("asks for stronger voice confirmation on high risk permissions", async () => {
  const backend = new MemoryBackend();
  const voice = new MemoryVoiceOutput();
  const runtime = createRuntime(backend, voice);

  await runtime.start();
  await runtime.handlePermissionRequest(permissionRequest("git push --force", "medium"));
  await runtime.handleTranscript(transcript("허용", "ko", 0.98));

  assert.equal(runtime.getContext().state, "CONFIRMING");
  assert.equal(backend.permissions.length, 0);
  assert.equal(voice.messages.at(-1)?.text, "위험도가 높아. 정말 실행할까?");

  await runtime.handleTranscript(transcript("진짜 허용", "ko", 0.98));

  assert.equal(runtime.getContext().state, "WAITING_CODEX");
  assert.equal(backend.permissions[0].decision, "allow");
});

class MemoryBackend implements AgentBackend {
  prompts: CodexPrompt[] = [];
  permissions: PermissionDecision[] = [];
  interrupts: string[] = [];
  private outputListeners: Array<(event: CodexOutputEvent) => void> = [];
  private permissionListeners: Array<(request: PermissionRequest) => void> = [];
  private statusListeners: Array<(status: CodexStatus) => void> = [];

  async start(): Promise<void> {
    this.statusListeners.forEach((listener) =>
      listener({
        process: "running",
        task: "idle"
      })
    );
  }

  async stop(): Promise<void> {}

  async sendPrompt(prompt: CodexPrompt): Promise<void> {
    this.prompts.push(prompt);
  }

  async sendPermission(decision: PermissionDecision): Promise<void> {
    this.permissions.push(decision);
  }

  async interrupt(reason: string): Promise<void> {
    this.interrupts.push(reason);
  }

  onOutput(callback: (event: CodexOutputEvent) => void): void {
    this.outputListeners.push(callback);
  }

  onPermissionRequest(callback: (request: PermissionRequest) => void): void {
    this.permissionListeners.push(callback);
  }

  onStatus(callback: (status: CodexStatus) => void): void {
    this.statusListeners.push(callback);
  }
}

class MemoryVoiceOutput implements VoiceOutput {
  messages: VoiceMessage[] = [];

  async speak(message: VoiceMessage): Promise<void> {
    this.messages.push(message);
  }

  async stop(): Promise<void> {}

  onFinished(_callback: (id: string) => void): void {}
}

function createRuntime(backend: AgentBackend, voiceOutput: VoiceOutput): RuntimeController {
  let id = 0;

  return new RuntimeController({
    backend,
    voiceOutput,
    now: () => 1000,
    createId: (prefix) => `${prefix}_${++id}`
  });
}

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

function permissionRequest(command: string, riskLevel: PermissionRequest["riskLevel"]): PermissionRequest {
  return {
    id: "perm_1",
    sessionId: "sess_1",
    tool: "shell",
    action: "run_command",
    command,
    riskLevel,
    rawText: `Run command: ${command} ?`,
    createdAt: 100
  };
}
