import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { TerminalHarness } from "../src/app/harness.ts";
import { CodexAppServerBackend, type CodexApprovalPolicy } from "../src/codex/CodexAppServerBackend.ts";
import type { CodexStatus } from "../src/codex/CodexOutputEvent.ts";
import type { PermissionDecision } from "../src/permission/PermissionDecision.ts";
import type { PermissionRequest } from "../src/permission/PermissionRequest.ts";
import type { VisualBridgeLike, VisualControlEvent, VisualEvent } from "../src/visual/VisualBridge.ts";

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
  assert.equal(socket.sent[1].params.approvalPolicy, "on-request");
  assert.equal(statuses.at(-1)?.process, "running");
  assert.equal(statuses.at(-1)?.threadId, "thread_1");
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
  assert.equal(socket.sent[1].params.approvalPolicy, "on-request");
  assert.deepEqual(saved, ["thread_saved"]);
});

test("applies configured Codex approval policy to threads and turns", async () => {
  const { backend, child, socket } = createStartedBackend({
    approvalPolicy: "on-failure"
  });

  const started = backend.start();
  child.stdout.emit("data", "listening on: ws://127.0.0.1:1234\n");
  await Promise.resolve();
  socket.open();
  await started;
  await backend.sendPrompt({
    sessionId: "sess_1",
    text: "git push 해줘",
    language: "ko",
    source: "voice",
    mode: "submit"
  });

  assert.equal(socket.sent.find((message) => message.method === "thread/start")?.params.approvalPolicy, "on-failure");
  assert.equal(socket.sent.find((message) => message.method === "turn/start")?.params.approvalPolicy, "on-failure");
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

test("interrupts active Codex app-server turns with turn/interrupt", async () => {
  const { backend, child, socket } = createStartedBackend();

  const started = backend.start();
  child.stdout.emit("data", "listening on: ws://127.0.0.1:1234\n");
  await Promise.resolve();
  socket.open();
  await started;
  await backend.sendPrompt({
    sessionId: "sess_1",
    text: "긴 작업 해줘",
    language: "ko",
    source: "voice",
    mode: "submit"
  });
  await backend.interrupt("Emergency stop requested from visual");

  const interrupt = socket.sent.find((message) => message.method === "turn/interrupt");
  assert.deepEqual(interrupt?.params, {
    threadId: "thread_1",
    turnId: "turn_1"
  });
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

test("adds response language runtime policy without changing the base protocol prompt", async () => {
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
    text: "run tests",
    language: "en",
    responseLanguage: "ko",
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
      text: "Runtime policy: Reply to the user in Korean, regardless of the input language.",
      text_elements: []
    },
    {
      type: "text",
      text: "run tests",
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

test("maps persistent network approval through Codex network policy amendments", async () => {
  const { backend, child, socket } = createStartedBackend();
  const amendment = {
    host: "github.com",
    action: "allow"
  };
  const requests: PermissionRequest[] = [];
  backend.onPermissionRequest((request) => requests.push(request));

  const started = backend.start();
  child.stdout.emit("data", "listening on: ws://127.0.0.1:1234\n");
  await Promise.resolve();
  socket.open();
  await started;
  socket.receive({
    id: "approval_network",
    method: "item/commandExecution/requestApproval",
    params: {
      command: "git push",
      reason: "Network access is required to reach GitHub.",
      networkApprovalContext: {
        host: "github.com",
        protocol: "https"
      },
      availableDecisions: ["accept", { applyNetworkPolicyAmendment: { network_policy_amendment: amendment } }, "cancel"],
      proposedNetworkPolicyAmendments: [amendment]
    }
  });
  await backend.sendPermission(permission("approval_network", "allow", {
    remember: true,
    scope: "network"
  }));

  assert.equal(requests[0].action, "network_access");
  assert.deepEqual(requests[0].native?.networkApprovalContext, {
    host: "github.com",
    protocol: "https"
  });
  assert.deepEqual(requests[0].native?.proposedNetworkPolicyAmendments, [amendment]);
  assert.deepEqual(socket.sent.at(-1), {
    id: "approval_network",
    result: {
      decision: {
        applyNetworkPolicyAmendment: {
          network_policy_amendment: amendment
        }
      }
    }
  });
});

test("responds to permissions approval requests with permissions and scope", async () => {
  const { backend, child, socket } = createStartedBackend();
  const requests: PermissionRequest[] = [];
  backend.onPermissionRequest((request) => requests.push(request));

  const started = backend.start();
  child.stdout.emit("data", "listening on: ws://127.0.0.1:1234\n");
  await Promise.resolve();
  socket.open();
  await started;
  socket.receive({
    id: "permissions_1",
    method: "item/permissions/requestApproval",
    params: {
      cwd: "/repo",
      reason: "Network access is required to push to GitHub.",
      permissions: {
        network: {
          enabled: true
        },
        fileSystem: null
      }
    }
  });
  await backend.sendPermission(permission("permissions_1", "allow"));

  assert.equal(requests[0].action, "network_permissions");
  assert.deepEqual(requests[0].native?.requestedPermissions, {
    network: {
      enabled: true
    },
    fileSystem: null
  });
  assert.deepEqual(socket.sent.at(-1), {
    id: "permissions_1",
    result: {
      permissions: {
        network: {
          enabled: true
        }
      },
      scope: "turn"
    }
  });
});

test("maps session speech to session-scoped permissions approval", async () => {
  const { backend, child, socket } = createStartedBackend();

  const started = backend.start();
  child.stdout.emit("data", "listening on: ws://127.0.0.1:1234\n");
  await Promise.resolve();
  socket.open();
  await started;
  socket.receive({
    id: "permissions_session",
    method: "item/permissions/requestApproval",
    params: {
      cwd: "/repo",
      reason: "Network access is required.",
      permissions: {
        network: {
          enabled: true
        }
      }
    }
  });
  await backend.sendPermission(permission("permissions_session", "allow", {
    remember: true,
    scope: "session"
  }));

  assert.deepEqual(socket.sent.at(-1), {
    id: "permissions_session",
    result: {
      permissions: {
        network: {
          enabled: true
        }
      },
      scope: "session"
    }
  });
});

test("denies permissions approval requests with an empty turn grant", async () => {
  const { backend, child, socket } = createStartedBackend();

  const started = backend.start();
  child.stdout.emit("data", "listening on: ws://127.0.0.1:1234\n");
  await Promise.resolve();
  socket.open();
  await started;
  socket.receive({
    id: "permissions_deny",
    method: "item/permissions/requestApproval",
    params: {
      cwd: "/repo",
      permissions: {
        network: {
          enabled: true
        }
      }
    }
  });
  await backend.sendPermission(permission("permissions_deny", "deny"));

  assert.deepEqual(socket.sent.at(-1), {
    id: "permissions_deny",
    result: {
      permissions: {},
      scope: "turn"
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

test("routes generic Codex approval requests instead of silently ignoring them", async () => {
  const { backend, child, socket } = createStartedBackend();
  const requests: PermissionRequest[] = [];
  backend.onPermissionRequest((request) => requests.push(request));

  const started = backend.start();
  child.stdout.emit("data", "listening on: ws://127.0.0.1:1234\n");
  await Promise.resolve();
  socket.open();
  await started;

  socket.receive({
    id: "edit_approval",
    method: "item/fileChange/requestApproval",
    params: {
      reason: "Apply README edits?",
      availableDecisions: ["accept", "cancel"]
    }
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].id, "edit_approval");
  assert.equal(requests[0].tool, "codex");
  assert.equal(requests[0].action, "item/fileChange/requestApproval");
  assert.equal(requests[0].rawText, "Apply README edits?");

  await backend.sendPermission(permission("edit_approval", "allow"));

  assert.deepEqual(socket.sent.at(-1), {
    id: "edit_approval",
    result: {
      decision: "accept"
    }
  });
});

test("responds to unhandled Codex app-server requests instead of leaving the server waiting", async () => {
  const lines: string[] = [];
  const { backend, child, socket } = createStartedBackend({
    writeLine: (line) => lines.push(line)
  });

  const started = backend.start();
  child.stdout.emit("data", "listening on: ws://127.0.0.1:1234\n");
  await Promise.resolve();
  socket.open();
  await started;

  socket.receive({
    id: "unknown_1",
    method: "item/unknown/request",
    params: {}
  });

  assert.equal(lines.some((line) => line.includes("[codex-app] unhandled request: item/unknown/request")), true);
  assert.deepEqual(socket.sent.at(-1), {
    id: "unknown_1",
    error: {
      code: -32601,
      message: "Voice Agent does not handle Codex app-server request item/unknown/request."
    }
  });
});

test("serverRequest/resolved clears pending approval state", async () => {
  const { backend, child, socket } = createStartedBackend();
  const output: string[] = [];
  backend.onOutput((event) => {
    if (event.type === "approval_resolved") output.push(event.text ?? "");
  });

  const started = backend.start();
  child.stdout.emit("data", "listening on: ws://127.0.0.1:1234\n");
  await Promise.resolve();
  socket.open();
  await started;
  socket.receive({
    id: "approval_resolved",
    method: "item/commandExecution/requestApproval",
    params: {
      command: "git push"
    }
  });
  socket.receive({
    method: "serverRequest/resolved",
    params: {
      requestId: "approval_resolved"
    }
  });

  await assert.rejects(
    () => backend.sendPermission(permission("approval_resolved", "allow")),
    /No pending Codex approval request/u
  );
  assert.deepEqual(output, ["approval_resolved"]);
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

test("terminal harness updates visual settings when Codex returns a thread id", async () => {
  const { backend, child, socket } = createStartedBackend();
  const visualBridge = new FakeVisualBridge();
  const harness = new TerminalHarness({
    backend,
    backendLabel: "real-test",
    visualBridge,
    now: () => 1000,
    createId: createTestId()
  });

  const started = harness.start();
  child.stderr.emit("data", "listening on: ws://127.0.0.1:1234\n");
  await Promise.resolve();
  socket.open();
  await started;

  assert.equal(
    visualBridge.events.findLast((event) => event.type === "settings")?.codexThreadId,
    "thread_1"
  );
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
  writeLine?: (line: string) => void;
  approvalPolicy?: CodexApprovalPolicy;
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
      writeLine: options.writeLine,
      approvalPolicy: options.approvalPolicy,
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

class FakeVisualBridge implements VisualBridgeLike {
  readonly events: VisualEvent[] = [];

  send(event: VisualEvent): void {
    this.events.push(event);
  }

  onControl(_callback: (event: VisualControlEvent) => void): void {}
}

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message?: string; type?: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  resumeError: string | undefined;
  readonly sent: Array<{
    id: string | number;
    method?: string;
    params?: Record<string, unknown>;
    result?: unknown;
    error?: { code?: number; message: string };
  }> = [];
  flushed: Promise<void> = Promise.resolve();

  open(): void {
    this.onopen?.();
  }

  send(data: string): void {
    const message = JSON.parse(data) as {
      id: string | number;
      method?: string;
      params?: Record<string, unknown>;
      result?: unknown;
      error?: { code?: number; message: string };
    };
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

    if (message.method === "turn/interrupt") {
      this.receive({
        id: message.id,
        result: {}
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
