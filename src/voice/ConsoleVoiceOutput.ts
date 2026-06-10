import type { VoiceMessage } from "./VoiceMessage.ts";
import type { VoiceOutput } from "./VoiceOutput.ts";
import type { TtsGender, TtsLanguage } from "./TtsProvider.ts";

type WriteLine = (line: string) => void;

export interface VoiceOutputSettings {
  language?: TtsLanguage;
  voiceName?: string;
  gender?: TtsGender;
  rate?: number;
  pitch?: number;
  volume?: number;
}

export interface InspectableVoiceOutput extends VoiceOutput {
  readonly messages: VoiceMessage[];
  isSpeechEnabled?(): boolean;
  getSettings?(): VoiceOutputSettings;
  updateSettings?(settings: VoiceOutputSettings): VoiceOutputSettings;
}

export interface ConsoleVoiceOutputOptions {
  writeLine?: WriteLine;
}

export class ConsoleVoiceOutput implements InspectableVoiceOutput {
  readonly messages: VoiceMessage[] = [];

  private readonly writeLine: WriteLine;
  private readonly finishedListeners: Array<(id: string) => void> = [];
  private settings: VoiceOutputSettings = {
    language: "auto",
    gender: "auto",
    rate: 0.56
  };

  constructor(options: ConsoleVoiceOutputOptions = {}) {
    this.writeLine = options.writeLine ?? noop;
  }

  async speak(message: VoiceMessage): Promise<void> {
    this.messages.push(message);
    this.writeLine(`[voice:${message.category}] ${message.text}`);
    this.finishedListeners.forEach((listener) => listener(message.id));
  }

  async stop(): Promise<void> {}

  onFinished(callback: (id: string) => void): void {
    this.finishedListeners.push(callback);
  }

  getSettings(): VoiceOutputSettings {
    return { ...this.settings };
  }

  updateSettings(settings: VoiceOutputSettings): VoiceOutputSettings {
    this.settings = {
      ...this.settings,
      ...settings
    };
    return this.getSettings();
  }

  isSpeechEnabled(): boolean {
    return true;
  }
}

export class SilentVoiceOutput implements InspectableVoiceOutput {
  readonly messages: VoiceMessage[] = [];

  private readonly finishedListeners: Array<(id: string) => void> = [];
  private settings: VoiceOutputSettings = {
    language: "auto",
    gender: "auto",
    rate: 0.56
  };

  async speak(message: VoiceMessage): Promise<void> {
    this.messages.push(message);
    this.finishedListeners.forEach((listener) => listener(message.id));
  }

  async stop(): Promise<void> {}

  onFinished(callback: (id: string) => void): void {
    this.finishedListeners.push(callback);
  }

  getSettings(): VoiceOutputSettings {
    return { ...this.settings };
  }

  updateSettings(settings: VoiceOutputSettings): VoiceOutputSettings {
    this.settings = {
      ...this.settings,
      ...settings
    };
    return this.getSettings();
  }

  isSpeechEnabled(): boolean {
    return false;
  }
}

function noop(_line: string): void {}
