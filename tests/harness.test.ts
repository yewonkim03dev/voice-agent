import assert from "node:assert/strict";
import test from "node:test";

import { createTerminalHarnessFromArgs, InMemoryAgentBackend, parseHarnessCliArgs, TerminalHarness, type TerminalHarnessOptions } from "../src/app/harness.ts";
import type {
  VoiceSessionHistoryPersistence,
  VoiceSessionHistorySnapshot
} from "../src/app/session-history.ts";
import type { VoiceLocalSettingsOverride, VoiceSettingsPersistence } from "../src/app/voice-config.ts";
import {
  defaultAppShotHotkey,
  defaultScreenCaptureDirectory,
  defaultScreenDescribePrompt
} from "../src/screen/ScreenCapture.ts";
import {
  parseVoiceAgentEventLine,
  parseVoiceAgentEventSequence,
  voiceAgentProtocolPrompt,
  voiceAgentProtocolPromptForSettings
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

test("help slash command prints terminal commands", async () => {
  const lines: string[] = [];
  const harness = new TerminalHarness({
    now: () => 1000,
    createId: createTestId(),
    writeLine: (line) => lines.push(line)
  });

  await harness.start();
  await harness.processLine("/help");

  assert.ok(lines.includes("Commands:"));
  assert.ok(lines.includes("  /help shows this command list."));
  assert.ok(lines.includes("  /status shows the current agent status."));
  assert.ok(lines.includes("  /popups lists recent popup answers."));
  assert.ok(lines.includes("  /popup <number> reopens a recent popup answer."));
  assert.ok(lines.includes("  /tts-stop stops current TTS playback."));
  assert.ok(lines.includes("  /quit exits Voice Agent."));
  assert.ok(lines.includes("Backend/TTS run options:"));
  assert.ok(lines.includes("  --codex, --real use the Codex app-server backend."));
  assert.ok(lines.includes("  --tts, --no-tts enable or disable TTS."));
});

test("unknown slash command suggests help", async () => {
  const lines: string[] = [];
  const harness = new TerminalHarness({
    now: () => 1000,
    createId: createTestId(),
    writeLine: (line) => lines.push(line)
  });

  await harness.start();
  await harness.processLine("/nope");

  assert.ok(lines.includes("[harness] unknown command: /nope"));
  assert.ok(lines.includes("Type /help to show available commands."));
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
    reactionMode: "particle_orb",
    chatHistoryEnabled: false,
    hudEnabled: false,
    hudCompact: true,
    popupPreferred: true,
    popupFontSize: 30,
    speakWakeRejectedWarnings: false,
    maxUtteranceSeconds: 80
  });
  visualBridge.emitStopPhrasesControl(["얼음", "freeze"]);
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
        reactionMode: "particle_orb",
        chatHistoryEnabled: false,
        hudEnabled: false,
        hudCompact: true,
        popupPreferred: true,
        popupFontSize: 24,
        screenDescribePrompt: defaultScreenDescribePrompt("en"),
        screenCaptureDirectory: defaultScreenCaptureDirectory,
        appShotHotkey: defaultAppShotHotkey,
        appShotAutoSend: true,
        speakWakeRejectedWarnings: false,
        maxUtteranceSeconds: 55
      }
    },
    {
      stopPhrases: ["얼음", "freeze"]
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
    codexAlwaysStartNewThread: false,
    now: () => 1000,
    createId: createTestId()
  });

  await harness.start();

  assert.equal(
    visualBridge.events.find((event) => event.type === "settings")?.codexThreadId,
    "thread_existing"
  );
  assert.equal(
    visualBridge.events.find((event) => event.type === "settings")?.codexAlwaysStartNewThread,
    false
  );

  visualBridge.emitCodexThreadControl(" thread_next ", true);
  await flushAsync();

  assert.deepEqual(settingsPersistence.updates.at(-1), {
    codexThreadId: "thread_next",
    codexAlwaysStartNewThread: true
  });
  assert.equal(
    visualBridge.events.findLast((event) => event.type === "settings")?.codexThreadId,
    "thread_next"
  );
  assert.equal(
    visualBridge.events.findLast((event) => event.type === "settings")?.codexAlwaysStartNewThread,
    true
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
  const settings = visualBridge.events.findLast((event): event is Extract<VisualEvent, { type: "settings" }> => event.type === "settings");
  assert.deepEqual(settings?.tts, {
    language: "auto",
    gender: "auto",
    rate: 0.56,
    pitch: 1,
    volume: 1
  });
  assert.deepEqual(settings?.visual, {
    thinkingVolume: 0.32,
    responseLanguage: "auto",
    reactionMode: "audio_circle",
    chatHistoryEnabled: true,
    hudEnabled: true,
    hudCompact: false,
    popupPreferred: false,
    popupFontSize: 14,
    screenDescribePrompt: defaultScreenDescribePrompt(),
    screenCaptureDirectory: defaultScreenCaptureDirectory,
    appShotHotkey: defaultAppShotHotkey,
    appShotAutoSend: true,
    speakWakeRejectedWarnings: true,
    maxUtteranceSeconds: 15
  });
  assert.deepEqual(settings?.approvalPhrases?.onceApprove.slice(0, 2), ["허용", "승인"]);
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
  const settings = visualBridge.events.findLast((event): event is Extract<VisualEvent, { type: "settings" }> => event.type === "settings");
  assert.deepEqual(settings?.tts, {
    language: "auto",
    gender: "auto",
    rate: 0.56,
    pitch: 1,
    volume: 1
  });
  assert.deepEqual(settings?.visual, {
    thinkingVolume: 0.32,
    responseLanguage: "auto",
    reactionMode: "audio_circle",
    chatHistoryEnabled: true,
    hudEnabled: true,
    hudCompact: false,
    popupPreferred: false,
    popupFontSize: 14,
    screenDescribePrompt: defaultScreenDescribePrompt(),
    screenCaptureDirectory: defaultScreenCaptureDirectory,
    appShotHotkey: defaultAppShotHotkey,
    appShotAutoSend: true,
    speakWakeRejectedWarnings: true,
    maxUtteranceSeconds: 15
  });
  assert.deepEqual(settings?.approvalPhrases?.onceApprove.slice(0, 2), ["허용", "승인"]);
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
    cwd: "/repo",
    debug: false
  });
});

