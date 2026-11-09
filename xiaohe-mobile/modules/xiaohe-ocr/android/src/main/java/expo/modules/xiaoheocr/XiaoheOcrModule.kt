package expo.modules.xiaoheocr

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.net.Uri
import androidx.exifinterface.media.ExifInterface
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.TextRecognizer
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileInputStream
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

class XiaoheOcrModule : Module() {
  private val worker = Executors.newSingleThreadExecutor()
  private val timer = Executors.newSingleThreadScheduledExecutor()
  private val gate = Any()
  private var active: OcrJob? = null
  private var destroyed = false

  override fun definition() = ModuleDefinition {
    Name("XiaoheOcr")

    AsyncFunction("getAvailability") {
      mapOf("available" to true, "engine" to ENGINE, "engineVersion" to VERSION)
    }

    AsyncFunction("recognize") { uri: String, promise: Promise ->
      synchronized(gate) {
        when {
          destroyed -> promise.reject("OCR_DESTROYED", "识别页面已关闭，请重新打开。", null)
          active != null -> promise.reject("OCR_BUSY", "上一张图片仍在结束处理，请稍后重试。", null)
          else -> {
            val job = OcrJob(promise)
            active = job
            job.timeout = timer.schedule({ job.reject("OCR_TIMEOUT", "本机识别超过 45 秒，请拍清楚一道题后重试。") }, 45, TimeUnit.SECONDS)
            worker.execute { runRecognition(uri, job) }
          }
        }
      }
    }

    OnDestroy {
      synchronized(gate) {
        destroyed = true
        active?.reject("OCR_DESTROYED", "识别页面已关闭，请重新打开。")
        timer.shutdownNow()
        // A running ML Kit task still owns its input bitmap. Keep its callback executor
        // alive until completion; never recycle the image underneath the recognizer.
        if (active == null) worker.shutdown()
      }
    }
  }

  private fun runRecognition(uri: String, job: OcrJob) {
    try {
      job.ensureOpen()
      val file = ownedFile(uri)
      val (bytes, digest) = readSnapshot(file, job)
      job.ensureOpen()
      val bitmap = decodeOriented(bytes)
      job.bitmap = bitmap
      job.ensureOpen()
      val recognizer = TextRecognition.getClient(ChineseTextRecognizerOptions.Builder().build())
      job.recognizer = recognizer
      val width = bitmap.width
      val height = bitmap.height
      recognizer.process(InputImage.fromBitmap(bitmap, 0)).addOnCompleteListener(worker) { task ->
        try {
          job.ensureOpen()
          if (!file.isFile) throw OcrFailure("OCR_IMAGE_MISSING", "原图已移除，本次识别结果不会采用。")
          if (!task.isSuccessful) throw OcrFailure("OCR_FAILED", "这张图片未能完成识别，请重新拍摄或手工核对。")
          job.resolve(mapOf(
            "engine" to ENGINE,
            "engineVersion" to VERSION,
            "imageDigest" to digest,
            "width" to width,
            "height" to height,
            "lines" to extractLines(task.result, width, height)
          ))
        } catch (error: OcrFailure) {
          job.reject(error.code, error.message ?: "识别未完成，请重试。")
        } catch (_: OutOfMemoryError) {
          job.reject("OCR_MEMORY", "这张图片占用内存过大，请裁小为一道题后重试。")
        } catch (_: Exception) {
          job.reject("OCR_FAILED", "这张图片未能完成识别，请重新拍摄或手工核对。")
        } finally {
          finish(job)
        }
      }
    } catch (error: OcrFailure) {
      job.reject(error.code, error.message ?: "识别未完成，请重试。")
      finish(job)
    } catch (_: OutOfMemoryError) {
      job.reject("OCR_MEMORY", "这张图片占用内存过大，请裁小为一道题后重试。")
      finish(job)
    } catch (_: Exception) {
      job.reject("OCR_FAILED", "这张图片未能完成识别，请重新拍摄或手工核对。")
      finish(job)
    }
  }

