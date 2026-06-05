import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { TerminalHarness } from "../src/app/harness.ts";
import { CodexAppServerBackend } from "../src/codex/CodexAppServerBackend.ts";
import type { CodexStatus } from "../src/codex/CodexOutputEvent.ts";
import type { PermissionDecision } from "../src/permission/PermissionDecision.ts";
import type { PermissionRequest } from "../src/permission/PermissionRequest.ts";

test("starts Codex app-server, initializes, and opens a thread", async () => {
  const child = new FakeAppServerProcess();
  const socket = new FakeWebSocket();
  const spawns: Array<{ command: string; args: string[]; cwd?: string }> = [];
  const backend = new CodexAppServerBackend({
    command: "codex-test",
    args: ["app-server", "--listen", "ws://127.0.0.1:0"],
    cwd: "/repo",
    spawnProcess: (command, args, options) => {
      spawns.push({ command, args, cwd: options.cwd });
      return child;
    },
    createWebSocket: () => socket
  });
  const statuses: CodexStatus[] = [];
  backend.onStatus((status) => statuses.push(status));

  const started = backend.start();
  child.stderr.emit("data", "codex app-server\n  listening on: ws://127.0.0.1:1234\n");
  await Promise.resolve();
  socket.open();
  await started;

  assert.deepEqual(spawns[0], {
    command: "codex-test",
    args: ["app-server", "--listen", "ws://127.0.0.1:0"],
    cwd: "/repo"
  });
  assert.equal(socket.sent[0].method, "initialize");
  assert.equal(socket.sent[1].method, "thread/start");
  assert.equal(socket.sent[1].params.cwd, "/repo");
  assert.equal(statuses.at(-1)?.process, "running");
});

test("resumes a stored Codex app-server thread when available", async () => {
  const child = new FakeAppServerProcess();
  const socket = new FakeWebSocket();
  const saved: string[] = [];
  const backend = new CodexAppServerBackend({
    cwd: "/repo",
    threadStore: {
      async load() {
        return "thread_saved";
      },
      async save(threadId) {
        saved.push(threadId);
      }
    },
    spawnProcess: () => child,
    createWebSocket: () => socket
  });

  const started = backend.start();
  child.stdout.emit("data", "listening on: ws://127.0.0.1:1234\n");
  await Promise.resolve();
  socket.open();
  await started;

  assert.equal(socket.sent[1].method, "thread/resume");
  assert.equal(socket.sent[1].params.threadId, "thread_saved");
  assert.equal(socket.sent[1].params.cwd, "/repo");
  assert.deepEqual(saved, ["thread_saved"]);
});

test("starts a new Codex app-server thread when stored resume fails", async () => {
  const child = new FakeAppServerProcess();
  const socket = new FakeWebSocket();
  socket.resumeError = "thread not found";
  const saved: string[] = [];
  const lines: string[] = [];
  const backend = new CodexAppServerBackend({
    cwd: "/repo",
    threadStore: {
      async load() {
        return "missing_thread";
      },
      async save(threadId) {
        saved.push(threadId);
      }
    },
    writeLine: (line) => lines.push(line),
    spawnProcess: () => child,
    createWebSocket: () => socket
  });

  const started = backend.start();
  child.stdout.emit("data", "listening on: ws://127.0.0.1:1234\n");
  await Promise.resolve();
  socket.open();
  await started;

  assert.equal(socket.sent[1].method, "thread/resume");
  assert.equal(socket.sent[2].method, "thread/start");
  assert.deepEqual(saved, ["thread_1"]);
  assert.equal(lines.some((line) => line.includes("thread/resume failed for missing_thread")), true);
});

test("sends prompts as turn/start requests", async () => {
  const { backend, child, socket } = createStartedBackend();

  const started = backend.start();
  child.stdout.emit("data", "listening on: ws://127.0.0.1:1234\n");
  await Promise.resolve();
  socket.open();
  await started;
  await backend.sendPrompt({
    sessionId: "sess_1",
    text: "테스트 돌려줘",
    language: "ko",
    source: "voice",
    mode: "submit"
  });

  const turnStart = socket.sent.find((message) => message.method === "turn/start");
  assert.equal(turnStart?.params.threadId, "thread_1");
  assert.deepEqual(turnStart?.params.input, [
    {
      type: "text",
      text: "테스트 돌려줘",
      text_elements: []
    }
  ]);
});

