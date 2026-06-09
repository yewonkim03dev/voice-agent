import AppKit
import Foundation
import WebKit

enum UiLanguage: Equatable {
    case en
    case ko
}

private let visualTextEn: [String: String] = [
    "waitingForBridge": "waiting for bridge",
    "connecting": "connecting",
    "connected": "connected",
    "bridgeDisconnected": "bridge disconnected",
    "idle": "idle",
    "listening": "listening",
    "wakeMatched": "wake matched",
    "wakeRejected": "wake rejected",
    "sttProcessing": "transcribing",
    "submitting": "submitting",
    "thinking": "thinking",
    "running": "running",
    "speaking": "speaking",
    "approvalPending": "approval pending",
    "approvalCompact": "approval",
    "rejectedCompact": "rejected",
    "wakeCompact": "wake",
    "error": "error",
    "shutdown": "shutting down",
    "wakePrefix": "wake: ",
    "sessionNew": "session: new",
    "sessionPrefix": "session: ",
    "usagePrefix": "usage: ",
    "references": "References",
    "commands": "Commands",
    "referenceText": "reference text",
    "noReferencesQueued": "No references queued",
    "referenceCountSuffix": " reference item(s) queued",
    "currentReferenceCountSuffix": " current reference item(s)",
    "queuedReferences": "Queued References",
    "qNone": "Q: none",
    "referencesQueuedNext": "References queued for the next routed request.",
    "voiceAgentGuide": "Voice Agent Guide",
    "guideTooltip": "Voice Agent guide",
    "ok": "OK",
    "settings": "Settings",
    "popup": "Popup",
    "copy": "Copy",
    "plainText": "Text",
    "markdownView": "Markdown",
    "stop": "STOP",
    "ttsStop": "TTS Stop",
    "tts": "TTS",
    "micOn": "🎙",
    "micOff": "🔇",
    "cameraOn": "📷",
    "cameraOff": "🚫",
    "cameraTurnOn": "Turn camera on",
    "cameraTurnOff": "Turn camera off",
    "cameraLabel": "Camera",
    "on": "ON",
    "off": "OFF",
    "microphoneOn": "microphone on",
    "microphoneOff": "microphone off",
    "audioReconnecting": "audio reconnecting",
    "waitingForMicrophone": "waiting for microphone",
    "audioInputRestarting": "audio input restarting",
    "audioReady": "audio ready",
    "cameraGestureCancelled": "camera gesture cancelled",
    "cameraGestureWakePending": "camera gesture wake pending",
    "cameraGestureWakeOff": "camera gesture wake off",
    "cameraGestureUnavailableWithoutCam": "camera gesture wake unavailable without --cam",
    "cameraGestureWatcherReady": "camera gesture watcher ready",
    "cameraGestureWatcherStarted": "camera gesture watcher started",
    "ttsSettingsUpdated": "TTS settings updated",
    "ttsSettingsRestored": "TTS settings restored",
    "commandsCleared": "commands cleared",
    "clearCmds": "Clear Cmds",
    "exit": "Exit",
    "add": "Add",
    "directGo": "Go",
    "refs": "Refs",
    "clearRef": "Clear Ref",
    "clear": "Clear",
    "show": "Show",
    "hide": "Hide",
    "compactHud": "Compact HUD",
    "restoreHud": "Restore HUD",
    "restoreDefaults": "Restore Defaults",
    "apply": "Apply",
    "recentQa": "Recent Q/A",
    "showRecentQa": "Show Recent Q/A panel",
    "showFloatingHud": "Show floating HUD",
    "popupPreferred": "Prefer popup for long answers",
    "speakWakeWarning": "Speak wake warning",
    "alwaysStartNewThread": "Always start new thread",
    "language": "Language",
    "gender": "Gender",
    "voice": "Voice",
    "rate": "Rate",
    "pitch": "Pitch",
    "volume": "Volume",
    "thinkingFx": "Thinking Fx",
    "maxSpeech": "Max Speech",
    "codexThread": "Codex Thread",
    "wake": "Wake",
    "allow": "Allow",
    "deny": "Deny",
    "sessionAllow": "Session Allow",
    "policyAllow": "Persistent Allow",
    "networkPolicyAllow": "Network Allow",
    "gestureWake": "Gesture Wake",
    "gestureStop": "Gesture Stop",
    "gestureApprovalOnce": "Gesture Allow",
    "gestureApprovalDeny": "Gesture Deny",
    "gestureApprovalSession": "Gesture Session",
    "gestureApprovalPolicy": "Gesture Persistent",
    "gestureRunningMode": "Gesture Run Mode",
    "gestureNone": "None",
    "gestureOpenPalm": "Open palm",
    "gestureThumbsDown": "Thumbs down",
    "gestureFist": "Fist",
    "gesturePeace": "Peace",
    "gestureThumbsUp": "Thumbs up",
    "gestureCustomName": "Custom name",
    "gestureCapture": "Capture",
    "gestureClear": "Delete",
    "gestureRunOff": "Off",
    "gestureRunEmergencyOnly": "Emergency only",
    "quitVoiceAgent": "Quit Voice Agent",
    "voiceGuide": "1. Say a wake phrase first, such as codex or jarvis.\n2. Then speak naturally; the command is passed through to the agent.\n3. During approvals, say approve, deny, or approve for this session.\n4. References are attached to the next request only.\n5. STOP interrupts the current agent turn.",
    "referenceHelp": "Add queues references for the next request. Go sends the entered text, or queued references when the field is empty, directly to the agent.",
    "languageHelp": "Choose auto, Korean, or English for TTS and response language. Visual UI language applies after restart.",
    "genderHelp": "Sets preferred male or female voice when available.",
    "voiceHelp": "Overrides the voice with an installed macOS voice name.",
    "rateHelp": "TTS speaking rate. Higher values speak faster.",
    "pitchHelp": "TTS voice pitch. The default is 1.00.",
    "volumeHelp": "TTS output volume.",
    "thinkingHelp": "Thinking-loop sound volume. Set to 0 to mute it.",
    "maxSpeechHelp": "Maximum always-on utterance length, from 5 to 55 seconds.",
    "threadHelp": "Codex thread id to resume on next restart.",
    "newThreadHelp": "Starts a new Codex thread on restart when checked; resumes the last thread when unchecked.",
    "chatHelp": "Shows or hides the Recent Q/A panel.",
    "hudHelp": "Shows or hides the floating HUD above other apps.",
    "popupHelp": "Lets long or study-oriented answers open in a native popup instead of being spoken in full.",
    "wakeWarningHelp": "Controls whether wake mismatch warnings are spoken aloud.",
    "wakePhrasesHelp": "Wake phrase list. One phrase per line replaces the current list.",
    "approvalAllowHelp": "Phrases that approve once during permission prompts. One phrase per line.",
    "approvalDenyHelp": "Phrases that deny permission prompts. Overlaps with allow phrases may be treated as unknown.",
    "sessionAllowHelp": "Phrases that approve for the current session.",
    "policyAllowHelp": "Phrases that keep allowing the same command or execution policy.",
    "networkPolicyAllowHelp": "Phrases that keep allowing the same network, host, or domain.",
    "gestureHelp": "Maps camera hand shapes to wake, stop, and approval actions. Camera still starts only with --cam.",
    "gestureRunningModeHelp": "off ignores gestures while the agent runs. emergency_only watches only the stop gesture.",
    "speech": "speech",
    "command": "command",
    "status": "status"
]

private let visualTextKo: [String: String] = [
    "waitingForBridge": "브리지 대기 중",
    "connecting": "연결 중",
    "connected": "연결됨",
    "bridgeDisconnected": "브리지 연결 끊김",
    "idle": "대기 중",
    "listening": "듣는 중",
    "wakeMatched": "호출됨",
    "wakeRejected": "호출어 불일치",
    "sttProcessing": "음성 인식 중",
    "submitting": "전송 중",
    "thinking": "생각 중",
    "running": "실행 중",
    "speaking": "말하는 중",
    "approvalPending": "권한 대기 중",
    "approvalCompact": "승인",
    "rejectedCompact": "거부됨",
    "wakeCompact": "호출",
    "error": "오류",
    "shutdown": "종료 중",
    "wakePrefix": "호출어: ",
    "sessionNew": "세션: 새 세션",
    "sessionPrefix": "세션: ",
    "usagePrefix": "사용량: ",
    "references": "참고자료",
    "commands": "명령",
    "referenceText": "참고자료 텍스트",
    "noReferencesQueued": "대기 중인 참고자료 없음",
    "referenceCountSuffix": "개 참고자료 대기 중",
    "currentReferenceCountSuffix": "개 현재 질문 참고자료",
    "queuedReferences": "대기 중인 참고자료",
    "qNone": "Q: 없음",
    "referencesQueuedNext": "다음 요청에 붙을 참고자료가 대기 중입니다.",
    "voiceAgentGuide": "Voice Agent 안내",
    "guideTooltip": "Voice Agent 안내",
    "ok": "확인",
    "settings": "설정",
    "popup": "팝업",
    "copy": "복사",
    "plainText": "텍스트",
    "markdownView": "마크다운",
    "stop": "정지",
    "ttsStop": "TTS 정지",
    "tts": "TTS",
    "micOn": "🎙",
    "micOff": "🔇",
    "cameraOn": "📷",
    "cameraOff": "🚫",
    "cameraTurnOn": "카메라 켜기",
    "cameraTurnOff": "카메라 끄기",
    "cameraLabel": "카메라",
    "on": "켜짐",
    "off": "꺼짐",
    "microphoneOn": "마이크 켜짐",
    "microphoneOff": "마이크 꺼짐",
    "audioReconnecting": "마이크 재연결 중",
    "waitingForMicrophone": "마이크 장치 대기 중",
    "audioInputRestarting": "마이크 입력 재시작 중",
    "audioReady": "마이크 준비됨",
    "cameraGestureCancelled": "카메라 제스처 취소됨",
    "cameraGestureWakePending": "카메라 제스처 대기 중",
    "cameraGestureWakeOff": "카메라 제스처 꺼짐",
    "cameraGestureUnavailableWithoutCam": "카메라 제스처는 --cam으로 실행해야 사용할 수 있음",
    "cameraGestureWatcherReady": "카메라 제스처 준비됨",
    "cameraGestureWatcherStarted": "카메라 제스처 시작됨",
    "ttsSettingsUpdated": "TTS 설정 적용됨",
    "ttsSettingsRestored": "TTS 설정 복원됨",
    "commandsCleared": "명령 지워짐",
    "clearCmds": "명령 지우기",
    "exit": "종료",
    "add": "추가",
    "directGo": "전송",
    "refs": "목록",
    "clearRef": "참고 지우기",
    "clear": "지우기",
    "show": "보기",
    "hide": "숨기기",
    "compactHud": "HUD 축소",
    "restoreHud": "HUD 복원",
    "restoreDefaults": "기본값 복원",
    "apply": "적용",
    "recentQa": "최근 Q/A",
    "showRecentQa": "최근 Q/A 패널 표시",
    "showFloatingHud": "floating HUD 표시",
    "popupPreferred": "긴 답변 팝업 선호",
    "speakWakeWarning": "호출어 경고 말하기",
    "alwaysStartNewThread": "항상 새 스레드로 시작",
    "language": "언어",
    "gender": "성별",
    "voice": "음성",
    "rate": "속도",
    "pitch": "음높이",
    "volume": "볼륨",
    "thinkingFx": "작업 효과음",
    "maxSpeech": "최대 발화",
    "codexThread": "Codex Thread",
    "wake": "호출어",
    "allow": "허용",
    "deny": "거부",
    "sessionAllow": "세션 허용",
    "policyAllow": "계속 허용",
    "networkPolicyAllow": "네트워크 계속 허용",
    "gestureWake": "제스처 호출",
    "gestureStop": "제스처 정지",
    "gestureApprovalOnce": "제스처 허용",
    "gestureApprovalDeny": "제스처 거부",
    "gestureApprovalSession": "제스처 세션 허용",
    "gestureApprovalPolicy": "제스처 계속 허용",
    "gestureRunningMode": "제스처 실행 모드",
    "gestureNone": "없음",
    "gestureOpenPalm": "손바닥 펼침",
    "gestureThumbsDown": "엄지 아래",
    "gestureFist": "주먹",
    "gesturePeace": "브이",
    "gestureThumbsUp": "엄지 위",
    "gestureCustomName": "커스텀 이름",
    "gestureCapture": "캡처",
    "gestureClear": "삭제",
    "gestureRunOff": "끔",
    "gestureRunEmergencyOnly": "긴급 정지만",
    "quitVoiceAgent": "Voice Agent 종료",
    "voiceGuide": "1. 코덱스, 자비스 같은 호출어를 먼저 말하세요.\n2. 이어서 자연어로 할 일을 말하면 에이전트에게 그대로 전달됩니다.\n3. 권한 요청 중에는 허용/거부/이번 세션 동안 허용만 말하면 됩니다.\n4. 참고자료는 다음 요청 한 번에만 붙습니다.\n5. 정지는 현재 에이전트 작업을 즉시 중단합니다.",
    "referenceHelp": "추가는 다음 요청에 붙일 참고자료를 큐에 넣습니다. 전송은 입력한 텍스트를, 입력칸이 비었으면 대기 중인 참고자료를 바로 에이전트에게 보냅니다.",
    "languageHelp": "TTS와 응답 언어를 자동, 한국어, 영어 중 선택합니다. Visual UI 언어는 다음 재시작 때 적용됩니다.",
    "genderHelp": "가능한 경우 남성/여성 음성 선호도를 적용합니다.",
    "voiceHelp": "macOS에 설치된 특정 음성 이름을 직접 지정합니다.",
    "rateHelp": "TTS 말하기 속도입니다. 높을수록 빠르게 읽습니다.",
    "pitchHelp": "TTS 음높이입니다. 기본값은 1.00입니다.",
    "volumeHelp": "TTS 출력 볼륨입니다.",
    "thinkingHelp": "작업 중 반복 효과음 볼륨입니다. 0이면 꺼집니다.",
    "maxSpeechHelp": "한 번에 받을 always-on 발화 최대 길이입니다. 5초에서 55초 사이입니다.",
    "threadHelp": "다음 재시작 때 이어갈 Codex thread id입니다.",
    "newThreadHelp": "체크하면 다음 실행부터 저장된 thread id를 무시하고 새 Codex thread로 시작합니다. 체크 해제하면 마지막 thread를 이어갑니다.",
    "chatHelp": "최근 질문과 답변 패널 표시 여부입니다.",
    "hudHelp": "다른 앱 위에 뜨는 floating HUD 표시 여부입니다.",
    "popupHelp": "긴 설명이나 공부용 답변을 전부 읽지 않고 네이티브 팝업으로 띄웁니다.",
    "wakeWarningHelp": "호출어 불일치 안내를 TTS로 읽을지 정합니다.",
    "wakePhrasesHelp": "호출어 목록입니다. 줄마다 하나씩 입력하면 기존 목록을 대체합니다.",
    "approvalAllowHelp": "권한 요청에서 한 번만 허용으로 처리할 문구입니다. 줄마다 하나씩 입력합니다.",
    "approvalDenyHelp": "권한 요청에서 거부로 처리할 문구입니다. 허용 문구와 겹치면 안전하게 unknown으로 처리될 수 있습니다.",
    "sessionAllowHelp": "현재 세션 동안 허용으로 처리할 문구입니다.",
    "policyAllowHelp": "같은 명령 또는 같은 실행 정책을 계속 허용으로 처리할 문구입니다.",
    "networkPolicyAllowHelp": "같은 네트워크, 호스트, 도메인을 계속 허용으로 처리할 문구입니다.",
    "gestureHelp": "카메라 손모양을 호출, 정지, 권한 응답에 매핑합니다. 카메라는 --cam으로 실행한 경우에만 켜집니다.",
    "gestureRunningModeHelp": "off는 작업 실행 중 제스처를 무시합니다. emergency_only는 정지 제스처만 감시합니다.",
    "speech": "음성",
    "command": "명령",
    "status": "상태"
]

private func localizedText(_ key: String, language: UiLanguage) -> String {
    switch language {
    case .ko:
        return visualTextKo[key] ?? visualTextEn[key] ?? key
    case .en:
        return visualTextEn[key] ?? key
    }
}

private func resolvedUiLanguage(from value: String) -> UiLanguage {
    value == "ko" ? .ko : .en
}

private func stateText(_ state: String, language: UiLanguage) -> String {
    switch state {
    case "idle": return localizedText("idle", language: language)
    case "listening": return localizedText("listening", language: language)
    case "wake_matched": return localizedText("wakeMatched", language: language)
    case "wake_rejected": return localizedText("wakeRejected", language: language)
    case "stt_processing": return localizedText("sttProcessing", language: language)
    case "submitting": return localizedText("submitting", language: language)
    case "thinking": return localizedText("thinking", language: language)
    case "running": return localizedText("running", language: language)
    case "speaking": return localizedText("speaking", language: language)
    case "approval_pending": return localizedText("approvalPending", language: language)
    case "error": return localizedText("error", language: language)
    case "shutdown": return localizedText("shutdown", language: language)
    default: return state
    }
}

private func displayText(_ rawText: String, state: String, language: UiLanguage) -> String {
    let trimmed = rawText.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty || trimmed == state {
        return stateText(state, language: language)
    }
    switch trimmed {
    case "waiting for bridge": return localizedText("waitingForBridge", language: language)
    case "connecting": return localizedText("connecting", language: language)
    case "connected": return localizedText("connected", language: language)
    case "bridge disconnected": return localizedText("bridgeDisconnected", language: language)
    case "microphone on": return localizedText("microphoneOn", language: language)
    case "microphone off": return localizedText("microphoneOff", language: language)
    case "audio reconnecting": return localizedText("audioReconnecting", language: language)
    case "waiting for microphone": return localizedText("waitingForMicrophone", language: language)
    case "audio input restarting": return localizedText("audioInputRestarting", language: language)
    case "audio ready": return localizedText("audioReady", language: language)
    case "camera gesture cancelled": return localizedText("cameraGestureCancelled", language: language)
    case "camera gesture wake pending": return localizedText("cameraGestureWakePending", language: language)
    case "camera gesture wake off": return localizedText("cameraGestureWakeOff", language: language)
    case "camera gesture wake unavailable without --cam": return localizedText("cameraGestureUnavailableWithoutCam", language: language)
    case "camera gesture watcher ready": return localizedText("cameraGestureWatcherReady", language: language)
    case "camera gesture watcher started": return localizedText("cameraGestureWatcherStarted", language: language)
    case "TTS settings updated": return localizedText("ttsSettingsUpdated", language: language)
    case "TTS settings restored": return localizedText("ttsSettingsRestored", language: language)
    case "commands cleared": return localizedText("commandsCleared", language: language)
    case "idle": return localizedText("idle", language: language)
    default: return trimmed
    }
}

private func referenceSummary(queuedCount: Int, currentCount: Int = 0, language: UiLanguage) -> String {
    if currentCount > 0 && queuedCount > 0 {
        return "\(currentCount)" + localizedText("currentReferenceCountSuffix", language: language)
            + " · "
            + "\(queuedCount)" + localizedText("referenceCountSuffix", language: language)
    }
    if currentCount > 0 {
        return "\(currentCount)" + localizedText("currentReferenceCountSuffix", language: language)
    }
    if queuedCount <= 0 {
        return localizedText("noReferencesQueued", language: language)
    }
    return "\(queuedCount)" + localizedText("referenceCountSuffix", language: language)
}

private func sessionText(_ sessionId: String, language: UiLanguage) -> String {
    let trimmed = sessionId.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty
        ? localizedText("sessionNew", language: language)
        : localizedText("sessionPrefix", language: language) + trimmed
}

private func usageText(_ usage: String, language: UiLanguage) -> String {
    let trimmed = usage.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? "" : localizedText("usagePrefix", language: language) + trimmed
}

private func gestureDisplayName(_ value: String, language: UiLanguage) -> String {
    switch value {
    case "none":
        return localizedText("gestureNone", language: language)
    case "open_palm":
        return localizedText("gestureOpenPalm", language: language)
    case "thumbs_down":
        return localizedText("gestureThumbsDown", language: language)
    case "fist":
        return localizedText("gestureFist", language: language)
    case "peace":
        return localizedText("gesturePeace", language: language)
    case "thumbs_up":
        return localizedText("gestureThumbsUp", language: language)
    default:
        return value
    }
}

