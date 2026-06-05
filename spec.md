# Voice-Codex Agent Spec Sheet

## 0. 목표 정의

목표는 **Codex CLI를 항상 켜둔 상태에서**, 사용자가 음성으로 명령하면 에이전트가 다음을 수행하는 시스템이다.

```text
대기 상태
→ 호출어 또는 인터럽트 감지
→ 음성 녹음
→ 언어 감지
→ STT
→ 명령 해석
→ 짧은 음성 응답
→ Codex CLI에 명령 전달
→ Codex가 권한 요청
→ 사용자가 음성으로 허용/거부
→ 작업 실행
→ 필요 시 진행/완료 음성 피드백
→ 다시 대기 상태
```

핵심은 “음성 입력기”가 아니라 **음성 기반 Agent Runtime Controller**로 설계하는 것이다.

---

# 1. 전체 아키텍처

```text
┌────────────────────────────┐
│        Audio Input         │
│  microphone / device API   │
└─────────────┬──────────────┘
              │ audio_frame
              ▼
┌────────────────────────────┐
│      Wake / Interrupt      │
│ wake word, barge-in, VAD   │
└─────────────┬──────────────┘
              │ activation_event
              ▼
┌────────────────────────────┐
│      Session Recorder      │
│ start/stop utterance       │
└─────────────┬──────────────┘
              │ utterance_audio
              ▼
┌────────────────────────────┐
│     Speech Processor       │
│ STT, lang detect, cleanup  │
└─────────────┬──────────────┘
              │ transcript_event
              ▼
┌────────────────────────────┐
│     Intent / Command       │
│ command, permission, stop  │
└─────────────┬──────────────┘
              │ agent_command
              ▼
┌────────────────────────────┐
│      Runtime Controller    │
│ state machine, policy      │
└───────┬──────────────┬─────┘
        │              │
        ▼              ▼
┌───────────────┐   ┌────────────────┐
│  Codex Bridge │   │  Voice Output  │
│  PTY/stdin    │   │ TTS / earcons  │
└───────┬───────┘   └────────────────┘
        │
        ▼
┌────────────────────────────┐
│        Codex CLI           │
│ running agent process      │
└────────────────────────────┘
```

---

# 2. 설계 관점

## 2.1 Agent는 “명령 생성기”가 아니라 “상태 제어기”

이 시스템에서 핵심 객체는 LLM이 아니라 **상태 기계**다.

에이전트는 현재 상태에 따라 음성을 다르게 해석해야 한다.

예를 들어 같은 “응”이라는 말도 상태에 따라 의미가 다르다.

```text
Idle 상태       → 무시
Confirm 상태    → 권한 허용
Running 상태    → 계속 진행
Error 상태      → 재시도 허용
```

따라서 모든 음성 입력은 먼저 현재 상태와 결합되어 해석되어야 한다.

```text
meaning = interpret(transcript, current_state, pending_action)
```

---

# 3. 핵심 상태 모델

## 3.1 Runtime State

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

## 3.2 상태 의미

| 상태              | 의미                           |
| --------------- | ---------------------------- |
| `BOOTING`       | 마이크, Codex 프로세스, TTS, 설정 초기화 |
| `IDLE`          | 호출어/인터럽트 대기                  |
| `LISTENING`     | 사용자 발화 녹음 중                  |
| `TRANSCRIBING`  | 음성을 텍스트로 변환 중                |
| `THINKING`      | 명령 타입 분류 및 실행 계획 생성          |
| `CONFIRMING`    | 권한 요청에 대한 사용자 허가 대기          |
| `EXECUTING`     | Codex CLI에 명령 전달 중           |
| `WAITING_CODEX` | Codex 응답/권한 요청/완료 이벤트 대기     |
| `INTERRUPTING`  | 사용자가 작업 중 개입한 상태             |
| `SPEAKING`      | 짧은 음성 응답 출력 중                |
| `ERROR`         | 복구 가능한 오류 상태                 |
| `SHUTDOWN`      | 종료                           |

---

# 4. 이벤트 중심 설계

모든 모듈은 직접 호출보다 **이벤트 메시지**로 연결하는 것이 좋다.

## 4.1 공통 이벤트 구조

```ts
interface AgentEvent<T = unknown> {
  id: string;
  type: string;
  timestamp: number;
  sessionId?: string;
  source: string;
  payload: T;
}
```

예시:

