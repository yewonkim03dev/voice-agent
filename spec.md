# Voice Agent Spec Sheet

## 0. 목표

목표는 로컬에서 음성으로 Codex 또는 Claude 계열 코딩 에이전트를 자연스럽게 호출하고, 에이전트가 요청하는 권한 확인을 다시 음성으로 처리할 수 있게 만드는 것이다.

핵심은 음성 레이어가 똑똑한 코딩 판단자가 되는 것이 아니다. 로컬 레이어는 다음만 담당한다.

- 사용자의 음성을 수음한다.
- wake phrase 또는 수동 녹음 시작 신호를 감지한다.
- 음성을 텍스트로 변환한다.
- 일반 명령은 그대로 에이전트 백엔드로 전달한다.
- 에이전트가 이미 권한을 요청한 상태에서만 허용/거부 발화를 구조화된 승인 응답으로 매핑한다.
- 에이전트 출력과 음성 출력 상태를 사용자에게 보여준다.

즉, 일반 코딩 의도 판단은 Codex/Claude가 한다. 로컬은 voice I/O, wake, STT, native approval bridge, logging만 맡는다.

```text
Idle
-> Wake or manual record
-> Audio capture
-> STT
-> Transcript
-> Boundary router
-> AgentBackend
-> Native approval event if needed
-> Voice approval answer
-> Native approval decision
-> Agent continues
-> Completion
-> Idle
```

---

## 1. 설계 원칙

### 1.1 Pass-through 우선

실제 Codex/Claude 모드에서 사용자의 일반 발화는 로컬에서 if/else로 코딩 의도를 분류하지 않는다.

예:

```text
코덱스 이 파일 리팩토링하고 테스트 돌려줘
```

로컬 레이어가 해야 하는 일:

```text
wake phrase "코덱스" 제거
-> "이 파일 리팩토링하고 테스트 돌려줘"를 그대로 Codex에 전달
```

로컬 레이어가 하지 말아야 하는 일:

```text
"리팩토링"을 local refactor command로 분류
"테스트"를 local npm test command로 변환
로컬 정책으로 실행 계획 생성
```

### 1.2 권한 판단의 주체

명령 실행 권한 요청은 Codex/Claude 백엔드가 만든 native approval event가 기준이다.

로컬 레이어는 승인 여부를 자체적으로 새로 판단하지 않는다. 대신 native approval이 pending일 때만 사용자의 음성 응답을 다음 decision으로 매핑한다.

```text
허용 / approve              -> allow once
거부 / deny                 -> deny
이번 세션 동안 허용          -> allow for session, backend가 지원할 때만
애매한 응답                 -> 다시 물어봄, Codex로 전달하지 않음
```

native approval이 pending이 아니면 "허용" 같은 말도 일반 transcript로 취급하거나 개발 모드 정책에 따른다.

### 1.3 Mock runtime과 real backend 분리

MVP에는 두 흐름이 있다.

- Mock harness: `RuntimeController`와 in-memory backend로 상태 전이를 테스트한다.
- Real harness: Codex app-server 또는 Claude backend에 transcript와 approval decision을 pass-through한다.

`RuntimeController`는 테스트 가능한 MVP runtime으로 유지한다. 다만 real Codex/Claude 모드에서 코딩 명령을 로컬 intent로 해석하는 중심 컴포넌트가 되면 안 된다.

---

## 2. 전체 아키텍처

```text
┌────────────────────────────┐
│        AudioInput          │
│ mic / recorder process     │
└─────────────┬──────────────┘
              │ AudioFrame
              ▼
┌────────────────────────────┐
│       ListeningGate        │
│ manual record now          │
│ wake word later            │
└─────────────┬──────────────┘
              │ open / close
              ▼
┌────────────────────────────┐
│    RecordingController     │
│ collects utterance window  │
└─────────────┬──────────────┘
              │ frames
              ▼
┌────────────────────────────┐
│      UtteranceRecorder     │
│ AudioFrame -> Utterance    │
└─────────────┬──────────────┘
              │ UtteranceAudio
              ▼
┌────────────────────────────┐
│      SpeechProcessor       │
│ STT, language, confidence  │
└─────────────┬──────────────┘
              │ Transcript
              ▼
┌────────────────────────────┐
│      BoundaryRouter        │
│ wake strip, approval map   │
│ local harness commands     │
└─────────────┬──────────────┘
              │ Agent text or decision
              ▼
┌────────────────────────────┐
│       AgentBackend         │
│ Codex / Claude / in-memory │
└───────┬──────────────┬─────┘
        │              │
        ▼              ▼
┌───────────────┐   ┌────────────────┐
│ Agent events  │   │  VoiceOutput   │
│ stdout/perm   │   │ console / TTS   │
└───────────────┘   └────────────────┘
```

