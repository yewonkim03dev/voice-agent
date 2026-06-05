import AppKit
import Foundation

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
    private var phase: CGFloat = 0

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in
            guard let self else { return }
            self.phase += 0.04
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

        let center = CGPoint(x: bounds.midX, y: bounds.midY + 10)
        let activity = max(rms, peak * 0.45, glow * 0.85)
        let baseRadius = min(bounds.width, bounds.height) * 0.31 + activity * 16
        let amplitude = 7 + rms * 42 + peak * 18 + glow * 24
        drawHalo(center: center, radius: baseRadius + 48, activity: activity)
        drawWaveRing(center: center, baseRadius: baseRadius + 2, amplitude: amplitude, phaseOffset: 0, alpha: 0.92, lineWidth: 3.6)
        drawWaveRing(center: center, baseRadius: baseRadius - 10, amplitude: amplitude * 0.42, phaseOffset: 1.7, alpha: 0.48, lineWidth: 1.6)
        drawOuterTicks(center: center, baseRadius: baseRadius + 16, amplitude: amplitude)
        drawInnerGuide(center: center, radius: baseRadius - 26)

        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = .center
        let attrs: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: 17, weight: .medium),
            .foregroundColor: NSColor(calibratedRed: 0.86, green: 0.89, blue: 0.94, alpha: 1),
            .paragraphStyle: paragraph
        ]
        let textRect = NSRect(x: 24, y: 18, width: bounds.width - 48, height: 28)
        statusText.draw(in: textRect, withAttributes: attrs)
    }

    private func stateColor() -> NSColor {
        switch state {
        case "approval_pending": return .systemYellow
        case "error": return .systemPink
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
        case "speaking": return 0.528
        case "wake_matched": return 0.067
        case "listening": return 0.411
        case "thinking", "running": return 0.728
        default: return 0.583
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

final class VisualAppDelegate: NSObject, NSApplicationDelegate {
    private let bridgeUrl: String
    private let circleView = AgentCircleView(frame: .zero)
    private let commandView = NSTextView(frame: .zero)
    private var webSocket: URLSessionWebSocketTask?
    private var commands: [String] = []

    init(bridgeUrl: String) {
        self.bridgeUrl = bridgeUrl
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 520, height: 680),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Voice Agent"
        window.center()
        window.contentView = buildContentView()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        connect()
    }

    private func buildContentView() -> NSView {
        let root = NSStackView()
        root.orientation = .vertical
        root.spacing = 14
        root.edgeInsets = NSEdgeInsets(top: 22, left: 22, bottom: 22, right: 22)
        root.wantsLayer = true
        root.layer?.backgroundColor = NSColor(calibratedRed: 0.03, green: 0.04, blue: 0.06, alpha: 1).cgColor

        circleView.heightAnchor.constraint(equalToConstant: 340).isActive = true
        root.addArrangedSubview(circleView)

        let label = NSTextField(labelWithString: "Commands")
        label.textColor = NSColor(calibratedRed: 0.57, green: 0.64, blue: 0.73, alpha: 1)
        label.font = NSFont.boldSystemFont(ofSize: 13)
        root.addArrangedSubview(label)

        commandView.isEditable = false
        commandView.drawsBackground = true
        commandView.backgroundColor = NSColor(calibratedRed: 0.06, green: 0.09, blue: 0.13, alpha: 1)
        commandView.textColor = .white
        commandView.font = NSFont.monospacedSystemFont(ofSize: 13, weight: .regular)
        let scroll = NSScrollView()
        scroll.documentView = commandView
        scroll.hasVerticalScroller = true
        scroll.borderType = .lineBorder
        scroll.heightAnchor.constraint(greaterThanOrEqualToConstant: 180).isActive = true
        root.addArrangedSubview(scroll)

        let controls = NSStackView()
        controls.orientation = .horizontal
        controls.distribution = .fillEqually
        controls.spacing = 10
        controls.addArrangedSubview(button("TTS Stop", action: #selector(stopTts)))
        controls.addArrangedSubview(button("Clear", action: #selector(clearCommands)))
        controls.addArrangedSubview(button("Exit", action: #selector(exitVisual)))
        root.addArrangedSubview(controls)

        return root
    }

    private func button(_ title: String, action: Selector) -> NSButton {
        let button = NSButton(title: title, target: self, action: action)
        button.bezelStyle = .rounded
        return button
    }

    private func connect() {
        guard let url = URL(string: bridgeUrl), !bridgeUrl.isEmpty else {
            circleView.statusText = "waiting for bridge"
            return
        }

        circleView.statusText = "connecting"
        let task = URLSession.shared.webSocketTask(with: url)
        webSocket = task
        task.resume()
        circleView.statusText = "connected"
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
                    self.circleView.statusText = "bridge disconnected"
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
            circleView.statusText = event["text"] as? String ?? circleView.state
        case "volume":
            circleView.rms = min(1, max(0, CGFloat(event["rms"] as? Double ?? 0) * 14))
            circleView.peak = min(1, max(0, CGFloat(event["peak"] as? Double ?? 0) * 5))
        case "wake":
            circleView.state = "wake_matched"
            circleView.statusText = "wake: \(event["phrase"] as? String ?? "")"
            circleView.glow = 1
            NSSound.beep()
        case "command":
            pushCommand(event["text"] as? String ?? "")
        case "speech":
            circleView.state = "speaking"
            circleView.statusText = event["text"] as? String ?? "speaking"
        case "status":
            circleView.statusText = event["text"] as? String ?? "status"
        case "error":
            circleView.state = "error"
            circleView.statusText = event["text"] as? String ?? "error"
        case "approval":
            circleView.state = "approval_pending"
            circleView.statusText = event["text"] as? String ?? "approval pending"
        default:
            break
        }
    }

    private func pushCommand(_ text: String) {
        guard !text.isEmpty else { return }
        commands.insert(text, at: 0)
        commands = Array(commands.prefix(8))
        commandView.string = commands.map { "• \($0)" }.joined(separator: "\n")
    }

    @objc private func stopTts() {
        sendControl("tts_stop")
    }

    @objc private func clearCommands() {
        commands.removeAll()
        commandView.string = ""
        sendControl("clear_commands")
    }

    @objc private func exitVisual() {
        sendControl("exit")
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.18) {
            NSApp.terminate(nil)
        }
    }

    private func sendControl(_ action: String) {
        let payload: [String: String] = [
            "op": "voice-agent-ui",
            "type": "control",
            "action": action
        ]
        guard
            let data = try? JSONSerialization.data(withJSONObject: payload),
            let text = String(data: data, encoding: .utf8)
        else { return }

        webSocket?.send(.string(text)) { _ in }
    }
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
