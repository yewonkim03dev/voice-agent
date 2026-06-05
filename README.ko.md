# Voice Agent

Voice Agent는 Codex를 대화형 로컬 코딩 에이전트처럼 쓰기 위한 음성 인터페이스를 지향합니다. 호출어로 깨우고, 한국어/영어 자연어로 작업을 말하고, 짧은 음성 응답을 들으며, Codex가 묻는 권한도 키보드 없이 음성으로 허용/거부하는 흐름을 목표로 합니다.

현재 구현은 macOS에 최적화되어 있습니다. Mac 마이크로 음성을 받고, Apple Speech 기반 STT로 전사한 뒤, wake 명령을 Codex로 전달하고, Apple TTS와 native visual companion으로 응답/상태/권한 대기를 보여줍니다.

핵심 원칙은 pass-through입니다. 로컬 레이어는 코딩 의도를 직접 분류하지 않고, wake/STT/TTS/visual/approval bridge만 담당합니다. 일반 명령은 그대로 Codex 또는 Claude backend로 전달됩니다.

## macOS 빠른 시작

필요한 것:

- macOS 마이크/음성 인식 권한
- Node.js 22 이상
- 설치 및 로그인된 로컬 `codex` CLI
- 선택: Qt/QML visual runtime. Qt가 없으면 macOS에서는 Swift/AppKit visual fallback을 사용합니다.

clone부터 바로 실행:

```sh
git clone git@github.com:yewonkim03dev/voice-agent.git
cd voice-agent
npm run setup:voice
npm run setup:visual
npm run harness:wake:codex -- --visual --tts
```

이후 이렇게 말하면 됩니다.

```text
코덱스 npm test 돌려줘
자비스 현재 파일 리팩토링해줘
헤이 자비스 테스트 실행해줘
hey jarvis run npm test
```

Codex가 권한을 물어보면 `허용`, `거부`, `이번 세션 동안 허용`처럼 답하면 됩니다. `approval_pending` 화면에는 현재 로컬이 인식하는 허용/거부 문구가 유지됩니다.

TTS만 먼저 확인:

```sh
npm run tts:test -- --ko "코덱스 음성 출력 테스트야."
npm run tts:test -- --en "Codex voice output test."
```

테스트:

```sh
npm test
```

## 지원 모드

### Always-On Wake Codex Harness

실제 사용 기준 기본 실행은 다음입니다.

```sh
npm run harness:wake:codex -- --tts --visual
```

항상대기 모드는 recorder/STT 파이프라인을 유지하면서 VAD로 후보 발화를 자릅니다. 후보 발화는 STT 한 번을 거친 뒤 wake phrase로 시작하는 경우에만 Codex로 전달됩니다.

기본 호출어:

```json
[
  "코덱스",
  "클로드",
  "자비스",
  "codex",
  "claude",
  "jarvis",
  "hey codex",
  "hey claude",
  "hey jarvis",
  "헤이 자비스",
  "hey 자비스"
]
```

항상대기 모드에서 wake phrase만 말하면 follow-up window가 열립니다. 예를 들어 `자비스`만 말한 뒤 다음 발화로 `npm test 돌려줘`라고 말하면, 다음 발화를 한 번만 wake 없이 Codex로 전달하고 다시 wake-required 상태로 돌아갑니다.

STT가 `코 덱스`, `c o d e x`, `코넥스`처럼 조금 틀리거나 띄어쓰기를 넣는 경우를 위해 prefix-only normalized/fuzzy wake matching을 사용합니다. 이 로직은 wake 감지용이며, 일반 코딩 명령의 의도 분류에는 사용하지 않습니다.

### Real Codex Harness

텍스트만 실제 Codex app-server로 전달:

```sh
npm run harness:codex
```

`npm run harness:codex`는 `codex app-server --listen ws://127.0.0.1:0`를 실행하고 websocket JSON-RPC로 연결합니다.

일반 텍스트는 `turn/start`로 Codex에 그대로 전달됩니다. 로컬에서 "테스트", "리팩토링" 같은 코딩 의도를 if/else로 분류하지 않습니다.

Codex app-server가 native approval을 요청하면 harness가 permission prompt를 표시하고 TTS/visual로 안내합니다. 사용자가 `허용`, `거부`, `이번 세션 동안 허용` 등을 말하면 native decision으로 다시 전달합니다.

Codex thread id는 `.voice-agent.local.json`의 `codex.threadId`에 저장됩니다. 이후 실행은 가능한 경우 같은 app chat thread를 resume합니다.

### Manual Voice Harness

수동 녹음 모드:

```sh
npm run harness:voice:codex
```