```json
{
  "id": "evt_001",
  "type": "speech.transcript.final",
  "timestamp": 1780630000000,
  "sessionId": "sess_abc",
  "source": "speech_processor",
  "payload": {
    "text": "코덱스 이 파일 리팩토링하고 테스트 돌려줘",
    "language": "ko",
    "confidence": 0.94,
    "durationMs": 3200
  }
}
```

---

# 5. 오디오 입력 인터페이스

## 5.1 AudioFrame

마이크 입력은 일정한 프레임 단위로 흘러야 한다.

```ts
interface AudioFrame {
  timestamp: number;
  sampleRate: number;
  channels: number;
  format: "pcm_s16le" | "pcm_f32";
  data: ArrayBuffer;
  rms?: number;
}
```

## 5.2 AudioInput 인터페이스

```ts
interface AudioInput {
  start(): Promise<void>;
  stop(): Promise<void>;
  onFrame(callback: (frame: AudioFrame) => void): void;
}
```

오디오 레이어는 STT나 wake word를 몰라야 한다.
역할은 오직 **마이크 프레임 생산**이다.

---

# 6. Wake / Interrupt 인터페이스

## 6.1 역할

Wake / Interrupt 모듈은 두 가지를 감지한다.

```text
1. 대기 중 호출
2. 실행 중 끼어들기
```

대기 중에는 호출어가 중요하고, 실행 중에는 사용자의 강한 발화 시작이 중요하다.

## 6.2 ActivationEvent

```ts
interface ActivationEvent {
  mode: "wake_word" | "hotkey" | "barge_in" | "manual";
  phrase?: string;
  confidence?: number;
  timestamp: number;
}
```

예시:

```json
{
  "mode": "wake_word",
  "phrase": "코덱스",
  "confidence": 0.91,
  "timestamp": 1780630000000
}
```

## 6.3 WakeDetector 인터페이스

```ts
interface WakeDetector {
  consume(frame: AudioFrame): void;
  onActivation(callback: (event: ActivationEvent) => void): void;
  setEnabled(enabled: boolean): void;
}
```

## 6.4 상태별 동작

| 현재 상태           | wake 감지 시                      |
| --------------- | ------------------------------ |
| `IDLE`          | `LISTENING`으로 전환               |
| `SPEAKING`      | TTS 중단 후 `LISTENING`           |
| `WAITING_CODEX` | Codex 작업 interrupt 후보          |
| `CONFIRMING`    | 권한 응답 발화로 처리                   |
| `EXECUTING`     | 즉시 중단하지 말고 interrupt intent 확인 |

---

# 7. Session Recorder

## 7.1 역할

호출 이후 사용자의 실제 명령 발화를 잘라내는 모듈.

```text
activation_event
→ pre-roll 포함 녹음 시작
→ VAD로 발화 종료 감지
→ utterance_audio 생성
```

## 7.2 UtteranceAudio

```ts
interface UtteranceAudio {
  id: string;
  sessionId: string;
  startedAt: number;
  endedAt: number;
  sampleRate: number;
  channels: number;
  data: ArrayBuffer;
  vadSegments: Array<{
    startMs: number;
    endMs: number;
  }>;
}
```

## 7.3 Recorder 인터페이스

```ts
interface SessionRecorder {
  begin(sessionId: string, activation: ActivationEvent): void;
  consume(frame: AudioFrame): void;
  cancel(reason: string): void;
  onUtterance(callback: (audio: UtteranceAudio) => void): void;
}
```

## 7.4 권장 녹음 정책

```ts
interface RecorderConfig {
  preRollMs: number;          // 호출 직전 오디오 보존
  maxUtteranceMs: number;     // 최대 명령 길이
  silenceEndMs: number;       // 이만큼 침묵이면 발화 종료
  minSpeechMs: number;        // 너무 짧은 발화 무시
}
```

예시:

```json
{
  "preRollMs": 500,
  "maxUtteranceMs": 15000,
  "silenceEndMs": 800,
  "minSpeechMs": 300
}
```

---

# 8. Speech Processor

## 8.1 역할

음성 입력을 텍스트 명령으로 바꾼다.

```text
utterance_audio
→ language detection
→ STT
→ normalization
→ confidence check
→ transcript_event
```

## 8.2 Transcript

```ts
interface Transcript {
  id: string;
  sessionId: string;
  text: string;
  normalizedText: string;
  language: "ko" | "en" | "mixed" | "unknown";
  confidence: number;
  alternatives?: Array<{
    text: string;
    confidence: number;
  }>;
  startedAt: number;
  endedAt: number;
}
```

