export interface VoiceMessage {
  id: string;
  text: string;
  language: "ko" | "en";
  priority: "low" | "normal" | "urgent";
  interruptible: boolean;
  category: "ack" | "permission" | "status" | "completion" | "error" | "warning";
}
