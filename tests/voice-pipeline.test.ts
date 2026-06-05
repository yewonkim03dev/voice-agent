import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { AudioFrame, AudioInput } from "../src/audio/AudioFrame.ts";
import { InMemoryAgentBackend, TerminalHarness } from "../src/app/harness.ts";
import { detectVoiceSetup, resolveVoiceHarnessConfig } from "../src/app/voice-config.ts";
import { AlwaysOnVoiceHarnessRunner, VoiceHarnessRunner, parseVoiceHarnessCliArgs } from "../src/app/voice-harness.ts";
import { AlwaysOnWakeGate } from "../src/listening/AlwaysOnWakeGate.ts";
import { AudioRingBuffer } from "../src/listening/AudioRingBuffer.ts";
import { EndOfSpeechDetector } from "../src/listening/EndOfSpeechDetector.ts";
import { ManualRecordingGate } from "../src/listening/ManualRecordingGate.ts";
import { RecordingController } from "../src/recorder/RecordingController.ts";
import { UtteranceRecorder } from "../src/recorder/UtteranceRecorder.ts";
import type { UtteranceAudio } from "../src/recorder/UtteranceAudio.ts";
import type { SpeechProcessor } from "../src/speech/SpeechProcessor.ts";
import { normalizeTranscriptText, type Language, type Transcript } from "../src/speech/Transcript.ts";
import { EchoGuard } from "../src/voice/EchoGuard.ts";
import type { VoiceMessage } from "../src/voice/VoiceMessage.ts";
import type { VoiceOutput } from "../src/voice/VoiceOutput.ts";
import type { VisualBridgeLike, VisualControlEvent, VisualEvent } from "../src/visual/VisualBridge.ts";

test("ManualRecordingGate opens and closes through toggle", async () => {
  const gate = new ManualRecordingGate({
    now: () => 1000
  });
  const events: string[] = [];
  gate.onOpen((event) => events.push(`open:${event.mode}:${event.timestamp}`));
  gate.onClose((event) => events.push(`close:${event.mode}:${event.timestamp}`));

  await gate.start();
  gate.toggle();
  gate.toggle();

  assert.deepEqual(events, ["open:manual:1000", "close:manual:1000"]);
});

test("RecordingController collects fake audio frames into an utterance", async () => {
  const gate = new ManualRecordingGate({
    now: () => 1000
  });
  const audioInput = new FakeAudioInput();
  const controller = new RecordingController({
    gate,
    audioInput,
    recorder: new UtteranceRecorder({
      now: () => 1100,
      createId: (prefix) => `${prefix}_1`
    }),
    now: () => 1000,
    createId: (prefix) => `${prefix}_1`
  });
  const utterances: UtteranceAudio[] = [];
  controller.onUtterance((audio) => utterances.push(audio));

  await controller.start();
  gate.toggle();
  await controller.drain();
  audioInput.emit([1, 2], 1010);
  audioInput.emit([3, 4], 1020);
  gate.toggle();
  await controller.drain();

  assert.equal(utterances.length, 1);
  assert.equal(utterances[0].sessionId, "voice_sess_1");
  assert.deepEqual([...new Uint8Array(utterances[0].data)], [1, 2, 3, 4]);
});

test("AudioRingBuffer keeps only bounded pre-roll audio", () => {
  const buffer = new AudioRingBuffer({
    maxDurationMs: 200,
    maxBytes: 16
  });

  for (let index = 0; index < 10; index += 1) {
    buffer.push(fakePcmFrame(0, index * 100, 4));
  }

  assert.ok(buffer.byteLength <= 16);
  assert.ok(buffer.durationMs <= 200);
});

