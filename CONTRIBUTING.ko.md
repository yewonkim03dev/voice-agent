Language / 언어: [English](./CONTRIBUTING.md) | 한국어

# 기여하기

Voice Agent 개선에 함께해 주셔서 감사합니다.

Voice Agent는 코딩 에이전트를 감싸는 얇은 음성 레이어입니다. 이 경계를 명확히 유지해 주세요. 음성 입력, wake routing, TTS, visual state, approval bridge는 이 프로젝트가 담당하고, 모델 추론, 도구 선택, 플러그인 호출, 커넥터 호출, 실행 결과는 app-server 경로에 남겨 둡니다.

## 개발 환경 설정

```sh
npm install
npm run setup:voice
npm run setup:visual
npm test
```

macOS에서 로컬로 직접 확인할 때:

```sh
npm run harness:wake:codex -- --visual --tts
```

## 작업 기준

- 변경 범위는 수정하려는 동작에 맞게 좁게 유지합니다.
- `src/app`, `src/codex`, `src/voice`, `src/visual`의 기존 패턴을 우선합니다.
- 일반 코딩 요청에 대한 로컬 intent classification을 추가하지 않습니다. STT 텍스트는 agent backend로 pass-through 되어야 합니다.
- voice layer에서 플러그인이나 커넥터를 직접 호출하지 않습니다. 사용자 요청은 app-server로 전달하고, 승인이나 입력 요청은 request id 기준으로 처리합니다.
- approval 동작은 결정적으로 유지합니다. pending approval은 반드시 resolve 되어야 하고, queued approval은 순서대로 진행되어야 하며, visual state가 stuck 상태로 남으면 안 됩니다.
- approval, wake, TTS, visual, app-server state 동작을 바꿀 때는 테스트를 추가합니다.

## 테스트

커밋 전 전체 테스트를 실행합니다.

```sh
npm test
```

특정 영역을 바꿀 때는 관련 테스트 파일부터 확인한 뒤 전체 테스트를 실행합니다.

```sh
node --test tests/codex-app-server-backend.test.ts
node --test tests/harness.test.ts
node --test tests/voice-pipeline.test.ts
npm test
```

## 문서

사용자에게 보이는 동작이 바뀌면 양쪽 README를 함께 업데이트합니다.

- `README.md`
- `README.ko.md`

영문과 한국어 문서는 직역일 필요는 없지만 의미는 같게 유지합니다.

## Pull Request 체크리스트

- 변경이 app-server pass-through 아키텍처를 따릅니다.
- approval이나 cancellation 경로를 건드렸다면 테스트가 포함되어 있습니다.
- visual state나 TTS 동작을 건드렸다면 테스트가 포함되어 있습니다.
- `npm test`가 통과합니다.
- 사용자에게 보이는 동작이 바뀌었다면 README 업데이트가 포함되어 있습니다.
