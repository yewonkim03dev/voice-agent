import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { AudioFrame, AudioInput, AudioInputStatusEvent } from "../src/audio/AudioFrame.ts";
import { InMemoryAgentBackend, TerminalHarness } from "../src/app/harness.ts";
import {
  createCodexThreadStore,
  readCodexThreadId,
  readCodexThreadSettings,
  writeCodexThreadId
} from "../src/app/codex-thread-config.ts";
import {
  VoiceLocalSettingsStore,
  detectVoiceSetup,
  resolveVoiceHarnessConfig,
  writeVoiceConfigFile
} from "../src/app/voice-config.ts";
import {
  AlwaysOnVoiceHarnessRunner,
  VoiceHarnessRunner,
  parseVoiceHarnessCliArgs,
  shouldWriteDefaultVoiceHarnessLine
} from "../src/app/voice-harness.ts";
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
import type { VisualBridgeLike, VisualControlEvent, VisualEvent, VisualRuntimeSettings } from "../src/visual/VisualBridge.ts";
import { CommandWakeStreamDetector, type SpawnWakeStreamProcess } from "../src/wake/CommandWakeStreamDetector.ts";
import { defaultWakePhrases } from "../src/wake/WakePhraseRouter.ts";
import type { WakeStreamDetector, WakeStreamEvent } from "../src/wake/WakeStreamDetector.ts";

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

test("voice runner appends /add text to the next manual STT transcript", async () => {
  const { backend, runner, audioInput } = createVoiceRunner([
    {
      text: "코덱스 테스트 돌려줘",
      language: "ko"
    }
  ]);

  await runner.start();
  await runner.processLine("/add 파일은 src/app/voice-harness.ts야");

  assert.equal(backend.prompts.length, 0);

  await recordOnce(runner, audioInput);
  await runner.drain();

  assert.equal(backend.prompts.length, 1);
  assert.equal(backend.prompts[0].text, "테스트 돌려줘\n\n추가 정보:\n- 파일은 src/app/voice-harness.ts야");
});

test("voice runner lists queued /add references", async () => {
  const lines: string[] = [];
  const { runner } = createVoiceRunner([
    {
      text: "코덱스 테스트 돌려줘",
      language: "ko"
    }
  ], {
    writeLine: (line) => lines.push(line)
  });

  await runner.start();
  await runner.processLine("/add 파일은 src/app/voice-harness.ts야");
  await runner.processLine("/refs");

  assert.ok(lines.includes("[voice:context] queued references:\n1. 파일은 src/app/voice-harness.ts야"));
});

test("voice runner routes plain typed text immediately", async () => {
  const { backend, runner } = createVoiceRunner([]);

  await runner.start();
  await runner.processLine("그냥 지금 상태 알려줘");

  assert.equal(backend.prompts.length, 1);
  assert.equal(backend.prompts[0].text, "그냥 지금 상태 알려줘");
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
  const visualBridge = new FakeVisualBridge();
  const voiceOutput = new AutoFinishVoiceOutput();
  const { backend, runner, audioInput, speechProcessor, logs } = createAlwaysOnRunner(
    [
      {
        text: "그냥 배경 발화",
        language: "ko"
      }
    ],
    {
      visualBridge,
      voiceOutput
    }
  );

  await runner.start();
  emitCandidate(audioInput, 1000);
  await runner.drain();
  await runner.stop();

  assert.equal(speechProcessor.audio.length, 1);
  assert.equal(backend.prompts.length, 0);
  assert.ok(logs.includes("[wake:discard] no configured wake phrase matched."));
  assert.equal(voiceOutput.messages.at(-1)?.text, "wake 명령어를 확인해 주세요.");
  const rejected = visualBridge.events.find((event) => event.type === "state" && event.state === "wake_rejected");
  assert.equal(rejected?.op, "voice-agent-ui");
  assert.equal(rejected?.type, "state");
  assert.equal(rejected?.state, "wake_rejected");
  assert.match(rejected?.text ?? "", /wake 명령어를 확인해 주세요/u);
  assert.match(rejected?.text ?? "", /코덱스/u);
  assert.match(rejected?.text ?? "", /hey jarvis/u);
});

test("always-on voice runner can disable wake rejected TTS while keeping visual feedback", async () => {
  const visualBridge = new FakeVisualBridge();
  const voiceOutput = new AutoFinishVoiceOutput();
  const { backend, runner, audioInput } = createAlwaysOnRunner(
    [
      {
        text: "그냥 배경 발화",
        language: "ko"
      }
    ],
    {
      visualBridge,
      voiceOutput
    }
  );

  await runner.start();
  visualBridge.emitVisualControl({
    speakWakeRejectedWarnings: false
  });
  await flushAsync();
  emitCandidate(audioInput, 1000);
  await runner.drain();
  await runner.stop();

  assert.equal(backend.prompts.length, 0);
  assert.equal(voiceOutput.messages.some((message) => message.text === "wake 명령어를 확인해 주세요."), false);
  const rejected = visualBridge.events.find((event) => event.type === "state" && event.state === "wake_rejected");
  assert.match(rejected?.text ?? "", /wake 명령어를 확인해 주세요/u);
});

test("always-on voice runner applies visual max utterance seconds to wake candidates", async () => {
  const visualBridge = new FakeVisualBridge();
  const { backend, runner, audioInput, logs } = createAlwaysOnRunner(
    [
      {
        text: "코덱스 긴 명령 처리해줘",
        language: "ko"
      }
    ],
    {
      visualBridge
    }
  );

  await runner.start();
  visualBridge.emitVisualControl({
    maxUtteranceSeconds: 5
  });
  await flushAsync();
  emitLongCandidate(audioInput, 1000, 6200);
  await runner.drain();
  await runner.stop();

  assert.equal(backend.prompts.length, 1);
  assert.ok(logs.includes("[wake:candidate] end reason=max_duration speechDurationMs=5200"));
});

test("always-on voice runner toggles microphone from terminal command", async () => {
  const visualBridge = new FakeVisualBridge();
  const { backend, runner, audioInput, speechProcessor, logs } = createAlwaysOnRunner(
    [
      {
        text: "코덱스 테스트 돌려줘",
        language: "ko"
      }
    ],
    {
      visualBridge
    }
  );

  await runner.start();
  await runner.processLine("/mic");
  emitCandidate(audioInput, 1000);
  await runner.drain();

  assert.equal(speechProcessor.audio.length, 0);
  assert.equal(backend.prompts.length, 0);
  assert.ok(logs.includes("[voice:mic] off"));
  assert.equal(lastStateEvent(visualBridge.events)?.text, "microphone off");
  assert.equal(
    visualBridge.events
      .filter((event): event is Extract<VisualEvent, { type: "settings" }> => event.type === "settings" && event.micEnabled !== undefined)
      .at(-1)?.micEnabled,
    false
  );

  await runner.processLine("/mic");
  assert.equal(lastStateEvent(visualBridge.events)?.text, "microphone on");
  emitCandidate(audioInput, 2000);
  await runner.drain();
  await runner.stop();

  assert.equal(speechProcessor.audio.length, 1);
  assert.equal(backend.prompts.length, 1);
  assert.equal(backend.prompts[0].text, "테스트 돌려줘");
  assert.ok(logs.includes("[voice:mic] on"));
});