private func gestureRunningModeDisplayName(_ value: String, language: UiLanguage) -> String {
    switch value {
    case "emergency_only":
        return localizedText("gestureRunEmergencyOnly", language: language)
    case "off":
        return localizedText("gestureRunOff", language: language)
    default:
        return value
    }
}

private func cameraStatusText(_ event: [String: Any], language: UiLanguage) -> String {
    let enabled = event["enabled"] as? Bool ?? false
    let mode = event["mode"] as? String ?? "off"
    let wake = event["wakeGesture"] as? String ?? "-"
    let stop = event["stopGesture"] as? String ?? "-"
    let running = event["runningMode"] as? String ?? "off"
    let enabledText = localizedText(enabled ? "on" : "off", language: language)
    if let text = event["text"] as? String, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        return localizedText("cameraLabel", language: language) + ": \(enabledText) · \(mode) · " + displayText(text, state: "status", language: language)
    }
    return localizedText("cameraLabel", language: language) + ": \(enabledText) · \(mode) · " + localizedText("wake", language: language) + " \(gestureDisplayName(wake, language: language)) · " + localizedText("stop", language: language) + " \(gestureDisplayName(stop, language: language)) · \(gestureRunningModeDisplayName(running, language: language))"
}

final class AgentCircleView: NSView {
    var state = "idle" {
        didSet { needsDisplay = true }
    }
    var statusText = "waiting for bridge" {
        didSet { needsDisplay = true }
    }
    var rms: CGFloat = 0 {
        didSet { needsDisplay = true }
    }
    var peak: CGFloat = 0 {
        didSet { needsDisplay = true }
    }
    var glow: CGFloat = 0 {
        didSet { needsDisplay = true }
    }
    var compactStatusStyle = false {
        didSet { needsDisplay = true }
    }
    private var phase: CGFloat = 0

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in
            guard let self else { return }
            self.phase += 0.04 + self.statePhaseBoost()
            self.glow = max(0, self.glow - 0.025)
            self.needsDisplay = true
        }
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func draw(_ dirtyRect: NSRect) {
        NSColor(calibratedRed: 0.03, green: 0.04, blue: 0.06, alpha: 1).setFill()
        dirtyRect.fill()

        let center = CGPoint(x: bounds.midX, y: bounds.midY)
        let activity = max(rms, peak * 0.45, glow * 0.85, stateActivityFloor())
        let baseRadius = min(bounds.width, bounds.height) * 0.31 + activity * 16
        var amplitude = 7 + rms * 42 + peak * 18 + glow * 24
        if state == "speaking" {
            amplitude += 12 + max(0, sin(phase * 2.2)) * 12
        }
        if state == "stt_processing" {
            amplitude = 6 + sin(phase * 2.0) * 2
        }
        if state == "submitting" {
            amplitude = 10 + max(0, sin(phase * 3.1)) * 10
        }
        if state == "wake_rejected" {
            amplitude = 16 + max(0, sin(phase * 5.1)) * 18
        }
        drawHalo(center: center, radius: baseRadius + 48, activity: activity)
        drawWaveRing(center: center, baseRadius: baseRadius + 2, amplitude: amplitude, phaseOffset: 0, alpha: 0.92, lineWidth: 3.6)
        drawWaveRing(center: center, baseRadius: baseRadius - 10, amplitude: amplitude * 0.42, phaseOffset: 1.7, alpha: 0.48, lineWidth: 1.6)
        if state == "speaking" {
            drawSpeakingWaves(center: center, baseRadius: baseRadius + 20)
        } else if state == "stt_processing" {
            drawProcessingIndicator(center: center, baseRadius: baseRadius + 25)
        } else if state == "submitting" {
            drawSubmittingIndicator(center: center, baseRadius: baseRadius + 18)
        } else if state == "thinking" {
            drawThinkingIndicator(center: center, baseRadius: baseRadius + 18)
        } else if state == "wake_rejected" {
            drawRejectedIndicator(center: center, baseRadius: baseRadius + 15)
        } else {
            drawOuterTicks(center: center, baseRadius: baseRadius + 16, amplitude: amplitude)
        }
        drawInnerGuide(center: center, radius: baseRadius - 26)

        let expandedText = bounds.width >= 320 || bounds.height >= 320
        let compactStateText = compactStatusStyle || (!expandedText && state != "approval_pending" && state != "wake_rejected")
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = .center
        paragraph.lineBreakMode = compactStateText ? .byTruncatingTail : .byWordWrapping
        let fontSize: CGFloat = state == "approval_pending" || state == "wake_rejected" ? 13 : 15
        let attrs: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: fontSize, weight: state == "wake_rejected" ? .semibold : .medium),
            .foregroundColor: NSColor(calibratedRed: 0.86, green: 0.89, blue: 0.94, alpha: 1),
            .paragraphStyle: paragraph
        ]
        let textHeight = state == "approval_pending"
            ? min(max(bounds.height * 0.46, 156), 240)
            : state == "wake_rejected"
                ? min(max(bounds.height * 0.38, 128), 198)
            : expandedText ? min(max(bounds.height * 0.34, 92), 150) : min(max(bounds.height * 0.18, 56), 78)
        let textInset: CGFloat = compactStateText ? 8 : 24
        let textRect = NSRect(x: textInset, y: 16, width: bounds.width - textInset * 2, height: textHeight)
        var options: NSString.DrawingOptions = [.usesLineFragmentOrigin, .usesFontLeading]
        if !expandedText && state != "wake_rejected" {
            options.insert(.truncatesLastVisibleLine)
        }
        if !compactStatusStyle && (state == "approval_pending" || state == "wake_rejected"), !statusText.isEmpty {
            let backdropRect = textRect.insetBy(dx: -6, dy: -10)
            NSColor(calibratedRed: 0.02, green: 0.03, blue: 0.05, alpha: 0.82).setFill()
            NSBezierPath(roundedRect: backdropRect, xRadius: 12, yRadius: 12).fill()
            if state == "approval_pending" {
                NSColor(calibratedRed: 1.0, green: 0.82, blue: 0.36, alpha: 0.68).setStroke()
            } else if state == "wake_rejected" {
                NSColor(calibratedRed: 1.0, green: 0.24, blue: 0.37, alpha: 0.72).setStroke()
            }
            NSBezierPath(roundedRect: backdropRect, xRadius: 12, yRadius: 12).stroke()
        }
        (statusText as NSString).draw(
            with: textRect,
            options: options,
            attributes: attrs
        )
    }

    private func stateColor() -> NSColor {
        switch state {
        case "approval_pending": return .systemYellow
        case "error": return .systemPink
        case "wake_rejected": return .systemRed
        case "stt_processing": return .systemBlue
        case "submitting": return .systemOrange
        case "speaking": return .systemCyan
        case "wake_matched": return .systemOrange
        case "listening": return .systemGreen
        case "thinking", "running": return .systemPurple
        default: return NSColor(calibratedRed: 0.36, green: 0.41, blue: 0.47, alpha: 1)
        }
    }

    private func stateHue() -> CGFloat {
        switch state {
        case "approval_pending": return 0.128
        case "error": return 0.958
        case "wake_rejected": return 0.972
        case "stt_processing": return 0.550
        case "submitting": return 0.100
        case "speaking": return 0.528
        case "wake_matched": return 0.067
        case "listening": return 0.411
        case "thinking", "running": return 0.728
        default: return 0.583
        }
    }

    private func stateActivityFloor() -> CGFloat {
        switch state {
        case "speaking": return 0.42 + sin(phase * 2.2) * 0.08
        case "stt_processing": return 0.50
        case "submitting": return 0.62
        case "thinking", "running": return 0.28
        case "approval_pending": return 0.34
        case "wake_rejected": return 0.70
        case "wake_matched": return 0.72
        default: return 0
        }
    }

    private func statePhaseBoost() -> CGFloat {
        switch state {
        case "speaking": return 0.035
        case "stt_processing": return 0.055
        case "submitting": return 0.070
        case "wake_rejected": return 0.090
        case "thinking": return 0.025
        default: return 0
        }
    }

    private func drawHalo(center: CGPoint, radius: CGFloat, activity: CGFloat) {
        guard let gradient = NSGradient(colors: [
            NSColor(calibratedHue: stateHue(), saturation: 0.92, brightness: 0.72, alpha: 0.24 + activity * 0.18),
            NSColor(calibratedHue: wrapHue(stateHue() + 0.11), saturation: 0.88, brightness: 0.52, alpha: 0.02)
        ]) else { return }

        gradient.draw(
            fromCenter: center,
            radius: radius * 0.28,
            toCenter: center,
            radius: radius,
            options: []
        )
    }

    private func drawWaveRing(center: CGPoint, baseRadius: CGFloat, amplitude: CGFloat, phaseOffset: CGFloat, alpha: CGFloat, lineWidth: CGFloat) {
        let steps = 192
        let path = NSBezierPath()

        for index in 0...steps {
            let angle = CGFloat(index) / CGFloat(steps) * CGFloat.pi * 2
            let radius = radiusAt(angle: angle, baseRadius: baseRadius, amplitude: amplitude, phaseOffset: phaseOffset)
            let point = CGPoint(
                x: center.x + cos(angle) * radius,
                y: center.y + sin(angle) * radius
            )

            if index == 0 {
                path.move(to: point)
            } else {
                path.line(to: point)
            }
        }

        path.close()
        path.lineWidth = lineWidth
        color(hueOffset: phaseOffset * 0.04, alpha: alpha).setStroke()
        path.stroke()
    }

    private func drawOuterTicks(center: CGPoint, baseRadius: CGFloat, amplitude: CGFloat) {
        let count = 92

        for index in 0..<count {
            let angle = CGFloat(index) / CGFloat(count) * CGFloat.pi * 2
            let n = max(0, noise(angle: angle, phaseOffset: 2.8))
            let burst = max(0, sin(angle * 5.0 - phase * 1.6))
            let length = 4 + n * amplitude * 0.52 + burst * peak * 36 + glow * 10
            let inner = baseRadius + n * 7
            let outer = inner + length
            let path = NSBezierPath()

            path.move(to: CGPoint(
                x: center.x + cos(angle) * inner,
                y: center.y + sin(angle) * inner
            ))
            path.line(to: CGPoint(
                x: center.x + cos(angle) * outer,
                y: center.y + sin(angle) * outer
            ))
            path.lineWidth = 1.1 + n * 2.4 + peak * 2.0
            color(hueOffset: CGFloat(index) * 0.0047, alpha: 0.30 + n * 0.52 + glow * 0.20).setStroke()
            path.stroke()
        }
    }

    private func drawSpeakingWaves(center: CGPoint, baseRadius: CGFloat) {
        for ring in 0..<3 {
            let radius = baseRadius + CGFloat(ring) * 15 + (phase * 26 + CGFloat(ring) * 11).truncatingRemainder(dividingBy: 28)
            let alpha = max(0, 0.46 - CGFloat(ring) * 0.12 - ((radius - baseRadius) / 80) * 0.22)
            let path = NSBezierPath()
            path.appendArc(
                withCenter: center,
                radius: radius,
                startAngle: 22,
                endAngle: 338,
                clockwise: false
            )
            path.lineWidth = 2.1 - CGFloat(ring) * 0.35
            color(hueOffset: 0.06 + CGFloat(ring) * 0.05, alpha: alpha).setStroke()
            path.stroke()
        }

        let count = 56
        for index in 0..<count {
            let angle = CGFloat(index) / CGFloat(count) * CGFloat.pi * 2
            let gate = max(0, sin(angle * 4 - phase * 2.8))
            let length = 5 + gate * 18 + max(0, sin(phase * 2.1 + CGFloat(index))) * 8
            let inner = baseRadius + 8 + gate * 4
            let outer = inner + length
            let path = NSBezierPath()

            path.move(to: CGPoint(
                x: center.x + cos(angle) * inner,
                y: center.y + sin(angle) * inner
            ))
            path.line(to: CGPoint(
                x: center.x + cos(angle) * outer,
                y: center.y + sin(angle) * outer
            ))
            path.lineWidth = 1.4 + gate * 1.7
            color(hueOffset: 0.06 + CGFloat(index) * 0.0033, alpha: 0.24 + gate * 0.42).setStroke()
            path.stroke()
        }
    }

    private func drawProcessingIndicator(center: CGPoint, baseRadius: CGFloat) {
        for arc in 0..<4 {
            let start = phase * 103 + CGFloat(arc) * 104
            let sweep = CGFloat(45 + arc * 6)
            let path = NSBezierPath()

            path.appendArc(
                withCenter: center,
                radius: baseRadius + CGFloat(arc) * 7,
                startAngle: start,
                endAngle: start + sweep,
                clockwise: false
            )
            path.lineWidth = 3.2 - CGFloat(arc) * 0.35
            color(hueOffset: CGFloat(arc) * 0.066, alpha: 0.78 - CGFloat(arc) * 0.13).setStroke()
            path.stroke()
        }

        for dot in 0..<10 {
            let angle = phase * 2.4 + CGFloat(dot) * CGFloat.pi * 0.2
            let pulse = 0.55 + sin(phase * 3 + CGFloat(dot)) * 0.35
            let radius = baseRadius - 20 + CGFloat(dot % 2) * 8
            let size = 1.8 + pulse * 2.4
            let rect = NSRect(
                x: center.x + cos(angle) * radius - size,
                y: center.y + sin(angle) * radius - size,
                width: size * 2,
                height: size * 2
            )
            color(hueOffset: CGFloat(dot) * 0.022, alpha: 0.32 + pulse * 0.45).setFill()
            NSBezierPath(ovalIn: rect).fill()
        }
    }

    private func drawSubmittingIndicator(center: CGPoint, baseRadius: CGFloat) {
        for lane in 0..<5 {
            let angle = phase * 2.6 + CGFloat(lane) * CGFloat.pi * 0.42
            let inner = baseRadius - 24 + CGFloat(lane) * 4
            let outer = baseRadius + 22 + max(0, sin(phase * 2.4 + CGFloat(lane))) * 14
            let path = NSBezierPath()

            path.move(to: CGPoint(
                x: center.x + cos(angle) * inner,
                y: center.y + sin(angle) * inner
            ))
            path.line(to: CGPoint(
                x: center.x + cos(angle) * outer,
                y: center.y + sin(angle) * outer
            ))
            path.lineWidth = 3.6 - CGFloat(lane) * 0.32
            color(hueOffset: CGFloat(lane) * 0.033, alpha: 0.78 - CGFloat(lane) * 0.08).setStroke()
            path.stroke()
        }

        for arc in 0..<3 {
            let start = phase * 160 + CGFloat(arc) * 130
            let path = NSBezierPath()

            path.appendArc(
                withCenter: center,
                radius: baseRadius + 30 + CGFloat(arc) * 9,
                startAngle: start,
                endAngle: start + 68,
                clockwise: false
            )
            path.lineWidth = 1.8
            color(hueOffset: 0.078 + CGFloat(arc) * 0.044, alpha: 0.42 - CGFloat(arc) * 0.08).setStroke()
            path.stroke()
        }
    }

    private func drawThinkingIndicator(center: CGPoint, baseRadius: CGFloat) {
        for orbit in 0..<6 {
            let radius = baseRadius + 8 + CGFloat(orbit) * 9 + sin(phase * 1.35 + CGFloat(orbit)) * 6
            let start = phase * (35.5 + CGFloat(orbit) * 5.2) + CGFloat(orbit) * 19
            let path = NSBezierPath()
            path.appendArc(
                withCenter: center,
                radius: radius,
                startAngle: start,
                endAngle: start + CGFloat(54 + orbit * 6),
                clockwise: false
            )
            path.lineWidth = 2.8 - CGFloat(orbit) * 0.22
            color(hueOffset: CGFloat(orbit) * 0.050, alpha: 0.52 - CGFloat(orbit) * 0.055).setStroke()
            path.stroke()
        }

        for spoke in 0..<28 {
            let angle = CGFloat(spoke) * CGFloat.pi * 2 / 28 + phase * 0.26
            let breath = 0.55 + sin(phase * 1.5 + CGFloat(spoke) * 0.45) * 0.32
            let inner = baseRadius + 20 + breath * 6
            let outer = inner + 10 + max(0, sin(angle * 4 - phase * 1.8)) * 20
            let path = NSBezierPath()

            path.move(to: CGPoint(
                x: center.x + cos(angle) * inner,
                y: center.y + sin(angle) * inner
            ))
            path.line(to: CGPoint(
                x: center.x + cos(angle) * outer,
                y: center.y + sin(angle) * outer
            ))
            path.lineWidth = 1.1 + breath * 1.6
            color(hueOffset: 0.094 + CGFloat(spoke) * 0.004, alpha: 0.14 + breath * 0.22).setStroke()
            path.stroke()
        }

        for dot in 0..<16 {
            let angle = phase * 1.05 + CGFloat(dot) * CGFloat.pi * 2 / 16
            let pulse = 0.48 + sin(phase * 1.9 + CGFloat(dot) * 0.7) * 0.30
            let radius = baseRadius - 14 + pulse * 10
            let size = 2.2 + pulse * 2.8
            let rect = NSRect(
                x: center.x + cos(angle) * radius - size,
                y: center.y + sin(angle) * radius - size,
                width: size * 2,
                height: size * 2
            )
            color(hueOffset: CGFloat(dot) * 0.008, alpha: 0.24 + pulse * 0.34).setFill()
            NSBezierPath(ovalIn: rect).fill()
        }
    }

    private func drawRejectedIndicator(center: CGPoint, baseRadius: CGFloat) {
        let count = 84

        for index in 0..<count {
            let angle = CGFloat(index) / CGFloat(count) * CGFloat.pi * 2
            let n = max(0, sin(angle * 9 + phase * 4.0))
            let snap = max(0, sin(angle * 3 - phase * 5.5))
            let inner = baseRadius + 5 + snap * 5
            let outer = inner + 5 + n * 28 + glow * 12
            let path = NSBezierPath()

            path.move(to: CGPoint(
                x: center.x + cos(angle) * inner,
                y: center.y + sin(angle) * inner
            ))
            path.line(to: CGPoint(
                x: center.x + cos(angle) * outer,
                y: center.y + sin(angle) * outer
            ))
            path.lineWidth = 1.4 + n * 3.2
            color(hueOffset: CGFloat(index) * 0.0022, alpha: 0.34 + n * 0.54).setStroke()
            path.stroke()
        }

        for offset in [CGFloat(0), CGFloat(180)] {
            let start = phase * 138 + offset
            let path = NSBezierPath()
            path.appendArc(
                withCenter: center,
                radius: baseRadius - 18,
                startAngle: start,
                endAngle: start + 40,
                clockwise: false
            )
            path.lineWidth = 3.4
            color(hueOffset: 0, alpha: 0.82).setStroke()
            path.stroke()
        }
    }

    private func drawInnerGuide(center: CGPoint, radius: CGFloat) {
        let rect = NSRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2)
        let path = NSBezierPath(ovalIn: rect)
        path.lineWidth = 1
        NSColor(calibratedRed: 0.17, green: 0.22, blue: 0.29, alpha: 0.56).setStroke()
        path.stroke()
    }

    private func radiusAt(angle: CGFloat, baseRadius: CGFloat, amplitude: CGFloat, phaseOffset: CGFloat) -> CGFloat {
        baseRadius + noise(angle: angle, phaseOffset: phaseOffset) * amplitude
    }

    private func noise(angle: CGFloat, phaseOffset: CGFloat) -> CGFloat {
        sin(angle * 3.1 + phase * 1.7 + phaseOffset) * 0.42
            + sin(angle * 7.0 - phase * 1.12 + phaseOffset * 1.9) * 0.28
            + sin(angle * 13.0 + phase * 0.67 + phaseOffset * 0.6) * 0.18
            + sin(angle * 21.0 - phase * 0.38 + phaseOffset * 2.4) * 0.12
    }

    private func color(hueOffset: CGFloat, alpha: CGFloat) -> NSColor {
        NSColor(
            calibratedHue: wrapHue(stateHue() + hueOffset),
            saturation: 0.96,
            brightness: 0.96,
            alpha: min(1, max(0, alpha))
        )
    }

    private func wrapHue(_ value: CGFloat) -> CGFloat {
        let wrapped = value.truncatingRemainder(dividingBy: 1)
        return wrapped < 0 ? wrapped + 1 : wrapped
    }
}

