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

        let base = min(bounds.width, bounds.height) * 0.43
        let pulse = 1 + sin(phase) * 0.025
        let radius = base * pulse + rms * 42 + glow * 32
        let rect = NSRect(
            x: bounds.midX - radius / 2,
            y: bounds.midY - radius / 2 + 10,
            width: radius,
            height: radius
        )
        let path = NSBezierPath(ovalIn: rect)
        path.lineWidth = 5 + peak * 12
        stateColor().setStroke()
        path.stroke()

        if glow > 0 {
            let glowRect = rect.insetBy(dx: -glow * 18, dy: -glow * 18)
            let glowPath = NSBezierPath(ovalIn: glowRect)
            glowPath.lineWidth = 3
            NSColor.systemOrange.withAlphaComponent(glow).setStroke()
            glowPath.stroke()
        }

        let inner = NSBezierPath(ovalIn: rect.insetBy(dx: 22, dy: 22))
        inner.lineWidth = 1
        NSColor(calibratedRed: 0.17, green: 0.22, blue: 0.29, alpha: 0.85).setStroke()
        inner.stroke()

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
