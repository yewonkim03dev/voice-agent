import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { InMemoryAgentBackend, TerminalHarness, parseHarnessCliArgs } from "../src/app/harness.ts";
import { parseTtsTestCliArgs } from "../src/app/tts-test.ts";
import { AlwaysOnVoiceHarnessRunner } from "../src/app/voice-harness.ts";
import type { AudioFrame, AudioInput } from "../src/audio/AudioFrame.ts";
import { AlwaysOnWakeGate } from "../src/listening/AlwaysOnWakeGate.ts";
import { AudioRingBuffer } from "../src/listening/AudioRingBuffer.ts";
import { EndOfSpeechDetector } from "../src/listening/EndOfSpeechDetector.ts";
import { UtteranceRecorder } from "../src/recorder/UtteranceRecorder.ts";
import type { UtteranceAudio } from "../src/recorder/UtteranceAudio.ts";
import type { SpeechProcessor } from "../src/speech/SpeechProcessor.ts";
import { normalizeTranscriptText, type Transcript } from "../src/speech/Transcript.ts";
import { ConsoleVoiceOutput } from "../src/voice/ConsoleVoiceOutput.ts";
import { MacosAppleTtsProvider } from "../src/voice/MacosAppleTtsProvider.ts";
import { resolveTtsConfig } from "../src/voice/TtsConfig.ts";
import type { TtsProvider, TtsSpeakRequest } from "../src/voice/TtsProvider.ts";
import { TtsVoiceOutput } from "../src/voice/TtsVoiceOutput.ts";
import { createVoiceOutput } from "../src/voice/createVoiceOutput.ts";
import type { VoiceMessage } from "../src/voice/VoiceMessage.ts";
import type { VoiceOutput } from "../src/voice/VoiceOutput.ts";

test("ConsoleVoiceOutput fallback still prints and records messages", async () => {
  const lines: string[] = [];
  const output = new ConsoleVoiceOutput({
    writeLine: (line) => lines.push(line)
  });

  await output.speak(message("허용할까?", "ko", "permission"));

  assert.equal(output.messages.length, 1);
  assert.deepEqual(lines, ["[voice:permission] 허용할까?"]);
});

test("createVoiceOutput stays silent when TTS is disabled", async () => {
  const lines: string[] = [];
  let finishedId: string | undefined;
  const output = createVoiceOutput({
    cli: {
      enabled: false
    },
    writeLine: (line) => lines.push(line),
    env: {},
    platform: "darwin"
  });
  output.onFinished((id) => {
    finishedId = id;
  });

  await output.speak(message("허용할까?", "ko", "permission"));

  assert.equal(output.messages.length, 1);
  assert.equal(finishedId, "permission_허용할까?");
  assert.deepEqual(lines, []);
  assert.equal(output.isSpeechEnabled?.(), false);
});

test("createVoiceOutput can require explicit --tts before using saved TTS settings", async () => {
  const spawns: unknown[] = [];
  const output = createVoiceOutput({
    file: {
      enabled: true,
      provider: "macos-apple",
      voiceName: "Yuna"
    },
    env: {
      VOICE_AGENT_TTS_ENABLED: "true"
    },
    platform: "darwin",
    requireExplicitCliEnable: true,
    spawnTtsProcess: (...args) => {
      spawns.push(args);
      return new FakeTtsProcess();
    }
  });

  await output.speak(message("허용할까?", "ko", "permission"));

  assert.equal(output.messages.length, 1);
  assert.equal(output.isSpeechEnabled?.(), false);
  assert.equal(spawns.length, 0);
});

test("macOS TTS provider is selected by default on macOS when TTS is enabled", () => {
  assert.deepEqual(resolveTtsConfig({
    cli: {
      enabled: true
    },
    platform: "darwin",
    env: {}
  }), {
    enabled: true,
    provider: "macos-apple",
    language: "auto",
    voiceName: undefined,
    gender: "auto",
    rate: 0.56,
    pitch: undefined,
    volume: undefined
  });
});

test("non-macOS TTS defaults to console fallback when no provider is specified", () => {
  assert.equal(resolveTtsConfig({
    cli: {
      enabled: true
    },
    platform: "linux",
    env: {}
  }).provider, "console");
});

