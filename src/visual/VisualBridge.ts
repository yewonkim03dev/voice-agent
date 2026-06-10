import { createHash } from "node:crypto";
import { createServer, type Server, type Socket } from "node:net";

import type { GestureCameraMode, GestureRunningMode, GestureWakeFileConfig } from "../gesture/GestureWakeConfig.ts";

type WriteLine = (line: string) => void;

export type VisualUiState =
  | "idle"
  | "listening"
  | "wake_matched"
  | "wake_rejected"
  | "stt_processing"
  | "submitting"
  | "thinking"
  | "running"
  | "speaking"
  | "approval_pending"
  | "error"
  | "shutdown";

export type VisualControlAction =
  | "tts_stop"
  | "mic_toggle"
  | "camera_toggle"
  | "exit"
  | "clear_commands"
  | "add_context"
  | "clear_context"
  | "show_context"
  | "direct_go"
  | "describe_screen"
  | "emergency_stop"
  | "reset_settings"
  | "update_wake_phrases"
  | "update_stop_phrases"
  | "update_approval_phrases"
  | "update_gesture_wake_settings"
  | "capture_gesture_template"
  | "delete_gesture_template"
  | "clear_custom_gesture_templates"
  | "reset_gesture_wake_settings"
  | "update_codex_thread_id"
  | "update_visual_settings"
  | "update_tts_settings";

export interface VisualTtsSettings {
  language?: "ko" | "en" | "auto";
  voiceName?: string;
  gender?: "male" | "female" | "auto";
  rate?: number;
  pitch?: number;
  volume?: number;
}

export interface VisualRuntimeSettings {
  thinkingVolume?: number;
  responseLanguage?: "ko" | "en" | "auto";
  reactionMode?: "audio_circle" | "particle_orb";
  chatHistoryEnabled?: boolean;
  hudEnabled?: boolean;
  hudCompact?: boolean;
  popupPreferred?: boolean;
  popupFontSize?: number;
  screenDescribePrompt?: string;
  screenCaptureDirectory?: string;
  appShotHotkey?: string;
  speakWakeRejectedWarnings?: boolean;
  maxUtteranceSeconds?: number;
}

export type VisualGestureWakeSettings = GestureWakeFileConfig;

export interface VisualApprovalPhrases {
  onceApprove?: string[];
  deny?: string[];
  cancel?: string[];
  sessionApprove?: string[];
  policyApprove?: string[];
  networkPolicyApprove?: string[];
}

export type VisualEvent =
  | {
      op: "voice-agent-ui";
      type: "state";
      state: VisualUiState;
      text?: string;
    }
  | {
      op: "voice-agent-ui";
      type: "volume";
      rms: number;
      peak: number;
    }
  | {
      op: "voice-agent-ui";
      type: "wake";
      phrase: string;
    }
  | {
      op: "voice-agent-ui";
      type: "question";
      text: string;
      references?: string[];
    }
  | {
      op: "voice-agent-ui";
      type: "command";
      text: string;
    }
  | {
      op: "voice-agent-ui";
      type: "speech";
      text: string;
    }
  | {
      op: "voice-agent-ui";
      type: "status";
      text: string;
    }
  | {
      op: "voice-agent-ui";
      type: "error";
      text: string;
    }
  | {
      op: "voice-agent-ui";
      type: "popup";
      text: string;
      id?: string;
      title?: string;
      format?: "markdown" | "plain";
    }
  | {
      op: "voice-agent-ui";
      type: "popup_history";
      entries: Array<{
        id: string;
        title: string;
        text: string;
        format: "markdown" | "plain";
        createdAt: number;
      }>;
    }
  | {
      op: "voice-agent-ui";
      type: "approval";
      text: string;
    }
  | {
      op: "voice-agent-ui";
      type: "usage";
      text: string;
      primaryText?: string;
      secondaryText?: string;
      updatedAt?: number;
    }
  | {
      op: "voice-agent-ui";
      type: "context";
      entries: string[];
    }
  | {
      op: "voice-agent-ui";
      type: "context_list";
      entries: string[];
    }
  | {
      op: "voice-agent-ui";
      type: "camera";
      enabled: boolean;
      mode: GestureCameraMode;
      wakeGesture: string;
      wakeGestureLabel?: string;
      stopGesture: string;
      stopGestureLabel?: string;
      runningMode: GestureRunningMode;
      text?: string;
    }
  | {
      op: "voice-agent-ui";
      type: "settings";
      tts?: VisualTtsSettings;
      visual?: VisualRuntimeSettings;
      gestureWake?: VisualGestureWakeSettings;
      approvalPhrases?: VisualApprovalPhrases;
      wakePhrases?: string[];
      stopPhrases?: string[];
      codexThreadId?: string;
      codexAlwaysStartNewThread?: boolean;
      micEnabled?: boolean;
    };