final class VisualRootView: NSView {
    var uiLanguage: UiLanguage = .en {
        didSet { applyLocalization() }
    }
    private let circleView: AgentCircleView
    private let commandView: NSTextView
    private let contextField: NSTextField
    private let contextSummary: NSTextField
    private let addContextButton: NSButton
    private let directContextButton: NSButton
    private let clearContextButton: NSButton
    private let showContextButton: NSButton
    private let commandPanel = NSView(frame: .zero)
    private let contextLabel = NSTextField(labelWithString: "References")
    private let referenceHelpButton = HoverHelpButton(frame: .zero)
    private let commandLabel = NSTextField(labelWithString: "Commands")
    private let commandScroll = NSScrollView(frame: .zero)
    private let guideButton = NSButton(title: "?", target: nil, action: nil)
    private let sessionLabel = NSTextField(labelWithString: "session: new")
    private let usageLabel = NSTextField(labelWithString: "")
    private let cameraLabel = NSTextField(labelWithString: "")
    private let questionView = QuestionLabelView(frame: .zero)
    private let chatView = ChatHistoryView(frame: .zero)
    private let chatToggleButton = NSButton(title: "Q/A", target: nil, action: nil)
    private let controls: NSStackView
    private var chatHistoryEnabled = true
    private var chatPanelOpen = true
    private var micEnabled = true
    private var cameraEnabled = false
    private var currentSessionId = ""
    private var currentUsage = ""
    private var currentCamera = ""
    private var currentContextCount = 0
    private var currentQuestionReferenceCount = 0

    init(
        circleView: AgentCircleView,
        commandView: NSTextView,
        contextField: NSTextField,
        contextSummary: NSTextField,
        addContextButton: NSButton,
        directContextButton: NSButton,
        clearContextButton: NSButton,
        showContextButton: NSButton,
        controls: NSStackView
    ) {
        self.circleView = circleView
        self.commandView = commandView
        self.contextField = contextField
        self.contextSummary = contextSummary
        self.addContextButton = addContextButton
        self.directContextButton = directContextButton
        self.clearContextButton = clearContextButton
        self.showContextButton = showContextButton
        self.controls = controls
        super.init(frame: .zero)

        wantsLayer = true
        layer?.backgroundColor = NSColor(calibratedRed: 0.03, green: 0.04, blue: 0.06, alpha: 1).cgColor

        circleView.autoresizingMask = []
        addSubview(circleView)

        questionView.isHidden = true
        addSubview(questionView)

        chatView.isHidden = true
        addSubview(chatView)

        chatToggleButton.bezelStyle = .rounded
        chatToggleButton.target = self
        chatToggleButton.action = #selector(toggleChatPanel)
        addSubview(chatToggleButton)

        sessionLabel.textColor = NSColor(calibratedRed: 0.62, green: 0.69, blue: 0.78, alpha: 1)
        sessionLabel.font = NSFont.monospacedSystemFont(ofSize: 12, weight: .regular)
        sessionLabel.lineBreakMode = .byTruncatingMiddle
        addSubview(sessionLabel)

        usageLabel.textColor = NSColor(calibratedRed: 0.72, green: 0.82, blue: 0.94, alpha: 1)
        usageLabel.font = NSFont.monospacedSystemFont(ofSize: 11, weight: .medium)
        usageLabel.alignment = .left
        usageLabel.lineBreakMode = .byTruncatingTail
        addSubview(usageLabel)

        cameraLabel.textColor = NSColor(calibratedRed: 0.69, green: 0.76, blue: 0.86, alpha: 1)
        cameraLabel.font = NSFont.monospacedSystemFont(ofSize: 11, weight: .medium)
        cameraLabel.alignment = .left
        cameraLabel.lineBreakMode = .byTruncatingTail
        addSubview(cameraLabel)

        guideButton.bezelStyle = .helpButton
        guideButton.toolTip = localizedText("guideTooltip", language: uiLanguage)
        guideButton.target = self
        guideButton.action = #selector(showVoiceGuide)
        addSubview(guideButton)

        commandPanel.wantsLayer = true
        commandPanel.layer?.backgroundColor = NSColor(calibratedRed: 0.06, green: 0.09, blue: 0.13, alpha: 1).cgColor
        commandPanel.layer?.borderColor = NSColor(calibratedRed: 0.14, green: 0.19, blue: 0.26, alpha: 1).cgColor
        commandPanel.layer?.borderWidth = 1
        commandPanel.layer?.cornerRadius = 8
        addSubview(commandPanel)

        contextLabel.textColor = NSColor(calibratedRed: 0.57, green: 0.64, blue: 0.73, alpha: 1)
        contextLabel.font = NSFont.boldSystemFont(ofSize: 13)
        commandPanel.addSubview(contextLabel)

        referenceHelpButton.title = "?"
        referenceHelpButton.helpText = localizedText("referenceHelp", language: uiLanguage)
        commandPanel.addSubview(referenceHelpButton)

        contextField.placeholderString = localizedText("referenceText", language: uiLanguage)
        contextField.font = NSFont.systemFont(ofSize: 13)
        commandPanel.addSubview(contextField)

        contextSummary.textColor = NSColor(calibratedRed: 0.41, green: 0.47, blue: 0.55, alpha: 1)
        contextSummary.font = NSFont.systemFont(ofSize: 12)
        commandPanel.addSubview(contextSummary)

        commandPanel.addSubview(addContextButton)
        commandPanel.addSubview(directContextButton)
        commandPanel.addSubview(showContextButton)
        commandPanel.addSubview(clearContextButton)

        commandLabel.textColor = NSColor(calibratedRed: 0.57, green: 0.64, blue: 0.73, alpha: 1)
        commandLabel.font = NSFont.boldSystemFont(ofSize: 13)
        commandPanel.addSubview(commandLabel)

        commandView.isEditable = false
        commandView.isSelectable = true
        commandView.allowsUndo = false
        commandView.drawsBackground = true
        commandView.backgroundColor = NSColor(calibratedRed: 0.06, green: 0.09, blue: 0.13, alpha: 1)
        commandView.textColor = .white
        commandView.font = NSFont.monospacedSystemFont(ofSize: 13, weight: .regular)
        commandView.textContainerInset = NSSize(width: 8, height: 8)
        commandView.isVerticallyResizable = true
        commandView.isHorizontallyResizable = false
        commandView.autoresizingMask = [.width]
        commandView.textContainer?.widthTracksTextView = true
        commandView.textContainer?.heightTracksTextView = false

        commandScroll.documentView = commandView
        commandScroll.hasVerticalScroller = true
        commandScroll.borderType = .noBorder
        commandScroll.drawsBackground = false
        commandPanel.addSubview(commandScroll)

        controls.orientation = .horizontal
        controls.distribution = .fillEqually
        controls.spacing = 10
        addSubview(controls)
        applyLocalization()
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    @objc private func showVoiceGuide() {
        let alert = NSAlert()
        alert.messageText = localizedText("voiceAgentGuide", language: uiLanguage)
        alert.informativeText = localizedText("voiceGuide", language: uiLanguage)
        alert.addButton(withTitle: localizedText("ok", language: uiLanguage))
        alert.runModal()
    }

    override func layout() {
        super.layout()

        let inset: CGFloat = 22
        let gap: CGFloat = 10
        let controlsHeight: CGFloat = 34
        let expanded = bounds.width >= 760 || bounds.height >= 760
        let chatAvailable = chatHistoryEnabled && expanded && bounds.width >= 980
        let chatVisible = chatAvailable && chatPanelOpen
        let chatWidth = min(CGFloat(360), max(CGFloat(300), bounds.width * 0.26))
        let commandHeight = max(132, min(expanded ? 220 : 172, bounds.height * (expanded ? 0.22 : 0.25)))
        let contentWidth = max(0, bounds.width - inset * 2)
        let mainContentWidth = chatVisible ? max(320, bounds.width - inset * 3 - gap - chatWidth) : contentWidth

        controls.frame = NSRect(x: inset, y: inset, width: contentWidth, height: controlsHeight)
        commandPanel.frame = NSRect(
            x: inset,
            y: controls.frame.maxY + gap,
            width: mainContentWidth,
            height: commandHeight
        )
        chatView.isHidden = !chatVisible
        if chatVisible {
            chatView.frame = NSRect(
                x: bounds.width - inset - chatWidth,
                y: commandPanel.frame.minY,
                width: chatWidth,
                height: bounds.height - commandPanel.frame.minY - inset
            )
        }
        chatToggleButton.isHidden = !chatAvailable
        chatToggleButton.title = chatPanelOpen ? localizedText("hide", language: uiLanguage) : "Q/A"
        if chatVisible {
            chatToggleButton.frame = NSRect(
                x: chatView.frame.minX + 104,
                y: chatView.frame.maxY - 36,
                width: 62,
                height: 24
            )
        } else {
            chatToggleButton.frame = NSRect(
                x: bounds.width - inset - 72,
                y: bounds.height - inset - 68,
                width: 72,
                height: 28
            )
        }

        let panelInset: CGFloat = 14
        let labelHeight: CGFloat = 18
        let fieldHeight: CGFloat = 26
        let summaryHeight: CGFloat = 16
        let buttonWidth: CGFloat = 76
        let refButtonWidth: CGFloat = 64
        let topY = commandPanel.bounds.height - panelInset - labelHeight

        guideButton.frame = NSRect(
            x: bounds.width - inset - 28,
            y: bounds.height - inset - 28,
            width: 28,
            height: 28
        )
        sessionLabel.frame = NSRect(
            x: inset,
            y: bounds.height - inset - 28,
            width: max(80, min(360, guideButton.frame.minX - inset - 12)),
            height: 28
        )
        usageLabel.frame = NSRect(
            x: inset,
            y: sessionLabel.frame.minY - 18,
            width: max(120, min(520, guideButton.frame.minX - inset - 12)),
            height: 18
        )
        cameraLabel.frame = NSRect(
            x: inset,
            y: usageLabel.frame.minY - 18,
            width: max(120, min(520, guideButton.frame.minX - inset - 12)),
            height: 18
        )
        referenceHelpButton.frame = NSRect(
            x: commandPanel.bounds.width - panelInset - 24,
            y: topY - 2,
            width: 24,
            height: 22
        )

        contextLabel.frame = NSRect(
            x: panelInset,
            y: topY,
            width: max(0, referenceHelpButton.frame.minX - panelInset - 6),
            height: labelHeight
        )
        clearContextButton.frame = NSRect(
            x: commandPanel.bounds.width - panelInset - buttonWidth,
            y: contextLabel.frame.minY - fieldHeight - 6,
            width: buttonWidth,
            height: fieldHeight
        )
        showContextButton.frame = NSRect(
            x: clearContextButton.frame.minX - refButtonWidth - 8,
            y: clearContextButton.frame.minY,
            width: refButtonWidth,
            height: fieldHeight
        )
        directContextButton.frame = NSRect(
            x: showContextButton.frame.minX - refButtonWidth - 8,
            y: clearContextButton.frame.minY,
            width: refButtonWidth,
            height: fieldHeight
        )
        addContextButton.frame = NSRect(
            x: directContextButton.frame.minX - refButtonWidth - 8,
            y: clearContextButton.frame.minY,
            width: refButtonWidth,
            height: fieldHeight
        )
        contextField.frame = NSRect(
            x: panelInset,
            y: clearContextButton.frame.minY,
            width: max(0, addContextButton.frame.minX - panelInset - 8),
            height: fieldHeight
        )
        contextSummary.frame = NSRect(
            x: panelInset,
            y: contextField.frame.minY - summaryHeight - 5,
            width: max(0, commandPanel.bounds.width - panelInset * 2),
            height: summaryHeight
        )
        commandLabel.frame = NSRect(
            x: panelInset,
            y: contextSummary.frame.minY - labelHeight - 8,
            width: max(0, commandPanel.bounds.width - panelInset * 2),
            height: labelHeight
        )
        commandScroll.frame = NSRect(
            x: panelInset,
            y: panelInset,
            width: max(0, commandPanel.bounds.width - panelInset * 2),
            height: max(24, commandLabel.frame.minY - panelInset - 8)
        )
        let commandContentSize = commandScroll.contentSize
        commandView.minSize = NSSize(width: 0, height: commandContentSize.height)
        commandView.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        commandView.textContainer?.containerSize = NSSize(
            width: commandContentSize.width,
            height: CGFloat.greatestFiniteMagnitude
        )
        commandView.frame = NSRect(
            x: 0,
            y: 0,
            width: commandContentSize.width,
            height: max(commandContentSize.height, commandView.frame.height)
        )
        resizeCommandTextView()

        let bottomLimit = commandPanel.frame.maxY + 12
        let topLimit = bounds.height - inset
        let minimumClearance: CGFloat = 110
        let visualCenterLift = max(96, min(220, bounds.height * 0.20))
        let targetCenterY = bounds.midY + visualCenterLift
        let centerY: CGFloat
        if topLimit - bottomLimit >= minimumClearance * 2 {
            centerY = min(max(targetCenterY, bottomLimit + minimumClearance), topLimit - minimumClearance)
        } else {
            centerY = (topLimit + bottomLimit) / 2
        }
        let center = CGPoint(x: bounds.midX, y: centerY)
        let visualCenterX = chatVisible ? inset + mainContentWidth / 2 : center.x
        let centerClearance = max(110, min(topLimit - center.y, center.y - bottomLimit))
        let maxCircle: CGFloat = expanded ? 720 : 360
        let circleSize = max(
            220,
            min(
                mainContentWidth * (expanded ? 0.78 : 0.84),
                bounds.height * (expanded ? 0.60 : 0.48),
                centerClearance * 2,
                maxCircle
            )
        )
        let circleViewWidth = min(mainContentWidth, max(circleSize, circleSize + 120))
        circleView.frame = NSRect(
            x: visualCenterX - circleViewWidth / 2,
            y: center.y - circleSize / 2,
            width: circleViewWidth,
            height: circleSize
        )

        let questionHeight: CGFloat = expanded ? 58 : 50
        questionView.fontSize = expanded ? 17 : 15
        questionView.frame = NSRect(
            x: inset,
            y: max(commandPanel.frame.maxY + 8, circleView.frame.minY - questionHeight - 8),
            width: mainContentWidth,
            height: questionHeight
        )
    }

    func updateSessionId(_ sessionId: String) {
        currentSessionId = sessionId
        sessionLabel.stringValue = sessionText(sessionId, language: uiLanguage)
    }

    func updateUsage(_ usage: String) {
        currentUsage = usage
        usageLabel.stringValue = usageText(usage, language: uiLanguage)
    }

    func updateCamera(_ camera: String) {
        currentCamera = camera
        cameraLabel.stringValue = camera
    }

    func updateCameraEnabled(_ enabled: Bool) {
        cameraEnabled = enabled
        applyLocalization()
    }

    func updateContextSummary(_ count: Int) {
        currentContextCount = count
        contextSummary.stringValue = referenceSummary(
            queuedCount: count,
            currentCount: currentQuestionReferenceCount,
            language: uiLanguage
        )
    }

    func updateQuestion(_ question: String, references: [String] = []) {
        let trimmed = question.trimmingCharacters(in: .whitespacesAndNewlines)
        questionView.question = trimmed
        currentQuestionReferenceCount = references
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .count
        updateContextSummary(currentContextCount)
    }

    func pushChat(role: String, kind: String, text: String) {
        chatView.push(role: role, kind: kind, text: text)
    }

    func resizeCommandTextView(scrollToTop: Bool = false) {
        guard let textContainer = commandView.textContainer, let layoutManager = commandView.layoutManager else { return }

        layoutManager.ensureLayout(for: textContainer)
        let usedRect = layoutManager.usedRect(for: textContainer)
        let contentSize = commandScroll.contentSize
        commandView.frame.size = NSSize(
            width: contentSize.width,
            height: max(contentSize.height, ceil(usedRect.height + commandView.textContainerInset.height * 2 + 12))
        )
        if scrollToTop {
            commandView.scrollRangeToVisible(NSRange(location: 0, length: 0))
        }
    }

    func updateChatHistory(enabled: Bool) {
        chatHistoryEnabled = enabled
        if enabled {
            chatPanelOpen = true
        }
        needsLayout = true
    }

    func updateMicEnabled(_ enabled: Bool) {
        micEnabled = enabled
        applyLocalization()
    }

    @objc private func toggleChatPanel() {
        chatPanelOpen.toggle()
        needsLayout = true
    }

    private func applyLocalization() {
        contextLabel.stringValue = localizedText("references", language: uiLanguage)
        commandLabel.stringValue = localizedText("commands", language: uiLanguage)
        guideButton.toolTip = localizedText("guideTooltip", language: uiLanguage)
        referenceHelpButton.helpText = localizedText("referenceHelp", language: uiLanguage)
        contextField.placeholderString = localizedText("referenceText", language: uiLanguage)
        addContextButton.title = localizedText("add", language: uiLanguage)
        directContextButton.title = localizedText("directGo", language: uiLanguage)
        showContextButton.title = localizedText("refs", language: uiLanguage)
        clearContextButton.title = localizedText("clearRef", language: uiLanguage)
        updateSessionId(currentSessionId)
        updateUsage(currentUsage)
        updateCamera(currentCamera)
        updateContextSummary(currentContextCount)
        chatView.uiLanguage = uiLanguage
        let titles = [
            localizedText("stop", language: uiLanguage),
            localizedText("settings", language: uiLanguage),
            localizedText("ttsStop", language: uiLanguage),
            localizedText(micEnabled ? "micOff" : "micOn", language: uiLanguage),
            localizedText(cameraEnabled ? "cameraOff" : "cameraOn", language: uiLanguage),
            localizedText("clearCmds", language: uiLanguage),
            localizedText("exit", language: uiLanguage)
        ]
        for (index, subview) in controls.arrangedSubviews.enumerated() {
            guard index < titles.count, let button = subview as? NSButton else { continue }
            button.title = titles[index]
            if index == 0 {
                button.attributedTitle = NSAttributedString(
                    string: titles[index],
                    attributes: [
                        .foregroundColor: NSColor.systemRed,
                        .font: NSFont.systemFont(ofSize: NSFont.systemFontSize, weight: .bold)
                    ]
                )
            }
        }
        addContextButton.title = localizedText("add", language: uiLanguage)
        showContextButton.title = localizedText("refs", language: uiLanguage)
        clearContextButton.title = localizedText("clearRef", language: uiLanguage)
        chatToggleButton.title = chatPanelOpen ? localizedText("hide", language: uiLanguage) : "Q/A"
        needsLayout = true
    }
}

final class QuestionLabelView: NSView {
    var question = "" {
        didSet {
            isHidden = question.isEmpty
            needsDisplay = true
        }
    }
    var fontSize: CGFloat = 15 {
        didSet { needsDisplay = true }
    }

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = false
        isHidden = true
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func draw(_ dirtyRect: NSRect) {
        guard !question.isEmpty else { return }

        let backgroundPath = NSBezierPath(roundedRect: bounds.insetBy(dx: 0.5, dy: 0.5), xRadius: 11, yRadius: 11)
        NSColor(calibratedRed: 0.02, green: 0.03, blue: 0.05, alpha: 0.72).setFill()
        backgroundPath.fill()
        NSColor(calibratedRed: 0.11, green: 0.20, blue: 0.28, alpha: 0.90).setStroke()
        backgroundPath.lineWidth = 1
        backgroundPath.stroke()

        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = .center
        paragraph.lineBreakMode = .byTruncatingTail
        let attrs: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: fontSize, weight: .semibold),
            .foregroundColor: NSColor(calibratedRed: 0.88, green: 0.92, blue: 0.97, alpha: 1),
            .paragraphStyle: paragraph
        ]
        let textRect = bounds.insetBy(dx: 14, dy: 11)
        ("Q: \(question)" as NSString).draw(
            with: textRect,
            options: [.usesLineFragmentOrigin, .usesFontLeading, .truncatesLastVisibleLine],
            attributes: attrs
        )
    }
}

struct ChatHistoryItem {
    let role: String
    let kind: String
    let text: String
}

