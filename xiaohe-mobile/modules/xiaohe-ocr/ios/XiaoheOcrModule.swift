import ExpoModulesCore
import CryptoKit
import ImageIO
import Vision

public class XiaoheOcrModule: Module {
  private let worker = DispatchQueue(label: "com.xiaohe.ocr", qos: .userInitiated)
  private let gate = NSLock()
  private var active: OcrJob?
  private var destroyed = false

  public func definition() -> ModuleDefinition {
    Name("XiaoheOcr")

    AsyncFunction("getAvailability") { () -> [String: Any] in
      do {
        let request = try Self.makeRequest()
        return ["available": true, "engine": "apple-vision", "engineVersion": Self.version(request)]
      } catch {
        return ["available": false, "engine": "apple-vision", "engineVersion": NSNull(),
                "reason": "当前系统没有可用的中文本机识别，请继续手工核对。"]
      }
    }

    AsyncFunction("recognize") { (uri: String, promise: Promise) in
      let directory = self.appContext?.config.documentDirectory
      self.gate.lock()
      if self.destroyed {
        self.gate.unlock()
        promise.reject("OCR_DESTROYED", "识别页面已关闭，请重新打开。")
        return
      }
      if self.active != nil {
        self.gate.unlock()
        promise.reject("OCR_BUSY", "上一张图片仍在结束处理，请稍后重试。")
        return
      }
      let job = OcrJob(promise: promise)
      self.active = job
      self.gate.unlock()

      job.scheduleTimeout()
      self.worker.async { [weak self] in
        guard let self else {
          job.reject("OCR_DESTROYED", "识别页面已关闭，请重新打开。")
          return
        }
        defer {
          job.finish()
          self.gate.lock()
          if self.active === job { self.active = nil }
          self.gate.unlock()
        }
        do {
          let result = try autoreleasepool {
            try Self.recognize(uri, directory: directory, job: job)
          }
          job.resolve(result)
        } catch let error as OcrFailure {
          job.reject(error.code, error.message)
        } catch {
          job.reject("OCR_FAILED", "这张图片未能完成识别，请重新拍摄或手工核对。")
        }
      }
    }

    OnDestroy {
      self.gate.lock()
      self.destroyed = true
      let job = self.active
      self.gate.unlock()
      job?.reject("OCR_DESTROYED", "识别页面已关闭，请重新打开。")
    }
  }

  private static func makeRequest() throws -> VNRecognizeTextRequest {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    let supported = try request.supportedRecognitionLanguages()
    guard supported.contains("zh-Hans") else {
      throw OcrFailure("OCR_UNAVAILABLE", "当前系统没有可用的简体中文本机识别。")
    }
    request.recognitionLanguages = ["zh-Hans", "zh-Hant", "en-US"].filter { supported.contains($0) }
    return request
  }

  private static func version(_ request: VNRecognizeTextRequest) -> String {
    let system = ProcessInfo.processInfo.operatingSystemVersion
    return "VNRecognizeTextRequest:r\(request.revision);iOS:\(system.majorVersion).\(system.minorVersion).\(system.patchVersion)"
  }

