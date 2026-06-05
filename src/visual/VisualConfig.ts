import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export const defaultVisualConfigPath = ".voice-agent.local.json";
export const qtCommands = ["qml6", "qml", "qmlscene6", "qmlscene"];

export type VisualProvider = "auto" | "qtqml" | "macos-native";

export type CommandExists = (command: string) => boolean | Promise<boolean>;

export interface VisualConfig {
  provider: VisualProvider;
}

export interface VisualConfigResolution {
  config: VisualConfig;
  errors: string[];
  source?: "env" | "file" | "default";
}

export interface VisualSetupDetection {
  config?: VisualConfig;
  selectedProvider?: Exclude<VisualProvider, "auto">;
  qtCommand?: string;
  macosNativeCommand?: string;
  errors: string[];
  warnings: string[];
  installCommands: string[];
}

export async function resolveVisualConfig(options: {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  configPath?: string;
} = {}): Promise<VisualConfigResolution> {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const configPath = options.configPath ?? defaultVisualConfigPath;
  const envProvider = parseOptionalProvider(env.VOICE_AGENT_VISUAL_PROVIDER);

  if (env.VOICE_AGENT_VISUAL_PROVIDER && !envProvider) {
    return {
      config: defaultVisualConfig(),
      errors: [`Invalid VOICE_AGENT_VISUAL_PROVIDER: ${env.VOICE_AGENT_VISUAL_PROVIDER}`],
      source: "env"
    };
  }

  if (envProvider) {
    return {
      config: {
        provider: envProvider
      },
      errors: [],
      source: "env"
    };
  }

  const fileConfig = await readVisualConfigFile(resolve(cwd, configPath));
  if (fileConfig.source) return fileConfig;

  return {
    config: defaultVisualConfig(),
    errors: [],
    source: "default"
  };
}

export async function detectVisualSetup(
  commandExists: CommandExists,
  options: {
    platform?: NodeJS.Platform;
  } = {}
): Promise<VisualSetupDetection> {
  const platform = options.platform ?? process.platform;
  const qtCommand = await findQtCommand(commandExists);
  const macosNativeCommand =
    platform === "darwin" && (await commandExists("swift")) ? "swift visual/macos/VoiceAgentVisual.swift" : undefined;
  const warnings: string[] = [];
  const errors: string[] = [];
  const installCommands = qtInstallCommands(platform);

  if (!qtCommand) {
    warnings.push("Qt/QML runtime not found. The visual launcher will fall back to macOS native when available.");
  }

  if (platform === "darwin" && !macosNativeCommand) {
    warnings.push("macOS native visual fallback requires /usr/bin/swift.");
  }

  const selectedProvider = qtCommand ? "qtqml" : macosNativeCommand ? "macos-native" : undefined;

  if (!selectedProvider) {
    errors.push("No supported visual provider found.");
  }

  return {
    ...(selectedProvider ? { config: defaultVisualConfig(), selectedProvider } : {}),
    ...(qtCommand ? { qtCommand } : {}),
    ...(macosNativeCommand ? { macosNativeCommand } : {}),
    errors,
    warnings,
    installCommands
  };
}

export async function writeVisualConfigFile(
  config: VisualConfig,
  options: {
    cwd?: string;
    configPath?: string;
  } = {}
): Promise<string> {
  const cwd = options.cwd ?? process.cwd();
  const configPath = options.configPath ?? defaultVisualConfigPath;
  const fullPath = resolve(cwd, configPath);
  const existing = await readJsonObject(fullPath);
  const body = `${JSON.stringify(
    {
      ...existing,
      visual: config
    },
    null,
    2
  )}\n`;

  await writeFile(fullPath, body, "utf8");
  return fullPath;
}

export async function findQtCommand(commandExists: CommandExists): Promise<string | undefined> {
  for (const command of qtCommands) {
    if (await commandExists(command)) return command;
  }

  return undefined;
}

export function parseVisualProvider(value: unknown): VisualProvider | null {
  return parseOptionalProvider(value);
}

export function qtInstallCommands(platform: NodeJS.Platform): string[] {
  if (platform === "darwin") {
    return [
      "brew install qt",
      'export PATH="$(brew --prefix qt)/bin:$PATH"'
    ];
  }

  if (platform === "win32") {
    return ["Install Qt from https://www.qt.io/download and add qml.exe or qmlscene.exe to PATH."];
  }

  return [
    "Install Qt 6 QML tools with your package manager.",
    "Make sure qml6, qml, qmlscene6, or qmlscene is on PATH."
  ];
}

function defaultVisualConfig(): VisualConfig {
  return {
    provider: "auto"
  };
}

async function readVisualConfigFile(configPath: string): Promise<VisualConfigResolution> {
  let raw: string;

  try {
    raw = await readFile(configPath, "utf8");
  } catch (error) {
    if (isNotFound(error)) {
      return {
        config: defaultVisualConfig(),
        errors: []
      };
    }

    return {
      config: defaultVisualConfig(),
      errors: [`Could not read visual config file ${configPath}: ${formatError(error)}`],
      source: "file"
    };
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const visual = parsed.visual && typeof parsed.visual === "object" ? parsed.visual as Record<string, unknown> : {};
    const provider = parseOptionalProvider(visual.provider);

    if (visual.provider && !provider) {
      return {
        config: defaultVisualConfig(),
        errors: [`Visual config file ${configPath} has invalid visual.provider.`],
        source: "file"
      };
    }

    return {
      config: {
        provider: provider ?? "auto"
      },
      errors: [],
      source: "file"
    };
  } catch (error) {
    return {
      config: defaultVisualConfig(),
      errors: [`Could not parse visual config file ${configPath}: ${formatError(error)}`],
      source: "file"
    };
  }
}

async function readJsonObject(path: string): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch (error) {
    if (isNotFound(error)) return {};
    throw error;
  }
}

function parseOptionalProvider(value: unknown): VisualProvider | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();

  if (normalized === "auto" || normalized === "qtqml" || normalized === "macos-native") {
    return normalized;
  }

  return null;
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
