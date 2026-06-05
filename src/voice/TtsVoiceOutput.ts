import type { VoiceMessage } from "./VoiceMessage.ts";
import type { InspectableVoiceOutput } from "./ConsoleVoiceOutput.ts";
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
  private readonly language: TtsLanguage;
  private readonly voiceName: string | undefined;
  private readonly gender: TtsGender;
  private readonly rate: number;
  private readonly pitch: number | undefined;
  private readonly volume: number | undefined;
  private readonly maxChunkLength: number;
  private readonly finishedListeners: Array<(id: string) => void> = [];
  private sequence = 0;

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
    const sequence = ++this.sequence;

    try {
      await this.provider.stop();
      for (const chunk of chunkSpeechText(message.text, this.maxChunkLength)) {
        if (sequence !== this.sequence) break;
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

  async stop(): Promise<void> {
    this.sequence += 1;
    await this.provider.stop();
  }

  onFinished(callback: (id: string) => void): void {
    this.finishedListeners.push(callback);
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