  private static func recognize(_ uri: String, directory: URL?, job: OcrJob) throws -> [String: Any] {
    try job.ensureOpen()
    let url = try ownedFile(uri, directory: directory)
    let (data, digest) = try readSnapshot(url, job: job)
    try job.ensureOpen()
    guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
          CGImageSourceGetCount(source) == 1,
          let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
          let rawWidth = properties[kCGImagePropertyPixelWidth] as? NSNumber,
          let rawHeight = properties[kCGImagePropertyPixelHeight] as? NSNumber else {
      throw OcrFailure("OCR_IMAGE_FORMAT", "当前图片不能作为单张静态图识别，请改用 JPG 或 PNG。")
    }
    let width = rawWidth.doubleValue
    let height = rawHeight.doubleValue
    guard width.isFinite, height.isFinite, width > 0, height > 0,
          width <= 16000, height <= 16000, width * height <= 48_000_000 else {
      throw OcrFailure("OCR_IMAGE_DIMENSIONS", "图片尺寸过大，请裁小为一道题后重试。")
    }
    let options: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceThumbnailMaxPixelSize: 2048,
      kCGImageSourceShouldCacheImmediately: true
    ]
    guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary),
          image.width > 0, image.height > 0, image.width <= 2048, image.height <= 2048 else {
      throw OcrFailure("OCR_IMAGE_FORMAT", "图片无法解码，请重新拍摄。")
    }
    let request = try makeRequest()
    try job.setRequest(request)
    // ThumbnailWithTransform already applies the original EXIF rotation/mirroring.
    let handler = VNImageRequestHandler(cgImage: image, orientation: .up, options: [:])
    try handler.perform([request])
    try job.ensureOpen()
    guard FileManager.default.fileExists(atPath: url.path) else {
      throw OcrFailure("OCR_IMAGE_MISSING", "原图已移除，本次识别结果不会采用。")
    }
    var lines: [[String: Any]] = []
    var textLength = 0
    for observation in request.results ?? [] {
      guard let candidate = observation.topCandidates(1).first,
            !candidate.string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { continue }
      textLength += candidate.string.utf16.count
      guard lines.count < 300, textLength <= 30000, candidate.string.utf16.count <= 2000 else {
        throw OcrFailure("OCR_TOO_MUCH_TEXT", "图片文字太多，请裁小为一道题后重试。")
      }
      let rect = observation.boundingBox
      guard rect.minX.isFinite, rect.minY.isFinite, rect.maxX.isFinite, rect.maxY.isFinite else {
        throw OcrFailure("OCR_LINE_BOUNDS", "识别文字位置异常，请重新拍摄。")
      }
      let x = min(1.0, max(0.0, Double(rect.minX)))
      let y = min(1.0, max(0.0, 1.0 - Double(rect.maxY)))
      let right = min(1.0, max(0.0, Double(rect.maxX)))
      let bottom = min(1.0, max(0.0, 1.0 - Double(rect.minY)))
      guard x.isFinite, y.isFinite, right.isFinite, bottom.isFinite, right > x, bottom > y else {
        throw OcrFailure("OCR_LINE_BOUNDS", "识别文字位置异常，请重新拍摄。")
      }
      let confidence: Any = candidate.confidence.isFinite && (0...1).contains(candidate.confidence)
        ? Double(candidate.confidence) : NSNull()
      lines.append([
        "id": "line-\(lines.count + 1)", "text": candidate.string, "confidence": confidence,
        "box": ["x": x, "y": y, "width": right - x, "height": bottom - y]
      ])
    }
    return ["engine": "apple-vision", "engineVersion": version(request), "imageDigest": digest,
            "width": image.width, "height": image.height, "lines": lines]
  }

  private static func ownedFile(_ value: String, directory: URL?) throws -> URL {
    guard let root = directory,
          let url = URL(string: value), url.isFileURL, (url.host ?? "").isEmpty,
          url.query == nil, url.fragment == nil else {
      throw OcrFailure("OCR_IMAGE_PATH", "只能识别已保存在本应用中的图片。")
    }
    let name = url.lastPathComponent
    let pattern = "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}\\.(?i:jpe?g|png|webp|heic|heif|avif)$"
    let owned = root.appendingPathComponent("xiaohe-images", isDirectory: true).resolvingSymlinksInPath().standardizedFileURL
    let file = url.resolvingSymlinksInPath().standardizedFileURL
    guard name.range(of: pattern, options: .regularExpression) != nil,
          file.lastPathComponent == name,
          file.deletingLastPathComponent() == owned,
          (try? file.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true else {
      throw OcrFailure("OCR_IMAGE_PATH", "原图不存在或不属于本应用保存的图片。")
    }
    return file
  }

  private static func readSnapshot(_ url: URL, job: OcrJob) throws -> (Data, String) {
    let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
    guard size > 0, size <= 15 * 1024 * 1024 else {
      throw OcrFailure("OCR_IMAGE_SIZE", "图片为空或超过 15 MB，请重新拍摄一道题。")
    }
    let file = try FileHandle(forReadingFrom: url)
    defer { try? file.close() }
    var data = Data()
    data.reserveCapacity(size)
    var sha = SHA256()
    while let chunk = try file.read(upToCount: 64 * 1024), !chunk.isEmpty {
      try job.ensureOpen()
      guard data.count + chunk.count <= size else {
        throw OcrFailure("OCR_IMAGE_CHANGED", "图片读取期间发生变化，请重新选择。")
      }
      sha.update(data: chunk)
      data.append(chunk)
    }
    guard data.count == size else {
      throw OcrFailure("OCR_IMAGE_CHANGED", "图片读取期间发生变化，请重新选择。")
    }
    return (data, sha.finalize().map { String(format: "%02x", $0) }.joined())
  }
}

private struct OcrFailure: Error {
  let code: String
  let message: String
  init(_ code: String, _ message: String) { self.code = code; self.message = message }
}

private final class OcrJob: @unchecked Sendable {
  private let promise: Promise
  private let lock = NSLock()
  private var settled = false
  private var request: VNRecognizeTextRequest?
  private var timeout: DispatchWorkItem?

  init(promise: Promise) { self.promise = promise }

  func scheduleTimeout() {
    let item = DispatchWorkItem { [weak self] in
      self?.reject("OCR_TIMEOUT", "本机识别超过 45 秒，请拍清楚一道题后重试。")
    }
    lock.lock()
    timeout = item
    lock.unlock()
    DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 45, execute: item)
  }

  func setRequest(_ value: VNRecognizeTextRequest) throws {
    lock.lock()
    defer { lock.unlock() }
    guard !settled else { throw OcrFailure("OCR_CANCELLED", "本次识别已结束，请重试。") }
    request = value
  }

  func ensureOpen() throws {
    lock.lock()
    defer { lock.unlock() }
    if settled { throw OcrFailure("OCR_CANCELLED", "本次识别已结束，请重试。") }
  }

  func resolve(_ result: [String: Any]) {
    lock.lock()
    guard !settled else { lock.unlock(); return }
    settled = true
    lock.unlock()
    promise.resolve(result)
  }

  func reject(_ code: String, _ message: String) {
    lock.lock()
    guard !settled else { lock.unlock(); return }
    settled = true
    let currentRequest = request
    lock.unlock()
    currentRequest?.cancel()
    promise.reject(code, message)
  }

  func finish() {
    lock.lock()
    timeout?.cancel()
    timeout = nil
    request = nil
    lock.unlock()
  }
}
