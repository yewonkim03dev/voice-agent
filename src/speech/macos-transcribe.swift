#!/usr/bin/env swift

import Foundation
import AVFoundation
import Speech

struct RecognitionResult {
  let text: String
  let confidence: Float
  let language: String
}

let arguments = CommandLine.arguments
guard arguments.count >= 2 else {
  fputs("Usage: macos-transcribe.swift <audio.wav>\n", stderr)
  exit(2)
}

let audioURL = URL(fileURLWithPath: arguments[1])
let locales = ["ko-KR", "en-US"]
var authorized = false
var authorizationFinished = false

log("input=\(audioURL.path)")

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

var results: [RecognitionResult] = []

for locale in locales {
  log("locale=\(locale) status=start")
  if let result = recognize(audioURL: audioURL, localeIdentifier: locale) {
    log("locale=\(locale) status=result confidence=\(String(format: "%.4f", result.confidence)) textLength=\(result.text.count)")
    results.append(result)
  } else {
    log("locale=\(locale) status=no_transcript")
  }
}

guard let best = results.sorted(by: rank).first else {
  fputs("Apple Speech produced no transcript.\n", stderr)
  exit(1)
}

let payload: [String: Any] = [
  "text": best.text,
  "language": best.language,
  "confidence": best.confidence
]

let data = try JSONSerialization.data(withJSONObject: payload, options: [])
FileHandle.standardOutput.write(data)
FileHandle.standardOutput.write(Data("\n".utf8))

func recognize(audioURL: URL, localeIdentifier: String) -> RecognitionResult? {
  guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: localeIdentifier)), recognizer.isAvailable else {
    log("locale=\(localeIdentifier) recognizer=unavailable")
    return nil
  }

  let request = SFSpeechAudioBufferRecognitionRequest()
  request.shouldReportPartialResults = true
  request.taskHint = .dictation
  if #available(macOS 10.15, *) {
    log("locale=\(localeIdentifier) supportsOnDeviceRecognition=\(recognizer.supportsOnDeviceRecognition)")
    request.requiresOnDeviceRecognition = false
  }
  log("locale=\(localeIdentifier) request=audio_buffer")

  var finalText = ""
  var finalConfidence: Float = 0
  var finished = false
  var lastError = ""

  let task = recognizer.recognitionTask(with: request) { result, error in
    if let result {
      finalText = result.bestTranscription.formattedString
      finalConfidence = averageConfidence(result.bestTranscription.segments)
      log("locale=\(localeIdentifier) partialFinal=\(result.isFinal) textLength=\(finalText.count)")
      if result.isFinal {
        finished = true
      }
    }

    if let error {
      lastError = error.localizedDescription
      log("locale=\(localeIdentifier) error=\(lastError)")
      finished = true
    }
  }

  do {
    try appendAudioFile(audioURL, to: request, localeIdentifier: localeIdentifier)
    request.endAudio()
    log("locale=\(localeIdentifier) status=end_audio")
  } catch {
    log("locale=\(localeIdentifier) append_error=\(error.localizedDescription)")
    task.cancel()
    return nil
  }

  if !waitUntil(timeoutSeconds: 20, condition: { finished }) {
    log("locale=\(localeIdentifier) status=timeout")
  }
  if !finished {
    task.cancel()
  }

  let text = finalText.trimmingCharacters(in: .whitespacesAndNewlines)
  if !lastError.isEmpty && text.isEmpty {
    return nil
  }
  if text.isEmpty { return nil }

  return RecognitionResult(
    text: text,
    confidence: finalConfidence > 0 ? finalConfidence : 0.5,
    language: localeIdentifier.hasPrefix("ko") ? "ko" : "en"
  )
}

func waitUntil(timeoutSeconds: TimeInterval, condition: () -> Bool) -> Bool {
  let deadline = Date().addingTimeInterval(timeoutSeconds)

  while !condition() && Date() < deadline {
    RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.05))
  }

  return condition()
}

func appendAudioFile(
  _ audioURL: URL,
  to request: SFSpeechAudioBufferRecognitionRequest,
  localeIdentifier: String
) throws {
  let audioFile = try AVAudioFile(forReading: audioURL)
  let format = audioFile.processingFormat
  let chunkFrames: AVAudioFrameCount = 4096
  var totalFrames: AVAudioFramePosition = 0

  log(
    "locale=\(localeIdentifier) audioFormat sampleRate=\(String(format: "%.0f", format.sampleRate)) channels=\(format.channelCount) frames=\(audioFile.length)"
  )

  while audioFile.framePosition < audioFile.length {
    let remaining = audioFile.length - audioFile.framePosition
    let frameCount = AVAudioFrameCount(min(AVAudioFramePosition(chunkFrames), remaining))
    guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount) else {
      throw TranscribeError.message("Could not allocate audio buffer.")
    }

    try audioFile.read(into: buffer, frameCount: frameCount)
    if buffer.frameLength == 0 { break }

    totalFrames += AVAudioFramePosition(buffer.frameLength)
    request.append(buffer)
  }

  log("locale=\(localeIdentifier) appendFrames=\(totalFrames)")
}

enum TranscribeError: Error, LocalizedError {
  case message(String)

  var errorDescription: String? {
    switch self {
    case .message(let text):
      return text
    }
  }
}

func averageConfidence(_ segments: [SFTranscriptionSegment]) -> Float {
  if segments.isEmpty { return 0 }
  let total = segments.reduce(Float(0)) { partial, segment in
    partial + segment.confidence
  }
  return total / Float(segments.count)
}

func rank(lhs: RecognitionResult, rhs: RecognitionResult) -> Bool {
  if lhs.confidence == rhs.confidence {
    return lhs.text.count > rhs.text.count
  }

  return lhs.confidence > rhs.confidence
}

func log(_ message: String) {
  fputs("[stt:apple] \(message)\n", stderr)
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
