export interface LogEvent {
  timestamp: number;
  level: "debug" | "info" | "warn" | "error";
  component:
    | "audio"
    | "wake"
    | "recorder"
    | "stt"
    | "router"
    | "runtime"
    | "codex"
    | "tts"
    | "policy";
  message: string;
  data?: unknown;
}

export interface Logger {
  log(event: LogEvent): void;
}

export class ConsoleLogger implements Logger {
  log(event: LogEvent): void {
    console.log(JSON.stringify(maskLogEvent(event)));
  }
}

export function maskLogEvent(event: LogEvent): LogEvent {
  return JSON.parse(
    JSON.stringify(event).replace(
      /(api[_-]?key|token|password|private key|authorization header|cookie)(["':=\s]+)[^"',\s}]+/gi,
      "$1$2[REDACTED]"
    )
  ) as LogEvent;
}