## 8.3 SpeechProcessor 인터페이스

```ts
interface SpeechProcessor {
  transcribe(audio: UtteranceAudio): Promise<Transcript>;
}
```

## 8.4 한국어/영어 감지 정책

언어 감지는 단순히 UI 언어를 바꾸는 용도가 아니다.
명령 해석과 응답 언어를 결정한다.

```ts
interface LanguagePolicy {
  inputLanguage: "ko" | "en" | "mixed" | "unknown";
  responseLanguage: "ko" | "en";
  commandLanguage: "preserve" | "translate_to_en" | "translate_to_ko";
}
```

권장 정책:

| 입력  | 에이전트 응답   | Codex 전달    |
| --- | --------- | ----------- |
| 한국어 | 한국어 짧은 응답 | 원문 또는 영어 변환 |
| 영어  | 영어 짧은 응답  | 원문          |
| 혼합  | 주 언어 기준   | 원문 보존       |
| 불명확 | 짧게 재질문    | 전달하지 않음     |

---

# 9. Command Interpreter

## 9.1 역할

텍스트를 실행 가능한 명령 타입으로 분류한다.

```text
transcript
+ current_state
+ pending_permission
+ codex_status
→ AgentCommand
```

## 9.2 AgentCommand

```ts
type AgentCommand =
  | UserTaskCommand
  | PermissionCommand
  | ControlCommand
  | DictationCommand
  | ClarificationCommand
  | NoopCommand;
```

---

## 9.3 UserTaskCommand

Codex에 넘길 실제 작업 명령.

```ts
interface UserTaskCommand {
  type: "user_task";
  sessionId: string;
  text: string;
  language: "ko" | "en" | "mixed";
  target: "codex";
  priority: "normal" | "high";
  requiresPreAck: boolean;
}
```

예시:

```json
{
  "type": "user_task",
  "sessionId": "sess_001",
  "text": "이 파일 리팩토링하고 테스트 돌려줘",
  "language": "ko",
  "target": "codex",
  "priority": "normal",
  "requiresPreAck": true
}
```

---

## 9.4 PermissionCommand

Codex가 권한 요청을 했을 때 사용자의 음성 응답.

```ts
interface PermissionCommand {
  type: "permission";
  decision: "allow" | "deny" | "allow_once" | "always_allow" | "deny_once";
  scope?: "current_command" | "current_session" | "tool" | "directory";
  reason?: string;
}
```

예시 발화 매핑:

| 발화       | decision       |
| -------- | -------------- |
| “허용”     | `allow_once`   |
| “이번만 허용” | `allow_once`   |
| “계속 허용”  | `always_allow` |
| “거부”     | `deny_once`    |
| “하지 마”   | `deny`         |
| “스킵해”    | `deny_once`    |

---

## 9.5 ControlCommand

실행 흐름 제어.

```ts
interface ControlCommand {
  type: "control";
  action:
    | "stop"
    | "pause"
    | "resume"
    | "repeat"
    | "status"
    | "cancel_speech"
    | "new_session"
    | "shutdown";
}
```

예시:

| 발화          | action        |
| ----------- | ------------- |
| “멈춰”        | `stop`        |
| “잠깐 멈춰”     | `pause`       |
| “계속해”       | `resume`      |
| “뭐 하는 중이야?” | `status`      |
| “다시 말해봐”    | `repeat`      |
| “새로 시작”     | `new_session` |
| “종료”        | `shutdown`    |

---

# 10. Runtime Controller

## 10.1 역할

전체 시스템의 중심이다.

```text
이벤트 수신
→ 상태 확인
→ 명령 해석
→ 안전 정책 적용
→ Codex 전달
→ TTS 응답
→ 다음 상태 전환
```

## 10.2 RuntimeContext

```ts
interface RuntimeContext {
  state: AgentState;
  activeSessionId?: string;
  codexStatus: CodexStatus;
  pendingPermission?: PermissionRequest;
  lastTranscript?: Transcript;
  lastSpokenText?: string;
  lastCodexOutput?: string;
  userPreferences: UserPreferences;
}
```

## 10.3 상태 전환 예시

```text
IDLE
→ activation_event
→ LISTENING
→ utterance_audio
→ TRANSCRIBING
→ transcript
→ THINKING
→ user_task
→ SPEAKING
→ EXECUTING
→ WAITING_CODEX
→ IDLE
```

