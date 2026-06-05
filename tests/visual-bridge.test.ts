import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import {
  detectVisualSetup,
  resolveVisualConfig,
  writeVisualConfigFile
} from "../src/visual/VisualConfig.ts";
import { launchVisualCompanion, parseVisualCliArgs } from "../src/visual/run-visual.ts";
import {
  parseVisualControlEvent,
  serializeVisualEvent,
  VisualBridge,
  type VisualControlEvent,
  type VisualEvent
} from "../src/visual/VisualBridge.ts";

test("visual bridge serializes UI events as JSON", () => {
  const events: VisualEvent[] = [
    {
      op: "voice-agent-ui",
      type: "wake",
      phrase: "코덱스"
    },
    {
      op: "voice-agent-ui",
      type: "status",
      text: "테스트 실행 중"
    },
    {
      op: "voice-agent-ui",
      type: "command",
      text: "npm test"
    },
    {
      op: "voice-agent-ui",
      type: "speech",
      text: "확인했어."
    },
    {
      op: "voice-agent-ui",
      type: "error",
      text: "실패했어."
    },
    {
      op: "voice-agent-ui",
      type: "context",
      entries: ["참고자료"]
    }
  ];

  assert.deepEqual(events.map((event) => JSON.parse(serializeVisualEvent(event)) as VisualEvent), events);
});

test("visual bridge parses allowed control events only", () => {
  assert.deepEqual(parseVisualControlEvent('{"op":"voice-agent-ui","type":"control","action":"tts_stop"}'), {
    op: "voice-agent-ui",
    type: "control",
    action: "tts_stop"
  });
  assert.deepEqual(parseVisualControlEvent('{"op":"voice-agent-ui","type":"control","action":"add_context","text":"README 참고"}'), {
    op: "voice-agent-ui",
    type: "control",
    action: "add_context",
    text: "README 참고"
  });
  assert.deepEqual(parseVisualControlEvent('{"op":"voice-agent-ui","type":"control","action":"emergency_stop"}'), {
    op: "voice-agent-ui",
    type: "control",
    action: "emergency_stop"
  });
  assert.deepEqual(parseVisualControlEvent('{"op":"voice-agent-ui","type":"control","action":"reset_settings"}'), {
    op: "voice-agent-ui",
    type: "control",
    action: "reset_settings"
  });
  assert.deepEqual(parseVisualControlEvent('{"op":"voice-agent-ui","type":"control","action":"update_wake_phrases","wakePhrases":["코덱스","  자비스  ",""]}'), {
    op: "voice-agent-ui",
    type: "control",
    action: "update_wake_phrases",
    wakePhrases: ["코덱스", "자비스"]
  });
  assert.deepEqual(parseVisualControlEvent('{"op":"voice-agent-ui","type":"control","action":"update_tts_settings","tts":{"language":"ko","gender":"female","rate":0.61,"pitch":1.1,"volume":0.8,"voiceName":"Yuna"}}'), {
    op: "voice-agent-ui",
    type: "control",
    action: "update_tts_settings",
    tts: {
      language: "ko",
      gender: "female",
      rate: 0.61,
      pitch: 1.1,
      volume: 0.8,
      voiceName: "Yuna"
    }
  });
  assert.equal(parseVisualControlEvent('{"op":"voice-agent-ui","type":"control","action":"run_command"}'), null);
  assert.equal(parseVisualControlEvent("not-json"), null);
});

test("visual bridge accepts websocket clients, sends events, and receives controls", async (context) => {
  const controls: VisualControlEvent[] = [];
  const bridge = new VisualBridge({
    writeLine: () => {}
  });

  bridge.onControl((event) => controls.push(event));
  let url: string;
  try {
    url = await bridge.start();
  } catch (error) {
    if (isListenPermissionError(error)) {
      context.skip("sandbox does not allow opening a localhost listener");
      return;
    }
    throw error;
  }
  const socket = await connectWebSocket(url);

  try {
    bridge.send({
      op: "voice-agent-ui",
      type: "wake",
      phrase: "코덱스"
    });
    const received = await readUntilFrame(socket);
    assert.equal(received.some((message) => message.includes('"type":"wake"')), true);

    socket.write(encodeClientFrame('{"op":"voice-agent-ui","type":"control","action":"tts_stop"}'));
    await waitFor(() => controls.some((event) => event.action === "tts_stop"));
    socket.write(encodeClientFrame('{"op":"voice-agent-ui","type":"control","action":"add_context","text":"참고"}'));
    await waitFor(() => controls.some((event) => event.action === "add_context" && event.text === "참고"));
  } finally {
    socket.destroy();
    await bridge.stop();
  }
});