test("AlwaysOnWakeGate opens on speech and closes after silence", () => {
  const gate = createTestWakeGate();
  const events: string[] = [];
  const utterances: UtteranceAudio[] = [];
  gate.onEvent((event) => events.push(event.type));
  gate.onUtterance((audio) => utterances.push(audio));

  gate.consume(fakePcmFrame(0, 900));
  gate.consume(fakePcmFrame(0.2, 1000));
  gate.consume(fakePcmFrame(0.2, 1080));
  gate.consume(fakePcmFrame(0, 1220));

  assert.deepEqual(events.filter((event) => event !== "buffer_cleanup"), ["candidate_start", "candidate_end"]);
  assert.equal(utterances.length, 1);
  assert.ok(utterances[0].data.byteLength > 0);
});

test("AlwaysOnWakeGate drops too-short speech candidates before STT", () => {
  const gate = createTestWakeGate();
  const utterances: UtteranceAudio[] = [];
  gate.onUtterance((audio) => utterances.push(audio));

  gate.consume(fakePcmFrame(0.2, 1000));
  gate.consume(fakePcmFrame(0, 1120));

  assert.equal(utterances.length, 0);
  assert.equal(gate.isCandidateOpen, false);
});

test("voice runner routes Korean STT transcript through wake pass-through", async () => {
  const { backend, runner, audioInput } = createVoiceRunner([
    {
      text: "코덱스 간단한 npm test 돌려줘",
      language: "ko"
    }
  ]);

  await runner.start();
  await recordOnce(runner, audioInput);
  await runner.drain();

  assert.equal(backend.prompts.length, 1);
  assert.equal(backend.prompts[0].text, "간단한 npm test 돌려줘");
});

test("voice runner routes English STT transcript through wake pass-through", async () => {
  const { backend, runner, audioInput } = createVoiceRunner([
    {
      text: "codex run npm test",
      language: "en"
    }
  ]);

  await runner.start();
  await recordOnce(runner, audioInput);
  await runner.drain();

  assert.equal(backend.prompts.length, 1);
  assert.equal(backend.prompts[0].text, "run npm test");
});

test("voice runner maps spoken allow and deny only while native approval is pending", async () => {
  const { backend, runner, audioInput } = createVoiceRunner([
    {
      text: "허용",
      language: "ko"
    },
    {
      text: "거부",
      language: "ko"
    }
  ]);

  await runner.start();
  backend.emitPermissionRequest(backend.createPermissionRequest("npm test", "sess_1", "approval_1"));
  await Promise.resolve();
  await recordOnce(runner, audioInput);
  await runner.drain();

  assert.equal(backend.permissions[0].decision, "allow");

  backend.emitPermissionRequest(backend.createPermissionRequest("npm test", "sess_1", "approval_2"));
  await Promise.resolve();
  await recordOnce(runner, audioInput);
  await runner.drain();

  assert.equal(backend.permissions[1].decision, "deny");
});

test("voice runner does not forward ambiguous approval speech", async () => {
  const { backend, runner, audioInput, harness } = createVoiceRunner([
    {
      text: "음 글쎄",
      language: "ko"
    }
  ]);

  await runner.start();
  backend.emitPermissionRequest(backend.createPermissionRequest("npm test", "sess_1", "approval_1"));
  await Promise.resolve();
  await recordOnce(runner, audioInput);
  await runner.drain();

  assert.equal(backend.permissions.length, 0);
  assert.equal(backend.prompts.length, 0);
  assert.equal(harness.voiceOutput.messages.at(-1)?.text, "허용인지 거부인지 다시 말해줘.");
});

test("always-on voice runner discards candidate speech without a wake phrase", async () => {
  const { backend, runner, audioInput, speechProcessor, logs } = createAlwaysOnRunner([
    {
      text: "그냥 배경 발화",
      language: "ko"
    }
  ]);

  await runner.start();
  emitCandidate(audioInput, 1000);
  await runner.drain();
  await runner.stop();

  assert.equal(speechProcessor.audio.length, 1);
  assert.equal(backend.prompts.length, 0);
  assert.ok(logs.includes("[wake:discard] no configured wake phrase matched."));
});