권한 요청 포함:

```text
WAITING_CODEX
→ permission_request_detected
→ CONFIRMING
→ user says "허용"
→ EXECUTING
→ WAITING_CODEX
→ completed
→ SPEAKING
→ IDLE
```

인터럽트 포함:

```text
WAITING_CODEX
→ barge_in_detected
→ LISTENING
→ transcript
→ control.stop
→ CodexBridge.interrupt()
→ SPEAKING
→ IDLE
```

---

# 11. Codex Bridge

## 11.1 역할

실행 중인 Codex CLI와 통신한다.

Codex Bridge는 음성을 몰라야 한다.
역할은 오직 **프로세스 입출력 제어**다.

## 11.2 CodexBridge 인터페이스

```ts
interface CodexBridge {
  start(config: CodexProcessConfig): Promise<void>;
  stop(): Promise<void>;

  sendPrompt(prompt: CodexPrompt): Promise<void>;
  sendPermission(decision: PermissionDecision): Promise<void>;
  interrupt(reason: string): Promise<void>;

  onOutput(callback: (event: CodexOutputEvent) => void): void;
  onPermissionRequest(callback: (request: PermissionRequest) => void): void;
  onStatus(callback: (status: CodexStatus) => void): void;
}
```

## 11.3 CodexPrompt

```ts
interface CodexPrompt {
  sessionId: string;
  text: string;
  language: "ko" | "en" | "mixed";
  source: "voice";
  mode: "insert" | "submit";
  metadata?: {
    transcriptConfidence: number;
    spokenAt: number;
  };
}
```

## 11.4 CodexOutputEvent

```ts
interface CodexOutputEvent {
  sessionId: string;
  type:
    | "stdout"
    | "stderr"
    | "tool_call"
    | "permission_request"
    | "task_complete"
    | "error";
  text?: string;
  raw?: string;
  timestamp: number;
}
```

## 11.5 CodexStatus

```ts
interface CodexStatus {
  process: "not_started" | "starting" | "running" | "exited" | "error";
  task: "idle" | "thinking" | "editing" | "running_command" | "waiting_permission";
  currentWorkingDirectory?: string;
  currentTool?: string;
}
```

---

# 12. 권한 요청 처리

## 12.1 PermissionRequest

```ts
interface PermissionRequest {
  id: string;
  sessionId: string;
  tool: string;
  action: string;
  command?: string;
  path?: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  rawText: string;
  createdAt: number;
  expiresAt?: number;
}
```

예시:

```json
{
  "id": "perm_001",
  "sessionId": "sess_001",
  "tool": "shell",
  "action": "run_command",
  "command": "npm test",
  "path": "/Users/me/project",
  "riskLevel": "low",
  "rawText": "Codex wants to run: npm test",
  "createdAt": 1780630000000
}
```

## 12.2 PermissionDecision

```ts
interface PermissionDecision {
  requestId: string;
  decision: "allow" | "deny";
  remember?: boolean;
  scope?: "once" | "session" | "tool" | "project";
  decidedBy: "voice" | "keyboard" | "policy";
  transcript?: string;
}
```

## 12.3 권한 상태 흐름

```text
Codex output 감시
→ permission_request 파싱
→ Runtime state = CONFIRMING
→ TTS: "테스트 실행 허용할까?"
→ 사용자 발화
→ STT
→ PermissionCommand 생성
→ PermissionDecision 전달
→ CodexBridge.sendPermission()
```

## 12.4 위험도별 음성 허용 정책

| 위험도        | 예시                               | 음성 허용       |
| ---------- | -------------------------------- | ----------- |
| `low`      | 테스트 실행, lint 실행, 파일 읽기           | 가능          |
| `medium`   | 파일 수정, 패키지 설치                    | 가능하되 명시 확인  |
| `high`     | 삭제, git push, 외부 요청              | 재확인 필요      |
| `critical` | `rm -rf`, credential 접근, prod 배포 | 음성만으로 금지 권장 |

중요한 설계 원칙:

```text
음성 권한 허용은 편하지만, 위험한 명령은 반드시 추가 확인 계층이 필요하다.
```

예:

```text
사용자: "허용"
에이전트: "삭제 명령이야. 정말 실행할까?"
사용자: "진짜 허용"
```

---

# 13. TTS / Voice Output