test("visual launcher reports unavailable for explicit Qt provider when Qt runtime is missing", async () => {
  const lines: string[] = [];
  const result = await launchVisualCompanion({
    provider: "qtqml",
    platform: "darwin",
    commandExists: async () => false,
    writeLine: (line) => lines.push(line)
  });

  assert.equal(result.started, false);
  assert.equal(result.provider, "qtqml");
  assert.match(result.reason ?? "", /Qt\/QML/u);
  assert.equal(lines.some((line) => line.startsWith("[visual] unavailable:")), true);
  assert.equal(lines.some((line) => line.includes("brew install qt")), true);
});

test("visual launcher starts Qt runtime with the QML companion when available", async () => {
  const spawns: Array<{ command: string; args: string[] }> = [];
  const result = await launchVisualCompanion({
    url: "ws://127.0.0.1:1234",
    commandExists: async (command) => command === "qml",
    spawnProcess: ((command: string, args: string[]) => {
      spawns.push({ command, args });
      return new FakeChildProcess();
    }) as never,
    writeLine: () => {}
  });

  assert.equal(result.started, true);
  assert.equal(result.provider, "qtqml");
  assert.equal(result.command, "qml");
  assert.equal(spawns[0].command, "qml");
  assert.equal(spawns[0].args.some((arg) => arg.endsWith("visual/qt/VoiceAgent.qml")), true);
  assert.deepEqual(spawns[0].args.slice(-2), ["--url", "ws://127.0.0.1:1234"]);
});

test("visual launcher falls back to macOS native when Qt is missing", async () => {
  const lines: string[] = [];
  const spawns: Array<{ command: string; args: string[] }> = [];
  const result = await launchVisualCompanion({
    url: "ws://127.0.0.1:1234",
    platform: "darwin",
    commandExists: async (command) => command === "swift",
    spawnProcess: ((command: string, args: string[]) => {
      spawns.push({ command, args });
      return new FakeChildProcess();
    }) as never,
    writeLine: (line) => lines.push(line)
  });

  assert.equal(result.started, true);
  assert.equal(result.provider, "macos-native");
  assert.equal(spawns[0].command, "swift");
  assert.equal(spawns[0].args.some((arg) => arg.endsWith("visual/macos/VoiceAgentVisual.swift")), true);
  assert.deepEqual(spawns[0].args.slice(-2), ["--url", "ws://127.0.0.1:1234"]);
  assert.equal(lines.some((line) => line.includes("brew install qt")), true);
});

test("visual launcher parses bridge url", () => {
  assert.deepEqual(parseVisualCliArgs(["--url", "ws://127.0.0.1:1234", "--visual-provider", "qtqml"]), {
    url: "ws://127.0.0.1:1234",
    provider: "qtqml"
  });
});

test("visual setup detects Qt first and native macOS fallback", async () => {
  const qtDetection = await detectVisualSetup(async (command) => command === "qml" || command === "swift", {
    platform: "darwin"
  });
  const nativeDetection = await detectVisualSetup(async (command) => command === "swift", {
    platform: "darwin"
  });

  assert.equal(qtDetection.selectedProvider, "qtqml");
  assert.equal(qtDetection.qtCommand, "qml");
  assert.equal(nativeDetection.selectedProvider, "macos-native");
  assert.equal(nativeDetection.macosNativeCommand, "swift visual/macos/VoiceAgentVisual.swift");
  assert.equal(nativeDetection.installCommands.some((command) => command.includes("brew install qt")), true);
});

test("visual config writes provider without removing existing voice setup", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "voice-agent-visual-"));
  const configPath = ".voice-agent.local.json";
  await writeFile(join(cwd, configPath), JSON.stringify({
    recorderCommand: "recorder",
    sttCommand: "stt {audio}",
    sampleRate: 16000,
    channels: 1
  }), "utf8");

  await writeVisualConfigFile({
    provider: "auto"
  }, {
    cwd,
    configPath
  });
  const first = JSON.parse(await readFile(join(cwd, configPath), "utf8")) as Record<string, unknown>;
  assert.equal(first.recorderCommand, "recorder");
  assert.equal(first.sttCommand, "stt {audio}");
  assert.deepEqual(first.visual, {
    provider: "auto"
  });

  const resolved = await resolveVisualConfig({
    cwd,
    configPath
  });
  assert.deepEqual(resolved.config, {
    provider: "auto"
  });
});

