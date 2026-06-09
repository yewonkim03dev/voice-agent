#!/usr/bin/env swift

import AVFoundation
import Foundation

final class Recorder {
  private let engine = AVAudioEngine()
  private let output = FileHandle.standardOutput
  private let queue = DispatchQueue(label: "voice-agent.audio-recorder")
  private let converterLock = NSLock()
  private var converter: AVAudioConverter?
  private var outputFormat: AVAudioFormat?
  private var inputConsumed = false
  private var stopped = false
  private var reconfigureWorkItem: DispatchWorkItem?
  private var retryWorkItem: DispatchWorkItem?
  private var retryDelaySeconds: TimeInterval = 1.0
  private var heartbeatTimer: DispatchSourceTimer?
  private var currentStatus = "starting"
  private var configurationObserver: NSObjectProtocol?

  func start() {
    stopped = false
    installConfigurationObserver()
    startHeartbeat()
    queue.async { [weak self] in
      self?.rebuildGraph(reason: "initial_start", emitRestarted: false)
    }
  }

  func stop() {
    queue.sync {
      stopped = true
      reconfigureWorkItem?.cancel()
      retryWorkItem?.cancel()
      reconfigureWorkItem = nil
      retryWorkItem = nil
      stopHeartbeat()
      if let configurationObserver {
        NotificationCenter.default.removeObserver(configurationObserver)
        self.configurationObserver = nil
      }
      stopEngineAndTap()
      converterLock.lock()
      converter = nil
      outputFormat = nil
      converterLock.unlock()
      emitStatus("stopped")
    }
  }

  private func installConfigurationObserver() {
    configurationObserver = NotificationCenter.default.addObserver(
      forName: .AVAudioEngineConfigurationChange,
      object: engine,
      queue: nil
    ) { [weak self] _ in
      self?.scheduleReconfigure(reason: "configuration_changed")
    }
  }

  private func scheduleReconfigure(reason: String) {
    queue.async { [weak self] in
      guard let self, !self.stopped else { return }
      self.reconfigureWorkItem?.cancel()
      let work = DispatchWorkItem { [weak self] in
        self?.rebuildGraph(reason: reason, emitRestarted: true)
      }
      self.reconfigureWorkItem = work
      self.queue.asyncAfter(deadline: .now() + 0.35, execute: work)
    }
  }

  private func rebuildGraph(reason: String, emitRestarted: Bool) {
    guard !stopped else { return }
    emitStatus("reconfiguring", reason)

    do {
      try configureAndStartEngine()
      retryDelaySeconds = 1.0
      emitStatus(emitRestarted ? "restarted" : "running", reason)
      if emitRestarted {
        emitStatus("running")
      }
    } catch {
      emitError("\(error)")
      emitStatus("waiting_device", reason)
      scheduleRetry(reason: reason)
    }
  }

  private func configureAndStartEngine() throws {
    stopEngineAndTap()

    let input = engine.inputNode
    let inputFormat = input.inputFormat(forBus: 0)
    guard inputFormat.channelCount > 0, inputFormat.sampleRate > 0 else {
      throw RecorderError.message("Input device is unavailable or has an invalid format.")
    }

    guard let nextOutputFormat = AVAudioFormat(
      commonFormat: .pcmFormatInt16,
      sampleRate: 16_000,
      channels: 1,
      interleaved: true
    ) else {
      throw RecorderError.message("Could not create 16kHz mono PCM output format.")
    }

    guard let nextConverter = AVAudioConverter(from: inputFormat, to: nextOutputFormat) else {
      throw RecorderError.message("Could not create audio converter.")
    }

    converterLock.lock()
    converter = nextConverter
    outputFormat = nextOutputFormat
    converterLock.unlock()

    input.installTap(onBus: 0, bufferSize: 2048, format: inputFormat) { [weak self] buffer, _ in
      self?.writeConvertedBuffer(buffer)
    }

    engine.prepare()
    try engine.start()
  }

  private func stopEngineAndTap() {
    if engine.isRunning {
      engine.stop()
    }
    engine.inputNode.removeTap(onBus: 0)
    engine.reset()
  }

  private func scheduleRetry(reason: String) {
    guard !stopped else { return }
    retryWorkItem?.cancel()
    let delay = retryDelaySeconds
    retryDelaySeconds = min(retryDelaySeconds * 2, 10.0)
    let work = DispatchWorkItem { [weak self] in
      self?.rebuildGraph(reason: "retry_after_\(reason)", emitRestarted: true)
    }
    retryWorkItem = work
    queue.asyncAfter(deadline: .now() + delay, execute: work)
  }

  private func startHeartbeat() {
    let timer = DispatchSource.makeTimerSource(queue: queue)
    timer.schedule(deadline: .now() + 5.0, repeating: 5.0)
    timer.setEventHandler { [weak self] in
      guard let self, !self.stopped else { return }
      self.emitStatus(self.currentStatus, "heartbeat")
    }
    heartbeatTimer = timer
    timer.resume()
  }

  private func stopHeartbeat() {
    heartbeatTimer?.cancel()
    heartbeatTimer = nil
  }

  private func writeConvertedBuffer(_ buffer: AVAudioPCMBuffer) {
    converterLock.lock()
    guard let converter, let outputFormat else {
      converterLock.unlock()
      return
    }

    let ratio = outputFormat.sampleRate / buffer.format.sampleRate
    let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 1
    guard let converted = AVAudioPCMBuffer(pcmFormat: outputFormat, frameCapacity: capacity) else {
      converterLock.unlock()
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
    converterLock.unlock()
    guard error == nil else { return }

    let audioBuffer = converted.audioBufferList.pointee.mBuffers
    guard let data = audioBuffer.mData, audioBuffer.mDataByteSize > 0 else { return }

    output.write(Data(bytes: data, count: Int(audioBuffer.mDataByteSize)))
  }

  private func emitStatus(_ status: String, _ message: String? = nil) {
    currentStatus = status
    let suffix = message.map { " \($0)" } ?? ""
    fputs("[audio:status] \(status)\(suffix)\n", stderr)
    fflush(stderr)
  }

  private func emitError(_ message: String) {
    fputs("[audio:error] \(message)\n", stderr)
    fflush(stderr)
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

recorder.start()
RunLoop.current.run()
