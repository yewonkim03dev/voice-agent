#!/usr/bin/env swift

import AVFoundation
import Foundation
import Speech

struct PartialPayload: Codable {
  let text: String
  let confidence: Float
  let language: String
  let locale: String
  let provider: String
  let isFinal: Bool
}

final class PartialRecognizer {
  private let localeIdentifier: String
  private let language: String
  private let lock: NSLock
  private let output: FileHandle
  private let request = SFSpeechAudioBufferRecognitionRequest()
  private var task: SFSpeechRecognitionTask?
  private var lastText = ""

  init(localeIdentifier: String, lock: NSLock, output: FileHandle) {
    self.localeIdentifier = localeIdentifier
    self.language = localeIdentifier.hasPrefix("ko") ? "ko" : "en"
    self.lock = lock
    self.output = output
  }

  func start() -> Bool {
    guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: localeIdentifier)), recognizer.isAvailable else {
      log("locale=\(localeIdentifier) recognizer=unavailable")
      return false
    }

    request.shouldReportPartialResults = true
    request.taskHint = .dictation
    if #available(macOS 10.15, *) {
      request.requiresOnDeviceRecognition = false
    }

    task = recognizer.recognitionTask(with: request) { [weak self] result, error in
      guard let self else { return }

      if let result {
        self.emit(result: result)
      }

      if let error {
        log("locale=\(self.localeIdentifier) error=\(error.localizedDescription)")
      }
    }

    log("locale=\(localeIdentifier) status=start")
    return true
  }

  func append(rawPcm data: Data, format: AVAudioFormat) {
    guard let buffer = pcm16DataToFloatBuffer(data, format: format) else { return }
    request.append(buffer)
  }

  func finish() {
    request.endAudio()
  }

  func cancel() {
    task?.cancel()
  }

  private func emit(result: SFSpeechRecognitionResult) {
    let text = result.bestTranscription.formattedString.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty && text != lastText else { return }

    lastText = text
    let payload = PartialPayload(
      text: text,
      confidence: averageConfidence(result.bestTranscription.segments),
      language: language,
      locale: localeIdentifier,
      provider: "apple-speech-partial",
      isFinal: result.isFinal
    )

    do {
      let data = try JSONEncoder().encode(payload)
      lock.lock()
      output.write(data)
      output.write(Data("\n".utf8))
      lock.unlock()
    } catch {
      log("locale=\(localeIdentifier) encode_error=\(error.localizedDescription)")
    }
  }
}

let locales = parseLocales()
var authorized = false
var authorizationFinished = false

SFSpeechRecognizer.requestAuthorization { status in
  log("authorization=\(describe(status))")
  authorized = status == .authorized
  authorizationFinished = true
}

if !waitUntil(timeoutSeconds: 30, condition: { authorizationFinished }) {
  fputs("Apple Speech authorization timed out.\n", stderr)
  exit(1)
}

guard authorized else {
  fputs("Apple Speech recognition permission was not granted.\n", stderr)
  exit(1)
}

guard let format = AVAudioFormat(
  commonFormat: .pcmFormatFloat32,
  sampleRate: 16_000,
  channels: 1,
  interleaved: false
) else {
  fputs("Could not create wake stream audio format.\n", stderr)
  exit(1)
}

let lock = NSLock()
let recognizers = locales
  .map { PartialRecognizer(localeIdentifier: $0, lock: lock, output: FileHandle.standardOutput) }
  .filter { $0.start() }

guard !recognizers.isEmpty else {
  fputs("No Apple Speech recognizers are available.\n", stderr)
  exit(1)
}

let input = FileHandle.standardInput

while true {
  let data = input.readData(ofLength: 4096)
  if data.isEmpty { break }

  for recognizer in recognizers {
    recognizer.append(rawPcm: data, format: format)
  }
}

for recognizer in recognizers {
  recognizer.finish()
}

_ = waitUntil(timeoutSeconds: 0.8, condition: { false })
recognizers.forEach { $0.cancel() }

func parseLocales() -> [String] {
  if let value = ProcessInfo.processInfo.environment["VOICE_AGENT_WAKE_STREAM_LOCALES"], !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
    return value
      .split(separator: ",")
      .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
      .filter { !$0.isEmpty }
  }

  return ["ko-KR", "en-US"]
}

func pcm16DataToFloatBuffer(_ data: Data, format: AVAudioFormat) -> AVAudioPCMBuffer? {
  let frameCount = data.count / MemoryLayout<Int16>.size
  guard frameCount > 0 else { return nil }
  guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(frameCount)) else {
    return nil
  }

  buffer.frameLength = AVAudioFrameCount(frameCount)
  guard let channel = buffer.floatChannelData?[0] else { return nil }

  data.withUnsafeBytes { rawBuffer in
    let samples = rawBuffer.bindMemory(to: Int16.self)
    for index in 0..<frameCount {
      channel[index] = Float(samples[index]) / 32768.0
    }
  }

  return buffer
}

func averageConfidence(_ segments: [SFTranscriptionSegment]) -> Float {
  if segments.isEmpty { return 0 }
  let total = segments.reduce(Float(0)) { partial, segment in
    partial + segment.confidence
  }
  return total / Float(segments.count)
}

func waitUntil(timeoutSeconds: TimeInterval, condition: () -> Bool) -> Bool {
  let deadline = Date().addingTimeInterval(timeoutSeconds)

  while !condition() && Date() < deadline {
    RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.05))
  }

  return condition()
}

func log(_ message: String) {
  fputs("[wake:apple] \(message)\n", stderr)
}

func describe(_ status: SFSpeechRecognizerAuthorizationStatus) -> String {
  switch status {
  case .authorized:
    return "authorized"
  case .denied:
    return "denied"
  case .restricted:
    return "restricted"
  case .notDetermined:
    return "notDetermined"
  @unknown default:
    return "unknown"
  }
}