## 13.1 역할

에이전트는 길게 설명하면 안 된다.
음성 UX에서는 짧은 응답이 핵심이다.

```text
"알겠어. 실행할게."
"테스트 돌릴게."
"권한 필요해. npm test 허용할까?"
"끝났어."
"오류 났어. 요약할까?"
```

## 13.2 VoiceOutput 인터페이스

```ts
interface VoiceOutput {
  speak(message: VoiceMessage): Promise<void>;
  stop(): Promise<void>;
  onFinished(callback: (id: string) => void): void;
}
```

## 13.3 VoiceMessage

```ts
interface VoiceMessage {
  id: string;
  text: string;
  language: "ko" | "en";
  priority: "low" | "normal" | "urgent";
  interruptible: boolean;
  category:
    | "ack"
    | "permission"
    | "status"
    | "completion"
    | "error"
    | "warning";
}
```

## 13.4 응답 정책

| 상황     | 응답 예시                 |
| ------ | --------------------- |
| 명령 수신  | “알겠어. 코덱스에 넘길게.”      |
| 테스트 실행 | “테스트 실행할게.”           |
| 권한 요청  | “명령 실행 권한 필요해. 허용할까?” |
| 완료     | “끝났어.”                |
| 실패     | “오류 났어. 로그 확인할까?”     |
| 불확실    | “잘 못 들었어. 다시 말해줘.”    |

---

# 14. 인터럽트 설계

## 14.1 인터럽트 종류

```ts
type InterruptType =
  | "cancel_current_task"
  | "pause_task"
  | "modify_instruction"
  | "permission_response"
  | "ask_status"
  | "stop_speaking";
```

## 14.2 인터럽트 판단 기준

인터럽트는 단순히 소리가 났다고 바로 실행하면 안 된다.

```text
wake phrase detected
or
speech detected while TTS is active
or
speech detected while Codex is waiting
or
hotkey pressed
```

## 14.3 실행 중 인터럽트 흐름

```text
Codex 작업 중
→ 사용자: "잠깐, 테스트 말고 빌드만 해"
→ barge_in 감지
→ TTS 중단
→ 녹음
→ STT
→ Control/Modify intent 판단
→ Codex에 interrupt 또는 새 instruction 전달
```

## 14.4 인터럽트 이벤트

```ts
interface InterruptEvent {
  id: string;
  sessionId: string;
  type: InterruptType;
  transcript: string;
  confidence: number;
  createdAt: number;
}
```

---

# 15. Command Router

## 15.1 역할

사용자 발화를 어디로 보낼지 결정한다.

```text
Codex로 보낼 명령인가?
시스템 제어 명령인가?
권한 응답인가?
에이전트 상태 질문인가?
무시해야 하는 잡음인가?
```

## 15.2 Router 인터페이스

```ts
interface CommandRouter {
  route(input: RouteInput): Promise<RouteDecision>;
}
```

```ts
interface RouteInput {
  transcript: Transcript;
  state: AgentState;
  pendingPermission?: PermissionRequest;
  codexStatus: CodexStatus;
}
```

```ts
interface RouteDecision {
  route:
    | "codex_prompt"
    | "permission_decision"
    | "runtime_control"
    | "status_query"
    | "ignore"
    | "clarify";
  confidence: number;
  command?: AgentCommand;
  reason?: string;
}
```

---

# 16. 한국어/영어 혼합 명령 처리

## 16.1 문제

개발자는 자연스럽게 이렇게 말할 수 있다.

```text
"코덱스, 이 컴포넌트 refactor하고 test 돌려줘"
"Run npm test 하고 에러 나면 fix해"
"이거 PR description 만들어줘"
```

따라서 언어 감지는 이분법이면 안 된다.

## 16.2 언어 필드

```ts
type Language = "ko" | "en" | "mixed" | "unknown";
```

## 16.3 전달 정책

Codex에 전달할 때는 가능하면 사용자의 의미를 보존한다.

```ts
interface PromptTransformPolicy {
  preserveOriginal: boolean;
  addSystemPrefix: boolean;
  translateWhenNeeded: boolean;
}
```

예시 변환:

```text
Original:
"이 파일 리팩토링하고 테스트 돌려줘"

Codex Prompt:
"Refactor the current file and run the relevant tests. The user's original Korean instruction was: 이 파일 리팩토링하고 테스트 돌려줘"
```

또는 원문 그대로:

