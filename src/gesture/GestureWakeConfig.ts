export const gestureNames = [
  "none",
  "open_palm",
  "thumbs_down",
  "fist",
  "peace",
  "thumbs_up"
] as const;

export type GestureName = typeof gestureNames[number];

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

export interface GestureWakeConfig {
  enabled: boolean;
  fps: number;
  resolution: GestureResolution;
  holdMs: number;
  cooldownMs: number;
  runningMode: GestureRunningMode;
  bindings: GestureBindings;
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
}

export const defaultGestureWakeConfig: GestureWakeConfig = {
  enabled: false,
  fps: 5,
  resolution: {
    width: 640,
    height: 480,
    label: "640x480"
  },
  holdMs: 700,
  cooldownMs: 1500,
  runningMode: "off",
  bindings: {
    wake: "open_palm",
    stop: "thumbs_down"
  }
};

export function sanitizeGestureWakeConfig(value: unknown): GestureWakeConfig {
  const record = isRecord(value) ? value : {};
  const defaults = defaultGestureWakeConfig;
  const bindings = sanitizeGestureBindings(isRecord(record.bindings) ? record.bindings : undefined);
  const resolution = sanitizeGestureResolution(record.resolution);

  return {
    enabled: record.enabled === true,
    fps: sanitizeNumber(record.fps, defaults.fps, 1, 30),
    resolution,
    holdMs: sanitizeNumber(record.holdMs, defaults.holdMs, 100, 10_000),
    cooldownMs: sanitizeNumber(record.cooldownMs, defaults.cooldownMs, 0, 60_000),
    runningMode: record.runningMode === "emergency_only" ? "emergency_only" : "off",
    bindings
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
  return typeof value === "string" && gestureNames.includes(value as GestureName);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
