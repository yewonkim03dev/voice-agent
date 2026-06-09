#!/usr/bin/env swift

import AVFoundation
import Foundation

let mediaType = AVMediaType.video
let status = AVCaptureDevice.authorizationStatus(for: mediaType)

switch status {
case .authorized:
  print("authorized")
case .notDetermined:
  let semaphore = DispatchSemaphore(value: 0)
  var granted = false
  AVCaptureDevice.requestAccess(for: mediaType) { allowed in
    granted = allowed
    semaphore.signal()
  }
  _ = semaphore.wait(timeout: .now() + 60)
  print(granted ? "authorized" : "denied")
case .denied:
  print("denied")
case .restricted:
  print("restricted")
@unknown default:
  print("unavailable")
}
