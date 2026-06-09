import AVFoundation
import Foundation
import ImageIO
import Vision

struct Args {
    var mode = "idle"
    var fps = 5
    var width = 640
    var height = 480
}

final class JsonEmitter {
    private let lock = NSLock()

    func emit(_ object: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(object),
              let data = try? JSONSerialization.data(withJSONObject: object, options: []) else {
            return
        }

        lock.lock()
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data("\n".utf8))
        lock.unlock()
    }
}

final class GestureCameraDelegate: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    private let request = VNDetectHumanHandPoseRequest()
    private let emitter: JsonEmitter
    private let mode: String
    private let frameInterval: TimeInterval
    private var lastFrameAt = Date.distantPast

    init(args: Args, emitter: JsonEmitter) {
        self.emitter = emitter
        self.mode = args.mode
        self.frameInterval = 1.0 / Double(max(args.fps, 1))
        super.init()
        request.maximumHandCount = 1
    }

    func captureOutput(
        _ output: AVCaptureOutput,
        didOutput sampleBuffer: CMSampleBuffer,
        from connection: AVCaptureConnection
    ) {
        let now = Date()
        guard now.timeIntervalSince(lastFrameAt) >= frameInterval else {
            return
        }
        lastFrameAt = now

        let handler = VNImageRequestHandler(
            cmSampleBuffer: sampleBuffer,
            orientation: .up,
            options: [:]
        )

        do {
            try handler.perform([request])
            emitter.emit([
                "type": "landmarks",
                "timestamp": Int(now.timeIntervalSince1970 * 1000),
                "landmarks": handLandmarks(request.results?.first),
                "mode": mode
            ])
        } catch {
            emitter.emit([
                "type": "status",
                "enabled": true,
                "mode": mode,
                "text": "vision error: \(error.localizedDescription)"
            ])
        }
    }
}

func parseArgs(_ arguments: [String]) -> Args {
    var args = Args()
    var index = 0
    while index < arguments.count {
        let key = arguments[index]
        let value = index + 1 < arguments.count ? arguments[index + 1] : ""
        switch key {
        case "--mode":
            args.mode = value
            index += 2
        case "--fps":
            args.fps = max(1, min(30, Int(value) ?? args.fps))
            index += 2
        case "--width":
            args.width = max(160, min(3840, Int(value) ?? args.width))
            index += 2
        case "--height":
            args.height = max(120, min(2160, Int(value) ?? args.height))
            index += 2
        default:
            index += 1
        }
    }
    return args
}

func handLandmarks(_ observation: VNHumanHandPoseObservation?) -> [[String: Any]] {
    guard let observation, let points = try? observation.recognizedPoints(.all) else {
        return []
    }

    let names: [(String, VNHumanHandPoseObservation.JointName)] = [
        ("wrist", .wrist),
        ("thumbCMC", .thumbCMC),
        ("thumbMP", .thumbMP),
        ("thumbIP", .thumbIP),
        ("thumbTip", .thumbTip),
        ("indexMCP", .indexMCP),
        ("indexPIP", .indexPIP),
        ("indexDIP", .indexDIP),
        ("indexTip", .indexTip),
        ("middleMCP", .middleMCP),
        ("middlePIP", .middlePIP),
        ("middleDIP", .middleDIP),
        ("middleTip", .middleTip),
        ("ringMCP", .ringMCP),
        ("ringPIP", .ringPIP),
        ("ringDIP", .ringDIP),
        ("ringTip", .ringTip),
        ("littleMCP", .littleMCP),
        ("littlePIP", .littlePIP),
        ("littleDIP", .littleDIP),
        ("littleTip", .littleTip)
    ]

    return names.compactMap { item in
        guard let point = points[item.1], point.confidence >= 0.25 else {
            return nil
        }
        return [
            "name": item.0,
            "x": Double(point.location.x),
            "y": Double(point.location.y),
            "confidence": Double(point.confidence)
        ]
    }
}

func configurePreset(_ session: AVCaptureSession, args: Args) {
    let preset: AVCaptureSession.Preset
    if args.width <= 640 && args.height <= 480 {
        preset = .vga640x480
    } else if args.width <= 1280 && args.height <= 720 {
        preset = .hd1280x720
    } else {
        preset = .high
    }

    if session.canSetSessionPreset(preset) {
        session.sessionPreset = preset
    }
}

let args = parseArgs(Array(CommandLine.arguments.dropFirst()))
let emitter = JsonEmitter()
let session = AVCaptureSession()
configurePreset(session, args: args)

guard let device = AVCaptureDevice.default(for: .video) else {
    emitter.emit([
        "type": "status",
        "enabled": false,
        "mode": "off",
        "text": "camera device unavailable"
    ])
    exit(2)
}

do {
    let input = try AVCaptureDeviceInput(device: device)
    guard session.canAddInput(input) else {
        emitter.emit([
            "type": "status",
            "enabled": false,
            "mode": "off",
            "text": "camera input unavailable"
        ])
        exit(2)
    }
    session.addInput(input)
} catch {
    emitter.emit([
        "type": "status",
        "enabled": false,
        "mode": "off",
        "text": "camera input error: \(error.localizedDescription)"
    ])
    exit(2)
}

let output = AVCaptureVideoDataOutput()
output.alwaysDiscardsLateVideoFrames = true
output.videoSettings = [
    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
]
let delegate = GestureCameraDelegate(args: args, emitter: emitter)
let queue = DispatchQueue(label: "voice-agent.camera-gesture")
output.setSampleBufferDelegate(delegate, queue: queue)

guard session.canAddOutput(output) else {
    emitter.emit([
        "type": "status",
        "enabled": false,
        "mode": "off",
        "text": "camera output unavailable"
    ])
    exit(2)
}

session.addOutput(output)
session.startRunning()

emitter.emit([
    "type": "status",
    "enabled": session.isRunning,
    "mode": args.mode,
    "text": session.isRunning ? "camera gesture watcher started" : "camera gesture watcher failed to start"
])

if !session.isRunning {
    exit(2)
}

RunLoop.main.run()
