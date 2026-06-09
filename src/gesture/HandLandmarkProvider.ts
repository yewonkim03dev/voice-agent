import type { GestureCameraMode } from "./GestureWakeConfig.ts";

export type HandLandmarkName =
  | "wrist"
  | "thumbCMC"
  | "thumbMP"
  | "thumbIP"
  | "thumbTip"
  | "indexMCP"
  | "indexPIP"
  | "indexDIP"
  | "indexTip"
  | "middleMCP"
  | "middlePIP"
  | "middleDIP"
  | "middleTip"
  | "ringMCP"
  | "ringPIP"
  | "ringDIP"
  | "ringTip"
  | "littleMCP"
  | "littlePIP"
  | "littleDIP"
  | "littleTip";

export interface HandLandmark {
  name: HandLandmarkName;
  x: number;
  y: number;
  confidence: number;
}

export interface HandLandmarkFrame {
  landmarks: HandLandmark[];
  timestamp: number;
}

export interface HandLandmarkProvider {
  start(options: {
    fps: number;
    width: number;
    height: number;
    mode?: GestureCameraMode;
    onFrame(frame: HandLandmarkFrame): void;
    onStatus?(status: {
      enabled: boolean;
      mode: GestureCameraMode;
      text?: string;
    }): void;
    onError?(error: Error): void;
  }): Promise<void>;
  stop(): Promise<void>;
}