test("parses debug mode without forwarding it to app-server", () => {
  assert.deepEqual(parseHarnessCliArgs(["--codex", "--debug", "-c", "model=\"gpt\""], "/repo"), {
    backendMode: "codex",
    codexCommand: "codex",
    codexArgs: ["app-server", "--listen", "ws://127.0.0.1:0", "-c", "model=\"gpt\""],
    claudeCommand: "claude",
    cwd: "/repo",
    debug: true
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
    cwd: "/repo",
    debug: false
  });
});

test("parses Codex approval policy without forwarding it to app-server args", () => {
  assert.deepEqual(parseHarnessCliArgs(["--codex", "--codex-approval-policy", "on-failure", "-c", "model=\"gpt\""], "/repo"), {
    backendMode: "codex",
    codexCommand: "codex",
    codexArgs: ["app-server", "--listen", "ws://127.0.0.1:0", "-c", "model=\"gpt\""],
    codexApprovalPolicy: "on-failure",
    claudeCommand: "claude",
    cwd: "/repo",
    debug: false
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
    cwd: "/repo",
    debug: false
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

test("pass-through ignores late duplicate approval speech after resolution", async () => {
  const backend = new InMemoryAgentBackend();
  const lines: string[] = [];
  const harness = createPassthroughHarness(backend, lines);

  await harness.start();
  backend.emitPermissionRequest(backend.createPermissionRequest("npm test", "sess_1", "approval_1"));
  await Promise.resolve();
  await harness.processLine("허용");
  await harness.processLine("허용");

  assert.equal(backend.permissions.length, 1);
  assert.equal(backend.prompts.length, 0);
  assert.equal(lines.some((line) => line.includes("ignored late approval speech")), true);

  await harness.processLine("허용 테스트 계속해");

  assert.equal(backend.prompts.length, 1);
  assert.equal(backend.prompts[0].text, "허용 테스트 계속해");
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
      "거부: 거부 / 아니 / 안 돼 / 안돼 / 하지 마 / 하지마 / no / deny / reject",
      "취소: 취소 / 멈춰 / cancel / stop"
    ].join("\n")
  });
});

test("pass-through permission prompt plays a ready cue after TTS finishes", async () => {
  const backend = new InMemoryAgentBackend();
  const lines: string[] = [];
  const harness = createPassthroughHarness(backend, lines);

  await harness.start();
  backend.emitPermissionRequest(backend.createPermissionRequest("npm test", "sess_1", "approval_1"));
  await flushAsync();

  assert.equal(lines.includes("[voice:cue] approval ready \u0007"), true);
  assert.equal(lines.some((line) => line.startsWith("[voice:permission]")), false);
});

test("pass-through ignores saved TTS enabled setting unless --tts is passed", async () => {
  const backend = new InMemoryAgentBackend();
  const lines: string[] = [];
  const harness = createPassthroughHarness(backend, lines, undefined, undefined, undefined, {
    ttsConfig: {
      enabled: true,
      provider: "macos-apple",
      voiceName: "Yuna"
    }
  });

  await harness.start();
  backend.emitPermissionRequest(backend.createPermissionRequest("npm test", "sess_1", "approval_1"));
  await flushAsync();

  assert.equal(harness.voiceOutput.isSpeechEnabled?.(), false);
  assert.equal(lines.includes("[voice:cue] approval ready \u0007"), true);
  assert.equal(lines.some((line) => line.startsWith("[voice:permission]")), false);
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

test("pass-through visual ignores stale waiting_permission status without active approval", async () => {
  const backend = new InMemoryAgentBackend();
  const visualBridge = new FakeVisualBridge();
  const harness = createPassthroughHarness(backend, [], visualBridge);

  await harness.start();
  await harness.processLine("테스트 작업 진행해줘");
  await flushAsync();
  backend.emitStatus({
    process: "running",
    task: "thinking"
  });
  backend.emitStatus({
    process: "running",
    task: "waiting_permission"
  });
  await flushAsync();

  assert.equal(lastStateEvent(visualBridge.events)?.state, "thinking");
});

test("pass-through visual restore ignores resolved approval without active pending permission", async () => {
  const backend = new InMemoryAgentBackend();
  const visualBridge = new FakeVisualBridge();
  const harness = createPassthroughHarness(backend, [], visualBridge);

  await harness.start();
  backend.emitPermissionRequest(backend.createPermissionRequest("npm test", "sess_1", "approval_1"));
  await flushAsync();
  backend.emitOutput({
    sessionId: "sess_1",
    type: "approval_resolved",
    text: "approval_1",
    timestamp: 1000
  });
  await flushAsync();
  harness.restoreCurrentVisualState();

  assert.equal(lastStateEvent(visualBridge.events)?.state, "thinking");
});

test("pass-through approval speech can deny a native approval", async () => {
  const backend = new InMemoryAgentBackend();
  const visualBridge = new FakeVisualBridge();
  const harness = createPassthroughHarness(backend, [], visualBridge);

  await harness.start();
  backend.emitPermissionRequest(backend.createPermissionRequest("npm test", "sess_1", "approval_1"));
  await flushAsync();
  await harness.processLine("거부");

  assert.equal(backend.permissions.length, 1);
  assert.equal(backend.permissions[0].decision, "deny");
  assert.equal(lastStateEvent(visualBridge.events)?.state, "thinking");
  backend.emitStatus({
    process: "running",
    task: "idle"
  });
  assert.equal(lastStateEvent(visualBridge.events)?.state, "idle");
});

test("pass-through approval speech uses configured visual approval phrases", async () => {
  const backend = new InMemoryAgentBackend();
  const visualBridge = new FakeVisualBridge();
  const settingsPersistence = new FakeSettingsPersistence();
  const harness = new TerminalHarness({
    backend,
    backendLabel: "codex-test",
    routingMode: "passthrough",
    agentTarget: "codex",
    visualBridge,
    settingsPersistence,
    now: () => 1000,
    createId: createTestId()
  });

  await harness.start();
  visualBridge.emitApprovalPhrasesControl({
    onceApprove: ["진행"],
    deny: ["그만"],
    sessionApprove: ["오늘은 허용"]
  });
  await flushAsync();

  backend.emitPermissionRequest(backend.createPermissionRequest("npm test", "sess_1", "approval_1"));
  await flushAsync();

  const state = lastStateEvent(visualBridge.events);
  assert.match(state?.text ?? "", /허용: 진행/u);
  assert.match(state?.text ?? "", /거부: 그만/u);

  await harness.processLine("진행");

  assert.equal(backend.permissions.length, 1);
  assert.equal(backend.permissions[0].decision, "allow");
  assert.deepEqual(settingsPersistence.updates.at(-1), {
    approvalPhrases: {
      onceApprove: ["진행"],
      deny: ["그만"],
      cancel: ["취소", "멈춰", "cancel", "stop"],
      sessionApprove: ["오늘은 허용"],
      policyApprove: [
        "같은 명령 계속 허용",
        "앞으로 이 명령은 허용",
        "이 명령 계속 허용",
        "항상 이 명령 허용",
        "remember this command"
      ],
      networkPolicyApprove: [
        "같은 네트워크 계속 허용",
        "이 네트워크 계속 허용",
        "이 호스트 허용",
        "이 호스트 계속 허용",
        "깃허브 계속 허용",
        "github 계속 허용",
        "allow this host",
        "allow this network",
        "remember this host"
      ]
    }
  });
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

test("pass-through mode suppresses raw token-sized agent output by default", async () => {
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

  assert.equal(lines.some((line) => line.includes("[agent:stdout] 실행했습니다.")), false);
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
  assert.deepEqual(parseVoiceAgentEventLine(
    '{"op":"voice-agent","type":"popup","title":"공부 노트","text":"# 개념\\n긴 설명입니다."}'
  ), {
    op: "voice-agent",
    type: "popup",
    text: "# 개념\n긴 설명입니다.",
    role: "message",
    raw: {
      op: "voice-agent",
      type: "popup",
      title: "공부 노트",
      text: "# 개념\n긴 설명입니다."
    }
  });
  assert.equal(parseVoiceAgentEventLine("plain text"), null);
  assert.equal(parseVoiceAgentEventLine('{"op":"other","type":"speech","text":"no"}'), null);
  assert.equal(parseVoiceAgentEventLine('{"op":"voice-agent","type":"popup","text":"   "}'), null);
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
  assert.match(voiceAgentProtocolPrompt, /Output NDJSON only/u);
  assert.match(voiceAgentProtocolPrompt, /Before tool\/file\/search\/command work.+brief speech progress event/u);
  assert.match(voiceAgentProtocolPrompt, /"role":"progress\|message\|final"/u);
  assert.match(voiceAgentProtocolPrompt, /Final answers must use role="final"/u);
  assert.match(voiceAgentProtocolPrompt, /During long work.+meaningful milestones/u);
  assert.match(voiceAgentProtocolPrompt, /speech: TTS text for user-facing progress, findings, and final answers/u);
  assert.match(voiceAgentProtocolPrompt, /command: commands, paths, URLs, flags, stack traces, logs/u);
  assert.match(voiceAgentProtocolPrompt, /display only, never spoken/u);
  assert.match(voiceAgentProtocolPrompt, /status: silent UI state/u);
  assert.match(voiceAgentProtocolPrompt, /Use the configured response language/u);
  assert.match(voiceAgentProtocolPrompt, /Do not write raw plain text outside NDJSON/u);
  assert.match(voiceAgentProtocolPrompt, /Never dump raw HTML, fetched pages, JSON blobs, crawl output, or long logs to stdout/u);
  assert.doesNotMatch(voiceAgentProtocolPrompt, /Popup channel/u);
  assert.match(voiceAgentProtocolPromptForSettings({ popupPreferred: true }), /Popup channel/u);
  assert.match(voiceAgentProtocolPromptForSettings({ popupPreferred: true }), /at most one popup event per assistant answer/u);
  assert.match(voiceAgentProtocolPromptForSettings({ popupPreferred: true }), /MUST use a popup/u);
  assert.match(voiceAgentProtocolPromptForSettings({ popupPreferred: true }), /lecture\/video summaries/u);
  assert.match(voiceAgentProtocolPromptForSettings({ popupPreferred: true }), /exactly one short speech final summary/u);
  assert.match(voiceAgentProtocolPromptForSettings({ popupPreferred: true }), /KaTeX/u);
  assert.match(voiceAgentProtocolPromptForSettings({ popupPreferred: true }), /\$\.\.\.\$/u);
  assert.match(voiceAgentProtocolPromptForSettings({ popupPreferred: true }), /\$\$\.\.\.\$\$/u);
  assert.match(voiceAgentProtocolPromptForSettings({ popupPreferred: true }), /standard links with short labels/u);
  assert.match(voiceAgentProtocolPromptForSettings({ popupPreferred: true }), /Never include line breaks, bullets, quotes, or trailing punctuation inside Markdown link URLs/u);
  assert.match(voiceAgentProtocolPromptForSettings({ popupPreferred: true }), /never leave Markdown fragments outside the JSON object/u);
});

test("visual popup preference updates backend protocol prompt and persists", async () => {
  const backend = new InMemoryAgentBackend();
  const visualBridge = new FakeVisualBridge();
  const settingsPersistence = new FakeSettingsPersistence();
  const harness = createPassthroughHarness(backend, [], visualBridge, undefined, undefined, {
    settingsPersistence
  });

  await harness.start();
  assert.equal(backend.protocolPrompts.at(-1)?.includes("Popup channel"), false);

  visualBridge.emitVisualControl({
    popupPreferred: true
  });
  await flushAsync();

  assert.equal(backend.protocolPrompts.at(-1)?.includes("Popup channel"), true);
  assert.deepEqual(settingsPersistence.updates.at(-1), {
    visual: {
      thinkingVolume: 0.32,
      responseLanguage: "auto",
      reactionMode: "audio_circle",
      chatHistoryEnabled: true,
      hudEnabled: true,
      hudCompact: false,
      popupPreferred: true,
      popupFontSize: 14,
      screenDescribePrompt: defaultScreenDescribePrompt(),
      screenCaptureDirectory: defaultScreenCaptureDirectory,
      appShotHotkey: defaultAppShotHotkey,
      appShotAutoSend: true,
      speakWakeRejectedWarnings: true,
      maxUtteranceSeconds: 15
    }
  });
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

test("pass-through popup opens once per turn and is not spoken", async () => {
  const backend = new InMemoryAgentBackend();
  const lines: string[] = [];
  const visualBridge = new FakeVisualBridge();
  const voiceOutput = new StoppableVoiceOutput();
  const harness = createPassthroughHarness(backend, lines, visualBridge, undefined, voiceOutput, {
    visualConfig: {
      popupPreferred: true
    }
  });

  await harness.start();
  await harness.processLine("코덱스 설명해줘");
  backend.emitOutput({
    sessionId: "sess_1",
    type: "stdout",
    text:
      '{"op":"voice-agent","type":"popup","title":"정리","text":"# 긴 설명\\n본문입니다."}\n' +
      '{"op":"voice-agent","type":"popup","title":"두번째","text":"두 번째 본문"}\n' +
      '{"op":"voice-agent","type":"speech","role":"final","text":"팝업으로 열었습니다."}\n',
    timestamp: 1000
  });
  await flushAsync();

  const popupEvents = visualBridge.events.filter((event) => event.type === "popup");
  assert.equal(popupEvents.length, 1);
  assert.equal(popupEvents[0].op, "voice-agent-ui");
  assert.equal(popupEvents[0].type, "popup");
  assert.match(popupEvents[0].id ?? "", /^popup_/u);
  assert.equal(popupEvents[0].title, "정리");
  assert.equal(popupEvents[0].text, "# 긴 설명\n본문입니다.");
  assert.equal(popupEvents[0].format, "markdown");
  const history = visualBridge.events.find((event) => event.type === "popup_history");
  assert.equal(history?.entries.length, 1);
  assert.equal(history?.entries[0]?.title, "정리");
  assert.equal(history?.entries[0]?.text, "# 긴 설명\n본문입니다.");
  assert.equal(lines.some((line) => line.includes("[agent:popup] 정리")), true);
  assert.equal(lines.some((line) => line.includes("duplicate popup")), true);
  assert.deepEqual(voiceOutput.messages.map((message) => message.text), ["팝업으로 열었습니다."]);
});

test("pass-through popup buffers long split voice-agent JSON until complete", async () => {
  const backend = new InMemoryAgentBackend();
  const lines: string[] = [];
  const visualBridge = new FakeVisualBridge();
  const harness = createPassthroughHarness(backend, lines, visualBridge, undefined, undefined, {
    visualConfig: {
      popupPreferred: true
    }
  });

  await harness.start();
  await harness.processLine("코덱스 긴 수식 설명해줘");
  const popupJson = JSON.stringify({
    op: "voice-agent",
    type: "popup",
    title: "긴 수식",
    text: `# 수식\n\n${"긴 설명입니다. ".repeat(300)}\n\n$$x^2 + y^2 = z^2$$`
  });
  const splitIndex = 2_500;
  backend.emitOutput({
    sessionId: "sess_1",
    type: "stdout",
    text: popupJson.slice(0, splitIndex),
    timestamp: 1000
  });
  await flushAsync();

  assert.equal(visualBridge.events.some((event) => event.type === "popup"), false);
  assert.equal(lines.some((line) => line.includes("[agent:stdout]")), false);

  backend.emitOutput({
    sessionId: "sess_1",
    type: "stdout",
    text: `${popupJson.slice(splitIndex)}\n`,
    timestamp: 1000
  });
  await flushAsync();

  const popup = visualBridge.events.find((event) => event.type === "popup");
  assert.equal(popup?.title, "긴 수식");
  assert.match(popup?.text ?? "", /\$\$x\^2 \+ y\^2 = z\^2\$\$/u);
  assert.equal(lines.some((line) => line.includes("[agent:popup] 긴 수식")), true);
});

test("recent popup slash commands list and reopen popup answers", async () => {
  const backend = new InMemoryAgentBackend();
  const lines: string[] = [];
  const visualBridge = new FakeVisualBridge();
  const harness = createPassthroughHarness(backend, lines, visualBridge, undefined, undefined, {
    visualConfig: {
      popupPreferred: true
    }
  });

  await harness.start();
  await harness.processLine("코덱스 설명해줘");
  backend.emitOutput({
    sessionId: "sess_1",
    type: "stdout",
    text: '{"op":"voice-agent","type":"popup","title":"수식","text":"$$x^2$$"}\n',
    timestamp: 1000
  });
  await flushAsync();

  await harness.processLine("/popups");
  await harness.processLine("/popup 1");

  assert.equal(lines.some((line) => line.includes("Recent popups:")), true);
  assert.equal(lines.some((line) => line.includes("/popup 1")), true);
  assert.equal(lines.some((line) => line.includes("[popup:1] 수식\n$$x^2$$")), true);
  assert.equal(visualBridge.events.filter((event) => event.type === "popup").length, 2);
});

test("pass-through visual history restores and persists by Codex thread id", async () => {
  const backend = new InMemoryAgentBackend();
  const visualBridge = new FakeVisualBridge();
  const historyPersistence = new FakeSessionHistoryPersistence();
  historyPersistence.snapshots.set("thread_1", {
    chatHistory: [{
      role: "user",
      kind: "question",
      text: "이전 질문",
      createdAt: 900
    }],
    popups: [{
      id: "popup_old",
      title: "이전 팝업",
      text: "이전 본문",
      format: "markdown",
      createdAt: 900
    }]
  });
  const harness = createPassthroughHarness(backend, [], visualBridge, undefined, undefined, {
    codexThreadId: "thread_1",
    sessionHistoryPersistence: historyPersistence,
    visualConfig: {
      popupPreferred: true
    }
  });

  await harness.start();
  await flushAsync();

  const restoredChat = visualBridge.events.find((event) => event.type === "chat_history");
  assert.equal(restoredChat?.type, "chat_history");
  assert.equal(restoredChat?.entries[0]?.text, "이전 질문");
  const restoredPopups = visualBridge.events.find((event) => event.type === "popup_history");
  assert.equal(restoredPopups?.type, "popup_history");
  assert.equal(restoredPopups?.entries[0]?.title, "이전 팝업");

  await harness.processLine("코덱스 새 질문");
  backend.emitOutput({
    sessionId: "sess_1",
    type: "stdout",
    text: '{"op":"voice-agent","type":"popup","title":"새 팝업","text":"새 본문"}\n',
    timestamp: 1000
  });
  await flushAsync();

  const saved = historyPersistence.saves.at(-1);
  assert.equal(saved?.threadId, "thread_1");
  assert.equal(saved?.snapshot.popups[0]?.title, "새 팝업");
  assert.equal(saved?.snapshot.chatHistory.some((entry) => entry.text === "새 질문"), true);
});

test("pass-through visual chat history preserves command/status but filters wake noise", async () => {
  const backend = new InMemoryAgentBackend();
  const visualBridge = new FakeVisualBridge();
  const harness = createPassthroughHarness(backend, [], visualBridge, undefined, undefined, {
    visualConfig: {
      popupPreferred: true
    }
  });

  await harness.start();
  await harness.processLine("코덱스 최근 기록 테스트");
  backend.emitOutput({
    sessionId: "sess_1",
    type: "stdout",
    text:
      '{"op":"voice-agent","type":"command","text":"npm test"}\n' +
      '{"op":"voice-agent","type":"status","text":"working"}\n' +
      '{"op":"voice-agent","type":"status","text":"Hello","transient":true}\n' +
      '{"op":"voice-agent","type":"status","text":"wake 명령어를 확인해 주세요."}\n' +
      '{"op":"voice-agent","type":"speech","text":"일반 답변입니다.","role":"final"}\n' +
      '{"op":"voice-agent","type":"popup","title":"자세한 답변","text":"긴 본문"}\n',
    timestamp: 1000
  });
  backend.emitPermissionRequest(backend.createPermissionRequest("git push", "sess_1", "approval_1"));
  await flushAsync();

  const historyEvents = visualBridge.events.filter((event) => event.type === "chat_history");
  const entries = historyEvents.at(-1)?.entries ?? [];
  assert.equal(entries.some((entry) => entry.role === "user" && entry.kind === "question" && entry.text === "최근 기록 테스트"), true);
  assert.equal(entries.some((entry) => entry.role === "assistant" && entry.kind === "command" && entry.text === "npm test"), true);
  assert.equal(entries.some((entry) => entry.role === "assistant" && entry.kind === "status" && entry.text === "working"), true);
  assert.equal(entries.some((entry) => entry.text === "Hello"), false);
  assert.equal(entries.some((entry) => entry.text === "wake 명령어를 확인해 주세요."), false);
  assert.equal(entries.some((entry) => entry.role === "assistant" && entry.kind === "answer" && entry.text === "일반 답변입니다."), true);
  assert.equal(entries.some((entry) => entry.role === "assistant" && entry.kind === "popup" && entry.text === "자세한 답변"), true);
  assert.equal(entries.some((entry) => entry.role === "assistant" && entry.kind === "approval"), true);
});

test("visual control can clear recent Q/A for the current session", async () => {
  const backend = new InMemoryAgentBackend();
  const visualBridge = new FakeVisualBridge();
  const harness = createPassthroughHarness(backend, [], visualBridge, undefined, undefined);

  await harness.start();
  await harness.processLine("코덱스 기록 남겨");
  await flushAsync();
  visualBridge.emitControl("clear_chat_history");
  await flushAsync();

  const historyEvents = visualBridge.events.filter((event) => event.type === "chat_history");
  assert.deepEqual(historyEvents.at(-1)?.entries, []);
});

test("pass-through popup guard resets on next turn", async () => {
  const backend = new InMemoryAgentBackend();
  const visualBridge = new FakeVisualBridge();
  const harness = createPassthroughHarness(backend, [], visualBridge, undefined, undefined, {
    visualConfig: {
      popupPreferred: true
    }
  });

  await harness.start();
  await harness.processLine("첫 질문");
  backend.emitOutput({
    sessionId: "sess_1",
    type: "stdout",
    text: '{"op":"voice-agent","type":"popup","text":"첫 팝업"}\n',
    timestamp: 1000
  });
  backend.emitOutput({
    sessionId: "sess_1",
    type: "task_complete",
    text: "Task complete",
    timestamp: 1000
  });
  await flushAsync();

  await harness.processLine("두 번째 질문");
  const secondSessionId = backend.prompts.at(-1)?.sessionId ?? "sess_2";
  backend.emitOutput({
    sessionId: secondSessionId,
    type: "stdout",
    text: '{"op":"voice-agent","type":"popup","text":"두 번째 팝업"}\n',
    timestamp: 1000
  });
  await flushAsync();

  assert.deepEqual(
    visualBridge.events
      .filter((event): event is Extract<VisualEvent, { type: "popup" }> => event.type === "popup")
      .map((event) => event.text),
    ["첫 팝업", "두 번째 팝업"]
  );
});

test("pass-through popup is ignored when popup preference is disabled", async () => {
  const backend = new InMemoryAgentBackend();
  const lines: string[] = [];
  const visualBridge = new FakeVisualBridge();
  const voiceOutput = new StoppableVoiceOutput();
  const harness = createPassthroughHarness(backend, lines, visualBridge, undefined, voiceOutput);

  await harness.start();
  await harness.processLine("코덱스 설명해줘");
  backend.emitOutput({
    sessionId: "sess_1",
    type: "stdout",
    text: '{"op":"voice-agent","type":"popup","text":"비활성 팝업"}\n',
    timestamp: 1000
  });
  await flushAsync();

  assert.equal(visualBridge.events.some((event) => event.type === "popup"), false);
  assert.equal(lines.some((line) => line.includes("popup preference disabled")), true);
  assert.equal(voiceOutput.messages.length, 0);
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

test("pass-through mode suppresses invalid JSON and mixed raw stdout by default", async () => {
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

  assert.equal(lines.some((line) => line.includes("[agent:stdout] raw before")), false);
  assert.equal(lines.some((line) => line.includes("[agent:speech] 중간 보고야.")), true);
  assert.equal(lines.some((line) => line.includes("[agent:stdout] {not-json}")), false);
  assert.equal(lines.some((line) => line.includes("[agent:stdout] raw after")), false);
  assert.equal(harness.voiceOutput.messages.some((message) => message.text === "중간 보고야."), true);
});

test("pass-through mode shows raw stdout fallback in debug mode", async () => {
  const backend = new InMemoryAgentBackend();
  const lines: string[] = [];
  const harness = createPassthroughHarness(backend, lines, undefined, undefined, undefined, {
    debug: true
  });

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
  const lines: string[] = [];
  const harness = createPassthroughHarness(backend, lines);

  await harness.start();
  await harness.processLine("코덱스 npm test 돌려줘");
  await harness.processLine("멈춰");

  assert.equal(backend.prompts[0].text, "npm test 돌려줘");
  assert.equal(backend.interrupts.length, 1);
  assert.equal(lines.includes("[voice:cue] stop \u0007"), true);
  assert.equal(lines.some((line) => line.startsWith("[voice:status]")), false);
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

  assert.deepEqual(harness.voiceOutput.messages.map((message) => message.text), []);
  assert.equal(lines.includes("[voice:cue] stop \u0007"), true);
  assert.equal(lines.some((line) => line === "[voice:status] 멈출게."), false);
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
  assert.equal(lines.includes("[voice:cue] stop \u0007"), true);
  assert.equal(lines.some((line) => line === "[voice:status] 정지했어."), false);
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

  assert.deepEqual(harness.voiceOutput.messages.map((message) => message.text), ["새 답변입니다."]);
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
  voiceOutput?: VoiceOutput & { readonly messages: VoiceMessage[] },
  options: Partial<TerminalHarnessOptions> = {}
): TerminalHarness {
  let id = 0;

  return new TerminalHarness({
    ...options,
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

  emitApprovalPhrasesControl(approvalPhrases: NonNullable<VisualControlEvent["approvalPhrases"]>): void {
    this.controlListeners.forEach((listener) =>
      listener({
        op: "voice-agent-ui",
        type: "control",
        action: "update_approval_phrases",
        approvalPhrases
      })
    );
  }

  emitStopPhrasesControl(stopPhrases: string[]): void {
    this.controlListeners.forEach((listener) =>
      listener({
        op: "voice-agent-ui",
        type: "control",
        action: "update_stop_phrases",
        stopPhrases
      })
    );
  }

  emitCodexThreadControl(codexThreadId: string, codexAlwaysStartNewThread?: boolean): void {
    this.controlListeners.forEach((listener) =>
      listener({
        op: "voice-agent-ui",
        type: "control",
        action: "update_codex_thread_id",
        codexThreadId,
        ...(codexAlwaysStartNewThread !== undefined ? { codexAlwaysStartNewThread } : {})
      })
    );
  }
}

class FakeSettingsPersistence implements VoiceSettingsPersistence {
  readonly updates: VoiceLocalSettingsOverride[] = [];
  resetCount = 0;
  gestureResetCount = 0;

  async update(overrides: VoiceLocalSettingsOverride): Promise<void> {
    this.updates.push(overrides);
  }

  async resetAll(): Promise<void> {
    this.resetCount += 1;
  }

  async resetGestureWake(): Promise<void> {
    this.gestureResetCount += 1;
  }
}

class FakeSessionHistoryPersistence implements VoiceSessionHistoryPersistence {
  readonly snapshots = new Map<string, VoiceSessionHistorySnapshot>();
  readonly saves: Array<{ threadId: string; snapshot: VoiceSessionHistorySnapshot }> = [];

  async load(threadId: string): Promise<VoiceSessionHistorySnapshot> {
    return this.snapshots.get(threadId) ?? {
      chatHistory: [],
      popups: []
    };
  }

  async save(threadId: string, snapshot: VoiceSessionHistorySnapshot): Promise<void> {
    const saved = {
      chatHistory: snapshot.chatHistory.map((entry) => ({ ...entry })),
      popups: snapshot.popups.map((entry) => ({ ...entry }))
    };
    this.snapshots.set(threadId, saved);
    this.saves.push({
      threadId,
      snapshot: saved
    });
  }
}

function isStateEvent(event: VisualEvent): event is Extract<VisualEvent, { type: "state" }> {
  return event.type === "state";
}

function lastStateEvent(events: VisualEvent[]): Extract<VisualEvent, { type: "state" }> | undefined {
  return events.findLast(isStateEvent);
}