test("TTS env config enables provider, voice, gender, and rate", () => {
  assert.deepEqual(resolveTtsConfig({
    env: {
      VOICE_AGENT_TTS_ENABLED: "true",
      VOICE_AGENT_TTS_PROVIDER: "macos-apple",
      VOICE_AGENT_TTS_VOICE: "Yuna",
      VOICE_AGENT_TTS_GENDER: "female",
      VOICE_AGENT_TTS_RATE: "normal"
    },
    platform: "darwin"
  }), {
    enabled: true,
    provider: "macos-apple",
    language: "auto",
    voiceName: "Yuna",
    gender: "female",
    rate: 0.5,
    pitch: undefined,
    volume: undefined
  });
});

test("TTS file config survives empty env and plain --tts CLI enable", () => {
  assert.deepEqual(resolveTtsConfig({
    file: {
      enabled: true,
      provider: "macos-apple",
      language: "ko",
      voiceName: "Yuna",
      gender: "female",
      rate: 0.62,
      pitch: 1.1,
      volume: 0.8
    },
    cli: {
      enabled: true
    },
    env: {},
    platform: "darwin"
  }), {
    enabled: true,
    provider: "macos-apple",
    language: "ko",
    voiceName: "Yuna",
    gender: "female",
    rate: 0.62,
    pitch: 1.1,
    volume: 0.8
  });
});

test("explicit console provider disables real TTS process usage", async () => {
  const spawns: unknown[] = [];
  const output = createVoiceOutput({
    cli: {
      enabled: true,
      provider: "console"
    },
    platform: "darwin",
    spawnTtsProcess: (...args) => {
      spawns.push(args);
      return new FakeTtsProcess();
    }
  });

  await output.speak(message("끝났어.", "ko", "completion"));

  assert.equal(output.messages.length, 1);
  assert.equal(spawns.length, 0);
});

test("TtsVoiceOutput sends Korean and English messages to the provider", async () => {
  const provider = new FakeTtsProvider();
  const output = new TtsVoiceOutput({
    provider,
    language: "auto",
    rate: 0.56
  });

  await output.speak(message("허용할까?", "ko", "permission"));
  await output.speak(message("Done.", "en", "completion"));

  assert.equal(provider.requests[0].language, "ko");
  assert.equal(provider.requests[0].text, "허용할까?");
  assert.equal(provider.requests[1].language, "en");
  assert.equal(provider.requests[1].text, "Done.");
});

test("TtsVoiceOutput applies voice, rate, gender, pitch, and volume config", async () => {
  const provider = new FakeTtsProvider();
  const output = new TtsVoiceOutput({
    provider,
    language: "ko",
    voiceName: "Yuna",
    gender: "female",
    rate: 0.61,
    pitch: 1.1,
    volume: 0.8
  });

  await output.speak(message("Hello.", "en", "status"));

  assert.deepEqual(provider.requests[0], {
    text: "Hello.",
    language: "ko",
    voiceName: "Yuna",
    gender: "female",
    rate: 0.61,
    pitch: 1.1,
    volume: 0.8
  });
});

test("TtsVoiceOutput updates runtime settings for later speech", async () => {
  const provider = new FakeTtsProvider();
  const output = new TtsVoiceOutput({
    provider,
    language: "auto",
    gender: "auto",
    rate: 0.56
  });

  output.updateSettings({
    language: "ko",
    voiceName: "Yuna",
    gender: "female",
    rate: 0.63,
    pitch: 1.08,
    volume: 0.82
  });
  await output.speak(message("Hello.", "en", "status"));

  assert.deepEqual(provider.requests[0], {
    text: "Hello.",
    language: "ko",
    voiceName: "Yuna",
    gender: "female",
    rate: 0.63,
    pitch: 1.08,
    volume: 0.82
  });
});

test("TtsVoiceOutput queues normal speech without overlap", async () => {
  const provider = new BlockingTtsProvider();
  const output = new TtsVoiceOutput({
    provider
  });

  const first = output.speak(message("첫 번째 문장.", "ko", "speech"));
  const second = output.speak(message("두 번째 문장.", "ko", "speech"));
  await flushQueuedSpeech();

  assert.equal(provider.requests.length, 1);
  assert.equal(provider.requests[0].text, "첫 번째 문장.");

  provider.finishNext();
  await flushQueuedSpeech();
  assert.equal(provider.requests.length, 2);
  assert.equal(provider.requests[1].text, "두 번째 문장.");

  provider.finishNext();
  await Promise.all([first, second]);
});

test("TtsVoiceOutput chunks long structured speech", async () => {
  const provider = new FakeTtsProvider();
  const output = new TtsVoiceOutput({
    provider,
    maxChunkLength: 18
  });

  await output.speak(message("첫 번째 문장을 말하고. 두 번째 문장을 이어서 말해.", "ko", "speech"));

  assert.equal(provider.requests.length > 1, true);
  assert.equal(provider.requests.every((request) => request.text.length <= 18), true);
});