---

## 3. 실행 모드

### 3.1 Mock terminal harness

```bash
npm run harness
```

목적:

- dependency-free MVP runtime 테스트
- `RuntimeController` 상태 전이 확인
- in-memory `AgentBackend` 사용
- `/permission`, `/complete`, `/error` 같은 개발용 slash command 지원

이 모드는 real Codex를 실행하지 않는다.

### 3.2 Real Codex terminal harness

```bash
npm run harness:codex
```

목적:

- Codex app-server 기반 real backend 실행
- 사용자의 텍스트를 Codex로 pass-through
- Codex native approval request를 받아 터미널에 보여줌
- 사용자가 `허용`, `거부`, `이번 세션 동안 허용`을 입력하면 native approval decision으로 전달

### 3.3 Voice Codex harness

```bash
npm run setup:voice
npm run harness:voice:codex
```

목적:

- 마이크 입력을 실제로 사용
- `/record`로 녹음 시작/종료
- STT 결과를 `[stt:<language>]`로 출력
- transcript를 기존 real Codex pass-through 흐름으로 전달

manual mode는 push-to-talk 방식이다.

always-on wake mode는 별도 스크립트로 실행한다.

```bash
npm run harness:wake:codex
```

always-on mode는 recorder/STT 파이프라인을 그대로 두고, VAD로 후보 발화를 잘라 STT를 한 번 실행한다. transcript가 설정된 wake phrase로 시작하면 wake phrase를 제거하고 나머지를 Codex로 전달한다. 일치하지 않으면 폐기한다. `/record`는 manual fallback으로 유지한다.

### 3.4 Claude backend

Claude는 같은 `AgentBackend` 인터페이스로 붙인다.

중요 조건:

- Claude가 native structured approval API를 제공하면 Codex와 동일하게 매핑한다.
- structured approval API가 없고 PTY 텍스트만 파싱해야 한다면 fallback으로 분리한다.
- fallback parser는 best-effort이며 MVP의 핵심 성공 기준이 아니다.

---

## 4. 핵심 타입

### 4.1 AudioFrame

마이크 입력은 일정한 프레임 단위로 흐른다.

```ts
interface AudioFrame {
  timestamp: number;
  sampleRate: number;
  channels: number;
  format: "pcm_s16le" | "pcm_f32";
  data: ArrayBuffer;
  rms?: number;
  peak?: number;
}
```

### 4.2 AudioInput

```ts
interface AudioInput {
  start(): Promise<void>;
  stop(): Promise<void>;
  onFrame(callback: (frame: AudioFrame) => void): void;
}
```

역할은 오직 audio frame 생산이다. STT, wake, Codex 정책을 몰라야 한다.

### 4.3 ListeningGate

```ts
interface ListeningGate {
  open(): void;
  close(): void;
  isOpen(): boolean;
}
```

현재 구현은 `ManualRecordingGate`다.

향후 wake word를 붙일 때도 downstream 구조는 그대로 두고 gate 구현만 교체한다.

```text
ManualRecordingGate -> WakeWordGate + VADGate
```

### 4.4 UtteranceAudio

```ts
interface UtteranceAudio {
  data: ArrayBuffer;
  sampleRate: number;
  channels: number;
  format: "pcm_s16le" | "wav";
  startedAt: number;
  endedAt: number;
  durationMs: number;
  rms?: number;
  peak?: number;
}
```

녹음이 끝난 뒤 STT로 넘기기 위한 단위다. 기본 흐름에서는 STT 처리 후 메모리에서 사라진다. 디버깅 저장은 별도 옵션으로만 둔다.

### 4.5 Transcript

```ts
interface Transcript {
  text: string;
  normalizedText: string;
  language: "ko" | "en" | "mixed" | "unknown";
  confidence: number;
  startedAt: number;
  endedAt: number;
}
```

