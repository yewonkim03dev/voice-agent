import type { VoiceMessage } from "./VoiceMessage.ts";
import type { InspectableVoiceOutput, VoiceOutputSettings } from "./ConsoleVoiceOutput.ts";
import type { TtsGender, TtsLanguage, TtsProvider } from "./TtsProvider.ts";

type WriteLine = (line: string) => void;

export interface TtsVoiceOutputOptions {
  provider: TtsProvider;
  writeLine?: WriteLine;
  language?: TtsLanguage;
  voiceName?: string;
  gender?: TtsGender;
  rate?: number;
  pitch?: number;
  volume?: number;
  maxChunkLength?: number;
}

export class TtsVoiceOutput implements InspectableVoiceOutput {
  readonly messages: VoiceMessage[] = [];

  private readonly provider: TtsProvider;
  private readonly writeLine: WriteLine;
  private language: TtsLanguage;
  private voiceName: string | undefined;
  private gender: TtsGender;
  private rate: number;
  private pitch: number | undefined;
  private volume: number | undefined;
  private readonly maxChunkLength: number;
  private readonly finishedListeners: Array<(id: string) => void> = [];
  private queue: Promise<void> = Promise.resolve();
  private generation = 0;

  constructor(options: TtsVoiceOutputOptions) {
    this.provider = options.provider;
    this.writeLine = options.writeLine ?? noop;
    this.language = options.language ?? "auto";
    this.voiceName = options.voiceName;
    this.gender = options.gender ?? "auto";
    this.rate = options.rate ?? 0.56;
    this.pitch = options.pitch;
    this.volume = options.volume;
    this.maxChunkLength = options.maxChunkLength ?? 180;
  }

  async speak(message: VoiceMessage): Promise<void> {
    this.messages.push(message);
    this.writeLine(`[voice:${message.category}] ${message.text}`);

    if (message.priority === "urgent") {
      this.generation += 1;
      this.queue = Promise.resolve();
      await this.provider.stop();
    }

    const generation = this.generation;
    const task = this.queue
      .catch(() => {})
      .then(async () => {
        if (generation !== this.generation) return;
        await this.speakQueued(message, generation);
      });

    this.queue = task.catch(() => {});
    await task;
  }

  async stop(): Promise<void> {
    this.generation += 1;
    this.queue = Promise.resolve();
    await this.provider.stop();
  }

  onFinished(callback: (id: string) => void): void {
    this.finishedListeners.push(callback);
  }

  getSettings(): VoiceOutputSettings {
    return {
      language: this.language,
      ...(this.voiceName ? { voiceName: this.voiceName } : {}),
      gender: this.gender,
      rate: this.rate,
      ...(this.pitch !== undefined ? { pitch: this.pitch } : {}),
      ...(this.volume !== undefined ? { volume: this.volume } : {})
    };
  }

  updateSettings(settings: VoiceOutputSettings): VoiceOutputSettings {
    if (settings.language !== undefined) this.language = settings.language;
    if (settings.voiceName !== undefined) this.voiceName = settings.voiceName || undefined;
    if (settings.gender !== undefined) this.gender = settings.gender;
    if (settings.rate !== undefined) this.rate = clamp(settings.rate, 0.1, 1);
    if (settings.pitch !== undefined) this.pitch = clamp(settings.pitch, 0.5, 2);
    if (settings.volume !== undefined) this.volume = clamp(settings.volume, 0, 1);
    return this.getSettings();
  }

  isSpeechEnabled(): boolean {
    return true;
  }

  private async speakQueued(message: VoiceMessage, generation: number): Promise<void> {
    try {
      for (const chunk of chunkSpeechText(message.text, this.maxChunkLength)) {
        if (generation !== this.generation) break;
        await this.provider.speak({
          text: chunk,
          language: this.resolveLanguage(message),
          voiceName: this.voiceName,
          gender: this.gender,
          rate: this.rate,
          pitch: this.pitch,
          volume: this.volume
        });
      }
    } catch (error) {
      this.writeLine(`[tts:error] ${formatError(error)}`);
    } finally {
      this.finishedListeners.forEach((listener) => listener(message.id));
    }
  }

  private resolveLanguage(message: VoiceMessage): VoiceMessage["language"] {
    if (this.language === "ko" || this.language === "en") return this.language;
    return message.language;
  }
}

export function chunkSpeechText(text: string, maxLength = 180): string[] {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (!normalized) return [];
  if (normalized.length <= maxLength) return [normalized];

  const chunks: string[] = [];
  let remaining = normalized;

  while (remaining.length > maxLength) {
    const breakAt = findBreakPoint(remaining, maxLength);
    chunks.push(remaining.slice(0, breakAt).trim());
    remaining = remaining.slice(breakAt).trim();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

function findBreakPoint(text: string, maxLength: number): number {
  const candidate = text.slice(0, maxLength + 1);
  const sentenceBreak = Math.max(
    candidate.lastIndexOf("."),
    candidate.lastIndexOf("?"),
    candidate.lastIndexOf("!"),
    candidate.lastIndexOf("。"),
    candidate.lastIndexOf("？"),
    candidate.lastIndexOf("！")
  );
  if (sentenceBreak > maxLength * 0.45) return sentenceBreak + 1;

  const commaBreak = Math.max(candidate.lastIndexOf(","), candidate.lastIndexOf("，"));
  if (commaBreak > maxLength * 0.45) return commaBreak + 1;

  const spaceBreak = candidate.lastIndexOf(" ");
  if (spaceBreak > maxLength * 0.45) return spaceBreak;

  return maxLength;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function noop(_line: string): void {}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
