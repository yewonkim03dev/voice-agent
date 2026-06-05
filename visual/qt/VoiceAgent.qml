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
    property int commandPanelHeight: Math.round(Math.max(86, Math.min(expandedLayout ? 150 : 112, height * (expandedLayout ? 0.15 : 0.17))))
    property int visualDiameter: Math.round(Math.max(220, Math.min(width * (expandedLayout ? 0.78 : 0.84), height * (expandedLayout ? 0.60 : 0.48), height - commandPanelHeight - controlsHeight - 92, expandedLayout ? 720 : 360)))
    property var commands: []

    function argumentValue(name, fallback) {
        var args = Qt.application.arguments
        for (var index = 0; index < args.length - 1; index += 1) {
            if (args[index] === name) return args[index + 1]
        }
        return fallback
    }

    function sendControl(action) {
        if (socket.status === WebSocket.Open) {
            socket.sendTextMessage(JSON.stringify({
                op: "voice-agent-ui",
                type: "control",
                action: action
            }))
        }

        if (action === "clear_commands") commands = []
        if (action === "exit") exitTimer.restart()
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
                if (event.state === "thinking" && previousState !== "thinking") {
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
        source: "data:audio/wav;base64,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"
        volume: 0.055
    }

    Timer {
        id: thinkingPulseTimer
        interval: 2600
        running: root.uiState === "thinking"
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
        interval: 900
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
                    for (var orbit = 0; orbit < 4; orbit += 1) {
                        var radius = base + 10 + orbit * 11 + Math.sin(phase * 1.35 + orbit) * 4
                        var start = phase * (0.55 + orbit * 0.08) + orbit * Math.PI * 0.44
                        var sweep = Math.PI * (0.34 + orbit * 0.025)
                        ctx.strokeStyle = "hsla(" + ((hue + orbit * 15) % 360) + ", 95%, 68%, " + (0.42 - orbit * 0.055) + ")"
                        ctx.lineWidth = 2.2 - orbit * 0.22
                        ctx.beginPath()
                        ctx.arc(cx, cy, radius, start, start + sweep)
                        ctx.stroke()
                    }

                    for (var dot = 0; dot < 12; dot += 1) {
                        var angle = phase * 0.9 + dot * Math.PI * 2 / 12
                        var pulse = 0.45 + Math.sin(phase * 1.8 + dot * 0.7) * 0.25
                        var dotRadius = base - 12 + pulse * 8
                        var size = 2.0 + pulse * 2.2
                        ctx.fillStyle = "hsla(" + ((hue + dot * 2.8) % 360) + ", 95%, 72%, " + (0.24 + pulse * 0.34) + ")"
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
            width: Math.min(parent.width, statusLabel.paintedWidth + 44)
            height: statusLabel.paintedHeight + 18
            radius: 12
            color: "#05080c"
            opacity: root.uiState === "speaking" && root.statusText.length > 0 ? 0.72 : 0
            border.color: "#203246"
            border.width: opacity > 0 ? 1 : 0
            z: 0
        }

        Text {
            id: statusLabel
            anchors.horizontalCenter: parent.horizontalCenter
            y: Math.max(0, Math.min(waveform.y + waveform.height + 10, commandPanel.y - height - 10))
            width: parent.width
            height: root.expandedLayout
                ? Math.max(32, commandPanel.y - waveform.y - waveform.height - 20)
                : Math.min(implicitHeight + 8, Math.max(32, commandPanel.y - waveform.y - waveform.height - 20))
            horizontalAlignment: Text.AlignHCenter
            verticalAlignment: Text.AlignVCenter
            wrapMode: Text.WordWrap
            maximumLineCount: root.expandedLayout ? 99 : 3
            elide: root.expandedLayout ? Text.ElideNone : Text.ElideRight
            text: root.statusText
            color: "#d9e2ef"
            font.pixelSize: 16
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

        RowLayout {
            id: controls
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.bottom: parent.bottom
            height: root.controlsHeight
            spacing: 10

            Button {
                Layout.fillWidth: true
                text: "TTS Stop"
                onClicked: root.sendControl("tts_stop")
            }
            Button {
                Layout.fillWidth: true
                text: "Clear"
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
