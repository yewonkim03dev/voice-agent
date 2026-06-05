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
    property real rms: 0.0
    property real peak: 0.0
    property real glow: 0.0
    property real visualPhase: 0.0
    property bool expandedLayout: width >= 760 || height >= 760
    property int controlsHeight: 38
    property int commandPanelHeight: Math.round(Math.max(132, Math.min(expandedLayout ? 220 : 172, height * (expandedLayout ? 0.22 : 0.25))))
    property int visualDiameter: Math.round(Math.max(220, Math.min(width * (expandedLayout ? 0.78 : 0.84), height * (expandedLayout ? 0.60 : 0.48), height - commandPanelHeight - controlsHeight - 92, expandedLayout ? 720 : 360)))
    property var commands: []
    property var contextEntries: []
    property bool settingsOpen: false
    property string ttsLanguage: "auto"
    property string ttsGender: "auto"
    property string ttsVoiceName: ""
    property real ttsRate: 0.56
    property real ttsPitch: 1.0
    property real ttsVolume: 1.0
    property var wakePhrases: []

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
            socket.sendTextMessage(JSON.stringify(payload))
        }

        if (action === "clear_commands") commands = []
        if (action === "clear_context") contextEntries = []
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
        }
        settingsOpen = false
    }

    function resetSettings() {
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

    function applyVisualSettings(event) {
        if (event.tts) root.applyTtsSettings(event.tts)
        if (event.wakePhrases) root.applyWakePhrases(event.wakePhrases)
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
            if (status === WebSocket.Open) root.statusText = "connected"
            else if (status === WebSocket.Closed) root.statusText = "disconnected"
            else if (status === WebSocket.Error) root.statusText = "bridge error"
        }

        onTextMessageReceived: function(message) {
            var event = JSON.parse(message)
            if (event.op !== "voice-agent-ui") return
            var previousState = root.uiState

            if (event.type === "state") {
                root.uiState = event.state
                root.statusText = event.text || event.state
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
                root.statusText = "wake: " + event.phrase
                root.glow = 1
                wakeEffect.play()
                glowReset.restart()
            } else if (event.type === "command") {
                root.pushCommand(event.text)
            } else if (event.type === "speech") {
                root.uiState = "speaking"
                root.statusText = event.text
            } else if (event.type === "status") {
                root.statusText = event.text
            } else if (event.type === "error") {
                root.uiState = "error"
                root.statusText = event.text
            } else if (event.type === "approval") {
                root.uiState = "approval_pending"
                root.statusText = event.text
            } else if (event.type === "context") {
                root.contextEntries = event.entries || []
                if (root.contextEntries.length === 0) contextInput.text = ""
            } else if (event.type === "settings") {
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
        volume: 0.32
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
                root.statusText = "idle"
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

    Item {
        id: content
        anchors.fill: parent
        anchors.margins: 24

        Canvas {
            id: waveform
            width: root.visualDiameter
            height: root.visualDiameter
            anchors.centerIn: parent
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
            id: statusBackdrop
            anchors.centerIn: statusLabel
            width: parent.width
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
            y: root.uiState === "speaking" || root.uiState === "approval_pending" || root.uiState === "wake_rejected"
                ? Math.max(0, commandPanel.y - height - 10)
                : Math.max(0, Math.min(waveform.y + waveform.height + 10, commandPanel.y - height - 10))
            width: parent.width
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

                Text {
                    text: "References"
                    color: "#91a4bd"
                    font.pixelSize: 13
                    font.bold: true
                }

                RowLayout {
                    Layout.fillWidth: true
                    spacing: 8

                    TextField {
                        id: contextInput
                        Layout.fillWidth: true
                        placeholderText: "/add reference text"
                        selectByMouse: true
                        onAccepted: root.addContextFromInput()
                    }

                    Button {
                        text: "Add"
                        onClicked: root.addContextFromInput()
                    }

                    Button {
                        text: "Clear Ref"
                        onClicked: root.sendControl("clear_context")
                    }
                }

                Text {
                    Layout.fillWidth: true
                    text: root.contextEntries.length > 0 ? root.contextEntries.length + " reference item(s) queued" : "No references queued"
                    color: root.contextEntries.length > 0 ? "#ffd166" : "#68778b"
                    font.pixelSize: 12
                    elide: Text.ElideRight
                }

                Text {
                    text: "Commands"
                    color: "#91a4bd"
                    font.pixelSize: 13
                    font.bold: true
                }

                ListView {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    clip: true
                    model: root.commands
                    delegate: Text {
                        width: ListView.view.width
                        text: "• " + modelData
                        color: "#f4f7fb"
                        font.pixelSize: 14
                        elide: Text.ElideRight
                    }
                }
            }
        }

        Rectangle {
            id: settingsPanel
            visible: root.settingsOpen
            anchors.centerIn: parent
            width: Math.min(parent.width - 44, 460)
            height: Math.min(parent.height - 80, 560)
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
                        text: "Settings"
                        color: "#f4f7fb"
                        font.pixelSize: 16
                        font.bold: true
                    }

                    Button {
                        text: "Close"
                        onClicked: root.settingsOpen = false
                    }
                }

                RowLayout {
                    Layout.fillWidth: true
                    spacing: 10

                    Text {
                        text: "Language"
                        color: "#91a4bd"
                        Layout.preferredWidth: 76
                    }

                    ComboBox {
                        id: languageBox
                        Layout.fillWidth: true
                        model: ["auto", "ko", "en"]
                        currentIndex: root.indexOfValue(["auto", "ko", "en"], root.ttsLanguage)
                    }
                }

                RowLayout {
                    Layout.fillWidth: true
                    spacing: 10

                    Text {
                        text: "Gender"
                        color: "#91a4bd"
                        Layout.preferredWidth: 76
                    }

                    ComboBox {
                        id: genderBox
                        Layout.fillWidth: true
                        model: ["auto", "female", "male"]
                        currentIndex: root.indexOfValue(["auto", "female", "male"], root.ttsGender)
                    }
                }

                RowLayout {
                    Layout.fillWidth: true
                    spacing: 10

                    Text {
                        text: "Voice"
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
                }

                Text {
                    text: "Rate " + rateSlider.value.toFixed(2)
                    color: "#91a4bd"
                }

                Slider {
                    id: rateSlider
                    Layout.fillWidth: true
                    from: 0.35
                    to: 0.78
                    value: root.ttsRate
                    stepSize: 0.01
                }

                Text {
                    text: "Pitch " + pitchSlider.value.toFixed(2)
                    color: "#91a4bd"
                }

                Slider {
                    id: pitchSlider
                    Layout.fillWidth: true
                    from: 0.7
                    to: 1.4
                    value: root.ttsPitch
                    stepSize: 0.01
                }

                Text {
                    text: "Volume " + volumeSlider.value.toFixed(2)
                    color: "#91a4bd"
                }

                Slider {
                    id: volumeSlider
                    Layout.fillWidth: true
                    from: 0.2
                    to: 1.0
                    value: root.ttsVolume
                    stepSize: 0.01
                }

                Text {
                    text: "Wake phrases"
                    color: "#91a4bd"
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
                    spacing: 10

                    Button {
                        Layout.fillWidth: true
                        text: "Restore Defaults"
                        onClicked: root.resetSettings()
                    }

                    Button {
                        Layout.fillWidth: true
                        text: "Apply"
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
                text: "STOP"
                onClicked: root.sendControl("emergency_stop")
                background: Rectangle {
                    radius: 5
                    color: parent.down ? "#7f0019" : "#b00020"
                    border.color: "#ff6b7a"
                    border.width: 1
                }
                contentItem: Text {
                    text: parent.text
                    color: "#ffffff"
                    font.bold: true
                    horizontalAlignment: Text.AlignHCenter
                    verticalAlignment: Text.AlignVCenter
                }
            }
            Button {
                Layout.fillWidth: true
                text: "Settings"
                onClicked: root.settingsOpen = !root.settingsOpen
            }
            Button {
                Layout.fillWidth: true
                text: "TTS Stop"
                onClicked: root.sendControl("tts_stop")
            }
            Button {
                Layout.fillWidth: true
                text: "Clear Cmds"
                onClicked: root.sendControl("clear_commands")
            }
            Button {
                Layout.fillWidth: true
                text: "Exit"
                onClicked: root.sendControl("exit")
            }
        }
    }
}
