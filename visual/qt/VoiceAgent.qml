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
        if (uiState === "speaking") return "#7bdff2"
        if (uiState === "wake_matched") return "#ff7a18"
        if (uiState === "listening") return "#47f5a6"
        if (uiState === "thinking" || uiState === "running") return "#9b8cff"
        return "#5a6778"
    }

    function stateHue() {
        if (uiState === "approval_pending") return 46
        if (uiState === "error") return 345
        if (uiState === "speaking") return 190
        if (uiState === "wake_matched") return 24
        if (uiState === "listening") return 148
        if (uiState === "thinking" || uiState === "running") return 262
        return 210
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

            if (event.type === "state") {
                root.uiState = event.state
                root.statusText = event.text || event.state
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
        interval: 33
        running: true
        repeat: true
        onTriggered: {
            root.visualPhase += 0.045 + root.rms * 0.035 + root.glow * 0.025
            waveform.requestPaint()
        }
    }

    NumberAnimation on rms {
        duration: 120
        easing.type: Easing.OutQuad
    }

    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 24
        spacing: 18

        Item {
            Layout.fillWidth: true
            Layout.preferredHeight: 330

            Canvas {
                id: waveform
                width: 292
                height: 292
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
                    var activity = Math.max(root.rms, root.peak * 0.45, root.glow * 0.85)
                    var base = 88 + activity * 16
                    var amp = 8 + root.rms * 40 + root.peak * 18 + root.glow * 24

                    ctx.clearRect(0, 0, w, h)

                    var halo = ctx.createRadialGradient(cx, cy, 52, cx, cy, 148)
                    halo.addColorStop(0, "hsla(" + hue + ", 95%, 58%, 0.00)")
                    halo.addColorStop(0.48, "hsla(" + hue + ", 95%, 58%, " + (0.10 + activity * 0.20) + ")")
                    halo.addColorStop(1, "hsla(" + ((hue + 38) % 360) + ", 95%, 58%, 0.00)")
                    ctx.fillStyle = halo
                    ctx.beginPath()
                    ctx.arc(cx, cy, 146, 0, Math.PI * 2)
                    ctx.fill()

                    drawWaveRing(ctx, cx, cy, base + 2, amp, phase, hue, 3.4, 0.88, 0)
                    drawWaveRing(ctx, cx, cy, base - 10, amp * 0.42, phase * 1.18 + 1.7, (hue + 42) % 360, 1.5, 0.48, 1)
                    drawOuterTicks(ctx, cx, cy, base + 12, amp, phase, hue)

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
            }

            Text {
                anchors.horizontalCenter: parent.horizontalCenter
                anchors.bottom: parent.bottom
                width: parent.width
                horizontalAlignment: Text.AlignHCenter
                elide: Text.ElideRight
                text: root.statusText
                color: "#d9e2ef"
                font.pixelSize: 17
            }
        }

        Rectangle {
            Layout.fillWidth: true
            Layout.fillHeight: true
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
            Layout.fillWidth: true
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
