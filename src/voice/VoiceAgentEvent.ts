export type VoiceAgentEventType = "speech" | "command" | "status" | "error";

export interface VoiceAgentEvent {
  op: "voice-agent";
  type: VoiceAgentEventType;
  text: string;
  raw: Record<string, unknown>;
}

export const voiceAgentProtocolPrompt = [
  "Voice Agent response protocol:",
  "When replying to the user in this voice-agent session, emit newline-delimited JSON events.",
  "Each line must be one JSON object with op=\"voice-agent\".",
  "Use {\"op\":\"voice-agent\",\"type\":\"speech\",\"text\":\"...\"} for concise natural-language text the TTS should speak immediately.",
  "Before tool use, searches, file reads, or command requests, emit one very brief speech event so the user knows work started.",
  "During long-running work, emit brief speech progress updates after meaningful milestones so the user can hear that work is still moving.",
  "Keep the normal Codex/Claude CLI working cadence: while editing, testing, or inspecting files, emit brief speech updates after each meaningful step, such as files changed, tests added, checks started, and checks passed.",
  "Use speech, not status or command, for user-facing progress, findings, conclusions, and short summaries the user should hear.",
  "Use {\"op\":\"voice-agent\",\"type\":\"command\",\"text\":\"...\"} only for shell commands, file paths, URLs, flags, stack traces, raw logs, or compact execution lists that should be displayed but not spoken.",
  "Use {\"op\":\"voice-agent\",\"type\":\"status\",\"text\":\"...\"} only for silent UI state that should not be spoken.",
  "Use {\"op\":\"voice-agent\",\"type\":\"error\",\"text\":\"...\"} for brief errors.",
  "Do not put investigation summaries, market analysis, or final answers in command events unless they are mainly paths, URLs, commands, or logs.",
  "Never put shell commands, paths, URLs, flags, stack traces, or logs in speech; emit those as command events.",
  "Put a newline after every JSON object. Never emit adjacent objects like {...}{...} on the same line.",
  "Keep speech text natural and reasonably brief; split long answers into a few speech events instead of hiding them in command. Do not wrap events in markdown fences."
].join("\n");

export function parseVoiceAgentEventLine(line: string): VoiceAgentEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;

  return parseVoiceAgentEventJson(trimmed);
}

export function parseVoiceAgentEventSequence(line: string): VoiceAgentEvent[] | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const events: VoiceAgentEvent[] = [];
  let index = 0;

  while (index < trimmed.length) {
    while (/\s/u.test(trimmed[index] ?? "")) index += 1;
    if (index >= trimmed.length) break;
    if (trimmed[index] !== "{") return null;

    const end = findJsonObjectEnd(trimmed, index);
    if (end === -1) return null;

    const event = parseVoiceAgentEventJson(trimmed.slice(index, end + 1));
    if (!event) return null;

    events.push(event);
    index = end + 1;
  }

  return events.length > 0 ? events : null;
}

function parseVoiceAgentEventJson(json: string): VoiceAgentEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }

  const record = asRecord(parsed);
  if (record.op !== "voice-agent") return null;
  if (!isVoiceAgentEventType(record.type)) return null;
  if (typeof record.text !== "string" || !record.text.trim()) return null;

  return {
    op: "voice-agent",
    type: record.type,
    text: record.text.trim(),
    raw: record
  };
}

function findJsonObjectEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
      if (depth < 0) return -1;
    }
  }

  return -1;
}

function isVoiceAgentEventType(value: unknown): value is VoiceAgentEventType {
  return value === "speech" || value === "command" || value === "status" || value === "error";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