export interface VisualControlEvent {
  op: "voice-agent-ui";
  type: "control";
  action: VisualControlAction;
  text?: string;
  tts?: VisualTtsSettings;
  visual?: VisualRuntimeSettings;
  gestureWake?: VisualGestureWakeSettings;
  approvalPhrases?: VisualApprovalPhrases;
  wakePhrases?: string[];
  stopPhrases?: string[];
  codexThreadId?: string;
  codexAlwaysStartNewThread?: boolean;
  micEnabled?: boolean;
}

export interface VisualBridgeLike {
  send(event: VisualEvent): void;
  onControl(callback: (event: VisualControlEvent) => void): void;
}

export interface VisualBridgeOptions {
  host?: string;
  port?: number;
  writeLine?: WriteLine;
}

export class VisualBridge implements VisualBridgeLike {
  private readonly host: string;
  private readonly port: number;
  private readonly writeLine: WriteLine;
  private readonly clients = new Set<WebSocketClient>();
  private readonly controlListeners: Array<(event: VisualControlEvent) => void> = [];
  private latestSettings: Extract<VisualEvent, { type: "settings" }> | undefined;
  private latestUsage: Extract<VisualEvent, { type: "usage" }> | undefined;
  private latestQuestion: Extract<VisualEvent, { type: "question" }> | undefined;
  private latestContext: Extract<VisualEvent, { type: "context" }> | undefined;
  private latestPopupHistory: Extract<VisualEvent, { type: "popup_history" }> | undefined;
  private server: Server | undefined;
  private bridgeUrl: string | undefined;

  constructor(options: VisualBridgeOptions = {}) {
    this.host = options.host ?? "127.0.0.1";
    this.port = options.port ?? 0;
    this.writeLine = options.writeLine ?? noop;
  }

  get url(): string | undefined {
    return this.bridgeUrl;
  }