test("always-on voice runner toggles microphone from visual control", async () => {
  const visualBridge = new FakeVisualBridge();
  const { backend, runner, audioInput, speechProcessor } = createAlwaysOnRunner(
    [
      {
        text: "코덱스 다시 돌려줘",
        language: "ko"
      }
    ],
    {
      visualBridge
    }
  );

  await runner.start();
  visualBridge.emitMicToggle(false);
  emitCandidate(audioInput, 1000);
  await runner.drain();
  assert.equal(speechProcessor.audio.length, 0);
  assert.equal(backend.prompts.length, 0);

  visualBridge.emitMicToggle(true);
  emitCandidate(audioInput, 2000);
  await runner.drain();
  await runner.stop();

  assert.equal(speechProcessor.audio.length, 1);
  assert.equal(backend.prompts.length, 1);
  assert.equal(backend.prompts[0].text, "다시 돌려줘");
});

test("always-on voice runner prints complete voice help", async () => {
  const { runner, logs } = createAlwaysOnRunner([]);

  await runner.start();
  await runner.processLine("/help");
  await runner.stop();

  assert.ok(logs.includes("Commands:"));
  assert.ok(logs.includes("  /record starts or stops manual recording."));
  assert.ok(logs.includes("  /mic toggles microphone listening on/off."));
  assert.ok(logs.includes("  /mic-reconnect rebuilds or restarts microphone input."));
  assert.ok(logs.includes("  /add <text> queues additional info for the next voice transcript."));
  assert.ok(logs.includes("  /refs lists queued additional info."));
});

test("always-on voice runner maps audio input recovery status to visual state", async () => {
  const visualBridge = new FakeVisualBridge();
  const { runner, audioInput, logs } = createAlwaysOnRunner([], {
    visualBridge
  });

  await runner.start();
  audioInput.emitStatus({
    status: "reconfiguring",
    timestamp: 1000,
    message: "configuration_changed"
  });
  assert.equal(lastStateEvent(visualBridge.events)?.text, "audio reconnecting");

  audioInput.emitStatus({
    status: "waiting_device",
    timestamp: 1001
  });
  assert.equal(lastStateEvent(visualBridge.events)?.text, "waiting for microphone");

  audioInput.emitStatus({
    status: "running",
    timestamp: 1002
  });
  assert.equal(lastStateEvent(visualBridge.events)?.text, "audio ready");
  await runner.stop();

  assert.ok(logs.includes("[audio:status] reconfiguring configuration_changed"));
});

