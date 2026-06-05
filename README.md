# Voice Agent

## Terminal Harness

Run the local MVP harness with the in-memory backend:

```sh
npm run harness
```

The harness reads one line at a time from stdin, turns normal text into a `Transcript`, and sends it through `RuntimeController` with an in-memory `AgentBackend`. Voice responses are printed to the console instead of using real TTS.

Slash commands simulate Codex-side events in mock mode:

- `/status` prints the current runtime state and Codex status.
- `/permission <command>` creates a mock shell permission request.
- `/complete` sends a mock task-complete event.
- `/error <message>` sends a mock error event.
- `/quit` stops the session.

To connect the terminal harness to a real local Codex app-server:

```sh
npm run harness:codex
```

Codex mode starts `codex app-server --listen ws://127.0.0.1:0`, opens a local websocket JSON-RPC connection, and sends normal text directly with `turn/start`. It does not run local intent classification or text-based permission parsing in front of Codex. This avoids fake approval prompts such as `approve_action`.

Wake text is supported in the terminal as a development stand-in for a real wake detector:

```text
코덱스 간단한 npm test 돌려줘
```

The harness strips `코덱스` and forwards `간단한 npm test 돌려줘` to Codex. Plain text without a wake phrase is also forwarded for development convenience.

Native Codex approval requests are printed through the console voice output. While one is pending:

- `허용`, `yes`, `approve`, `allow`, `go ahead` send a one-time allow decision.
- `거부`, `아니`, `deny`, `reject`, `cancel` deny the request.
- `이번 세션 동안 허용` asks Codex for a session-scoped allow when Codex offers that decision.
- `같은 명령 계속 허용` asks Codex for a persistent command-policy amendment when Codex offers one.

If the speech is not clearly allow or deny, the harness asks `허용인지 거부인지 다시 말해줘.` and does not forward that utterance to Codex.

In Codex mode, `/permission <command>` is disabled because permissions must come from native Codex app-server approval requests.

Pass extra app-server flags after `--`:

```sh
npm run harness:codex -- -c 'model="gpt-5-codex"'
```

`npm run harness:real` is kept as an alias for `npm run harness:codex`.

Claude mode is exposed as:

```sh
npm run harness:claude
```

It probes the local `claude` CLI. If the CLI is broken or no supported structured approval transport is available, it prints the exact missing capability instead of pretending to drive Claude through an unsafe PTY shim.

This branch intentionally does not implement real microphone capture, real STT, real TTS, or a third-party PTY dependency. The current terminal input and `DevelopmentTranscriptInput` are the development adapters for future wake/STT wiring.
