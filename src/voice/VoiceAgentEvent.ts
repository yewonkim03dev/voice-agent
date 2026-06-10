export type VoiceAgentEventType = "speech" | "command" | "status" | "error" | "popup";
export type VoiceAgentSpeechRole = "progress" | "final" | "message";

export interface VoiceAgentEvent {
  op: "voice-agent";
  type: VoiceAgentEventType;
  text: string;
  role: VoiceAgentSpeechRole;
  raw: Record<string, unknown>;
}

export const voiceAgentProtocolPrompt = [
  "Voice Agent protocol:",
  "Output NDJSON only. One JSON object per line:",
  "{\"op\":\"voice-agent\",\"type\":\"speech|command|status|error\",\"text\":\"...\",\"role\":\"progress|message|final\"}",
  "",
  "speech: TTS text for user-facing progress, findings, and final answers. Final answers must use role=\"final\".",
  "command: commands, paths, URLs, flags, stack traces, logs; display only, never spoken.",
  "status: silent UI state.",
  "error: brief error.",
  "",
  "Before tool/file/search/command work, emit a brief speech progress event. During long work, emit short progress after meaningful milestones.",
  "Never put raw commands/paths/URLs/logs in speech. No markdown fences. Use the configured response language for speech text."
].join("\n");

export const voiceAgentPopupProtocolPrompt = [
  "Popup channel:",
  "When popup preference is enabled, emit at most one popup event per assistant answer:",
  "{\"op\":\"voice-agent\",\"type\":\"popup\",\"text\":\"markdown or plain text content\",\"title\":\"optional title\"}",
  "You MUST use a popup for long explanations, study notes, lecture/video summaries, markdown-heavy answers, tables, or math content better read visually than spoken.",
  "For those popup-worthy answers, emit exactly one short speech final summary for TTS and exactly one popup containing the full answer body.",
  "Popup math is rendered with KaTeX. Write inline math as $...$ or \\(...\\), and display math as $$...$$ or \\[...\\].",
  "Do not use Unicode-only pseudo math when LaTeX is intended; prefer KaTeX-compatible LaTeX such as \\frac, \\sum, _{}, ^{}, \\lambda, and \\|w\\|_2^2.",
  "Do not speak the popup body. Keep the speech final summary concise, such as \"핵심 내용은 팝업에 정리했어.\" in the configured response language.",
  "Across all NDJSON lines for one answer, emit no more than one popup event."
].join("\n");

export function voiceAgentProtocolPromptForSettings(options: { popupPreferred?: boolean } = {}): string {
  if (!options.popupPreferred) return voiceAgentProtocolPrompt;
  return `${voiceAgentProtocolPrompt}\n\n${voiceAgentPopupProtocolPrompt}`;
}

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
    role: record.type === "speech" ? parseSpeechRole(record.role) : "message",
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
  return value === "speech" || value === "command" || value === "status" || value === "error" || value === "popup";
}

function parseSpeechRole(value: unknown): VoiceAgentSpeechRole {
  if (value === "progress" || value === "final" || value === "message") return value;
  return "message";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
