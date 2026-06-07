import type { UtteranceAudio } from "../recorder/UtteranceAudio.ts";

export function encodePcmS16leWav(audio: UtteranceAudio): Buffer {
  const data = Buffer.from(audio.data);
  const header = Buffer.alloc(44);
  const bytesPerSample = 2;
  const blockAlign = audio.channels * bytesPerSample;
  const byteRate = audio.sampleRate * blockAlign;

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.byteLength, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(audio.channels, 22);
  header.writeUInt32LE(audio.sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.byteLength, 40);

  return Buffer.concat([header, data]);
}
