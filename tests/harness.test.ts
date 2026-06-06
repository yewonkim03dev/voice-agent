import assert from "node:assert/strict";
import test from "node:test";

import { createTerminalHarnessFromArgs, InMemoryAgentBackend, parseHarnessCliArgs, TerminalHarness } from "../src/app/harness.ts";
import type { VoiceLocalSettingsOverride, VoiceSettingsPersistence } from "../src/app/voice-config.ts";
import {
  parseVoiceAgentEventLine,
  parseVoiceAgentEventSequence,
  voiceAgentProtocolPrompt
} from "../src/voice/VoiceAgentEvent.ts";
import { TtsVoiceOutput } from "../src/voice/TtsVoiceOutput.ts";
import type { VoiceMessage } from "../src/voice/VoiceMessage.ts";
import type { VoiceOutput } from "../src/voice/VoiceOutput.ts";
import type { TtsProvider, TtsSpeakRequest } from "../src/voice/TtsProvider.ts";
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

test("visual emergency_stop interrupts pass-through backend and speaks stopped", async () => {
  const backend = new InMemoryAgentBackend();
  const voiceOutput = new StoppableVoiceOutput();
  const visualBridge = new FakeVisualBridge();
  const harness = new TerminalHarness({
    backend,
    backendLabel: "codex-test",
    routingMode: "passthrough",
    agentTarget: "codex",
    voiceOutput,
    visualBridge,
    now: () => 1000,
    createId: createTestId()
  });

  await harness.start();
  await harness.processLine("코덱스 긴 작업 처리해줘");
  visualBridge.emitControl("emergency_stop");
  await flushAsync();

  assert.deepEqual(backend.interrupts, ["Emergency stop requested from visual"]);
  assert.equal(voiceOutput.stopCount, 1);
  assert.equal(voiceOutput.messages.at(-1)?.text, "정지했어.");
  assert.equal(lastStateEvent(visualBridge.events)?.state, "idle");
});

test("visual control update_tts_settings updates TTS runtime settings", async () => {
  const visualBridge = new FakeVisualBridge();
  const voiceOutput = new TtsVoiceOutput({
    provider: new BlockingTtsProvider()
  });
  const harness = new TerminalHarness({
    voiceOutput,
    visualBridge,
    now: () => 1000,
    createId: createTestId()
  });

  await harness.start();
  visualBridge.emitControl("update_tts_settings", {
    language: "ko",
    gender: "female",
    voiceName: "Yuna",
    rate: 0.62,
    pitch: 1.1,
    volume: 0.8
  });
  await flushAsync();

  assert.deepEqual(voiceOutput.getSettings(), {
    language: "ko",
    voiceName: "Yuna",
    gender: "female",
    rate: 0.62,
    pitch: 1.1,
    volume: 0.8
  });
  assert.deepEqual(visualBridge.events.findLast((event) => event.type === "settings"), {
    op: "voice-agent-ui",
    type: "settings",
    tts: {
      language: "ko",
      voiceName: "Yuna",
      gender: "female",
      rate: 0.62,
      pitch: 1.1,
      volume: 0.8
    }
  });
});

test("visual settings apply persists TTS and visual overrides", async () => {
  const visualBridge = new FakeVisualBridge();
  const settingsPersistence = new FakeSettingsPersistence();
  const voiceOutput = new TtsVoiceOutput({
    provider: new BlockingTtsProvider()
  });
  const harness = new TerminalHarness({
    voiceOutput,
    visualBridge,
    settingsPersistence,
    now: () => 1000,
    createId: createTestId()
  });

  await harness.start();
  visualBridge.emitControl("update_tts_settings", {
    language: "ko",
    gender: "female",
    voiceName: "Yuna",
    rate: 0.62,
    pitch: 1.1,
    volume: 0.8
  });
  visualBridge.emitVisualControl({
    thinkingVolume: 0.48,
    responseLanguage: "en",
    chatHistoryEnabled: false,
    hudEnabled: false
  });
  await flushAsync();

  assert.deepEqual(settingsPersistence.updates, [
    {
      tts: {
        enabled: true,
        language: "ko",
        voiceName: "Yuna",
        gender: "female",
        rate: 0.62,
        pitch: 1.1,
        volume: 0.8
      }
    },
    {
      visual: {
        thinkingVolume: 0.48,
        responseLanguage: "en",
        chatHistoryEnabled: false,
        hudEnabled: false
      }
    }
  ]);
});