final class ChatHistoryView: NSView {
    var uiLanguage: UiLanguage = .en {
        didSet {
            bubbleViews.forEach { $0.uiLanguage = uiLanguage }
            needsDisplay = true
        }
    }
    private var items: [ChatHistoryItem] = []
    private var bubbleViews: [ChatBubbleView] = []
    private let scrollView = NSScrollView(frame: .zero)
    private let contentView = NSView(frame: .zero)

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        scrollView.drawsBackground = false
        scrollView.borderType = .noBorder
        scrollView.hasVerticalScroller = true
        scrollView.documentView = contentView
        addSubview(scrollView)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func push(role: String, kind: String, text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        items.append(ChatHistoryItem(role: role, kind: kind, text: trimmed))
        if items.count > 10 {
            items.removeFirst(items.count - 10)
        }
        rebuildBubbles()
        layoutBubbles(scrollToBottom: true)
        needsDisplay = true
    }

    override func layout() {
        super.layout()
        scrollView.frame = NSRect(x: 8, y: 8, width: max(0, bounds.width - 20), height: max(0, bounds.height - 44))
        layoutBubbles(scrollToBottom: false)
    }

    override func draw(_ dirtyRect: NSRect) {
        let panel = NSBezierPath(roundedRect: bounds.insetBy(dx: 0.5, dy: 0.5), xRadius: 10, yRadius: 10)
        NSColor(calibratedRed: 0.04, green: 0.07, blue: 0.10, alpha: 1).setFill()
        panel.fill()
        NSColor(calibratedRed: 0.15, green: 0.21, blue: 0.29, alpha: 1).setStroke()
        panel.lineWidth = 1
        panel.stroke()

        drawTitle()
    }

    private func drawTitle() {
        let attrs: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: 15, weight: .bold),
            .foregroundColor: NSColor(calibratedRed: 0.88, green: 0.92, blue: 0.97, alpha: 1)
        ]
        (localizedText("recentQa", language: uiLanguage) as NSString).draw(
            with: NSRect(x: 14, y: bounds.height - 30, width: bounds.width - 28, height: 18),
            options: [.usesLineFragmentOrigin],
            attributes: attrs
        )
    }

    private func rebuildBubbles() {
        bubbleViews.forEach { $0.removeFromSuperview() }
        bubbleViews = items.map { ChatBubbleView(item: $0, uiLanguage: uiLanguage) }
        bubbleViews.forEach { contentView.addSubview($0) }
    }

    private func layoutBubbles(scrollToBottom: Bool) {
        let scrollBounds = scrollView.contentView.bounds
        let scrollbarReserve: CGFloat = scrollView.hasVerticalScroller ? 16 : 0
        let availableWidth = max(0, scrollView.contentView.bounds.width - scrollbarReserve)
        let bubbleWidth = max(160, availableWidth * 0.86)
        let spacing: CGFloat = 8
        let margin: CGFloat = 8
        let heights = bubbleViews.map { $0.preferredHeight(width: bubbleWidth) }
        let totalHeight = heights.reduce(margin, +) + CGFloat(max(0, heights.count - 1)) * spacing + margin
        let contentHeight = max(scrollView.bounds.height, totalHeight)
        contentView.frame = NSRect(x: 0, y: 0, width: max(0, scrollView.contentView.bounds.width - scrollbarReserve), height: contentHeight)

        var y = contentHeight - margin
        for (index, bubble) in bubbleViews.enumerated() {
            let height = heights[index]
            y -= height
            let x = bubble.item.role == "user" ? contentView.bounds.width - bubbleWidth - margin : margin
            bubble.frame = NSRect(x: x, y: y, width: bubbleWidth, height: height)
            y -= spacing
        }

        if scrollToBottom {
            scrollView.contentView.scroll(to: NSPoint(x: scrollBounds.origin.x, y: 0))
            scrollView.reflectScrolledClipView(scrollView.contentView)
        }
    }
}

final class ChatBubbleView: NSView {
    let item: ChatHistoryItem
    var uiLanguage: UiLanguage {
        didSet {
            kindLabel.stringValue = label(for: item.kind)
        }
    }
    private let kindLabel = NSTextField(labelWithString: "")
    private let textView = NSTextView(frame: .zero)

    init(item: ChatHistoryItem, uiLanguage: UiLanguage) {
        self.item = item
        self.uiLanguage = uiLanguage
        super.init(frame: .zero)

        kindLabel.stringValue = label(for: item.kind)
        kindLabel.font = NSFont.systemFont(ofSize: 11, weight: .bold)
        kindLabel.textColor = item.role == "user"
            ? NSColor(calibratedRed: 0.56, green: 0.78, blue: 1.0, alpha: 1)
            : NSColor(calibratedRed: 0.62, green: 0.69, blue: 0.78, alpha: 1)
        addSubview(kindLabel)

        textView.isEditable = false
        textView.isSelectable = true
        textView.drawsBackground = false
        textView.textColor = NSColor(calibratedRed: 0.96, green: 0.97, blue: 0.99, alpha: 1)
        textView.font = item.kind == "command"
            ? NSFont.monospacedSystemFont(ofSize: 12, weight: .regular)
            : NSFont.systemFont(ofSize: 13, weight: .regular)
        textView.textContainerInset = .zero
        textView.textContainer?.lineFragmentPadding = 0
        textView.textContainer?.widthTracksTextView = true
        textView.textContainer?.heightTracksTextView = false
        textView.textStorage?.setAttributedString(NSAttributedString(string: item.text, attributes: textAttributes()))
        addSubview(textView)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func preferredHeight(width: CGFloat) -> CGFloat {
        let textWidth = max(40, width - 24)
        let textHeight = max(
            CGFloat(18),
            (item.text as NSString).boundingRect(
                with: NSSize(width: textWidth, height: CGFloat.greatestFiniteMagnitude),
                options: [.usesLineFragmentOrigin, .usesFontLeading],
                attributes: textAttributes()
            ).height
        )
        return max(48, textHeight + 34)
    }

    override func layout() {
        super.layout()
        let textWidth = bounds.width - 24
        kindLabel.frame = NSRect(x: 12, y: bounds.height - 22, width: textWidth, height: 14)
        textView.frame = NSRect(x: 12, y: 10, width: textWidth, height: max(18, bounds.height - 30))
        textView.textContainer?.containerSize = NSSize(width: textWidth, height: CGFloat.greatestFiniteMagnitude)
    }

    override func draw(_ dirtyRect: NSRect) {
        bubbleColor().setFill()
        let path = NSBezierPath(roundedRect: bounds.insetBy(dx: 0.5, dy: 0.5), xRadius: 12, yRadius: 12)
        path.fill()
        borderColor().setStroke()
        path.lineWidth = 1
        path.stroke()
    }

    private func textAttributes() -> [NSAttributedString.Key: Any] {
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineBreakMode = item.kind == "command" ? .byCharWrapping : .byWordWrapping
        return [
            .font: item.kind == "command"
                ? NSFont.monospacedSystemFont(ofSize: 12, weight: .regular)
                : NSFont.systemFont(ofSize: 13, weight: .regular),
            .foregroundColor: NSColor(calibratedRed: 0.96, green: 0.97, blue: 0.99, alpha: 1),
            .paragraphStyle: paragraph
        ]
    }

    private func label(for kind: String) -> String {
        switch kind {
        case "question": return "Q"
        case "speech": return localizedText("speech", language: uiLanguage)
        case "command": return localizedText("command", language: uiLanguage)
        case "status": return localizedText("status", language: uiLanguage)
        case "error": return localizedText("error", language: uiLanguage)
        default: return kind
        }
    }

    private func bubbleColor() -> NSColor {
        if item.role == "user" {
            return NSColor(calibratedRed: 0.08, green: 0.14, blue: 0.22, alpha: 1)
        }
        if item.kind == "command" {
            return NSColor(calibratedRed: 0.07, green: 0.10, blue: 0.15, alpha: 1)
        }
        if item.kind == "error" {
            return NSColor(calibratedRed: 0.19, green: 0.07, blue: 0.10, alpha: 1)
        }
        return NSColor(calibratedRed: 0.06, green: 0.15, blue: 0.19, alpha: 1)
    }

    private func borderColor() -> NSColor {
        if item.role == "user" {
            return NSColor(calibratedRed: 0.17, green: 0.37, blue: 0.62, alpha: 1)
        }
        if item.kind == "command" {
            return NSColor(calibratedRed: 0.20, green: 0.25, blue: 0.34, alpha: 1)
        }
        if item.kind == "error" {
            return NSColor(calibratedRed: 0.62, green: 0.18, blue: 0.27, alpha: 1)
        }
        return NSColor(calibratedRed: 0.15, green: 0.38, blue: 0.44, alpha: 1)
    }
}

final class ThinkingPulseSound {
    private var timer: Timer?
    private lazy var sound: NSSound? = Self.makePulseSound() ?? NSSound(named: NSSound.Name("Glass"))
    var volume: Float = 0.32

    func setActive(_ active: Bool) {
        if active {
            guard timer == nil else { return }
            play()
            timer = Timer.scheduledTimer(withTimeInterval: 1.9, repeats: true) { [weak self] _ in
                self?.play()
            }
            return
        }

        timer?.invalidate()
        timer = nil
    }

    private func play() {
        guard let sound else { return }
        sound.stop()
        sound.volume = volume
        sound.play()
    }

    private static func makePulseSound() -> NSSound? {
        let sampleRate = 12_000
        let frameCount = Int(Double(sampleRate) * 0.12)
        var data = Data()

        appendAscii("RIFF", to: &data)
        appendUInt32(UInt32(36 + frameCount * 2), to: &data)
        appendAscii("WAVE", to: &data)
        appendAscii("fmt ", to: &data)
        appendUInt32(16, to: &data)
        appendUInt16(1, to: &data)
        appendUInt16(1, to: &data)
        appendUInt32(UInt32(sampleRate), to: &data)
        appendUInt32(UInt32(sampleRate * 2), to: &data)
        appendUInt16(2, to: &data)
        appendUInt16(16, to: &data)
        appendAscii("data", to: &data)
        appendUInt32(UInt32(frameCount * 2), to: &data)

        for index in 0..<frameCount {
            let t = Double(index) / Double(sampleRate)
            let envelope = pow(sin(Double.pi * Double(index) / Double(frameCount)), 2)
            let sample = (sin(2 * Double.pi * 392 * t) * 0.35 + sin(2 * Double.pi * 523.25 * t) * 0.20) * envelope * 0.40
            let clipped = max(-1, min(1, sample))
            appendInt16(Int16(clipped * Double(Int16.max)), to: &data)
        }

        return NSSound(data: data)
    }

    private static func appendAscii(_ string: String, to data: inout Data) {
        data.append(contentsOf: string.utf8)
    }

    private static func appendUInt16(_ value: UInt16, to data: inout Data) {
        var littleEndian = value.littleEndian
        withUnsafeBytes(of: &littleEndian) { data.append(contentsOf: $0) }
    }

    private static func appendUInt32(_ value: UInt32, to data: inout Data) {
        var littleEndian = value.littleEndian
        withUnsafeBytes(of: &littleEndian) { data.append(contentsOf: $0) }
    }

    private static func appendInt16(_ value: Int16, to data: inout Data) {
        var littleEndian = value.littleEndian
        withUnsafeBytes(of: &littleEndian) { data.append(contentsOf: $0) }
    }
}

final class HoverHelpButton: NSButton {
    var helpText = ""
    private var trackingArea: NSTrackingArea?
    private let popover = NSPopover()

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        configure(compact: false)
    }

    init(frame frameRect: NSRect, compact: Bool) {
        super.init(frame: frameRect)
        configure(compact: compact)
    }

    private func configure(compact: Bool) {
        bezelStyle = .helpButton
        if compact {
            bezelStyle = .circular
            controlSize = .small
            font = NSFont.systemFont(ofSize: 10, weight: .semibold)
            focusRingType = .none
        }
        popover.behavior = .transient
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let trackingArea {
            removeTrackingArea(trackingArea)
        }

        let next = NSTrackingArea(
            rect: bounds,
            options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect],
            owner: self,
            userInfo: nil
        )
        trackingArea = next
        addTrackingArea(next)
    }

    override func mouseEntered(with event: NSEvent) {
        showHelp()
    }

    override func mouseExited(with event: NSEvent) {
        popover.close()
    }

    private func showHelp() {
        guard !helpText.isEmpty, !popover.isShown else { return }

        let label = NSTextField(wrappingLabelWithString: helpText)
        label.textColor = NSColor(calibratedRed: 0.85, green: 0.89, blue: 0.94, alpha: 1)
        label.font = NSFont.systemFont(ofSize: 13)
        label.frame = NSRect(x: 14, y: 12, width: 310, height: 120)

        let view = NSView(frame: NSRect(x: 0, y: 0, width: 338, height: 144))
        view.wantsLayer = true
        view.layer?.backgroundColor = NSColor(calibratedRed: 0.05, green: 0.07, blue: 0.11, alpha: 1).cgColor
        view.addSubview(label)

        let controller = NSViewController()
        controller.view = view
        popover.contentViewController = controller
        popover.contentSize = view.bounds.size
        popover.show(relativeTo: bounds, of: self, preferredEdge: .maxY)
    }
}

final class FloatingHudPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

final class MenuBarCompanion {
    var uiLanguage: UiLanguage = .en {
        didSet { applyLocalization() }
    }
    private var statusItem: NSStatusItem?
    private var hudPanel: NSPanel?
    private let popover = NSPopover()
    private weak var popoverTitleLabel: NSTextField?
    private weak var popoverStopButton: NSButton?
    private weak var popoverTtsStopButton: NSButton?
    private weak var popoverMicButton: NSButton?
    private weak var popoverShowButton: NSButton?
    private weak var hudAddReferenceButton: NSButton?
    private weak var hudDirectReferenceButton: NSButton?
    private weak var hudShowReferenceButton: NSButton?
    private weak var hudClearReferenceButton: NSButton?
    private weak var hudStopButton: NSButton?
    private weak var hudTtsStopButton: NSButton?
    private weak var hudMicButton: NSButton?
    private weak var hudCameraButton: NSButton?
    private weak var hudShowButton: NSButton?
    private weak var hudCompactButton: NSButton?
    private let stateLabel = NSTextField(labelWithString: "idle")
    private let detailLabel = NSTextField(wrappingLabelWithString: "waiting for bridge")
    private let questionLabel = NSTextField(wrappingLabelWithString: "Q: none")
    private let usageLabel = NSTextField(labelWithString: "")
    private let hudCircle = AgentCircleView(frame: .zero)
    private let hudStateLabel = NSTextField(labelWithString: "idle")
    private let hudDetailLabel = NSTextField(wrappingLabelWithString: "waiting for bridge")
    private let hudQuestionLabel = NSTextField(wrappingLabelWithString: "")
    private let hudUsageLabel = NSTextField(labelWithString: "")
    private let hudContextField = NSTextField(string: "")
    private let hudContextSummary = NSTextField(labelWithString: "No references queued")
    private var onStop: (() -> Void)?
    private var onTtsStop: (() -> Void)?
    private var onShowWindow: (() -> Void)?
    private var onAddContext: ((String) -> Void)?
    private var onDirectContext: ((String) -> Void)?
    private var onClearContext: (() -> Void)?
    private var onShowContext: (() -> Void)?
    private var onMicToggle: (() -> Void)?
    private var onCameraToggle: (() -> Void)?
    private var onHudCompactChange: ((Bool) -> Void)?
    private var hudEnabled = true
    private var hudCompact = false
    private var micEnabled = true
    private var cameraEnabled = false
    private var currentState = "idle"
    private var currentDetail = "waiting for bridge"
    private var currentQuestion = ""
    private var currentQuestionReferences: [String] = []
    private var currentUsage = ""
    private var currentContextCount = 0

    func install(
        onStop: @escaping () -> Void,
        onTtsStop: @escaping () -> Void,
        onShowWindow: @escaping () -> Void,
        onAddContext: @escaping (String) -> Void,
        onDirectContext: @escaping (String) -> Void,
        onClearContext: @escaping () -> Void,
        onShowContext: @escaping () -> Void,
        onMicToggle: @escaping () -> Void,
        onCameraToggle: @escaping () -> Void,
        onHudCompactChange: @escaping (Bool) -> Void
    ) {
        self.onStop = onStop
        self.onTtsStop = onTtsStop
        self.onShowWindow = onShowWindow
        self.onAddContext = onAddContext
        self.onDirectContext = onDirectContext
        self.onClearContext = onClearContext
        self.onShowContext = onShowContext
        self.onMicToggle = onMicToggle
        self.onCameraToggle = onCameraToggle
        self.onHudCompactChange = onHudCompactChange

        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.button?.title = "VA \(compactState("idle"))"
        item.button?.target = self
        item.button?.action = #selector(togglePopover(_:))
        item.button?.toolTip = "Voice Agent"
        statusItem = item

        popover.behavior = .transient
        popover.contentViewController = NSViewController()
        popover.contentViewController?.view = makePopoverView()

        setHudEnabled(true)
    }

    func setHudEnabled(_ enabled: Bool) {
        hudEnabled = enabled
        if enabled {
            showFloatingHud()
        } else {
            hudPanel?.orderOut(nil)
        }
    }

    func setHudCompact(_ compact: Bool) {
        hudCompact = compact
        applyHudLayout()
        applyLocalization()
    }

    func updateMicEnabled(_ enabled: Bool) {
        micEnabled = enabled
        applyLocalization()
    }

    func updateCamera(_ text: String, enabled: Bool) {
        cameraEnabled = enabled
        applyLocalization()
        updateMessage(text)
    }

    func update(state: String, text: String) {
        currentState = state
        currentDetail = text
        statusItem?.button?.title = "VA \(compactState(state))"
        stateLabel.stringValue = stateText(state, language: uiLanguage)
        detailLabel.stringValue = displayText(text, state: state, language: uiLanguage)
        hudCircle.state = state
        hudCircle.statusText = stateText(state, language: uiLanguage)
        hudStateLabel.stringValue = stateText(state, language: uiLanguage)
        hudDetailLabel.stringValue = displayText(text, state: state, language: uiLanguage)
    }

    func updateQuestion(_ question: String, references: [String] = []) {
        let trimmed = question.trimmingCharacters(in: .whitespacesAndNewlines)
        currentQuestion = trimmed
        currentQuestionReferences = references
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        questionLabel.stringValue = trimmed.isEmpty ? localizedText("qNone", language: uiLanguage) : "Q: \(trimmed)"
        hudQuestionLabel.stringValue = trimmed.isEmpty ? "" : "Q: \(trimmed)"
        updateContext(Array(repeating: "", count: currentContextCount))
    }

    func updateUsage(_ usage: String) {
        let trimmed = usage.trimmingCharacters(in: .whitespacesAndNewlines)
        currentUsage = trimmed
        let value = usageText(trimmed, language: uiLanguage)
        usageLabel.stringValue = value
        hudUsageLabel.stringValue = Self.formatHudUsage(trimmed)
    }

    func updateContext(_ entries: [String]) {
        currentContextCount = entries.count
        let currentCount = currentQuestionReferences.count
        if entries.isEmpty && currentCount == 0 {
            hudContextSummary.stringValue = referenceSummary(queuedCount: 0, language: uiLanguage)
            hudContextSummary.textColor = NSColor(calibratedRed: 0.41, green: 0.47, blue: 0.55, alpha: 1)
            return
        }

        hudContextSummary.stringValue = referenceSummary(queuedCount: entries.count, currentCount: currentCount, language: uiLanguage)
        hudContextSummary.textColor = NSColor(calibratedRed: 1.0, green: 0.82, blue: 0.40, alpha: 1)
    }

    func updateMessage(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        detailLabel.stringValue = trimmed
        hudDetailLabel.stringValue = trimmed
    }

    func updateVolume(rms: CGFloat, peak: CGFloat) {
        hudCircle.rms = rms
        hudCircle.peak = peak
    }

    @objc private func togglePopover(_ sender: Any?) {
        guard let button = statusItem?.button else { return }

        if popover.isShown {
            popover.performClose(sender)
        } else {
            showFloatingHud()
            popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
        }
    }

    @objc private func stopAgent() {
        onStop?()
    }

    @objc private func stopTts() {
        onTtsStop?()
    }

    @objc private func toggleMic() {
        onMicToggle?()
    }

    @objc private func toggleCamera() {
        onCameraToggle?()
    }

