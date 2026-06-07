import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { ClaudeCodeBackend } from "../src/claude/ClaudeCodeBackend.ts";

test("reports the local Claude CLI failure without pretending support exists", async () => {
  const child = new FakeProbeProcess();
  const lines: string[] = [];
  const backend = new ClaudeCodeBackend({
    spawnProcess: () => child,
    writeLine: (line) => lines.push(line)
  });

  const started = backend.start();
  child.stderr.emit("data", "TypeError: Cannot read properties of undefined (reading 'prototype')\n");
  child.stderr.emit("data", "Node.js v25.8.2\n");
  child.emit("exit", 1, null);

  await assert.rejects(started, /TypeError: Cannot read properties of undefined.*Node\.js v25\.8\.2/u);
  assert.match(lines.at(-1) ?? "", /Claude Code CLI exited with code 1/u);
});

test("reports missing structured Claude approval transport after a successful probe", async () => {
  const child = new FakeProbeProcess();
  const backend = new ClaudeCodeBackend({
    spawnProcess: () => child
  });

  const started = backend.start();
  child.stdout.emit("data", "1.2.3\n");
  child.emit("exit", 0, null);

  await assert.rejects(started, /structured approval transport for Claude Code/u);
});

class FakeProbeProcess extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  killed = false;

  kill(_signal?: NodeJS.Signals): boolean {
    this.killed = true;
    return true;
  }
}
