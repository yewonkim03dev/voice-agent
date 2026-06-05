import type { VoiceMessage } from "./VoiceMessage.ts";
import type { VoiceOutput } from "./VoiceOutput.ts";

type WriteLine = (line: string) => void;

export interface InspectableVoiceOutput extends VoiceOutput {
  readonly messages: VoiceMessage[];
}

export interface ConsoleVoiceOutputOptions {
  writeLine?: WriteLine;
}

export class ConsoleVoiceOutput implements InspectableVoiceOutput {
  readonly messages: VoiceMessage[] = [];

  private readonly writeLine: WriteLine;
  private readonly finishedListeners: Array<(id: string) => void> = [];

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
}

function noop(_line: string): void {}