test("always-on voice runner routes a configured custom wake phrase", async () => {
  const { backend, runner, audioInput, speechProcessor } = createAlwaysOnRunner(
    [
      {
        text: "자비스 테스트 돌려줘",
        language: "ko"
      }
    ],
    {
      wakePhrases: ["자비스"]
    }
  );

  await runner.start();
  emitCandidate(audioInput, 1000);
  await runner.drain();
  await runner.stop();

  assert.equal(backend.prompts.length, 1);
  assert.equal(backend.prompts[0].text, "테스트 돌려줘");
  assert.equal(speechProcessor.audio[0].data.byteLength, 0);
});

test("always-on voice runner routes default Korean and English wake phrases", async () => {
  const { backend, runner, audioInput } = createAlwaysOnRunner([
    {
      text: "코덱스 테스트 돌려줘",
      language: "ko"
    },
    {
      text: "codex run npm test",
      language: "en"
    }
  ]);

  await runner.start();
  emitCandidate(audioInput, 1000);
  emitCandidate(audioInput, 2000);
  await runner.drain();
  await runner.stop();

  assert.equal(backend.prompts.length, 2);
  assert.equal(backend.prompts[0].text, "테스트 돌려줘");
  assert.equal(backend.prompts[1].text, "run npm test");
});

test("always-on voice runner manual /record fallback routes without a wake phrase", async () => {
  const { backend, runner, audioInput } = createAlwaysOnRunner([
    {
      text: "그냥 간단한 npm test 돌려줘",
      language: "ko"
    }
  ]);

  await runner.start();
  await runner.processLine("/record");
  audioInput.emitPcm(0.2, 1000);
  await runner.processLine("/record");
  await runner.drain();
  await runner.stop();

  assert.equal(backend.prompts.length, 1);
  assert.equal(backend.prompts[0].text, "그냥 간단한 npm test 돌려줘");
});

test("always-on voice runner routes approval speech while native approval is pending", async () => {
  const { backend, runner, audioInput } = createAlwaysOnRunner([
    {
      text: "허용",
      language: "ko"
    }
  ]);

  await runner.start();
  backend.emitPermissionRequest(backend.createPermissionRequest("npm test", "sess_1", "approval_1"));
  await Promise.resolve();
  emitCandidate(audioInput, 1000);
  await runner.drain();
  await runner.stop();

  assert.equal(backend.permissions.length, 1);
  assert.equal(backend.permissions[0].decision, "allow");
  assert.equal(backend.prompts.length, 0);
});

test("always-on voice runner does not forward ambiguous approval speech", async () => {
  const { backend, runner, audioInput, harness } = createAlwaysOnRunner([
    {
      text: "음 글쎄",
      language: "ko"
    }
  ]);

  await runner.start();
  backend.emitPermissionRequest(backend.createPermissionRequest("npm test", "sess_1", "approval_1"));
  await Promise.resolve();
  emitCandidate(audioInput, 1000);
  await runner.drain();
  await runner.stop();

  assert.equal(backend.permissions.length, 0);
  assert.equal(backend.prompts.length, 0);
  assert.equal(harness.voiceOutput.messages.at(-1)?.text, "허용인지 거부인지 다시 말해줘.");
});

test("always-on voice runner discards STT that matches recent TTS", async () => {
  const { backend, runner, audioInput, logs } = createAlwaysOnRunner([
    {
      text: "네 전사된 메시지는 잘 들어왔어요",
      language: "ko"
    }
  ]);

  await runner.start();
  emitAgentSpeech(backend, "네, 전사된 메시지는 잘 들어왔어요.");
  await flushAsync();
  emitCandidate(audioInput, 1000);
  await runner.drain();
  await runner.stop();

  assert.equal(backend.prompts.length, 0);
  assert.equal(logs.some((line) => line.startsWith("[echo:discarded] similarity=")), true);
});

test("always-on voice runner does not self-wake when TTS says a wake phrase", async () => {
  const { backend, runner, audioInput, logs } = createAlwaysOnRunner([
    {
      text: "코덱스 테스트가 끝났어",
      language: "ko"
    }
  ]);

  await runner.start();
  emitAgentSpeech(backend, "코덱스 테스트가 끝났어.");
  await flushAsync();
  emitCandidate(audioInput, 1000);
  await runner.drain();
  await runner.stop();

  assert.equal(backend.prompts.length, 0);
  assert.equal(logs.some((line) => line.startsWith("[echo:discarded] similarity=")), true);
});

