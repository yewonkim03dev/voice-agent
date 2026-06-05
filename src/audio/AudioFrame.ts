export type AudioFormat = "pcm_s16le" | "pcm_f32";

export interface AudioFrame {
  timestamp: number;
  sampleRate: number;
  channels: number;
  format: AudioFormat;
  data: ArrayBuffer;
  rms?: number;
}

export interface AudioInput {
  start(): Promise<void>;
  stop(): Promise<void>;
  onFrame(callback: (frame: AudioFrame) => void): void;
}
