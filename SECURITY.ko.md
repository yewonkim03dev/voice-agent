Language / 언어: [English](./SECURITY.md) | 한국어

# 보안 정책

## 지원 버전

Voice Agent는 초기 단계의 소프트웨어입니다. 보안 수정은 최신 활성 브랜치와, 릴리스가 있는 경우 가장 최근 릴리스 코드를 기준으로 진행합니다.

## 취약점 제보

악용 가능한 취약점 상세 내용을 공개 이슈에 올리지 말아 주세요.

권장 제보 경로:

1. 이 저장소에서 GitHub private vulnerability reporting이 활성화되어 있다면 그 경로를 사용합니다.
2. private reporting이 활성화되어 있지 않다면 exploit detail을 공유하기 전에 maintainer에게 비공개로 연락합니다.
3. 비공개 연락 경로가 없다면 재현 절차, secret, token, log, exploit detail 없이 private security contact를 요청하는 최소한의 공개 이슈만 엽니다.

triage에 필요한 정보:

- 영향을 받는 버전, 브랜치, 또는 커밋.
- 운영체제와 런타임 정보.
- voice input, STT/TTS, visual bridge, approval handling, app-server transport, filesystem access, network access, plugin, connector 중 어떤 영역과 관련되는지.
- 영향 범위에 대한 안전한 요약.
- 최소 재현 정보. 단, 비공개 경로로 공유합니다.

## 범위

보안상 민감한 영역은 다음을 포함합니다.

- approval bridge와 request id 처리.
- app-server JSON-RPC transport.
- plugin, connector, MCP, elicitation 처리.
- shell command approval과 sandbox boundary 동작.
- 로컬 microphone, STT, TTS, visual companion 프로세스.
- `.voice-agent.local.json` 같은 로컬 설정 파일.

## 공개

공개 전 maintainer가 조사하고 수정할 수 있는 합리적인 시간을 주세요. 유효한 제보는 가능한 빨리 확인하고, 영향을 받는 동작을 파악하며, 수정 경로를 조율하겠습니다.