test("always-on voice runner does not self-wake when TTS says an English wake phrase", async () => {
  const { backend, runner, audioInput, logs } = createAlwaysOnRunner(
    [
      {
        text: "Claude tests are complete",
        language: "en"
      }
    ],
    {
      wakePhrases: ["claude"]
    }
  );

  await runner.start();
  emitAgentSpeech(backend, "Claude tests are complete.");
  await flushAsync();
  emitCandidate(audioInput, 1000);
  await runner.drain();
  await runner.stop();

  assert.equal(backend.prompts.length, 0);
  assert.equal(logs.some((line) => line.startsWith("[echo:discarded] similarity=")), true);
});

test("always-on voice runner ignores wake-only speech during TTS", async () => {
  const { backend, runner, audioInput, logs } = createAlwaysOnRunner([
    {
      text: "코덱스",
      language: "ko"
    }
  ]);

  await runner.start();
  emitAgentSpeech(backend, "지금 설명하고 있어.");
  await flushAsync();
  emitCandidate(audioInput, 1000);
  await runner.drain();
  await runner.stop();

  assert.equal(backend.prompts.length, 0);
  assert.ok(logs.includes("[barge:ignored] reason=wake_only"));
});

test("always-on voice runner keeps visual speaking state while TTS is active", async () => {
  const visualBridge = new FakeVisualBridge();
  const { backend, runner, audioInput } = createAlwaysOnRunner(
    [
      {
        text: "코덱스",
        language: "ko"
      }
    ],
    {
      voiceOutput: new InspectableTestVoiceOutput(),
      visualBridge
    }
  );

  await runner.start();
  emitAgentSpeech(backend, "지금 설명하고 있어.");
  await flushAsync();
  const firstSpeakingIndex = visualBridge.events.findIndex(isSpeakingStateEvent);

  emitCandidate(audioInput, 1000);
  await runner.drain();
  await runner.stop();

  const laterStates = visualBridge.events.slice(firstSpeakingIndex + 1).filter(isStateEvent);
  assert.notEqual(firstSpeakingIndex, -1);
  assert.equal(laterStates.some((event) => event.state === "listening" || event.state === "stt_processing"), false);
  assert.equal(laterStates.some((event) => event.state === "speaking"), true);
});

test("wake-only status response marks the visual as speaking", async () => {
  const visualBridge = new FakeVisualBridge();
  const voiceOutput = new InspectableTestVoiceOutput();
  const { backend, runner, audioInput } = createAlwaysOnRunner(
    [
      {
        text: "코덱스",
        language: "ko"
      }
    ],
    {
      voiceOutput,
      visualBridge
    }
  );

  await runner.start();
  emitCandidate(audioInput, 1000);
  await runner.drain();
  await runner.stop();

  assert.equal(backend.prompts.length, 0);
  assert.equal(voiceOutput.messages.at(-1)?.text, "Codex 준비됐어.");
  assert.deepEqual(visualBridge.events.find((event) => event.type === "state" && event.state === "speaking"), {
    op: "voice-agent-ui",
    type: "state",
    state: "speaking",
    text: "Codex 준비됐어."
  });
});

test("always-on voice runner stops TTS on wake plus stop intent", async () => {
  const voiceOutput = new InspectableTestVoiceOutput();
  const { backend, runner, audioInput, logs } = createAlwaysOnRunner(
    [
      {
        text: "코덱스 멈춰",
        language: "ko"
      }
    ],
    {
      voiceOutput
    }
  );

  await runner.start();
  emitAgentSpeech(backend, "계속 설명하고 있어.");
  await flushAsync();
  emitCandidate(audioInput, 1000);
  await runner.drain();
  await runner.stop();

  assert.equal(voiceOutput.stopCount, 1);
  assert.equal(backend.prompts.length, 0);
  assert.ok(logs.includes('[barge:stop] phrase="코덱스"'));
});