  async start(): Promise<string> {
    if (this.server && this.bridgeUrl) return this.bridgeUrl;

    const server = createServer((socket) => {
      const client = new WebSocketClient(socket, {
        onReady: (readyClient) => {
          this.clients.add(readyClient);
          this.writeLine("[visual] connected");
          readyClient.send({
            op: "voice-agent-ui",
            type: "state",
            state: "idle"
          });
          if (this.latestSettings) {
            readyClient.send(this.latestSettings);
          }
          if (this.latestUsage) {
            readyClient.send(this.latestUsage);
          }
          if (this.latestContext) {
            readyClient.send(this.latestContext);
          }
          if (this.latestQuestion) {
            readyClient.send(this.latestQuestion);
          }
          if (this.latestPopupHistory) {
            readyClient.send(this.latestPopupHistory);
          }
        },
        onControl: (event) => this.handleControl(event),
        onClose: (closedClient) => this.clients.delete(closedClient)
      });
      client.start();
    });

    this.server = server;

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.port, this.host, () => {
        server.off("error", reject);
        resolve();
      });
    });

    const address = server.address();
    const actualPort = typeof address === "object" && address ? address.port : this.port;
    this.bridgeUrl = `ws://${this.host}:${actualPort}`;
    this.writeLine(`[visual] listening on ${this.bridgeUrl}`);
    return this.bridgeUrl;
  }

  async stop(): Promise<void> {
    for (const client of this.clients) {
      client.close();
    }

    this.clients.clear();

    if (!this.server) return;

    await new Promise<void>((resolve) => {
      this.server?.close(() => resolve());
    });
    this.server = undefined;
    this.bridgeUrl = undefined;
  }

  send(event: VisualEvent): void {
    this.rememberSettings(event);
    this.rememberUsage(event);
    this.rememberQuestion(event);
    this.rememberContext(event);
    this.rememberPopupHistory(event);
    const payload = serializeVisualEvent(event);
    for (const client of this.clients) {
      client.sendRaw(payload);
    }
  }

  onControl(callback: (event: VisualControlEvent) => void): void {
    this.controlListeners.push(callback);
  }

  private handleControl(event: VisualControlEvent): void {
    this.writeLine(`[visual] control ${event.action}`);
    this.controlListeners.forEach((listener) => listener(event));
  }

  private rememberSettings(event: VisualEvent): void {
    if (event.type !== "settings") return;

    this.latestSettings = {
      op: "voice-agent-ui",
      type: "settings",
      ...(this.latestSettings?.tts !== undefined ? { tts: { ...this.latestSettings.tts } } : {}),
      ...(this.latestSettings?.visual !== undefined ? { visual: { ...this.latestSettings.visual } } : {}),
      ...(this.latestSettings?.gestureWake !== undefined ? { gestureWake: cloneGestureWakeSettings(this.latestSettings.gestureWake) } : {}),
      ...(this.latestSettings?.approvalPhrases !== undefined ? { approvalPhrases: cloneApprovalPhrases(this.latestSettings.approvalPhrases) } : {}),
      ...(this.latestSettings?.wakePhrases !== undefined ? { wakePhrases: [...this.latestSettings.wakePhrases] } : {}),
      ...(this.latestSettings?.stopPhrases !== undefined ? { stopPhrases: [...this.latestSettings.stopPhrases] } : {}),
      ...(this.latestSettings?.codexThreadId !== undefined ? { codexThreadId: this.latestSettings.codexThreadId } : {}),
      ...(this.latestSettings?.codexAlwaysStartNewThread !== undefined ? { codexAlwaysStartNewThread: this.latestSettings.codexAlwaysStartNewThread } : {}),
      ...(event.tts !== undefined ? { tts: { ...event.tts } } : {}),
      ...(event.visual !== undefined ? { visual: { ...event.visual } } : {}),
      ...(event.gestureWake !== undefined ? { gestureWake: cloneGestureWakeSettings(event.gestureWake) } : {}),
      ...(event.approvalPhrases !== undefined ? { approvalPhrases: cloneApprovalPhrases(event.approvalPhrases) } : {}),
      ...(event.wakePhrases !== undefined ? { wakePhrases: [...event.wakePhrases] } : {}),
      ...(event.stopPhrases !== undefined ? { stopPhrases: [...event.stopPhrases] } : {}),
      ...(event.codexThreadId !== undefined ? { codexThreadId: event.codexThreadId } : {}),
      ...(event.codexAlwaysStartNewThread !== undefined ? { codexAlwaysStartNewThread: event.codexAlwaysStartNewThread } : {})
    };
  }

  private rememberUsage(event: VisualEvent): void {
    if (event.type !== "usage") return;

    this.latestUsage = {
      op: "voice-agent-ui",
      type: "usage",
      text: event.text,
      ...(event.primaryText !== undefined ? { primaryText: event.primaryText } : {}),
      ...(event.secondaryText !== undefined ? { secondaryText: event.secondaryText } : {}),
      ...(event.updatedAt !== undefined ? { updatedAt: event.updatedAt } : {})
    };
  }

  private rememberQuestion(event: VisualEvent): void {
    if (event.type !== "question") return;

    this.latestQuestion = {
      op: "voice-agent-ui",
      type: "question",
      text: event.text,
      ...(event.references !== undefined ? { references: [...event.references] } : {})
    };
  }

  private rememberContext(event: VisualEvent): void {
    if (event.type !== "context") return;

    this.latestContext = {
      op: "voice-agent-ui",
      type: "context",
      entries: [...event.entries]
    };
  }

  private rememberPopupHistory(event: VisualEvent): void {
    if (event.type !== "popup_history") return;

    this.latestPopupHistory = {
      op: "voice-agent-ui",
      type: "popup_history",
      entries: event.entries.map((entry) => ({ ...entry }))
    };
  }
}

