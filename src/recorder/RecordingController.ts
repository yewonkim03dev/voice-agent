import type { AudioInput } from "../audio/AudioFrame.ts";
import type { ListeningGate } from "../listening/ListeningGate.ts";
import type { UtteranceAudio } from "./UtteranceAudio.ts";
import { UtteranceRecorder } from "./UtteranceRecorder.ts";

export interface RecordingControllerOptions {
  gate: ListeningGate;
  audioInput: AudioInput;
  recorder: UtteranceRecorder;
  now?: () => number;
  createId?: (prefix: string) => string;
}

export class RecordingController {
  private readonly gate: ListeningGate;
  private readonly audioInput: AudioInput;
  private readonly recorder: UtteranceRecorder;
  private readonly now: () => number;
  private readonly createId: (prefix: string) => string;
  private readonly utteranceListeners: Array<(audio: UtteranceAudio) => void> = [];
  private recording = false;
  private pendingOperation: Promise<void> = Promise.resolve();

  constructor(options: RecordingControllerOptions) {
    this.gate = options.gate;
    this.audioInput = options.audioInput;
    this.recorder = options.recorder;
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? ((prefix) => `${prefix}_${this.now()}`);
    this.audioInput.onFrame((frame) => {
      this.recorder.consume(frame);
    });
    this.gate.onOpen((event) => {
      this.pendingOperation = this.pendingOperation.then(() => this.begin(event.timestamp));
    });
    this.gate.onClose(() => {
      this.pendingOperation = this.pendingOperation.then(() => this.finish());
    });
    this.recorder.onUtterance((audio) => {
      this.utteranceListeners.forEach((listener) => listener(audio));
    });
  }

  async start(): Promise<void> {
    await this.gate.start();
  }

  async stop(): Promise<void> {
    if (this.recording) {
      await this.finish();
    }

    await this.drain();
    await this.gate.stop();
  }

  onUtterance(callback: (audio: UtteranceAudio) => void): void {
    this.utteranceListeners.push(callback);
  }

  async drain(): Promise<void> {
    await this.pendingOperation;
  }

  private async begin(timestamp: number): Promise<void> {
    if (this.recording) return;

    this.recording = true;
    this.recorder.begin(this.createId("voice_sess"), {
      mode: "manual",
      timestamp
    });
    await this.audioInput.start();
  }

  private async finish(): Promise<void> {
    if (!this.recording) return;

    await this.audioInput.stop();
    this.recorder.finish();
    this.recording = false;
  }
}