test("always-on voice runner stops TTS and routes wake plus new command", async () => {
  const voiceOutput = new InspectableTestVoiceOutput();
  const { backend, runner, audioInput, logs } = createAlwaysOnRunner(
    [
      {
        text: "코덱스 npm test 다시 돌려줘",
        language: "ko"
      }
    ],
    {
      voiceOutput
    }
  );

  await runner.start();
  emitAgentSpeech(backend, "긴 설명을 하는 중이야.");
  await flushAsync();
  emitCandidate(audioInput, 1000);
  await runner.drain();
  await runner.stop();

  assert.equal(voiceOutput.stopCount, 1);
  assert.equal(backend.prompts.length, 1);
  assert.equal(backend.prompts[0].text, "npm test 다시 돌려줘");
  assert.ok(logs.includes('[barge:command] phrase="코덱스" command="npm test 다시 돌려줘"'));
});

test("always-on voice runner ignores non-wake speech during TTS", async () => {
  const visualBridge = new FakeVisualBridge();
  const { backend, runner, audioInput, logs } = createAlwaysOnRunner(
    [
      {
        text: "그냥 배경 소리",
        language: "ko"
      }
    ],
    {
      visualBridge
    }
  );

  await runner.start();
  emitAgentSpeech(backend, "응답을 읽고 있어.");
  await flushAsync();
  emitCandidate(audioInput, 1000);
  await runner.drain();

  assert.equal(backend.prompts.length, 0);
  assert.ok(logs.includes("[barge:ignored] reason=no_wake"));
  assert.equal(lastStateEvent(visualBridge.events)?.state, "idle");

  await runner.stop();
});

test("always-on voice runner keeps pending approval speech working during TTS", async () => {
  const { backend, runner, audioInput } = createAlwaysOnRunner([
    {
      text: "허용",
      language: "ko"
    }
  ]);

  await runner.start();
  emitAgentSpeech(backend, "npm test 실행 권한 필요해. 허용할까?");
  backend.emitPermissionRequest(backend.createPermissionRequest("npm test", "sess_1", "approval_1"));
  await flushAsync();
  emitCandidate(audioInput, 1000);
  await runner.drain();
  await runner.stop();

  assert.equal(backend.permissions.length, 1);
  assert.equal(backend.permissions[0].decision, "allow");
});

test("EchoGuard similarity checks stay bounded for long text", () => {
  const state = createAlwaysOnRunner([]).harness.ttsPlaybackState;
  state.recordStart({
    id: "voice_1",
    text: "테스트 출력 ".repeat(200),
    language: "ko",
    priority: "normal",
    interruptible: true,
    category: "speech"
  }, 1000);

  const guard = new EchoGuard({
    maxEditDistanceLength: 32
  });
  const startedAt = performance.now();
  const result = guard.evaluate("전혀 다른 사용자 명령", state, 1000);
  const elapsedMs = performance.now() - startedAt;

  assert.equal(result.echo, false);
  assert.ok(elapsedMs < 20);
});

test("voice harness config reports missing mic and STT capabilities", async () => {
  const resolution = await resolveVoiceHarnessConfig({
    env: {},
    cwd: "/missing"
  });

  assert.equal(resolution.config, undefined);
  assert.equal(resolution.errors.length, 2);
  assert.match(resolution.errors[0], /setup:voice/u);
  assert.match(resolution.errors[1], /setup:voice/u);
});

test("voice harness config loads user-configured wake phrases from env", async () => {
  const resolution = await resolveVoiceHarnessConfig({
    env: {
      VOICE_AGENT_RECORDER_COMMAND: "recorder",
      VOICE_AGENT_STT_COMMAND: "stt {audio}",
      VOICE_AGENT_WAKE_PHRASES: "자비스,컴퓨터"
    }
  });

  assert.equal(resolution.config?.recorderCommand, "recorder");
  assert.deepEqual(resolution.config?.wakePhrases, ["자비스", "컴퓨터"]);
});