  private fun finish(job: OcrJob) {
    job.timeout?.cancel(false)
    try { job.recognizer?.close() } catch (_: Exception) { /* No result is fabricated on cleanup failure. */ }
    job.bitmap?.recycle()
    job.bitmap = null
    synchronized(gate) {
      if (active === job) active = null
      if (destroyed) worker.shutdown()
    }
  }

  private fun ownedFile(value: String): File {
    val uri = Uri.parse(value)
    if (uri.scheme != "file" || !uri.authority.isNullOrEmpty() || uri.query != null || uri.fragment != null) {
      throw OcrFailure("OCR_IMAGE_PATH", "只能识别已保存在本应用中的图片。")
    }
    val path = uri.path ?: throw OcrFailure("OCR_IMAGE_PATH", "没有取得本机图片路径。")
    val input = File(path)
    val directory = File(appContext.persistentFilesDirectory, "xiaohe-images").canonicalFile
    val file = input.canonicalFile
    if (!PHOTO_NAME.matches(input.name) || file.name != input.name || file.parentFile != directory || !file.isFile) {
      throw OcrFailure("OCR_IMAGE_PATH", "原图不存在或不属于本应用保存的图片。")
    }
    return file
  }

  private fun readSnapshot(file: File, job: OcrJob): Pair<ByteArray, String> {
    val size = file.length()
    if (size <= 0 || size > MAX_BYTES) throw OcrFailure("OCR_IMAGE_SIZE", "图片为空或超过 15 MB，请重新拍摄一道题。")
    // The digest and decoded pixels use exactly the same bounded byte snapshot.
    // Hashing is incremental; no base64 copy crosses the JS bridge or reaches disk.
    val bytes = ByteArray(size.toInt())
    val sha = MessageDigest.getInstance("SHA-256")
    FileInputStream(file).use { stream ->
      var offset = 0
      while (offset < bytes.size) {
        job.ensureOpen()
        val count = stream.read(bytes, offset, minOf(64 * 1024, bytes.size - offset))
        if (count < 0) throw OcrFailure("OCR_IMAGE_CHANGED", "图片读取期间发生变化，请重新选择。")
        if (count == 0) continue
        sha.update(bytes, offset, count)
        offset += count
      }
      if (stream.read() != -1) throw OcrFailure("OCR_IMAGE_CHANGED", "图片读取期间发生变化，请重新选择。")
    }
    if (!file.isFile) throw OcrFailure("OCR_IMAGE_MISSING", "原图已移除，请重新选择。")
    return bytes to sha.digest().joinToString("") { "%02x".format(it.toInt() and 0xff) }
  }

  private fun decodeOriented(bytes: ByteArray): Bitmap {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    val width = bounds.outWidth
    val height = bounds.outHeight
    if (width <= 0 || height <= 0 || bounds.outMimeType !in IMAGE_TYPES) {
      throw OcrFailure("OCR_IMAGE_FORMAT", "当前图片格式不能识别，请改用静态 JPG 或 PNG 图片。")
    }
    if (width > MAX_SOURCE_EDGE || height > MAX_SOURCE_EDGE || width.toLong() * height > MAX_SOURCE_PIXELS) {
      throw OcrFailure("OCR_IMAGE_DIMENSIONS", "图片尺寸过大，请裁小为一道题后重试。")
    }
    var sample = 1
    while ((maxOf(width, height) + sample - 1) / sample > MAX_WORK_EDGE) sample *= 2
    val options = BitmapFactory.Options().apply {
      inSampleSize = sample
      inPreferredConfig = Bitmap.Config.ARGB_8888
      inScaled = false
    }
    val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
      ?: throw OcrFailure("OCR_IMAGE_FORMAT", "图片无法解码，请重新拍摄。")
    try {
      val orientation = ByteArrayInputStream(bytes).use {
        ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
      }
      val matrix = Matrix()
      when (orientation) {
        ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.setScale(-1f, 1f)
        ExifInterface.ORIENTATION_ROTATE_180 -> matrix.setRotate(180f)
        ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.setScale(1f, -1f)
        ExifInterface.ORIENTATION_TRANSPOSE -> { matrix.setRotate(90f); matrix.postScale(-1f, 1f) }
        ExifInterface.ORIENTATION_ROTATE_90 -> matrix.setRotate(90f)
        ExifInterface.ORIENTATION_TRANSVERSE -> { matrix.setRotate(270f); matrix.postScale(-1f, 1f) }
        ExifInterface.ORIENTATION_ROTATE_270 -> matrix.setRotate(270f)
      }
      if (matrix.isIdentity) return bitmap
      val oriented = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
      if (oriented !== bitmap) bitmap.recycle()
      return oriented
    } catch (error: Throwable) {
      bitmap.recycle()
      throw error
    }
  }

