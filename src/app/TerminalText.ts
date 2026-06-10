import { stdout, env } from "node:process";

const ansi = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m"
} as const;

function shouldUseColor(): boolean {
  if (env.NO_COLOR !== undefined || env.TERM === "dumb" || env.FORCE_COLOR === "0" || env.VOICE_AGENT_COLOR === "never") {
    return false;
  }
  if (env.VOICE_AGENT_COLOR === "always") return true;
  return Boolean(stdout.isTTY);
}

function color(code: string, text: string): string {
  return shouldUseColor() ? `${code}${text}${ansi.reset}` : text;
}

export function formatTerminalSection(text: string): string {
  return color(ansi.bold, text);
}

export function formatTerminalLabel(label: string, value: string): string {
  return `  ${color(ansi.bold, `${label}:`)} ${value}`;
}

export function formatTerminalNote(text: string): string {
  return `  ${color(ansi.dim, text)}`;
}

export function formatTerminalCommand(command: string, description: string): string {
  return `  ${color(ansi.cyan, command)} ${color(ansi.dim, description)}`;
}

export function formatTerminalOption(option: string, description: string): string {
  return `  ${color(ansi.cyan, option)} ${color(ansi.dim, description)}`;
}

export function formatTerminalCommandSummary(commands: string): string {
  return formatTerminalLabel("Commands", color(ansi.cyan, commands));
}

export function formatTerminalWake(value: string): string {
  return formatTerminalLabel("Wake", color(ansi.green, value));
}

export function formatTerminalApproval(value: string): string {
  return formatTerminalLabel("Approval", color(ansi.yellow, value));
}

export function terminalVoiceRunOptionLines(): string[] {
  return [
    formatTerminalSection("Voice run options:"),
    formatTerminalOption("--always-on, --wake", "enable always-on wake listening."),
    formatTerminalOption("--visual", "open the Visual/HUD companion."),
    formatTerminalOption("--visual-provider auto|qtqml|macos-native", "choose the Visual implementation."),
    formatTerminalOption("--cam", "enable camera gesture wake."),
    formatTerminalOption("--debug", "show diagnostic audio/STT/camera logs.")
  ];
}

export function terminalBackendRunOptionLines(): string[] {
  return [
    formatTerminalSection("Backend/TTS run options:"),
    formatTerminalOption("--codex, --real", "use the Codex app-server backend."),
    formatTerminalOption("--claude", "use the Claude backend."),
    formatTerminalOption("--mock", "use the in-memory mock runtime."),
    formatTerminalOption("--cwd <path>", "set the agent working directory."),
    formatTerminalOption("--codex-thread-id <id>", "resume or force a Codex thread id."),
    formatTerminalOption("--codex-approval-policy on-request|untrusted|on-failure|never", "set Codex approval policy."),
    formatTerminalOption("--codex-command <cmd>, --claude-command <cmd>", "override the backend CLI command."),
    formatTerminalOption("--tts, --no-tts", "enable or disable TTS."),
    formatTerminalOption("--tts-provider console|macos-apple", "choose the TTS provider."),
    formatTerminalOption("--tts-voice <name>, --tts-gender male|female|auto", "choose a voice."),
    formatTerminalOption("--tts-rate slow|normal|fast|number", "set speech rate."),
    formatTerminalOption("--tts-language ko|en|auto", "set TTS language routing.")
  ];
}