`Transcript`는 agent backend로 넘길 가장 중요한 경계 객체다.

### 4.6 SpeechProcessor

```ts
interface SpeechProcessor {
  transcribe(audio: UtteranceAudio): Promise<Transcript>;
}
```

구현체 예:

- macOS Apple Speech
- local Whisper command
- future cloud STT

### 4.7 VoiceOutput

```ts
interface VoiceOutput {
  speak(message: VoiceMessage): Promise<void>;
}
```

현재 fallback은 `ConsoleVoiceOutput`이다.

```text
[voice:ack] 알겠어. 실행할게.
[voice:permission] npm test 실행 권한 필요해. 허용할까?
[voice:completion] 끝났어.
```

TTS를 켜면 `TtsVoiceOutput`이 console line을 계속 출력하면서 provider에 같은 메시지를 전달한다. macOS MVP provider는 Apple `AVSpeechSynthesizer` helper다.

```bash
npm run harness:wake:codex -- --tts
```

provider 선택 규칙:

- TTS disabled: `ConsoleVoiceOutput`
- TTS enabled + macOS + provider 미지정: `macos-apple`
- TTS enabled + non-macOS + provider 미지정: `ConsoleVoiceOutput`
- explicit provider `console`: real TTS 비활성

TTS는 `ack`, permission prompt, retry, completion, error/warning 같은 짧은 voice message만 말한다. raw stdout token stream, 긴 로그, test output, STT diagnostics는 읽지 않는다.

### 4.8 TTS Playback, EchoGuard, Barge-In

always-on wake mode는 TTS 중에도 microphone/VAD를 계속 듣지만, VAD candidate start만으로는 TTS를 멈추지 않는다.

`TtsPlaybackState`는 최근 spoken text와 재생 상태를 bounded history로 보관한다.

`EchoGuard`는 STT 결과를 최근 TTS text와 로컬 문자열 유사도로 비교한다.

- normalize: lowercase English, whitespace collapse, punctuation 제거, Korean/English/number 유지
- cheap checks first: substring, token overlap
- edit similarity는 짧은 text에만 사용
- echo로 판단되면 Codex/Claude로 forwarding하지 않는다

`BargeInPolicy`는 speaking/recent TTS 상태에서만 적용된다.

- no wake: ignore
- wake only: ignore
- wake + stop intent: TTS stop
- wake + new command: TTS stop 후 command forwarding
- pending native approval speech는 기존 approval flow가 우선한다

diagnostics:

```text
[echo:discarded] similarity=0.931 strategy=edit_similarity
[barge:ignored] reason=wake_only
[barge:stop] phrase="코덱스"
[barge:command] phrase="코덱스" command="npm test 다시 돌려줘"
```

### 4.9 Voice-Agent Response Protocol

real Codex/Claude session에서는 voice-agent protocol prompt를 붙여 agent가 NDJSON event를 스트리밍하도록 유도한다.

```jsonl
{"op":"voice-agent","type":"speech","text":"확인했어. 테스트부터 돌려볼게."}
{"op":"voice-agent","type":"command","text":"npm test"}
{"op":"voice-agent","type":"status","text":"테스트 실행 중이야."}
{"op":"voice-agent","type":"error","text":"테스트 실행에 실패했어."}
```

처리 규칙:

- `speech`: 라인이 완성되는 즉시 TTS queue로 보낸다.
- `command`: terminal/UI log에 표시하고 기본적으로 말하지 않는다.
- `status`: 짧은 상태는 표시하고 말할 수 있다.
- `error`: 표시하고 짧게 말한다.
- invalid JSON, `op !== "voice-agent"`, 미지원 event는 raw stdout fallback으로 표시한다.
- structured speech가 이미 나온 turn에는 generic completion인 `끝났어.`를 중복으로 말하지 않는다.
- permission approval flow는 native Codex/Claude approval request 기준을 유지한다.

### 4.10 Native Visual Companion

visual companion은 browser/Electron/Tauri/WebView 없이 Qt/QML window로 제공한다.

```bash
npm run setup:visual
npm run visual
npm run harness:wake:codex -- --visual
```

