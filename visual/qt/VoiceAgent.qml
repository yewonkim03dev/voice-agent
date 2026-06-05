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

            Rectangle {
                id: circle
                width: 230 + root.rms * 44 + root.glow * 30
                height: width
                radius: width / 2
                anchors.centerIn: parent
                color: "transparent"
                border.width: 6 + root.peak * 10
                border.color: root.stateColor()
                opacity: 0.92

                Behavior on width {
                    NumberAnimation { duration: 130; easing.type: Easing.OutQuad }
                }
                Behavior on border.width {
                    NumberAnimation { duration: 100; easing.type: Easing.OutQuad }
                }
                Behavior on border.color {
                    ColorAnimation { duration: 180 }
                }

                SequentialAnimation on scale {
                    loops: Animation.Infinite
                    NumberAnimation { from: 0.98; to: 1.025; duration: 1400; easing.type: Easing.InOutSine }
                    NumberAnimation { from: 1.025; to: 0.98; duration: 1400; easing.type: Easing.InOutSine }
                }

                Rectangle {
                    anchors.fill: parent
                    anchors.margins: 22
                    radius: width / 2
                    color: "transparent"
                    border.width: 1
                    border.color: "#263241"
                    opacity: 0.85
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
