import { spawn } from "node:child_process";
import { mkdir, rm, stat } from "node:fs/promises";
import { homedir, platform, tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export interface ScreenCaptureResult {
  path: string;
  createdAt: number;
}

export interface ScreenCaptureProvider {
  preflight?(options: ScreenCaptureOptions): Promise<void>;
  capture(options: ScreenCaptureOptions): Promise<ScreenCaptureResult>;
}

export interface ScreenCaptureOptions {
  directory?: string;
  cwd?: string;
  now?: () => number;
  createId?: (prefix: string) => string;
}

export const defaultScreenCaptureDirectory = join(tmpdir(), "voice-agent-screen-captures");
export const defaultAppShotHotkey = "left_cmd+right_cmd";

export function defaultScreenDescribePrompt(language: "auto" | "ko" | "en" = "auto"): string {
  if (language === "en") {
    return [
      "Analyze the current full-screen capture.",
      "Explain what is visible, including the app, document, video, code, diagrams, formulas, or theory on screen.",
      "If the screen contains math or technical content, explain it clearly with KaTeX-compatible LaTeX where useful.",
      "Then suggest the next useful step briefly."
    ].join(" ");
  }

  return [
    "현재 전체 화면 캡쳐를 분석해 주세요.",
    "화면에 보이는 앱, 문서, 영상, 코드, 다이어그램, 수식, 이론 내용을 설명해 주세요.",
    "수학이나 기술 내용이 있으면 필요한 곳에 KaTeX 호환 LaTeX를 사용해 명확하게 풀어 주세요.",
    "마지막에는 다음에 할 만한 작업을 짧게 제안해 주세요."
  ].join(" ");
}

export function createDefaultScreenCaptureProvider(): ScreenCaptureProvider {
  return platform() === "darwin" ? new MacosScreenCaptureProvider() : new UnsupportedScreenCaptureProvider();
}

export function sanitizeScreenCaptureDirectory(value: unknown, cwd = process.cwd()): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return resolveUserPath(trimmed, cwd);
}

export class MacosScreenCaptureProvider implements ScreenCaptureProvider {
  async preflight(options: ScreenCaptureOptions): Promise<void> {
    const directory = await ensureCaptureDirectory(options);
    const path = join(directory, ".voice-agent-screen-capture-preflight.png");
    await runScreenCapture(path);
    await rm(path, { force: true });
  }

  async capture(options: ScreenCaptureOptions): Promise<ScreenCaptureResult> {
    const directory = await ensureCaptureDirectory(options);
    const now = options.now ?? Date.now;
    const createId = options.createId ?? ((prefix) => `${prefix}_${now()}`);
    const path = join(directory, `${createId("app_shot")}.png`);

    await runScreenCapture(path);
    const info = await stat(path);
    if (!info.isFile() || info.size <= 0) {
      throw new Error("screen capture did not produce an image file");
    }

    return {
      path,
      createdAt: now()
    };
  }
}

export class UnsupportedScreenCaptureProvider implements ScreenCaptureProvider {
  async capture(): Promise<ScreenCaptureResult> {
    throw new Error("screen capture is only implemented for macOS in this build");
  }
}

async function ensureCaptureDirectory(options: ScreenCaptureOptions): Promise<string> {
  const directory = sanitizeScreenCaptureDirectory(options.directory, options.cwd) ?? defaultScreenCaptureDirectory;
  await mkdir(directory, { recursive: true });
  return directory;
}

function resolveUserPath(value: string, cwd: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return join(homedir(), value.slice(2));
  return isAbsolute(value) ? value : resolve(cwd, value);
}

function runScreenCapture(path: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("screencapture", ["-x", "-t", "png", path], {
      stdio: ["ignore", "ignore", "pipe"]
    });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      const suffix = stderr.trim() ? `: ${stderr.trim()}` : signal ? `: ${signal}` : "";
      reject(new Error(`screen capture failed${suffix}`));
    });
  });
}
