import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { CommandHandLandmarkProvider, parseHandLandmarkProviderLine } from "../src/gesture/CommandHandLandmarkProvider.ts";
import { LandmarkGestureClassifier, normalizedHandVector } from "../src/gesture/GestureClassifier.ts";
import type { HandLandmark, HandLandmarkFrame, HandLandmarkProvider } from "../src/gesture/HandLandmarkProvider.ts";
import { parseCameraGestureWatcherLine } from "../src/gesture/CommandCameraGestureWatcher.ts";
import { parseCameraPermissionStatus } from "../src/gesture/CommandCameraPermissionManager.ts";
import { GestureActionStateMachine } from "../src/gesture/GestureActionStateMachine.ts";
import {
  defaultGestureWakeConfig,
  gestureWakeConfigForRuntime,
  sanitizeGestureWakeConfig
} from "../src/gesture/GestureWakeConfig.ts";
import { LandmarkCameraGestureWatcher } from "../src/gesture/LandmarkCameraGestureWatcher.ts";

test("gesture wake config uses safe defaults and parses bindings", () => {
  const config = sanitizeGestureWakeConfig({
    enabled: true,
    fps: "8",
    resolution: "800x600",
    holdMs: "900",
    cooldownMs: "2000",
    runningMode: "emergency_only",
    bindings: {
      wake: "peace",
      stop: "fist",
      "approval.once": "thumbs_up",
      "approval.deny": "thumbs_down"
    }
  });

  assert.equal(config.enabled, true);
  assert.equal(config.fps, 8);
  assert.equal(config.resolution.label, "800x600");
  assert.equal(config.holdMs, 900);
  assert.equal(config.cooldownMs, 2000);
  assert.equal(config.runningMode, "emergency_only");
  assert.deepEqual(config.bindings, {
    wake: "peace",
    stop: "fist",
    "approval.once": "thumbs_up",
    "approval.deny": "thumbs_down"
  });
});

test("gesture wake config parses custom gesture templates and bindings", () => {
  const vector = Array.from({ length: 42 }, (_, index) => index / 100);
  const config = sanitizeGestureWakeConfig({
    bindings: {
      wake: "custom:wave"
    },
    customGestures: [{
      name: "custom:wave",
      label: "Wave",
      vector,
      threshold: 0.3,
      samples: 8,
      createdAt: 1000
    }]
  });

  assert.equal(config.bindings.wake, "custom:wave");
  assert.deepEqual(config.customGestures, [{
    name: "custom:wave",
    label: "Wave",
    vector,
    threshold: 0.3,
    samples: 8,
    createdAt: 1000
  }]);
});

test("camera permission command output is parsed defensively", () => {
  assert.equal(parseCameraPermissionStatus("authorized\n"), "authorized");
  assert.equal(parseCameraPermissionStatus("not-determined"), "not_determined");
  assert.equal(parseCameraPermissionStatus("denied"), "denied");
  assert.equal(parseCameraPermissionStatus("restricted"), "restricted");
  assert.equal(parseCameraPermissionStatus("something else"), "unavailable");
});

test("camera gesture watcher parses NDJSON events defensively", () => {
  assert.deepEqual(parseCameraGestureWatcherLine('{"type":"gesture","gesture":"open_palm","timestamp":10,"confidence":0.8}'), {
    type: "gesture",
    gesture: "open_palm",
    timestamp: 10,
    confidence: 0.8
  });
  assert.deepEqual(parseCameraGestureWatcherLine('{"type":"status","enabled":true,"mode":"idle","text":"ready"}'), {
    enabled: true,
    mode: "idle",
    text: "ready"
  });
  assert.equal(parseCameraGestureWatcherLine("not-json"), null);
  assert.equal(parseCameraGestureWatcherLine('{"type":"gesture","gesture":"bad"}'), null);
});

