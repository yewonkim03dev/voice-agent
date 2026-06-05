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

Voice input mode is exposed as:

```sh
npm run setup:voice
npm run harness:voice:codex
```

This mode uses manual recording first so it can later swap `ManualRecordingGate` for a wake/VAD gate without changing STT or agent routing. Type `/record` to start recording and `/record` again to stop. The voice path is:

```text
AudioInput -> ListeningGate -> RecordingController -> UtteranceRecorder -> STT -> Transcript -> Agent pass-through
```

Always-on wake listening is exposed as:

```sh
npm run harness:wake:codex
```

This starts the same recorder/STT pipeline, but keeps the recorder process running and uses a lightweight VAD gate to cut candidate speech utterances. Each candidate utterance is transcribed once. If the transcript starts with a configured wake phrase, the wake phrase is stripped and the rest is forwarded to Codex. If it does not, the transcript is discarded.

```text
AudioInput -> VAD candidate detector -> STT -> WakePhraseRouter -> Agent pass-through
```

`/record` remains available as a manual fallback in always-on mode. Manual fallback routes the transcript directly through the existing harness, which is useful when debugging wake detection.

`npm run setup:voice` detects supported local recorder/STT commands and writes `.voice-agent.local.json`. On macOS with `/usr/bin/swift`, setup uses the built-in microphone through AVFoundation and Apple Speech for STT. The file is ignored by git and is read automatically by `npm run harness:voice:codex`.

Voice setup is provider-based: macOS Swift support is the first provider, and Windows/Linux providers can be added without changing `VoiceHarnessRunner`, STT routing, or agent pass-through.

Wake phrases are loaded from `.voice-agent.local.json` or `VOICE_AGENT_WAKE_PHRASES`. The default set is:

```json
["코덱스", "클로드", "codex", "claude", "hey codex", "hey claude"]
```

For example, to use `자비스`:

```json
{
  "recorderCommand": "exec swift src/audio/macos-record-pcm.swift",
  "sttCommand": "swift src/speech/macos-transcribe.swift {audio}",
  "sampleRate": 16000,
  "channels": 1,
  "wakePhrases": ["자비스", "코덱스", "codex"]
}
```

If auto-detection cannot find a supported command, configure manually with environment variables or by writing `.voice-agent.local.json`:

```sh
export VOICE_AGENT_RECORDER_COMMAND='rec -q -t raw -b 16 -e signed-integer -c 1 -r 16000 -'
export VOICE_AGENT_STT_COMMAND='your-local-whisper-command {audio}'
export VOICE_AGENT_WAKE_PHRASES='자비스,코덱스,codex'
```

`VOICE_AGENT_RECORDER_COMMAND` must stream 16kHz mono `pcm_s16le` audio to stdout. `VOICE_AGENT_STT_COMMAND` receives a WAV file path through `{audio}` and should print either plain transcript text or JSON like `{"text":"코덱스 npm test 돌려줘","language":"ko","confidence":0.99}`.

If either capability is missing, setup prints `[voice:setup]` guidance and the harness prints an exact `[voice:capability]` message before starting Codex.

Claude mode is exposed as:

```sh
npm run harness:claude
```

It probes the local `claude` CLI. If the CLI is broken or no supported structured approval transport is available, it prints the exact missing capability instead of pretending to drive Claude through an unsafe PTY shim.

This branch intentionally does not implement real TTS, visual UI, production wake-word ML, or a third-party PTY dependency. Always-on wake mode uses VAD plus one STT pass per candidate utterance, then discards transcripts that do not start with a configured wake phrase.
