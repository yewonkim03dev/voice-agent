import assert from "node:assert/strict";
import test from "node:test";

import type { AudioFrame, AudioInput } from "../src/audio/AudioFrame.ts";
import { InMemoryAgentBackend, TerminalHarness } from "../src/app/harness.ts";
import { detectVoiceSetup, resolveVoiceHarnessConfig } from "../src/app/voice-config.ts";
import { VoiceHarnessRunner } from "../src/app/voice-harness.ts";
import { ManualRecordingGate } from "../src/listening/ManualRecordingGate.ts";
import { RecordingController } from "../src/recorder/RecordingController.ts";
import { UtteranceRecorder } from "../src/recorder/UtteranceRecorder.ts";
import type { UtteranceAudio } from "../src/recorder/UtteranceAudio.ts";
import type { SpeechProcessor } from "../src/speech/SpeechProcessor.ts";
import { normalizeTranscriptText, type Language, type Transcript } from "../src/speech/Transcript.ts";

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
}

class FakeSpeechProcessor implements SpeechProcessor {
  private readonly transcripts: Array<{ text: string; language: Language }>;

  constructor(transcripts: Array<{ text: string; language: Language }>) {
    this.transcripts = [...transcripts];
  }

  async transcribe(audio: UtteranceAudio): Promise<Transcript> {
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
