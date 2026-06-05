import assert from "node:assert/strict";
import test from "node:test";

import { detectConfiguredWakePhrase, detectWakePhrase } from "../src/wake/WakePhraseRouter.ts";

test("detects Codex wake phrases and strips the phrase", () => {
  assert.deepEqual(detectWakePhrase("코덱스 간단한 npm test 돌려줘"), {
    target: "codex",
    phrase: "코덱스",
    commandText: "간단한 npm test 돌려줘"
  });
});

test("detects Claude wake phrases", () => {
  assert.deepEqual(detectWakePhrase("헤이 클로드 status 확인해"), {
    target: "claude",
    phrase: "클로드",
    commandText: "status 확인해"
  });
});

test("ignores lines without a wake phrase", () => {
  assert.equal(detectWakePhrase("그냥 npm test 돌려줘"), null);
});

test("detects user-configured wake phrases", () => {
  assert.deepEqual(detectConfiguredWakePhrase("자비스 테스트 돌려줘", ["자비스"]), {
    phrase: "자비스",
    commandText: "테스트 돌려줘"
  });
});

test("prefers longer configured wake phrases", () => {
  assert.deepEqual(detectConfiguredWakePhrase("hey codex run npm test", ["codex", "hey codex"]), {
    phrase: "hey codex",
    commandText: "run npm test"
  });
});