`/record`로 녹음을 시작하고 다시 `/record`로 종료합니다. 녹음된 발화는 STT를 거쳐 기존 Codex pass-through 흐름으로 들어갑니다.

### Mock Terminal Harness

개발/테스트용 mock runtime:

```sh
npm run harness
```

이 모드는 real Codex를 실행하지 않습니다. `RuntimeController`와 in-memory `AgentBackend`로 상태 전이와 permission flow를 테스트합니다.

사용 가능한 slash command:

- `/status`
- `/permission <command>`
- `/complete`
- `/error <message>`
- `/tts-stop`
- `/quit`

## 권한 허용/거부

native approval이 pending일 때만 approval speech를 해석합니다.

허용 once:

```text
허용
승인
응
좋아
yes
approve
allow
go ahead
ok
```

거부:

```text
거부
아니
안 돼
취소
멈춰
no
deny
reject
cancel
stop
```

세션 허용:

```text
이번 세션 동안 허용
이번 세션은 허용
세션 동안 허용
계속 허용
always allow
allow for session
```

계속 허용:

```text
같은 명령 계속 허용
앞으로 이 명령은 허용
이 명령 계속 허용
항상 이 명령 허용
remember this command
```

애매한 발화는 Codex로 전달하지 않고 다시 물어봅니다.

## TTS

`--tts`를 붙이면 실제 TTS를 사용합니다. macOS에서는 기본 provider가 Apple `AVSpeechSynthesizer`입니다. 지원되지 않는 플랫폼에서는 console voice output fallback을 유지합니다.

```sh
npm run harness:wake:codex -- --tts
npm run harness:wake:codex -- --tts --tts-voice Yuna --tts-gender female --tts-rate fast
```

TTS는 짧은 speech, permission prompt, completion, warning/error를 말합니다. raw stdout, 긴 로그, command/path/url은 읽지 않고 visual command panel에 표시하는 쪽을 우선합니다.

## Visual UI

`--visual`을 붙이면 native visual companion을 띄웁니다.

```sh
npm run harness:wake:codex -- --visual
npm run harness:wake:codex -- --visual --tts
```

기본 provider는 `auto`입니다.

- Qt/QML이 있으면 Qt visual 사용
- macOS에서 Qt가 없고 Swift가 있으면 AppKit visual fallback 사용
- 둘 다 없으면 harness는 visual 없이 계속 실행

visual은 다음 상태를 표시합니다.

- `idle`
- `listening`
- `stt_processing`
- `submitting`
- `thinking`
- `running`
- `speaking`
- `approval_pending`
- `wake_rejected`
- `error`

`approval_pending`에서는 현재 로컬에 설정된 허용/거부/세션 허용/계속 허용 문구가 화면에 유지됩니다. `TTS Stop` 버튼은 `/tts-stop`과 같은 동작이고, `Exit` 버튼은 visual만 닫는 것이 아니라 harness 전체 종료를 요청합니다.

## 로컬 설정

`.voice-agent.local.json`은 git에 포함되지 않는 로컬 설정 파일입니다.

예:

```json
{
  "recorderCommand": "exec swift src/audio/macos-record-pcm.swift",
  "sttCommand": "swift src/speech/macos-transcribe.swift {audio}",
  "sampleRate": 16000,
  "channels": 1,
  "wakePhrases": ["자비스", "헤이 자비스", "jarvis", "hey jarvis", "코덱스", "codex"],
  "tts": {
    "enabled": true,
    "provider": "macos-apple",
    "language": "auto",
    "gender": "auto",
    "rate": "fast"
  },
  "visual": {
    "provider": "auto"
  }
}
```

환경 변수로도 설정할 수 있습니다.

```sh
export VOICE_AGENT_WAKE_PHRASES='자비스,헤이 자비스,jarvis,hey jarvis,코덱스,codex'
export VOICE_AGENT_TTS_ENABLED=true
export VOICE_AGENT_TTS_PROVIDER=macos-apple
export VOICE_AGENT_TTS_RATE=fast
```

## Claude

Claude mode는 다음으로 실행합니다.

```sh
npm run harness:claude
```

현재 구현은 local `claude` CLI를 probe하고, structured approval transport가 없으면 안전하지 않은 PTY scraping을 가장하지 않고 정확한 capability 오류를 출력합니다.

## 테스트

```sh
npm test
```

이 브랜치는 production-grade wake word ML, cloud TTS provider, unsafe PTY approval scraping을 구현하지 않습니다. 항상대기 wake mode는 VAD로 후보 발화를 자르고, STT 결과가 설정된 wake phrase로 시작할 때만 agent backend로 전달합니다.
