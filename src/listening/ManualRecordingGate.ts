import type { ListeningGate, ListeningGateEvent } from "./ListeningGate.ts";

export interface ManualRecordingGateOptions {
  now?: () => number;
}

export class ManualRecordingGate implements ListeningGate {
  private readonly now: () => number;
  private readonly openListeners: Array<(event: ListeningGateEvent) => void> = [];
  private readonly closeListeners: Array<(event: ListeningGateEvent) => void> = [];
  private running = false;
  private open = false;

  constructor(options: ManualRecordingGateOptions = {}) {
    this.now = options.now ?? Date.now;
  }

  get isOpen(): boolean {
    return this.open;
  }

  async start(): Promise<void> {
    this.running = true;
  }

  async stop(): Promise<void> {
    if (this.open) this.close();
    this.running = false;
  }

  onOpen(callback: (event: ListeningGateEvent) => void): void {
    this.openListeners.push(callback);
  }

  onClose(callback: (event: ListeningGateEvent) => void): void {
    this.closeListeners.push(callback);
  }

  toggle(): void {
    if (this.open) {
      this.close();
      return;
    }

    this.openGate();
  }

  openGate(): void {
    if (!this.running || this.open) return;

    this.open = true;
    const event = this.event();
    this.openListeners.forEach((listener) => listener(event));
  }

  close(): void {
    if (!this.running || !this.open) return;

    this.open = false;
    const event = this.event();
    this.closeListeners.forEach((listener) => listener(event));
  }

  private event(): ListeningGateEvent {
    return {
      mode: "manual",
      timestamp: this.now()
    };
  }
}
