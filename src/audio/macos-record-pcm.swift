#!/usr/bin/env swift

import AVFoundation
import Foundation

final class Recorder {
  private let engine = AVAudioEngine()
  private let output = FileHandle.standardOutput
  private var converter: AVAudioConverter?
  private var inputConsumed = false

  func start() throws {
    let input = engine.inputNode
    let inputFormat = input.inputFormat(forBus: 0)

    guard let outputFormat = AVAudioFormat(
      commonFormat: .pcmFormatInt16,
      sampleRate: 16_000,
      channels: 1,
      interleaved: true
    ) else {
      throw RecorderError.message("Could not create 16kHz mono PCM output format.")
    }

    guard let converter = AVAudioConverter(from: inputFormat, to: outputFormat) else {
      throw RecorderError.message("Could not create audio converter.")
    }

    self.converter = converter

    input.installTap(onBus: 0, bufferSize: 2048, format: inputFormat) { [weak self] buffer, _ in
      self?.writeConvertedBuffer(buffer, outputFormat: outputFormat)
    }

    try engine.start()
  }

  func stop() {
    engine.stop()
    engine.inputNode.removeTap(onBus: 0)
  }

  private func writeConvertedBuffer(_ buffer: AVAudioPCMBuffer, outputFormat: AVAudioFormat) {
    guard let converter else { return }

    let ratio = outputFormat.sampleRate / buffer.format.sampleRate
    let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 1
    guard let converted = AVAudioPCMBuffer(pcmFormat: outputFormat, frameCapacity: capacity) else {
      return
    }

    inputConsumed = false
    var error: NSError?
    let inputBlock: AVAudioConverterInputBlock = { [weak self] _, status in
      guard let self else {
        status.pointee = .noDataNow
        return nil
      }

      if self.inputConsumed {
        status.pointee = .noDataNow
        return nil
      }

      self.inputConsumed = true
      status.pointee = .haveData
      return buffer
    }

    converter.convert(to: converted, error: &error, withInputFrom: inputBlock)
    guard error == nil else { return }

    let audioBuffer = converted.audioBufferList.pointee.mBuffers
    guard let data = audioBuffer.mData, audioBuffer.mDataByteSize > 0 else { return }

    output.write(Data(bytes: data, count: Int(audioBuffer.mDataByteSize)))
  }
}

enum RecorderError: Error, CustomStringConvertible {
  case message(String)

  var description: String {
    switch self {
    case .message(let text):
      return text
    }
  }
}

let recorder = Recorder()

let termSource = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
signal(SIGTERM, SIG_IGN)
termSource.setEventHandler {
  recorder.stop()
  exit(0)
}
termSource.resume()

let intSource = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
signal(SIGINT, SIG_IGN)
intSource.setEventHandler {
  recorder.stop()
  exit(0)
}
intSource.resume()

do {
  try recorder.start()
  RunLoop.current.run()
} catch {
  fputs("macOS recorder failed: \(error)\n", stderr)
  exit(1)
}