기본 provider는 `auto`다. Qt/QML이 우선이며 `qml6`, `qml`, `qmlscene6`, `qmlscene`이 PATH에 있으면 Qt/QML UI를 실행한다. Qt가 없고 macOS에서 `swift`가 있으면 Swift/AppKit native companion으로 fallback한다. `npm run setup:visual`은 현재 provider 상태를 점검하고 Qt 설치 명령을 출력한다.

```bash
npm run harness:wake:codex -- --visual --visual-provider qtqml
npm run harness:wake:codex -- --visual --visual-provider macos-native
```

bridge는 dependency-free local WebSocket server이며 UI는 Qt `WebSocket` 또는 macOS native `URLSessionWebSocketTask`로 연결한다.

UI event:

```jsonl
{"op":"voice-agent-ui","type":"state","state":"idle"}
{"op":"voice-agent-ui","type":"volume","rms":0.02,"peak":0.15}
{"op":"voice-agent-ui","type":"wake","phrase":"코덱스"}
{"op":"voice-agent-ui","type":"command","text":"npm test"}
```

control event:

```jsonl
{"op":"voice-agent-ui","type":"control","action":"tts_stop"}
{"op":"voice-agent-ui","type":"control","action":"exit"}
```

규칙:

- UI는 Codex/Claude에 직접 coding command를 보내지 않는다.
- `command` event는 bounded command panel에 표시하고 TTS로 읽지 않는다.
- `tts_stop`은 `/tts-stop`과 같은 효과만 낸다.
- `exit`은 UI/visual bridge만 닫는 의도이며 Codex/Claude session을 죽이지 않는다.
- Qt/QML runtime이 없으면 `[visual] unavailable: ...`를 출력하고 terminal harness는 계속 동작한다.

---

## 5. BoundaryRouter

`BoundaryRouter`는 로컬에서 해도 되는 얇은 판단만 수행한다.

### 5.1 허용되는 로컬 처리

- wake phrase 제거
- TTS self-echo filtering
- TTS 중 explicit barge-in 처리
- pending native approval에 대한 허용/거부 매핑
- `/status`, `/quit`, `/record`, `/tts-stop` 같은 harness control command
- interrupt/cancel 같은 명시적 runtime control
- 로그와 voice output formatting

### 5.2 금지되는 로컬 처리

- 일반 코딩 명령을 local intent로 분류
- "테스트 돌려줘"를 로컬에서 `npm test`로 변환
- "리팩토링해줘"를 local refactor action으로 변환
- 권한이 pending이 아닌데 사용자의 긍정/부정을 임의 승인으로 처리
- Codex/Claude가 요청하지 않은 fake permission flow 생성

### 5.3 Wake phrase 처리

지원 예:

```text
코덱스 테스트 돌려줘       -> 테스트 돌려줘
codex run npm test       -> run npm test
클로드 타입 에러 고쳐줘    -> 타입 에러 고쳐줘
claude explain this file  -> explain this file
```

wake phrase가 없더라도 개발 모드에서는 plain text pass-through를 허용할 수 있다.

---

## 6. Native approval 처리

### 6.1 상태

```ts
type ApprovalState =
  | { status: "none" }
  | { status: "pending"; request: NativeApprovalRequest };
```

### 6.2 Request

```ts
interface NativeApprovalRequest {
  id: string;
  command: string;
  cwd?: string;
  reason?: string;
  backend: "codex" | "claude";
  supportedDecisions: ApprovalDecisionKind[];
}
```

### 6.3 Decision

```ts
type ApprovalDecisionKind =
  | "allow_once"
  | "deny"
  | "allow_for_session";
```

### 6.4 Mapping

```text
허용, 승인, 응, 그래, yes, approve
-> allow_once

거부, 아니, 안돼, deny, no
-> deny

이번 세션 동안 허용, 세션 동안 허용, always for this session
-> allow_for_session, backend가 지원할 때만
```

애매한 발화는 Codex/Claude로 보내지 않고 다시 물어본다.

```text
[voice:permission] 정확히 허용 또는 거부로 말해줘.
```

---

## 7. AgentBackend

### 7.1 인터페이스

```ts
interface AgentBackend {
  start(): Promise<void>;
  stop(): Promise<void>;
  sendUserText(text: string): Promise<void>;
  sendApprovalDecision(
    requestId: string,
    decision: ApprovalDecisionKind
  ): Promise<void>;
  onEvent(callback: (event: AgentEvent) => void): void;
}
```