export function serializeVisualEvent(event: VisualEvent): string {
  return JSON.stringify(event);
}

export function parseVisualControlEvent(text: string): VisualControlEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  const record = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  if (record.op !== "voice-agent-ui" || record.type !== "control") return null;
  if (
    record.action !== "tts_stop" &&
    record.action !== "mic_toggle" &&
    record.action !== "camera_toggle" &&
    record.action !== "exit" &&
    record.action !== "clear_commands" &&
    record.action !== "add_context" &&
    record.action !== "clear_context" &&
    record.action !== "show_context" &&
    record.action !== "direct_go" &&
    record.action !== "describe_screen" &&
    record.action !== "emergency_stop" &&
    record.action !== "reset_settings" &&
    record.action !== "update_wake_phrases" &&
    record.action !== "update_stop_phrases" &&
    record.action !== "update_approval_phrases" &&
    record.action !== "update_gesture_wake_settings" &&
    record.action !== "capture_gesture_template" &&
    record.action !== "delete_gesture_template" &&
    record.action !== "clear_custom_gesture_templates" &&
    record.action !== "reset_gesture_wake_settings" &&
    record.action !== "update_codex_thread_id" &&
    record.action !== "update_tts_settings" &&
    record.action !== "update_visual_settings"
  ) {
    return null;
  }

  return {
    op: "voice-agent-ui",
    type: "control",
    action: record.action,
    ...(typeof record.text === "string" ? { text: record.text } : {}),
    ...(isRecord(record.tts) ? { tts: parseVisualTtsSettings(record.tts) } : {}),
    ...(isRecord(record.visual) ? { visual: parseVisualRuntimeSettings(record.visual) } : {}),
    ...(isRecord(record.gestureWake) ? { gestureWake: record.gestureWake as VisualGestureWakeSettings } : {}),
    ...(isRecord(record.approvalPhrases) ? { approvalPhrases: parseVisualApprovalPhrases(record.approvalPhrases) } : {}),
    ...(Array.isArray(record.wakePhrases) ? { wakePhrases: parseWakePhrases(record.wakePhrases) } : {}),
    ...(Array.isArray(record.stopPhrases) ? { stopPhrases: parseWakePhrases(record.stopPhrases) } : {}),
    ...(typeof record.codexThreadId === "string" ? { codexThreadId: record.codexThreadId.trim() } : {}),
    ...(typeof record.codexAlwaysStartNewThread === "boolean" ? { codexAlwaysStartNewThread: record.codexAlwaysStartNewThread } : {}),
    ...(typeof record.micEnabled === "boolean" ? { micEnabled: record.micEnabled } : {})
  };
}

function parsePhrases(values: unknown): string[] | undefined {
  if (!Array.isArray(values)) return undefined;
  return values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
}

function cloneGestureWakeSettings(settings: VisualGestureWakeSettings): VisualGestureWakeSettings {
  return {
    ...settings,
    ...(settings.resolution !== undefined && typeof settings.resolution === "object"
      ? { resolution: { ...settings.resolution } }
      : {}),
    ...(settings.bindings !== undefined ? { bindings: { ...settings.bindings } } : {}),
    ...(settings.customGestures !== undefined
      ? {
          customGestures: settings.customGestures.map((template) => ({
            ...template,
            vector: [...template.vector]
          }))
        }
      : {})
  };
}

function parseWakePhrases(values: unknown[]): string[] {
  return parsePhrases(values) ?? [];
}