test("hand landmark provider parses landmark NDJSON events defensively", () => {
  assert.deepEqual(parseHandLandmarkProviderLine('{"type":"landmarks","timestamp":10,"landmarks":[{"name":"wrist","x":0.5,"y":0.2,"confidence":0.9}]}'), {
    type: "landmarks",
    timestamp: 10,
    landmarks: [
      {
        name: "wrist",
        x: 0.5,
        y: 0.2,
        confidence: 0.9
      }
    ]
  });
  assert.deepEqual(parseHandLandmarkProviderLine('{"type":"status","enabled":true,"mode":"idle","text":"ready"}'), {
    type: "status",
    enabled: true,
    mode: "idle",
    text: "ready"
  });
  assert.equal(parseHandLandmarkProviderLine("not-json"), null);
  assert.equal(parseHandLandmarkProviderLine('{"type":"landmarks","landmarks":[{"name":"bad","x":0,"y":0,"confidence":1}]}')?.type, "landmarks");
});

test("command hand landmark provider ignores intentionally stopped old child after restart", async () => {
  const processes: FakeHandLandmarkProcess[] = [];
  const provider = new CommandHandLandmarkProvider({
    command: "gesture-helper",
    spawnProcess: () => {
      const process = new FakeHandLandmarkProcess();
      processes.push(process);
      return process;
    }
  });
  const errors: string[] = [];

  await provider.start({
    fps: 5,
    width: 640,
    height: 480,
    mode: "idle",
    onFrame: () => {},
    onError: (error) => errors.push(error.message)
  });
  await provider.start({
    fps: 5,
    width: 640,
    height: 480,
    mode: "idle",
    onFrame: () => {},
    onError: (error) => errors.push(error.message)
  });
  processes[0]?.emitExit(null, "SIGTERM");
  processes[1]?.emitExit(1, null);

  assert.deepEqual(errors, ["hand landmark provider stopped code=1 signal=null"]);
});

test("command hand landmark provider reports stderr as disabled status", async () => {
  const process = new FakeHandLandmarkProcess();
  const provider = new CommandHandLandmarkProvider({
    command: "gesture-helper",
    spawnProcess: () => process
  });
  const statuses: Array<{ enabled: boolean; text?: string }> = [];

  await provider.start({
    fps: 5,
    width: 640,
    height: 480,
    mode: "idle",
    onFrame: () => {},
    onStatus: (status) => statuses.push(status)
  });
  process.emitStderr("swift crash");

  assert.deepEqual(statuses, [{
    enabled: false,
    mode: "idle",
    text: "swift crash"
  }]);
});

test("landmark gesture classifier returns gesture names only", () => {
  const classifier = new LandmarkGestureClassifier();

  assert.equal(classifier.classify({
    timestamp: 1,
    landmarks: makeOpenPalmLandmarks()
  }).gesture, "open_palm");

  assert.equal(classifier.classify({
    timestamp: 2,
    landmarks: makeThumbsDownLandmarks()
  }).gesture, "thumbs_down");
});

test("landmark gesture classifier matches active custom templates", () => {
  const landmarks = makeOpenPalmLandmarks();
  const vector = normalizedHandVector(landmarks);
  assert.ok(vector);

  const classifier = new LandmarkGestureClassifier({
    customGestures: [{
      name: "custom:my_palm",
      label: "My palm",
      vector,
      threshold: 0.22,
      samples: 5,
      createdAt: 1000
    }]
  });

  assert.equal(classifier.classify({
    timestamp: 1,
    landmarks
  }).gesture, "custom:my_palm");
});

test("landmark camera watcher maps provider frames through the classifier", async () => {
  const provider = new FakeHandLandmarkProvider();
  const watcher = new LandmarkCameraGestureWatcher({
    createProvider: () => provider
  });
  const gestures: string[] = [];
  const statuses: string[] = [];
  watcher.onGesture((observation) => gestures.push(observation.gesture));
  watcher.onStatus((status) => statuses.push(status.mode));

  await watcher.start({
    ...defaultGestureWakeConfig,
    enabled: true
  });
  watcher.setMode("idle");
  await Promise.resolve();
  provider.emitFrame({
    timestamp: 1000,
    landmarks: makeOpenPalmLandmarks()
  });
  await watcher.stop();

  assert.deepEqual(gestures, ["open_palm"]);
  assert.deepEqual(provider.starts, [{
    fps: 15,
    width: 640,
    height: 480,
    mode: "idle"
  }]);
  assert.equal(statuses.includes("idle"), true);
  assert.equal(provider.stopCount >= 1, true);
});

