import { normalizeTranscriptText, type Language, type Transcript } from "./Transcript.ts";

export interface TranscriptInput {
  start(): Promise<void>;
  stop(): Promise<void>;
  onTranscript(callback: (transcript: Transcript) => void): void;
}

export interface DevelopmentTranscriptInputOptions {
  now?: () => number;
  createId?: (prefix: string) => string;
  defaultSessionId?: string;
  defaultLanguage?: Language;
  defaultConfidence?: number;
}

export interface EmitTextOptions {
  sessionId?: string;
  language?: Language;
  confidence?: number;
}

export class DevelopmentTranscriptInput implements TranscriptInput {
  private readonly now: () => number;
  private readonly createId: (prefix: string) => string;
  private readonly defaultSessionId: string;
  private readonly defaultLanguage: Language;
  private readonly defaultConfidence: number;
  private readonly listeners: Array<(transcript: Transcript) => void> = [];
  private running = false;

  constructor(options: DevelopmentTranscriptInputOptions = {}) {
    this.now = options.now ?? Date.now;
    this.createId = options.createId ?? ((prefix) => `${prefix}_${this.now()}`);
    this.defaultSessionId = options.defaultSessionId ?? "dev_session";
    this.defaultLanguage = options.defaultLanguage ?? "mixed";
    this.defaultConfidence = options.defaultConfidence ?? 0.99;
  }

  async start(): Promise<void> {
    this.running = true;
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  onTranscript(callback: (transcript: Transcript) => void): void {
    this.listeners.push(callback);
  }

  emitText(text: string, options: EmitTextOptions = {}): Transcript {
    const timestamp = this.now();
    const transcript: Transcript = {
      id: this.createId("tr"),
      sessionId: options.sessionId ?? this.defaultSessionId,
      text,
      normalizedText: normalizeTranscriptText(text),
      language: options.language ?? this.defaultLanguage,
      confidence: options.confidence ?? this.defaultConfidence,
      startedAt: timestamp,
      endedAt: timestamp
    };

    if (this.running) {
      this.listeners.forEach((listener) => listener(transcript));
    }

    return transcript;
  }
}