```text
이 파일 리팩토링하고 테스트 돌려줘
```

권장 설계는 둘 다 지원하는 것.

```ts
type CodexPromptMode =
  | "raw_transcript"
  | "normalized_instruction"
  | "bilingual_instruction";
```

---

# 17. 대기 상태 설계

## 17.1 Idle Loop

대기 상태에서는 전체 STT를 계속 돌리지 않는 것이 좋다.

```text
AudioInput은 항상 켜짐
WakeDetector는 항상 consume
SessionRecorder는 비활성
SpeechProcessor는 비활성
CodexBridge는 유지
```

## 17.2 Idle 상태에서 활성화 조건

```ts
interface IdleActivationPolicy {
  wakeWordEnabled: boolean;
  hotkeyEnabled: boolean;
  allowDirectSpeechWhenFocused: boolean;
  minWakeConfidence: number;
}
```

## 17.3 Idle 처리 흐름

```text
IDLE
  receive audio_frame
  WakeDetector.consume(frame)
  if activation:
    create sessionId
    Recorder.begin(sessionId, activation)
    state = LISTENING
```

---

# 18. 세션 모델

## 18.1 Session

```ts
interface VoiceAgentSession {
  id: string;
  startedAt: number;
  endedAt?: number;
  activation: ActivationEvent;
  transcripts: Transcript[];
  commands: AgentCommand[];
  codexEvents: CodexOutputEvent[];
  permissions: PermissionRequest[];
  status: "active" | "completed" | "cancelled" | "failed";
}
```

## 18.2 세션 원칙

하나의 호출어 이후 하나의 사용자 명령을 하나의 세션으로 본다.

```text
"코덱스, 이 파일 고치고 테스트 돌려줘"
```

이것은 하나의 세션이다.

하지만 Codex 작업 중 후속 발화가 들어오면 같은 세션에 붙을 수 있다.

```text
"아니, 테스트는 전체 말고 auth 쪽만"
```

이것은 기존 세션의 interrupt/modification이다.

---

# 19. 안전 정책

## 19.1 SafetyPolicy 인터페이스

```ts
interface SafetyPolicy {
  classifyPermission(request: PermissionRequest): PermissionRequest;
  canAutoAllow(request: PermissionRequest, context: RuntimeContext): boolean;
  requiresSecondConfirmation(request: PermissionRequest): boolean;
  canVoiceApprove(request: PermissionRequest): boolean;
}
```

## 19.2 위험 명령 패턴

```text
rm -rf
sudo
chmod -R
chown -R
git push --force
deploy
kubectl apply
terraform apply
curl | sh
secret / token / key 접근
.env 수정
대량 파일 삭제
```

## 19.3 정책 예시

```ts
interface PermissionPolicyRule {
  match: {
    tool?: string;
    commandIncludes?: string[];
    pathIncludes?: string[];
  };
  riskLevel: "low" | "medium" | "high" | "critical";
  voiceApproval: "allow" | "double_confirm" | "deny";
}
```

---

# 20. Codex 권한 요청 파싱

Codex CLI가 권한 요청을 구조화해서 주면 가장 좋지만, 일반 터미널 출력만 있다면 텍스트 파싱 레이어가 필요하다.

## 20.1 PermissionParser

```ts
interface PermissionParser {
  parse(output: CodexOutputEvent): PermissionRequest | null;
}
```

## 20.2 파싱 결과

```text
raw terminal output
→ detect permission prompt
→ extract command/tool/path
→ create PermissionRequest
```

## 20.3 파서가 추출해야 하는 것

```ts
interface ParsedPermissionFields {
  tool?: string;
  command?: string;
  path?: string;
  promptText: string;
  choices?: string[];
}
```

---

# 21. 사용자 설정

## 21.1 UserPreferences

```ts
interface UserPreferences {
  wakePhrases: string[];
  responseLanguage: "auto" | "ko" | "en";
  voiceAckEnabled: boolean;
  autoSubmit: boolean;
  commandPromptMode: "raw_transcript" | "normalized_instruction" | "bilingual_instruction";
  permissionVoiceApproval: boolean;
  requireWakeWordForInterrupt: boolean;
  ttsVerbosity: "minimal" | "normal" | "verbose";
}
```

## 21.2 예시 설정