test("always-on voice runner asks audio input to reconnect when mic returns during recovery", async () => {
  const { runner, audioInput } = createAlwaysOnRunner([]);

  await runner.start();
  audioInput.emitStatus({
    status: "waiting_device",
    timestamp: 1000
  });
  await runner.processLine("/mic");
  await runner.processLine("/mic");
  await runner.stop();

  assert.equal(audioInput.reconnectCount, 1);
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

test("always-on voice runner updates wake phrases from visual settings", async () => {
  const visualBridge = new FakeVisualBridge();
  const { backend, runner, audioInput, logs } = createAlwaysOnRunner(
    [
      {
        text: "컴퓨터 테스트 돌려줘",
        language: "ko"
      },
      {
        text: "코덱스 다시 돌려줘",
        language: "ko"
      }
    ],
    {
      wakePhrases: ["코덱스"],
      visualBridge
    }
  );

  await runner.start();
  visualBridge.emitControl("update_wake_phrases", undefined, ["컴퓨터"]);
  emitCandidate(audioInput, 1000);
  emitCandidate(audioInput, 2000);
  await runner.drain();
  await runner.stop();

  assert.equal(backend.prompts.length, 1);
  assert.equal(backend.prompts[0].text, "테스트 돌려줘");
  assert.deepEqual(
    visualBridge.events.filter((event): event is Extract<VisualEvent, { type: "settings" }> => event.type === "settings").at(-1)?.wakePhrases,
    ["컴퓨터"]
  );
});

test("always-on voice runner restores default wake phrases from visual settings", async () => {
  const visualBridge = new FakeVisualBridge();
  const { backend, runner, audioInput } = createAlwaysOnRunner(
    [
      {
        text: "컴퓨터 테스트 돌려줘",
        language: "ko"
      },
      {
        text: "코덱스 다시 돌려줘",
        language: "ko"
      }
    ],
    {
      wakePhrases: ["코덱스"],
      visualBridge
    }
  );

  await runner.start();
  visualBridge.emitControl("update_wake_phrases", undefined, ["컴퓨터"]);
  visualBridge.emitControl("reset_settings");
  emitCandidate(audioInput, 1000);
  emitCandidate(audioInput, 2000);
  await runner.drain();
  await runner.stop();

  assert.equal(backend.prompts.length, 1);
  assert.equal(backend.prompts[0].text, "다시 돌려줘");
  assert.deepEqual(
    visualBridge.events
      .filter((event): event is Extract<VisualEvent, { type: "settings" }> => event.type === "settings" && event.wakePhrases !== undefined)
      .at(-1)?.wakePhrases,
    ["코덱스"]
  );
});

test("always-on voice runner routes default Korean and English wake phrases", async () => {
  const visualBridge = new FakeVisualBridge();
  const { backend, runner, audioInput } = createAlwaysOnRunner(
    [
      {
        text: "코덱스 테스트 돌려줘",
        language: "ko"
      },
      {
        text: "codex run npm test",
        language: "en"
      },
      {
        text: "자비스 상태 확인해줘",
        language: "ko"
      },
      {
        text: "hey jarvis list files",
        language: "en"
      }
    ],
    {
      visualBridge
    }
  );

  await runner.start();
  emitCandidate(audioInput, 1000);
  emitCandidate(audioInput, 2000);
  emitCandidate(audioInput, 3000);
  emitCandidate(audioInput, 4000);
  await runner.drain();
  await runner.stop();

  assert.equal(backend.prompts.length, 4);
  assert.equal(backend.prompts[0].text, "테스트 돌려줘");
  assert.equal(backend.prompts[1].text, "run npm test");
  assert.equal(backend.prompts[2].text, "상태 확인해줘");
  assert.equal(backend.prompts[3].text, "list files");
  assert.equal(visualBridge.events.some((event) => event.type === "wake" && event.phrase === "코덱스"), true);
  assert.equal(visualBridge.events.some((event) => event.type === "wake" && event.phrase === "자비스"), true);
  assert.equal(visualBridge.events.some((event) => event.type === "wake" && event.phrase === "hey jarvis"), true);
  assert.equal(visualBridge.events.some((event) => event.type === "state" && event.state === "submitting"), true);
});

test("always-on voice runner routes normalized and fuzzy wake speech", async () => {
  const { backend, runner, audioInput, logs } = createAlwaysOnRunner([
    {
      text: "코 덱스 테스트 돌려줘",
      language: "ko"
    },
    {
      text: "코넥스 npm test 돌려줘",
      language: "ko"
    }
  ]);

  await runner.start();
  emitCandidate(audioInput, 1000);
  emitCandidate(audioInput, 2000);
  await runner.drain();
  await runner.stop();

  assert.equal(backend.prompts.length, 2);
  assert.equal(backend.prompts[0].text, "테스트 돌려줘");
  assert.equal(backend.prompts[1].text, "npm test 돌려줘");
  assert.ok(logs.includes('[wake:normalized] heard="코 덱스" normalized="코덱스"'));
  assert.ok(logs.includes('[wake:fuzzy] heard="코넥스" matched="코덱스" distance=1'));
});

test("always-on voice runner appends /add text to the next routed STT transcript", async () => {
  const { backend, runner, audioInput, logs } = createAlwaysOnRunner([
    {
      text: "코덱스 테스트 돌려줘",
      language: "ko"
    }
  ]);

  await runner.start();
  await runner.processLine("/add 관련 파일은 README.md야");

  assert.equal(backend.prompts.length, 0);

  emitCandidate(audioInput, 1000);
  await runner.drain();
  await runner.stop();

  assert.equal(backend.prompts.length, 1);
  assert.equal(backend.prompts[0].text, "테스트 돌려줘\n\n추가 정보:\n- 관련 파일은 README.md야");
  assert.ok(logs.includes("[voice:context] queued 1 item(s)."));
  assert.ok(logs.includes("[voice:context] applied 1 item(s)."));
});

test("always-on voice runner applies visual reference context to the next wake command", async () => {
  const visualBridge = new FakeVisualBridge();
  const { backend, runner, audioInput } = createAlwaysOnRunner(
    [
      {
        text: "코덱스 테스트 돌려줘",
        language: "ko"
      }
    ],
    {
      visualBridge
    }
  );

  await runner.start();
  visualBridge.emitControl("add_context", "/add 관련 파일은 README.md야");

  assert.equal(backend.prompts.length, 0);
  assert.deepEqual(
    visualBridge.events.filter((event): event is Extract<VisualEvent, { type: "context" }> => event.type === "context").at(-1)?.entries,
    ["관련 파일은 README.md야"]
  );

  emitCandidate(audioInput, 1000);
  await runner.drain();
  await runner.stop();

  assert.equal(backend.prompts.length, 1);
  assert.equal(backend.prompts[0].text, "테스트 돌려줘\n\n추가 정보:\n- 관련 파일은 README.md야");
  assert.deepEqual(
    visualBridge.events.filter((event): event is Extract<VisualEvent, { type: "question" }> => event.type === "question").at(-1),
    {
      op: "voice-agent-ui",
      type: "question",
      text: "테스트 돌려줘",
      references: ["관련 파일은 README.md야"]
    }
  );
  assert.deepEqual(
    visualBridge.events.filter((event): event is Extract<VisualEvent, { type: "context" }> => event.type === "context").at(-1)?.entries,
    []
  );
});

test("always-on voice runner routes visual direct go immediately", async () => {
  const visualBridge = new FakeVisualBridge();
  const { backend, runner } = createAlwaysOnRunner([], {
    visualBridge
  });

  await runner.start();
  visualBridge.emitControl("direct_go", "README 보고 요약해줘");
  await flushAsync();
  await runner.stop();

  assert.equal(backend.prompts.length, 1);
  assert.equal(backend.prompts[0].text, "README 보고 요약해줘");
  assert.deepEqual(
    visualBridge.events.filter((event): event is Extract<VisualEvent, { type: "question" }> => event.type === "question").at(-1),
    {
      op: "voice-agent-ui",
      type: "question",
      text: "README 보고 요약해줘"
    }
  );
});

test("always-on voice runner attaches queued references to visual direct go", async () => {
  const visualBridge = new FakeVisualBridge();
  const { backend, runner } = createAlwaysOnRunner([], {
    visualBridge
  });

  await runner.start();
  visualBridge.emitControl("add_context", "관련 파일은 README.md야");
  visualBridge.emitControl("direct_go", "이 기준으로 정리해줘");
  await flushAsync();
  await runner.stop();

  assert.equal(backend.prompts.length, 1);
  assert.equal(backend.prompts[0].text, "이 기준으로 정리해줘\n\n추가 정보:\n- 관련 파일은 README.md야");
  assert.deepEqual(
    visualBridge.events.filter((event): event is Extract<VisualEvent, { type: "question" }> => event.type === "question").at(-1),
    {
      op: "voice-agent-ui",
      type: "question",
      text: "이 기준으로 정리해줘",
      references: ["관련 파일은 README.md야"]
    }
  );
  assert.deepEqual(
    visualBridge.events.filter((event): event is Extract<VisualEvent, { type: "context" }> => event.type === "context").at(-1)?.entries,
    []
  );
});

test("always-on voice runner shows visual reference context list", async () => {
  const visualBridge = new FakeVisualBridge();
  const { runner } = createAlwaysOnRunner([], {
    visualBridge
  });

  await runner.start();
  visualBridge.emitControl("add_context", "관련 파일은 README.md야");
  visualBridge.emitControl("show_context");
  await flushAsync();

  assert.equal(
    visualBridge.events.some((event) =>
      event.type === "context_list" &&
      event.entries.length === 1 &&
      event.entries[0] === "관련 파일은 README.md야"
    ),
    true
  );
});

test("always-on voice runner routes plain typed text immediately", async () => {
  const { backend, runner } = createAlwaysOnRunner([]);

  await runner.start();
  await runner.processLine("그냥 지금 상태 알려줘");

  assert.equal(backend.prompts.length, 1);
  assert.equal(backend.prompts[0].text, "그냥 지금 상태 알려줘");
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

test("always-on voice runner keeps agent visual state during non-wake background speech", async () => {
  const visualBridge = new FakeVisualBridge();
  const { backend, runner, audioInput } = createAlwaysOnRunner(
    [
      {
        text: "코덱스 날씨 확인해줘",
        language: "ko"
      },
      {
        text: "옆에서 나는 소리",
        language: "ko"
      }
    ],
    {
      visualBridge
    }
  );

  await runner.start();
  emitCandidate(audioInput, 1000);
  await runner.drain();

  const eventsAfterSubmit = visualBridge.events.length;
  assert.equal(backend.prompts.length, 1);
  assert.equal(lastStateEvent(visualBridge.events)?.state, "thinking");

  emitCandidate(audioInput, 2000);
  await runner.drain();

  const laterStates = visualBridge.events.slice(eventsAfterSubmit).filter(isStateEvent);
  assert.equal(
    laterStates.some((event) => event.state === "listening" || event.state === "stt_processing" || event.state === "wake_rejected"),
    false
  );
  assert.equal(lastStateEvent(visualBridge.events)?.state, "thinking");

  await runner.stop();
});

test("streaming wake updates visual before final STT and final transcript routes codex command", async () => {
  const visualBridge = new FakeVisualBridge();
  const wakeStreamDetector = new FakeWakeStreamDetector({
    phrase: "codex",
    text: "codex",
    confidence: 0.92
  });
  const { backend, runner, audioInput, logs } = createAlwaysOnRunner(
    [
      {
        text: "codex run tests",
        language: "en"
      }
    ],
    {
      visualBridge,
      wakeStreamDetector
    }
  );

  await runner.start();
  emitCandidate(audioInput, 1000);
  await runner.drain();
  await runner.stop();

  const wakeIndex = visualBridge.events.findIndex((event) => event.type === "wake");
  const listeningIndex = visualBridge.events.findIndex((event) => event.type === "state" && event.state === "listening");
  const transcriptStatusIndex = visualBridge.events.findIndex((event) => event.type === "status" && event.text === "codex run tests");

  assert.equal(backend.prompts.length, 1);
  assert.equal(backend.prompts[0].text, "run tests");
  assert.ok(wakeIndex >= 0);
  assert.ok(listeningIndex > wakeIndex);
  assert.ok(transcriptStatusIndex > wakeIndex);
  assert.equal(visualBridge.events.filter((event) => event.type === "wake").length, 1);
  assert.equal(logs.some((line) => line.startsWith("[wake:stream] provisional")), true);
});

test("streaming wake-only opens follow-up without duplicate wake cue", async () => {
  const visualBridge = new FakeVisualBridge();
  const wakeStreamDetector = new FakeWakeStreamDetector({
    phrase: "코덱스",
    text: "코덱스"
  });
  const { backend, runner, audioInput, logs } = createAlwaysOnRunner(
    [
      {
        text: "코덱스",
        language: "ko"
      },
      {
        text: "테스트 돌려줘",
        language: "ko"
      }
    ],
    {
      visualBridge,
      wakeStreamDetector
    }
  );

  await runner.start();
  emitCandidate(audioInput, 1000);
  await runner.drain();
  emitCandidate(audioInput, 2000);
  await runner.drain();
  await runner.stop();

  assert.equal(backend.prompts.length, 1);
  assert.equal(backend.prompts[0].text, "테스트 돌려줘");
  assert.ok(logs.includes('[wake:armed] phrase="코덱스" timeoutMs=10000'));
  assert.ok(logs.includes('[wake:followup] phrase="코덱스" command="테스트 돌려줘"'));
  assert.equal(visualBridge.events.filter((event) => event.type === "wake").length, 1);
});

test("streaming wake false positive returns to idle without routing or wake rejection", async () => {
  const visualBridge = new FakeVisualBridge();
  const voiceOutput = new InspectableTestVoiceOutput();
  const wakeStreamDetector = new FakeWakeStreamDetector({
    phrase: "코덱스",
    text: "코덱스"
  });
  const { backend, runner, audioInput, logs } = createAlwaysOnRunner(
    [
      {
        text: "그냥 배경 발화",
        language: "ko"
      }
    ],
    {
      visualBridge,
      voiceOutput,
      wakeStreamDetector
    }
  );

  await runner.start();
  emitCandidate(audioInput, 1000);
  await runner.drain();
  await runner.stop();

  assert.equal(backend.prompts.length, 0);
  assert.equal(voiceOutput.messages.length, 0);
  assert.equal(logs.some((line) => line.startsWith("[wake:stream] false_positive")), true);
  assert.equal(visualBridge.events.some((event) => event.type === "state" && event.state === "wake_rejected"), false);
  assert.equal(visualBridge.events.some((event) => event.type === "state" && event.state === "idle"), true);
});

test("without streaming wake provider final-STT wake behavior is preserved", async () => {
  const visualBridge = new FakeVisualBridge();
  const { backend, runner, audioInput } = createAlwaysOnRunner(
    [
      {
        text: "코덱스 테스트 돌려줘",
        language: "ko"
      }
    ],
    {
      visualBridge
    }
  );

  await runner.start();
  emitCandidate(audioInput, 1000);
  await runner.drain();
  await runner.stop();

  assert.equal(backend.prompts.length, 1);
  assert.equal(backend.prompts[0].text, "테스트 돌려줘");
  assert.equal(visualBridge.events.filter((event) => event.type === "wake").length, 1);
});

test("wake-only response arms follow-up without speaking ready TTS", async () => {
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
  assert.equal(voiceOutput.messages.length, 0);
  assert.deepEqual(visualBridge.events.find((event) => event.type === "state" && event.state === "listening"), {
    op: "voice-agent-ui",
    type: "state",
    state: "listening"
  });
});

test("always-on voice runner routes one follow-up command after wake-only speech", async () => {
  const { backend, runner, audioInput, logs } = createAlwaysOnRunner([
    {
      text: "코덱스",
      language: "ko"
    },
    {
      text: "테스트 돌려줘",
      language: "ko"
    },
    {
      text: "이건 배경 소리야",
      language: "ko"
    }
  ]);

  await runner.start();
  emitCandidate(audioInput, 1000);
  emitCandidate(audioInput, 2000);
  emitCandidate(audioInput, 3000);
  await runner.drain();
  await runner.stop();

  assert.equal(backend.prompts.length, 1);
  assert.equal(backend.prompts[0].text, "테스트 돌려줘");
  assert.ok(logs.includes('[wake:armed] phrase="코덱스" timeoutMs=10000'));
  assert.ok(logs.includes('[wake:followup] phrase="코덱스" command="테스트 돌려줘"'));
  assert.equal(logs.filter((line) => line.startsWith("[wake:followup]")).length, 1);
});

test("always-on voice runner does not create ready TTS echo after wake-only speech", async () => {
  const voiceOutput = new InspectableTestVoiceOutput();
  const { backend, runner, audioInput, logs } = createAlwaysOnRunner(
    [
      {
        text: "코덱스",
        language: "ko"
      },
      {
        text: "npm test 돌려줘",
        language: "ko"
      }
    ],
    {
      voiceOutput
    }
  );

  await runner.start();
  emitCandidate(audioInput, 1000);
  emitCandidate(audioInput, 3000);
  await runner.drain();
  await runner.stop();

  assert.equal(backend.prompts.length, 1);
  assert.equal(backend.prompts[0].text, "npm test 돌려줘");
  assert.equal(voiceOutput.messages.length, 0);
  assert.equal(logs.some((line) => line.startsWith("[echo:discarded] similarity=")), false);
  assert.ok(logs.includes('[wake:followup] phrase="코덱스" command="npm test 돌려줘"'));
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

test("always-on voice runner interrupts active turn on wake plus stop intent", async () => {
  const voiceOutput = new InspectableTestVoiceOutput();
  const { backend, runner, audioInput, logs } = createAlwaysOnRunner(
    [
      {
        text: "코덱스 긴 작업 처리해줘",
        language: "ko"
      },
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
  emitCandidate(audioInput, 1000);
  await runner.drain();
  assert.equal(backend.prompts.length, 1);

  emitAgentSpeech(backend, "계속 처리하고 있어.");
  await flushAsync();
  emitCandidate(audioInput, 2000);
  await runner.drain();
  await runner.stop();

  assert.equal(voiceOutput.stopCount >= 1, true);
  assert.deepEqual(backend.interrupts, ["Stop requested from wake speech"]);
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

test("always-on voice runner interrupts active turn before routing wake plus new command", async () => {
  const { backend, runner, audioInput, logs } = createAlwaysOnRunner([
    {
      text: "코덱스 긴 작업 처리해줘",
      language: "ko"
    },
    {
      text: "코덱스 새 작업 시작해줘",
      language: "ko"
    }
  ]);

  await runner.start();
  emitCandidate(audioInput, 1000);
  await runner.drain();
  assert.equal(backend.prompts.length, 1);

  emitCandidate(audioInput, 2000);
  await runner.drain();
  await runner.stop();

  assert.deepEqual(backend.interrupts, ["New wake command requested"]);
  assert.deepEqual(backend.prompts.map((prompt) => prompt.text), ["긴 작업 처리해줘", "새 작업 시작해줘"]);
  assert.ok(logs.includes('[wake:matched] phrase="코덱스" command="새 작업 시작해줘"'));
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
      voiceOutput: new InspectableTestVoiceOutput(),
      visualBridge
    }
  );

  await runner.start();
  emitAgentSpeech(backend, "응답을 읽고 있어.");
  await flushAsync();
  emitCandidate(audioInput, 1000);
  await runner.drain();

  assert.equal(backend.prompts.length, 0);
  assert.equal(logs.some((line) => line.startsWith("[stt:")), false);
  assert.ok(logs.includes("[barge:ignored] reason=no_wake"));
  assert.equal(visualBridge.events.some((event) => event.type === "status" && event.text === "그냥 배경 소리"), false);
  assert.equal(lastStateEvent(visualBridge.events)?.state, "speaking");

  await runner.stop();
});

test("always-on voice runner hides no-transcript candidate errors while TTS is speaking", async () => {
  const speechProcessor = new SequenceSpeechProcessor([
    new Error("Apple Speech produced no transcript.")
  ]);
  const { backend, runner, audioInput, logs } = createAlwaysOnRunner([], {
    speechProcessor,
    voiceOutput: new InspectableTestVoiceOutput(),
    debug: false
  });

  await runner.start();
  emitAgentSpeech(backend, "응답을 읽고 있어.");
  await flushAsync();
  emitCandidate(audioInput, 1000);
  await runner.drain();
  await runner.stop();

  assert.equal(backend.prompts.length, 0);
  assert.equal(logs.some((line) => line.includes("[voice:error] Apple Speech produced no transcript.")), false);
});

test("always-on voice runner keeps thinking after recent non-wake speech during active request", async () => {
  const visualBridge = new FakeVisualBridge();
  const voiceOutput = new AutoFinishVoiceOutput();
  const { backend, runner, audioInput, logs } = createAlwaysOnRunner(
    [
      {
        text: "코덱스 원달러 환율 확인해줘",
        language: "ko"
      },
      {
        text: "원 달러",
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

  const eventsAfterSubmit = visualBridge.events.length;
  assert.equal(backend.prompts.length, 1);
  assert.equal(lastStateEvent(visualBridge.events)?.state, "thinking");

  const eventsBeforeAgentSpeech = visualBridge.events.length;
  emitAgentSpeech(backend, "원달러 환율 기준으로 원인을 확인해 볼게요.");
  await flushAsync();
  assert.equal(
    visualBridge.events
      .slice(eventsBeforeAgentSpeech)
      .some((event) => event.type === "state" && event.state === "speaking" && event.text === "원달러 환율 기준으로 원인을 확인해 볼게요."),
    true
  );
  assert.equal(lastStateEvent(visualBridge.events)?.state, "thinking");

  emitCandidate(audioInput, 2000);
  await runner.drain();

  const laterStates = visualBridge.events.slice(eventsAfterSubmit).filter(isStateEvent);
  const laterStatusTexts = visualBridge.events
    .slice(eventsAfterSubmit)
    .filter((event): event is Extract<VisualEvent, { type: "status" }> => event.type === "status")
    .map((event) => event.text);
  assert.ok(logs.includes("[barge:ignored] reason=no_wake"));
  assert.equal(laterStates.some((event) => event.state === "idle"), false);
  assert.equal(laterStatusTexts.includes("원 달러"), false);
  assert.equal(lastStateEvent(visualBridge.events)?.state, "thinking");

  await runner.stop();
});

test("always-on voice runner hides active no-transcript candidate errors in default mode", async () => {
  const speechProcessor = new SequenceSpeechProcessor([
    {
      text: "코덱스 긴 작업 처리해줘",
      language: "ko"
    },
    new Error("Apple Speech produced no transcript.")
  ]);
  const { backend, runner, audioInput, logs } = createAlwaysOnRunner([], {
    speechProcessor,
    debug: false
  });

  await runner.start();
  emitCandidate(audioInput, 1000);
  await runner.drain();
  assert.equal(backend.prompts.length, 1);

  emitCandidate(audioInput, 2000);
  await runner.drain();
  await runner.stop();

  assert.equal(logs.some((line) => line.includes("[voice:error]")), false);
});

test("always-on voice runner prints hidden STT diagnostics with debug enabled", async () => {
  const speechProcessor = new SequenceSpeechProcessor([
    {
      text: "코덱스 긴 작업 처리해줘",
      language: "ko"
    },
    new Error("Apple Speech produced no transcript.")
  ]);
  const { backend, runner, audioInput, logs } = createAlwaysOnRunner([], {
    speechProcessor,
    debug: true
  });

  await runner.start();
  emitCandidate(audioInput, 1000);
  await runner.drain();
  assert.equal(backend.prompts.length, 1);

  emitCandidate(audioInput, 2000);
  await runner.drain();
  await runner.stop();

  assert.equal(logs.some((line) => line.includes("[voice:error] Apple Speech produced no transcript.")), true);
});

test("always-on voice runner keeps pending approval speech working during TTS", async () => {
  const voiceOutput = new InspectableTestVoiceOutput();
  const { backend, runner, audioInput } = createAlwaysOnRunner(
    [
      {
        text: "허용",
        language: "ko"
      }
    ],
    {
      voiceOutput
    }
  );

  await runner.start();
  emitAgentSpeech(backend, "명령 실행 권한 필요해. 허용할까?");
  backend.emitPermissionRequest(backend.createPermissionRequest("npm test", "sess_1", "approval_1"));
  await flushAsync();
  emitCandidate(audioInput, 1000);
  await runner.drain();
  await runner.stop();

  assert.equal(backend.permissions.length, 1);
  assert.equal(backend.permissions[0].decision, "allow");
  assert.equal(voiceOutput.stopCount, 0);
});

test("always-on voice runner accepts approval after an unclear retry during permission TTS", async () => {
  const voiceOutput = new InspectableTestVoiceOutput();
  const { backend, runner, audioInput } = createAlwaysOnRunner(
    [
      {
        text: "헐",
        language: "ko"
      },
      {
        text: "허용",
        language: "ko"
      }
    ],
    {
      voiceOutput
    }
  );

  await runner.start();
  backend.emitPermissionRequest(backend.createPermissionRequest("npm test", "sess_1", "approval_1"));
  await flushAsync();

  emitCandidate(audioInput, 1000);
  await runner.drain();

  assert.equal(backend.permissions.length, 0);
  assert.equal(voiceOutput.messages.at(-1)?.text, "허용인지 거부인지 다시 말해줘.");

  emitCandidate(audioInput, 2000);
  await runner.drain();
  await runner.stop();

  assert.equal(backend.permissions.length, 1);
  assert.equal(backend.permissions[0].decision, "allow");
  assert.equal(voiceOutput.stopCount, 0);
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
      VOICE_AGENT_WAKE_STREAM_COMMAND: "partial-stt",
      VOICE_AGENT_WAKE_PHRASES: "자비스,컴퓨터"
    }
  });

  assert.equal(resolution.config?.recorderCommand, "recorder");
  assert.equal(resolution.config?.wakeStreamCommand, "partial-stt");
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

test("voice local settings store persists overrides and reset restores factory defaults", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "voice-agent-test-"));
  const configPath = ".voice-agent.local.json";

  try {
    await writeFile(
      join(cwd, configPath),
      JSON.stringify({
        recorderCommand: "file-recorder",
        sttCommand: "file-stt {audio}",
        sampleRate: 16_000,
        channels: 1,
        codex: {
          threadId: "thread_123"
        },
        visual: {
          provider: "qtqml"
        }
      }),
      "utf8"
    );

    const store = new VoiceLocalSettingsStore({
      cwd,
      configPath
    });
    await store.update({
      wakePhrases: ["자비스", "hey jarvis"],
      approvalPhrases: {
        onceApprove: ["진행"],
        deny: ["그만"],
        sessionApprove: ["오늘은 허용"]
      },
      tts: {
        enabled: true,
        language: "ko",
        voiceName: "Yuna",
        gender: "female",
        rate: 0.62,
        pitch: 1.1,
        volume: 0.8
      },
      visual: {
        thinkingVolume: 0.47,
        chatHistoryEnabled: false,
        hudEnabled: false,
        hudCompact: true,
        popupPreferred: true,
        speakWakeRejectedWarnings: false,
        maxUtteranceSeconds: 55
      },
      codexThreadId: "thread_456",
      codexAlwaysStartNewThread: true
    });

    const updated = JSON.parse(await readFile(join(cwd, configPath), "utf8")) as Record<string, unknown>;
    assert.equal(updated.recorderCommand, "file-recorder");
    assert.equal(updated.sttCommand, "file-stt {audio}");
    assert.deepEqual(updated.codex, {
      threadId: "thread_456",
      alwaysStartNewThread: true
    });
    assert.equal(await readCodexThreadId(join(cwd, configPath)), "thread_456");
    assert.deepEqual(await readCodexThreadSettings(join(cwd, configPath)), {
      threadId: "thread_456",
      alwaysStartNewThread: true
    });
    assert.deepEqual(updated.wakePhrases, ["hey jarvis", "자비스"]);
    assert.deepEqual(updated.approvalPhrases, {
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
    });
    assert.deepEqual(updated.tts, {
      enabled: true,
      language: "ko",
      voiceName: "Yuna",
      gender: "female",
      rate: 0.62,
      pitch: 1.1,
      volume: 0.8
    });
    assert.deepEqual(updated.visual, {
      provider: "qtqml",
      thinkingVolume: 0.47,
      chatHistoryEnabled: false,
      hudEnabled: false,
      hudCompact: true,
      popupPreferred: true,
      speakWakeRejectedWarnings: false,
      maxUtteranceSeconds: 55
    });

    await store.resetAll();
    const reset = JSON.parse(await readFile(join(cwd, configPath), "utf8")) as Record<string, unknown>;
    assert.equal(reset.recorderCommand, "file-recorder");
    assert.equal(reset.sttCommand, "file-stt {audio}");
    assert.deepEqual(reset.codex, {
      threadId: "thread_456"
    });
    assert.equal("wakePhrases" in reset, false);
    assert.equal("approvalPhrases" in reset, false);
    assert.equal("tts" in reset, false);
    assert.deepEqual(reset.visual, {
      provider: "qtqml"
    });

    const resolution = await resolveVoiceHarnessConfig({
      env: {},
      cwd,
      configPath
    });
    assert.deepEqual(resolution.config?.wakePhrases, defaultWakePhrases);
    assert.equal(resolution.config?.approvalPhrases, undefined);
    assert.equal(resolution.config?.tts, undefined);
  } finally {
    await rm(cwd, {
      force: true,
      recursive: true
    });
  }
});

test("codex thread store skips resume when always-start-new is enabled", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "voice-agent-test-"));
  const configPath = ".voice-agent.local.json";

  try {
    await writeFile(join(cwd, configPath), JSON.stringify({
      codex: {
        threadId: "thread_saved",
        alwaysStartNewThread: true
      }
    }), "utf8");

    const store = createCodexThreadStore({
      cwd,
      configPath
    });

    assert.equal(await store.load(), undefined);
    await store.save("thread_new");

    const settings = await readCodexThreadSettings(join(cwd, configPath));
    assert.deepEqual(settings, {
      threadId: "thread_new",
      alwaysStartNewThread: true
    });
  } finally {
    await rm(cwd, {
      force: true,
      recursive: true
    });
  }
});

test("voice setup config writes without removing stored Codex thread id", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "voice-agent-test-"));
  const configPath = join(cwd, ".voice-agent.local.json");

  try {
    await writeFile(configPath, JSON.stringify({
      codex: {
        threadId: "thread_saved"
      },
      visual: {
        provider: "auto"
      }
    }), "utf8");

    await writeVoiceConfigFile({
      recorderCommand: "recorder",
      sttCommand: "stt {audio}",
      sampleRate: 16_000,
      channels: 1,
      wakePhrases: ["코덱스"]
    }, {
      cwd,
      configPath: ".voice-agent.local.json"
    });

    const parsed = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
    assert.deepEqual(parsed.codex, {
      threadId: "thread_saved"
    });
    assert.deepEqual(parsed.visual, {
      provider: "auto"
    });
    assert.equal(parsed.recorderCommand, "recorder");
  } finally {
    await rm(cwd, {
      force: true,
      recursive: true
    });
  }
});

test("codex thread config writes without removing existing voice setup", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "voice-agent-test-"));
  const configPath = join(cwd, ".voice-agent.local.json");

  try {
    await writeFile(configPath, JSON.stringify({
      recorderCommand: "recorder",
      sttCommand: "stt {audio}",
      sampleRate: 16_000,
      channels: 1,
      wakePhrases: ["코덱스"]
    }), "utf8");

    await writeCodexThreadId(configPath, "thread_saved");

    const resolution = await resolveVoiceHarnessConfig({
      env: {},
      cwd
    });
    assert.equal(await readCodexThreadId(configPath), "thread_saved");
    assert.equal(resolution.config?.recorderCommand, "recorder");
    assert.equal(resolution.config?.sttCommand, "stt {audio}");
  } finally {
    await rm(cwd, {
      force: true,
      recursive: true
    });
  }
});

