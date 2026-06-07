export interface AgentEvent<T = unknown> {
  id: string;
  type: string;
  timestamp: number;
  sessionId?: string;
  source: string;
  payload: T;
}

type Listener<T> = (event: AgentEvent<T>) => void;

export class EventBus {
  private listeners = new Map<string, Set<Listener<unknown>>>();

  on<T>(type: string, listener: Listener<T>): () => void {
    const listeners = this.listeners.get(type) ?? new Set<Listener<unknown>>();
    listeners.add(listener as Listener<unknown>);
    this.listeners.set(type, listeners);

    return () => listeners.delete(listener as Listener<unknown>);
  }

  emit<T>(event: AgentEvent<T>): void {
    const listeners = this.listeners.get(event.type);
    if (!listeners) return;

    for (const listener of listeners) {
      listener(event as AgentEvent<unknown>);
    }
  }
}