test("voice harness config lets env wake phrases override file wake phrases", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "voice-agent-test-"));

  try {
    await writeFile(
      join(cwd, ".voice-agent.local.json"),
      JSON.stringify({
        recorderCommand: "file-recorder",
        sttCommand: "file-stt {audio}",
        sampleRate: 16_000,
        channels: 1,
        wakePhrases: ["코덱스"]
      }),
      "utf8"
    );

    const resolution = await resolveVoiceHarnessConfig({
      env: {
        VOICE_AGENT_WAKE_PHRASES: "자비스"
      },
      cwd
    });

    assert.equal(resolution.config?.recorderCommand, "file-recorder");
    assert.deepEqual(resolution.config?.wakePhrases, ["자비스"]);
  } finally {
    await rm(cwd, {
      force: true,
      recursive: true
    });
  }
});

test("voice harness config loads TTS settings from the local config file", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "voice-agent-test-"));

  try {
    await writeFile(
      join(cwd, ".voice-agent.local.json"),
      JSON.stringify({
        recorderCommand: "file-recorder",
        sttCommand: "file-stt {audio}",
        sampleRate: 16_000,
        channels: 1,
        tts: {
          enabled: true,
          provider: "macos-apple",
          voice: "Yuna",
          gender: "female",
          rate: "fast"
        }
      }),
      "utf8"
    );

    const resolution = await resolveVoiceHarnessConfig({
      env: {},
      cwd
    });

    assert.equal(resolution.config?.tts?.enabled, true);
    assert.equal(resolution.config?.tts?.provider, "macos-apple");
    assert.equal(resolution.config?.tts?.voice, "Yuna");
    assert.equal(resolution.config?.tts?.gender, "female");
    assert.equal(resolution.config?.tts?.rate, "fast");
  } finally {
    await rm(cwd, {
      force: true,
      recursive: true
    });
  }
});

test("voice harness CLI parses always-on and visual flags without forwarding them to Codex", () => {
  assert.deepEqual(parseVoiceHarnessCliArgs(["--codex", "--always-on", "--visual", "--debug", "-c", "model=\"gpt\""]), {
    alwaysOn: true,
    debug: true,
    visual: true,
    harnessArgs: ["--codex", "-c", "model=\"gpt\""]
  });
});

test("voice harness CLI parses visual provider without forwarding it to Codex", () => {
  assert.deepEqual(parseVoiceHarnessCliArgs(["--codex", "--visual", "--visual-provider", "macos-native", "-c", "model=\"gpt\""]), {
    alwaysOn: false,
    debug: false,
    visual: true,
    visualProvider: "macos-native",
    harnessArgs: ["--codex", "-c", "model=\"gpt\""]
  });
});

test("voice setup detection writes a config when recorder and STT commands exist", async () => {
  const detection = await detectVoiceSetup((command) => command === "rec" || command === "whisper-cli", {
    platform: "linux"
  });

  assert.deepEqual(detection.errors, []);
  assert.equal(detection.config?.recorderCommand, "rec -q -t raw -b 16 -e signed-integer -c 1 -r 16000 -");
  assert.equal(detection.config?.sttCommand, "whisper-cli -nt -f {audio}");
});

test("voice setup detection prefers the macOS Swift provider on Mac", async () => {
  const detection = await detectVoiceSetup((command) => command === "swift", {
    platform: "darwin"
  });

  assert.deepEqual(detection.errors, []);
  assert.equal(detection.config?.recorderCommand, "exec swift src/audio/macos-record-pcm.swift");
  assert.equal(detection.config?.sttCommand, "swift src/speech/macos-transcribe.swift {audio}");
  assert.deepEqual(detection.providerIds, ["macos-swift"]);
});

