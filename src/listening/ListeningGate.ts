import type { ActivationEvent } from "../wake/ActivationEvent.ts";

export type ListeningGateEvent = ActivationEvent;

export interface ListeningGate {
  start(): Promise<void>;
  stop(): Promise<void>;
  onOpen(callback: (event: ListeningGateEvent) => void): void;
  onClose(callback: (event: ListeningGateEvent) => void): void;
}