test("visual response language setting is attached to pass-through prompts", async () => {
  const backend = new InMemoryAgentBackend();
  const visualBridge = new FakeVisualBridge();
  const harness = createPassthroughHarness(backend, [], visualBridge);

  await harness.start();
  visualBridge.emitVisualControl({
    responseLanguage: "en"
  });
  await flushAsync();
  await harness.processLine("코덱스 테스트 돌려줘");

  assert.equal(backend.prompts.length, 1);
  assert.equal(backend.prompts[0].text, "테스트 돌려줘");
  assert.equal(backend.prompts[0].responseLanguage, "en");
});

test("visual settings expose and persist Codex thread id for next restart", async () => {
  const visualBridge = new FakeVisualBridge();
  const settingsPersistence = new FakeSettingsPersistence();
  const harness = new TerminalHarness({
    visualBridge,
    settingsPersistence,
    codexThreadId: "thread_existing",
    now: () => 1000,
    createId: createTestId()
  });

  await harness.start();

  assert.equal(
    visualBridge.events.find((event) => event.type === "settings")?.codexThreadId,
    "thread_existing"
  );

  visualBridge.emitCodexThreadControl(" thread_next ");
  await flushAsync();

  assert.deepEqual(settingsPersistence.updates.at(-1), {
    codexThreadId: "thread_next"
  });
  assert.equal(
    visualBridge.events.findLast((event) => event.type === "settings")?.codexThreadId,
    "thread_next"
  );
});

test("visual reset_settings restores default TTS runtime settings", async () => {
  const visualBridge = new FakeVisualBridge();
  const voiceOutput = new TtsVoiceOutput({
    provider: new BlockingTtsProvider(),
    language: "ko",
    voiceName: "Yuna",
    gender: "female",
    rate: 0.7,
    pitch: 1.2,
    volume: 0.5
  });
  const harness = new TerminalHarness({
    voiceOutput,
    visualBridge,
    visualConfig: {
      thinkingVolume: 0.5
    },
    now: () => 1000,
    createId: createTestId()
  });

  await harness.start();
  visualBridge.emitControl("reset_settings");
  await flushAsync();

  assert.deepEqual(voiceOutput.getSettings(), {
    language: "auto",
    gender: "auto",
    rate: 0.56,
    pitch: 1,
    volume: 1
  });
  assert.deepEqual(visualBridge.events.findLast((event) => event.type === "settings"), {
    op: "voice-agent-ui",
    type: "settings",
    tts: {
      language: "auto",
      gender: "auto",
      rate: 0.56,
      pitch: 1,
      volume: 1
    },
    visual: {
      thinkingVolume: 0.32,
      responseLanguage: "auto",
      chatHistoryEnabled: true,
      hudEnabled: true
    }
  });
});

