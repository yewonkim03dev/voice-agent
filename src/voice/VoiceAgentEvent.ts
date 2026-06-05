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
  "Use {\"op\":\"voice-agent\",\"type\":\"speech\",\"text\":\"...\"} for short text the TTS should speak immediately.",
  "Use {\"op\":\"voice-agent\",\"type\":\"command\",\"text\":\"...\"} for commands or execution summaries to display, not speak.",
  "Use {\"op\":\"voice-agent\",\"type\":\"status\",\"text\":\"...\"} for short progress/status updates.",
  "Use {\"op\":\"voice-agent\",\"type\":\"error\",\"text\":\"...\"} for brief errors.",
  "Keep speech text short and natural. Do not wrap events in markdown fences."
].join("\n");

export function parseVoiceAgentEventLine(line: string): VoiceAgentEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
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

function isVoiceAgentEventType(value: unknown): value is VoiceAgentEventType {
  return value === "speech" || value === "command" || value === "status" || value === "error";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