test("Qt companion is native QML and avoids browser/webview imports", async () => {
  const qml = await readFile("visual/qt/VoiceAgent.qml", "utf8");
  const thinkingPulse = await readFile("visual/qt/thinking-pulse.wav");

  assert.match(qml, /ApplicationWindow/u);
  assert.equal(thinkingPulse.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(thinkingPulse.subarray(8, 12).toString("ascii"), "WAVE");
  assert.match(qml, /WebSocket/u);
  assert.match(qml, /Canvas/u);
  assert.match(qml, /drawWaveRing/u);
  assert.match(qml, /drawOuterTicks/u);
  assert.match(qml, /drawSpeakingWaves/u);
  assert.match(qml, /drawProcessingIndicator/u);
  assert.match(qml, /drawSubmittingIndicator/u);
  assert.match(qml, /drawThinkingIndicator/u);
  assert.match(qml, /drawRejectedIndicator/u);
  assert.match(qml, /thinkingEffect/u);
  assert.match(qml, /function isThinkingAudioState\(state\)/u);
  assert.match(qml, /running: root\.isThinkingAudioState\(root\.uiState\)/u);
  assert.match(qml, /source: Qt\.resolvedUrl\("thinking-pulse\.wav"\)/u);
  assert.match(qml, /volume: root\.thinkingVolume/u);
  assert.match(qml, /thinkingPulseTimer/u);
  assert.match(qml, /stt_processing/u);
  assert.match(qml, /submitting/u);
  assert.match(qml, /wake_rejected/u);
  assert.match(qml, /property int commandPanelHeight/u);
  assert.match(qml, /property int visualDiameter/u);
  assert.match(qml, /expandedLayout \? 720 : 360/u);
  assert.match(qml, /anchors\.centerIn: parent/u);
  assert.match(qml, /anchors\.bottom: controls\.top/u);
  assert.match(qml, /id: statusBackdrop/u);
  assert.match(qml, /root\.uiState === "speaking"/u);
  assert.match(qml, /root\.uiState === "approval_pending"/u);
  assert.match(qml, /root\.uiState === "wake_rejected"/u);
  assert.match(qml, /opacity: \(root\.uiState === "speaking" \|\| root\.uiState === "approval_pending" \|\| root\.uiState === "wake_rejected"\)/u);
  assert.match(qml, /wrapMode: Text\.WordWrap/u);
  assert.match(qml, /maximumLineCount: root\.uiState === "approval_pending" \|\| root\.uiState === "wake_rejected" \? 8 : root\.expandedLayout \? 99 : 3/u);
  assert.match(qml, /interval: 3600/u);
  assert.match(qml, /root\.statusBandHeight\(\)/u);
  assert.match(qml, /font\.bold: root\.uiState === "speaking" \|\| root\.uiState === "wake_rejected"/u);
  assert.match(qml, /Text\.ElideNone/u);
  assert.doesNotMatch(qml, /Layout\.fillHeight: true\s*\n\s*radius: 8/u);
  assert.match(qml, /TTS Stop/u);
  assert.match(qml, /STOP/u);
  assert.match(qml, /emergency_stop/u);
  assert.match(qml, /Settings/u);
  assert.match(qml, /update_tts_settings/u);
  assert.match(qml, /update_wake_phrases/u);
  assert.match(qml, /reset_settings/u);
  assert.match(qml, /Restore Defaults/u);
  assert.match(qml, /Wake phrases/u);
  assert.match(qml, /voiceGuideText/u);
  assert.match(qml, /referenceHelpText/u);
  assert.match(qml, /id: guideButton/u);
  assert.match(qml, /id: guidePopup/u);
  assert.match(qml, /id: referenceHelpPopup/u);
  assert.match(qml, /onHoveredChanged/u);
  assert.match(qml, /Thinking sound/u);
  assert.match(qml, /thinkingVolumeSlider/u);
  assert.match(qml, /volume: root\.thinkingVolume/u);
  assert.match(qml, /Wake phrases replace list/u);
  assert.match(qml, /palette\.button: "#7a2730"/u);
  assert.doesNotMatch(qml, /color: parent\.down \? "#7f0019" : "#b00020"/u);
  assert.match(qml, /languageBox/u);
  assert.match(qml, /genderBox/u);
  assert.match(qml, /rateSlider/u);
  assert.match(qml, /pitchSlider/u);
  assert.match(qml, /volumeSlider/u);
  assert.match(qml, /Commands/u);
  assert.match(qml, /References/u);
  assert.match(qml, /add_context/u);
  assert.match(qml, /clear_context/u);
  assert.match(qml, /contextEntries/u);
  assert.match(qml, /\/add reference text/u);
  assert.doesNotMatch(qml, /WebView|WebEngine|Chromium|Electron|Tauri/iu);
});

test("macOS native companion is AppKit and avoids browser/webview imports", async () => {
  const swift = await readFile("visual/macos/VoiceAgentVisual.swift", "utf8");

  assert.match(swift, /import AppKit/u);
  assert.match(swift, /URLSession\.shared\.webSocketTask/u);
  assert.match(swift, /drawWaveRing/u);
  assert.match(swift, /drawOuterTicks/u);
  assert.match(swift, /drawSpeakingWaves/u);
  assert.match(swift, /drawProcessingIndicator/u);
  assert.match(swift, /drawSubmittingIndicator/u);
  assert.match(swift, /drawThinkingIndicator/u);
  assert.match(swift, /drawRejectedIndicator/u);
  assert.match(swift, /final class ThinkingPulseSound/u);
  assert.match(swift, /setActive\(circleView\.state == "thinking" \|\| circleView\.state == "running"\)/u);
  assert.match(swift, /NSSound\(named: NSSound\.Name\("Glass"\)\)/u);
  assert.match(swift, /var volume: Float = 0\.32/u);
  assert.match(swift, /sound\.volume = volume/u);
  assert.match(swift, /stt_processing/u);
  assert.match(swift, /submitting/u);
  assert.match(swift, /wake_rejected/u);
  assert.match(swift, /final class VisualRootView/u);
  assert.match(swift, /let center = CGPoint\(x: bounds\.midX, y: bounds\.midY\)/u);
  assert.match(swift, /commandPanel\.frame/u);
  assert.match(swift, /circleView\.frame/u);
  assert.match(swift, /let maxCircle: CGFloat = expanded \? 720 : 360/u);
  assert.match(swift, /lineBreakMode = \.byWordWrapping/u);
  assert.match(swift, /usesLineFragmentOrigin/u);
  assert.match(swift, /roundedRect: backdropRect/u);
  assert.match(swift, /state == "approval_pending" \|\| state == "wake_rejected" \? 13 : state == "speaking" \? 20 : 15/u);
  assert.match(swift, /state == "approval_pending"/u);
  assert.match(swift, /state == "wake_rejected"/u);
  assert.match(swift, /if !expandedText && state != "wake_rejected"/u);
  assert.match(swift, /\.now\(\) \+ 3\.6/u);
  assert.doesNotMatch(swift, /greaterThanOrEqualToConstant:\s*180/u);
  assert.match(swift, /TTS Stop/u);
  assert.match(swift, /STOP/u);
  assert.match(swift, /emergency_stop/u);
  assert.match(swift, /Settings/u);
  assert.match(swift, /update_tts_settings/u);
  assert.match(swift, /update_wake_phrases/u);
  assert.match(swift, /reset_settings/u);
  assert.match(swift, /Restore Defaults/u);
  assert.match(swift, /settingsWakePhrasesView/u);
  assert.match(swift, /settingsThinkingVolumeField/u);
  assert.match(swift, /Thinking Fx/u);
  assert.match(swift, /thinkingPulseSound\.volume/u);
  assert.match(swift, /final class HoverHelpButton/u);
  assert.match(swift, /NSPopover/u);
  assert.match(swift, /referenceHelpButton/u);
  assert.match(swift, /guideButton/u);
  assert.match(swift, /showVoiceGuide/u);
  assert.match(swift, /Voice Agent Guide/u);
  assert.match(swift, /NSColor\.systemRed/u);
  assert.doesNotMatch(swift, /button\.isBordered = false/u);
  assert.match(swift, /settingsLanguagePopup/u);
  assert.match(swift, /settingsGenderPopup/u);
  assert.match(swift, /settingsRateField/u);
  assert.match(swift, /settingsPitchField/u);
  assert.match(swift, /settingsVolumeField/u);
  assert.match(swift, /Clear Cmds/u);
  assert.match(swift, /References/u);
  assert.match(swift, /add_context/u);
  assert.match(swift, /clear_context/u);
  assert.match(swift, /No references queued/u);
  assert.doesNotMatch(swift, /WKWebView|WebView|Electron|Tauri/iu);
});

test("macOS native companion typechecks with Swift", async (context) => {
  if (process.platform !== "darwin") {
    context.skip("Swift/AppKit typecheck is macOS-only");
    return;
  }

  try {
    await execFileAsync("swiftc", [
      "-typecheck",
      "visual/macos/VoiceAgentVisual.swift"
    ], {
      env: {
        ...process.env,
        CLANG_MODULE_CACHE_PATH: join(tmpdir(), "voice-agent-swift-module-cache")
      }
    });
  } catch (error) {
    if (isNotFoundError(error)) {
      context.skip("swiftc is not available");
      return;
    }

    throw error;
  }
});

class FakeChildProcess extends EventEmitter {
  unref(): void {}
}

const execFileAsync = promisify(execFile);

async function connectWebSocket(url: string): Promise<Socket> {
  const parsed = new URL(url);
  const socket = connect(Number(parsed.port), parsed.hostname);
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  const key = "dGhlIHNhbXBsZSBub25jZQ==";
  socket.write(
    [
      `GET / HTTP/1.1`,
      `Host: ${parsed.host}`,
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Key: ${key}`,
      "Sec-WebSocket-Version: 13",
      "",
      ""
    ].join("\r\n")
  );
  await readHandshake(socket);
  return socket;
}

async function readHandshake(socket: Socket): Promise<void> {
  let buffer = Buffer.alloc(0);
  while (buffer.indexOf("\r\n\r\n") === -1) {
    buffer = Buffer.concat([buffer, await readChunk(socket)]);
  }
}

async function readUntilFrame(socket: Socket): Promise<string[]> {
  let buffer = Buffer.alloc(0);
  const messages: string[] = [];
  const deadline = Date.now() + 1000;

  while (Date.now() < deadline && messages.length === 0) {
    buffer = Buffer.concat([buffer, await readChunk(socket)]);
    const decoded = decodeServerFrames(buffer);
    messages.push(...decoded.messages);
    buffer = decoded.remainder;
  }

  return messages;
}

function readChunk(socket: Socket): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const onData = (chunk: Buffer): void => {
      cleanup();
      resolve(chunk);
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onTimeout = (): void => {
      cleanup();
      reject(new Error("Timed out waiting for visual bridge data."));
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("error", onError);
    };
    const timer = setTimeout(onTimeout, 1000);
    socket.once("data", onData);
    socket.once("error", onError);
  });
}

function decodeServerFrames(buffer: Buffer): { messages: string[]; remainder: Buffer } {
  const messages: string[] = [];
  let offset = 0;

  while (offset + 2 <= buffer.length) {
    const second = buffer[offset + 1];
    let length = second & 0x7f;
    let headerLength = 2;

    if (length === 126) {
      if (offset + 4 > buffer.length) break;
      length = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (length === 127) {
      if (offset + 10 > buffer.length) break;
      length = Number(buffer.readBigUInt64BE(offset + 2));
      headerLength = 10;
    }

    if (offset + headerLength + length > buffer.length) break;
    messages.push(buffer.slice(offset + headerLength, offset + headerLength + length).toString("utf8"));
    offset += headerLength + length;
  }

  return {
    messages,
    remainder: buffer.slice(offset)
  };
}

function encodeClientFrame(text: string): Buffer {
  const payload = Buffer.from(text, "utf8");
  const mask = Buffer.from([1, 2, 3, 4]);
  const header = payload.length < 126 ? Buffer.from([0x81, 0x80 | payload.length]) : Buffer.alloc(4);

  if (payload.length >= 126) {
    header[0] = 0x81;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payload.length, 2);
  }

  const masked = Buffer.from(payload);
  for (let index = 0; index < masked.length; index += 1) {
    masked[index] ^= mask[index % 4];
  }

  return Buffer.concat([header, mask, masked]);
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1000;

  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error("Timed out waiting for condition.");
}

function isListenPermissionError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EPERM";
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