function parseVisualApprovalPhrases(record: Record<string, unknown>): VisualApprovalPhrases {
  const onceApprove = parsePhrases(record.onceApprove);
  const deny = parsePhrases(record.deny);
  const sessionApprove = parsePhrases(record.sessionApprove);
  const policyApprove = parsePhrases(record.policyApprove);
  const networkPolicyApprove = parsePhrases(record.networkPolicyApprove);
  const cancel = parsePhrases(record.cancel);

  return {
    ...(onceApprove !== undefined ? { onceApprove } : {}),
    ...(deny !== undefined ? { deny } : {}),
    ...(cancel !== undefined ? { cancel } : {}),
    ...(sessionApprove !== undefined ? { sessionApprove } : {}),
    ...(policyApprove !== undefined ? { policyApprove } : {}),
    ...(networkPolicyApprove !== undefined ? { networkPolicyApprove } : {})
  };
}

function cloneApprovalPhrases(phrases: VisualApprovalPhrases): VisualApprovalPhrases {
  return {
    ...(phrases.onceApprove !== undefined ? { onceApprove: [...phrases.onceApprove] } : {}),
    ...(phrases.deny !== undefined ? { deny: [...phrases.deny] } : {}),
    ...(phrases.cancel !== undefined ? { cancel: [...phrases.cancel] } : {}),
    ...(phrases.sessionApprove !== undefined ? { sessionApprove: [...phrases.sessionApprove] } : {}),
    ...(phrases.policyApprove !== undefined ? { policyApprove: [...phrases.policyApprove] } : {}),
    ...(phrases.networkPolicyApprove !== undefined ? { networkPolicyApprove: [...phrases.networkPolicyApprove] } : {})
  };
}

function parseVisualTtsSettings(record: Record<string, unknown>): VisualTtsSettings {
  return {
    ...(isVisualLanguage(record.language) ? { language: record.language } : {}),
    ...(typeof record.voiceName === "string" ? { voiceName: record.voiceName } : {}),
    ...(isVisualGender(record.gender) ? { gender: record.gender } : {}),
    ...(typeof record.rate === "number" && Number.isFinite(record.rate) ? { rate: record.rate } : {}),
    ...(typeof record.pitch === "number" && Number.isFinite(record.pitch) ? { pitch: record.pitch } : {}),
    ...(typeof record.volume === "number" && Number.isFinite(record.volume) ? { volume: record.volume } : {})
  };
}