### 7.2 Codex backend

현재 real Codex backend의 기준은 Codex app-server websocket이다.

해야 하는 일:

- session 시작
- user text 전송
- stdout/stderr/assistant output 수신
- native approval request 수신
- approval decision 전송

하지 않는 일:

- primary path에서 Codex PTY stdin을 직접 조작
- approval UI를 텍스트 파싱으로 추측
- `approve_action` 같은 fake user command를 Codex에게 다시 보냄

### 7.3 Claude backend

Claude도 같은 backend 인터페이스로 붙인다. 다만 Claude의 실제 permission protocol이 structured API인지, PTY 기반인지에 따라 구현 난이도가 달라진다.

MVP 기준:

- structured approval이 있으면 native bridge로 지원
- 없으면 별도 fallback backend로 분리
- fallback은 user-facing 안정성을 낮게 표기

---

## 8. Runtime state

상태 이름은 기존 runtime 타입을 유지한다.

```ts
type AgentState =
  | "BOOTING"
  | "IDLE"
  | "LISTENING"
  | "TRANSCRIBING"
  | "THINKING"
  | "CONFIRMING"
  | "EXECUTING"
  | "WAITING_CODEX"
  | "INTERRUPTING"
  | "SPEAKING"
  | "ERROR"
  | "SHUTDOWN";
```

상태 의미:

| State | Meaning |
| --- | --- |
| `BOOTING` | 설정, backend, audio layer 초기화 |
| `IDLE` | wake 또는 명령 입력 대기 |
| `LISTENING` | 음성 녹음 중 |
| `TRANSCRIBING` | STT 처리 중 |
| `THINKING` | mock runtime에서만 local command 처리 중 |
| `CONFIRMING` | native approval pending |
| `EXECUTING` | agent backend에 입력 또는 approval decision 전송 중 |
| `WAITING_CODEX` | agent 응답, 권한 요청, 완료 이벤트 대기 |
| `INTERRUPTING` | 사용자 중단 요청 처리 중 |
| `SPEAKING` | voice output 출력 중 |
| `ERROR` | 복구 가능한 오류 |
| `SHUTDOWN` | 종료 |

real backend에서 `THINKING`은 로컬 의도 판단을 뜻하지 않는다. agent에게 넘긴 뒤 응답을 기다리는 표시 상태로만 사용한다.

---

## 9. Voice setup

### 9.1 목표

사용자는 가능하면 다음만 실행하면 된다.

```bash
npm run setup:voice
npm run harness:voice:codex
```

`setup:voice`는 현재 OS와 설치된 도구를 검사하고 `.voice-agent.local.json`을 만든다.

### 9.2 Provider 구조

provider는 recorder와 STT를 한 쌍으로 제공한다.

```ts
interface VoiceProvider {
  id: string;
  platform: "darwin" | "linux" | "win32" | "any";
  recorderCommand: string;
  sttCommand: string;
}
```

현재 목표 provider:

- `macos-swift`: AVFoundation recorder + Apple Speech STT
- `sox-whisper`: SoX recorder + local Whisper CLI
- future `windows-*`: Windows microphone/STT adapter
- future `linux-*`: PulseAudio/PipeWire recorder + Whisper adapter

### 9.3 macOS provider

macOS 기본 provider는 Swift helper를 사용한다.

Recorder:

```text
swift src/audio/macos-record-pcm.swift
```

STT:

```text
swift src/speech/macos-transcribe.swift {audio}
```

Apple Speech 구현은 `SFSpeechAudioBufferRecognitionRequest` 기반이다.

진단 로그:

```text
[stt:apple] authorization=authorized
[stt:apple] locale=ko-KR status=start
[stt:apple] locale=ko-KR request=audio_buffer
[stt:apple] locale=ko-KR appendFrames=43008
[stt:apple] locale=ko-KR status=result confidence=0.82 textLength=18
```

---

## 10. Logging and observability

음성 MVP는 눈으로 확인 가능한 로그가 필수다.

녹음 종료 시:

```text
[audio] bytes=86016 durationMs=3291 rms=0.0211 peak=0.1659
```

STT 시작/결과:

```text
[stt:apple] authorization=authorized
[stt:apple] locale=ko-KR status=start
[stt:ko] 코덱스 테스트 돌려줘
```

agent 전송:

