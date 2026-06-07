import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { stderr, stdout } from "node:process";
import { fileURLToPath } from "node:url";

import { defaultVisualConfigPath, detectVisualSetup, writeVisualConfigFile } from "../visual/VisualConfig.ts";

export async function runVisualSetup(): Promise<void> {
  const writeLine = (line: string): void => {
    stdout.write(`${line}\n`);
  };
  const detection = await detectVisualSetup(commandExists);

  writeLine("Voice Agent visual setup");
  writeLine(`config: ${defaultVisualConfigPath}`);
  writeLine(`[visual:setup] qtqml: ${detection.qtCommand ?? "not found"}`);
  writeLine(`[visual:setup] macos-native: ${detection.macosNativeCommand ?? "not available"}`);

  detection.warnings.forEach((warning) => writeLine(`[visual:setup] ${warning}`));
  if (!detection.qtCommand) {
    detection.installCommands.forEach((command) => writeLine(`[visual:setup] install qtqml: ${command}`));
  }

  if (!detection.config || !detection.selectedProvider) {
    detection.errors.forEach((error) => writeLine(`[visual:setup] ${error}`));
    writeLine("[visual:setup] No config written.");
    process.exitCode = 1;
    return;
  }

  const path = await writeVisualConfigFile(detection.config);

  writeLine(`[visual:setup] selected provider: ${detection.selectedProvider}`);
  writeLine(`[visual:setup] configured provider: ${detection.config.provider}`);
  writeLine(`[visual:setup] wrote ${path}`);
  writeLine("[visual:setup] Next: npm run visual or npm run harness:wake:codex -- --visual");
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
  runVisualSetup().catch((error: unknown) => {
    stderr.write(`[visual:setup:fatal] ${formatError(error)}\n`);
    process.exitCode = 1;
  });
}
