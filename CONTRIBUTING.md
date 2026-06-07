# Contributing

Thanks for helping improve Voice Agent.

Voice Agent is a thin voice layer around a coding agent. Keep that boundary clear: voice input, wake routing, TTS, visual state, and approval bridging live here; model reasoning, tool selection, plugin calls, connector calls, and execution results should stay on the app-server path.

## Development Setup

```sh
npm install
npm run setup:voice
npm run setup:visual
npm test
```

For local manual testing on macOS:

```sh
npm run harness:wake:codex -- --visual --tts
```

## Working Guidelines

- Keep changes scoped to the behavior being changed.
- Prefer existing patterns in `src/app`, `src/codex`, `src/voice`, and `src/visual`.
- Do not add local intent classification for normal coding requests. STT text should pass through to the agent backend.
- Do not call plugins or connectors directly from the voice layer. Route user requests to the app-server and handle approval or input requests by request id.
- Keep approval behavior deterministic: pending approvals must resolve, queued approvals must advance, and the visual state must not remain stuck.
- Add tests for approval, wake, TTS, visual, and app-server state changes when behavior changes.

## Testing

Run the full test suite before committing:

```sh
npm test
```

When changing a specific area, start with the focused test file, then run the full suite:

```sh
node --test tests/codex-app-server-backend.test.ts
node --test tests/harness.test.ts
node --test tests/voice-pipeline.test.ts
npm test
```

## Documentation

Update both README files when user-facing behavior changes:

- `README.md`
- `README.ko.md`

Keep the English and Korean docs equivalent in meaning, even if the wording is not a direct translation.

## Pull Request Checklist

- The change follows the app-server pass-through architecture.
- Approval and cancellation paths are tested when touched.
- Visual state and TTS behavior are tested when touched.
- `npm test` passes.
- README updates are included when user-facing behavior changes.