  private fun extractLines(result: Text, width: Int, height: Int): List<Map<String, Any?>> {
    val lines = mutableListOf<Map<String, Any?>>()
    var textLength = 0
    for (block in result.textBlocks) for (line in block.lines) {
      if (line.text.isBlank()) continue
      val box = line.boundingBox ?: throw OcrFailure("OCR_LINE_BOUNDS", "识别未取得可靠的文字位置，请手工核对。")
      textLength += line.text.length
      if (lines.size >= 300 || textLength > 30000 || line.text.length > 2000) {
        throw OcrFailure("OCR_TOO_MUCH_TEXT", "图片文字太多，请裁小为一道题后重试。")
      }
      val left = box.left.toDouble().coerceIn(0.0, width.toDouble()) / width
      val top = box.top.toDouble().coerceIn(0.0, height.toDouble()) / height
      val right = box.right.toDouble().coerceIn(0.0, width.toDouble()) / width
      val bottom = box.bottom.toDouble().coerceIn(0.0, height.toDouble()) / height
      if (right <= left || bottom <= top) throw OcrFailure("OCR_LINE_BOUNDS", "识别文字位置异常，请重新拍摄。")
      lines.add(mapOf(
        "id" to "line-${lines.size + 1}",
        "text" to line.text,
        // Do not turn undocumented Chinese-model scores into a correctness percentage.
        "confidence" to null,
        "box" to mapOf("x" to left, "y" to top, "width" to right - left, "height" to bottom - top)
      ))
    }
    return lines
  }

  private class OcrFailure(val code: String, message: String) : Exception(message)

  private class OcrJob(private val promise: Promise) {
    private val settled = AtomicBoolean(false)
    var timeout: ScheduledFuture<*>? = null
    var bitmap: Bitmap? = null
    var recognizer: TextRecognizer? = null
    fun resolve(result: Map<String, Any?>) { if (settled.compareAndSet(false, true)) promise.resolve(result) }
    fun reject(code: String, message: String) { if (settled.compareAndSet(false, true)) promise.reject(code, message, null) }
    fun ensureOpen() { if (settled.get()) throw OcrFailure("OCR_CANCELLED", "本次识别已结束，请重试。") }
  }

  companion object {
    private const val ENGINE = "mlkit-chinese"
    private const val VERSION = "text-recognition-chinese:16.0.1"
    private const val MAX_BYTES = 15L * 1024 * 1024
    private const val MAX_SOURCE_PIXELS = 48_000_000L
    private const val MAX_SOURCE_EDGE = 16000
    private const val MAX_WORK_EDGE = 2048
    private val PHOTO_NAME = Regex("[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\\.(?:jpe?g|png|webp|heic|heif|avif)", RegexOption.IGNORE_CASE)
    private val IMAGE_TYPES = setOf("image/jpeg", "image/png", "image/webp", "image/heif", "image/heic", "image/avif")
  }
}