test("can prepend the voice-agent protocol prompt to real turn/start requests", async () => {
  const { backend, child, socket } = createStartedBackend({
    voiceAgentProtocol: true,
    voiceAgentProtocolPrompt: "Respond as voice-agent NDJSON."
  });

  const started = backend.start();
  child.stdout.emit("data", "listening on: ws://127.0.0.1:1234\n");
  await Promise.resolve();
  socket.open();
  await started;
  await backend.sendPrompt({
    sessionId: "sess_1",
    text: "테스트 돌려줘",
    language: "ko",
    source: "voice",
    mode: "submit"
  });

  const turnStart = socket.sent.find((message) => message.method === "turn/start");
  assert.deepEqual(turnStart?.params.input, [
    {
      type: "text",
      text: "Respond as voice-agent NDJSON.",
      text_elements: []
    },
    {
      type: "text",
      text: "테스트 돌려줘",
      text_elements: []
    }
  ]);
});

test("routes app-server approval requests to RuntimeController and sends decisions back", async () => {
  const { backend, child, socket } = createStartedBackend();
  const permissions: PermissionRequest[] = [];
  backend.onPermissionRequest((request) => permissions.push(request));

  const started = backend.start();
  child.stdout.emit("data", "listening on: ws://127.0.0.1:1234\n");
  await Promise.resolve();
  socket.open();
  await started;
  await backend.sendPrompt({
    sessionId: "sess_1",
    text: "테스트 돌려줘",
    language: "ko",
    source: "voice",
    mode: "submit"
  });
  socket.receive({
    id: "approval_1",
    method: "item/commandExecution/requestApproval",
    params: {
      command: "npm test",
      cwd: "/repo"
    }
  });
  await backend.sendPermission(permission("approval_1", "allow"));

  assert.equal(permissions.length, 1);
  assert.equal(permissions[0].command, "npm test");
  assert.deepEqual(socket.sent.at(-1), {
    id: "approval_1",
    result: {
      decision: "accept"
    }
  });
});

test("maps session approval only when Codex offers a session decision", async () => {
  const { backend, child, socket } = createStartedBackend();
  const permissions: PermissionRequest[] = [];
  backend.onPermissionRequest((request) => permissions.push(request));

  const started = backend.start();
  child.stdout.emit("data", "listening on: ws://127.0.0.1:1234\n");
  await Promise.resolve();
  socket.open();
  await started;
  socket.receive({
    id: "approval_session",
    method: "item/commandExecution/requestApproval",
    params: {
      command: "npm test",
      availableDecisions: ["accept", "acceptForSession", "decline"]
    }
  });
  await backend.sendPermission(permission("approval_session", "allow", {
    remember: true,
    scope: "session"
  }));

  assert.deepEqual(permissions[0].native?.availableDecisions, ["accept", "acceptForSession", "decline"]);
  assert.deepEqual(socket.sent.at(-1), {
    id: "approval_session",
    result: {
      decision: "acceptForSession"
    }
  });
});

test("maps persistent command approval through Codex exec policy amendments", async () => {
  const { backend, child, socket } = createStartedBackend();
  const amendment = {
    match: "npm test"
  };

  const started = backend.start();
  child.stdout.emit("data", "listening on: ws://127.0.0.1:1234\n");
  await Promise.resolve();
  socket.open();
  await started;
  socket.receive({
    id: "approval_policy",
    method: "item/commandExecution/requestApproval",
    params: {
      command: "npm test",
      availableDecisions: ["accept", "acceptWithExecpolicyAmendment", "decline"],
      proposedExecpolicyAmendment: amendment
    }
  });
  await backend.sendPermission(permission("approval_policy", "allow", {
    remember: true,
    scope: "tool"
  }));

  assert.deepEqual(socket.sent.at(-1), {
    id: "approval_policy",
    result: {
      decision: {
        acceptWithExecpolicyAmendment: {
          execpolicy_amendment: amendment
        }
      }
    }
  });
});

test("maps deny approval to cancel when Codex offers cancel as the native decision", async () => {
  const { backend, child, socket } = createStartedBackend();

  const started = backend.start();
  child.stdout.emit("data", "listening on: ws://127.0.0.1:1234\n");
  await Promise.resolve();
  socket.open();
  await started;
  socket.receive({
    id: "approval_cancel",
    method: "item/commandExecution/requestApproval",
    params: {
      command: "npm test",
      availableDecisions: ["accept", "acceptWithExecpolicyAmendment", "cancel"]
    }
  });
  await backend.sendPermission(permission("approval_cancel", "deny"));

  assert.deepEqual(socket.sent.at(-1), {
    id: "approval_cancel",
    result: {
      decision: "cancel"
    }
  });
});

