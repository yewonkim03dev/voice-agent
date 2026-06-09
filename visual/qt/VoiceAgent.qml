import QtQuick 2.15
import QtQuick.Controls 2.15
import QtQuick.Layouts 1.15
import QtWebSockets 1.1
import QtMultimedia 5.15

ApplicationWindow {
    id: root
    width: 520
    height: 680
    visible: true
    title: "Voice Agent"
    color: "#07090d"

    property string bridgeUrl: argumentValue("--url", "")
    property string uiState: "idle"
    property string statusText: bridgeUrl.length > 0 ? "connecting" : "waiting for bridge"
    property string usageText: ""
    property string currentQuestion: ""
    property var chatItems: []
    property real rms: 0.0
    property real peak: 0.0
    property real glow: 0.0
    property real visualPhase: 0.0
    property bool expandedLayout: width >= 760 || height >= 760
    property bool chatHistoryEnabled: true
    property bool chatPanelOpen: true
    property bool chatPanelAvailable: root.chatHistoryEnabled && expandedLayout && width >= 980
    property bool chatPanelVisible: root.chatPanelAvailable && root.chatPanelOpen
    property int chatPanelWidth: Math.round(Math.min(360, Math.max(300, width * 0.26)))
    property int mainRightInset: chatPanelVisible ? chatPanelWidth + 18 : 0
    property int controlsHeight: 38
    property int commandPanelHeight: Math.round(Math.max(132, Math.min(expandedLayout ? 220 : 172, height * (expandedLayout ? 0.22 : 0.25))))
    property int visualDiameter: Math.round(Math.max(220, Math.min((width - mainRightInset) * (expandedLayout ? 0.78 : 0.84), height * (expandedLayout ? 0.60 : 0.48), height - commandPanelHeight - controlsHeight - 92, expandedLayout ? 720 : 360)))
    property int visualCenterYOffset: -Math.round(Math.max(96, Math.min(220, height * 0.20)))
    property var commands: []
    property string commandText: ""
    property var contextEntries: []
    property bool settingsOpen: false
    property string ttsLanguage: "auto"
    property string ttsGender: "auto"
    property string ttsVoiceName: ""
    property real ttsRate: 0.56
    property real ttsPitch: 1.0
    property real ttsVolume: 1.0
    property real thinkingVolume: 0.32
    property real maxUtteranceSeconds: 15
    property string responseLanguage: "auto"
    property bool speakWakeRejectedWarnings: true
    property var wakePhrases: []
    property var approvalOncePhrases: []
    property var approvalDenyPhrases: []
    property var approvalSessionPhrases: []
    property var approvalPolicyPhrases: []
    property var approvalNetworkPolicyPhrases: []
    property string codexThreadId: ""
    property bool codexAlwaysStartNewThread: false
    property bool micEnabled: true
    property string uiLanguage: "en"
    property bool uiLanguageInitialized: false
    property string voiceGuideText: root.uiText("voiceGuide")
    property string referenceHelpText: root.uiText("referenceHelp")
    property string referenceListText: root.uiText("noReferencesQueued") + "."

    function uiText(key) {
        var ko = {
            connecting: "연결 중",
            waitingForBridge: "브리지 대기 중",
            connected: "연결됨",
            disconnected: "연결 끊김",
            bridgeError: "브리지 오류",
            bridgeDisconnected: "브리지 연결 끊김",
            idle: "대기 중",
            listening: "듣는 중",
            wakeMatched: "호출됨",
            wakeRejected: "호출어 불일치",
            sttProcessing: "음성 인식 중",
            submitting: "전송 중",
            thinking: "생각 중",
            running: "실행 중",
            speaking: "말하는 중",
            approvalPending: "권한 대기 중",
            error: "오류",
            shutdown: "종료 중",
            wakePrefix: "호출어: ",
            sessionNew: "세션: 새 세션",
            sessionPrefix: "세션: ",
            usagePrefix: "사용량: ",
            queuedReferences: "대기 중인 참고자료",
            close: "닫기",
            references: "참고자료",
            referenceText: "참고자료 텍스트",
            add: "추가",
            refs: "목록",
            clearRef: "참고 지우기",
            noReferencesQueued: "대기 중인 참고자료 없음",
            referenceCountSuffix: "개 참고자료 대기 중",
            commands: "명령",
            recentQa: "최근 Q/A",
            hide: "숨기기",
            settings: "설정",
            language: "언어",
            gender: "성별",
            voice: "음성",
            rate: "속도 ",
            pitch: "음높이 ",
            volume: "볼륨 ",
            thinkingSound: "작업 효과음 ",
            maxSpeech: "최대 발화 ",
            showRecentQa: "최근 Q/A 패널 표시",
            speakWakeWarning: "호출어 경고 말하기",
            wakePhrasesReplace: "호출어 목록 교체",
            approvalAllowPhrases: "허용 문구",
            approvalDenyPhrases: "거부 문구",
            sessionAllowPhrases: "세션 허용 문구",
            policyAllowPhrases: "계속 허용 문구",
            networkPolicyAllowPhrases: "네트워크 계속 허용 문구",
            codexThreadRestart: "Codex thread id (재시작 후 적용)",
            alwaysStartNewThread: "항상 새 스레드로 시작",
            restoreDefaults: "기본값 복원",
            apply: "적용",
            stop: "정지",
            ttsStop: "TTS 정지",
            micOn: "🎙",
            micOff: "🔇",
            microphoneOn: "마이크 켜짐",
            microphoneOff: "마이크 꺼짐",
            clearCmds: "명령 지우기",
            exit: "종료",
            speech: "음성",
            command: "명령",
            status: "상태",
            voiceGuide: "1. 코덱스, 자비스 같은 호출어를 먼저 말하세요.\n2. 이어서 자연어로 할 일을 말하면 에이전트에게 그대로 전달됩니다.\n3. 권한 요청 중에는 허용/거부/이번 세션 동안 허용만 말하면 됩니다.\n4. 참고자료는 다음 요청 한 번에만 붙습니다.\n5. 정지는 현재 에이전트 작업을 즉시 중단합니다.",
            referenceHelp: "파일명, URL, 조건 같은 참고자료만 적고 추가를 누르세요. Visual에서는 /add를 붙이지 않아도 CLI /add와 같은 참고자료 큐로 들어갑니다.",
            languageHelp: "TTS와 응답 언어를 선택합니다. Visual UI 언어는 다음 재시작 때 적용됩니다.",
            genderHelp: "가능한 경우 남성/여성 음성 선호도를 적용합니다.",
            voiceHelp: "설치된 macOS 음성 이름을 직접 지정합니다.",
            rateHelp: "TTS 말하기 속도입니다.",
            pitchHelp: "TTS 음높이입니다.",
            volumeHelp: "TTS 출력 볼륨입니다.",
            thinkingHelp: "작업 중 반복 효과음 볼륨입니다.",
            maxSpeechHelp: "한 번에 받을 발화 최대 길이입니다. 5초에서 55초 사이입니다.",
            chatHelp: "최근 질문과 답변 패널 표시 여부입니다.",
            wakeWarningHelp: "호출어 불일치 안내를 TTS로 읽을지 정합니다.",
            wakePhrasesHelp: "줄마다 하나씩 호출어를 입력하면 기존 목록을 대체합니다.",
            approvalAllowHelp: "권한 요청에서 한 번 허용으로 처리할 문구입니다.",
            approvalDenyHelp: "권한 요청에서 거부로 처리할 문구입니다. 허용 문구와 겹치면 unknown으로 처리될 수 있습니다.",
            sessionAllowHelp: "현재 세션 동안 허용으로 처리할 문구입니다.",
            policyAllowHelp: "같은 명령 또는 같은 실행 정책을 계속 허용으로 처리할 문구입니다.",
            networkPolicyAllowHelp: "같은 네트워크, 호스트, 도메인을 계속 허용으로 처리할 문구입니다.",
            threadHelp: "다음 재시작 때 이어갈 Codex thread id입니다.",
            newThreadHelp: "체크하면 다음 실행부터 저장된 thread id를 무시하고 새 Codex thread로 시작합니다. 체크 해제하면 마지막 thread를 이어갑니다."
        }
        var en = {
            connecting: "connecting",
            waitingForBridge: "waiting for bridge",
            connected: "connected",
            disconnected: "disconnected",
            bridgeError: "bridge error",
            bridgeDisconnected: "bridge disconnected",
            idle: "idle",
            listening: "listening",
            wakeMatched: "wake matched",
            wakeRejected: "wake rejected",
            sttProcessing: "transcribing",
            submitting: "submitting",
            thinking: "thinking",
            running: "running",
            speaking: "speaking",
            approvalPending: "approval pending",
            error: "error",
            shutdown: "shutting down",
            wakePrefix: "wake: ",
            sessionNew: "session: new",
            sessionPrefix: "session: ",
            usagePrefix: "usage: ",
            queuedReferences: "Queued References",
            close: "Close",
            references: "References",
            referenceText: "reference text",
            add: "Add",
            refs: "Refs",
            clearRef: "Clear Ref",
            noReferencesQueued: "No references queued",
            referenceCountSuffix: " reference item(s) queued",
            commands: "Commands",
            recentQa: "Recent Q/A",
            hide: "Hide",
            settings: "Settings",
            language: "Language",
            gender: "Gender",
            voice: "Voice",
            rate: "Rate ",
            pitch: "Pitch ",
            volume: "Volume ",
            thinkingSound: "Thinking sound ",
            maxSpeech: "Max speech ",
            showRecentQa: "Show Recent Q/A panel",
            speakWakeWarning: "Speak wake warning",
            wakePhrasesReplace: "Wake phrases replace list",
            approvalAllowPhrases: "Approval allow phrases",
            approvalDenyPhrases: "Approval deny phrases",
            sessionAllowPhrases: "Session allow phrases",
            policyAllowPhrases: "Persistent allow phrases",
            networkPolicyAllowPhrases: "Network persistent allow phrases",
            codexThreadRestart: "Codex thread id (applies after restart)",
            alwaysStartNewThread: "Always start new thread",
            restoreDefaults: "Restore Defaults",
            apply: "Apply",
            stop: "STOP",
            ttsStop: "TTS Stop",
            micOn: "🎙",
            micOff: "🔇",
            microphoneOn: "microphone on",
            microphoneOff: "microphone off",
            clearCmds: "Clear Cmds",
            exit: "Exit",
            speech: "speech",
            command: "command",
            status: "status",
            voiceGuide: "1. Say a wake phrase first, such as codex or jarvis.\n2. Then speak naturally; the command is passed through to the agent.\n3. During approvals, say approve, deny, or approve for this session.\n4. References are attached to the next request only.\n5. STOP interrupts the current agent turn.",
            referenceHelp: "Enter filenames, URLs, or constraints only. Visual wraps them like CLI /add and attaches them to the next wake request.",
            languageHelp: "Choose TTS and response language. Visual UI language applies after restart.",
            genderHelp: "Sets preferred voice gender when available.",
            voiceHelp: "Overrides the installed macOS voice name.",
            rateHelp: "TTS speaking rate.",
            pitchHelp: "TTS voice pitch.",
            volumeHelp: "TTS output volume.",
            thinkingHelp: "Thinking-loop sound volume.",
            maxSpeechHelp: "Maximum utterance length, from 5 to 55 seconds.",
            chatHelp: "Shows or hides the Recent Q/A panel.",
            wakeWarningHelp: "Speaks or mutes wake mismatch warnings.",
            wakePhrasesHelp: "One wake phrase per line replaces the current list.",
            approvalAllowHelp: "Phrases that approve once during permission prompts.",
            approvalDenyHelp: "Phrases that deny permission prompts. Overlaps can be treated as unknown.",
            sessionAllowHelp: "Phrases that approve for the current session.",
            policyAllowHelp: "Phrases that keep allowing the same command or execution policy.",
            networkPolicyAllowHelp: "Phrases that keep allowing the same network, host, or domain.",
            threadHelp: "Codex thread id to resume after restart.",
            newThreadHelp: "Starts a new Codex thread on restart when checked; resumes the last thread when unchecked."
        }
        var table = root.uiLanguage === "ko" ? ko : en
        return table[key] || en[key] || key
    }

    function stateText(state) {
        if (state === "idle") return root.uiText("idle")
        if (state === "listening") return root.uiText("listening")
        if (state === "wake_matched") return root.uiText("wakeMatched")
        if (state === "wake_rejected") return root.uiText("wakeRejected")
        if (state === "stt_processing") return root.uiText("sttProcessing")
        if (state === "submitting") return root.uiText("submitting")
        if (state === "thinking") return root.uiText("thinking")
        if (state === "running") return root.uiText("running")
        if (state === "speaking") return root.uiText("speaking")
        if (state === "approval_pending") return root.uiText("approvalPending")
        if (state === "error") return root.uiText("error")
        if (state === "shutdown") return root.uiText("shutdown")
        return state
    }

    function displayText(rawText, state) {
        var trimmed = String(rawText || "").trim()
        if (trimmed.length === 0 || trimmed === state) return root.stateText(state)
        if (trimmed === "microphone on") return root.uiText("microphoneOn")
        if (trimmed === "microphone off") return root.uiText("microphoneOff")
        if (trimmed === "waiting for bridge") return root.uiText("waitingForBridge")
        if (trimmed === "connecting") return root.uiText("connecting")
        if (trimmed === "connected") return root.uiText("connected")
        if (trimmed === "bridge disconnected") return root.uiText("bridgeDisconnected")
        if (trimmed === "idle") return root.uiText("idle")
        return trimmed
    }

    function normalizeUiLanguage(value) {
        return value === "ko" ? "ko" : "en"
    }

    function initializeUiLanguage(event) {
        if (root.uiLanguageInitialized) return
        var language = ""
        if (event && event.visual && event.visual.responseLanguage) language = event.visual.responseLanguage
        else if (event && event.tts && event.tts.language) language = event.tts.language
        root.uiLanguage = root.normalizeUiLanguage(language)
        root.uiLanguageInitialized = true
        root.referenceListText = root.formatReferenceList(root.contextEntries)
        if (root.statusText === "connecting" || root.statusText === "waiting for bridge" || root.statusText === "connected" || root.statusText === "idle") {
            root.statusText = root.stateText(root.uiState)
        }
    }

    function argumentValue(name, fallback) {
        var args = Qt.application.arguments
        for (var index = 0; index < args.length - 1; index += 1) {
            if (args[index] === name) return args[index + 1]
        }
        return fallback
    }

    function sendControl(action, text) {
        if (socket.status === WebSocket.Open) {
            var payload = {
                op: "voice-agent-ui",
                type: "control",
                action: action
            }
            if (text !== undefined) payload.text = text
            if (action === "mic_toggle") payload.micEnabled = !root.micEnabled
            socket.sendTextMessage(JSON.stringify(payload))
        }

        if (action === "clear_commands") {
            commands = []
            commandText = ""
        }
        if (action === "clear_context") contextEntries = []
        if (action === "mic_toggle") root.micEnabled = !root.micEnabled
        if (action === "exit") exitTimer.restart()
    }

    function sendSettings() {
        if (socket.status === WebSocket.Open) {
            socket.sendTextMessage(JSON.stringify({
                op: "voice-agent-ui",
                type: "control",
                action: "update_tts_settings",
                tts: {
                    language: languageBox.currentText,
                    gender: genderBox.currentText,
                    voiceName: voiceField.text.trim(),
                    rate: rateSlider.value,
                    pitch: pitchSlider.value,
                    volume: volumeSlider.value
                }
            }))
            socket.sendTextMessage(JSON.stringify({
                op: "voice-agent-ui",
                type: "control",
                action: "update_wake_phrases",
                wakePhrases: root.parseWakePhrases(wakeField.text)
            }))
            socket.sendTextMessage(JSON.stringify({
                op: "voice-agent-ui",
                type: "control",
                action: "update_approval_phrases",
                approvalPhrases: {
                    onceApprove: root.parseWakePhrases(approvalOnceField.text),
                    deny: root.parseWakePhrases(approvalDenyField.text),
                    sessionApprove: root.parseWakePhrases(approvalSessionField.text),
                    policyApprove: root.parseWakePhrases(approvalPolicyField.text),
                    networkPolicyApprove: root.parseWakePhrases(approvalNetworkPolicyField.text)
                }
            }))
            socket.sendTextMessage(JSON.stringify({
                op: "voice-agent-ui",
                type: "control",
                action: "update_codex_thread_id",
                codexThreadId: codexThreadField.text.trim(),
                codexAlwaysStartNewThread: newThreadCheck.checked
            }))
            socket.sendTextMessage(JSON.stringify({
                op: "voice-agent-ui",
                type: "control",
                action: "update_visual_settings",
                visual: {
                    thinkingVolume: root.thinkingVolume,
                    maxUtteranceSeconds: root.maxUtteranceSeconds,
                    responseLanguage: languageBox.currentText,
                    chatHistoryEnabled: chatHistoryCheck.checked,
                    speakWakeRejectedWarnings: wakeWarningCheck.checked
                }
            }))
        }
        settingsOpen = false
    }

    function resetSettings() {
        root.thinkingVolume = 0.32
        root.maxUtteranceSeconds = 15
        root.chatHistoryEnabled = true
        root.speakWakeRejectedWarnings = true
        root.codexAlwaysStartNewThread = false
        root.chatPanelOpen = true
        if (thinkingVolumeSlider) thinkingVolumeSlider.value = root.thinkingVolume
        if (maxUtteranceSlider) maxUtteranceSlider.value = root.maxUtteranceSeconds
        if (chatHistoryCheck) chatHistoryCheck.checked = true
        if (wakeWarningCheck) wakeWarningCheck.checked = true
        if (newThreadCheck) newThreadCheck.checked = false
        if (socket.status === WebSocket.Open) {
            socket.sendTextMessage(JSON.stringify({
                op: "voice-agent-ui",
                type: "control",
                action: "reset_settings"
            }))
        }
    }

    function indexOfValue(values, value) {
        for (var index = 0; index < values.length; index += 1) {
            if (values[index] === value) return index
        }
        return 0
    }

    function applyTtsSettings(settings) {
        root.ttsLanguage = settings.language || "auto"
        root.ttsGender = settings.gender || "auto"
        root.ttsVoiceName = settings.voiceName || ""
        root.ttsRate = settings.rate === undefined ? 0.56 : settings.rate
        root.ttsPitch = settings.pitch === undefined ? 1.0 : settings.pitch
        root.ttsVolume = settings.volume === undefined ? 1.0 : settings.volume
        if (languageBox) languageBox.currentIndex = root.indexOfValue(["auto", "ko", "en"], root.ttsLanguage)
        if (genderBox) genderBox.currentIndex = root.indexOfValue(["auto", "female", "male"], root.ttsGender)
        if (voiceField) voiceField.text = root.ttsVoiceName
        if (rateSlider) rateSlider.value = root.ttsRate
        if (pitchSlider) pitchSlider.value = root.ttsPitch
        if (volumeSlider) volumeSlider.value = root.ttsVolume
    }

    function applyWakePhrases(phrases) {
        root.wakePhrases = root.normalizedPhrases(phrases || [])
        if (wakeField) wakeField.text = root.wakePhrases.join("\n")
    }

    function applyApprovalPhrases(phrases) {
        root.approvalOncePhrases = root.normalizedPhrases((phrases && phrases.onceApprove) || [])
        root.approvalDenyPhrases = root.normalizedPhrases((phrases && phrases.deny) || [])
        root.approvalSessionPhrases = root.normalizedPhrases((phrases && phrases.sessionApprove) || [])
        root.approvalPolicyPhrases = root.normalizedPhrases((phrases && phrases.policyApprove) || [])
        root.approvalNetworkPolicyPhrases = root.normalizedPhrases((phrases && phrases.networkPolicyApprove) || [])
        if (approvalOnceField) approvalOnceField.text = root.approvalOncePhrases.join("\n")
        if (approvalDenyField) approvalDenyField.text = root.approvalDenyPhrases.join("\n")
        if (approvalSessionField) approvalSessionField.text = root.approvalSessionPhrases.join("\n")
        if (approvalPolicyField) approvalPolicyField.text = root.approvalPolicyPhrases.join("\n")
        if (approvalNetworkPolicyField) approvalNetworkPolicyField.text = root.approvalNetworkPolicyPhrases.join("\n")
    }

    function applyVisualSettings(event) {
        if (event.tts) root.applyTtsSettings(event.tts)
        if (event.visual) root.applyRuntimeVisualSettings(event.visual)
        if (event.wakePhrases) root.applyWakePhrases(event.wakePhrases)
        if (event.approvalPhrases) root.applyApprovalPhrases(event.approvalPhrases)
        if (event.codexThreadId !== undefined) root.applyCodexThreadId(event.codexThreadId)
        if (event.codexAlwaysStartNewThread !== undefined) root.applyCodexAlwaysStartNewThread(event.codexAlwaysStartNewThread)
        if (event.micEnabled !== undefined) root.micEnabled = !!event.micEnabled
    }

    function applyRuntimeVisualSettings(settings) {
        root.thinkingVolume = settings.thinkingVolume === undefined ? 0.32 : Math.max(0, Math.min(0.8, settings.thinkingVolume))
        root.maxUtteranceSeconds = settings.maxUtteranceSeconds === undefined ? 15 : Math.max(5, Math.min(55, settings.maxUtteranceSeconds))
        root.responseLanguage = settings.responseLanguage || "auto"
        root.chatHistoryEnabled = settings.chatHistoryEnabled === undefined ? true : !!settings.chatHistoryEnabled
        root.speakWakeRejectedWarnings = settings.speakWakeRejectedWarnings === undefined ? true : !!settings.speakWakeRejectedWarnings
        if (root.chatHistoryEnabled && !root.chatPanelOpen) root.chatPanelOpen = true
        if (thinkingVolumeSlider) thinkingVolumeSlider.value = root.thinkingVolume
        if (maxUtteranceSlider) maxUtteranceSlider.value = root.maxUtteranceSeconds
        if (chatHistoryCheck) chatHistoryCheck.checked = root.chatHistoryEnabled
        if (wakeWarningCheck) wakeWarningCheck.checked = root.speakWakeRejectedWarnings
        if (languageBox) languageBox.currentIndex = root.indexOfValue(["auto", "ko", "en"], root.responseLanguage)
    }

    function applyCodexThreadId(threadId) {
        root.codexThreadId = threadId || ""
        if (codexThreadField) codexThreadField.text = root.codexThreadId
    }

    function applyCodexAlwaysStartNewThread(value) {
        root.codexAlwaysStartNewThread = !!value
        if (newThreadCheck) newThreadCheck.checked = root.codexAlwaysStartNewThread
    }

    function parseWakePhrases(text) {
        return root.normalizedPhrases(text.split(/[,\n]/))
    }

    function normalizedPhrases(values) {
        var result = []
        for (var index = 0; index < values.length; index += 1) {
            var phrase = String(values[index]).trim()
            if (phrase.length === 0) continue
            if (result.indexOf(phrase) === -1) result.push(phrase)
        }
        return result
    }

    function addContextFromInput() {
        var text = contextInput.text.trim()
        root.sendControl("add_context", text)
        if (text.length > 0) contextInput.text = ""
    }

    function pushCommand(text) {
        var next = commands.slice()
        next.unshift(text)
        commands = next.slice(0, 8)
        commandText = commands.map(function(command) { return "• " + command }).join("\n\n")
    }

    function formatReferenceList(entries) {
        if (!entries || entries.length === 0) return root.uiText("noReferencesQueued") + "."
        return entries.map(function(entry, index) {
            return (index + 1) + ". " + entry
        }).join("\n")
    }

    function pushChat(role, kind, text) {
        var trimmed = String(text || "").trim()
        if (trimmed.length === 0) return
        var next = chatItems.slice()
        next.push({
            role: role,
            kind: kind,
            text: trimmed
        })
        chatItems = next.slice(Math.max(0, next.length - 10))
    }

    function chatBubbleColor(role, kind) {
        if (role === "user") return "#142337"
        if (kind === "command") return "#131b26"
        if (kind === "status") return "#151d2b"
        if (kind === "error") return "#31131b"
        return "#10252f"
    }

    function chatBorderColor(role, kind) {
        if (role === "user") return "#2b5e9e"
        if (kind === "command") return "#324057"
        if (kind === "status") return "#3b4660"
        if (kind === "error") return "#9d2f45"
        return "#266070"
    }

    function chatLabel(kind) {
        if (kind === "question") return "Q"
        if (kind === "speech") return root.uiText("speech")
        if (kind === "command") return root.uiText("command")
        if (kind === "status") return root.uiText("status")
        if (kind === "error") return root.uiText("error")
        return kind
    }

    function stateColor() {
        if (uiState === "approval_pending") return "#ffd166"
        if (uiState === "error") return "#ff4d6d"
        if (uiState === "wake_rejected") return "#ff3b5f"
        if (uiState === "stt_processing") return "#34d5ff"
        if (uiState === "submitting") return "#ffb347"
        if (uiState === "speaking") return "#7bdff2"
        if (uiState === "wake_matched") return "#ff7a18"
        if (uiState === "listening") return "#47f5a6"
        if (uiState === "thinking" || uiState === "running") return "#9b8cff"
        return "#5a6778"
    }

    function stateHue() {
        if (uiState === "approval_pending") return 46
        if (uiState === "error") return 345
        if (uiState === "wake_rejected") return 350
        if (uiState === "stt_processing") return 198
        if (uiState === "submitting") return 36
        if (uiState === "speaking") return 190
        if (uiState === "wake_matched") return 24
        if (uiState === "listening") return 148
        if (uiState === "thinking" || uiState === "running") return 262
        return 210
    }

    function stateActivityFloor() {
        if (uiState === "speaking") return 0.42 + Math.sin(visualPhase * 2.2) * 0.08
        if (uiState === "stt_processing") return 0.50
        if (uiState === "submitting") return 0.62
        if (uiState === "thinking" || uiState === "running") return 0.28
        if (uiState === "approval_pending") return 0.34
        if (uiState === "wake_rejected") return 0.70
        if (uiState === "wake_matched") return 0.72
        return 0.0
    }

    function isThinkingAudioState(state) {
        return state === "thinking" || state === "running"
    }

    function statusBandHeight() {
        if (uiState === "approval_pending") return Math.round(Math.min(220, Math.max(148, height * 0.30)))
        if (uiState === "wake_rejected") return Math.round(Math.min(expandedLayout ? 190 : 150, Math.max(118, height * (expandedLayout ? 0.20 : 0.19))))
        if (uiState === "speaking") return Math.round(Math.min(expandedLayout ? 180 : 132, Math.max(96, height * (expandedLayout ? 0.18 : 0.17))))
        if (expandedLayout) return Math.max(32, commandPanel.y - waveform.y - waveform.height - 20)
        return Math.min(statusLabel.implicitHeight + 8, Math.max(32, commandPanel.y - waveform.y - waveform.height - 20))
    }

    WebSocket {
        id: socket
        url: root.bridgeUrl
        active: root.bridgeUrl.length > 0

        onStatusChanged: {
            if (status === WebSocket.Open) root.statusText = root.uiText("connected")
            else if (status === WebSocket.Closed) root.statusText = root.uiText("disconnected")
            else if (status === WebSocket.Error) root.statusText = root.uiText("bridgeError")
        }

        onTextMessageReceived: function(message) {
            var event = JSON.parse(message)
            if (event.op !== "voice-agent-ui") return
            var previousState = root.uiState

            if (event.type === "state") {
                root.uiState = event.state
                root.statusText = root.displayText(event.text || "", event.state)
                if (root.isThinkingAudioState(event.state) && !root.isThinkingAudioState(previousState)) {
                    root.glow = Math.max(root.glow, 0.18)
                    thinkingEffect.play()
                    thinkingPulseTimer.restart()
                }
                if (event.state === "wake_rejected") {
                    root.glow = 1
                    rejectReset.restart()
                }
            } else if (event.type === "volume") {
                root.rms = Math.min(1, Math.max(0, event.rms * 14))
                root.peak = Math.min(1, Math.max(0, event.peak * 5))
            } else if (event.type === "wake") {
                root.uiState = "wake_matched"
                root.statusText = root.uiText("wakePrefix") + event.phrase
                root.glow = 1
                wakeEffect.play()
                glowReset.restart()
            } else if (event.type === "question") {
                root.currentQuestion = event.text || ""
                root.pushChat("user", "question", event.text)
            } else if (event.type === "command") {
                root.pushCommand(event.text)
                root.pushChat("assistant", "command", event.text)
            } else if (event.type === "speech") {
                root.uiState = "speaking"
                root.statusText = event.text
                root.pushChat("assistant", "speech", event.text)
            } else if (event.type === "status") {
                root.statusText = event.text
                root.pushChat("assistant", "status", event.text)
            } else if (event.type === "error") {
                root.uiState = "error"
                root.statusText = event.text
                root.pushChat("assistant", "error", event.text)
            } else if (event.type === "approval") {
                root.uiState = "approval_pending"
                root.statusText = event.text
                root.pushChat("assistant", "status", event.text)
            } else if (event.type === "usage") {
                root.usageText = event.text || ""
            } else if (event.type === "context") {
                root.contextEntries = event.entries || []
                if (root.contextEntries.length === 0) contextInput.text = ""
            } else if (event.type === "context_list") {
                root.contextEntries = event.entries || []
                root.referenceListText = root.formatReferenceList(root.contextEntries)
                referenceListPopup.open()
            } else if (event.type === "settings") {
                root.initializeUiLanguage(event)
                root.applyVisualSettings(event)
            }
        }
    }

    SoundEffect {
        id: wakeEffect
        // Short embedded wake click. If a Qt runtime does not support data URLs,
        // the visual flash still carries the wake event.
        source: "data:audio/wav;base64,UklGRjQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YRAAAAAA/38A/38A/38A/38A/38A/38A/38A/38="
        volume: 0.25
    }

    SoundEffect {
        id: thinkingEffect
        source: Qt.resolvedUrl("thinking-pulse.wav")
        volume: root.thinkingVolume
    }

    Timer {
        id: thinkingPulseTimer
        interval: 1900
        running: root.isThinkingAudioState(root.uiState)
        repeat: true
        onTriggered: {
            root.glow = Math.max(root.glow, 0.18)
            thinkingEffect.play()
        }
    }

    Timer {
        id: glowReset
        interval: 650
        onTriggered: root.glow = 0
    }

    Timer {
        id: exitTimer
        interval: 180
        onTriggered: Qt.quit()
    }

    Timer {
        id: rejectReset
        interval: 3600
        onTriggered: {
            if (root.uiState === "wake_rejected") {
                root.uiState = "idle"
                root.statusText = root.stateText("idle")
                root.glow = 0
            }
        }
    }

    Timer {
        interval: 33
        running: true
        repeat: true
        onTriggered: {
            var stateBoost = root.uiState === "speaking" ? 0.035 : root.uiState === "stt_processing" ? 0.055 : root.uiState === "submitting" ? 0.07 : root.uiState === "wake_rejected" ? 0.09 : root.uiState === "thinking" ? 0.025 : 0
            root.visualPhase += 0.045 + root.rms * 0.035 + root.glow * 0.025 + stateBoost
            waveform.requestPaint()
        }
    }

    NumberAnimation on rms {
        duration: 120
        easing.type: Easing.OutQuad
    }

    Button {
        id: guideButton
        anchors.top: parent.top
        anchors.right: parent.right
        anchors.margins: 16
        width: 30
        height: 30
        text: "?"
        z: 12
        onClicked: guidePopup.open()
    }

    Item {
        id: sessionBadge
        anchors.top: parent.top
        anchors.left: parent.left
        anchors.margins: 16
        width: Math.min(root.width - guideButton.width - 56, 360)
        height: 28
        z: 12

        Text {
            anchors.fill: parent
            anchors.leftMargin: 10
            anchors.rightMargin: 10
            verticalAlignment: Text.AlignVCenter
            text: root.codexThreadId.length > 0 ? root.uiText("sessionPrefix") + root.codexThreadId : root.uiText("sessionNew")
            color: "#9fb0c7"
            font.pixelSize: 12
            elide: Text.ElideMiddle
        }
    }

    Item {
        id: usageBadge
        anchors.top: sessionBadge.bottom
        anchors.left: parent.left
        anchors.leftMargin: 16
        anchors.topMargin: 2
        width: Math.min(root.width - guideButton.width - 56, 520)
        height: 18
        visible: root.usageText.length > 0
        z: 12

        Text {
            anchors.fill: parent
            verticalAlignment: Text.AlignVCenter
            horizontalAlignment: Text.AlignLeft
            text: root.usageText.length > 0 ? root.uiText("usagePrefix") + root.usageText : ""
            color: "#b8ccec"
            font.pixelSize: 11
            font.family: "Menlo"
            elide: Text.ElideRight
        }
    }

    Popup {
        id: guidePopup
        x: Math.max(18, root.width - width - 18)
        y: guideButton.y + guideButton.height + 8
        width: Math.min(root.width - 36, 460)
        padding: 14
        closePolicy: Popup.CloseOnEscape | Popup.CloseOnPressOutside
        z: 13
        background: Rectangle {
            radius: 8
            color: "#0d131c"
            border.color: "#3b4c64"
            border.width: 1
        }
        contentItem: Text {
            text: root.voiceGuideText
            wrapMode: Text.WordWrap
            color: "#d9e2ef"
            font.pixelSize: 13
            lineHeight: 1.18
            lineHeightMode: Text.ProportionalHeight
        }
    }

    Popup {
        id: referenceHelpPopup
        x: Math.max(18, Math.min(root.width - width - 18, content.x + commandPanel.x + commandPanel.width - width - 12))
        y: Math.max(18, content.y + commandPanel.y + 30)
        width: Math.min(root.width - 36, 380)
        padding: 12
        closePolicy: Popup.CloseOnEscape | Popup.CloseOnPressOutside
        z: 13
        background: Rectangle {
            radius: 8
            color: "#0d131c"
            border.color: "#3b4c64"
            border.width: 1
        }
        contentItem: Text {
            text: root.referenceHelpText
            wrapMode: Text.WordWrap
            color: "#d9e2ef"
            font.pixelSize: 13
            lineHeight: 1.16
            lineHeightMode: Text.ProportionalHeight
        }
    }

    Popup {
        id: referenceListPopup
        x: Math.max(18, Math.min(root.width - width - 18, content.x + commandPanel.x + commandPanel.width - width - 12))
        y: Math.max(18, Math.min(root.height - height - 18, content.y + commandPanel.y - height - 10))
        width: Math.min(root.width - 36, 520)
        height: Math.min(root.height - 72, 340)
        padding: 12
        closePolicy: Popup.CloseOnEscape | Popup.CloseOnPressOutside
        z: 14
        background: Rectangle {
            radius: 8
            color: "#0d131c"
            border.color: "#3b4c64"
            border.width: 1
        }
        contentItem: ColumnLayout {
            spacing: 8

            RowLayout {
                Layout.fillWidth: true

                Text {
                    Layout.fillWidth: true
                    text: root.uiText("queuedReferences")
                    color: "#91a4bd"
                    font.pixelSize: 13
                    font.bold: true
                }

                Button {
                    text: root.uiText("close")
                    onClicked: referenceListPopup.close()
                }
            }

            ScrollView {
                Layout.fillWidth: true
                Layout.fillHeight: true
                clip: true

                TextArea {
                    text: root.referenceListText
                    color: "#f4f7fb"
                    font.pixelSize: 14
                    font.family: "Menlo"
                    readOnly: true
                    selectByMouse: true
                    wrapMode: TextEdit.WrapAnywhere
                    persistentSelection: true
                    background: Rectangle {
                        color: "transparent"
                    }
                }
            }
        }
    }

    Item {
        id: content
        anchors.fill: parent
        anchors.margins: 24

        Canvas {
            id: waveform
            width: root.visualDiameter
            height: root.visualDiameter
            anchors.centerIn: parent
            anchors.horizontalCenterOffset: root.chatPanelVisible ? -Math.round(root.chatPanelWidth / 2) : 0
            anchors.verticalCenterOffset: root.visualCenterYOffset
            antialiasing: true
            opacity: 0.96

            onPaint: {
                    var ctx = getContext("2d")
                    var w = width
                    var h = height
                    var cx = w / 2
                    var cy = h / 2
                    var phase = root.visualPhase
                    var hue = root.stateHue()
                    var scale = Math.min(w, h) / 300
                    var activity = Math.max(root.rms, root.peak * 0.45, root.glow * 0.85, root.stateActivityFloor())
                    var base = Math.min(w, h) * 0.31 + activity * 16 * scale
                    var amp = (8 + root.rms * 40 + root.peak * 18 + root.glow * 24) * scale
                    if (root.uiState === "speaking") amp += (12 + Math.max(0, Math.sin(phase * 2.2)) * 12) * scale
                    if (root.uiState === "stt_processing") amp = (6 + Math.sin(phase * 2.0) * 2) * scale
                    if (root.uiState === "submitting") amp = (10 + Math.max(0, Math.sin(phase * 3.1)) * 10) * scale
                    if (root.uiState === "wake_rejected") amp = (16 + Math.max(0, Math.sin(phase * 5.1)) * 18) * scale

                    ctx.clearRect(0, 0, w, h)

                    var halo = ctx.createRadialGradient(cx, cy, 52 * scale, cx, cy, 148 * scale)
                    halo.addColorStop(0, "hsla(" + hue + ", 95%, 58%, 0.00)")
                    halo.addColorStop(0.48, "hsla(" + hue + ", 95%, 58%, " + (0.10 + activity * 0.20) + ")")
                    halo.addColorStop(1, "hsla(" + ((hue + 38) % 360) + ", 95%, 58%, 0.00)")
                    ctx.fillStyle = halo
                    ctx.beginPath()
                    ctx.arc(cx, cy, 146 * scale, 0, Math.PI * 2)
                    ctx.fill()

                    drawWaveRing(ctx, cx, cy, base + 2, amp, phase, hue, 3.4, 0.88, 0)
                    drawWaveRing(ctx, cx, cy, base - 10, amp * 0.42, phase * 1.18 + 1.7, (hue + 42) % 360, 1.5, 0.48, 1)
                    if (root.uiState === "speaking") {
                        drawSpeakingWaves(ctx, cx, cy, base + 20, phase, hue)
                    } else if (root.uiState === "stt_processing") {
                        drawProcessingIndicator(ctx, cx, cy, base + 25, phase, hue)
                    } else if (root.uiState === "submitting") {
                        drawSubmittingIndicator(ctx, cx, cy, base + 18, phase, hue)
                    } else if (root.uiState === "thinking") {
                        drawThinkingIndicator(ctx, cx, cy, base + 18, phase, hue)
                    } else if (root.uiState === "wake_rejected") {
                        drawRejectedIndicator(ctx, cx, cy, base + 15, phase, hue)
                    } else {
                        drawOuterTicks(ctx, cx, cy, base + 12, amp, phase, hue)
                    }

                    ctx.strokeStyle = "rgba(60, 76, 98, 0.45)"
                    ctx.lineWidth = 1
                    ctx.beginPath()
                    ctx.arc(cx, cy, base - 26, 0, Math.PI * 2)
                    ctx.stroke()
                }

                function noise(angle, phase, lane) {
                    return Math.sin(angle * 3.1 + phase * 1.7 + lane) * 0.42
                        + Math.sin(angle * 7.0 - phase * 1.12 + lane * 1.9) * 0.28
                        + Math.sin(angle * 13.0 + phase * 0.67 + lane * 0.6) * 0.18
                        + Math.sin(angle * 21.0 - phase * 0.38 + lane * 2.4) * 0.12
                }

                function radiusAt(angle, base, amp, phase, lane) {
                    return base + noise(angle, phase, lane) * amp
                }

                function drawWaveRing(ctx, cx, cy, base, amp, phase, hue, lineWidth, alpha, lane) {
                    var steps = 180
                    ctx.lineWidth = lineWidth
                    ctx.lineCap = "round"
                    ctx.lineJoin = "round"
                    ctx.strokeStyle = "hsla(" + hue + ", 96%, 62%, " + alpha + ")"
                    ctx.shadowColor = "hsla(" + hue + ", 96%, 58%, 0.45)"
                    ctx.shadowBlur = 18 + root.glow * 18
                    ctx.beginPath()

                    for (var index = 0; index <= steps; index += 1) {
                        var angle = (index / steps) * Math.PI * 2
                        var r = radiusAt(angle, base, amp, phase, lane)
                        var x = cx + Math.cos(angle) * r
                        var y = cy + Math.sin(angle) * r
                        if (index === 0) ctx.moveTo(x, y)
                        else ctx.lineTo(x, y)
                    }

                    ctx.closePath()
                    ctx.stroke()
                    ctx.shadowBlur = 0
                }

                function drawOuterTicks(ctx, cx, cy, base, amp, phase, hue) {
                    var count = 92
                    ctx.lineCap = "round"
                    for (var index = 0; index < count; index += 1) {
                        var angle = (index / count) * Math.PI * 2
                        var n = Math.max(0, noise(angle, phase, 2.8))
                        var burst = Math.max(0, Math.sin(angle * 5.0 - phase * 1.6))
                        var length = 4 + n * (amp * 0.52) + burst * root.peak * 36 + root.glow * 10
                        var inner = base + 16 + n * 7
                        var outer = inner + length
                        var tickHue = (hue + index * 1.7 + Math.sin(angle * 3 + phase) * 22 + 360) % 360

                        ctx.strokeStyle = "hsla(" + tickHue + ", 96%, 62%, " + (0.32 + n * 0.55 + root.glow * 0.2) + ")"
                        ctx.lineWidth = 1.2 + n * 2.4 + root.peak * 2.0
                        ctx.beginPath()
                        ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner)
                        ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer)
                        ctx.stroke()
                    }
                }

                function drawSpeakingWaves(ctx, cx, cy, base, phase, hue) {
                    ctx.lineCap = "round"
                    for (var ring = 0; ring < 3; ring += 1) {
                        var radius = base + ring * 15 + (phase * 26 + ring * 11) % 28
                        var alpha = Math.max(0, 0.46 - ring * 0.12 - ((radius - base) / 80) * 0.22)
                        ctx.strokeStyle = "hsla(" + ((hue + ring * 18) % 360) + ", 96%, 64%, " + alpha + ")"
                        ctx.lineWidth = 2.1 - ring * 0.35
                        ctx.beginPath()
                        ctx.arc(cx, cy, radius, Math.PI * 0.12, Math.PI * 1.88)
                        ctx.stroke()
                    }

                    for (var index = 0; index < 56; index += 1) {
                        var angle = (index / 56) * Math.PI * 2
                        var gate = Math.max(0, Math.sin(angle * 4 - phase * 2.8))
                        var length = 5 + gate * 18 + Math.max(0, Math.sin(phase * 2.1 + index)) * 8
                        var inner = base + 8 + gate * 4
                        var outer = inner + length
                        ctx.strokeStyle = "hsla(" + ((hue + 22 + index * 1.2) % 360) + ", 96%, 66%, " + (0.24 + gate * 0.42) + ")"
                        ctx.lineWidth = 1.4 + gate * 1.7
                        ctx.beginPath()
                        ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner)
                        ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer)
                        ctx.stroke()
                    }
                }

                function drawProcessingIndicator(ctx, cx, cy, base, phase, hue) {
                    ctx.lineCap = "round"
                    for (var arc = 0; arc < 4; arc += 1) {
                        var start = phase * 1.8 + arc * Math.PI * 0.58
                        var sweep = Math.PI * (0.25 + arc * 0.035)
                        ctx.strokeStyle = "hsla(" + ((hue + arc * 24) % 360) + ", 96%, 64%, " + (0.78 - arc * 0.13) + ")"
                        ctx.lineWidth = 3.2 - arc * 0.35
                        ctx.beginPath()
                        ctx.arc(cx, cy, base + arc * 7, start, start + sweep)
                        ctx.stroke()
                    }

                    for (var dot = 0; dot < 10; dot += 1) {
                        var angle = phase * 2.4 + dot * Math.PI * 0.2
                        var pulse = 0.55 + Math.sin(phase * 3 + dot) * 0.35
                        var radius = base - 20 + dot % 2 * 8
                        var size = 1.8 + pulse * 2.4
                        ctx.fillStyle = "hsla(" + ((hue + dot * 8) % 360) + ", 96%, 66%, " + (0.32 + pulse * 0.45) + ")"
                        ctx.beginPath()
                        ctx.arc(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius, size, 0, Math.PI * 2)
                        ctx.fill()
                    }
                }

                function drawSubmittingIndicator(ctx, cx, cy, base, phase, hue) {
                    ctx.lineCap = "round"
                    for (var lane = 0; lane < 5; lane += 1) {
                        var angle = phase * 2.6 + lane * Math.PI * 0.42
                        var inner = base - 24 + lane * 4
                        var outer = base + 22 + Math.max(0, Math.sin(phase * 2.4 + lane)) * 14
                        ctx.strokeStyle = "hsla(" + ((hue + lane * 12) % 360) + ", 96%, 64%, " + (0.78 - lane * 0.08) + ")"
                        ctx.lineWidth = 3.6 - lane * 0.32
                        ctx.beginPath()
                        ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner)
                        ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer)
                        ctx.stroke()
                    }

                    for (var arc = 0; arc < 3; arc += 1) {
                        var start = phase * 2.8 + arc * Math.PI * 0.72
                        ctx.strokeStyle = "hsla(" + ((hue + 28 + arc * 16) % 360) + ", 96%, 66%, " + (0.42 - arc * 0.08) + ")"
                        ctx.lineWidth = 1.8
                        ctx.beginPath()
                        ctx.arc(cx, cy, base + 30 + arc * 9, start, start + Math.PI * 0.38)
                        ctx.stroke()
                    }
                }

                function drawThinkingIndicator(ctx, cx, cy, base, phase, hue) {
                    ctx.lineCap = "round"
                    for (var orbit = 0; orbit < 6; orbit += 1) {
                        var radius = base + 8 + orbit * 9 + Math.sin(phase * 1.35 + orbit) * 6
                        var start = phase * (0.62 + orbit * 0.09) + orbit * Math.PI * 0.34
                        var sweep = Math.PI * (0.30 + orbit * 0.035)
                        ctx.strokeStyle = "hsla(" + ((hue + orbit * 18) % 360) + ", 96%, " + (66 + orbit * 1.6) + "%, " + (0.52 - orbit * 0.055) + ")"
                        ctx.lineWidth = 2.8 - orbit * 0.22
                        ctx.beginPath()
                        ctx.arc(cx, cy, radius, start, start + sweep)
                        ctx.stroke()
                    }

                    for (var spoke = 0; spoke < 28; spoke += 1) {
                        var spokeAngle = spoke * Math.PI * 2 / 28 + phase * 0.26
                        var breath = 0.55 + Math.sin(phase * 1.5 + spoke * 0.45) * 0.32
                        var inner = base + 20 + breath * 6
                        var outer = inner + 10 + Math.max(0, Math.sin(spokeAngle * 4 - phase * 1.8)) * 20
                        ctx.strokeStyle = "hsla(" + ((hue + 34 + spoke * 1.4) % 360) + ", 98%, 70%, " + (0.14 + breath * 0.22) + ")"
                        ctx.lineWidth = 1.1 + breath * 1.6
                        ctx.beginPath()
                        ctx.moveTo(cx + Math.cos(spokeAngle) * inner, cy + Math.sin(spokeAngle) * inner)
                        ctx.lineTo(cx + Math.cos(spokeAngle) * outer, cy + Math.sin(spokeAngle) * outer)
                        ctx.stroke()
                    }

                    for (var dot = 0; dot < 16; dot += 1) {
                        var angle = phase * 1.05 + dot * Math.PI * 2 / 16
                        var pulse = 0.48 + Math.sin(phase * 1.9 + dot * 0.7) * 0.30
                        var dotRadius = base - 14 + pulse * 10
                        var size = 2.2 + pulse * 2.8
                        ctx.fillStyle = "hsla(" + ((hue + dot * 3.0) % 360) + ", 96%, 74%, " + (0.28 + pulse * 0.38) + ")"
                        ctx.beginPath()
                        ctx.arc(cx + Math.cos(angle) * dotRadius, cy + Math.sin(angle) * dotRadius, size, 0, Math.PI * 2)
                        ctx.fill()
                    }
                }

            function drawRejectedIndicator(ctx, cx, cy, base, phase, hue) {
                    ctx.lineCap = "round"
                    for (var index = 0; index < 84; index += 1) {
                        var angle = (index / 84) * Math.PI * 2
                        var n = Math.max(0, Math.sin(angle * 9 + phase * 4.0))
                        var snap = Math.max(0, Math.sin(angle * 3 - phase * 5.5))
                        var inner = base + 5 + snap * 5
                        var outer = inner + 5 + n * 28 + root.glow * 12
                        ctx.strokeStyle = "hsla(" + ((hue + index * 0.8) % 360) + ", 98%, 62%, " + (0.34 + n * 0.54) + ")"
                        ctx.lineWidth = 1.4 + n * 3.2
                        ctx.beginPath()
                        ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner)
                        ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer)
                        ctx.stroke()
                    }

                    ctx.strokeStyle = "hsla(" + hue + ", 98%, 66%, 0.82)"
                    ctx.lineWidth = 3.4
                    ctx.beginPath()
                    ctx.arc(cx, cy, base - 18, phase * 2.4, phase * 2.4 + Math.PI * 0.22)
                    ctx.stroke()
                    ctx.beginPath()
                    ctx.arc(cx, cy, base - 18, phase * 2.4 + Math.PI, phase * 2.4 + Math.PI * 1.22)
                    ctx.stroke()
            }
        }

        Rectangle {
            id: questionBackdrop
            anchors.centerIn: questionLabel
            width: Math.min(root.width - 16, questionLabel.width + 36)
            height: questionLabel.height + 26
            radius: 11
            color: "#05080c"
            opacity: root.currentQuestion.length > 0 ? 0.72 : 0
            border.color: "#1d3347"
            border.width: opacity > 0 ? 1 : 0
            z: 0
        }

        Text {
            id: questionLabel
            anchors.horizontalCenter: parent.horizontalCenter
            anchors.horizontalCenterOffset: root.chatPanelVisible ? -Math.round(root.chatPanelWidth / 2) : 0
            y: Math.max(0, Math.min(waveform.y + waveform.height + 8, commandPanel.y - height - 8))
            width: Math.min(root.width - root.mainRightInset - 20, parent.width - root.mainRightInset + 20)
            height: root.currentQuestion.length > 0 ? implicitHeight : 0
            visible: root.currentQuestion.length > 0
            horizontalAlignment: Text.AlignHCenter
            verticalAlignment: Text.AlignVCenter
            wrapMode: Text.WordWrap
            maximumLineCount: root.expandedLayout ? 3 : 2
            elide: Text.ElideRight
            text: root.currentQuestion.length > 0 ? "Q: " + root.currentQuestion : ""
            color: "#e7edf7"
            font.pixelSize: root.expandedLayout ? 17 : 15
            font.bold: true
            lineHeight: 1.08
            lineHeightMode: Text.ProportionalHeight
            z: 1
        }

        Rectangle {
            id: statusBackdrop
            anchors.centerIn: statusLabel
            width: Math.min(root.width - 16, parent.width + 32)
            height: statusLabel.height + (root.uiState === "approval_pending" ? 28 : (root.uiState === "speaking" || root.uiState === "wake_rejected") ? 24 : 20)
            radius: root.uiState === "approval_pending" ? 14 : 12
            color: "#05080c"
            opacity: (root.uiState === "speaking" || root.uiState === "approval_pending" || root.uiState === "wake_rejected") && root.statusText.length > 0 ? 0.82 : 0
            border.color: root.uiState === "approval_pending" ? "#ffd166" : root.uiState === "wake_rejected" ? "#ff3b5f" : "#203246"
            border.width: opacity > 0 ? 1 : 0
            z: 0
        }

        Text {
            id: statusLabel
            anchors.horizontalCenter: parent.horizontalCenter
            anchors.horizontalCenterOffset: root.chatPanelVisible ? -Math.round(root.chatPanelWidth / 2) : 0
            y: root.uiState === "speaking" || root.uiState === "approval_pending" || root.uiState === "wake_rejected"
                ? Math.max(0, commandPanel.y - height - 10)
                : Math.max(0, Math.min(root.currentQuestion.length > 0 ? questionLabel.y + questionLabel.height + 6 : waveform.y + waveform.height + 10, commandPanel.y - height - 10))
            width: Math.min(root.width - root.mainRightInset - 16, parent.width - root.mainRightInset + 32)
            height: root.statusBandHeight()
            horizontalAlignment: Text.AlignHCenter
            verticalAlignment: Text.AlignVCenter
            wrapMode: Text.WordWrap
            maximumLineCount: root.uiState === "approval_pending" || root.uiState === "wake_rejected" ? 8 : root.expandedLayout ? 99 : 3
            elide: root.expandedLayout ? Text.ElideNone : Text.ElideRight
            text: root.statusText
            color: "#d9e2ef"
            font.pixelSize: root.uiState === "approval_pending" || root.uiState === "wake_rejected" ? 14 : root.uiState === "speaking" ? (root.expandedLayout ? 24 : 21) : 16
            font.bold: root.uiState === "speaking" || root.uiState === "wake_rejected"
            lineHeight: 1.12
            lineHeightMode: Text.ProportionalHeight
            z: 1
        }

        Rectangle {
            id: commandPanel
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.rightMargin: root.mainRightInset
            anchors.bottom: controls.top
            anchors.bottomMargin: 10
            height: root.commandPanelHeight
            radius: 8
            color: "#101620"
            border.color: "#243042"

            ColumnLayout {
                anchors.fill: parent
                anchors.margins: 14
                spacing: 8

                RowLayout {
                    Layout.fillWidth: true
                    spacing: 6

                    Text {
                        Layout.fillWidth: true
                        text: root.uiText("references")
                        color: "#91a4bd"
                        font.pixelSize: 13
                        font.bold: true
                    }

                    Button {
                        Layout.preferredWidth: 24
                        Layout.preferredHeight: 22
                        text: "?"
                        hoverEnabled: true
                        onHoveredChanged: {
                            if (hovered) referenceHelpPopup.open()
                            else referenceHelpPopup.close()
                        }
                    }
                }

                RowLayout {
                    Layout.fillWidth: true
                    spacing: 8

                    TextField {
                        id: contextInput
                        Layout.fillWidth: true
                        placeholderText: root.uiText("referenceText")
                        selectByMouse: true
                        onAccepted: root.addContextFromInput()
                    }

                    Button {
                        text: root.uiText("add")
                        onClicked: root.addContextFromInput()
                    }

                    Button {
                        text: root.uiText("refs")
                        onClicked: root.sendControl("show_context")
                    }

                    Button {
                        text: root.uiText("clearRef")
                        onClicked: root.sendControl("clear_context")
                    }
                }

                Text {
                    Layout.fillWidth: true
                    text: root.contextEntries.length > 0 ? root.contextEntries.length + root.uiText("referenceCountSuffix") : root.uiText("noReferencesQueued")
                    color: root.contextEntries.length > 0 ? "#ffd166" : "#68778b"
                    font.pixelSize: 12
                    elide: Text.ElideRight
                }

                Text {
                    text: root.uiText("commands")
                    color: "#91a4bd"
                    font.pixelSize: 13
                    font.bold: true
                }

                ScrollView {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    clip: true

                    TextArea {
                        id: commandTextArea
                        text: root.commandText
                        color: "#f4f7fb"
                        font.pixelSize: 14
                        font.family: "Menlo"
                        readOnly: true
                        selectByMouse: true
                        wrapMode: TextEdit.WrapAnywhere
                        persistentSelection: true
                        background: Rectangle {
                            color: "transparent"
                        }
                    }
                }
            }
        }

        Rectangle {
            id: chatPanel
            visible: root.chatPanelVisible
            anchors.top: parent.top
            anchors.right: parent.right
            anchors.bottom: controls.top
            anchors.bottomMargin: 10
            width: root.chatPanelWidth
            radius: 10
            color: "#0b1119"
            border.color: "#26354a"
            border.width: 1
            z: 4

            ColumnLayout {
                anchors.fill: parent
                anchors.margins: 14
                spacing: 10

                RowLayout {
                    Layout.fillWidth: true
                    spacing: 8

                    Text {
                        id: chatTitle
                        text: root.uiText("recentQa")
                        color: "#e7edf7"
                        font.pixelSize: 15
                        font.bold: true
                    }

                    Button {
                        text: root.uiText("hide")
                        onClicked: root.chatPanelOpen = false
                    }

                    Item {
                        Layout.fillWidth: true
                    }
                }

                ListView {
                    id: chatList
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    clip: true
                    spacing: 8
                    model: root.chatItems
                    onCountChanged: positionViewAtEnd()
                    ScrollBar.vertical: ScrollBar {
                        width: 8
                        policy: ScrollBar.AsNeeded
                    }

                    delegate: Item {
                        width: Math.max(0, ListView.view.width - 14)
                        height: Math.max(52, bubbleColumn.implicitHeight + 22)

                        Rectangle {
                            id: bubble
                            width: parent.width * 0.88
                            height: parent.height
                            x: modelData.role === "user" ? parent.width - width : 0
                            radius: 12
                            color: root.chatBubbleColor(modelData.role, modelData.kind)
                            border.color: root.chatBorderColor(modelData.role, modelData.kind)
                            border.width: 1

                            Column {
                                id: bubbleColumn
                                anchors.fill: parent
                                anchors.margins: 10
                                spacing: 4

                                Text {
                                    id: bubbleKind
                                    width: parent.width
                                    text: root.chatLabel(modelData.kind)
                                    color: modelData.role === "user" ? "#8fc7ff" : "#9fb0c7"
                                    font.pixelSize: 11
                                    font.bold: true
                                }

                                TextArea {
                                    id: bubbleText
                                    width: parent.width
                                    text: modelData.text
                                    color: "#f4f7fb"
                                    font.pixelSize: modelData.kind === "command" ? 12 : 13
                                    font.family: modelData.kind === "command" ? "Menlo" : ""
                                    readOnly: true
                                    selectByMouse: true
                                    persistentSelection: true
                                    wrapMode: modelData.kind === "command" ? TextEdit.WrapAnywhere : TextEdit.WordWrap
                                    lineHeight: 1.12
                                    lineHeightMode: Text.ProportionalHeight
                                    background: Rectangle {
                                        color: "transparent"
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        Button {
            id: chatOpenButton
            visible: root.chatPanelAvailable && !root.chatPanelOpen
            text: "Q/A"
            anchors.top: parent.top
            anchors.right: parent.right
            anchors.topMargin: 62
            anchors.rightMargin: 16
            z: 6
            onClicked: root.chatPanelOpen = true
        }

        Rectangle {
            id: settingsPanel
            visible: root.settingsOpen
            anchors.centerIn: parent
            width: Math.min(parent.width - 44, 460)
            height: Math.min(parent.height - 24, 660)
            radius: 8
            color: "#0d131c"
            border.color: "#34445c"
            border.width: 1
            z: 8

            ColumnLayout {
                anchors.fill: parent
                anchors.margins: 16
                spacing: 10

                RowLayout {
                    Layout.fillWidth: true

                    Text {
                        Layout.fillWidth: true
                        text: root.uiText("settings")
                        color: "#f4f7fb"
                        font.pixelSize: 16
                        font.bold: true
                    }

                    Button {
                        text: root.uiText("close")
                        onClicked: root.settingsOpen = false
                    }
                }

                RowLayout {
                    Layout.fillWidth: true
                    spacing: 10

                    Text {
                        text: root.uiText("language")
                        color: "#91a4bd"
                        Layout.preferredWidth: 76
                    }

                    ComboBox {
                        id: languageBox
                        Layout.fillWidth: true
                        model: ["auto", "ko", "en"]
                        currentIndex: root.indexOfValue(["auto", "ko", "en"], root.ttsLanguage)
                    }

                    Button {
                        text: "?"
                        Layout.preferredWidth: 22
                        Layout.preferredHeight: 22
                        hoverEnabled: true
                        ToolTip.visible: hovered
                        ToolTip.delay: 250
                        ToolTip.text: root.uiText("languageHelp")
                    }
                }

                RowLayout {
                    Layout.fillWidth: true
                    spacing: 10

                    Text {
                        text: root.uiText("gender")
                        color: "#91a4bd"
                        Layout.preferredWidth: 76
                    }

                    ComboBox {
                        id: genderBox
                        Layout.fillWidth: true
                        model: ["auto", "female", "male"]
                        currentIndex: root.indexOfValue(["auto", "female", "male"], root.ttsGender)
                    }

                    Button {
                        text: "?"
                        Layout.preferredWidth: 22
                        Layout.preferredHeight: 22
                        hoverEnabled: true
                        ToolTip.visible: hovered
                        ToolTip.delay: 250
                        ToolTip.text: root.uiText("genderHelp")
                    }
                }

                RowLayout {
                    Layout.fillWidth: true
                    spacing: 10

                    Text {
                        text: root.uiText("voice")
                        color: "#91a4bd"
                        Layout.preferredWidth: 76
                    }

                    TextField {
                        id: voiceField
                        Layout.fillWidth: true
                        placeholderText: "Yuna, Samantha..."
                        text: root.ttsVoiceName
                        selectByMouse: true
                    }

                    Button {
                        text: "?"
                        Layout.preferredWidth: 22
                        Layout.preferredHeight: 22
                        hoverEnabled: true
                        ToolTip.visible: hovered
                        ToolTip.delay: 250
                        ToolTip.text: root.uiText("voiceHelp")
                    }
                }

                RowLayout {
                    Layout.fillWidth: true

                    Text {
                        Layout.fillWidth: true
                        text: root.uiText("rate") + rateSlider.value.toFixed(2)
                        color: "#91a4bd"
                    }

                    Button {
                        text: "?"
                        Layout.preferredWidth: 22
                        Layout.preferredHeight: 22
                        hoverEnabled: true
                        ToolTip.visible: hovered
                        ToolTip.delay: 250
                        ToolTip.text: root.uiText("rateHelp")
                    }
                }

                Slider {
                    id: rateSlider
                    Layout.fillWidth: true
                    from: 0.35
                    to: 0.78
                    value: root.ttsRate
                    stepSize: 0.01
                }

                RowLayout {
                    Layout.fillWidth: true

                    Text {
                        Layout.fillWidth: true
                        text: root.uiText("pitch") + pitchSlider.value.toFixed(2)
                        color: "#91a4bd"
                    }

                    Button {
                        text: "?"
                        Layout.preferredWidth: 22
                        Layout.preferredHeight: 22
                        hoverEnabled: true
                        ToolTip.visible: hovered
                        ToolTip.delay: 250
                        ToolTip.text: root.uiText("pitchHelp")
                    }
                }

                Slider {
                    id: pitchSlider
                    Layout.fillWidth: true
                    from: 0.7
                    to: 1.4
                    value: root.ttsPitch
                    stepSize: 0.01
                }

                RowLayout {
                    Layout.fillWidth: true

                    Text {
                        Layout.fillWidth: true
                        text: root.uiText("volume") + volumeSlider.value.toFixed(2)
                        color: "#91a4bd"
                    }

                    Button {
                        text: "?"
                        Layout.preferredWidth: 22
                        Layout.preferredHeight: 22
                        hoverEnabled: true
                        ToolTip.visible: hovered
                        ToolTip.delay: 250
                        ToolTip.text: root.uiText("volumeHelp")
                    }
                }

                Slider {
                    id: volumeSlider
                    Layout.fillWidth: true
                    from: 0.2
                    to: 1.0
                    value: root.ttsVolume
                    stepSize: 0.01
                }

                RowLayout {
                    Layout.fillWidth: true

                    Text {
                        Layout.fillWidth: true
                        text: root.uiText("thinkingSound") + thinkingVolumeSlider.value.toFixed(2)
                        color: "#91a4bd"
                    }

                    Button {
                        text: "?"
                        Layout.preferredWidth: 22
                        Layout.preferredHeight: 22
                        hoverEnabled: true
                        ToolTip.visible: hovered
                        ToolTip.delay: 250
                        ToolTip.text: root.uiText("thinkingHelp")
                    }
                }

                Slider {
                    id: thinkingVolumeSlider
                    Layout.fillWidth: true
                    from: 0.0
                    to: 0.8
                    value: root.thinkingVolume
                    stepSize: 0.01
                    onValueChanged: root.thinkingVolume = value
                }

                RowLayout {
                    Layout.fillWidth: true

                    Text {
                        Layout.fillWidth: true
                        text: root.uiText("maxSpeech") + Math.round(maxUtteranceSlider.value) + "s"
                        color: "#91a4bd"
                    }

                    Button {
                        text: "?"
                        Layout.preferredWidth: 22
                        Layout.preferredHeight: 22
                        hoverEnabled: true
                        ToolTip.visible: hovered
                        ToolTip.delay: 250
                        ToolTip.text: root.uiText("maxSpeechHelp")
                    }
                }

                Slider {
                    id: maxUtteranceSlider
                    Layout.fillWidth: true
                    from: 5
                    to: 55
                    value: root.maxUtteranceSeconds
                    stepSize: 1
                    onValueChanged: root.maxUtteranceSeconds = value
                }

                RowLayout {
                    Layout.fillWidth: true

                    CheckBox {
                        id: chatHistoryCheck
                        Layout.fillWidth: true
                        text: root.uiText("showRecentQa")
                        checked: root.chatHistoryEnabled
                        onCheckedChanged: root.chatHistoryEnabled = checked
                    }

                    Button {
                        text: "?"
                        Layout.preferredWidth: 22
                        Layout.preferredHeight: 22
                        hoverEnabled: true
                        ToolTip.visible: hovered
                        ToolTip.delay: 250
                        ToolTip.text: root.uiText("chatHelp")
                    }
                }

                RowLayout {
                    Layout.fillWidth: true

                    CheckBox {
                        id: wakeWarningCheck
                        Layout.fillWidth: true
                        text: root.uiText("speakWakeWarning")
                        checked: root.speakWakeRejectedWarnings
                        onCheckedChanged: root.speakWakeRejectedWarnings = checked
                    }

                    Button {
                        text: "?"
                        Layout.preferredWidth: 22
                        Layout.preferredHeight: 22
                        hoverEnabled: true
                        ToolTip.visible: hovered
                        ToolTip.delay: 250
                        ToolTip.text: root.uiText("wakeWarningHelp")
                    }
                }

                RowLayout {
                    Layout.fillWidth: true

                    Text {
                        Layout.fillWidth: true
                        text: root.uiText("wakePhrasesReplace")
                        color: "#91a4bd"
                    }

                    Button {
                        text: "?"
                        Layout.preferredWidth: 22
                        Layout.preferredHeight: 22
                        hoverEnabled: true
                        ToolTip.visible: hovered
                        ToolTip.delay: 250
                        ToolTip.text: root.uiText("wakePhrasesHelp")
                    }
                }

                ScrollView {
                    Layout.fillWidth: true
                    Layout.preferredHeight: 92
                    clip: true

                    TextArea {
                        id: wakeField
                        text: root.wakePhrases.join("\n")
                        placeholderText: "코덱스\n자비스\nhey jarvis"
                        selectByMouse: true
                        wrapMode: TextEdit.WrapAnywhere
                    }
                }

                RowLayout {
                    Layout.fillWidth: true

                    Text {
                        Layout.fillWidth: true
                        text: root.uiText("approvalAllowPhrases")
                        color: "#91a4bd"
                    }

                    Button {
                        text: "?"
                        Layout.preferredWidth: 22
                        Layout.preferredHeight: 22
                        hoverEnabled: true
                        ToolTip.visible: hovered
                        ToolTip.delay: 250
                        ToolTip.text: root.uiText("approvalAllowHelp")
                    }
                }

                ScrollView {
                    Layout.fillWidth: true
                    Layout.preferredHeight: 64
                    clip: true

                    TextArea {
                        id: approvalOnceField
                        text: root.approvalOncePhrases.join("\n")
                        placeholderText: "허용\n승인\napprove"
                        selectByMouse: true
                        wrapMode: TextEdit.WrapAnywhere
                    }
                }

                RowLayout {
                    Layout.fillWidth: true

                    Text {
                        Layout.fillWidth: true
                        text: root.uiText("approvalDenyPhrases")
                        color: "#91a4bd"
                    }

                    Button {
                        text: "?"
                        Layout.preferredWidth: 22
                        Layout.preferredHeight: 22
                        hoverEnabled: true
                        ToolTip.visible: hovered
                        ToolTip.delay: 250
                        ToolTip.text: root.uiText("approvalDenyHelp")
                    }
                }

                ScrollView {
                    Layout.fillWidth: true
                    Layout.preferredHeight: 64
                    clip: true

                    TextArea {
                        id: approvalDenyField
                        text: root.approvalDenyPhrases.join("\n")
                        placeholderText: "거부\n아니\ndeny"
                        selectByMouse: true
                        wrapMode: TextEdit.WrapAnywhere
                    }
                }

                RowLayout {
                    Layout.fillWidth: true

                    Text {
                        Layout.fillWidth: true
                        text: root.uiText("sessionAllowPhrases")
                        color: "#91a4bd"
                    }

                    Button {
                        text: "?"
                        Layout.preferredWidth: 22
                        Layout.preferredHeight: 22
                        hoverEnabled: true
                        ToolTip.visible: hovered
                        ToolTip.delay: 250
                        ToolTip.text: root.uiText("sessionAllowHelp")
                    }
                }

                ScrollView {
                    Layout.fillWidth: true
                    Layout.preferredHeight: 64
                    clip: true

                    TextArea {
                        id: approvalSessionField
                        text: root.approvalSessionPhrases.join("\n")
                        placeholderText: "이번 세션 동안 허용\nalways allow"
                        selectByMouse: true
                        wrapMode: TextEdit.WrapAnywhere
                    }
                }

                RowLayout {
                    Layout.fillWidth: true

                    Text {
                        Layout.fillWidth: true
                        text: root.uiText("policyAllowPhrases")
                        color: "#91a4bd"
                    }

                    Button {
                        text: "?"
                        Layout.preferredWidth: 22
                        Layout.preferredHeight: 22
                        hoverEnabled: true
                        ToolTip.visible: hovered
                        ToolTip.delay: 250
                        ToolTip.text: root.uiText("policyAllowHelp")
                    }
                }

                ScrollView {
                    Layout.fillWidth: true
                    Layout.preferredHeight: 64
                    clip: true

                    TextArea {
                        id: approvalPolicyField
                        text: root.approvalPolicyPhrases.join("\n")
                        placeholderText: "같은 명령 계속 허용\n항상 이 명령 허용"
                        selectByMouse: true
                        wrapMode: TextEdit.WrapAnywhere
                    }
                }

                RowLayout {
                    Layout.fillWidth: true

                    Text {
                        Layout.fillWidth: true
                        text: root.uiText("networkPolicyAllowPhrases")
                        color: "#91a4bd"
                    }

                    Button {
                        text: "?"
                        Layout.preferredWidth: 22
                        Layout.preferredHeight: 22
                        hoverEnabled: true
                        ToolTip.visible: hovered
                        ToolTip.delay: 250
                        ToolTip.text: root.uiText("networkPolicyAllowHelp")
                    }
                }

                ScrollView {
                    Layout.fillWidth: true
                    Layout.preferredHeight: 64
                    clip: true

                    TextArea {
                        id: approvalNetworkPolicyField
                        text: root.approvalNetworkPolicyPhrases.join("\n")
                        placeholderText: "같은 네트워크 계속 허용\n이 호스트 계속 허용"
                        selectByMouse: true
                        wrapMode: TextEdit.WrapAnywhere
                    }
                }

                Text {
                    text: root.uiText("codexThreadRestart")
                    color: "#91a4bd"
                }

                RowLayout {
                    Layout.fillWidth: true

                    TextField {
                        id: codexThreadField
                        Layout.fillWidth: true
                        placeholderText: "019e..."
                        text: root.codexThreadId
                        selectByMouse: true
                    }

                    Button {
                        text: "?"
                        Layout.preferredWidth: 22
                        Layout.preferredHeight: 22
                        hoverEnabled: true
                        ToolTip.visible: hovered
                        ToolTip.delay: 250
                        ToolTip.text: root.uiText("threadHelp")
                    }
                }

                RowLayout {
                    Layout.fillWidth: true

                    CheckBox {
                        id: newThreadCheck
                        Layout.fillWidth: true
                        text: root.uiText("alwaysStartNewThread")
                        checked: root.codexAlwaysStartNewThread
                        onCheckedChanged: root.codexAlwaysStartNewThread = checked
                    }

                    Button {
                        text: "?"
                        Layout.preferredWidth: 22
                        Layout.preferredHeight: 22
                        hoverEnabled: true
                        ToolTip.visible: hovered
                        ToolTip.delay: 250
                        ToolTip.text: root.uiText("newThreadHelp")
                    }
                }

                RowLayout {
                    Layout.fillWidth: true
                    spacing: 10

                    Button {
                        Layout.fillWidth: true
                        text: root.uiText("restoreDefaults")
                        onClicked: root.resetSettings()
                    }

                    Button {
                        Layout.fillWidth: true
                        text: root.uiText("apply")
                        onClicked: root.sendSettings()
                    }
                }
            }
        }

        RowLayout {
            id: controls
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.bottom: parent.bottom
            height: root.controlsHeight
            spacing: 10

            Button {
                Layout.fillWidth: true
                text: root.uiText("stop")
                onClicked: root.sendControl("emergency_stop")
                palette.button: "#7a2730"
                palette.buttonText: "#ffffff"
            }
            Button {
                Layout.fillWidth: true
                text: root.uiText("settings")
                onClicked: root.settingsOpen = !root.settingsOpen
            }
            Button {
                Layout.fillWidth: true
                text: root.uiText("ttsStop")
                onClicked: root.sendControl("tts_stop")
            }
            Button {
                Layout.fillWidth: true
                text: root.micEnabled ? root.uiText("micOff") : root.uiText("micOn")
                onClicked: root.sendControl("mic_toggle")
            }
            Button {
                Layout.fillWidth: true
                text: root.uiText("clearCmds")
                onClicked: root.sendControl("clear_commands")
            }
            Button {
                Layout.fillWidth: true
                text: root.uiText("exit")
                onClicked: root.sendControl("exit")
            }
        }
    }
}