    @objc private func showWindow() {
        onShowWindow?()
    }

    @objc private func addContext() {
        let text = hudContextField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        onAddContext?(text)
        if !text.isEmpty {
            hudContextField.stringValue = ""
        }
    }

    @objc private func directContext() {
        let text = hudContextField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        onDirectContext?(text)
        if !text.isEmpty {
            hudContextField.stringValue = ""
        }
    }

    @objc private func clearContext() {
        onClearContext?()
    }

    @objc private func showContext() {
        onShowContext?()
    }

    @objc private func toggleHudCompact() {
        setHudCompact(!hudCompact)
        onHudCompactChange?(hudCompact)
    }

    @objc private func showFloatingHud() {
        guard hudEnabled else { return }

        if hudPanel == nil {
            let size = hudSize()
            let panel = FloatingHudPanel(
                contentRect: NSRect(origin: .zero, size: size),
                styleMask: [.borderless, .nonactivatingPanel],
                backing: .buffered,
                defer: false
            )
            panel.isOpaque = false
            panel.backgroundColor = .clear
            panel.hasShadow = true
            panel.isMovableByWindowBackground = true
            panel.contentView = makeHudView()
            hudPanel = panel
        }

        configureHudPanel()
        applyHudLayout()
        positionHud()
        if let panel = hudPanel {
            panel.orderFrontRegardless()
        }
    }

    private func configureHudPanel() {
        guard let panel = hudPanel else { return }

        panel.isFloatingPanel = true
        panel.level = .floating
        panel.collectionBehavior = [
            .canJoinAllSpaces,
            .fullScreenAuxiliary,
            .stationary
        ]
        panel.hidesOnDeactivate = false
    }

    private func hudSize() -> NSSize {
        hudCompact ? NSSize(width: 116, height: 116) : NSSize(width: 326, height: 264)
    }

    private func resizeHudPanel(anchoredToTopRight: Bool) {
        guard let panel = hudPanel else { return }

        let size = hudSize()
        let currentFrame = panel.frame
        let origin = anchoredToTopRight
            ? NSPoint(x: currentFrame.maxX - size.width, y: currentFrame.maxY - size.height)
            : currentFrame.origin
        panel.setFrame(NSRect(origin: origin, size: size), display: true)
        panel.contentView?.frame = NSRect(origin: .zero, size: size)
    }

    private func applyHudLayout() {
        guard let contentView = hudPanel?.contentView else { return }

        let size = hudSize()
        resizeHudPanel(anchoredToTopRight: true)
        contentView.layer?.cornerRadius = hudCompact ? 20 : 16
        contentView.frame = NSRect(origin: .zero, size: size)

        hudCircle.compactStatusStyle = true
        hudCircle.frame = hudCompact
            ? NSRect(x: 12, y: 12, width: 92, height: 92)
            : NSRect(x: 14, y: 132, width: 110, height: 110)

        hudStateLabel.isHidden = hudCompact
        hudDetailLabel.isHidden = hudCompact
        hudQuestionLabel.isHidden = hudCompact
        hudUsageLabel.isHidden = hudCompact
        hudContextSummary.isHidden = hudCompact
        hudContextField.isHidden = hudCompact
        hudAddReferenceButton?.isHidden = hudCompact
        hudDirectReferenceButton?.isHidden = hudCompact
        hudShowReferenceButton?.isHidden = hudCompact
        hudClearReferenceButton?.isHidden = hudCompact
        hudStopButton?.isHidden = hudCompact
        hudTtsStopButton?.isHidden = hudCompact
        hudMicButton?.isHidden = hudCompact
        hudCameraButton?.isHidden = hudCompact
        hudShowButton?.isHidden = hudCompact

        hudCompactButton?.frame = hudCompact
            ? NSRect(x: 86, y: 86, width: 24, height: 22)
            : NSRect(x: 294, y: 230, width: 24, height: 22)
        hudCompactButton?.title = hudCompact ? "↗" : "−"
        hudCompactButton?.toolTip = localizedText(hudCompact ? "restoreHud" : "compactHud", language: uiLanguage)
    }

    private func positionHud() {
        guard let panel = hudPanel else { return }

        resizeHudPanel(anchoredToTopRight: false)
        let screenFrame = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let margin: CGFloat = 18
        let frame = NSRect(
            x: screenFrame.maxX - panel.frame.width - margin,
            y: screenFrame.maxY - panel.frame.height - margin,
            width: panel.frame.width,
            height: panel.frame.height
        )
        panel.setFrame(frame, display: true)
    }

