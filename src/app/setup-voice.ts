import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { stderr, stdout } from "node:process";
import { fileURLToPath } from "node:url";

import { defaultVoiceConfigPath, detectVoiceSetup, writeVoiceConfigFile } from "./voice-config.ts";

export async function runVoiceSetup(): Promise<void> {
  const writeLine = (line: string): void => {
    stdout.write(`${line}\n`);
  };
  const detection = await detectVoiceSetup(commandExists);

  writeLine("Voice Agent voice setup");
  writeLine(`config: ${defaultVoiceConfigPath}`);

  if (!detection.config) {
    detection.errors.forEach((error) => writeLine(`[voice:setup] ${error}`));
    writeLine("[voice:setup] No config written.");
    process.exitCode = 1;
    return;
  }

  const path = await writeVoiceConfigFile(detection.config);

  writeLine(`[voice:setup] recorder: ${detection.recorder}`);
  writeLine(`[voice:setup] stt: ${detection.stt}`);
  writeLine(`[voice:setup] wrote ${path}`);
  writeLine("[voice:setup] Next: npm run harness:voice:codex");
}

function commandExists(command: string): boolean {
  const result = spawnSync("sh", ["-lc", `command -v ${shellQuote(command)}`], {
    stdio: "ignore"
  });

  return result.status === 0;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isDirectEntrypoint(): boolean {
  if (!process.argv[1]) return false;
  return fileURLToPath(import.meta.url) === resolve(process.argv[1]);
}

if (isDirectEntrypoint()) {
  runVoiceSetup().catch((error: unknown) => {
    stderr.write(`[voice:setup:fatal] ${formatError(error)}\n`);
    process.exitCode = 1;
  });
}