```text
[codex-app] turn/start voice_sess_...: 테스트 돌려줘
```

권한 요청:

```text
[codex-app] approval requested: /bin/zsh -lc 'npm test'
[voice:permission] /bin/zsh -lc 'npm test' 실행 권한 필요해. 허용할까?
```

완료:

```text
[voice:completion] 끝났어.
```

---

## 11. 현재 MVP success criteria

### 11.1 Terminal harness

- `npm test` passes.
- `npm run harness` starts dependency-free mock harness.
- `npm run harness:codex` starts real Codex backend harness.
- 일반 텍스트 입력이 Codex로 전달된다.
- pending native approval 중 `허용`이 allow decision으로 전달된다.
- pending native approval 중 `거부`가 deny decision으로 전달된다.
- 위험 명령에 대한 강한 확인 정책은 backend native approval capability를 우선한다.

### 11.2 Voice harness

- `npm run setup:voice`가 가능한 provider를 탐색한다.
- `npm run harness:voice:codex`가 시작된다.
- `/record`로 녹음을 시작하고 다시 `/record`로 종료한다.
- `npm run harness:wake:codex`가 `/record` 없이 always-on mode로 시작된다.
- 사용자 설정 wake phrase가 `.voice-agent.local.json` 또는 환경 변수에서 로드된다.
- 녹음 종료 후 audio byte length, duration, rms, peak가 출력된다.
- Apple Speech 또는 configured STT가 transcript를 생성한다.
- `[stt:<language>]` 로그가 출력된다.
- `코덱스 간단한 npm test 돌려줘`는 `간단한 npm test 돌려줘`로 Codex에 전달된다.
- `자비스 간단한 npm test 돌려줘`는 `자비스`가 설정된 경우 `간단한 npm test 돌려줘`로 Codex에 전달된다.
- `codex run npm test`는 `run npm test`로 Codex에 전달된다.
- 호출어 없는 후보 발화는 STT 후 폐기된다.
- pending approval 중 `허용`은 native approval allow로 전달된다.
- pending approval 중 `거부`는 native approval deny로 전달된다.
- ambiguous approval speech는 Codex로 전달하지 않고 다시 묻는다.

---

## 12. 다음 단계

### Goal 1: Voice input hardening

- macOS recorder/STT 안정화
- 권한 상태와 STT 실패 원인 로그 개선
- audio quality diagnostics 유지
- 테스트 fixture 보강

### Goal 2: Always-on wake hardening

- VAD threshold를 실제 환경에서 튜닝
- wake phrase UX와 설정 편의성 개선
- 긴 idle 시간과 잡음 환경에서 메모리/CPU 사용량 검증
- production wake-word ML 모델 도입 여부 평가

### Goal 3: Voice output and visual feedback hardening

- macOS TTS voice/rate preset 튜닝
- Azure/OpenAI TTS provider 추가 여부 평가
- speaking state를 terminal 또는 작은 UI에 표시
- agent stdout/stderr log panel 제공
- 사용자의 recognized speech를 별도 영역에 표시

### Goal 4: Claude backend

- Claude permission protocol 조사
- structured approval 가능 여부 확인
- 가능하면 `AgentBackend` 구현
- 불가능하면 PTY fallback을 별도 experimental 모드로 분리

---

## 13. 명시적 non-goals

현재 브랜치에서 하지 않는다.

- 로컬 코딩 의도 분류
- real Codex PTY 직접 조작을 primary path로 사용
- fake approval prompt를 만들어 Codex/Claude에 다시 전송
- production-grade wake word ML model
- 시각 UI production 구현
- Azure/OpenAI cloud TTS provider 구현
- Claude approval protocol 완성
- 클라우드 STT 의존성 강제

---

## 14. 요약

이 프로젝트의 올바른 중심축은 다음이다.

```text
Voice I/O layer
-> Transcript
-> Thin boundary routing
-> Native agent backend
-> Native approval bridge
```

로컬 레이어는 사용자의 말을 똑똑하게 코딩 명령으로 바꾸는 뇌가 아니다. Codex/Claude가 이미 그 역할을 한다. 로컬 레이어는 사람이 손으로 하던 입력, 승인, 거부, 중단을 음성으로 정확히 이어주는 얇고 신뢰 가능한 인터페이스여야 한다.