test("visual reset_settings clears persisted overrides", async () => {
  const visualBridge = new FakeVisualBridge();
  const settingsPersistence = new FakeSettingsPersistence();
  const harness = new TerminalHarness({
    visualBridge,
    settingsPersistence,
    visualConfig: {
      thinkingVolume: 0.5
    },
    now: () => 1000,
    createId: createTestId()
  });

  await harness.start();
  visualBridge.emitControl("reset_settings");
  await flushAsync();

  assert.equal(settingsPersistence.resetCount, 1);
  assert.deepEqual(visualBridge.events.findLast((event) => event.type === "settings"), {
    op: "voice-agent-ui",
    type: "settings",
    tts: {
      language: "auto",
      gender: "auto",
      rate: 0.56,
      pitch: 1,
      volume: 1
    },
    visual: {
      thinkingVolume: 0.32,
      responseLanguage: "auto",
      chatHistoryEnabled: true,
      hudEnabled: true
    }
  });
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

test("parses Codex approval policy without forwarding it to app-server args", () => {
  assert.deepEqual(parseHarnessCliArgs(["--codex", "--codex-approval-policy", "on-failure", "-c", "model=\"gpt\""], "/repo"), {
    backendMode: "codex",
    codexCommand: "codex",
    codexArgs: ["app-server", "--listen", "ws://127.0.0.1:0", "-c", "model=\"gpt\""],
    codexApprovalPolicy: "on-failure",
    claudeCommand: "claude",
    cwd: "/repo"
  });
});

test("rejects unsupported Codex approval policy values", () => {
  assert.throws(
    () => parseHarnessCliArgs(["--codex", "--codex-approval-policy", "full-auto"], "/repo"),
    /Unsupported --codex-approval-policy value/u
  );
});

test("uses Codex approval policy from env when CLI flag is omitted", () => {
  const harness = createTerminalHarnessFromArgs(["--codex"], {
    env: {
      VOICE_AGENT_CODEX_APPROVAL_POLICY: "never"
    },
    cwd: "/repo"
  });

  assert.equal((harness.backend as unknown as { approvalPolicy: string }).approvalPolicy, "never");
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

test("pass-through visual displays the current question below the audio circle", async () => {
  const backend = new InMemoryAgentBackend();
  const visualBridge = new FakeVisualBridge();
  const harness = createPassthroughHarness(backend, [], visualBridge);

  await harness.start();
  await harness.processLine("코덱스 README 확인해줘");

  assert.deepEqual(visualBridge.events.find((event) => event.type === "question"), {
    op: "voice-agent-ui",
    type: "question",
    text: "README 확인해줘"
  });

  backend.emitOutput({
    sessionId: backend.prompts[0].sessionId,
    type: "task_complete",
    text: "Task complete",
    timestamp: 1000
  });
  await flushAsync();

  assert.deepEqual(visualBridge.events.filter((event) => event.type === "question").at(-1), {
    op: "voice-agent-ui",
    type: "question",
    text: ""
  });
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
    text: [
      "명령 실행 권한 필요해.",
      "허용: 허용 / 승인 / 응 / 그래 / 좋아 / 진행해 / 실행해 / 해도 돼 / 해도돼 / yes / approve / allow / go ahead / ok / okay",
      "거부: 거부 / 아니 / 안 돼 / 안돼 / 하지 마 / 하지마 / 취소 / 멈춰 / no / deny / reject / cancel / stop",
      "세션 허용: 이번 세션 동안 허용 / 이번 세션은 허용 / 세션 동안 허용 / 다음부터 묻지 마 / 다음부터 묻지마 / 계속 허용 / always allow / allow for session / accept for session",
      "계속 허용: 같은 명령 계속 허용 / 앞으로 이 명령은 허용 / 이 명령 계속 허용 / 항상 이 명령 허용 / remember this command"
    ].join("\n")
  });
});

test("pass-through permission prompt waits for queued speech instead of cutting it off", async () => {
  const backend = new InMemoryAgentBackend();
  const provider = new BlockingTtsProvider();
  const harness = new TerminalHarness({
    backend,
    backendLabel: "codex-test",
    routingMode: "passthrough",
    agentTarget: "codex",
    voiceOutput: new TtsVoiceOutput({
      provider
    }),
    now: () => 1000,
    createId: createTestId()
  });

  await harness.start();
  backend.emitOutput({
    sessionId: "sess_1",
    type: "stdout",
    text: '{"op":"voice-agent","type":"speech","text":"그 임시 파일만 지우겠습니다."}\n',
    timestamp: 1000
  });
  await flushAsync();

  backend.emitPermissionRequest(backend.createPermissionRequest("rm /tmp/example", "sess_1", "approval_1"));
  await flushAsync();

  assert.equal(provider.stopCount, 0);
  assert.deepEqual(provider.requests.map((request) => request.text), ["그 임시 파일만 지우겠습니다."]);

  provider.finishNext();
  await flushAsync();

  assert.deepEqual(provider.requests.map((request) => request.text), [
    "그 임시 파일만 지우겠습니다.",
    "명령 실행 권한 필요해. 허용할까?"
  ]);
});

test("pass-through visual keeps approval choices visible after permission TTS", async () => {
  const backend = new InMemoryAgentBackend();
  const voiceOutput = new HoldableVoiceOutput();
  const visualBridge = new FakeVisualBridge();
  const harness = new TerminalHarness({
    backend,
    backendLabel: "codex-test",
    routingMode: "passthrough",
    agentTarget: "codex",
    voiceOutput,
    visualBridge,
    now: () => 1000,
    createId: createTestId()
  });

  await harness.start();
  backend.emitPermissionRequest(backend.createPermissionRequest("npm test", "sess_1", "approval_1"));
  await flushAsync();

  const stateDuringTts = lastStateEvent(visualBridge.events);
  assert.equal(stateDuringTts?.state, "approval_pending");
  assert.match(stateDuringTts?.text ?? "", /허용: 허용 \/ 승인/u);
  assert.match(stateDuringTts?.text ?? "", /거부: 거부 \/ 아니/u);

  voiceOutput.finishLast();
  await flushAsync();

  const stateAfterTts = lastStateEvent(visualBridge.events);
  assert.equal(stateAfterTts?.state, "approval_pending");
  assert.match(stateAfterTts?.text ?? "", /허용: 허용 \/ 승인/u);
  assert.match(stateAfterTts?.text ?? "", /거부: 거부 \/ 아니/u);

  backend.emitStatus({
    process: "running",
    task: "waiting_permission"
  });
  await flushAsync();

  const stateAfterNativeStatus = lastStateEvent(visualBridge.events);
  assert.equal(stateAfterNativeStatus?.state, "approval_pending");
  assert.match(stateAfterNativeStatus?.text ?? "", /허용: 허용 \/ 승인/u);
  assert.match(stateAfterNativeStatus?.text ?? "", /거부: 거부 \/ 아니/u);
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

test("pass-through session approval explains available alternatives when unsupported", async () => {
  const backend = new InMemoryAgentBackend();
  backend.sendPermission = async () => {
    throw new Error("Codex approval does not offer acceptForSession for this request. Available: accept, acceptWithExecpolicyAmendment, cancel.");
  };
  const harness = createPassthroughHarness(backend);

  await harness.start();
  const request = backend.createPermissionRequest("npm test", "sess_1", "approval_1");
  request.native = {
    backend: "codex",
    requestMethod: "item/commandExecution/requestApproval",
    availableDecisions: ["accept", "acceptWithExecpolicyAmendment", "cancel"]
  };
  backend.emitPermissionRequest(request);
  await flushAsync();

  await harness.processLine("이번 세션 동안 허용");

  assert.equal(
    harness.voiceOutput.messages.at(-1)?.text,
    "이번 요청은 세션 허용을 지원하지 않아. 한 번만 허용은 허용, 같은 명령 계속 허용은 같은 명령 계속 허용, 거부는 거부 중 하나로 다시 말해줘."
  );
});

test("pass-through queues simultaneous native approvals and advances one at a time", async () => {
  const backend = new InMemoryAgentBackend();
  const harness = createPassthroughHarness(backend);

  await harness.start();
  backend.emitPermissionRequest(backend.createPermissionRequest("npm test", "sess_1", "approval_1"));
  backend.emitPermissionRequest(backend.createPermissionRequest("npm run build", "sess_1", "approval_2"));
  await flushAsync();

  assert.deepEqual(
    harness.voiceOutput.messages.filter((message) => message.category === "permission").map((message) => message.text),
    ["명령 실행 권한 필요해. 허용할까?"]
  );

  await harness.processLine("허용");
  await flushAsync();

  assert.deepEqual(backend.permissions.map((permission) => permission.requestId), ["approval_1"]);
  assert.deepEqual(
    harness.voiceOutput.messages.filter((message) => message.category === "permission").map((message) => message.text),
    ["명령 실행 권한 필요해. 허용할까?", "명령 실행 권한 필요해. 허용할까?"]
  );

  await harness.processLine("허용");

  assert.deepEqual(backend.permissions.map((permission) => permission.requestId), ["approval_1", "approval_2"]);
});

test("pass-through speaks network approvals distinctly and maps host policy speech", async () => {
  const backend = new InMemoryAgentBackend();
  const visualBridge = new FakeVisualBridge();
  const harness = createPassthroughHarness(backend, [], visualBridge);
  const request = backend.createPermissionRequest("git push", "sess_1", "approval_1");
  request.action = "network_access";
  request.rawText = "Codex requests network access to github.com.";
  request.native = {
    backend: "codex",
    requestMethod: "item/commandExecution/requestApproval",
    networkApprovalContext: {
      host: "github.com",
      protocol: "https"
    },
    proposedNetworkPolicyAmendments: [
      {
        host: "github.com",
        action: "allow"
      }
    ],
    availableDecisions: ["accept", { applyNetworkPolicyAmendment: { network_policy_amendment: { host: "github.com", action: "allow" } } }, "cancel"]
  };

  await harness.start();
  backend.emitPermissionRequest(request);
  await flushAsync();

  assert.equal(harness.voiceOutput.messages.at(-1)?.text, "네트워크 권한이 필요해. 허용할까?");
  const approval = visualBridge.events.findLast((event) => event.type === "approval");
  assert.match(approval?.text ?? "", /대상: github\.com/u);
  assert.match(approval?.text ?? "", /Codex requests network access to github\.com/u);
  assert.match(approval?.text ?? "", /Codex 선택지: accept, applyNetworkPolicyAmendment, cancel/u);

  await harness.processLine("같은 네트워크 계속 허용");

  assert.equal(backend.permissions.length, 1);
  assert.equal(backend.permissions[0].scope, "network");
});

test("pass-through mode does not parse agent text into fake approval requests", async () => {
  const backend = new InMemoryAgentBackend();
  const harness = createPassthroughHarness(backend);

  await harness.start();
  backend.emitPermissionRequest(backend.createPermissionRequest("npm test", "sess_1", "approval_1"));
  await flushAsync();
  const messagesBeforeOutput = harness.voiceOutput.messages.length;

  backend.emitOutput({
    sessionId: "sess_1",
    type: "stdout",
    text: "approve_action 실행 권한 필요해. 허용할까?",
    timestamp: 1000
  });
  await flushAsync();

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
    role: "message",
    raw: {
      op: "voice-agent",
      type: "speech",
      text: "확인했어."
    }
  });
  assert.equal(parseVoiceAgentEventLine(
    '{"op":"voice-agent","type":"speech","role":"progress","text":"확인 중이야."}'
  )?.role, "progress");
  assert.equal(parseVoiceAgentEventLine(
    '{"op":"voice-agent","type":"speech","role":"final","text":"끝났어."}'
  )?.role, "final");
  assert.equal(parseVoiceAgentEventLine(
    '{"op":"voice-agent","type":"speech","role":"unknown","text":"일반 메시지야."}'
  )?.role, "message");
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

test("voice-agent protocol prefers speech for audible progress", () => {
  assert.match(voiceAgentProtocolPrompt, /Before tool use.+brief speech event/u);
  assert.match(voiceAgentProtocolPrompt, /role="progress"/u);
  assert.match(voiceAgentProtocolPrompt, /role=final/u);
  assert.match(voiceAgentProtocolPrompt, /Missing or unknown roles are treated as message/u);
  assert.match(voiceAgentProtocolPrompt, /During long-running work.+brief speech progress updates/u);
  assert.match(voiceAgentProtocolPrompt, /normal Codex\/Claude CLI working cadence/u);
  assert.match(voiceAgentProtocolPrompt, /Use speech, not status or command, for user-facing progress/u);
  assert.match(voiceAgentProtocolPrompt, /findings, conclusions, and short summaries/u);
  assert.match(voiceAgentProtocolPrompt, /command.+only for shell commands, file paths, URLs/u);
  assert.match(voiceAgentProtocolPrompt, /Do not put investigation summaries.+in command/u);
  assert.match(voiceAgentProtocolPrompt, /status.+only for silent UI state/u);
});

test("pass-through progress TTS keeps only the latest queued progress", async () => {
  const backend = new InMemoryAgentBackend();
  const lines: string[] = [];
  const voiceOutput = new HoldableVoiceOutput();
  const visualBridge = new FakeVisualBridge();
  const harness = createPassthroughHarness(backend, lines, visualBridge, undefined, voiceOutput);

  await harness.start();
  backend.emitOutput({
    sessionId: "sess_1",
    type: "stdout",
    text: '{"op":"voice-agent","type":"speech","role":"progress","text":"파일 구조 확인 중입니다."}\n',
    timestamp: 1000
  });
  await flushAsync();

  assert.deepEqual(voiceOutput.messages.map((message) => message.text), ["파일 구조 확인 중입니다."]);

  backend.emitOutput({
    sessionId: "sess_1",
    type: "stdout",
    text:
      '{"op":"voice-agent","type":"speech","role":"progress","text":"테스트 추가 중입니다."}\n' +
      '{"op":"voice-agent","type":"speech","role":"progress","text":"npm test 실행 중입니다."}\n',
    timestamp: 1000
  });
  await flushAsync();

  assert.equal(lines.some((line) => line.includes("[agent:speech] 테스트 추가 중입니다.")), true);
  assert.equal(
    visualBridge.events.some((event) => event.type === "status" && event.text === "테스트 추가 중입니다."),
    true
  );

  voiceOutput.finishLast();
  await flushAsync();

  assert.deepEqual(voiceOutput.messages.map((message) => message.text), [
    "파일 구조 확인 중입니다.",
    "npm test 실행 중입니다."
  ]);
});

test("pass-through final speech clears queued progress and is spoken", async () => {
  const backend = new InMemoryAgentBackend();
  const voiceOutput = new HoldableVoiceOutput();
  const harness = createPassthroughHarness(backend, [], undefined, undefined, voiceOutput);

  await harness.start();
  backend.emitOutput({
    sessionId: "sess_1",
    type: "stdout",
    text: '{"op":"voice-agent","type":"speech","role":"progress","text":"파일 수정 중입니다."}\n',
    timestamp: 1000
  });
  await flushAsync();

  assert.deepEqual(voiceOutput.messages.map((message) => message.text), ["파일 수정 중입니다."]);

  backend.emitOutput({
    sessionId: "sess_1",
    type: "stdout",
    text:
      '{"op":"voice-agent","type":"speech","role":"progress","text":"테스트 실행 중입니다."}\n' +
      '{"op":"voice-agent","type":"speech","role":"final","text":"완료했습니다. 테스트도 통과했습니다."}\n',
    timestamp: 1000
  });
  await flushAsync();

  voiceOutput.finishLast();
  await flushAsync();

  assert.deepEqual(voiceOutput.messages.map((message) => message.text), [
    "파일 수정 중입니다.",
    "완료했습니다. 테스트도 통과했습니다."
  ]);
  assert.equal(voiceOutput.messages.at(-1)?.category, "completion");
});

test("pass-through message speech is not dropped as stale progress", async () => {
  const backend = new InMemoryAgentBackend();
  const voiceOutput = new HoldableVoiceOutput();
  const harness = createPassthroughHarness(backend, [], undefined, undefined, voiceOutput);

  await harness.start();
  backend.emitOutput({
    sessionId: "sess_1",
    type: "stdout",
    text:
      '{"op":"voice-agent","type":"speech","role":"progress","text":"파일 확인 중입니다."}\n' +
      '{"op":"voice-agent","type":"speech","role":"message","text":"이 설정은 재시작 후 적용됩니다."}\n',
    timestamp: 1000
  });
  await flushAsync();

  assert.deepEqual(voiceOutput.messages.map((message) => message.text), ["파일 확인 중입니다."]);

  voiceOutput.finishLast();
  await flushAsync();

  assert.deepEqual(voiceOutput.messages.map((message) => message.text), [
    "파일 확인 중입니다.",
    "이 설정은 재시작 후 적용됩니다."
  ]);
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

test("pass-through mode routes complete voice-agent speech without waiting for newline", async () => {
  const backend = new InMemoryAgentBackend();
  const lines: string[] = [];
  const harness = createPassthroughHarness(backend, lines);

  await harness.start();
  backend.emitOutput({
    sessionId: "sess_1",
    type: "stdout",
    text: '{"op":"voice-agent","type":"speech","text":"바로 말할게."}',
    timestamp: 1000
  });
  await flushAsync();

  assert.equal(harness.voiceOutput.messages.at(-1)?.text, "바로 말할게.");
  assert.equal(lines.some((line) => line.includes("[agent:speech] 바로 말할게.")), true);
});

test("pass-through visual stays speaking until TTS finishes", async () => {
  const backend = new InMemoryAgentBackend();
  const voiceOutput = new HoldableVoiceOutput();
  const visualBridge = new FakeVisualBridge();
  const harness = new TerminalHarness({
    backend,
    backendLabel: "codex-test",
    routingMode: "passthrough",
    agentTarget: "codex",
    voiceOutput,
    visualBridge,
    now: () => 1000,
    createId: createTestId()
  });

  await harness.start();
  backend.emitOutput({
    sessionId: "sess_1",
    type: "stdout",
    text: '{"op":"voice-agent","type":"speech","text":"대기 중입니다. 원하시는 작업을 말씀해 주세요."}\n',
    timestamp: 1000
  });
  await flushAsync();

  assert.deepEqual(lastStateEvent(visualBridge.events), {
    op: "voice-agent-ui",
    type: "state",
    state: "speaking",
    text: "대기 중입니다. 원하시는 작업을 말씀해 주세요."
  });

  backend.emitStatus({
    process: "running",
    task: "idle"
  });
  await flushAsync();

  assert.deepEqual(lastStateEvent(visualBridge.events), {
    op: "voice-agent-ui",
    type: "state",
    state: "speaking",
    text: "대기 중입니다. 원하시는 작업을 말씀해 주세요."
  });

  voiceOutput.finishLast();
  await flushAsync();

  assert.equal(lastStateEvent(visualBridge.events)?.state, "idle");
});

test("pass-through visual follows the currently spoken queued speech", async () => {
  const backend = new InMemoryAgentBackend();
  const voiceOutput = new HoldableVoiceOutput();
  const visualBridge = new FakeVisualBridge();
  const harness = new TerminalHarness({
    backend,
    backendLabel: "codex-test",
    routingMode: "passthrough",
    agentTarget: "codex",
    voiceOutput,
    visualBridge,
    now: () => 1000,
    createId: createTestId()
  });

  await harness.start();
  backend.emitOutput({
    sessionId: "sess_1",
    type: "stdout",
    text:
      '{"op":"voice-agent","type":"speech","text":"첫 번째 대사입니다."}\n' +
      '{"op":"voice-agent","type":"speech","text":"두 번째 대사입니다."}\n',
    timestamp: 1000
  });
  await flushAsync();

  assert.deepEqual(voiceOutput.messages.map((message) => message.text), ["첫 번째 대사입니다."]);
  assert.deepEqual(lastStateEvent(visualBridge.events), {
    op: "voice-agent-ui",
    type: "state",
    state: "speaking",
    text: "첫 번째 대사입니다."
  });

  voiceOutput.finishLast();
  await flushAsync();

  assert.deepEqual(voiceOutput.messages.map((message) => message.text), ["첫 번째 대사입니다.", "두 번째 대사입니다."]);
  assert.deepEqual(lastStateEvent(visualBridge.events), {
    op: "voice-agent-ui",
    type: "state",
    state: "speaking",
    text: "두 번째 대사입니다."
  });
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
  assert.equal(visualBridge.events.some((event) => event.type === "state" && event.state === "speaking"), true);
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

test("pass-through mode does not replay stale speech after interruption", async () => {
  const backend = new InMemoryAgentBackend();
  const lines: string[] = [];
  const visualBridge = new FakeVisualBridge();
  const harness = createPassthroughHarness(backend, lines, visualBridge);

  await harness.start();
  await harness.processLine("코덱스 긴 작업 처리해줘");
  const sessionId = backend.prompts[0].sessionId;
  await harness.processLine("멈춰");
  backend.emitOutput({
    sessionId,
    type: "stdout",
    text: '{"op":"voice-agent","type":"speech","role":"final","text":"늦게 도착한 답변입니다."}\n',
    timestamp: 1000
  });
  backend.emitOutput({
    sessionId,
    type: "task_complete",
    text: "Task complete",
    timestamp: 1000
  });
  await flushAsync();

  assert.deepEqual(harness.voiceOutput.messages.map((message) => message.text), ["멈출게."]);
  assert.equal(lines.some((line) => line.includes("[agent:stale:speech] 늦게 도착한 답변입니다.")), true);
  assert.equal(
    visualBridge.events.some(
      (event) => event.type === "command" && event.text === "[stale speech] 늦게 도착한 답변입니다."
    ),
    true
  );
});

test("pass-through STOP followed by a new command keeps old output stale", async () => {
  const backend = new InMemoryAgentBackend();
  const lines: string[] = [];
  const visualBridge = new FakeVisualBridge();
  const harness = createPassthroughHarness(backend, lines, visualBridge);

  await harness.start();
  await harness.processLine("코덱스 긴 작업 처리해줘");
  const oldSessionId = backend.prompts[0].sessionId;
  visualBridge.emitControl("emergency_stop");
  await flushAsync();
  await harness.processLine("코덱스 뭐 해");
  const newSessionId = backend.prompts[1].sessionId;

  assert.notEqual(newSessionId, oldSessionId);

  backend.emitOutput({
    sessionId: oldSessionId,
    type: "stdout",
    text: '{"op":"voice-agent","type":"speech","role":"final","text":"늦은 옛 답변"}\n',
    timestamp: 1000
  });
  backend.emitOutput({
    sessionId: oldSessionId,
    type: "task_complete",
    text: "Task complete",
    timestamp: 1000
  });
  await flushAsync();

  assert.equal(lines.some((line) => line.includes("[agent:stale:speech] 늦은 옛 답변")), true);
  assert.equal(harness.voiceOutput.messages.some((message) => message.text === "늦은 옛 답변"), false);
  assert.equal(lastStateEvent(visualBridge.events)?.state, "thinking");

  backend.emitOutput({
    sessionId: newSessionId,
    type: "stdout",
    text: '{"op":"voice-agent","type":"speech","role":"final","text":"새 답변입니다."}\n',
    timestamp: 1000
  });
  backend.emitOutput({
    sessionId: newSessionId,
    type: "task_complete",
    text: "Task complete",
    timestamp: 1000
  });
  await flushAsync();

  assert.deepEqual(harness.voiceOutput.messages.map((message) => message.text), ["정지했어.", "새 답변입니다."]);
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
  onExitRequest?: () => void | Promise<void>,
  voiceOutput?: VoiceOutput & { readonly messages: VoiceMessage[] }
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
    onExitRequest,
    voiceOutput
  });
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
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

class HoldableVoiceOutput implements VoiceOutput {
  readonly messages: VoiceMessage[] = [];
  private readonly finishedListeners: Array<(id: string) => void> = [];
  private readonly resolvers = new Map<string, () => void>();

  speak(message: VoiceMessage): Promise<void> {
    this.messages.push(message);
    return new Promise((resolve) => {
      this.resolvers.set(message.id, resolve);
    });
  }

  async stop(): Promise<void> {
    this.finishLast();
  }

  onFinished(callback: (id: string) => void): void {
    this.finishedListeners.push(callback);
  }

  finishLast(): void {
    const message = this.messages.at(-1);
    if (!message) return;

    this.finishedListeners.forEach((listener) => listener(message.id));
    this.resolvers.get(message.id)?.();
    this.resolvers.delete(message.id);
  }
}

class BlockingTtsProvider implements TtsProvider {
  readonly name = "macos-apple" as const;
  readonly requests: TtsSpeakRequest[] = [];
  private readonly resolvers: Array<() => void> = [];
  stopCount = 0;

  async speak(request: TtsSpeakRequest): Promise<void> {
    this.requests.push(request);
    await new Promise<void>((resolve) => {
      this.resolvers.push(resolve);
    });
  }

  async stop(): Promise<void> {
    this.stopCount += 1;
    this.finishNext();
  }

  finishNext(): void {
    this.resolvers.shift()?.();
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

  emitControl(action: VisualControlEvent["action"], tts?: VisualControlEvent["tts"]): void {
    this.controlListeners.forEach((listener) =>
      listener({
        op: "voice-agent-ui",
        type: "control",
        action,
        ...(tts ? { tts } : {})
      })
    );
  }

  emitVisualControl(visual: NonNullable<VisualControlEvent["visual"]>): void {
    this.controlListeners.forEach((listener) =>
      listener({
        op: "voice-agent-ui",
        type: "control",
        action: "update_visual_settings",
        visual
      })
    );
  }

  emitCodexThreadControl(codexThreadId: string): void {
    this.controlListeners.forEach((listener) =>
      listener({
        op: "voice-agent-ui",
        type: "control",
        action: "update_codex_thread_id",
        codexThreadId
      })
    );
  }
}

class FakeSettingsPersistence implements VoiceSettingsPersistence {
  readonly updates: VoiceLocalSettingsOverride[] = [];
  resetCount = 0;

  async update(overrides: VoiceLocalSettingsOverride): Promise<void> {
    this.updates.push(overrides);
  }

  async resetAll(): Promise<void> {
    this.resetCount += 1;
  }
}

function isStateEvent(event: VisualEvent): event is Extract<VisualEvent, { type: "state" }> {
  return event.type === "state";
}

function lastStateEvent(events: VisualEvent[]): Extract<VisualEvent, { type: "state" }> | undefined {
  return events.findLast(isStateEvent);
}