test("MacosAppleTtsProvider passes helper args without shelling user text", async () => {
  const spawns: Array<{ command: string; args: string[] }> = [];
  const provider = new MacosAppleTtsProvider({
    helperPath: "src/voice/macos-speak.swift",
    spawnProcess(command, args) {
      spawns.push({
        command,
        args
      });
      const child = new FakeTtsProcess();
      queueMicrotask(() => child.exit(0));
      return child;
    }
  });

  await provider.speak({
    text: "코덱스 테스트",
    language: "ko",
    voiceName: "Yuna",
    gender: "female",
    rate: 0.56
  });

  assert.equal(spawns[0].command, "swift");
  assert.deepEqual(spawns[0].args, [
    "-module-cache-path",
    "/private/tmp/voice-agent-swift-module-cache",
    "src/voice/macos-speak.swift",
    "--text",
    "코덱스 테스트",
    "--language",
    "ko",
    "--gender",
    "female",
    "--rate",
    "0.56",
    "--voice",
    "Yuna"
  ]);
});

test("harness CLI parses TTS flags without forwarding them to Codex", () => {
  assert.deepEqual(parseHarnessCliArgs([
    "--codex",
    "--tts",
    "--tts-provider",
    "macos-apple",
    "--tts-voice",
    "Yuna",
    "--tts-gender",
    "female",
    "--tts-rate",
    "fast",
    "-c",
    "model=\"gpt\""
  ], "/repo"), {
    backendMode: "codex",
    codexCommand: "codex",
    codexArgs: ["app-server", "--listen", "ws://127.0.0.1:0", "-c", "model=\"gpt\""],
    claudeCommand: "claude",
    cwd: "/repo",
    tts: {
      enabled: true,
      provider: "macos-apple",
      voiceName: "Yuna",
      gender: "female",
      rate: 0.56
    }
  });
});

test("TTS smoke CLI defaults to Korean and English sample speech", () => {
  assert.deepEqual(parseTtsTestCliArgs([]), {
    tts: {
      enabled: true
    },
    texts: [
      {
        language: "ko",
        text: "코덱스 음성 출력 테스트야."
      },
      {
        language: "en",
        text: "Codex text to speech test complete."
      }
    ],
    listVoices: false
  });
});

test("TTS smoke CLI parses voice flags and language samples", () => {
  assert.deepEqual(parseTtsTestCliArgs([
    "--provider",
    "console",
    "--voice",
    "Yuna",
    "--gender",
    "female",
    "--rate",
    "slow",
    "--language",
    "ko",
    "--pitch",
    "1.1",
    "--volume",
    "0.8",
    "--ko",
    "안녕",
    "hello"
  ]), {
    tts: {
      enabled: true,
      provider: "console",
      voiceName: "Yuna",
      gender: "female",
      rate: 0.42,
      language: "ko",
      pitch: 1.1,
      volume: 0.8
    },
    texts: [
      {
        language: "ko",
        text: "안녕"
      },
      {
        language: "en",
        text: "hello"
      }
    ],
    listVoices: false
  });
});

test("TTS smoke CLI can request voice listing without sample text", () => {
  assert.deepEqual(parseTtsTestCliArgs(["--list-voices"]), {
    tts: {
      enabled: true
    },
    texts: [],
    listVoices: true
  });
});

test("long agent stdout is not spoken raw while completion is spoken", async () => {
  const backend = new InMemoryAgentBackend();
  const provider = new FakeTtsProvider();
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
  const longOutput = "테스트 출력 ".repeat(80);

  await harness.start();
  backend.emitOutput({
    sessionId: "sess_1",
    type: "stdout",
    text: longOutput,
    timestamp: 1000
  });
  backend.emitOutput({
    sessionId: "sess_1",
    type: "task_complete",
    text: "Task complete",
    timestamp: 1000
  });
  await flushQueuedSpeech();

  assert.equal(provider.requests.some((request) => request.text.includes(longOutput.slice(0, 40))), false);
  assert.equal(provider.requests.at(-1)?.text, "끝났어.");
});

test("permission prompts are spoken through TTS", async () => {
  const backend = new InMemoryAgentBackend();
  const provider = new FakeTtsProvider();
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
  backend.emitPermissionRequest(backend.createPermissionRequest("npm test", "sess_1", "approval_1"));
  await flushQueuedSpeech();

  assert.equal(provider.requests.at(-1)?.text, "명령 실행 권한 필요해. 허용할까?");
});