function parseVisualRuntimeSettings(record: Record<string, unknown>): VisualRuntimeSettings {
  return {
    ...(typeof record.thinkingVolume === "number" && Number.isFinite(record.thinkingVolume)
      ? { thinkingVolume: clamp(record.thinkingVolume, 0, 0.8) }
      : {}),
    ...(isVisualLanguage(record.responseLanguage) ? { responseLanguage: record.responseLanguage } : {}),
    ...(isVisualReactionMode(record.reactionMode) ? { reactionMode: record.reactionMode } : {}),
    ...(typeof record.chatHistoryEnabled === "boolean" ? { chatHistoryEnabled: record.chatHistoryEnabled } : {}),
    ...(typeof record.hudEnabled === "boolean" ? { hudEnabled: record.hudEnabled } : {}),
    ...(typeof record.hudCompact === "boolean" ? { hudCompact: record.hudCompact } : {}),
    ...(typeof record.popupPreferred === "boolean" ? { popupPreferred: record.popupPreferred } : {}),
    ...(typeof record.popupFontSize === "number" && Number.isFinite(record.popupFontSize)
      ? { popupFontSize: clamp(record.popupFontSize, 12, 24) }
      : {}),
    ...(typeof record.screenDescribePrompt === "string" ? { screenDescribePrompt: record.screenDescribePrompt } : {}),
    ...(typeof record.screenCaptureDirectory === "string" ? { screenCaptureDirectory: record.screenCaptureDirectory } : {}),
    ...(typeof record.appShotHotkey === "string" ? { appShotHotkey: record.appShotHotkey } : {}),
    ...(typeof record.speakWakeRejectedWarnings === "boolean"
      ? { speakWakeRejectedWarnings: record.speakWakeRejectedWarnings }
      : {}),
    ...(typeof record.maxUtteranceSeconds === "number" && Number.isFinite(record.maxUtteranceSeconds)
      ? { maxUtteranceSeconds: record.maxUtteranceSeconds }
      : {})
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isVisualReactionMode(value: unknown): value is NonNullable<VisualRuntimeSettings["reactionMode"]> {
  return value === "audio_circle" || value === "particle_orb";
}

function isVisualLanguage(value: unknown): value is NonNullable<VisualTtsSettings["language"]> {
  return value === "ko" || value === "en" || value === "auto";
}

function isVisualGender(value: unknown): value is NonNullable<VisualTtsSettings["gender"]> {
  return value === "male" || value === "female" || value === "auto";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

interface WebSocketClientOptions {
  onReady(client: WebSocketClient): void;
  onControl(event: VisualControlEvent): void;
  onClose(client: WebSocketClient): void;
}

class WebSocketClient {
  private readonly socket: Socket;
  private readonly options: WebSocketClientOptions;
  private buffer = Buffer.alloc(0);
  private ready = false;

  constructor(socket: Socket, options: WebSocketClientOptions) {
    this.socket = socket;
    this.options = options;
  }

  start(): void {
    this.socket.on("data", (chunk) => this.consume(chunk));
    this.socket.on("close", () => this.options.onClose(this));
    this.socket.on("error", () => this.options.onClose(this));
  }

  send(event: VisualEvent): void {
    this.sendRaw(serializeVisualEvent(event));
  }

  sendRaw(text: string): void {
    if (!this.ready || this.socket.destroyed) return;
    this.socket.write(encodeWebSocketTextFrame(text));
  }

  close(): void {
    this.socket.end();
  }

  private consume(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    if (!this.ready) {
      this.tryHandshake();
      return;
    }

    this.consumeFrames();
  }

  private tryHandshake(): void {
    const headerEnd = this.buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) return;

    const header = this.buffer.slice(0, headerEnd).toString("utf8");
    this.buffer = this.buffer.slice(headerEnd + 4);
    const key = header.match(/^Sec-WebSocket-Key:\s*(.+)$/imu)?.[1]?.trim();
    if (!key) {
      this.socket.end();
      return;
    }

    const accept = createHash("sha1")
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");
    this.socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${accept}`,
        "",
        ""
      ].join("\r\n")
    );
    this.ready = true;
    this.options.onReady(this);
    this.consumeFrames();
  }

  private consumeFrames(): void {
    while (this.buffer.length >= 2) {
      const frame = decodeWebSocketTextFrame(this.buffer);
      if (!frame) return;

      this.buffer = this.buffer.slice(frame.bytesConsumed);
      if (frame.close) {
        this.close();
        return;
      }

      const control = parseVisualControlEvent(frame.text);
      if (control) this.options.onControl(control);
    }
  }
}

function encodeWebSocketTextFrame(text: string): Buffer {
  const payload = Buffer.from(text, "utf8");

  if (payload.length < 126) {
    return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  }

  if (payload.length <= 65_535) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
    return Buffer.concat([header, payload]);
  }

  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(payload.length), 2);
  return Buffer.concat([header, payload]);
}

function decodeWebSocketTextFrame(buffer: Buffer): { text: string; bytesConsumed: number; close?: boolean } | null {
  const first = buffer[0];
  const second = buffer[1];
  const opcode = first & 0x0f;
  const masked = (second & 0x80) !== 0;
  let length = second & 0x7f;
  let offset = 2;

  if (length === 126) {
    if (buffer.length < offset + 2) return null;
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    if (buffer.length < offset + 8) return null;
    const bigLength = buffer.readBigUInt64BE(offset);
    if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    length = Number(bigLength);
    offset += 8;
  }

  const maskLength = masked ? 4 : 0;
  if (buffer.length < offset + maskLength + length) return null;

  const mask = masked ? buffer.slice(offset, offset + 4) : undefined;
  offset += maskLength;
  const payload = Buffer.from(buffer.slice(offset, offset + length));

  if (mask) {
    for (let index = 0; index < payload.length; index += 1) {
      payload[index] ^= mask[index % 4];
    }
  }

  return {
    text: opcode === 1 ? payload.toString("utf8") : "",
    close: opcode === 8,
    bytesConsumed: offset + length
  };
}

function noop(_line: string): void {}
