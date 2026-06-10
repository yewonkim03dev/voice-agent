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
      type: "question",
      text: "테스트 돌려줘",
      references: ["README 참고"]
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
      type: "popup",
      title: "공부 노트",
      text: "# 개념\n긴 설명입니다.",
      format: "markdown"
    },
    {
      op: "voice-agent-ui",
      type: "popup_history",
      entries: [{
        id: "popup_1",
        title: "공부 노트",
        text: "$$x^2$$",
        format: "markdown",
        createdAt: 1000
      }]
    },
    {
      op: "voice-agent-ui",
      type: "usage",
      text: "5h 63% left · 1w 88% left",
      primaryText: "5h 63% left",
      secondaryText: "1w 88% left",
      updatedAt: 1000
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
  assert.deepEqual(parseVisualControlEvent('{"op":"voice-agent-ui","type":"control","action":"mic_toggle","micEnabled":false}'), {
    op: "voice-agent-ui",
    type: "control",
    action: "mic_toggle",
    micEnabled: false
  });
  assert.deepEqual(parseVisualControlEvent('{"op":"voice-agent-ui","type":"control","action":"add_context","text":"README 참고"}'), {
    op: "voice-agent-ui",
    type: "control",
    action: "add_context",
    text: "README 참고"
  });
  assert.deepEqual(parseVisualControlEvent('{"op":"voice-agent-ui","type":"control","action":"direct_go","text":"README 보고 요약해줘"}'), {
    op: "voice-agent-ui",
    type: "control",
    action: "direct_go",
    text: "README 보고 요약해줘"
  });
  assert.deepEqual(parseVisualControlEvent('{"op":"voice-agent-ui","type":"control","action":"show_context"}'), {
    op: "voice-agent-ui",
    type: "control",
    action: "show_context"
  });
  assert.deepEqual(parseVisualControlEvent('{"op":"voice-agent-ui","type":"control","action":"emergency_stop"}'), {
    op: "voice-agent-ui",
    type: "control",
    action: "emergency_stop"
  });
  assert.deepEqual(parseVisualControlEvent('{"op":"voice-agent-ui","type":"control","action":"camera_toggle"}'), {
    op: "voice-agent-ui",
    type: "control",
    action: "camera_toggle"
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
  assert.deepEqual(parseVisualControlEvent('{"op":"voice-agent-ui","type":"control","action":"update_stop_phrases","stopPhrases":["멈춰","  얼음  ",""]}'), {
    op: "voice-agent-ui",
    type: "control",
    action: "update_stop_phrases",
    stopPhrases: ["멈춰", "얼음"]
  });
  assert.deepEqual(parseVisualControlEvent('{"op":"voice-agent-ui","type":"control","action":"update_approval_phrases","approvalPhrases":{"onceApprove":["  해  ",""],"deny":["마"],"sessionApprove":["오늘만"],"policyApprove":["계속"],"networkPolicyApprove":["호스트"]}}'), {
    op: "voice-agent-ui",
    type: "control",
    action: "update_approval_phrases",
    approvalPhrases: {
      onceApprove: ["해"],
      deny: ["마"],
      sessionApprove: ["오늘만"],
      policyApprove: ["계속"],
      networkPolicyApprove: ["호스트"]
    }
  });
  assert.deepEqual(parseVisualControlEvent('{"op":"voice-agent-ui","type":"control","action":"update_gesture_wake_settings","gestureWake":{"runningMode":"emergency_only","bindings":{"wake":"open_palm","stop":"thumbs_down","approval.once":"thumbs_up"}}}'), {
    op: "voice-agent-ui",
    type: "control",
    action: "update_gesture_wake_settings",
    gestureWake: {
      runningMode: "emergency_only",
      bindings: {
        wake: "open_palm",
        stop: "thumbs_down",
        "approval.once": "thumbs_up"
      }
    }
  });
  assert.deepEqual(parseVisualControlEvent('{"op":"voice-agent-ui","type":"control","action":"capture_gesture_template","text":"wave"}'), {
    op: "voice-agent-ui",
    type: "control",
    action: "capture_gesture_template",
    text: "wave"
  });
  assert.deepEqual(parseVisualControlEvent('{"op":"voice-agent-ui","type":"control","action":"delete_gesture_template","text":"custom:wave"}'), {
    op: "voice-agent-ui",
    type: "control",
    action: "delete_gesture_template",
    text: "custom:wave"
  });
  assert.deepEqual(parseVisualControlEvent('{"op":"voice-agent-ui","type":"control","action":"clear_custom_gesture_templates"}'), {
    op: "voice-agent-ui",
    type: "control",
    action: "clear_custom_gesture_templates"
  });
  assert.deepEqual(parseVisualControlEvent('{"op":"voice-agent-ui","type":"control","action":"reset_gesture_wake_settings"}'), {
    op: "voice-agent-ui",
    type: "control",
    action: "reset_gesture_wake_settings"
  });
  assert.deepEqual(parseVisualControlEvent('{"op":"voice-agent-ui","type":"control","action":"update_codex_thread_id","codexThreadId":" 019e-session ","codexAlwaysStartNewThread":true}'), {
    op: "voice-agent-ui",
    type: "control",
    action: "update_codex_thread_id",
    codexThreadId: "019e-session",
    codexAlwaysStartNewThread: true
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
  assert.deepEqual(parseVisualControlEvent('{"op":"voice-agent-ui","type":"control","action":"update_visual_settings","visual":{"thinkingVolume":0.9,"responseLanguage":"en","reactionMode":"particle_orb","chatHistoryEnabled":false,"hudEnabled":false,"hudCompact":true,"popupPreferred":true,"speakWakeRejectedWarnings":false,"maxUtteranceSeconds":80}}'), {
    op: "voice-agent-ui",
    type: "control",
    action: "update_visual_settings",
    visual: {
      thinkingVolume: 0.8,
      responseLanguage: "en",
      reactionMode: "particle_orb",
      chatHistoryEnabled: false,
      hudEnabled: false,
      hudCompact: true,
      popupPreferred: true,
      speakWakeRejectedWarnings: false,
      maxUtteranceSeconds: 80
    }
  });
  assert.equal(parseVisualControlEvent('{"op":"voice-agent-ui","type":"control","action":"run_command"}'), null);
  assert.equal(parseVisualControlEvent("not-json"), null);
});

test("visual bridge replays latest settings to late visual clients", async () => {
  const source = await readFile("src/visual/VisualBridge.ts", "utf8");

  assert.match(source, /private latestSettings/u);
  assert.match(source, /private latestUsage/u);
  assert.match(source, /private latestPopupHistory/u);
  assert.match(source, /this\.rememberSettings\(event\)/u);
  assert.match(source, /this\.rememberUsage\(event\)/u);
  assert.match(source, /this\.rememberPopupHistory\(event\)/u);
  assert.match(source, /readyClient\.send\(this\.latestSettings\)/u);
  assert.match(source, /readyClient\.send\(this\.latestUsage\)/u);
  assert.match(source, /readyClient\.send\(this\.latestPopupHistory\)/u);
  assert.match(source, /event\.wakePhrases !== undefined/u);
  assert.match(source, /event\.stopPhrases !== undefined/u);
  assert.match(source, /event\.approvalPhrases !== undefined/u);
  assert.match(source, /event\.gestureWake !== undefined/u);
  assert.match(source, /cloneGestureWakeSettings/u);
  assert.match(source, /event\.tts !== undefined/u);
  assert.match(source, /event\.visual !== undefined/u);
  assert.match(source, /event\.codexThreadId !== undefined/u);
  assert.match(source, /event\.codexAlwaysStartNewThread !== undefined/u);
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
    channels: 1,
    visual: {
      thinkingVolume: 0.44
    }
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
    thinkingVolume: 0.44,
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
  assert.match(qml, /property int visualCenterYOffset/u);
  assert.match(qml, /expandedLayout \? 720 : 360/u);
  assert.match(qml, /anchors\.centerIn: parent/u);
  assert.match(qml, /anchors\.verticalCenterOffset: root\.visualCenterYOffset/u);
  assert.match(qml, /id: sessionBadge/u);
  assert.match(qml, /session: /u);
  assert.match(qml, /property string uiLanguage/u);
  assert.match(qml, /property bool uiLanguageInitialized/u);
  assert.match(qml, /function uiText\(key\)/u);
  assert.match(qml, /function initializeUiLanguage\(event\)/u);
  assert.match(qml, /root\.initializeUiLanguage\(event\)/u);
  assert.match(qml, /Text\.ElideMiddle/u);
  assert.match(qml, /anchors\.bottom: controls\.top/u);
  assert.match(qml, /id: statusBackdrop/u);
  assert.match(qml, /property string currentQuestion/u);
  assert.match(qml, /property var chatItems/u);
  assert.match(qml, /property bool chatHistoryEnabled/u);
  assert.match(qml, /property bool chatPanelOpen/u);
  assert.match(qml, /property bool chatPanelVisible/u);
  assert.match(qml, /function pushChat\(role, kind, text\)/u);
  assert.match(qml, /type === "question"/u);
  assert.match(qml, /root\.pushChat\("user", "question", event\.text\)/u);
  assert.match(qml, /root\.pushChat\("assistant", "speech", event\.text\)/u);
  assert.match(qml, /root\.pushChat\("assistant", "command", event\.text\)/u);
  assert.match(qml, /root\.pushChat\("assistant", "status", event\.text\)/u);
  assert.match(qml, /id: questionLabel/u);
  assert.match(qml, /questionLabel\.height \+ 26/u);
  assert.match(qml, /"Q: " \+ root\.currentQuestion/u);
  assert.match(qml, /id: chatPanel/u);
  assert.match(qml, /Recent Q\/A/u);
  assert.match(qml, /id: chatOpenButton/u);
  assert.match(qml, /Show Recent Q\/A panel/u);
  assert.match(qml, /model: root\.chatItems/u);
  assert.match(qml, /id: bubbleText/u);
  assert.match(qml, /selectByMouse: true/u);
  assert.match(qml, /persistentSelection: true/u);
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
  assert.match(qml, /🔇/u);
  assert.match(qml, /microphoneOn: "microphone on"/u);
  assert.match(qml, /microphoneOff: "microphone off"/u);
  assert.match(qml, /audioReconnecting: "audio reconnecting"/u);
  assert.match(qml, /waitingForMicrophone: "waiting for microphone"/u);
  assert.match(qml, /audioInputRestarting: "audio input restarting"/u);
  assert.match(qml, /audioReady: "audio ready"/u);
  assert.match(qml, /displayText\(event\.text \|\| "", event\.state\)/u);
  assert.match(qml, /mic_toggle/u);
  assert.match(qml, /camera_toggle/u);
  assert.match(qml, /cameraGestureCancelled/u);
  assert.match(qml, /STOP/u);
  assert.match(qml, /emergency_stop/u);
  assert.match(qml, /Settings/u);
  assert.match(qml, /id: settingsScroll/u);
  assert.match(qml, /ScrollBar\.vertical\.policy: ScrollBar\.AsNeeded/u);
  assert.match(qml, /id: settingsResizeHandle/u);
  assert.match(qml, /cursorShape: Qt\.SizeFDiagCursor/u);
  assert.match(qml, /update_tts_settings/u);
  assert.match(qml, /update_wake_phrases/u);
  assert.match(qml, /update_stop_phrases/u);
  assert.match(qml, /id: stopField/u);
  assert.match(qml, /update_approval_phrases/u);
  assert.match(qml, /update_gesture_wake_settings/u);
  assert.match(qml, /capture_gesture_template/u);
  assert.match(qml, /delete_gesture_template/u);
  assert.match(qml, /clear_custom_gesture_templates/u);
  assert.match(qml, /gestureCustomManage/u);
  assert.match(qml, /Delete/u);
  assert.match(qml, /customGestureTemplates/u);
  assert.match(qml, /Approval allow phrases/u);
  assert.match(qml, /Persistent allow phrases/u);
  assert.match(qml, /Network persistent allow phrases/u);
  assert.match(qml, /Gesture wake/u);
  assert.match(qml, /id: gestureWakeBox/u);
  assert.match(qml, /id: gestureStopBox/u);
  assert.match(qml, /id: gestureApprovalOnceBox/u);
  assert.match(qml, /id: gestureRunningModeBox/u);
  assert.match(qml, /id: approvalPolicyField/u);
  assert.match(qml, /id: approvalNetworkPolicyField/u);
  assert.match(qml, /policyApprove: root\.parseWakePhrases\(approvalPolicyField\.text\)/u);
  assert.match(qml, /networkPolicyApprove: root\.parseWakePhrases\(approvalNetworkPolicyField\.text\)/u);
  assert.match(qml, /update_codex_thread_id/u);
  assert.match(qml, /update_visual_settings/u);
  assert.match(qml, /reset_settings/u);
  assert.match(qml, /Restore Defaults/u);
  assert.match(qml, /Speak wake warning/u);
  assert.match(qml, /Max speech/u);
  assert.match(qml, /maxUtteranceSeconds/u);
  assert.match(qml, /ToolTip\.text: root\.uiText\("languageHelp"\)/u);
  assert.match(qml, /Visual UI language applies after restart/u);
  assert.match(qml, /Maximum utterance length/u);
  assert.match(qml, /Layout\.preferredWidth: 22/u);
  assert.match(qml, /Layout\.preferredHeight: 22/u);
  assert.match(qml, /Wake phrases/u);
  assert.match(qml, /Codex thread id \(applies after restart\)/u);
  assert.match(qml, /id: codexThreadField/u);
  assert.match(qml, /voiceGuideText/u);
  assert.match(qml, /referenceHelpText/u);
  assert.match(qml, /id: guideButton/u);
  assert.match(qml, /id: guidePopup/u);
  assert.match(qml, /id: referenceHelpPopup/u);
  assert.match(qml, /property string usageText/u);
  assert.match(qml, /event\.type === "usage"/u);
  assert.match(qml, /id: usageBadge/u);
  assert.match(qml, /root\.uiText\("usagePrefix"\) \+ root\.usageText/u);
  assert.match(qml, /onHoveredChanged/u);
  assert.match(qml, /Thinking sound/u);
  assert.match(qml, /thinkingVolumeSlider/u);
  assert.match(qml, /volume: root\.thinkingVolume/u);
  assert.match(qml, /function applyRuntimeVisualSettings/u);
  assert.match(qml, /thinkingVolume: root\.thinkingVolume/u);
  assert.match(qml, /responseLanguage: languageBox\.currentText/u);
  assert.match(qml, /chatHistoryEnabled: chatHistoryCheck\.checked/u);
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
  assert.match(qml, /direct_go/u);
  assert.match(qml, /clear_context/u);
  assert.match(qml, /show_context/u);
  assert.match(qml, /context_list/u);
  assert.match(qml, /referenceListPopup/u);
  assert.match(qml, /currentQuestionReferences/u);
  assert.match(qml, /function directGoFromInput/u);
  assert.match(qml, /text: root\.uiText\("directGo"\)/u);
  assert.match(qml, /text: root\.uiText\("refs"\)/u);
  assert.match(qml, /contextEntries/u);
  assert.match(qml, /placeholderText: root\.uiText\("referenceText"\)/u);
  assert.match(qml, /Go sends the entered text, or queued references when the field is empty, directly to the agent/u);
  assert.doesNotMatch(qml, /WebView|WebEngine|Chromium|Electron|Tauri/iu);
});

test("macOS native companion is AppKit and avoids browser/webview imports", async () => {
  const swift = await readFile("visual/macos/VoiceAgentVisual.swift", "utf8");

  assert.match(swift, /import AppKit/u);
  assert.match(swift, /enum UiLanguage: Equatable/u);
  assert.match(swift, /private func localizedText\(_ key: String, language: UiLanguage\)/u);
  assert.match(swift, /private func displayText\(_ rawText: String, state: String, language: UiLanguage\)/u);
  assert.match(swift, /initializeUiLanguageIfNeeded\(tts: event\["tts"\] as\? \[String: Any\], visual: visual\)/u);
  assert.match(swift, /rootView\?\.uiLanguage = uiLanguage/u);
  assert.match(swift, /menuBarCompanion\.uiLanguage = uiLanguage/u);
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
  assert.match(swift, /sessionLabel = NSTextField\(labelWithString: "session: new"\)/u);
  assert.match(swift, /lineBreakMode = \.byTruncatingMiddle/u);
  assert.match(swift, /let visualCenterLift = max\(96, min\(220, bounds\.height \* 0\.20\)\)/u);
  assert.match(swift, /let center = CGPoint\(x: bounds\.midX, y: centerY\)/u);
  assert.match(swift, /func updateSessionId\(_ sessionId: String\)/u);
  assert.match(swift, /func updateUsage\(_ usage: String\)/u);
  assert.match(swift, /settingsApprovalOncePhrasesView/u);
  assert.match(swift, /settingsApprovalPolicyPhrasesView/u);
  assert.match(swift, /settingsApprovalNetworkPolicyPhrasesView/u);
  assert.match(swift, /update_approval_phrases/u);
  assert.match(swift, /settingsStopPhrasesView/u);
  assert.match(swift, /update_stop_phrases/u);
  assert.match(swift, /"policyApprove": approvalPolicyPhrases/u);
  assert.match(swift, /"networkPolicyApprove": approvalNetworkPolicyPhrases/u);
  assert.match(swift, /final class QuestionLabelView: NSView/u);
  assert.match(swift, /private let questionView = QuestionLabelView\(frame: \.zero\)/u);
  assert.match(swift, /func updateQuestion\(_ question: String, references: \[String\] = \[\]\)/u);
  assert.match(swift, /final class ChatHistoryView: NSView/u);
  assert.match(swift, /final class ChatBubbleView: NSView/u);
  assert.match(swift, /private let textView = NSTextView\(frame: \.zero\)/u);
  assert.match(swift, /textView\.isSelectable = true/u);
  assert.match(swift, /private let chatView = ChatHistoryView\(frame: \.zero\)/u);
  assert.match(swift, /private let chatToggleButton = NSButton\(title: "Q\/A"/u);
  assert.match(swift, /func pushChat\(role: String, kind: String, text: String\)/u);
  assert.match(swift, /func updateChatHistory\(enabled: Bool\)/u);
  assert.match(swift, /items\.removeFirst\(items\.count - 10\)/u);
  assert.match(swift, /Recent Q\/A/u);
  assert.match(swift, /Show Recent Q\/A panel/u);
  assert.match(swift, /"recentPopups": "Popups"/u);
  assert.match(swift, /"recentPopups": "팝업"/u);
  assert.match(swift, /Speak wake warning/u);
  assert.match(swift, /"chatHistoryEnabled": chatHistoryEnabled/u);
  assert.match(swift, /"hudEnabled": hudEnabled/u);
  assert.match(swift, /"hudCompact": hudCompact/u);
  assert.match(swift, /"speakWakeRejectedWarnings": speakWakeRejectedWarnings/u);
  assert.match(swift, /case "question":/u);
  assert.match(swift, /case "usage":/u);
  assert.match(swift, /pushChat\(role: "user", kind: "question"/u);
  assert.match(swift, /pushChat\(role: "assistant", kind: "speech"/u);
  assert.match(swift, /pushChat\(role: "assistant", kind: "command"/u);
  assert.match(swift, /pushChat\(role: "assistant", kind: "status"/u);
  assert.match(swift, /bounds\.insetBy\(dx: 14, dy: 11\)/u);
  assert.ok(swift.includes('"Q: \\(question)"'));
  assert.match(swift, /rootView\?\.updateSessionId\(codexThreadId\)/u);
  assert.match(swift, /commandPanel\.frame/u);
  assert.match(swift, /circleView\.frame/u);
  assert.match(swift, /let maxCircle: CGFloat = expanded \? 720 : 360/u);
  assert.match(swift, /var compactStatusStyle = false/u);
  assert.match(swift, /let compactStateText = compactStatusStyle \|\| \(!expandedText && state != "approval_pending" && state != "wake_rejected"\)/u);
  assert.match(swift, /lineBreakMode = compactStateText \? \.byTruncatingTail : \.byWordWrapping/u);
  assert.match(swift, /usesLineFragmentOrigin/u);
  assert.match(swift, /let textInset: CGFloat = compactStateText \? 8 : 24/u);
  assert.match(swift, /width: bounds\.width - textInset \* 2/u);
  assert.match(swift, /roundedRect: backdropRect/u);
  assert.match(swift, /state == "approval_pending" \|\| state == "wake_rejected" \? 13 : 15/u);
  assert.doesNotMatch(swift, /state == "speaking" \? 20/u);
  assert.doesNotMatch(swift, /state == "speaking" \|\| state == "approval_pending" \|\| state == "wake_rejected"/u);
  assert.match(swift, /if !compactStatusStyle && \(state == "approval_pending" \|\| state == "wake_rejected"\)/u);
  assert.match(swift, /state == "approval_pending"/u);
  assert.match(swift, /state == "wake_rejected"/u);
  assert.match(swift, /if !expandedText && state != "wake_rejected"/u);
  assert.match(swift, /\.now\(\) \+ 3\.6/u);
  assert.doesNotMatch(swift, /greaterThanOrEqualToConstant:\s*180/u);
  assert.match(swift, /TTS Stop/u);
  assert.match(swift, /🔇/u);
  assert.match(swift, /"microphoneOn": "microphone on"/u);
  assert.match(swift, /case "microphone on": return localizedText\("microphoneOn", language: language\)/u);
  assert.match(swift, /"audioReconnecting": "audio reconnecting"/u);
  assert.match(swift, /case "audio reconnecting": return localizedText\("audioReconnecting", language: language\)/u);
  assert.match(swift, /mic_toggle/u);
  assert.match(swift, /STOP/u);
  assert.match(swift, /emergency_stop/u);
  assert.match(swift, /Settings/u);
  assert.match(swift, /styleMask: \[\.titled, \.closable, \.resizable\]/u);
  assert.match(swift, /window\.contentMinSize = NSSize\(width: 360, height: 320\)/u);
  assert.match(swift, /NSScrollView\(frame: NSRect\(x: 0, y: 0, width: contentWidth, height: 640\)\)/u);
  assert.match(swift, /scrollView\.hasVerticalScroller = true/u);
  assert.match(swift, /update_tts_settings/u);
  assert.match(swift, /update_wake_phrases/u);
  assert.match(swift, /update_gesture_wake_settings/u);
  assert.match(swift, /update_codex_thread_id/u);
  assert.match(swift, /update_visual_settings/u);
  assert.match(swift, /reset_settings/u);
  assert.match(swift, /Restore Defaults/u);
  assert.match(swift, /settingsWakePhrasesView/u);
  assert.match(swift, /settingsGestureWakePopup/u);
  assert.match(swift, /settingsGestureStopPopup/u);
  assert.match(swift, /settingsGestureApprovalOncePopup/u);
  assert.match(swift, /settingsGestureRunningModePopup/u);
  assert.match(swift, /settingsCustomGestureNameField/u);
  assert.match(swift, /capture_gesture_template/u);
  assert.match(swift, /delete_gesture_template/u);
  assert.match(swift, /clear_custom_gesture_templates/u);
  assert.match(swift, /settingsCustomGestureListContainer/u);
  assert.match(swift, /settingsCustomGestureClearButton/u);
  assert.match(swift, /reset_gesture_wake_settings/u);
  assert.match(swift, /settingsCodexThreadField/u);
  assert.match(swift, /Codex Thread/u);
  assert.match(swift, /settingsThinkingVolumeField/u);
  assert.match(swift, /settingsReactionModePopup/u);
  assert.match(swift, /settingsMaxUtteranceField/u);
  assert.match(swift, /Max Speech/u);
  assert.match(swift, /NSTextFieldDelegate/u);
  assert.match(swift, /settingsMaxUtteranceField\.delegate = self/u);
  assert.match(swift, /func controlTextDidChange/u);
  assert.match(swift, /field\.stringValue = "55"/u);
  assert.match(swift, /addSettingsHelp/u);
  assert.match(swift, /compact: true/u);
  assert.match(swift, /bezelStyle = \.circular/u);
  assert.match(swift, /width: 16, height: 16/u);
  assert.match(swift, /"maxSpeechHelp": "한 번에 받을 always-on 발화 최대 길이입니다/u);
  assert.match(swift, /settingsHudCheckbox/u);
  assert.match(swift, /settingsPopupPreferredCheckbox/u);
  assert.match(swift, /Prefer popup for long answers/u);
  assert.match(swift, /"popupPreferred": popupPreferred/u);
  assert.match(swift, /"reactionMode": reactionMode/u);
  assert.match(swift, /Particle orb/u);
  assert.match(swift, /final class ParticleOrbView: NSView/u);
  assert.match(swift, /settingsReactionModePopup\.addValueItemsIfNeeded\(\["audio_circle", "particle_orb"\]/u);
  assert.match(swift, /rootView\?\.updateReactionMode\(reactionMode\)/u);
  assert.match(swift, /case "popup":/u);
  assert.match(swift, /case "popup_history":/u);
  assert.match(swift, /private var recentPopups: \[PopupHistoryEntry\] = \[\]/u);
  assert.match(swift, /@objc private func showRecentPopups/u);
  assert.match(swift, /combinedRecentPopupMarkdown/u);
  assert.match(swift, /final class PopupPanelController/u);
  assert.match(swift, /import WebKit/u);
  assert.match(swift, /WKWebView/u);
  assert.match(swift, /katexAssetTags/u);
  assert.match(swift, /renderMathInElement/u);
  assert.match(swift, /katex\.min\.js/u);
  assert.match(swift, /auto-render\.min\.js/u);
  assert.match(swift, /katex\.min\.css/u);
  assert.match(swift, /readUtf8File/u);
  assert.match(swift, /scriptEscaped/u);
  assert.match(swift, /function renderPopupMath/u);
  assert.ok(swift.includes('document.querySelectorAll(".math-display[data-tex]")'));
  assert.match(swift, /window\.katex\.render/u);
  assert.match(swift, /private func displayMathHtml/u);
  assert.match(swift, /private func oneLineDisplayMath/u);
  assert.match(swift, /private func openedDisplayMathBlock/u);
  assert.ok(swift.includes('<div class=\\"math-display\\" data-tex='));
  assert.match(swift, /document\.addEventListener\("DOMContentLoaded", renderPopupMath\)/u);
  assert.match(swift, /private func markdownAttributedString/u);
  assert.match(swift, /NSPasteboard\.general\.setString\(rawText, forType: \.string\)/u);
  assert.match(swift, /toggleButton\.action = #selector\(toggleMode\)/u);
  assert.match(swift, /styleMask: \[\.titled, \.closable, \.resizable, \.utilityWindow\]/u);
  assert.match(swift, /panel\?\.makeKeyAndOrderFront\(nil\)/u);
  assert.match(swift, /panel\?\.orderFrontRegardless\(\)/u);
  assert.match(swift, /NSApp\.activate\(ignoringOtherApps: true\)/u);
  assert.match(swift, /Show floating HUD/u);
  assert.match(swift, /Thinking Fx/u);
  assert.match(swift, /thinkingPulseSound\.volume/u);
  assert.match(swift, /updateVisualSettings/u);
  assert.match(swift, /"thinkingVolume": thinkingVolume/u);
  assert.match(swift, /"responseLanguage": responseLanguage/u);
  assert.match(swift, /final class HoverHelpButton/u);
  assert.match(swift, /final class FloatingHudPanel: NSPanel/u);
  assert.match(swift, /override var canBecomeKey: Bool \{ true \}/u);
  assert.match(swift, /final class MenuBarCompanion/u);
  assert.match(swift, /hudCameraButton/u);
  assert.match(swift, /camera_toggle/u);
  assert.match(swift, /cameraGestureCancelled/u);
  assert.match(swift, /NSStatusBar\.system\.statusItem/u);
  assert.match(swift, /compactState\("idle"\)/u);
  assert.match(swift, /private var hudPanel: NSPanel\?/u);
  assert.match(swift, /private var hudCompact = false/u);
  assert.match(swift, /func setHudCompact\(_ compact: Bool\)/u);
  assert.match(swift, /@objc private func toggleHudCompact\(\)/u);
  assert.match(swift, /onHudCompactChange: @escaping \(Bool\) -> Void/u);
  assert.match(swift, /hudCompact \? NSSize\(width: 116, height: 116\) : NSSize\(width: 326, height: 264\)/u);
  assert.match(swift, /hudCircle\.frame = hudCompact/u);
  assert.match(swift, /hudStateLabel\.isHidden = hudCompact/u);
  assert.match(swift, /hudCompactButton\?\.title = hudCompact \? "↗" : "−"/u);
  assert.match(swift, /onHudCompactChange: \{ \[weak self\] compact in self\?\.updateHudCompact\(compact, sendSettings: true\) \}/u);
  assert.match(swift, /private func sendVisualSettings\(\)/u);
  assert.match(swift, /private let hudUsageLabel = NSTextField/u);
  assert.match(swift, /menuBarCompanion\.updateUsage\(usage\)/u);
  assert.match(swift, /FloatingHudPanel\(/u);
  assert.match(swift, /styleMask: \[\.borderless, \.nonactivatingPanel\]/u);
  assert.match(swift, /func configureHudPanel\(\)/u);
  assert.match(swift, /panel\.level = \.floating/u);
  assert.match(swift, /panel\.collectionBehavior = \[\s*\.canJoinAllSpaces,\s*\.fullScreenAuxiliary,\s*\.stationary\s*\]/u);
  assert.match(swift, /panel\.orderFrontRegardless\(\)/u);
  assert.match(swift, /showFloatingHud\(\)\s*\n\s*popover\.show/u);
  assert.doesNotMatch(swift, /panel\.orderOut\(nil\)\s*\n\s*panel\.orderFrontRegardless\(\)/u);
  assert.match(swift, /hudCircle = AgentCircleView\(frame: \.zero\)/u);
  assert.match(swift, /hudOrb = ParticleOrbView\(frame: \.zero\)/u);
  assert.match(swift, /hudQuestionLabel = NSTextField\(wrappingLabelWithString: ""\)/u);
  assert.match(swift, /hudQuestionLabel\.stringValue = trimmed\.isEmpty \? "" : "Q: \\\(trimmed\)"/u);
  assert.match(swift, /hudCircle\.compactStatusStyle = true/u);
  assert.match(swift, /private let hudContextField = NSTextField\(string: ""\)/u);
  assert.match(swift, /private let hudContextSummary = NSTextField\(labelWithString: "No references queued"\)/u);
  assert.match(swift, /onAddContext: @escaping \(String\) -> Void/u);
  assert.match(swift, /onDirectContext: @escaping \(String\) -> Void/u);
  assert.match(swift, /onClearContext: @escaping \(\) -> Void/u);
  assert.match(swift, /func updateVolume\(rms: CGFloat, peak: CGFloat\)/u);
  assert.match(swift, /func update\(state: String, text: String\)/u);
  assert.match(swift, /hudCircle\.statusText = stateText\(state, language: uiLanguage\)/u);
  assert.doesNotMatch(swift, /hudCircle\.statusText = text\.isEmpty \? state : text/u);
  assert.match(swift, /func updateQuestion\(_ question: String, references: \[String\] = \[\]\)/u);
  assert.match(swift, /func updateContext\(_ entries: \[String\]\)/u);
  assert.match(swift, /func updateMicEnabled\(_ enabled: Bool\)/u);
  const hudUpdateMessage = swift.match(/func updateMessage\(_ text: String\) \{[\s\S]*?\n    \}/u);
  assert.ok(hudUpdateMessage);
  assert.match(hudUpdateMessage[0], /hudDetailLabel\.stringValue = trimmed/u);
  assert.doesNotMatch(hudUpdateMessage[0], /hudCircle\.statusText\s*=/u);
  assert.match(swift, /private let menuBarCompanion = MenuBarCompanion\(\)/u);
  assert.match(swift, /menuBarCompanion\.install/u);
  assert.match(swift, /onAddContext: \{ \[weak self\] text in self\?\.submitContext\(text\) \}/u);
  assert.match(swift, /onDirectContext: \{ \[weak self\] text in self\?\.submitDirectContext\(text\) \}/u);
  assert.match(swift, /onClearContext: \{ \[weak self\] in self\?\.clearContext\(\) \}/u);
  assert.match(swift, /menuBarCompanion\.update\(state: circleView\.state, text: circleView\.statusText\)/u);
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
  assert.match(swift, /direct_go/u);
  assert.match(swift, /clear_context/u);
  assert.match(swift, /show_context/u);
  assert.match(swift, /context_list/u);
  assert.match(swift, /showContextList/u);
  assert.match(swift, /showContextButton/u);
  assert.match(swift, /Queued References/u);
  assert.match(swift, /placeholderString = localizedText\("referenceText", language: uiLanguage\)/u);
  assert.match(swift, /hudContextField\.placeholderString = localizedText\("referenceText", language: uiLanguage\)/u);
  assert.match(swift, /hudContextField\.isEditable = true/u);
  assert.match(swift, /hudContextField\.isSelectable = true/u);
  assert.match(swift, /hudContextField\.action = #selector\(addContext\)/u);
  assert.match(swift, /Go sends the entered text, or queued references when the field is empty, directly to the agent/u);
  assert.match(swift, /No references queued/u);
  assert.doesNotMatch(swift, /Electron|Tauri/iu);
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