test("voice setup detection accepts custom providers for future platforms", async () => {
  const detection = await detectVoiceSetup(() => true, {
    platform: "win32",
    providers: [
      {
        id: "windows-test",
        async detect() {
          return {
            providerId: "windows-test",
            recorderCommand: "windows-recorder",
            sttCommand: "windows-stt {audio}"
          };
        }
      }
    ]
  });

  assert.deepEqual(detection.errors, []);
  assert.equal(detection.config?.recorderCommand, "windows-recorder");
  assert.equal(detection.config?.sttCommand, "windows-stt {audio}");
});

async function recordOnce(runner: VoiceHarnessRunner, audioInput: FakeAudioInput): Promise<void> {
  await runner.processLine("/record");
  audioInput.emit([1, 2, 3, 4], 1000);
  await runner.processLine("/record");
}

function emitCandidate(audioInput: FakeAudioInput, startedAt: number): void {
  audioInput.emitPcm(0, startedAt - 200);
  audioInput.emitPcm(0.2, startedAt);
  audioInput.emitPcm(0.2, startedAt + 80);
  audioInput.emitPcm(0, startedAt + 220);
}

function createVoiceRunner(transcripts: Array<{ text: string; language: Language }>): {
  backend: InMemoryAgentBackend;
  harness: TerminalHarness;
  runner: VoiceHarnessRunner;
  audioInput: FakeAudioInput;
} {
  let id = 0;
  const createId = (prefix: string): string => `${prefix}_${++id}`;
  const backend = new InMemoryAgentBackend({
    now: () => 1000
  });
  const harness = new TerminalHarness({
    backend,
    backendLabel: "codex-test",
    routingMode: "passthrough",
    agentTarget: "codex",
    now: () => 1000,
    createId
  });
  const gate = new ManualRecordingGate({
    now: () => 1000
  });
  const audioInput = new FakeAudioInput();
  const controller = new RecordingController({
    gate,
    audioInput,
    recorder: new UtteranceRecorder({
      now: () => 1000,
      createId
    }),
    now: () => 1000,
    createId
  });
  const speechProcessor = new FakeSpeechProcessor(transcripts);
  const runner = new VoiceHarnessRunner({
    terminalHarness: harness,
    gate,
    recordingController: controller,
    speechProcessor
  });

  return {
    backend,
    harness,
    runner,
    audioInput
  };
}

function createAlwaysOnRunner(
  transcripts: Array<{ text: string; language: Language }>,
  options: {
    wakePhrases?: string[];
    voiceOutput?: VoiceOutput & { readonly messages: VoiceMessage[] };
    visualBridge?: VisualBridgeLike;
  } = {}
): {
  backend: InMemoryAgentBackend;
  harness: TerminalHarness;
  runner: AlwaysOnVoiceHarnessRunner;
  audioInput: FakeAudioInput;
  speechProcessor: FakeSpeechProcessor;
  logs: string[];
} {
  let id = 0;
  const logs: string[] = [];
  const createId = (prefix: string): string => `${prefix}_${++id}`;
  const backend = new InMemoryAgentBackend({
    now: () => 1000
  });
  const harness = new TerminalHarness({
    backend,
    backendLabel: "codex-test",
    routingMode: "passthrough",
    agentTarget: "codex",
    voiceOutput: options.voiceOutput,
    visualBridge: options.visualBridge,
    now: () => 1000,
    createId
  });
  const audioInput = new FakeAudioInput();
  const speechProcessor = new FakeSpeechProcessor(transcripts);
  const runner = new AlwaysOnVoiceHarnessRunner({
    terminalHarness: harness,
    audioInput,
    wakeGate: createTestWakeGate(createId),
    speechProcessor,
    wakePhrases: options.wakePhrases ?? ["코덱스", "codex"],
    writeLine: (line) => logs.push(line),
    now: () => 1000,
    createId,
    debug: true
  });

  return {
    backend,
    harness,
    runner,
    audioInput,
    speechProcessor,
    logs
  };
}

