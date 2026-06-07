import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { stdout, stderr } from "node:process";
import { fileURLToPath } from "node:url";

import {
  findQtCommand,
  qtInstallCommands,
  resolveVisualConfig,
  type VisualProvider
} from "./VisualConfig.ts";

type WriteLine = (line: string) => void;

export interface VisualLaunchOptions {
  url?: string;
  provider?: VisualProvider;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  configPath?: string;
  writeLine?: WriteLine;
  spawnProcess?: typeof spawn;
  commandExists?: (command: string) => Promise<boolean>;
}

export interface VisualLaunchResult {
  started: boolean;
  provider?: Exclude<VisualProvider, "auto">;
  command?: string;
  reason?: string;
}

export async function launchVisualCompanion(options: VisualLaunchOptions = {}): Promise<VisualLaunchResult> {
  const writeLine = options.writeLine ?? noop;
  const commandExists = options.commandExists ?? defaultCommandExists;
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const visualConfig = await resolveVisualConfig({
    env,
    cwd: options.cwd,
    configPath: options.configPath
  });
  if (!options.provider && visualConfig.errors.length > 0) {
    const reason = visualConfig.errors.join(" ");
    writeLine(`[visual] unavailable: ${reason}`);
    return {
      started: false,
      reason
    };
  }

  const requestedProvider = options.provider ?? visualConfig.config.provider;

  if (requestedProvider === "auto" || requestedProvider === "qtqml") {
    const command = await findQtCommand(commandExists);

    if (command) {
      return launchQtCompanion(command, options);
    }

    writeQtInstallHint(writeLine, platform);

    if (requestedProvider === "qtqml") {
      const reason = "Qt/QML runtime not found.";
      writeLine(`[visual] unavailable: ${reason}`);
      return {
        started: false,
        provider: "qtqml",
        reason
      };
    }
  }

  if (requestedProvider === "auto" || requestedProvider === "macos-native") {
    if (platform === "darwin" && await commandExists("swift")) {
      return launchMacosNativeCompanion(options);
    }

    const reason = platform === "darwin"
      ? "macOS native visual fallback requires /usr/bin/swift."
      : "macOS native visual fallback is only available on macOS.";
    writeLine(`[visual] unavailable: ${reason}`);
    return {
      started: false,
      provider: "macos-native",
      reason
    };
  }

  const reason = `Unsupported visual provider: ${requestedProvider}`;
  writeLine(`[visual] unavailable: ${reason}`);
  return {
    started: false,
    reason
  };
}

function launchQtCompanion(command: string, options: VisualLaunchOptions): VisualLaunchResult {
  const writeLine = options.writeLine ?? noop;
  const qmlPath = resolve(dirnameFromImportMeta(), "../../visual/qt/VoiceAgent.qml");
  const args = [qmlPath];
  if (options.url) args.push("--url", options.url);

  const child = (options.spawnProcess ?? spawn)(command, args, {
    cwd: options.cwd ?? process.cwd(),
    env: {
      ...process.env,
      ...options.env
    },
    stdio: "ignore",
    detached: true
  });
  child.unref();
  writeLine(`[visual] started: qtqml ${command} ${args.join(" ")}`);

  return {
    started: true,
    provider: "qtqml",
    command
  };
}

function launchMacosNativeCompanion(options: VisualLaunchOptions): VisualLaunchResult {
  const writeLine = options.writeLine ?? noop;
  const swiftPath = resolve(dirnameFromImportMeta(), "../../visual/macos/VoiceAgentVisual.swift");
  const args = [swiftPath];
  if (options.url) args.push("--url", options.url);

  const child = (options.spawnProcess ?? spawn)("swift", args, {
    cwd: options.cwd ?? process.cwd(),
    env: {
      ...process.env,
      ...options.env
    },
    stdio: "ignore",
    detached: true
  });
  child.unref();
  writeLine(`[visual] started: macos-native swift ${args.join(" ")}`);

  return {
    started: true,
    provider: "macos-native",
    command: "swift"
  };
}

export async function runVisualCli(args = process.argv.slice(2)): Promise<void> {
  const cli = parseVisualCliArgs(args);
  await launchVisualCompanion({
    url: cli.url,
    provider: cli.provider,
    writeLine: (line) => stdout.write(`${line}\n`)
  });
}

export function parseVisualCliArgs(args: string[]): { url?: string; provider?: VisualProvider } {
  let url: string | undefined;
  let provider: VisualProvider | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--url") {
      url = args[++index];
    } else if (arg === "--visual-provider" || arg === "--provider") {
      const value = args[++index] as VisualProvider | undefined;
      if (value === "auto" || value === "qtqml" || value === "macos-native") {
        provider = value;
      }
    }
  }

  return {
    ...(url ? { url } : {}),
    ...(provider ? { provider } : {})
  };
}

async function defaultCommandExists(command: string): Promise<boolean> {
  const paths = (process.env.PATH ?? "").split(":").filter(Boolean);

  for (const entry of paths) {
    try {
      await access(resolve(entry, command));
      return true;
    } catch {
      continue;
    }
  }

  return false;
}

function dirnameFromImportMeta(): string {
  return resolve(fileURLToPath(import.meta.url), "..");
}

function noop(_line: string): void {}

function writeQtInstallHint(writeLine: WriteLine, platform: NodeJS.Platform): void {
  writeLine("[visual] qtqml unavailable: Qt/QML runtime not found.");
  qtInstallCommands(platform).forEach((command) => writeLine(`[visual] install qtqml: ${command}`));
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "")) {
  runVisualCli().catch((error: unknown) => {
    stderr.write(`[visual:fatal] ${formatError(error)}\n`);
    process.exitCode = 1;
  });
}