```json
{
  "wakePhrases": ["코덱스", "hey codex"],
  "responseLanguage": "auto",
  "voiceAckEnabled": true,
  "autoSubmit": true,
  "commandPromptMode": "bilingual_instruction",
  "permissionVoiceApproval": true,
  "requireWakeWordForInterrupt": false,
  "ttsVerbosity": "minimal"
}
```

---

# 22. 로그와 관측성

음성 에이전트는 오작동 디버깅이 어렵다.
따라서 이벤트 로그가 매우 중요하다.

## 22.1 LogEvent

```ts
interface LogEvent {
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
```

## 22.2 반드시 남길 로그

```text
wake 감지 confidence
STT transcript
언어 감지 결과
route decision
Codex에 전달된 prompt
permission request
permission decision
interrupt event
error stack
```

단, 보안상 아래는 기본적으로 마스킹해야 한다.

```text
API key
.env
token
password
private key
cookie
authorization header
```

---

# 23. 최소 MVP 스펙

처음부터 완성형 자비스로 만들 필요 없다.
MVP는 아래만 되면 된다.

```text
1. Codex CLI 프로세스 실행/연결
2. 호출어 또는 hotkey로 녹음 시작
3. 한국어/영어 STT
4. 명령 텍스트를 Codex stdin에 전달
5. 전달 직전 짧은 TTS 응답
6. Codex 권한 요청 감지
7. "허용/거부" 음성으로 선택
8. 작업 중 "멈춰/상태/다시 말해" 처리
9. 완료/오류 TTS 알림
```

MVP 상태 기계:

```ts
type MVPState =
  | "IDLE"
  | "LISTENING"
  | "TRANSCRIBING"
  | "CONFIRMING"
  | "WAITING_CODEX"
  | "SPEAKING"
  | "ERROR";
```

---

# 24. 내부 데이터 흐름 예시

## 24.1 일반 명령

```text
User:
"코덱스, 이 파일 리팩토링하고 테스트 돌려줘"

AudioInput:
audio_frame stream

WakeDetector:
activation_event { mode: "wake_word", phrase: "코덱스" }

Recorder:
utterance_audio

SpeechProcessor:
transcript {
  text: "이 파일 리팩토링하고 테스트 돌려줘",
  language: "ko",
  confidence: 0.94
}

Router:
route_decision {
  route: "codex_prompt",
  confidence: 0.91
}

VoiceOutput:
"알겠어. 실행할게."

CodexBridge:
sendPrompt({
  text: "이 파일 리팩토링하고 테스트 돌려줘",
  mode: "submit"
})

Runtime:
state = WAITING_CODEX
```

---

## 24.2 권한 허용

```text
Codex:
"Run command: npm test ?"

PermissionParser:
permission_request {
  tool: "shell",
  command: "npm test",
  riskLevel: "low"
}

Runtime:
state = CONFIRMING

VoiceOutput:
"npm test 실행 허용할까?"

User:
"허용"

SpeechProcessor:
transcript {
  text: "허용",
  language: "ko"
}

Router:
route = "permission_decision"

CodexBridge:
sendPermission({
  decision: "allow",
  scope: "once",
  decidedBy: "voice"
})
```

---

## 24.3 실행 중 인터럽트

```text
Codex:
editing files...

User:
"잠깐, 테스트는 전체 말고 auth만 돌려"

WakeDetector:
barge_in

Recorder:
utterance_audio

SpeechProcessor:
transcript {
  text: "잠깐, 테스트는 전체 말고 auth만 돌려",
  language: "ko"
}

Router:
route = "runtime_control"
action = "modify_instruction"

CodexBridge:
interrupt("User modified instruction")

CodexBridge:
sendPrompt("테스트는 전체가 아니라 auth 관련 테스트만 실행해.")
```

---

# 25. 컴포넌트별 책임 분리

| 컴포넌트              | 알아야 하는 것  | 몰라도 되는 것       |
| ----------------- | --------- | -------------- |
| AudioInput        | 마이크 프레임   | Codex, STT, 권한 |
| WakeDetector      | 호출어/인터럽트  | Codex 명령       |
| Recorder          | 발화 시작/종료  | 명령 의미          |
| SpeechProcessor   | 음성→텍스트    | 권한 정책          |
| Router            | 텍스트+상태→명령 | 마이크 처리         |
| RuntimeController | 상태/정책/흐름  | STT 내부 구현      |
| CodexBridge       | CLI 입출력   | 음성 처리          |
| VoiceOutput       | TTS 출력    | Codex 내부 로직    |
| SafetyPolicy      | 위험도 판단    | 오디오 처리         |

