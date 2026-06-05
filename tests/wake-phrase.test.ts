import assert from "node:assert/strict";
import test from "node:test";

import { detectConfiguredWakePhrase, detectWakePhrase } from "../src/wake/WakePhraseRouter.ts";

test("detects Codex wake phrases and strips the phrase", () => {
  assert.deepEqual(detectWakePhrase("코덱스 간단한 npm test 돌려줘"), {
    target: "codex",
    phrase: "코덱스",
    commandText: "간단한 npm test 돌려줘",
    strategy: "exact"
  });
});

test("detects wake phrases with multiline command context", () => {
  assert.deepEqual(detectWakePhrase("코덱스 테스트 돌려줘\n\n추가 정보:\n- README.md"), {
    target: "codex",
    phrase: "코덱스",
    commandText: "테스트 돌려줘\n\n추가 정보:\n- README.md",
    strategy: "exact"
  });
});

test("detects Claude wake phrases", () => {
  assert.deepEqual(detectWakePhrase("헤이 클로드 status 확인해"), {
    target: "claude",
    phrase: "클로드",
    commandText: "status 확인해",
    strategy: "exact"
  });
});

test("ignores lines without a wake phrase", () => {
  assert.equal(detectWakePhrase("그냥 npm test 돌려줘"), null);
});

test("detects user-configured wake phrases", () => {
  assert.deepEqual(detectConfiguredWakePhrase("자비스 테스트 돌려줘", ["자비스"]), {
    phrase: "자비스",
    commandText: "테스트 돌려줘",
    strategy: "exact"
  });
});

test("prefers longer configured wake phrases", () => {
  assert.deepEqual(detectConfiguredWakePhrase("hey codex run npm test", ["codex", "hey codex"]), {
    phrase: "hey codex",
    commandText: "run npm test",
    strategy: "exact"
  });
});

test("detects wake phrases split by STT spaces", () => {
  assert.deepEqual(detectConfiguredWakePhrase("코 덱스 테스트 돌려줘", ["코덱스"]), {
    phrase: "코덱스",
    commandText: "테스트 돌려줘",
    strategy: "normalized",
    heardText: "코 덱스",
    normalizedText: "코덱스",
    distance: 0
  });
  assert.deepEqual(detectConfiguredWakePhrase("c o d e x run npm test", ["codex"]), {
    phrase: "codex",
    commandText: "run npm test",
    strategy: "normalized",
    heardText: "c o d e x",
    normalizedText: "codex",
    distance: 0
  });
});

test("detects lightly misrecognized wake phrases with fuzzy prefix matching", () => {
  assert.deepEqual(detectConfiguredWakePhrase("코넥스 테스트 돌려줘", ["코덱스"]), {
    phrase: "코덱스",
    commandText: "테스트 돌려줘",
    strategy: "fuzzy",
    heardText: "코넥스",
    normalizedText: "코넥스",
    distance: 1
  });
  assert.deepEqual(detectConfiguredWakePhrase("클노드 상태 봐줘", ["클로드"]), {
    phrase: "클로드",
    commandText: "상태 봐줘",
    strategy: "fuzzy",
    heardText: "클노드",
    normalizedText: "클노드",
    distance: 1
  });
});

test("keeps fuzzy wake matching constrained to the prefix", () => {
  assert.equal(detectConfiguredWakePhrase("code review 해줘", ["codex"]), null);
  assert.equal(detectConfiguredWakePhrase("테스트 돌려줘 코넥스", ["코덱스"]), null);
});