test("terminal harness speaks app-server approvals and routes Korean allow decisions", async () => {
  const { backend, child, socket } = createStartedBackend();
  const harness = new TerminalHarness({
    backend,
    backendLabel: "real-test",
    now: () => 1000,
    createId: createTestId()
  });

  const started = harness.start();
  child.stderr.emit("data", "listening on: ws://127.0.0.1:1234\n");
  await Promise.resolve();
  socket.open();
  await started;

  await harness.processLine("테스트 돌려줘");
  socket.receive({
    id: "approval_1",
    method: "item/commandExecution/requestApproval",
    params: {
      command: "npm test",
      cwd: "/repo"
    }
  });
  await flushAsync();

  assert.equal(harness.voiceOutput.messages.at(-1)?.text, "명령 실행 권한 필요해. 허용할까?");

  await harness.processLine("허용");

  assert.deepEqual(socket.sent.at(-1), {
    id: "approval_1",
    result: {
      decision: "accept"
    }
  });
});

test("terminal harness accepts numeric zero app-server approval ids", async () => {
  const { backend, child, socket } = createStartedBackend();
  const harness = new TerminalHarness({
    backend,
    backendLabel: "real-test",
    now: () => 1000,
    createId: createTestId()
  });

  const started = harness.start();
  child.stderr.emit("data", "listening on: ws://127.0.0.1:1234\n");
  await Promise.resolve();
  socket.open();
  await started;

  await harness.processLine("테스트 돌려줘");
  socket.receive({
    id: 0,
    method: "item/commandExecution/requestApproval",
    params: {
      command: "/bin/zsh -lc 'npm test'",
      cwd: "/repo"
    }
  });
  await Promise.resolve();
  await harness.processLine("허용");

  assert.deepEqual(socket.sent.at(-1), {
    id: 0,
    result: {
      decision: "accept"
    }
  });
});

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

function createStartedBackend(options: {
  voiceAgentProtocol?: boolean;
  voiceAgentProtocolPrompt?: string;
} = {}): {
  backend: CodexAppServerBackend;
  child: FakeAppServerProcess;
  socket: FakeWebSocket;
} {
  const child = new FakeAppServerProcess();
  const socket = new FakeWebSocket();

  return {
    backend: new CodexAppServerBackend({
      cwd: "/repo",
      voiceAgentProtocol: options.voiceAgentProtocol,
      voiceAgentProtocolPrompt: options.voiceAgentProtocolPrompt,
      spawnProcess: () => child,
      createWebSocket: () => socket
    }),
    child,
    socket
  };
}

function permission(
  requestId: string,
  decision: PermissionDecision["decision"],
  options: Partial<PermissionDecision> = {}
): PermissionDecision {
  return {
    requestId,
    decision,
    decidedBy: "voice",
    ...options
  };
}

function createTestId(): (prefix: string) => string {
  let id = 0;
  return (prefix) => `${prefix}_${++id}`;
}

class FakeAppServerProcess extends EventEmitter {
  readonly stdin = new FakeWritable();
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  killed = false;

  kill(_signal?: NodeJS.Signals): boolean {
    this.killed = true;
    return true;
  }
}

class FakeWritable {
  end(): void {}
}

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message?: string; type?: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  resumeError: string | undefined;
  readonly sent: Array<{ id: string | number; method?: string; params?: Record<string, unknown>; result?: unknown }> = [];
  flushed: Promise<void> = Promise.resolve();

  open(): void {
    this.onopen?.();
  }

  send(data: string): void {
    const message = JSON.parse(data) as { id: string | number; method?: string; params?: Record<string, unknown>; result?: unknown };
    this.sent.push(message);

    if (message.method === "initialize") {
      this.receive({
        id: message.id,
        result: {
          userAgent: "codex-test",
          codexHome: "/tmp/codex",
          platformFamily: "unix",
          platformOs: "macos"
        }
      });
    }

    if (message.method === "thread/start") {
      this.receive({
        id: message.id,
        result: {
          thread: {
            id: "thread_1"
          }
        }
      });
    }

    if (message.method === "thread/resume") {
      if (this.resumeError) {
        this.receive({
          id: message.id,
          error: {
            message: this.resumeError
          }
        });
      } else {
        this.receive({
          id: message.id,
          result: {
            thread: {
              id: String(message.params?.threadId ?? "thread_1")
            }
          }
        });
      }
    }

    if (message.method === "turn/start") {
      this.receive({
        id: message.id,
        result: {
          turn: {
            id: "turn_1"
          }
        }
      });
    }

    this.flushed = Promise.resolve();
  }

  receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  close(): void {
    this.onclose?.();
  }
}
