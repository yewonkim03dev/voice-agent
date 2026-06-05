import type { UtteranceAudio } from "../recorder/UtteranceAudio.ts";
import type { Transcript } from "./Transcript.ts";

export interface SpeechProcessor {
  transcribe(audio: UtteranceAudio): Promise<Transcript>;
}
