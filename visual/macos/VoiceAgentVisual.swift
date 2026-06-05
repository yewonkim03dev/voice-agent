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

        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = .center
        paragraph.lineBreakMode = .byWordWrapping
        let fontSize: CGFloat = state == "approval_pending" ? 13 : state == "speaking" ? 20 : 15
        let attrs: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: fontSize, weight: state == "speaking" ? .semibold : .medium),
            .foregroundColor: NSColor(calibratedRed: 0.86, green: 0.89, blue: 0.94, alpha: 1),
            .paragraphStyle: paragraph
        ]
        let expandedText = bounds.width >= 320 || bounds.height >= 320
        let textHeight = state == "approval_pending"
            ? min(max(bounds.height * 0.46, 156), 240)
            : state == "speaking"
                ? min(max(bounds.height * 0.34, 112), 174)
                : expandedText ? min(max(bounds.height * 0.34, 92), 150) : min(max(bounds.height * 0.18, 56), 78)
        let textRect = NSRect(x: 24, y: 16, width: bounds.width - 48, height: textHeight)
        var options: NSString.DrawingOptions = [.usesLineFragmentOrigin, .usesFontLeading]
        if !expandedText {
            options.insert(.truncatesLastVisibleLine)
        }
        if (state == "speaking" || state == "approval_pending"), !statusText.isEmpty {
            let backdropRect = textRect.insetBy(dx: -6, dy: -10)
            NSColor(calibratedRed: 0.02, green: 0.03, blue: 0.05, alpha: 0.82).setFill()
            NSBezierPath(roundedRect: backdropRect, xRadius: 12, yRadius: 12).fill()
            if state == "approval_pending" {
                NSColor(calibratedRed: 1.0, green: 0.82, blue: 0.36, alpha: 0.68).setStroke()
            } else {
                NSColor(calibratedRed: 0.12, green: 0.19, blue: 0.27, alpha: 0.72).setStroke()
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
    private let circleView: AgentCircleView
    private let commandView: NSTextView
    private let commandPanel = NSView(frame: .zero)
    private let commandLabel = NSTextField(labelWithString: "Commands")
    private let commandScroll = NSScrollView(frame: .zero)
    private let controls: NSStackView

    init(circleView: AgentCircleView, commandView: NSTextView, controls: NSStackView) {
        self.circleView = circleView
        self.commandView = commandView
        self.controls = controls
        super.init(frame: .zero)

        wantsLayer = true
        layer?.backgroundColor = NSColor(calibratedRed: 0.03, green: 0.04, blue: 0.06, alpha: 1).cgColor

        circleView.autoresizingMask = []
        addSubview(circleView)

        commandPanel.wantsLayer = true
        commandPanel.layer?.backgroundColor = NSColor(calibratedRed: 0.06, green: 0.09, blue: 0.13, alpha: 1).cgColor
        commandPanel.layer?.borderColor = NSColor(calibratedRed: 0.14, green: 0.19, blue: 0.26, alpha: 1).cgColor
        commandPanel.layer?.borderWidth = 1
        commandPanel.layer?.cornerRadius = 8
        addSubview(commandPanel)

        commandLabel.textColor = NSColor(calibratedRed: 0.57, green: 0.64, blue: 0.73, alpha: 1)
        commandLabel.font = NSFont.boldSystemFont(ofSize: 13)
        commandPanel.addSubview(commandLabel)

        commandView.isEditable = false
        commandView.drawsBackground = true
        commandView.backgroundColor = NSColor(calibratedRed: 0.06, green: 0.09, blue: 0.13, alpha: 1)
        commandView.textColor = .white
        commandView.font = NSFont.monospacedSystemFont(ofSize: 13, weight: .regular)
        commandView.textContainerInset = NSSize(width: 0, height: 2)

        commandScroll.documentView = commandView
        commandScroll.hasVerticalScroller = true
        commandScroll.borderType = .noBorder
        commandScroll.drawsBackground = false
        commandPanel.addSubview(commandScroll)

        controls.orientation = .horizontal
        controls.distribution = .fillEqually
        controls.spacing = 10
        addSubview(controls)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func layout() {
        super.layout()

        let inset: CGFloat = 22
        let gap: CGFloat = 10
        let controlsHeight: CGFloat = 34
        let expanded = bounds.width >= 760 || bounds.height >= 760
        let commandHeight = max(86, min(expanded ? 150 : 112, bounds.height * (expanded ? 0.15 : 0.17)))
        let contentWidth = max(0, bounds.width - inset * 2)

        controls.frame = NSRect(x: inset, y: inset, width: contentWidth, height: controlsHeight)
        commandPanel.frame = NSRect(
            x: inset,
            y: controls.frame.maxY + gap,
            width: contentWidth,
            height: commandHeight
        )

        let panelInset: CGFloat = 14
        let labelHeight: CGFloat = 18
        commandLabel.frame = NSRect(
            x: panelInset,
            y: commandPanel.bounds.height - panelInset - labelHeight,
            width: max(0, commandPanel.bounds.width - panelInset * 2),
            height: labelHeight
        )
        commandScroll.frame = NSRect(
            x: panelInset,
            y: panelInset,
            width: max(0, commandPanel.bounds.width - panelInset * 2),
            height: max(24, commandLabel.frame.minY - panelInset - 8)
        )
        commandView.frame = commandScroll.contentView.bounds

        let center = CGPoint(x: bounds.midX, y: bounds.midY)
        let bottomLimit = commandPanel.frame.maxY + 12
        let topLimit = bounds.height - inset
        let centerClearance = max(110, min(topLimit - center.y, center.y - bottomLimit))
        let maxCircle: CGFloat = expanded ? 720 : 360
        let circleSize = max(
            220,
            min(
                contentWidth * (expanded ? 0.78 : 0.84),
                bounds.height * (expanded ? 0.60 : 0.48),
                centerClearance * 2,
                maxCircle
            )
        )
        circleView.frame = NSRect(
            x: center.x - circleSize / 2,
            y: center.y - circleSize / 2,
            width: circleSize,
            height: circleSize
        )
    }
}

final class ThinkingPulseSound {
    private var timer: Timer?
    private lazy var sound: NSSound? = Self.makePulseSound() ?? NSSound(named: NSSound.Name("Glass"))

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
        sound.volume = 0.24
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

final class VisualAppDelegate: NSObject, NSApplicationDelegate {
    private let bridgeUrl: String
    private let circleView = AgentCircleView(frame: .zero)
    private let commandView = NSTextView(frame: .zero)
    private let thinkingPulseSound = ThinkingPulseSound()
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
        let controls = NSStackView()
        controls.addArrangedSubview(button("TTS Stop", action: #selector(stopTts)))
        controls.addArrangedSubview(button("Clear", action: #selector(clearCommands)))
        controls.addArrangedSubview(button("Exit", action: #selector(exitVisual)))

        return VisualRootView(circleView: circleView, commandView: commandView, controls: controls)
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
            circleView.statusText = event["text"] as? String ?? circleView.state
            if circleView.state == "wake_rejected" {
                circleView.glow = 1
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) { [weak self] in
                    guard let self, self.circleView.state == "wake_rejected" else { return }
                    self.circleView.state = "idle"
                    self.circleView.statusText = "idle"
                    self.circleView.glow = 0
                }
            }
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

        thinkingPulseSound.setActive(circleView.state == "thinking" || circleView.state == "running")
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
