export const builtInGestureNames = [
  "open_palm",
  "thumbs_down",
  "fist",
  "peace",
  "thumbs_up"
] as const;

export const gestureNames = [
  "none",
  ...builtInGestureNames
] as const;

export type BuiltInGestureName = typeof builtInGestureNames[number];
export type CustomGestureName = `custom:${string}`;
export type GestureName = typeof gestureNames[number] | CustomGestureName;

export const gestureActions = [
  "wake",
  "stop",
  "approval.once",
  "approval.deny",
  "approval.session",
  "approval.policy"
] as const;

export type GestureAction = typeof gestureActions[number];

export type GestureRunningMode = "off" | "emergency_only";
export type GestureCameraMode = "off" | "idle" | "listening" | "running" | "emergency";
export type GestureRuntimeState = "idle" | "listening" | "running" | "pending_approval";

export interface GestureBindings {
  wake: GestureName;
  stop: GestureName;
  "approval.once"?: GestureName;
  "approval.deny"?: GestureName;
  "approval.session"?: GestureName;
  "approval.policy"?: GestureName;
}

export interface GestureResolution {
  width: number;
  height: number;
  label: string;
}

export interface CustomGestureTemplate {
  name: CustomGestureName;
  label: string;
  vector: number[];
  threshold: number;
  samples: number;
  createdAt: number;
}

export interface GestureWakeConfig {
  enabled: boolean;
  fps: number;
  resolution: GestureResolution;
  holdMs: number;
  cooldownMs: number;
  runningMode: GestureRunningMode;
  bindings: GestureBindings;
  customGestures: CustomGestureTemplate[];
}

export interface GestureWakeFileConfig {
  enabled?: boolean;
  fps?: number | string;
  resolution?: string | {
    width?: number | string;
    height?: number | string;
  };
  holdMs?: number | string;
  cooldownMs?: number | string;
  runningMode?: GestureRunningMode;
  bindings?: Partial<Record<GestureAction, GestureName>>;
  customGestures?: CustomGestureTemplate[];
}

export const defaultGestureWakeConfig: GestureWakeConfig = {
  enabled: false,
  fps: 15,
  resolution: {
    width: 640,
    height: 480,
    label: "640x480"
  },
  holdMs: 450,
  cooldownMs: 1500,
  runningMode: "off",
  bindings: {
    wake: "open_palm",
    stop: "thumbs_down"
  },
  customGestures: []
};

export function sanitizeGestureWakeConfig(value: unknown): GestureWakeConfig {
  const record = isRecord(value) ? value : {};
  const defaults = defaultGestureWakeConfig;
  const customGestures = sanitizeCustomGestureTemplates(record.customGestures);
  const bindings = sanitizeGestureBindings(isRecord(record.bindings) ? record.bindings : undefined);
  const resolution = sanitizeGestureResolution(record.resolution);

  return {
    enabled: record.enabled === true,
    fps: sanitizeNumber(record.fps, defaults.fps, 1, 30),
    resolution,
    holdMs: sanitizeNumber(record.holdMs, defaults.holdMs, 100, 10_000),
    cooldownMs: sanitizeNumber(record.cooldownMs, defaults.cooldownMs, 0, 60_000),
    runningMode: record.runningMode === "emergency_only" ? "emergency_only" : "off",
    bindings,
    customGestures
  };
}

export function gestureWakeConfigForRuntime(config: GestureWakeConfig | undefined, enabledByCli: boolean): GestureWakeConfig {
  const sanitized = sanitizeGestureWakeConfig(config);
  return {
    ...sanitized,
    enabled: enabledByCli
  };
}

export function isGestureName(value: unknown): value is GestureName {
  return typeof value === "string" && (gestureNames.includes(value as GestureName) || isCustomGestureName(value));
}

export function isCustomGestureName(value: unknown): value is CustomGestureName {
  return typeof value === "string" && /^custom:[a-z0-9][a-z0-9_-]{0,39}$/iu.test(value);
}

export function customGestureNameFromLabel(label: string): CustomGestureName {
  const trimmed = label.trim();
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/giu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 28);
  return `custom:${slug || `gesture_${shortHash(trimmed)}`}`;
}

export function isGestureAction(value: unknown): value is GestureAction {
  return typeof value === "string" && gestureActions.includes(value as GestureAction);
}

function sanitizeGestureBindings(value: Record<string, unknown> | undefined): GestureBindings {
  const defaults = defaultGestureWakeConfig.bindings;
  const bindings: GestureBindings = {
    wake: isGestureName(value?.wake) && value?.wake !== "none" ? value.wake : defaults.wake,
    stop: isGestureName(value?.stop) && value?.stop !== "none" ? value.stop : defaults.stop
  };

  for (const action of gestureActions) {
    if (action === "wake" || action === "stop") continue;
    const gesture = value?.[action];
    if (isGestureName(gesture) && gesture !== "none") {
      bindings[action] = gesture;
    }
  }

  return bindings;
}

function sanitizeCustomGestureTemplates(value: unknown): CustomGestureTemplate[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const templates: CustomGestureTemplate[] = [];
  for (const item of value) {
    if (!isRecord(item) || !isCustomGestureName(item.name) || seen.has(item.name)) continue;
    if (!Array.isArray(item.vector) || item.vector.length === 0 || item.vector.length > 64) continue;
    const vector = item.vector
      .map((entry) => (typeof entry === "number" ? entry : Number(entry)))
      .filter((entry) => Number.isFinite(entry));
    if (vector.length !== item.vector.length) continue;

    seen.add(item.name);
    templates.push({
      name: item.name,
      label: typeof item.label === "string" && item.label.trim() ? item.label.trim().slice(0, 40) : item.name.slice("custom:".length),
      vector,
      threshold: sanitizeFloat(item.threshold, 0.22, 0.01, 1),
      samples: sanitizeNumber(item.samples, 1, 1, 120),
      createdAt: sanitizeNumber(item.createdAt, Date.now(), 0, Number.MAX_SAFE_INTEGER)
    });
  }
  return templates;
}

function sanitizeGestureResolution(value: unknown): GestureResolution {
  if (typeof value === "string") {
    const match = value.trim().match(/^(\d{2,5})x(\d{2,5})$/iu);
    if (match) return resolutionFromNumbers(Number(match[1]), Number(match[2]));
  }

  if (isRecord(value)) {
    return resolutionFromNumbers(
      sanitizeNumber(value.width, defaultGestureWakeConfig.resolution.width, 160, 3840),
      sanitizeNumber(value.height, defaultGestureWakeConfig.resolution.height, 120, 2160)
    );
  }

  return { ...defaultGestureWakeConfig.resolution };
}

function resolutionFromNumbers(width: number, height: number): GestureResolution {
  const safeWidth = Number.isFinite(width) ? Math.max(160, Math.min(3840, Math.round(width))) : defaultGestureWakeConfig.resolution.width;
  const safeHeight = Number.isFinite(height) ? Math.max(120, Math.min(2160, Math.round(height))) : defaultGestureWakeConfig.resolution.height;
  return {
    width: safeWidth,
    height: safeHeight,
    label: `${safeWidth}x${safeHeight}`
  };
}

function sanitizeNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

function sanitizeFloat(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function shortHash(value: string): string {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  }
  return hash.toString(36).slice(0, 8) || "0";
}