test("landmark camera watcher keeps provider running across active camera modes", async () => {
  const provider = new FakeHandLandmarkProvider();
  const watcher = new LandmarkCameraGestureWatcher({
    createProvider: () => provider
  });
  const gestures: string[] = [];
  const statuses: string[] = [];
  watcher.onGesture((observation) => gestures.push(observation.gesture));
  watcher.onStatus((status) => statuses.push(status.mode));

  await watcher.start({
    ...defaultGestureWakeConfig,
    enabled: true
  });
  watcher.setMode("idle");
  await Promise.resolve();
  watcher.setMode("running");
  await Promise.resolve();
  provider.emitFrame({
    timestamp: 1000,
    landmarks: makeOpenPalmLandmarks()
  });
  await watcher.stop();

  assert.deepEqual(gestures, ["open_palm"]);
  assert.equal(provider.starts.length, 1);
  assert.equal(statuses.includes("running"), true);
});

test("landmark camera watcher captures custom gesture templates from frames", async () => {
  const provider = new FakeHandLandmarkProvider();
  const watcher = new LandmarkCameraGestureWatcher({
    createProvider: () => provider
  });

  await watcher.start({
    ...defaultGestureWakeConfig,
    enabled: true
  });
  watcher.setMode("idle");
  await Promise.resolve();

  const capture = watcher.captureCustomGestureTemplate({
    name: "custom:test",
    label: "Test",
    durationMs: 10,
    minSamples: 1
  });
  provider.emitFrame({
    timestamp: 1000,
    landmarks: makeOpenPalmLandmarks()
  });
  const template = await capture;
  await watcher.stop();

  assert.equal(template.name, "custom:test");
  assert.equal(template.label, "Test");
  assert.equal(template.samples, 1);
  assert.equal(template.vector.length, 42);
});

test("gesture runtime enablement requires --cam", () => {
  assert.equal(gestureWakeConfigForRuntime({ ...defaultGestureWakeConfig, enabled: true }, false).enabled, false);
  assert.equal(gestureWakeConfigForRuntime({ ...defaultGestureWakeConfig, enabled: false }, true).enabled, true);
});

test("gesture state machine triggers only after hold and suppresses cooldown", () => {
  const machine = new GestureActionStateMachine({
    config: {
      ...defaultGestureWakeConfig,
      enabled: true,
      holdMs: 700,
      cooldownMs: 1500
    }
  });

  assert.equal(machine.observe({ gesture: "open_palm", timestamp: 1000 }), null);
  assert.equal(machine.observe({ gesture: "open_palm", timestamp: 1600 }), null);
  assert.deepEqual(machine.observe({ gesture: "open_palm", timestamp: 1700 }), {
    action: "wake",
    gesture: "open_palm",
    state: "idle",
    cameraMode: "idle",
    timestamp: 1700
  });
  assert.equal(machine.observe({ gesture: "open_palm", timestamp: 2400 }), null);
});

test("gesture state machine maps stop and approval by runtime state", () => {
  const machine = new GestureActionStateMachine({
    config: {
      ...defaultGestureWakeConfig,
      enabled: true,
      holdMs: 500,
      cooldownMs: 0,
      runningMode: "emergency_only",
      bindings: {
        wake: "open_palm",
        stop: "thumbs_down",
        "approval.once": "thumbs_up",
        "approval.deny": "fist"
      }
    }
  });

  machine.setState("listening");
  machine.observe({ gesture: "thumbs_down", timestamp: 1000 });
  assert.equal(machine.observe({ gesture: "thumbs_down", timestamp: 1500 })?.action, "stop");

  machine.setState("running");
  machine.observe({ gesture: "thumbs_down", timestamp: 2000 });
  assert.equal(machine.observe({ gesture: "thumbs_down", timestamp: 2500 })?.action, "stop");

  machine.setState("pending_approval");
  machine.observe({ gesture: "thumbs_down", timestamp: 3000 });
  assert.equal(machine.observe({ gesture: "thumbs_down", timestamp: 3500 })?.action, "stop");

  machine.observe({ gesture: "thumbs_up", timestamp: 4000 });
  assert.equal(machine.observe({ gesture: "thumbs_up", timestamp: 4500 })?.action, "approval.once");

  machine.observe({ gesture: "fist", timestamp: 5000 });
  assert.equal(machine.observe({ gesture: "fist", timestamp: 5500 })?.action, "approval.deny");

  const runningOff = new GestureActionStateMachine({
    config: {
      ...defaultGestureWakeConfig,
      enabled: true,
      holdMs: 500,
      cooldownMs: 0,
      runningMode: "off"
    }
  });
  runningOff.setState("running");
  runningOff.observe({ gesture: "thumbs_down", timestamp: 6000 });
  assert.equal(runningOff.observe({ gesture: "thumbs_down", timestamp: 6500 })?.action, "stop");
});

