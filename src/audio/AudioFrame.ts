export type AudioFormat = "pcm_s16le" | "pcm_f32";

export interface AudioFrame {
  timestamp: number;
  sampleRate: number;
  channels: number;
  format: AudioFormat;
  data: ArrayBuffer;
  rms?: number;
}

export type AudioInputStatus =
  | "starting"
  | "running"
  | "reconfiguring"
  | "waiting_device"
  | "restarted"
  | "failed"
  | "restarting"
  | "stopped";

export interface AudioInputStatusEvent {
  status: AudioInputStatus;
  timestamp: number;
  message?: string;
  fatal?: boolean;
}

export interface AudioInput {
  start(): Promise<void>;
  stop(): Promise<void>;
  onFrame(callback: (frame: AudioFrame) => void): void;
  onStatus?(callback: (event: AudioInputStatusEvent) => void): void;
  reconnect?(): Promise<void>;
}
