import assert from "node:assert/strict";
import test from "node:test";

import { DevelopmentTranscriptInput } from "../src/speech/TranscriptInput.ts";

test("development transcript input emits normalized transcripts while running", async () => {
  const input = new DevelopmentTranscriptInput({
    now: () => 1000,
    createId: (prefix) => `${prefix}_1`,
    defaultSessionId: "sess_1",
    defaultLanguage: "ko"
  });
  const transcripts: unknown[] = [];
  input.onTranscript((transcript) => transcripts.push(transcript));

  const beforeStart = input.emitText("  코덱스   테스트  ");
  await input.start();
  const emitted = input.emitText("  코덱스   테스트  ");

  assert.equal(transcripts.length, 1);
  assert.equal(beforeStart.normalizedText, "코덱스 테스트");
  assert.deepEqual(emitted, transcripts[0]);
  assert.equal(emitted.sessionId, "sess_1");
  assert.equal(emitted.language, "ko");
});