test("gesture state machine keeps camera active while running unless emergency mode is enabled", () => {
  const off = new GestureActionStateMachine({
    config: {
      ...defaultGestureWakeConfig,
      enabled: true,
      runningMode: "off"
    }
  });
  off.setState("running");
  assert.equal(off.getCameraMode(), "running");

  const emergency = new GestureActionStateMachine({
    config: {
      ...defaultGestureWakeConfig,
      enabled: true,
      runningMode: "emergency_only"
    }
  });
  emergency.setState("running");
  assert.equal(emergency.getCameraMode(), "emergency");
});

function makeOpenPalmLandmarks(): HandLandmark[] {
  return [
    landmark("wrist", 0.5, 0.1),
    landmark("thumbCMC", 0.4, 0.2),
    landmark("thumbMP", 0.34, 0.32),
    landmark("thumbIP", 0.28, 0.44),
    landmark("thumbTip", 0.2, 0.55),
    landmark("indexMCP", 0.36, 0.34),
    landmark("middleMCP", 0.5, 0.35),
    landmark("indexPIP", 0.32, 0.54),
    landmark("indexDIP", 0.29, 0.68),
    landmark("indexTip", 0.26, 0.82),
    landmark("middlePIP", 0.45, 0.58),
    landmark("middleDIP", 0.445, 0.73),
    landmark("middleTip", 0.44, 0.88),
    landmark("ringMCP", 0.58, 0.34),
    landmark("ringPIP", 0.58, 0.56),
    landmark("ringDIP", 0.6, 0.69),
    landmark("ringTip", 0.62, 0.82),
    landmark("littleMCP", 0.66, 0.32),
    landmark("littlePIP", 0.68, 0.5),
    landmark("littleDIP", 0.71, 0.61),
    landmark("littleTip", 0.75, 0.72)
  ];
}

function makeThumbsDownLandmarks(): HandLandmark[] {
  return [
    landmark("wrist", 0.5, 0.55),
    landmark("thumbIP", 0.5, 0.38),
    landmark("thumbTip", 0.5, 0.25),
    landmark("indexPIP", 0.4, 0.48),
    landmark("indexTip", 0.39, 0.45),
    landmark("middlePIP", 0.48, 0.5),
    landmark("middleTip", 0.47, 0.46),
    landmark("ringPIP", 0.56, 0.5),
    landmark("ringTip", 0.55, 0.46),
    landmark("littlePIP", 0.64, 0.48),
    landmark("littleTip", 0.63, 0.44)
  ];
}

function landmark(name: HandLandmark["name"], x: number, y: number): HandLandmark {
  return {
    name,
    x,
    y,
    confidence: 0.9
  };
}

class FakeHandLandmarkProvider implements HandLandmarkProvider {
  readonly starts: Array<{ fps: number; width: number; height: number; mode: string | undefined }> = [];
  stopCount = 0;
  private onFrame: ((frame: HandLandmarkFrame) => void) | undefined;

  async start(options: Parameters<HandLandmarkProvider["start"]>[0]): Promise<void> {
    this.starts.push({
      fps: options.fps,
      width: options.width,
      height: options.height,
      mode: options.mode
    });
    this.onFrame = options.onFrame;
    options.onStatus?.({
      enabled: true,
      mode: options.mode ?? "idle"
    });
  }

  async stop(): Promise<void> {
    this.stopCount += 1;
  }

  emitFrame(frame: HandLandmarkFrame): void {
    this.onFrame?.(frame);
  }
}

class FakeHandLandmarkProcess extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();

  kill(_signal?: NodeJS.Signals): boolean {
    return true;
  }

  emitExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.emit("exit", code, signal);
  }

  emitStderr(text: string): void {
    this.stderr.emit("data", Buffer.from(text));
  }
}