---

# 26. 권장 디렉토리 구조

```text
voice-codex-agent/
  src/
    audio/
      AudioInput.ts
      AudioFrame.ts

    wake/
      WakeDetector.ts
      ActivationEvent.ts

    recorder/
      SessionRecorder.ts
      UtteranceAudio.ts

    speech/
      SpeechProcessor.ts
      Transcript.ts
      LanguagePolicy.ts

    router/
      CommandRouter.ts
      AgentCommand.ts
      RouteDecision.ts

    runtime/
      RuntimeController.ts
      AgentState.ts
      RuntimeContext.ts
      EventBus.ts

    codex/
      CodexBridge.ts
      CodexPrompt.ts
      CodexOutputEvent.ts
      PermissionParser.ts

    permission/
      PermissionRequest.ts
      PermissionDecision.ts
      SafetyPolicy.ts

    voice/
      VoiceOutput.ts
      VoiceMessage.ts

    config/
      UserPreferences.ts
      PermissionPolicy.ts

    log/
      Logger.ts
      LogEvent.ts

    app/
      main.ts
```

---

# 27. 핵심 설계 원칙

## 27.1 음성은 불확실한 입력이다

따라서 모든 음성 입력에는 confidence가 붙어야 한다.

```ts
if (transcript.confidence < threshold) {
  askClarification();
}
```

특히 권한 허용은 더 엄격해야 한다.

```ts
permissionApprovalThreshold > normalCommandThreshold
```

---

## 27.2 권한 허용은 상태 의존적이어야 한다

사용자가 “허용”이라고 말했을 때, pending permission이 없으면 실행하면 안 된다.

```ts
if (state !== "CONFIRMING" || !pendingPermission) {
  ignore("No pending permission");
}
```

---

## 27.3 TTS는 짧아야 한다

나쁜 UX:

```text
"네, 사용자의 명령을 이해했습니다. 이제 Codex CLI에 해당 작업을 전달하고 필요한 경우..."
```

좋은 UX:

```text
"알겠어. 실행할게."
```

---

## 27.4 Codex Bridge는 교체 가능해야 한다

나중에 Claude Code, Gemini CLI, shell agent로 바꿀 수 있어야 한다.

그래서 이름을 처음부터 `CodexBridge`로 박아도 내부 상위 인터페이스는 이렇게 두는 게 좋다.

```ts
interface AgentBackend {
  start(): Promise<void>;
  sendPrompt(prompt: AgentPrompt): Promise<void>;
  sendPermission(decision: PermissionDecision): Promise<void>;
  interrupt(reason: string): Promise<void>;
  onOutput(callback: (event: AgentOutputEvent) => void): void;
}
```

그리고 Codex는 구현체로 둔다.

```ts
class CodexBackend implements AgentBackend {}
class ClaudeCodeBackend implements AgentBackend {}
```

---

# 28. 최종 요약 스펙

```text
이 프로젝트는 음성으로 Codex CLI를 조작하는 Agent Runtime Controller다.

핵심 구조:
AudioInput
→ WakeDetector
→ SessionRecorder
→ SpeechProcessor
→ CommandRouter
→ RuntimeController
→ CodexBridge
→ VoiceOutput

핵심 상태:
IDLE
LISTENING
TRANSCRIBING
THINKING
CONFIRMING
EXECUTING
WAITING_CODEX
INTERRUPTING
SPEAKING
ERROR

핵심 이벤트:
audio.frame
wake.activated
speech.utterance.final
speech.transcript.final
command.routed
codex.output
codex.permission.requested
permission.decided
runtime.interrupted
voice.speak.started
voice.speak.finished

핵심 인터페이스:
AudioInput
WakeDetector
SessionRecorder
SpeechProcessor
CommandRouter
RuntimeController
AgentBackend
PermissionParser
SafetyPolicy
VoiceOutput

핵심 정책:
- 대기 중에는 wake word만 감지
- 호출 후에는 VAD로 발화 종료
- STT 결과에는 language/confidence 포함
- 한국어/영어/mixed를 분리
- Codex 전달은 raw/normalized/bilingual 모드 지원
- 권한 허용은 CONFIRMING 상태에서만 유효
- 위험한 명령은 음성만으로 허용하지 않거나 이중 확인
- 실행 중 발화는 interrupt로 처리
- TTS는 짧고 상태 중심으로 출력
```
