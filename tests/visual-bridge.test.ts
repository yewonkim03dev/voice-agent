import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  assert.equal(parseVisualControlEvent('{"op":"voice-agent-ui","type":"control","action":"run_command"}'), null);
  assert.equal(parseVisualControlEvent("not-json"), null);
});

test("visual bridge accepts websocket clients, sends events, and receives controls", async (context) => {
  const controls: string[] = [];
  const bridge = new VisualBridge({
    writeLine: () => {}
  });

  bridge.onControl((event) => controls.push(event.action));
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
    await waitFor(() => controls.includes("tts_stop"));
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

  assert.match(qml, /ApplicationWindow/u);
  assert.match(qml, /WebSocket/u);
  assert.match(qml, /TTS Stop/u);
  assert.match(qml, /Commands/u);
  assert.doesNotMatch(qml, /WebView|WebEngine|Chromium|Electron|Tauri/iu);
});

test("macOS native companion is AppKit and avoids browser/webview imports", async () => {
  const swift = await readFile("visual/macos/VoiceAgentVisual.swift", "utf8");

  assert.match(swift, /import AppKit/u);
  assert.match(swift, /URLSession\.shared\.webSocketTask/u);
  assert.match(swift, /TTS Stop/u);
  assert.doesNotMatch(swift, /WKWebView|WebView|Electron|Tauri/iu);
});

class FakeChildProcess extends EventEmitter {
  unref(): void {}
}

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
