import type { CustomGestureTemplate, GestureCameraMode, GestureName, GestureWakeConfig } from "./GestureWakeConfig.ts";

export type CameraPermissionStatus = "authorized" | "not_determined" | "denied" | "restricted" | "unavailable";

export interface CameraPermissionManager {
  requestPermission(): Promise<CameraPermissionStatus>;
}

export interface GestureWatcherObservation {
  gesture: GestureName;
  timestamp: number;
  confidence?: number;
}

export interface GestureWatcherStatus {
  enabled: boolean;
  mode: GestureCameraMode;
  text?: string;
}

export interface CameraGestureWatcher {
  start(config: GestureWakeConfig): Promise<void>;
  stop(): Promise<void>;
  setMode(mode: GestureCameraMode): void;
  onGesture(callback: (observation: GestureWatcherObservation) => void): void;
  onStatus(callback: (status: GestureWatcherStatus) => void): void;
  captureCustomGestureTemplate?(options: {
    name: CustomGestureTemplate["name"];
    label: string;
    durationMs: number;
    minSamples: number;
    threshold?: number;
  }): Promise<CustomGestureTemplate>;
}

export class StaticCameraPermissionManager implements CameraPermissionManager {
  private readonly status: CameraPermissionStatus;

  constructor(status: CameraPermissionStatus = "unavailable") {
    this.status = status;
  }

  async requestPermission(): Promise<CameraPermissionStatus> {
    return this.status;
  }
}

export class NoopCameraGestureWatcher implements CameraGestureWatcher {
  private readonly gestureListeners: Array<(observation: GestureWatcherObservation) => void> = [];
  private readonly statusListeners: Array<(status: GestureWatcherStatus) => void> = [];
  private mode: GestureCameraMode = "off";

  async start(_config: GestureWakeConfig): Promise<void> {
    this.emitStatus({
      enabled: false,
      mode: "off",
      text: "camera gesture watcher unavailable"
    });
  }

  async stop(): Promise<void> {
    this.mode = "off";
    this.emitStatus({
      enabled: false,
      mode: "off"
    });
  }

  setMode(mode: GestureCameraMode): void {
    this.mode = mode;
    this.emitStatus({
      enabled: mode !== "off",
      mode
    });
  }

  onGesture(callback: (observation: GestureWatcherObservation) => void): void {
    this.gestureListeners.push(callback);
  }

  onStatus(callback: (status: GestureWatcherStatus) => void): void {
    this.statusListeners.push(callback);
  }

  protected emitGesture(observation: GestureWatcherObservation): void {
    this.gestureListeners.forEach((listener) => listener(observation));
  }

  protected emitStatus(status: GestureWatcherStatus): void {
    this.statusListeners.forEach((listener) => listener(status));
  }
}