test("TTS is not interrupted when always-on wake candidate starts", async () => {
  const voiceOutput = new FakeInspectableVoiceOutput();
  const harness = new TerminalHarness({
    backend: new InMemoryAgentBackend(),
    backendLabel: "codex-test",
    routingMode: "passthrough",
    agentTarget: "codex",
    voiceOutput,
    now: () => 1000,
    createId: createTestId()
  });
  const audioInput = new FakeAudioInput();
  const runner = new AlwaysOnVoiceHarnessRunner({
    terminalHarness: harness,
    audioInput,
    wakeGate: createTestWakeGate(),
    speechProcessor: new FakeSpeechProcessor(),
    wakePhrases: ["코덱스"],
    now: () => 1000,
    createId: createTestId()
  });

  await runner.start();
  audioInput.emitPcm(0.2, 1000);

  assert.equal(voiceOutput.stopCount, 0);
});

function message(
  text: string,
  language: VoiceMessage["language"],
  category: VoiceMessage["category"]
): VoiceMessage {
  return {
    id: `${category}_${text}`,
    text,
    language,
    priority: category === "permission" ? "urgent" : "normal",
    interruptible: category !== "permission",
    category
  };
}

function createTestId(): (prefix: string) => string {
  let id = 0;
  return (prefix) => `${prefix}_${++id}`;
}

class FakeTtsProvider implements TtsProvider {
  readonly name = "macos-apple" as const;
  readonly requests: TtsSpeakRequest[] = [];
  stopCount = 0;

  async speak(request: TtsSpeakRequest): Promise<void> {
    this.requests.push(request);
  }

  async stop(): Promise<void> {
    this.stopCount += 1;
  }
}

class BlockingTtsProvider implements TtsProvider {
  readonly name = "macos-apple" as const;
  readonly requests: TtsSpeakRequest[] = [];
  private readonly resolvers: Array<() => void> = [];

  async speak(request: TtsSpeakRequest): Promise<void> {
    this.requests.push(request);
    await new Promise<void>((resolve) => {
      this.resolvers.push(resolve);
    });
  }

  async stop(): Promise<void> {
    this.finishNext();
  }

  finishNext(): void {
    this.resolvers.shift()?.();
  }
}

class FakeTtsProcess extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();

  kill(_signal?: NodeJS.Signals): boolean {
    this.exit(null, "SIGTERM");
    return true;
  }

  exit(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.emit("exit", code, signal);
  }
}

class FakeInspectableVoiceOutput implements VoiceOutput {
  readonly messages: VoiceMessage[] = [];
  stopCount = 0;

  async speak(message: VoiceMessage): Promise<void> {
    this.messages.push(message);
  }

  async stop(): Promise<void> {
    this.stopCount += 1;
  }

  onFinished(_callback: (id: string) => void): void {}
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

  emitPcm(amplitude: number, timestamp: number, samples = 160): void {
    if (!this.running) return;

    const data = Buffer.alloc(samples * 2);
    const sample = Math.round(Math.max(-1, Math.min(1, amplitude)) * 32767);
    for (let offset = 0; offset < data.byteLength; offset += 2) {
      data.writeInt16LE(sample, offset);
    }
    const frame: AudioFrame = {
      timestamp,
      sampleRate: 16_000,
      channels: 1,
      format: "pcm_s16le",
      data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
    };
    this.listeners.forEach((listener) => listener(frame));
  }
}

class FakeSpeechProcessor implements SpeechProcessor {
  async transcribe(audio: UtteranceAudio): Promise<Transcript> {
    return {
      id: `tr_${audio.id}`,
      sessionId: audio.sessionId,
      text: "코덱스 테스트",
      normalizedText: normalizeTranscriptText("코덱스 테스트"),
      language: "ko",
      confidence: 0.99,
      startedAt: audio.startedAt,
      endedAt: audio.endedAt
    };
  }
}

function createTestWakeGate(): AlwaysOnWakeGate {
  return new AlwaysOnWakeGate({
    detector: new EndOfSpeechDetector({
      speechStartRms: 0.05,
      speechStartPeak: 0.05,
      silenceRms: 0.01,
      silencePeak: 0.01,
      silenceEndMs: 100,
      minSpeechMs: 50
    }),
    ringBuffer: new AudioRingBuffer({
      maxDurationMs: 300,
      maxBytes: 256
    }),
    recorder: new UtteranceRecorder({
      now: () => 1000,
      createId: createTestId()
    }),
    now: () => 1000,
    createId: createTestId()
  });
}

async function flushQueuedSpeech(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}