    private func makePopoverView() -> NSView {
        let view = NSView(frame: NSRect(x: 0, y: 0, width: 320, height: 204))
        view.wantsLayer = true
        view.layer?.backgroundColor = NSColor(calibratedRed: 0.05, green: 0.07, blue: 0.11, alpha: 1).cgColor

        let title = NSTextField(labelWithString: "Voice Agent")
        popoverTitleLabel = title
        title.font = NSFont.systemFont(ofSize: 16, weight: .bold)
        title.textColor = NSColor(calibratedRed: 0.88, green: 0.92, blue: 0.97, alpha: 1)
        title.frame = NSRect(x: 16, y: 166, width: 288, height: 22)
        view.addSubview(title)

        stateLabel.font = NSFont.monospacedSystemFont(ofSize: 12, weight: .medium)
        stateLabel.textColor = NSColor(calibratedRed: 0.53, green: 0.78, blue: 1.0, alpha: 1)
        stateLabel.frame = NSRect(x: 16, y: 142, width: 288, height: 18)
        view.addSubview(stateLabel)

        detailLabel.font = NSFont.systemFont(ofSize: 12)
        detailLabel.textColor = NSColor(calibratedRed: 0.82, green: 0.87, blue: 0.94, alpha: 1)
        detailLabel.frame = NSRect(x: 16, y: 94, width: 288, height: 44)
        view.addSubview(detailLabel)

        questionLabel.font = NSFont.systemFont(ofSize: 12)
        questionLabel.textColor = NSColor(calibratedRed: 0.62, green: 0.69, blue: 0.78, alpha: 1)
        questionLabel.frame = NSRect(x: 16, y: 66, width: 288, height: 24)
        view.addSubview(questionLabel)

        usageLabel.font = NSFont.monospacedSystemFont(ofSize: 10, weight: .medium)
        usageLabel.textColor = NSColor(calibratedRed: 0.72, green: 0.82, blue: 0.94, alpha: 1)
        usageLabel.frame = NSRect(x: 16, y: 48, width: 288, height: 14)
        view.addSubview(usageLabel)

        let stop = NSButton(title: "STOP", target: self, action: #selector(stopAgent))
        popoverStopButton = stop
        stop.frame = NSRect(x: 16, y: 14, width: 76, height: 28)
        view.addSubview(stop)

        let ttsStop = NSButton(title: localizedText("ttsStop", language: uiLanguage), target: self, action: #selector(stopTts))
        popoverTtsStopButton = ttsStop
        ttsStop.frame = NSRect(x: 96, y: 14, width: 72, height: 28)
        view.addSubview(ttsStop)

        let mic = NSButton(title: localizedText(micEnabled ? "micOff" : "micOn", language: uiLanguage), target: self, action: #selector(toggleMic))
        popoverMicButton = mic
        mic.frame = NSRect(x: 176, y: 14, width: 62, height: 28)
        view.addSubview(mic)

        let show = NSButton(title: localizedText("show", language: uiLanguage), target: self, action: #selector(showWindow))
        popoverShowButton = show
        show.frame = NSRect(x: 246, y: 14, width: 58, height: 28)
        view.addSubview(show)
        applyLocalization()

        return view
    }

    private func makeHudView() -> NSView {
        let view = NSView(frame: NSRect(x: 0, y: 0, width: 326, height: 264))
        view.wantsLayer = true
        view.layer?.cornerRadius = 16
        view.layer?.borderWidth = 1
        view.layer?.borderColor = NSColor(calibratedRed: 0.18, green: 0.26, blue: 0.36, alpha: 0.86).cgColor
        view.layer?.backgroundColor = NSColor(calibratedRed: 0.03, green: 0.05, blue: 0.08, alpha: 0.88).cgColor

        hudCircle.compactStatusStyle = true
        hudCircle.frame = NSRect(x: 14, y: 132, width: 110, height: 110)
        view.addSubview(hudCircle)

        hudStateLabel.font = NSFont.monospacedSystemFont(ofSize: 12, weight: .semibold)
        hudStateLabel.textColor = NSColor(calibratedRed: 0.53, green: 0.78, blue: 1.0, alpha: 1)
        hudStateLabel.frame = NSRect(x: 140, y: 220, width: 168, height: 18)
        view.addSubview(hudStateLabel)

        hudDetailLabel.font = NSFont.systemFont(ofSize: 12)
        hudDetailLabel.textColor = NSColor(calibratedRed: 0.86, green: 0.90, blue: 0.96, alpha: 1)
        hudDetailLabel.frame = NSRect(x: 140, y: 166, width: 168, height: 50)
        view.addSubview(hudDetailLabel)

        hudQuestionLabel.font = NSFont.systemFont(ofSize: 11)
        hudQuestionLabel.textColor = NSColor(calibratedRed: 0.62, green: 0.69, blue: 0.78, alpha: 1)
        hudQuestionLabel.frame = NSRect(x: 140, y: 136, width: 168, height: 26)
        view.addSubview(hudQuestionLabel)

        hudUsageLabel.font = NSFont.monospacedSystemFont(ofSize: 10, weight: .medium)
        hudUsageLabel.textColor = NSColor(calibratedRed: 0.72, green: 0.82, blue: 0.94, alpha: 1)
        hudUsageLabel.lineBreakMode = .byWordWrapping
        hudUsageLabel.maximumNumberOfLines = 2
        hudUsageLabel.cell?.wraps = true
        hudUsageLabel.cell?.isScrollable = false
        hudUsageLabel.frame = NSRect(x: 14, y: 8, width: 298, height: 32)
        view.addSubview(hudUsageLabel)

        hudContextSummary.font = NSFont.systemFont(ofSize: 10)
        hudContextSummary.textColor = NSColor(calibratedRed: 0.41, green: 0.47, blue: 0.55, alpha: 1)
        hudContextSummary.frame = NSRect(x: 14, y: 106, width: 298, height: 16)
        view.addSubview(hudContextSummary)

        hudContextField.placeholderString = localizedText("referenceText", language: uiLanguage)
        hudContextField.font = NSFont.systemFont(ofSize: 11)
        hudContextField.isEditable = true
        hudContextField.isSelectable = true
        hudContextField.target = self
        hudContextField.action = #selector(addContext)
        hudContextField.frame = NSRect(x: 14, y: 80, width: 100, height: 22)
        view.addSubview(hudContextField)

        let addReference = NSButton(title: localizedText("add", language: uiLanguage), target: self, action: #selector(addContext))
        hudAddReferenceButton = addReference
        addReference.frame = NSRect(x: 120, y: 78, width: 42, height: 26)
        view.addSubview(addReference)

        let directReference = NSButton(title: localizedText("directGo", language: uiLanguage), target: self, action: #selector(directContext))
        hudDirectReferenceButton = directReference
        directReference.frame = NSRect(x: 166, y: 78, width: 42, height: 26)
        view.addSubview(directReference)

        let showReference = NSButton(title: localizedText("refs", language: uiLanguage), target: self, action: #selector(showContext))
        hudShowReferenceButton = showReference
        showReference.frame = NSRect(x: 212, y: 78, width: 42, height: 26)
        view.addSubview(showReference)

        let clearReference = NSButton(title: localizedText("clear", language: uiLanguage), target: self, action: #selector(clearContext))
        hudClearReferenceButton = clearReference
        clearReference.frame = NSRect(x: 258, y: 78, width: 54, height: 26)
        view.addSubview(clearReference)

        let stop = NSButton(title: localizedText("stop", language: uiLanguage), target: self, action: #selector(stopAgent))
        hudStopButton = stop
        stop.frame = NSRect(x: 14, y: 48, width: 66, height: 26)
        view.addSubview(stop)

        let ttsStop = NSButton(title: localizedText("tts", language: uiLanguage), target: self, action: #selector(stopTts))
        hudTtsStopButton = ttsStop
        ttsStop.frame = NSRect(x: 84, y: 48, width: 50, height: 26)
        view.addSubview(ttsStop)

        let mic = NSButton(title: localizedText(micEnabled ? "micOff" : "micOn", language: uiLanguage), target: self, action: #selector(toggleMic))
        hudMicButton = mic
        mic.frame = NSRect(x: 142, y: 48, width: 44, height: 26)
        view.addSubview(mic)

        let camera = NSButton(title: localizedText(cameraEnabled ? "cameraOff" : "cameraOn", language: uiLanguage), target: self, action: #selector(toggleCamera))
        hudCameraButton = camera
        camera.frame = NSRect(x: 194, y: 48, width: 44, height: 26)
        view.addSubview(camera)

        let show = NSButton(title: localizedText("show", language: uiLanguage), target: self, action: #selector(showWindow))
        hudShowButton = show
        show.frame = NSRect(x: 246, y: 48, width: 58, height: 26)
        view.addSubview(show)

        let compact = NSButton(title: "−", target: self, action: #selector(toggleHudCompact))
        compact.bezelStyle = .roundRect
        compact.isBordered = false
        compact.font = NSFont.systemFont(ofSize: 14, weight: .semibold)
        compact.contentTintColor = NSColor(calibratedRed: 0.72, green: 0.82, blue: 0.94, alpha: 1)
        hudCompactButton = compact
        view.addSubview(compact)
        applyLocalization()
        applyHudLayout()

        return view
    }

    private func compactState(_ state: String) -> String {
        switch state {
        case "approval_pending": return localizedText("approvalCompact", language: uiLanguage)
        case "stt_processing": return "stt"
        case "wake_rejected": return localizedText("rejectedCompact", language: uiLanguage)
        case "wake_matched": return localizedText("wakeCompact", language: uiLanguage)
        default: return state
        }
    }

    private func applyLocalization() {
        popoverTitleLabel?.stringValue = "Voice Agent"
        popoverStopButton?.title = localizedText("stop", language: uiLanguage)
        popoverTtsStopButton?.title = localizedText("ttsStop", language: uiLanguage)
        popoverMicButton?.title = localizedText(micEnabled ? "micOff" : "micOn", language: uiLanguage)
        popoverShowButton?.title = localizedText("show", language: uiLanguage)
        hudAddReferenceButton?.title = localizedText("add", language: uiLanguage)
        hudDirectReferenceButton?.title = localizedText("directGo", language: uiLanguage)
        hudShowReferenceButton?.title = localizedText("refs", language: uiLanguage)
        hudClearReferenceButton?.title = localizedText("clear", language: uiLanguage)
        hudStopButton?.title = localizedText("stop", language: uiLanguage)
        hudTtsStopButton?.title = localizedText("tts", language: uiLanguage)
        hudMicButton?.title = localizedText(micEnabled ? "micOff" : "micOn", language: uiLanguage)
        hudMicButton?.toolTip = localizedText(micEnabled ? "micOff" : "micOn", language: uiLanguage)
        hudCameraButton?.title = localizedText(cameraEnabled ? "cameraOff" : "cameraOn", language: uiLanguage)
        hudCameraButton?.toolTip = localizedText(cameraEnabled ? "cameraTurnOff" : "cameraTurnOn", language: uiLanguage)
        hudShowButton?.title = localizedText("show", language: uiLanguage)
        hudCompactButton?.toolTip = localizedText(hudCompact ? "restoreHud" : "compactHud", language: uiLanguage)
        hudContextField.placeholderString = localizedText("referenceText", language: uiLanguage)
        update(state: currentState, text: currentDetail)
        updateQuestion(currentQuestion, references: currentQuestionReferences)
        updateUsage(currentUsage)
        updateContext(Array(repeating: "", count: currentContextCount))
    }

    private static func formatHudUsage(_ usage: String) -> String {
        let trimmed = usage.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "" }

        let parts = trimmed
            .components(separatedBy: " · ")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        guard !parts.isEmpty else { return trimmed }

        return parts.joined(separator: "\n")
    }
}

final class PopupPanelController: NSObject {
    private var panel: NSPanel?
    private let scrollView = NSScrollView(frame: .zero)
    private let textView = NSTextView(frame: .zero)
    private let webView = WKWebView(frame: .zero)
    private let toggleButton = NSButton(title: "", target: nil, action: nil)
    private let copyButton = NSButton(title: "", target: nil, action: nil)
    private let closeButton = NSButton(title: "", target: nil, action: nil)
    private var rawText = ""
    private var showingRaw = false
    private var currentLanguage: UiLanguage = .en

    func show(title: String, text: String, format: String, language: UiLanguage) {
        currentLanguage = language
        rawText = text.trimmingCharacters(in: .whitespacesAndNewlines)
        showingRaw = format == "plain"
        ensurePanel()
        updateLocalization()
        renderContent()
        panel?.title = title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? localizedText("popup", language: language)
            : title.trimmingCharacters(in: .whitespacesAndNewlines)
        panel?.orderFront(nil)
    }

    func updateLanguage(_ language: UiLanguage) {
        currentLanguage = language
        updateLocalization()
    }

    private func ensurePanel() {
        guard panel == nil else { return }

        let size = NSSize(width: 640, height: 480)
        let window = NSPanel(
            contentRect: NSRect(origin: .zero, size: size),
            styleMask: [.titled, .closable, .resizable, .utilityWindow],
            backing: .buffered,
            defer: false
        )
        window.isReleasedWhenClosed = false
        window.level = .floating
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        window.hidesOnDeactivate = false
        window.minSize = NSSize(width: 420, height: 260)

        let content = NSView(frame: NSRect(origin: .zero, size: size))
        content.autoresizingMask = [.width, .height]
        content.wantsLayer = true
        content.layer?.backgroundColor = NSColor(calibratedRed: 0.05, green: 0.07, blue: 0.11, alpha: 0.96).cgColor

        scrollView.frame = NSRect(x: 16, y: 58, width: size.width - 32, height: size.height - 74)
        scrollView.autoresizingMask = [.width, .height]
        scrollView.hasVerticalScroller = true
        scrollView.drawsBackground = false

        textView.frame = scrollView.bounds
        textView.autoresizingMask = [.width, .height]
        textView.isEditable = false
        textView.isSelectable = true
        textView.drawsBackground = true
        textView.backgroundColor = NSColor(calibratedRed: 0.07, green: 0.10, blue: 0.15, alpha: 1)
        textView.textColor = NSColor(calibratedRed: 0.91, green: 0.94, blue: 0.98, alpha: 1)
        textView.textContainerInset = NSSize(width: 14, height: 14)
        textView.textContainer?.widthTracksTextView = true
        scrollView.documentView = textView
        content.addSubview(scrollView)

        webView.frame = scrollView.frame
        webView.autoresizingMask = [.width, .height]
        webView.wantsLayer = true
        webView.layer?.backgroundColor = NSColor(calibratedRed: 0.07, green: 0.10, blue: 0.15, alpha: 1).cgColor
        webView.setValue(false, forKey: "drawsBackground")
        content.addSubview(webView)

        toggleButton.target = self
        toggleButton.action = #selector(toggleMode)
        toggleButton.frame = NSRect(x: 16, y: 18, width: 112, height: 28)
        content.addSubview(toggleButton)

        copyButton.target = self
        copyButton.action = #selector(copyText)
        copyButton.frame = NSRect(x: 136, y: 18, width: 84, height: 28)
        content.addSubview(copyButton)

        closeButton.target = self
        closeButton.action = #selector(close)
        closeButton.frame = NSRect(x: size.width - 100, y: 18, width: 84, height: 28)
        closeButton.autoresizingMask = [.minXMargin]
        content.addSubview(closeButton)

        window.contentView = content
        panel = window
    }

    private func updateLocalization() {
        toggleButton.title = localizedText(showingRaw ? "markdownView" : "plainText", language: currentLanguage)
        copyButton.title = localizedText("copy", language: currentLanguage)
        closeButton.title = localizedText("ok", language: currentLanguage)
    }

    private func renderContent() {
        updateLocalization()
        if showingRaw {
            webView.isHidden = true
            scrollView.isHidden = false
            textView.font = NSFont.monospacedSystemFont(ofSize: 13, weight: .regular)
            textView.string = rawText
            return
        }

        scrollView.isHidden = true
        webView.isHidden = false
        webView.loadHTMLString(popupHtmlDocument(rawText), baseURL: katexDistDirectory())
    }

    @objc private func toggleMode() {
        showingRaw.toggle()
        renderContent()
    }

    @objc private func copyText() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(rawText, forType: .string)
    }

    @objc private func close() {
        panel?.orderOut(nil)
    }
}

private func popupHtmlDocument(_ markdown: String) -> String {
    let body = markdownBodyHtml(markdown)
    let assets = katexAssetTags()
    return #"""
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
\#(assets)
<style>
:root {
  color-scheme: dark;
  background: #111827;
  color: #e5edf8;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
}
body {
  margin: 0;
  padding: 18px 20px 28px;
  background: #111827;
  color: #e5edf8;
  font-size: 14px;
  line-height: 1.58;
}
h1, h2, h3 {
  margin: 18px 0 10px;
  line-height: 1.25;
  color: #f5f8ff;
}
h1 { font-size: 24px; }
h2 { font-size: 20px; }
h3 { font-size: 17px; }
p {
  margin: 9px 0;
}
.bullet {
  padding-left: 1.1em;
  text-indent: -1.1em;
}
.spacer {
  height: 8px;
}
pre {
  overflow-x: auto;
  margin: 12px 0;
  padding: 12px;
  border-radius: 8px;
  background: #0b1220;
  color: #d7e4f5;
}
code {
  font-family: "SF Mono", Menlo, Consolas, monospace;
  font-size: 13px;
}
.katex-display {
  overflow-x: auto;
  overflow-y: hidden;
  padding: 4px 0;
}
</style>
</head>
<body>
\#(body)
<script>
if (window.renderMathInElement) {
  renderMathInElement(document.body, {
    delimiters: [
      {left: "$$", right: "$$", display: true},
      {left: "\\[", right: "\\]", display: true},
      {left: "\\(", right: "\\)", display: false},
      {left: "$", right: "$", display: false}
    ],
    ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code"],
    throwOnError: false,
    strict: "warn"
  });
}
</script>
</body>
</html>
"""#
}

private func markdownBodyHtml(_ markdown: String) -> String {
    var output: [String] = []
    var inCodeBlock = false

    for line in markdown.components(separatedBy: .newlines) {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        if trimmed.hasPrefix("```") {
            if inCodeBlock {
                output.append("</code></pre>")
            } else {
                output.append("<pre><code>")
            }
            inCodeBlock.toggle()
            continue
        }

        if inCodeBlock {
            output.append(htmlEscaped(line))
            continue
        }

        if trimmed.isEmpty {
            output.append("<div class=\"spacer\"></div>")
        } else if trimmed.hasPrefix("### ") {
            output.append("<h3>\(htmlEscaped(String(trimmed.dropFirst(4))))</h3>")
        } else if trimmed.hasPrefix("## ") {
            output.append("<h2>\(htmlEscaped(String(trimmed.dropFirst(3))))</h2>")
        } else if trimmed.hasPrefix("# ") {
            output.append("<h1>\(htmlEscaped(String(trimmed.dropFirst(2))))</h1>")
        } else if trimmed.hasPrefix("- ") || trimmed.hasPrefix("* ") {
            output.append("<p class=\"bullet\">&bull; \(htmlEscaped(String(trimmed.dropFirst(2))))</p>")
        } else {
            output.append("<p>\(htmlEscaped(line))</p>")
        }
    }

    if inCodeBlock {
        output.append("</code></pre>")
    }

    return output.joined(separator: "\n")
}

private func htmlEscaped(_ value: String) -> String {
    value
        .replacingOccurrences(of: "&", with: "&amp;")
        .replacingOccurrences(of: "<", with: "&lt;")
        .replacingOccurrences(of: ">", with: "&gt;")
        .replacingOccurrences(of: "\"", with: "&quot;")
        .replacingOccurrences(of: "'", with: "&#39;")
}

private func katexAssetTags() -> String {
    guard let directory = katexDistDirectory() else { return "" }
    let css = directory.appendingPathComponent("katex.min.css").absoluteString
    let script = directory.appendingPathComponent("katex.min.js").absoluteString
    let autoRender = directory.appendingPathComponent("contrib/auto-render.min.js").absoluteString
    return #"""
<link rel="stylesheet" href="\#(css)">
<script src="\#(script)"></script>
<script src="\#(autoRender)"></script>
"""#
}

private func katexDistDirectory() -> URL? {
    let fileManager = FileManager.default
    let roots = [
        URL(fileURLWithPath: fileManager.currentDirectoryPath),
        URL(fileURLWithPath: #filePath).deletingLastPathComponent()
    ]

    for root in roots {
        var current = root
        for _ in 0..<8 {
            let candidate = current
                .appendingPathComponent("node_modules", isDirectory: true)
                .appendingPathComponent("katex", isDirectory: true)
                .appendingPathComponent("dist", isDirectory: true)
            if fileManager.fileExists(atPath: candidate.appendingPathComponent("katex.min.css").path),
               fileManager.fileExists(atPath: candidate.appendingPathComponent("katex.min.js").path),
               fileManager.fileExists(atPath: candidate.appendingPathComponent("contrib/auto-render.min.js").path) {
                return candidate
            }

            let parent = current.deletingLastPathComponent()
            if parent.path == current.path { break }
            current = parent
        }
    }

    return nil
}

private func markdownAttributedString(_ markdown: String) -> NSAttributedString {
    let output = NSMutableAttributedString()
    var inCodeBlock = false
    let paragraph = NSMutableParagraphStyle()
    paragraph.lineSpacing = 4

    for line in markdown.components(separatedBy: .newlines) {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        if trimmed.hasPrefix("```") {
            inCodeBlock.toggle()
            continue
        }

        let font: NSFont
        let color: NSColor
        let text: String

        if inCodeBlock {
            font = NSFont.monospacedSystemFont(ofSize: 13, weight: .regular)
            color = NSColor(calibratedRed: 0.79, green: 0.87, blue: 0.96, alpha: 1)
            text = line
        } else if trimmed.hasPrefix("### ") {
            font = NSFont.systemFont(ofSize: 15, weight: .semibold)
            color = NSColor(calibratedRed: 0.88, green: 0.92, blue: 0.98, alpha: 1)
            text = String(trimmed.dropFirst(4))
        } else if trimmed.hasPrefix("## ") {
            font = NSFont.systemFont(ofSize: 17, weight: .semibold)
            color = NSColor(calibratedRed: 0.90, green: 0.94, blue: 1.0, alpha: 1)
            text = String(trimmed.dropFirst(3))
        } else if trimmed.hasPrefix("# ") {
            font = NSFont.systemFont(ofSize: 20, weight: .bold)
            color = NSColor(calibratedRed: 0.94, green: 0.97, blue: 1.0, alpha: 1)
            text = String(trimmed.dropFirst(2))
        } else {
            font = NSFont.systemFont(ofSize: 14, weight: .regular)
            color = NSColor(calibratedRed: 0.91, green: 0.94, blue: 0.98, alpha: 1)
            text = line
        }

        output.append(NSAttributedString(
            string: "\(text)\n",
            attributes: [
                .font: font,
                .foregroundColor: color,
                .paragraphStyle: paragraph
            ]
        ))
    }

    return output
}

final class VisualAppDelegate: NSObject, NSApplicationDelegate, NSTextFieldDelegate {
    private let bridgeUrl: String
    private let circleView = AgentCircleView(frame: .zero)
    private weak var rootView: VisualRootView?
    private var mainWindow: NSWindow?
    private let menuBarCompanion = MenuBarCompanion()
    private let popupPanel = PopupPanelController()
    private let commandView = NSTextView(frame: .zero)
    private let contextField = NSTextField(string: "")
    private let contextSummary = NSTextField(labelWithString: "No references queued")
    private let thinkingPulseSound = ThinkingPulseSound()
    private var webSocket: URLSessionWebSocketTask?
    private var commands: [String] = []
    private var contextEntries: [String] = []
    private var currentQuestionReferences: [String] = []
    private var settingsWindow: NSWindow?
    private let settingsLanguagePopup = NSPopUpButton(frame: .zero, pullsDown: false)
    private let settingsGenderPopup = NSPopUpButton(frame: .zero, pullsDown: false)
    private let settingsVoiceField = NSTextField(string: "")
    private let settingsRateField = NSTextField(string: "0.56")
    private let settingsPitchField = NSTextField(string: "1.00")
    private let settingsVolumeField = NSTextField(string: "1.00")
    private let settingsThinkingVolumeField = NSTextField(string: "0.32")
    private let settingsMaxUtteranceField = NSTextField(string: "15")
    private let settingsChatHistoryCheckbox = NSButton(checkboxWithTitle: "Show Recent Q/A panel", target: nil, action: nil)
    private let settingsHudCheckbox = NSButton(checkboxWithTitle: "Show floating HUD", target: nil, action: nil)
    private let settingsPopupPreferredCheckbox = NSButton(checkboxWithTitle: "Prefer popup for long answers", target: nil, action: nil)
    private let settingsWakeRejectedWarningCheckbox = NSButton(checkboxWithTitle: "Speak wake warning", target: nil, action: nil)
    private let settingsNewThreadCheckbox = NSButton(checkboxWithTitle: "Always start new thread", target: nil, action: nil)
    private let settingsCodexThreadField = NSTextField(string: "")
    private let settingsWakePhrasesView = NSTextView(frame: .zero)
    private let settingsApprovalOncePhrasesView = NSTextView(frame: .zero)
    private let settingsApprovalDenyPhrasesView = NSTextView(frame: .zero)
    private let settingsApprovalSessionPhrasesView = NSTextView(frame: .zero)
    private let settingsApprovalPolicyPhrasesView = NSTextView(frame: .zero)
    private let settingsApprovalNetworkPolicyPhrasesView = NSTextView(frame: .zero)
    private let settingsGestureWakePopup = NSPopUpButton(frame: .zero, pullsDown: false)
    private let settingsGestureStopPopup = NSPopUpButton(frame: .zero, pullsDown: false)
    private let settingsGestureApprovalOncePopup = NSPopUpButton(frame: .zero, pullsDown: false)
    private let settingsGestureApprovalDenyPopup = NSPopUpButton(frame: .zero, pullsDown: false)
    private let settingsGestureApprovalSessionPopup = NSPopUpButton(frame: .zero, pullsDown: false)
    private let settingsGestureApprovalPolicyPopup = NSPopUpButton(frame: .zero, pullsDown: false)
    private let settingsGestureRunningModePopup = NSPopUpButton(frame: .zero, pullsDown: false)
    private let settingsCustomGestureNameField = NSTextField(string: "")
    private let settingsCustomGestureCaptureButton = NSButton(title: "Capture", target: nil, action: nil)
    private let settingsCustomGestureClearButton = NSButton(title: "Clear", target: nil, action: nil)
    private var ttsLanguage = "auto"
    private var ttsGender = "auto"
    private var ttsVoiceName = ""
    private var ttsRate = 0.56
    private var ttsPitch = 1.0
    private var ttsVolume = 1.0
    private var thinkingVolume = 0.32
    private var maxUtteranceSeconds = 15.0
    private var responseLanguage = "auto"
    private var chatHistoryEnabled = true
    private var hudEnabled = true
    private var hudCompact = false
    private var popupPreferred = false
    private var micEnabled = true
    private var cameraEnabled = false
    private var speakWakeRejectedWarnings = true
    private var codexAlwaysStartNewThread = false
    private var wakePhrases: [String] = []
    private var approvalOncePhrases: [String] = []
    private var approvalDenyPhrases: [String] = []
    private var approvalSessionPhrases: [String] = []
    private var approvalPolicyPhrases: [String] = []
    private var approvalNetworkPolicyPhrases: [String] = []
    private var gestureWakeBindings: [String: String] = [
        "wake": "open_palm",
        "stop": "thumbs_down"
    ]
    private var gestureRunningMode = "off"
    private var customGestureTemplates: [[String: Any]] = []
    private var codexThreadId = ""
    private var uiLanguage: UiLanguage = .en
    private var uiLanguageInitialized = false

    init(bridgeUrl: String) {
        self.bridgeUrl = bridgeUrl
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        installMainMenu()
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 520, height: 680),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Voice Agent"
        window.center()
        window.contentView = buildContentView()
        mainWindow = window
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        menuBarCompanion.install(
            onStop: { [weak self] in self?.sendControl("emergency_stop") },
            onTtsStop: { [weak self] in self?.sendControl("tts_stop") },
            onShowWindow: { [weak self] in self?.showMainWindow() },
            onAddContext: { [weak self] text in self?.submitContext(text) },
            onDirectContext: { [weak self] text in self?.submitDirectContext(text) },
            onClearContext: { [weak self] in self?.clearContext() },
            onShowContext: { [weak self] in self?.showContext() },
            onMicToggle: { [weak self] in self?.toggleMicInput() },
            onCameraToggle: { [weak self] in self?.toggleCameraInput() },
            onHudCompactChange: { [weak self] compact in self?.updateHudCompact(compact, sendSettings: true) }
        )
        menuBarCompanion.uiLanguage = uiLanguage
        menuBarCompanion.updateMicEnabled(micEnabled)
        menuBarCompanion.setHudCompact(hudCompact)
        connect()
    }

    private func installMainMenu() {
        let mainMenu = NSMenu()
        let appItem = NSMenuItem()
        let editItem = NSMenuItem()
        mainMenu.addItem(appItem)
        mainMenu.addItem(editItem)

        let appMenu = NSMenu()
        appMenu.addItem(NSMenuItem(title: localizedText("quitVoiceAgent", language: uiLanguage), action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        appItem.submenu = appMenu

        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(NSMenuItem(title: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x"))
        editMenu.addItem(NSMenuItem(title: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c"))
        editMenu.addItem(NSMenuItem(title: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v"))
        editMenu.addItem(NSMenuItem.separator())
        editMenu.addItem(NSMenuItem(title: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a"))
        editItem.submenu = editMenu

        NSApp.mainMenu = mainMenu
    }

    private func buildContentView() -> NSView {
        let controls = NSStackView()
        controls.addArrangedSubview(emergencyButton())
        controls.addArrangedSubview(button(localizedText("settings", language: uiLanguage), action: #selector(showSettings)))
        controls.addArrangedSubview(button(localizedText("ttsStop", language: uiLanguage), action: #selector(stopTts)))
        controls.addArrangedSubview(button(localizedText(micEnabled ? "micOff" : "micOn", language: uiLanguage), action: #selector(toggleMicInput)))
        controls.addArrangedSubview(button(localizedText(cameraEnabled ? "cameraOff" : "cameraOn", language: uiLanguage), action: #selector(toggleCameraInput)))
        controls.addArrangedSubview(button(localizedText("clearCmds", language: uiLanguage), action: #selector(clearCommands)))
        controls.addArrangedSubview(button(localizedText("exit", language: uiLanguage), action: #selector(exitVisual)))

        contextField.target = self
        contextField.action = #selector(addContext)

        let rootView = VisualRootView(
            circleView: circleView,
            commandView: commandView,
            contextField: contextField,
            contextSummary: contextSummary,
            addContextButton: button(localizedText("add", language: uiLanguage), action: #selector(addContext)),
            directContextButton: button(localizedText("directGo", language: uiLanguage), action: #selector(directContext)),
            clearContextButton: button(localizedText("clearRef", language: uiLanguage), action: #selector(clearContext)),
            showContextButton: button(localizedText("refs", language: uiLanguage), action: #selector(showContext)),
            controls: controls
        )
        rootView.uiLanguage = uiLanguage
        self.rootView = rootView
        rootView.updateSessionId(codexThreadId)
        rootView.updateChatHistory(enabled: chatHistoryEnabled)
        rootView.updateMicEnabled(micEnabled)
        rootView.updateCameraEnabled(cameraEnabled)
        return rootView
    }

    private func showMainWindow() {
        mainWindow?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func button(_ title: String, action: Selector) -> NSButton {
        let button = NSButton(title: title, target: self, action: action)
        button.bezelStyle = .rounded
        return button
    }

    private func emergencyButton() -> NSButton {
        let button = button(localizedText("stop", language: uiLanguage), action: #selector(emergencyStop))
        button.attributedTitle = NSAttributedString(
            string: localizedText("stop", language: uiLanguage),
            attributes: [
                .foregroundColor: NSColor.systemRed,
                .font: NSFont.systemFont(ofSize: NSFont.systemFontSize, weight: .bold)
            ]
        )
        return button
    }

    private func connect() {
        guard let url = URL(string: bridgeUrl), !bridgeUrl.isEmpty else {
            circleView.statusText = localizedText("waitingForBridge", language: uiLanguage)
            menuBarCompanion.update(state: circleView.state, text: circleView.statusText)
            return
        }

        circleView.statusText = localizedText("connecting", language: uiLanguage)
        menuBarCompanion.update(state: circleView.state, text: circleView.statusText)
        let task = URLSession.shared.webSocketTask(with: url)
        webSocket = task
        task.resume()
        circleView.statusText = localizedText("connected", language: uiLanguage)
        menuBarCompanion.update(state: circleView.state, text: circleView.statusText)
        receiveNext()
    }

    private func receiveNext() {
        webSocket?.receive { [weak self] result in
            guard let self else { return }

            switch result {
            case .success(let message):
                if case .string(let text) = message {
                    DispatchQueue.main.async { self.handleMessage(text) }
                }
                self.receiveNext()
            case .failure:
                DispatchQueue.main.async {
                    self.circleView.state = "error"
                    self.circleView.statusText = localizedText("bridgeDisconnected", language: self.uiLanguage)
                    self.menuBarCompanion.update(state: "error", text: self.circleView.statusText)
                    self.thinkingPulseSound.setActive(false)
                }
            }
        }
    }

    private func handleMessage(_ text: String) {
        guard
            let data = text.data(using: .utf8),
            let event = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            event["op"] as? String == "voice-agent-ui",
            let type = event["type"] as? String
        else { return }

        switch type {
        case "state":
            circleView.state = event["state"] as? String ?? "idle"
            circleView.statusText = displayText(event["text"] as? String ?? "", state: circleView.state, language: uiLanguage)
            menuBarCompanion.update(state: circleView.state, text: circleView.statusText)
            if circleView.state == "wake_rejected" {
                circleView.glow = 1
                DispatchQueue.main.asyncAfter(deadline: .now() + 3.6) { [weak self] in
                    guard let self, self.circleView.state == "wake_rejected" else { return }
                    self.circleView.state = "idle"
                    self.circleView.statusText = stateText("idle", language: self.uiLanguage)
                    self.menuBarCompanion.update(state: "idle", text: self.circleView.statusText)
                    self.circleView.glow = 0
                }
            }
        case "volume":
            circleView.rms = min(1, max(0, CGFloat(event["rms"] as? Double ?? 0) * 14))
            circleView.peak = min(1, max(0, CGFloat(event["peak"] as? Double ?? 0) * 5))
            menuBarCompanion.updateVolume(rms: circleView.rms, peak: circleView.peak)
        case "wake":
            circleView.state = "wake_matched"
            circleView.statusText = localizedText("wakePrefix", language: uiLanguage) + (event["phrase"] as? String ?? "")
            menuBarCompanion.update(state: circleView.state, text: circleView.statusText)
            circleView.glow = 1
            NSSound.beep()
        case "question":
            let question = event["text"] as? String ?? ""
            let references = event["references"] as? [String] ?? []
            currentQuestionReferences = references
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
            rootView?.updateQuestion(question, references: currentQuestionReferences)
            rootView?.pushChat(role: "user", kind: "question", text: question)
            menuBarCompanion.updateQuestion(question, references: currentQuestionReferences)
        case "command":
            let command = event["text"] as? String ?? ""
            pushCommand(command)
            rootView?.pushChat(role: "assistant", kind: "command", text: command)
            menuBarCompanion.updateMessage(command)
        case "speech":
            circleView.state = "speaking"
            let speech = event["text"] as? String ?? stateText("speaking", language: uiLanguage)
            circleView.statusText = speech
            rootView?.pushChat(role: "assistant", kind: "speech", text: speech)
            menuBarCompanion.update(state: "speaking", text: speech)
        case "status":
            let status = displayText(event["text"] as? String ?? localizedText("status", language: uiLanguage), state: "status", language: uiLanguage)
            circleView.statusText = status
            rootView?.pushChat(role: "assistant", kind: "status", text: status)
            menuBarCompanion.update(state: circleView.state, text: status)
        case "error":
            circleView.state = "error"
            let error = displayText(event["text"] as? String ?? localizedText("error", language: uiLanguage), state: "error", language: uiLanguage)
            circleView.statusText = error
            rootView?.pushChat(role: "assistant", kind: "error", text: error)
            menuBarCompanion.update(state: "error", text: error)
        case "popup":
            let popupText = event["text"] as? String ?? ""
            guard !popupText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { break }
            let title = event["title"] as? String ?? localizedText("popup", language: uiLanguage)
            let format = event["format"] as? String ?? "markdown"
            popupPanel.show(title: title, text: popupText, format: format, language: uiLanguage)
            rootView?.pushChat(role: "assistant", kind: "status", text: localizedText("popup", language: uiLanguage))
            menuBarCompanion.updateMessage(localizedText("popup", language: uiLanguage))
        case "approval":
            circleView.state = "approval_pending"
            let approval = event["text"] as? String ?? stateText("approval_pending", language: uiLanguage)
            circleView.statusText = approval
            rootView?.pushChat(role: "assistant", kind: "status", text: approval)
            menuBarCompanion.update(state: "approval_pending", text: approval)
        case "usage":
            let usage = event["text"] as? String ?? ""
            rootView?.updateUsage(usage)
            menuBarCompanion.updateUsage(usage)
        case "camera":
            cameraEnabled = event["enabled"] as? Bool ?? false
            let camera = cameraStatusText(event, language: uiLanguage)
            rootView?.updateCamera(camera)
            rootView?.updateCameraEnabled(cameraEnabled)
            menuBarCompanion.updateCamera(camera, enabled: cameraEnabled)
        case "context":
            updateContext(event["entries"] as? [String] ?? [])
        case "context_list":
            updateContext(event["entries"] as? [String] ?? [])
            showContextList(event["entries"] as? [String] ?? [])
        case "settings":
            if let tts = event["tts"] as? [String: Any] {
                updateTtsSettings(tts)
            }
            if let visual = event["visual"] as? [String: Any] {
                initializeUiLanguageIfNeeded(tts: event["tts"] as? [String: Any], visual: visual)
                updateVisualSettings(visual)
            }
            if let phrases = event["wakePhrases"] as? [String] {
                updateWakePhrases(phrases)
            }
            if let phrases = event["approvalPhrases"] as? [String: Any] {
                updateApprovalPhrases(phrases)
            }
            if let gestureWake = event["gestureWake"] as? [String: Any] {
                updateGestureWakeSettings(gestureWake)
            }
            if let threadId = event["codexThreadId"] as? String {
                updateCodexThreadId(threadId)
            }
            if let alwaysNewThread = event["codexAlwaysStartNewThread"] as? Bool {
                updateCodexAlwaysStartNewThread(alwaysNewThread)
            }
            if let micEnabled = event["micEnabled"] as? Bool {
                updateMicEnabled(micEnabled)
            }
        default:
            break
        }

        thinkingPulseSound.setActive(circleView.state == "thinking" || circleView.state == "running")
    }

    private func pushCommand(_ text: String) {
        guard !text.isEmpty else { return }
        commands.insert(text, at: 0)
        commands = Array(commands.prefix(8))
        commandView.string = commands.map { "• \($0)" }.joined(separator: "\n\n")
        rootView?.resizeCommandTextView(scrollToTop: true)
    }

    @objc private func stopTts() {
        sendControl("tts_stop")
    }

    @objc private func toggleMicInput() {
        let next = !micEnabled
        updateMicEnabled(next)
        sendControl("mic_toggle", micEnabled: next)
    }

    @objc private func toggleCameraInput() {
        sendControl("camera_toggle")
    }

    @objc private func emergencyStop() {
        sendControl("emergency_stop")
    }

    @objc private func clearCommands() {
        commands.removeAll()
        commandView.string = ""
        rootView?.resizeCommandTextView(scrollToTop: true)
        sendControl("clear_commands")
    }

    private func showContextList(_ entries: [String]) {
        let alert = NSAlert()
        alert.messageText = localizedText("queuedReferences", language: uiLanguage)
        alert.informativeText = entries.isEmpty
            ? localizedText("noReferencesQueued", language: uiLanguage) + "."
            : localizedText("referencesQueuedNext", language: uiLanguage)

        let scrollView = NSScrollView(frame: NSRect(x: 0, y: 0, width: 480, height: 240))
        let textView = NSTextView(frame: scrollView.bounds)
        textView.isEditable = false
        textView.isSelectable = true
        textView.drawsBackground = true
        textView.backgroundColor = NSColor(calibratedRed: 0.06, green: 0.09, blue: 0.13, alpha: 1)
        textView.textColor = .white
        textView.font = NSFont.monospacedSystemFont(ofSize: 13, weight: .regular)
        textView.textContainerInset = NSSize(width: 8, height: 8)
        textView.string = formatContextList(entries, language: uiLanguage)
        textView.autoresizingMask = [.width]
        textView.textContainer?.widthTracksTextView = true
        textView.textContainer?.containerSize = NSSize(width: scrollView.bounds.width, height: CGFloat.greatestFiniteMagnitude)

        scrollView.documentView = textView
        scrollView.hasVerticalScroller = true
        scrollView.borderType = .noBorder
        scrollView.drawsBackground = false
        alert.accessoryView = scrollView
        alert.addButton(withTitle: localizedText("ok", language: uiLanguage))

        if let mainWindow {
            alert.beginSheetModal(for: mainWindow)
        } else {
            alert.runModal()
        }
    }

    @objc private func addContext() {
        let text = contextField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        submitContext(text)
    }

    private func submitContext(_ text: String) {
        sendControl("add_context", text: text)
        if !text.isEmpty {
            contextField.stringValue = ""
        }
    }

    @objc private func directContext() {
        submitDirectContext(contextField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    private func submitDirectContext(_ text: String) {
        sendControl("direct_go", text: text)
        if !text.isEmpty {
            contextField.stringValue = ""
        }
    }

    @objc private func clearContext() {
        updateContext([])
        sendControl("clear_context")
    }

    @objc private func showContext() {
        if !currentQuestionReferences.isEmpty {
            showContextList(currentQuestionReferences)
            return
        }
        sendControl("show_context")
    }

    @objc private func showSettings() {
        if settingsWindow == nil {
            settingsWindow = makeSettingsWindow()
        }
        syncSettingsControls()
        settingsWindow?.center()
        settingsWindow?.makeKeyAndOrderFront(nil)
    }

    @objc private func applySettings() {
        ttsLanguage = settingsLanguagePopup.titleOfSelectedItem ?? "auto"
        ttsGender = settingsGenderPopup.titleOfSelectedItem ?? "auto"
        ttsVoiceName = settingsVoiceField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        ttsRate = clampedDouble(settingsRateField.stringValue, fallback: ttsRate, min: 0.1, max: 1)
        ttsPitch = clampedDouble(settingsPitchField.stringValue, fallback: ttsPitch, min: 0.5, max: 2)
        ttsVolume = clampedDouble(settingsVolumeField.stringValue, fallback: ttsVolume, min: 0, max: 1)
        thinkingVolume = clampedDouble(settingsThinkingVolumeField.stringValue, fallback: thinkingVolume, min: 0, max: 0.8)
        maxUtteranceSeconds = clampedDouble(settingsMaxUtteranceField.stringValue, fallback: maxUtteranceSeconds, min: 5, max: 55)
        responseLanguage = ttsLanguage
        chatHistoryEnabled = settingsChatHistoryCheckbox.state == .on
        hudEnabled = settingsHudCheckbox.state == .on
        popupPreferred = settingsPopupPreferredCheckbox.state == .on
        speakWakeRejectedWarnings = settingsWakeRejectedWarningCheckbox.state == .on
        codexAlwaysStartNewThread = settingsNewThreadCheckbox.state == .on
        thinkingPulseSound.volume = Float(thinkingVolume)
        rootView?.updateChatHistory(enabled: chatHistoryEnabled)
        menuBarCompanion.setHudEnabled(hudEnabled)
        menuBarCompanion.setHudCompact(hudCompact)
        wakePhrases = normalizedPhrases([settingsWakePhrasesView.string])
        approvalOncePhrases = normalizedPhrases([settingsApprovalOncePhrasesView.string])
        approvalDenyPhrases = normalizedPhrases([settingsApprovalDenyPhrasesView.string])
        approvalSessionPhrases = normalizedPhrases([settingsApprovalSessionPhrasesView.string])
        approvalPolicyPhrases = normalizedPhrases([settingsApprovalPolicyPhrasesView.string])
        approvalNetworkPolicyPhrases = normalizedPhrases([settingsApprovalNetworkPolicyPhrasesView.string])
        gestureWakeBindings = [
            "wake": settingsGestureWakePopup.selectedRepresentedValue(fallback: "open_palm"),
            "stop": settingsGestureStopPopup.selectedRepresentedValue(fallback: "thumbs_down"),
            "approval.once": settingsGestureApprovalOncePopup.selectedRepresentedValue(fallback: "none"),
            "approval.deny": settingsGestureApprovalDenyPopup.selectedRepresentedValue(fallback: "none"),
            "approval.session": settingsGestureApprovalSessionPopup.selectedRepresentedValue(fallback: "none"),
            "approval.policy": settingsGestureApprovalPolicyPopup.selectedRepresentedValue(fallback: "none")
        ]
        gestureRunningMode = settingsGestureRunningModePopup.selectedRepresentedValue(fallback: "off")
        codexThreadId = settingsCodexThreadField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        sendTtsSettings()
        sendWakePhrases()
        sendApprovalPhrases()
        sendGestureWakeSettings()
        sendCodexThreadId()
        settingsWindow?.close()
    }

    @objc private func resetSettings() {
        thinkingVolume = 0.32
        maxUtteranceSeconds = 15
        chatHistoryEnabled = true
        hudEnabled = true
        hudCompact = false
        popupPreferred = false
        speakWakeRejectedWarnings = true
        codexAlwaysStartNewThread = false
        gestureWakeBindings = [
            "wake": "open_palm",
            "stop": "thumbs_down"
        ]
        gestureRunningMode = "off"
        customGestureTemplates = []
        thinkingPulseSound.volume = Float(thinkingVolume)
        rootView?.updateChatHistory(enabled: true)
        menuBarCompanion.setHudEnabled(true)
        menuBarCompanion.setHudCompact(false)
        syncSettingsControls()
        sendControl("reset_settings")
    }

    @objc private func captureCustomGestureFromSettings() {
        let text = settingsCustomGestureNameField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        sendControl("capture_gesture_template", text: text)
    }

    @objc private func resetGestureWakeSettingsFromSettings() {
        sendControl("reset_gesture_wake_settings")
    }

    @objc private func exitVisual() {
        sendControl("exit")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.18) {
            NSApp.terminate(nil)
        }
    }

    private func updateContext(_ entries: [String]) {
        contextEntries = Array(entries.prefix(8))
        if contextEntries.isEmpty {
            contextSummary.stringValue = referenceSummary(queuedCount: 0, language: uiLanguage)
            contextSummary.textColor = NSColor(calibratedRed: 0.41, green: 0.47, blue: 0.55, alpha: 1)
            rootView?.updateContextSummary(0)
            menuBarCompanion.updateContext(contextEntries)
            return
        }

        contextSummary.stringValue = referenceSummary(queuedCount: contextEntries.count, language: uiLanguage)
        contextSummary.textColor = NSColor(calibratedRed: 1.0, green: 0.82, blue: 0.40, alpha: 1)
        rootView?.updateContextSummary(contextEntries.count)
        menuBarCompanion.updateContext(contextEntries)
    }

    private func updateTtsSettings(_ settings: [String: Any]) {
        ttsLanguage = settings["language"] as? String ?? ttsLanguage
        ttsGender = settings["gender"] as? String ?? ttsGender
        ttsVoiceName = settings["voiceName"] as? String ?? ttsVoiceName
        ttsRate = settings["rate"] as? Double ?? ttsRate
        ttsPitch = settings["pitch"] as? Double ?? ttsPitch
        ttsVolume = settings["volume"] as? Double ?? ttsVolume
        syncSettingsControls()
    }

    private func initializeUiLanguageIfNeeded(tts: [String: Any]?, visual: [String: Any]?) {
        guard !uiLanguageInitialized else { return }
        let language = (visual?["responseLanguage"] as? String) ?? (tts?["language"] as? String) ?? "auto"
        uiLanguage = resolvedUiLanguage(from: language)
        uiLanguageInitialized = true
        applyUiLanguage()
    }

    private func applyUiLanguage() {
        mainWindow?.title = "Voice Agent"
        rootView?.uiLanguage = uiLanguage
        menuBarCompanion.uiLanguage = uiLanguage
        installMainMenu()
        settingsWindow?.close()
        settingsWindow = nil
        settingsChatHistoryCheckbox.title = localizedText("showRecentQa", language: uiLanguage)
        settingsHudCheckbox.title = localizedText("showFloatingHud", language: uiLanguage)
        settingsPopupPreferredCheckbox.title = localizedText("popupPreferred", language: uiLanguage)
        settingsWakeRejectedWarningCheckbox.title = localizedText("speakWakeWarning", language: uiLanguage)
        settingsNewThreadCheckbox.title = localizedText("alwaysStartNewThread", language: uiLanguage)
        popupPanel.updateLanguage(uiLanguage)
        circleView.statusText = displayText(circleView.statusText, state: circleView.state, language: uiLanguage)
        menuBarCompanion.update(state: circleView.state, text: circleView.statusText)
    }

    private func updateVisualSettings(_ settings: [String: Any]) {
        if let value = settings["thinkingVolume"] as? Double {
            thinkingVolume = min(0.8, max(0, value))
        }
        if let value = settings["maxUtteranceSeconds"] as? Double {
            maxUtteranceSeconds = min(55, max(5, value))
        }
        if let value = settings["responseLanguage"] as? String {
            responseLanguage = normalizedLanguage(value)
            ttsLanguage = responseLanguage
        }
        if let value = settings["chatHistoryEnabled"] as? Bool {
            chatHistoryEnabled = value
            rootView?.updateChatHistory(enabled: value)
        }
        if let value = settings["hudEnabled"] as? Bool {
            hudEnabled = value
            menuBarCompanion.setHudEnabled(value)
        }
        if let value = settings["hudCompact"] as? Bool {
            updateHudCompact(value, sendSettings: false)
        }
        if let value = settings["popupPreferred"] as? Bool {
            popupPreferred = value
        }
        if let value = settings["speakWakeRejectedWarnings"] as? Bool {
            speakWakeRejectedWarnings = value
        }
        thinkingPulseSound.volume = Float(thinkingVolume)
        syncSettingsControls()
    }

    private func updateApprovalPhrases(_ settings: [String: Any]) {
        if let phrases = settings["onceApprove"] as? [String] {
            approvalOncePhrases = normalizedPhrases(phrases)
        }
        if let phrases = settings["deny"] as? [String] {
            approvalDenyPhrases = normalizedPhrases(phrases)
        }
        if let phrases = settings["sessionApprove"] as? [String] {
            approvalSessionPhrases = normalizedPhrases(phrases)
        }
        if let phrases = settings["policyApprove"] as? [String] {
            approvalPolicyPhrases = normalizedPhrases(phrases)
        }
        if let phrases = settings["networkPolicyApprove"] as? [String] {
            approvalNetworkPolicyPhrases = normalizedPhrases(phrases)
        }
        syncSettingsControls()
    }

    private func updateGestureWakeSettings(_ settings: [String: Any]) {
        if let runningMode = settings["runningMode"] as? String {
            gestureRunningMode = runningMode == "emergency_only" ? "emergency_only" : "off"
        }
        if let templates = settings["customGestures"] as? [[String: Any]] {
            customGestureTemplates = templates
            reloadGestureOptionControls()
        }
        if let bindings = settings["bindings"] as? [String: Any] {
            for key in ["wake", "stop", "approval.once", "approval.deny", "approval.session", "approval.policy"] {
                if let value = bindings[key] as? String {
                    gestureWakeBindings[key] = normalizedGestureName(value, allowNone: key.hasPrefix("approval."))
                }
            }
        }
        syncSettingsControls()
    }

    private func updateWakePhrases(_ phrases: [String]) {
        wakePhrases = normalizedPhrases(phrases)
        syncSettingsControls()
    }

    private func updateCodexThreadId(_ threadId: String) {
        codexThreadId = threadId.trimmingCharacters(in: .whitespacesAndNewlines)
        rootView?.updateSessionId(codexThreadId)
        syncSettingsControls()
    }

    private func updateCodexAlwaysStartNewThread(_ value: Bool) {
        codexAlwaysStartNewThread = value
        syncSettingsControls()
    }

    private func updateMicEnabled(_ enabled: Bool) {
        micEnabled = enabled
        rootView?.updateMicEnabled(enabled)
        menuBarCompanion.updateMicEnabled(enabled)
    }

    private func updateHudCompact(_ compact: Bool, sendSettings: Bool) {
        hudCompact = compact
        menuBarCompanion.setHudCompact(compact)
        if sendSettings {
            sendVisualSettings()
        }
    }

    private func makeSettingsWindow() -> NSWindow {
        let contentWidth: CGFloat = 380
        let contentHeight: CGFloat = 1220
        let window = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: contentWidth, height: 640),
            styleMask: [.titled, .closable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = localizedText("settings", language: uiLanguage)
        window.isReleasedWhenClosed = false
        window.minSize = NSSize(width: 360, height: 360)
        window.contentMinSize = NSSize(width: 360, height: 320)

        let scrollView = NSScrollView(frame: NSRect(x: 0, y: 0, width: contentWidth, height: 640))
        scrollView.autoresizingMask = [.width, .height]
        scrollView.hasVerticalScroller = true
        scrollView.hasHorizontalScroller = false
        scrollView.autohidesScrollers = false
        scrollView.drawsBackground = false

        let view = NSView(frame: NSRect(x: 0, y: 0, width: contentWidth, height: contentHeight))
        view.autoresizingMask = [.width]
        scrollView.documentView = view
        window.contentView = scrollView

        settingsLanguagePopup.addItemsIfNeeded(["auto", "ko", "en"])
        settingsGenderPopup.addItemsIfNeeded(["auto", "female", "male"])
        reloadGestureOptionControls()
        settingsGestureRunningModePopup.addValueItemsIfNeeded(["off", "emergency_only"]) {
            gestureRunningModeDisplayName($0, language: uiLanguage)
        }
        settingsMaxUtteranceField.delegate = self
        settingsCustomGestureCaptureButton.title = localizedText("gestureCapture", language: uiLanguage)
        settingsCustomGestureCaptureButton.target = self
        settingsCustomGestureCaptureButton.action = #selector(captureCustomGestureFromSettings)
        settingsCustomGestureClearButton.title = localizedText("gestureClear", language: uiLanguage)
        settingsCustomGestureClearButton.target = self
        settingsCustomGestureClearButton.action = #selector(resetGestureWakeSettingsFromSettings)

        addSettingsRow(view, label: localizedText("gestureWake", language: uiLanguage), control: settingsGestureWakePopup, y: 1146)
        addSettingsHelp(view, y: 1146, text: localizedText("gestureHelp", language: uiLanguage))
        addSettingsRow(view, label: localizedText("gestureStop", language: uiLanguage), control: settingsGestureStopPopup, y: 1112)
        addSettingsHelp(view, y: 1112, text: localizedText("gestureHelp", language: uiLanguage))
        addSettingsRow(view, label: localizedText("gestureApprovalOnce", language: uiLanguage), control: settingsGestureApprovalOncePopup, y: 1078)
        addSettingsHelp(view, y: 1078, text: localizedText("gestureHelp", language: uiLanguage))
        addSettingsRow(view, label: localizedText("gestureApprovalDeny", language: uiLanguage), control: settingsGestureApprovalDenyPopup, y: 1044)
        addSettingsHelp(view, y: 1044, text: localizedText("gestureHelp", language: uiLanguage))
        addSettingsRow(view, label: localizedText("gestureApprovalSession", language: uiLanguage), control: settingsGestureApprovalSessionPopup, y: 1010)
        addSettingsHelp(view, y: 1010, text: localizedText("gestureHelp", language: uiLanguage))
        addSettingsRow(view, label: localizedText("gestureApprovalPolicy", language: uiLanguage), control: settingsGestureApprovalPolicyPopup, y: 976)
        addSettingsHelp(view, y: 976, text: localizedText("gestureHelp", language: uiLanguage))
        addSettingsRow(view, label: localizedText("gestureRunningMode", language: uiLanguage), control: settingsGestureRunningModePopup, y: 942)
        addSettingsHelp(view, y: 942, text: localizedText("gestureRunningModeHelp", language: uiLanguage))
        addCustomGestureCaptureRow(view, y: 906)

        addSettingsPhraseArea(
            view,
            label: localizedText("allow", language: uiLanguage),
            textView: settingsApprovalOncePhrasesView,
            y: 862,
            placeholderHeight: 46,
            help: localizedText("approvalAllowHelp", language: uiLanguage)
        )
        addSettingsPhraseArea(
            view,
            label: localizedText("deny", language: uiLanguage),
            textView: settingsApprovalDenyPhrasesView,
            y: 800,
            placeholderHeight: 46,
            help: localizedText("approvalDenyHelp", language: uiLanguage)
        )
        addSettingsPhraseArea(
            view,
            label: localizedText("sessionAllow", language: uiLanguage),
            textView: settingsApprovalSessionPhrasesView,
            y: 738,
            placeholderHeight: 46,
            help: localizedText("sessionAllowHelp", language: uiLanguage)
        )
        addSettingsPhraseArea(
            view,
            label: localizedText("policyAllow", language: uiLanguage),
            textView: settingsApprovalPolicyPhrasesView,
            y: 676,
            placeholderHeight: 46,
            help: localizedText("policyAllowHelp", language: uiLanguage)
        )
        addSettingsPhraseArea(
            view,
            label: localizedText("networkPolicyAllow", language: uiLanguage),
            textView: settingsApprovalNetworkPolicyPhrasesView,
            y: 614,
            placeholderHeight: 46,
            help: localizedText("networkPolicyAllowHelp", language: uiLanguage)
        )

        addSettingsRow(view, label: localizedText("language", language: uiLanguage), control: settingsLanguagePopup, y: 570)
        addSettingsHelp(view, y: 570, text: localizedText("languageHelp", language: uiLanguage))
        addSettingsRow(view, label: localizedText("gender", language: uiLanguage), control: settingsGenderPopup, y: 530)
        addSettingsHelp(view, y: 530, text: localizedText("genderHelp", language: uiLanguage))
        addSettingsRow(view, label: localizedText("voice", language: uiLanguage), control: settingsVoiceField, y: 490)
        addSettingsHelp(view, y: 490, text: localizedText("voiceHelp", language: uiLanguage))
        addSettingsRow(view, label: localizedText("rate", language: uiLanguage), control: settingsRateField, y: 450)
        addSettingsHelp(view, y: 450, text: localizedText("rateHelp", language: uiLanguage))
        addSettingsRow(view, label: localizedText("pitch", language: uiLanguage), control: settingsPitchField, y: 410)
        addSettingsHelp(view, y: 410, text: localizedText("pitchHelp", language: uiLanguage))
        addSettingsRow(view, label: localizedText("volume", language: uiLanguage), control: settingsVolumeField, y: 370)
        addSettingsHelp(view, y: 370, text: localizedText("volumeHelp", language: uiLanguage))
        addSettingsRow(view, label: localizedText("thinkingFx", language: uiLanguage), control: settingsThinkingVolumeField, y: 330)
        addSettingsHelp(view, y: 330, text: localizedText("thinkingHelp", language: uiLanguage))
        addSettingsRow(view, label: localizedText("maxSpeech", language: uiLanguage), control: settingsMaxUtteranceField, y: 290)
        addSettingsHelp(view, y: 290, text: localizedText("maxSpeechHelp", language: uiLanguage))
        addSettingsRow(view, label: localizedText("codexThread", language: uiLanguage), control: settingsCodexThreadField, y: 250)
        addSettingsHelp(view, y: 250, text: localizedText("threadHelp", language: uiLanguage))
        settingsNewThreadCheckbox.frame = NSRect(x: 132, y: 220, width: 216, height: 22)
        view.addSubview(settingsNewThreadCheckbox)
        addSettingsHelp(view, y: 218, text: localizedText("newThreadHelp", language: uiLanguage))
        settingsChatHistoryCheckbox.frame = NSRect(x: 132, y: 198, width: 216, height: 22)
        view.addSubview(settingsChatHistoryCheckbox)
        addSettingsHelp(view, y: 196, text: localizedText("chatHelp", language: uiLanguage))
        settingsHudCheckbox.frame = NSRect(x: 132, y: 176, width: 216, height: 22)
        view.addSubview(settingsHudCheckbox)
        addSettingsHelp(view, y: 174, text: localizedText("hudHelp", language: uiLanguage))
        settingsPopupPreferredCheckbox.frame = NSRect(x: 132, y: 154, width: 216, height: 22)
        view.addSubview(settingsPopupPreferredCheckbox)
        addSettingsHelp(view, y: 152, text: localizedText("popupHelp", language: uiLanguage))
        settingsWakeRejectedWarningCheckbox.frame = NSRect(x: 132, y: 132, width: 216, height: 22)
        view.addSubview(settingsWakeRejectedWarningCheckbox)
        addSettingsHelp(view, y: 130, text: localizedText("wakeWarningHelp", language: uiLanguage))

        let wakeLabel = NSTextField(labelWithString: localizedText("wake", language: uiLanguage))
        wakeLabel.textColor = NSColor(calibratedRed: 0.57, green: 0.64, blue: 0.73, alpha: 1)
        wakeLabel.frame = NSRect(x: 26, y: 102, width: 96, height: 20)
        view.addSubview(wakeLabel)
        addSettingsHelp(view, y: 98, text: localizedText("wakePhrasesHelp", language: uiLanguage))

        let wakeScroll = NSScrollView(frame: NSRect(x: 132, y: 38, width: 216, height: 54))
        wakeScroll.borderType = .bezelBorder
        wakeScroll.hasVerticalScroller = true
        settingsWakePhrasesView.isVerticallyResizable = true
        settingsWakePhrasesView.isHorizontallyResizable = false
        settingsWakePhrasesView.autoresizingMask = [.width]
        settingsWakePhrasesView.frame = NSRect(x: 0, y: 0, width: 216, height: 76)
        settingsWakePhrasesView.font = NSFont.systemFont(ofSize: 13)
        wakeScroll.documentView = settingsWakePhrasesView
        view.addSubview(wakeScroll)

        let reset = button(localizedText("restoreDefaults", language: uiLanguage), action: #selector(resetSettings))
        reset.frame = NSRect(x: 26, y: 8, width: 150, height: 28)
        view.addSubview(reset)

        let apply = button(localizedText("apply", language: uiLanguage), action: #selector(applySettings))
        apply.frame = NSRect(x: 236, y: 8, width: 112, height: 28)
        view.addSubview(apply)

        return window
    }

    private func addSettingsRow(_ view: NSView, label: String, control: NSView, y: CGFloat) {
        let labelView = NSTextField(labelWithString: label)
        labelView.textColor = NSColor(calibratedRed: 0.57, green: 0.64, blue: 0.73, alpha: 1)
        labelView.frame = NSRect(x: 26, y: y + 4, width: 96, height: 20)
        control.frame = NSRect(x: 132, y: y, width: 206, height: 26)
        view.addSubview(labelView)
        view.addSubview(control)
    }

    private func addSettingsHelp(_ view: NSView, y: CGFloat, text: String) {
        let help = HoverHelpButton(frame: NSRect(x: 352, y: y + 5, width: 16, height: 16), compact: true)
        help.title = "?"
        help.helpText = text
        view.addSubview(help)
    }

    private func addCustomGestureCaptureRow(_ view: NSView, y: CGFloat) {
        let labelView = NSTextField(labelWithString: localizedText("gestureCustomName", language: uiLanguage))
        labelView.textColor = NSColor(calibratedRed: 0.57, green: 0.64, blue: 0.73, alpha: 1)
        labelView.frame = NSRect(x: 26, y: y + 4, width: 96, height: 20)
        settingsCustomGestureNameField.frame = NSRect(x: 132, y: y, width: 82, height: 26)
        settingsCustomGestureCaptureButton.frame = NSRect(x: 222, y: y, width: 58, height: 26)
        settingsCustomGestureClearButton.frame = NSRect(x: 288, y: y, width: 58, height: 26)
        view.addSubview(labelView)
        view.addSubview(settingsCustomGestureNameField)
        view.addSubview(settingsCustomGestureCaptureButton)
        view.addSubview(settingsCustomGestureClearButton)
        addSettingsHelp(view, y: y, text: localizedText("gestureHelp", language: uiLanguage))
    }

    private func addSettingsPhraseArea(
        _ view: NSView,
        label: String,
        textView: NSTextView,
        y: CGFloat,
        placeholderHeight: CGFloat,
        help: String
    ) {
        let labelView = NSTextField(labelWithString: label)
        labelView.textColor = NSColor(calibratedRed: 0.57, green: 0.64, blue: 0.73, alpha: 1)
        labelView.frame = NSRect(x: 26, y: y + placeholderHeight - 22, width: 96, height: 20)
        view.addSubview(labelView)
        addSettingsHelp(view, y: y + placeholderHeight - 26, text: help)

        let scroll = NSScrollView(frame: NSRect(x: 132, y: y, width: 216, height: placeholderHeight))
        scroll.borderType = .bezelBorder
        scroll.hasVerticalScroller = true
        textView.isVerticallyResizable = true
        textView.isHorizontallyResizable = false
        textView.autoresizingMask = [.width]
        textView.frame = NSRect(x: 0, y: 0, width: 216, height: placeholderHeight + 18)
        textView.font = NSFont.systemFont(ofSize: 12)
        scroll.documentView = textView
        view.addSubview(scroll)
    }

    private func syncSettingsControls() {
        reloadGestureOptionControls()
        settingsLanguagePopup.selectItem(withTitle: ttsLanguage)
        settingsGenderPopup.selectItem(withTitle: ttsGender)
        settingsVoiceField.stringValue = ttsVoiceName
        settingsRateField.stringValue = String(format: "%.2f", ttsRate)
        settingsPitchField.stringValue = String(format: "%.2f", ttsPitch)
        settingsVolumeField.stringValue = String(format: "%.2f", ttsVolume)
        settingsThinkingVolumeField.stringValue = String(format: "%.2f", thinkingVolume)
        settingsMaxUtteranceField.stringValue = String(format: "%.0f", maxUtteranceSeconds)
        settingsChatHistoryCheckbox.state = chatHistoryEnabled ? .on : .off
        settingsHudCheckbox.state = hudEnabled ? .on : .off
        settingsPopupPreferredCheckbox.state = popupPreferred ? .on : .off
        settingsWakeRejectedWarningCheckbox.state = speakWakeRejectedWarnings ? .on : .off
        settingsNewThreadCheckbox.state = codexAlwaysStartNewThread ? .on : .off
        settingsCodexThreadField.stringValue = codexThreadId
        settingsWakePhrasesView.string = wakePhrases.joined(separator: "\n")
        settingsApprovalOncePhrasesView.string = approvalOncePhrases.joined(separator: "\n")
        settingsApprovalDenyPhrasesView.string = approvalDenyPhrases.joined(separator: "\n")
        settingsApprovalSessionPhrasesView.string = approvalSessionPhrases.joined(separator: "\n")
        settingsApprovalPolicyPhrasesView.string = approvalPolicyPhrases.joined(separator: "\n")
        settingsApprovalNetworkPolicyPhrasesView.string = approvalNetworkPolicyPhrases.joined(separator: "\n")
        settingsGestureWakePopup.selectRepresentedValue(gestureWakeBindings["wake"] ?? "open_palm")
        settingsGestureStopPopup.selectRepresentedValue(gestureWakeBindings["stop"] ?? "thumbs_down")
        settingsGestureApprovalOncePopup.selectRepresentedValue(gestureWakeBindings["approval.once"] ?? "none")
        settingsGestureApprovalDenyPopup.selectRepresentedValue(gestureWakeBindings["approval.deny"] ?? "none")
        settingsGestureApprovalSessionPopup.selectRepresentedValue(gestureWakeBindings["approval.session"] ?? "none")
        settingsGestureApprovalPolicyPopup.selectRepresentedValue(gestureWakeBindings["approval.policy"] ?? "none")
        settingsGestureRunningModePopup.selectRepresentedValue(gestureRunningMode)
    }

    private func reloadGestureOptionControls() {
        let options = gestureOptionValues()
        let optionalOptions = ["none"] + options
        settingsGestureWakePopup.replaceValueItems(options) { self.gestureOptionTitle($0) }
        settingsGestureStopPopup.replaceValueItems(options) { self.gestureOptionTitle($0) }
        settingsGestureApprovalOncePopup.replaceValueItems(optionalOptions) { self.gestureOptionTitle($0) }
        settingsGestureApprovalDenyPopup.replaceValueItems(optionalOptions) { self.gestureOptionTitle($0) }
        settingsGestureApprovalSessionPopup.replaceValueItems(optionalOptions) { self.gestureOptionTitle($0) }
        settingsGestureApprovalPolicyPopup.replaceValueItems(optionalOptions) { self.gestureOptionTitle($0) }
    }

    private func gestureOptionValues() -> [String] {
        let builtIns = ["open_palm", "thumbs_down", "fist", "peace", "thumbs_up"]
        let custom = customGestureTemplates.compactMap { $0["name"] as? String }
        return builtIns + custom
    }

    private func gestureOptionTitle(_ value: String) -> String {
        if let template = customGestureTemplates.first(where: { $0["name"] as? String == value }),
           let label = template["label"] as? String,
           !label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return label
        }
        return gestureDisplayName(value, language: uiLanguage)
    }

    func controlTextDidChange(_ obj: Notification) {
        guard let field = obj.object as? NSTextField, field === settingsMaxUtteranceField else { return }

        let raw = field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let value = Double(raw), value > 55 else { return }
        field.stringValue = "55"
    }

    private func sendTtsSettings() {
        sendPayload([
            "op": "voice-agent-ui",
            "type": "control",
            "action": "update_tts_settings",
            "tts": [
                "language": ttsLanguage,
                "gender": ttsGender,
                "voiceName": ttsVoiceName,
                "rate": ttsRate,
                "pitch": ttsPitch,
                "volume": ttsVolume
            ]
        ])
        sendPayload([
            "op": "voice-agent-ui",
            "type": "control",
            "action": "update_visual_settings",
            "visual": [
                "thinkingVolume": thinkingVolume,
                "maxUtteranceSeconds": maxUtteranceSeconds,
                "responseLanguage": responseLanguage,
                "chatHistoryEnabled": chatHistoryEnabled,
                "hudEnabled": hudEnabled,
                "hudCompact": hudCompact,
                "popupPreferred": popupPreferred,
                "speakWakeRejectedWarnings": speakWakeRejectedWarnings
            ]
        ])
    }

    private func sendVisualSettings() {
        sendPayload([
            "op": "voice-agent-ui",
            "type": "control",
            "action": "update_visual_settings",
            "visual": [
                "thinkingVolume": thinkingVolume,
                "maxUtteranceSeconds": maxUtteranceSeconds,
                "responseLanguage": responseLanguage,
                "chatHistoryEnabled": chatHistoryEnabled,
                "hudEnabled": hudEnabled,
                "hudCompact": hudCompact,
                "popupPreferred": popupPreferred,
                "speakWakeRejectedWarnings": speakWakeRejectedWarnings
            ]
        ])
    }

    private func normalizedLanguage(_ value: String) -> String {
        value == "ko" || value == "en" || value == "auto" ? value : "auto"
    }

    private func normalizedGestureName(_ value: String, allowNone: Bool) -> String {
        let options = gestureOptionValues()
        if allowNone && value == "none" {
            return "none"
        }
        return options.contains(value) ? value : (allowNone ? "none" : "open_palm")
    }

    private func sendWakePhrases() {
        sendPayload([
            "op": "voice-agent-ui",
            "type": "control",
            "action": "update_wake_phrases",
            "wakePhrases": wakePhrases
        ])
    }

    private func sendApprovalPhrases() {
        sendPayload([
            "op": "voice-agent-ui",
            "type": "control",
            "action": "update_approval_phrases",
            "approvalPhrases": [
                "onceApprove": approvalOncePhrases,
                "deny": approvalDenyPhrases,
                "sessionApprove": approvalSessionPhrases,
                "policyApprove": approvalPolicyPhrases,
                "networkPolicyApprove": approvalNetworkPolicyPhrases
            ]
        ])
    }

    private func sendGestureWakeSettings() {
        sendPayload([
            "op": "voice-agent-ui",
            "type": "control",
            "action": "update_gesture_wake_settings",
            "gestureWake": [
                "runningMode": gestureRunningMode,
                "bindings": gestureWakeBindings,
                "customGestures": customGestureTemplates
            ]
        ])
    }

    private func sendCodexThreadId() {
        sendPayload([
            "op": "voice-agent-ui",
            "type": "control",
            "action": "update_codex_thread_id",
            "codexThreadId": codexThreadId,
            "codexAlwaysStartNewThread": codexAlwaysStartNewThread
        ])
    }

    private func sendControl(_ action: String, text: String? = nil, micEnabled: Bool? = nil) {
        var payload: [String: Any] = [
            "op": "voice-agent-ui",
            "type": "control",
            "action": action
        ]
        if let text {
            payload["text"] = text
        }
        if let micEnabled {
            payload["micEnabled"] = micEnabled
        }
        sendPayload(payload)
    }

    private func sendPayload(_ payload: [String: Any]) {
        guard
            let data = try? JSONSerialization.data(withJSONObject: payload),
            let text = String(data: data, encoding: .utf8)
        else { return }
        webSocket?.send(.string(text)) { _ in }
    }
}

private extension NSPopUpButton {
    func addItemsIfNeeded(_ titles: [String]) {
        if numberOfItems > 0 { return }
        addItems(withTitles: titles)
    }

    func addValueItemsIfNeeded(_ values: [String], title: (String) -> String) {
        if numberOfItems > 0 { return }
        for value in values {
            let item = NSMenuItem(title: title(value), action: nil, keyEquivalent: "")
            item.representedObject = value
            menu?.addItem(item)
        }
    }

    func replaceValueItems(_ values: [String], title: (String) -> String) {
        let selected = selectedItem?.representedObject as? String
        removeAllItems()
        for value in values {
            let item = NSMenuItem(title: title(value), action: nil, keyEquivalent: "")
            item.representedObject = value
            menu?.addItem(item)
        }
        if let selected {
            selectRepresentedValue(selected)
        }
    }

    func selectedRepresentedValue(fallback: String) -> String {
        selectedItem?.representedObject as? String ?? titleOfSelectedItem ?? fallback
    }

    func selectRepresentedValue(_ value: String) {
        for item in itemArray where item.representedObject as? String == value {
            select(item)
            return
        }
    }
}

private func clampedDouble(_ value: String, fallback: Double, min: Double, max: Double) -> Double {
    guard let parsed = Double(value) else { return fallback }
    return Swift.min(max, Swift.max(min, parsed))
}

private func normalizedPhrases(_ values: [String]) -> [String] {
    var result: [String] = []
    for rawValue in values {
        for part in rawValue.components(separatedBy: CharacterSet(charactersIn: ",\n")) {
            let phrase = part.trimmingCharacters(in: .whitespacesAndNewlines)
            if !phrase.isEmpty && !result.contains(phrase) {
                result.append(phrase)
            }
        }
    }
    return result
}

private func formatContextList(_ entries: [String], language: UiLanguage = .en) -> String {
    if entries.isEmpty {
        return localizedText("noReferencesQueued", language: language) + "."
    }
    return entries.enumerated().map { index, entry in
        "\(index + 1). \(entry)"
    }.joined(separator: "\n")
}

func argumentValue(_ name: String, _ fallback: String = "") -> String {
    let args = CommandLine.arguments
    for index in 0..<(args.count - 1) {
        if args[index] == name { return args[index + 1] }
    }
    return fallback
}

let app = NSApplication.shared
let delegate = VisualAppDelegate(bridgeUrl: argumentValue("--url"))
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