function emitAgentSpeech(backend: InMemoryAgentBackend, text: string): void {
  backend.emitOutput({
    sessionId: "sess_1",
    type: "stdout",
    text: `${JSON.stringify({
      op: "voice-agent",
      type: "speech",
      text
    })}\n`,
    timestamp: 1000
  });
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

function createTestWakeGate(createId: (prefix: string) => string = (prefix) => `${prefix}_1`): AlwaysOnWakeGate {
  return new AlwaysOnWakeGate({
    detector: new EndOfSpeechDetector({
      speechStartRms: 0.05,
      speechStartPeak: 0.05,
      silenceRms: 0.01,
      silencePeak: 0.01,
      silenceEndMs: 100,
      minSpeechMs: 50,
      maxUtteranceMs: 2_000
    }),
    ringBuffer: new AudioRingBuffer({
      maxDurationMs: 300,
      maxBytes: 256
    }),
    recorder: new UtteranceRecorder({
      now: () => 1000,
      createId
    }),
    now: () => 1000,
    createId
  });
}

class FakeAudioInput implements AudioInput {
  private readonly listeners: Array<(frame: AudioFrame) => void> = [];
  private running = false;

  async start(): Promise<void> {
    this.running = true;
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  onFrame(callback: (frame: AudioFrame) => void): void {
    this.listeners.push(callback);
  }

  emit(bytes: number[], timestamp: number): void {
    if (!this.running) return;

    const data = new Uint8Array(bytes);
    const frame: AudioFrame = {
      timestamp,
      sampleRate: 16_000,
      channels: 1,
      format: "pcm_s16le",
      data: data.buffer
    };
    this.listeners.forEach((listener) => listener(frame));
  }

  emitPcm(amplitude: number, timestamp: number, samples = 160): void {
    if (!this.running) return;

    const frame = fakePcmFrame(amplitude, timestamp, samples);
    this.listeners.forEach((listener) => listener(frame));
  }
}

class FakeSpeechProcessor implements SpeechProcessor {
  readonly audio: UtteranceAudio[] = [];
  private readonly transcripts: Array<{ text: string; language: Language }>;

  constructor(transcripts: Array<{ text: string; language: Language }>) {
    this.transcripts = [...transcripts];
  }

  async transcribe(audio: UtteranceAudio): Promise<Transcript> {
    this.audio.push(audio);
    const next = this.transcripts.shift();
    if (!next) throw new Error("No fake transcript queued.");

    return {
      id: `tr_${audio.id}`,
      sessionId: audio.sessionId,
      text: next.text,
      normalizedText: normalizeTranscriptText(next.text),
      language: next.language,
      confidence: 0.99,
      startedAt: audio.startedAt,
      endedAt: audio.endedAt
    };
  }
}

class InspectableTestVoiceOutput implements VoiceOutput {
  readonly messages: VoiceMessage[] = [];
  private readonly finishedListeners: Array<(id: string) => void> = [];
  stopCount = 0;

  async speak(message: VoiceMessage): Promise<void> {
    this.messages.push(message);
  }

  async stop(): Promise<void> {
    this.stopCount += 1;
    const last = this.messages.at(-1);
    if (last) {
      this.finishedListeners.forEach((listener) => listener(last.id));
    }
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

function isStateEvent(event: VisualEvent): event is Extract<VisualEvent, { type: "state" }> {
  return event.type === "state";
}

function isSpeakingStateEvent(event: VisualEvent): boolean {
  return event.type === "state" && event.state === "speaking";
}

function lastStateEvent(events: VisualEvent[]): Extract<VisualEvent, { type: "state" }> | undefined {
  return events.findLast(isStateEvent);
}

function fakePcmFrame(amplitude: number, timestamp: number, samples = 160): AudioFrame {
  const data = Buffer.alloc(samples * 2);
  const sample = Math.round(Math.max(-1, Math.min(1, amplitude)) * 32767);

  for (let offset = 0; offset < data.byteLength; offset += 2) {
    data.writeInt16LE(sample, offset);
  }

  return {
    timestamp,
    sampleRate: 16_000,
    channels: 1,
    format: "pcm_s16le",
    data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
  };
}
