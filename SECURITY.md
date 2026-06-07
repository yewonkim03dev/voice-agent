Language / 언어: English | [한국어](./SECURITY.ko.md)

# Security Policy

## Supported Versions

Voice Agent is early-stage software. Security fixes target the latest active branch and the most recent released code, if releases exist.

## Reporting a Vulnerability

Please do not publish exploitable vulnerability details in a public issue.

Preferred reporting path:

1. Use GitHub private vulnerability reporting if it is enabled for this repository.
2. If private reporting is not enabled, contact the maintainer privately before sharing exploit details.
3. If no private contact is available, open a minimal public issue asking for a private security contact, without including reproduction steps, secrets, tokens, logs, or exploit details.

Include enough context for triage:

- Affected version, branch, or commit.
- Operating system and runtime details.
- Whether the issue involves voice input, STT/TTS, visual bridge, approval handling, app-server transport, filesystem access, network access, plugins, or connectors.
- A safe summary of impact.
- Minimal reproduction details, shared privately.

## Scope

Security-sensitive areas include:

- Approval bridging and request-id handling.
- App-server JSON-RPC transport.
- Plugin, connector, MCP, and elicitation handling.
- Shell command approval and sandbox boundary behavior.
- Local microphone, STT, TTS, and visual companion processes.
- Local config files such as `.voice-agent.local.json`.

## Disclosure

Please give maintainers reasonable time to investigate and release a fix before public disclosure. We will try to acknowledge valid reports, identify affected behavior, and coordinate a fix path as quickly as practical.