test("voice harness config ignores codex-only local config files", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "voice-agent-test-"));

  try {
    await writeFile(join(cwd, ".voice-agent.local.json"), JSON.stringify({
      codex: {
        threadId: "thread_saved"
      }
    }), "utf8");

    const resolution = await resolveVoiceHarnessConfig({
      env: {},
      cwd
    });

    assert.equal(resolution.config, undefined);
    assert.equal(resolution.errors.length, 2);
    assert.match(resolution.errors[0], /setup:voice/u);
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

test("default voice harness output keeps user-facing lines and hides diagnostics", () => {
  assert.equal(shouldWriteDefaultVoiceHarnessLine("[agent:speech] 확인했어."), true);
  assert.equal(shouldWriteDefaultVoiceHarnessLine("[stt:ko] 코덱스 날씨 확인해줘"), true);
  assert.equal(shouldWriteDefaultVoiceHarnessLine("[voice:permission] 명령 실행 권한 필요해."), true);
  assert.equal(shouldWriteDefaultVoiceHarnessLine("[voice:cue] approval ready \u0007"), true);
  assert.equal(shouldWriteDefaultVoiceHarnessLine("  Wake: 코덱스 <명령>"), true);
  assert.equal(shouldWriteDefaultVoiceHarnessLine("  /help shows available terminal commands."), true);
  assert.equal(shouldWriteDefaultVoiceHarnessLine("  /mic toggles microphone listening on/off."), true);
  assert.equal(shouldWriteDefaultVoiceHarnessLine("  /refs lists queued additional info."), true);
  assert.equal(shouldWriteDefaultVoiceHarnessLine("Type /help to show available commands."), true);
  assert.equal(shouldWriteDefaultVoiceHarnessLine("[codex-app] turn/start sess_1: 날씨 확인해줘"), false);
  assert.equal(shouldWriteDefaultVoiceHarnessLine("[wake:candidate] start preRollFrames=8 preRollBytes=32768"), false);
  assert.equal(shouldWriteDefaultVoiceHarnessLine("[audio] bytes=1024 durationMs=100 rms=0.01 peak=0.1"), false);
  assert.equal(shouldWriteDefaultVoiceHarnessLine("[stt:apple] locale=ko-KR status=start"), false);
  assert.equal(shouldWriteDefaultVoiceHarnessLine("[visual] listening on ws://127.0.0.1:1234"), false);
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
  assert.equal(detection.config?.wakeStreamCommand, "swift src/wake/macos-wake-partial.swift");
  assert.deepEqual(detection.providerIds, ["macos-swift"]);
});

test("command wake stream detector emits a provisional wake from partial output once per reset", () => {
  const process = new FakeWakeStreamProcess();
  const detector = new CommandWakeStreamDetector({
    command: "partial-wake",
    wakePhrases: ["코덱스"],
    spawnProcess: (() => process) as SpawnWakeStreamProcess,
    now: () => 1234
  });
  const events: WakeStreamEvent[] = [];
  detector.onWake((event) => events.push(event));

  detector.consume(fakePcmFrame(0.2, 1000));
  process.emitStdout('{"text":"코덱스 테스트 돌려줘","confidence":0.72,"provider":"fake-partial"}\n');
  process.emitStdout('{"text":"코덱스 테스트 다시 돌려줘","confidence":0.9,"provider":"fake-partial"}\n');

  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    phrase: "코덱스",
    text: "코덱스 테스트 돌려줘",
    provider: "fake-partial",
    timestamp: 1234,
    strategy: "exact",
    confidence: 0.72
  });
  assert.equal(process.writes.length, 1);

  detector.reset();
  process.emitStdout('{"text":"코덱스 다음 명령"}\n');

  assert.equal(events.length, 2);
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

function emitLongCandidate(audioInput: FakeAudioInput, startedAt: number, endedAt: number): void {
  audioInput.emitPcm(0, startedAt - 200);
  audioInput.emitPcm(0.2, startedAt);
  audioInput.emitPcm(0.2, startedAt + 2000);
  audioInput.emitPcm(0.2, endedAt);
}

function createVoiceRunner(
  transcripts: Array<{ text: string; language: Language }>,
  options: {
    writeLine?: (line: string) => void;
  } = {}
): {
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
    speechProcessor,
    writeLine: options.writeLine
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
    speechProcessor?: SpeechProcessor;
    wakeStreamDetector?: WakeStreamDetector;
    debug?: boolean;
  } = {}
): {
  backend: InMemoryAgentBackend;
  harness: TerminalHarness;
  runner: AlwaysOnVoiceHarnessRunner;
  audioInput: FakeAudioInput;
  speechProcessor: SpeechProcessor;
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
  const speechProcessor = options.speechProcessor ?? new FakeSpeechProcessor(transcripts);
  const runner = new AlwaysOnVoiceHarnessRunner({
    terminalHarness: harness,
    audioInput,
    wakeGate: createTestWakeGate(createId),
    wakeStreamDetector: options.wakeStreamDetector,
    speechProcessor,
    wakePhrases: options.wakePhrases ?? defaultWakePhrases,
    visualBridge: options.visualBridge,
    writeLine: (line) => logs.push(line),
    now: () => 1000,
    createId,
    debug: options.debug ?? true
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
  private readonly statusListeners: Array<(event: AudioInputStatusEvent) => void> = [];
  private running = false;
  reconnectCount = 0;

  async start(): Promise<void> {
    this.running = true;
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  onFrame(callback: (frame: AudioFrame) => void): void {
    this.listeners.push(callback);
  }

  onStatus(callback: (event: AudioInputStatusEvent) => void): void {
    this.statusListeners.push(callback);
  }

  async reconnect(): Promise<void> {
    this.reconnectCount += 1;
  }

  emitStatus(event: AudioInputStatusEvent): void {
    this.statusListeners.forEach((listener) => listener(event));
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

class SequenceSpeechProcessor implements SpeechProcessor {
  readonly audio: UtteranceAudio[] = [];
  private readonly results: Array<{ text: string; language: Language } | Error>;

  constructor(results: Array<{ text: string; language: Language } | Error>) {
    this.results = [...results];
  }

  async transcribe(audio: UtteranceAudio): Promise<Transcript> {
    this.audio.push(audio);
    const next = this.results.shift();
    if (!next) throw new Error("No fake transcript queued.");
    if (next instanceof Error) throw next;

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

class FakeWakeStreamDetector implements WakeStreamDetector {
  private readonly callbacks: Array<(event: WakeStreamEvent) => void> = [];
  private readonly event: WakeStreamEvent | undefined;
  private emitted = false;
  consumedFrames = 0;
  resets = 0;

  constructor(event?: Partial<WakeStreamEvent>) {
    this.event = event
      ? {
          phrase: event.phrase ?? "코덱스",
          text: event.text ?? event.phrase ?? "코덱스",
          provider: event.provider ?? "fake",
          timestamp: event.timestamp ?? 1000,
          strategy: event.strategy ?? "exact",
          ...(event.confidence !== undefined ? { confidence: event.confidence } : {})
        }
      : undefined;
  }

  consume(frame: AudioFrame): void {
    this.consumedFrames += 1;
    if (!this.event || this.emitted || !isSpeechFrame(frame)) return;

    this.emitted = true;
    this.callbacks.forEach((callback) =>
      callback({
        ...this.event,
        timestamp: frame.timestamp
      })
    );
  }

  reset(): void {
    this.resets += 1;
    this.emitted = false;
  }

  onWake(callback: (event: WakeStreamEvent) => void): void {
    this.callbacks.push(callback);
  }
}

class FakeWakeStreamProcess {
  readonly writes: Buffer[] = [];
  readonly stdin = new FakeProcessWritable(this.writes);
  readonly stdout = new FakeProcessReadable();
  readonly stderr = new FakeProcessReadable();
  private readonly errorListeners: Array<(error: Error) => void> = [];
  private readonly exitListeners: Array<(code: number | null, signal: NodeJS.Signals | null) => void> = [];

  kill(_signal?: NodeJS.Signals): boolean {
    this.exitListeners.forEach((listener) => listener(null, "SIGTERM"));
    return true;
  }

  on(event: "error", callback: (error: Error) => void): unknown;
  on(event: "exit", callback: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  on(event: "error" | "exit", callback: unknown): unknown {
    if (event === "error") {
      this.errorListeners.push(callback as (error: Error) => void);
    } else {
      this.exitListeners.push(callback as (code: number | null, signal: NodeJS.Signals | null) => void);
    }
  }

  emitStdout(text: string): void {
    this.stdout.emit(text);
  }
}

class FakeProcessReadable {
  private readonly listeners: Array<(chunk: Buffer | string) => void> = [];

  on(event: "data", callback: (chunk: Buffer | string) => void): unknown {
    if (event === "data") this.listeners.push(callback);
  }

  emit(text: string): void {
    this.listeners.forEach((listener) => listener(text));
  }
}

class FakeProcessWritable {
  private readonly writes: Buffer[];
  private readonly errorListeners: Array<(error: Error) => void> = [];

  constructor(writes: Buffer[]) {
    this.writes = writes;
  }

  write(chunk: Buffer): boolean {
    this.writes.push(Buffer.from(chunk));
    return true;
  }

  end(): void {}

  on(event: "error", callback: (error: Error) => void): unknown {
    if (event === "error") this.errorListeners.push(callback);
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

class AutoFinishVoiceOutput implements VoiceOutput {
  readonly messages: VoiceMessage[] = [];
  private readonly finishedListeners: Array<(id: string) => void> = [];

  async speak(message: VoiceMessage): Promise<void> {
    this.messages.push(message);
    this.finishedListeners.forEach((listener) => listener(message.id));
  }

  async stop(): Promise<void> {}

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

  emitControl(action: VisualControlEvent["action"], text?: string, wakePhrases?: string[]): void {
    this.controlListeners.forEach((listener) =>
      listener({
        op: "voice-agent-ui",
        type: "control",
        action,
        ...(text ? { text } : {}),
        ...(wakePhrases ? { wakePhrases } : {})
      })
    );
  }

  emitMicToggle(micEnabled: boolean): void {
    this.controlListeners.forEach((listener) =>
      listener({
        op: "voice-agent-ui",
        type: "control",
        action: "mic_toggle",
        micEnabled
      })
    );
  }

  emitVisualControl(visual: VisualRuntimeSettings): void {
    this.controlListeners.forEach((listener) =>
      listener({
        op: "voice-agent-ui",
        type: "control",
        action: "update_visual_settings",
        visual
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

function isSpeechFrame(frame: AudioFrame): boolean {
  if (frame.format !== "pcm_s16le" || frame.data.byteLength < 2) return frame.data.byteLength > 0;

  const view = new DataView(frame.data);
  return Math.abs(view.getInt16(0, true)) > 0;
}
