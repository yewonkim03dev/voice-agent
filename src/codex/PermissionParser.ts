import type { PermissionRequest } from "../permission/PermissionRequest.ts";
import type { CodexOutputEvent } from "./CodexOutputEvent.ts";

export interface PermissionParser {
  parse(output: CodexOutputEvent): PermissionRequest | null;
}

export class TextPermissionParser implements PermissionParser {
  parse(output: CodexOutputEvent): PermissionRequest | null {
    const promptText = `${output.text ?? ""}\n${output.raw ?? ""}`.trim();

    if (!promptText) return null;

    const command =
      matchFirst(promptText, [
        /Run command:\s*`?([^`?\n]+)`?\s*\?/i,
        /Codex wants to run:\s*`?([^`\n]+)`?/i,
        /Do you want to run\s*`([^`]+)`/i,
        /command:\s*`([^`]+)`/i
      ]) ?? undefined;

    const looksLikePermissionPrompt =
      output.type === "permission_request" ||
      /\b(allow|approve|permission|허용|권한|실행할까|run command)\b/i.test(promptText);

    if (!looksLikePermissionPrompt) return null;

    return {
      id: `perm_${output.sessionId}_${output.timestamp}`,
      sessionId: output.sessionId,
      tool: command ? "shell" : "unknown",
      action: command ? "run_command" : "approve_action",
      command,
      riskLevel: "medium",
      rawText: promptText,
      createdAt: output.timestamp
    };
  }
}

function matchFirst(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }

  return null;
}
