import type { CameraGestureWatcher, GestureWatcherObservation, GestureWatcherStatus } from "./CameraGestureWatcher.ts";
import { LandmarkGestureClassifier, type GestureClassifier } from "./GestureClassifier.ts";
import type { GestureCameraMode, GestureWakeConfig } from "./GestureWakeConfig.ts";
import type { HandLandmarkFrame, HandLandmarkProvider } from "./HandLandmarkProvider.ts";

export interface LandmarkCameraGestureWatcherOptions {
  createProvider: () => HandLandmarkProvider;
  classifier?: GestureClassifier;
}

export class LandmarkCameraGestureWatcher implements CameraGestureWatcher {
  private readonly createProvider: () => HandLandmarkProvider;
  private readonly classifier: GestureClassifier;
  private readonly gestureListeners: Array<(observation: GestureWatcherObservation) => void> = [];
  private readonly statusListeners: Array<(status: GestureWatcherStatus) => void> = [];
  private config: GestureWakeConfig | undefined;
  private mode: GestureCameraMode = "off";
  private provider: HandLandmarkProvider | undefined;
  private generation = 0;

  constructor(options: LandmarkCameraGestureWatcherOptions) {
    this.createProvider = options.createProvider;
    this.classifier = options.classifier ?? new LandmarkGestureClassifier();
  }

  async start(config: GestureWakeConfig): Promise<void> {
    this.config = config;
    this.emitStatus({
      enabled: false,
      mode: "off",
      text: "camera gesture watcher ready"
    });
  }

  async stop(): Promise<void> {
    this.mode = "off";
    await this.stopProvider();
    this.emitStatus({
      enabled: false,
      mode: "off"
    });
  }

  setMode(mode: GestureCameraMode): void {
    if (!this.config || mode === "off") {
      this.mode = "off";
      void this.stopProvider();
      this.emitStatus({
        enabled: false,
        mode: "off"
      });
      return;
    }

    if (this.provider) {
      if (this.mode !== mode) {
        this.mode = mode;
        this.emitStatus({
          enabled: true,
          mode
        });
      }
      return;
    }
    this.mode = mode;
    void this.startProvider(mode);
  }

  onGesture(callback: (observation: GestureWatcherObservation) => void): void {
    this.gestureListeners.push(callback);
  }

  onStatus(callback: (status: GestureWatcherStatus) => void): void {
    this.statusListeners.push(callback);
  }

  private async startProvider(mode: GestureCameraMode): Promise<void> {
    const config = this.config;
    if (!config) return;

    const generation = this.generation + 1;
    this.generation = generation;
    await this.stopCurrentProvider();
    if (this.generation !== generation) return;

    const provider = this.createProvider();
    this.provider = provider;
    const fps = fpsForMode(mode, config);
    this.emitStatus({
      enabled: false,
      mode,
      text: "hand landmark provider starting"
    });
    try {
      await provider.start({
        fps,
        width: config.resolution.width,
        height: config.resolution.height,
        mode,
        onFrame: (frame) => {
          if (this.generation !== generation || this.mode === "off") return;
          this.handleFrame(frame);
        },
        onStatus: (status) => {
          if (this.generation !== generation) return;
          this.emitStatus({
            ...status,
            mode: this.mode !== "off" && status.mode !== "off" ? this.mode : status.mode
          });
        },
        onError: (error) => {
          if (this.generation !== generation) return;
          this.emitStatus({
            enabled: false,
            mode: "off",
            text: error.message
          });
        }
      });
    } catch (error) {
      if (this.generation !== generation) return;
      this.emitStatus({
        enabled: false,
        mode: "off",
        text: error instanceof Error ? error.message : String(error)
      });
      return;
    }
    if (this.generation !== generation) {
      await provider.stop();
      return;
    }
    this.emitStatus({
      enabled: false,
      mode,
      text: "hand landmark provider spawned"
    });
  }

  private async stopProvider(): Promise<void> {
    this.generation += 1;
    await this.stopCurrentProvider();
  }

  private async stopCurrentProvider(): Promise<void> {
    const provider = this.provider;
    this.provider = undefined;
    if (provider) await provider.stop();
  }

  private handleFrame(frame: HandLandmarkFrame): void {
    const result = this.classifier.classify(frame);
    this.emitGesture({
      gesture: result.gesture,
      timestamp: frame.timestamp,
      confidence: result.confidence
    });
  }

  private emitGesture(observation: GestureWatcherObservation): void {
    this.gestureListeners.forEach((listener) => listener(observation));
  }

  private emitStatus(status: GestureWatcherStatus): void {
    this.statusListeners.forEach((listener) => listener(status));
  }
}

function fpsForMode(mode: GestureCameraMode, config: GestureWakeConfig): number {
  if (mode === "emergency") return Math.max(1, Math.min(2, config.fps));
  if (mode === "listening") return Math.max(2, Math.min(5, config.fps));
  return config.fps;
}
