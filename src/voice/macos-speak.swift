import AVFoundation
import Foundation

struct Options {
    var text = ""
    var language = "auto"
    var voiceName: String?
    var gender = "auto"
    var rate: Float = 0.56
    var pitch: Float = 1.0
    var volume: Float = 1.0
    var listVoices = false
}

final class SpeechDelegate: NSObject, AVSpeechSynthesizerDelegate {
    var didStart = false
    var didFinish = false

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didStart utterance: AVSpeechUtterance) {
        didStart = true
        debugLog("status=started")
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        didFinish = true
        debugLog("status=finished")
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        didFinish = true
        debugLog("status=cancelled")
    }
}

let options = parseOptions(CommandLine.arguments.dropFirst())

if options.listVoices {
    printVoiceList()
    exit(0)
}

if options.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
    fputs("Missing --text for macOS TTS.\n", stderr)
    exit(2)
}

let synthesizer = AVSpeechSynthesizer()
let delegate = SpeechDelegate()
synthesizer.delegate = delegate

let utterance = AVSpeechUtterance(string: options.text)
utterance.voice = selectVoice(options: options)
utterance.rate = max(AVSpeechUtteranceMinimumSpeechRate, min(AVSpeechUtteranceMaximumSpeechRate, options.rate))
utterance.pitchMultiplier = max(0.5, min(2.0, options.pitch))
utterance.volume = max(0.0, min(1.0, options.volume))

debugLog("status=start language=\(utterance.voice?.language ?? "unknown") voice=\(utterance.voice?.name ?? "default") textLength=\(options.text.count)")
synthesizer.speak(utterance)

let timeoutSeconds = max(5.0, min(30.0, Double(options.text.count) * 0.18 + 3.0))
let deadline = Date(timeIntervalSinceNow: timeoutSeconds)

while !delegate.didFinish && Date() < deadline {
    RunLoop.main.run(mode: .default, before: Date(timeIntervalSinceNow: 0.05))
}

if !delegate.didFinish {
    synthesizer.stopSpeaking(at: .immediate)
    let started = delegate.didStart ? "true" : "false"
    fputs("macOS TTS timed out before speech finished. didStart=\(started)\n", stderr)
    exit(3)
}

func parseOptions(_ args: ArraySlice<String>) -> Options {
    var options = Options()
    var iterator = args.makeIterator()

    while let arg = iterator.next() {
        switch arg {
        case "--text":
            options.text = iterator.next() ?? ""
        case "--language":
            options.language = iterator.next() ?? "auto"
        case "--voice":
            options.voiceName = iterator.next()
        case "--gender":
            options.gender = iterator.next() ?? "auto"
        case "--rate":
            options.rate = Float(iterator.next() ?? "") ?? options.rate
        case "--pitch":
            options.pitch = Float(iterator.next() ?? "") ?? options.pitch
        case "--volume":
            options.volume = Float(iterator.next() ?? "") ?? options.volume
        case "--list-voices":
            options.listVoices = true
        default:
            continue
        }
    }

    return options
}

func selectVoice(options: Options) -> AVSpeechSynthesisVoice? {
    let voices = AVSpeechSynthesisVoice.speechVoices()

    if let voiceName = options.voiceName?.lowercased() {
        if let voice = voices.first(where: {
            $0.identifier.lowercased() == voiceName || $0.name.lowercased() == voiceName
        }) {
            return voice
        }
    }

    let language = languageCode(options.language, text: options.text)
    let languageVoices = voices.filter { $0.language.lowercased().hasPrefix(language.lowercased()) }

    if options.gender != "auto" {
        if let voice = languageVoices.first(where: { genderName($0.gender) == options.gender }) {
            return voice
        }
    }

    if let enhanced = languageVoices.first(where: { $0.quality == .enhanced }) {
        return enhanced
    }

    return AVSpeechSynthesisVoice(language: language) ?? languageVoices.first
}

func languageCode(_ requested: String, text: String) -> String {
    switch requested {
    case "ko":
        return "ko-KR"
    case "en":
        return "en-US"
    default:
        if text.range(of: #"[가-힣ㄱ-ㅎㅏ-ㅣ]"#, options: .regularExpression) != nil {
            return "ko-KR"
        }

        return "en-US"
    }
}

func printVoiceList() {
    let voices = AVSpeechSynthesisVoice.speechVoices().map { voice in
        [
            "identifier": voice.identifier,
            "name": voice.name,
            "language": voice.language,
            "gender": genderName(voice.gender)
        ]
    }

    if let data = try? JSONSerialization.data(withJSONObject: voices, options: [.prettyPrinted, .sortedKeys]),
       let body = String(data: data, encoding: .utf8) {
        print(body)
    } else {
        print("[]")
    }
}

func genderName(_ gender: AVSpeechSynthesisVoiceGender) -> String {
    switch gender {
    case .male:
        return "male"
    case .female:
        return "female"
    default:
        return "auto"
    }
}

func debugLog(_ message: String) {
    let raw = ProcessInfo.processInfo.environment["VOICE_AGENT_TTS_DEBUG"] ?? ""
    let enabled = ["1", "true", "yes", "on"].contains(raw.lowercased())
    if enabled {
        fputs("[tts:apple] \(message)\n", stderr)
    }
}
