import { EventEmitter } from "node:events";
import assert from "node:assert/strict";
import test from "node:test";

import { parseRecorderStatusLine, RecorderCommandAudioInput } from "../src/audio/RecorderCommandAudioInput.ts";

test("recorder status parser accepts structured status and error lines", () => {
  assert.deepEqual(parseRecorderStatusLine("[audio:status] reconfiguring configuration_changed", () => 1234), {
    status: "reconfiguring",
    timestamp: 1234,
    message: "configuration_changed"
  });

  assert.deepEqual(parseRecorderStatusLine("[audio:error] fatal input device disappeared", () => 1235), {
    status: "failed",
    timestamp: 1235,
    message: "fatal input device disappeared",
    fatal: true
  });

  assert.equal(parseRecorderStatusLine("plain recorder warning", () => 1236), null);
});

test("recorder command input emits parsed audio status without requiring audio frames", async () => {
  const processes: FakeRecorderProcess[] = [];
  const input = new RecorderCommandAudioInput({
    command: "fake-recorder",
    spawnProcess: () => {
      const process = new FakeRecorderProcess();
      processes.push(process);
      return process;
    },
    now: () => 2000,
    statusHeartbeatTimeoutMs: 0
  });
  const statuses: string[] = [];
  input.onStatus((event) => statuses.push(event.status));

  await input.start();
  processes[0]?.emitStderr("[audio:status] running\n[audio:status] reconfiguring configuration_changed\n[audio:status] running\n");
  await flushAsync();
  await input.stop();

  assert.deepEqual(statuses, ["starting", "running", "reconfiguring", "running", "stopped"]);
  assert.equal(processes.length, 1);
});

test("recorder command input does not restart during ordinary silence with healthy status", async () => {
  const processes: FakeRecorderProcess[] = [];
  const input = new RecorderCommandAudioInput({
    command: "fake-recorder",
    spawnProcess: () => {
      const process = new FakeRecorderProcess();
      processes.push(process);
      return process;
    },
    now: () => 3000,
    restartDelayMs: 1,
    statusHeartbeatTimeoutMs: 50
  });

  await input.start();
  processes[0]?.emitStderr("[audio:status] running heartbeat\n");
  await new Promise((resolve) => setTimeout(resolve, 10));
  await input.stop();

  assert.equal(processes.length, 1);
});

test("recorder command input restarts after fatal recorder exit", async () => {
  const processes: FakeRecorderProcess[] = [];
  const input = new RecorderCommandAudioInput({
    command: "fake-recorder",
    spawnProcess: () => {
      const process = new FakeRecorderProcess();
      processes.push(process);
      return process;
    },
    now: () => 4000,
    restartDelayMs: 1,
    statusHeartbeatTimeoutMs: 0
  });
  const statuses: string[] = [];
  input.onStatus((event) => statuses.push(event.status));

  await input.start();
  processes[0]?.exit(1, null);
  await new Promise((resolve) => setTimeout(resolve, 10));
  await input.stop();

  assert.equal(processes.length, 2);
  assert.deepEqual(statuses.slice(0, 4), ["starting", "failed", "restarting", "starting"]);
});

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

class FakeRecorderProcess {
  readonly stdout = new FakeProcessReadable();
  readonly stderr = new FakeProcessReadable();
  private readonly emitter = new EventEmitter();
  killed = false;

  kill(signal?: NodeJS.Signals): boolean {
    this.killed = true;
    setImmediate(() => this.exit(null, signal ?? "SIGTERM"));
    return true;
  }

  on(event: "error", callback: (error: Error) => void): unknown;
  on(event: "exit", callback: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  on(event: "error" | "exit", callback: (...args: unknown[]) => void): unknown {
    this.emitter.on(event, callback);
    return this;
  }

  emitStderr(text: string): void {
    this.stderr.emitData(text);
  }

  exit(code: number | null, signal: NodeJS.Signals | null): void {
    this.emitter.emit("exit", code, signal);
  }
}

class FakeProcessReadable {
  private readonly emitter = new EventEmitter();

  on(event: "data", callback: (chunk: Buffer | string) => void): unknown {
    this.emitter.on(event, callback);
    return this;
  }

  emitData(text: string): void {
    this.emitter.emit("data", text);
  }
}
