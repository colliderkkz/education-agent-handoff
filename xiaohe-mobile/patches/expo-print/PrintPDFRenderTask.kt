package expo.modules.print

import android.annotation.SuppressLint
import android.content.Context
import android.os.CancellationSignal
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.os.SystemClock
import android.print.PageRange
import android.print.PrintAttributes
import android.print.PrintDocumentAdapter
import android.print.PrintDocumentAdapterLayoutCallback
import android.print.PrintDocumentAdapterWriteCallback
import android.print.PrintDocumentInfo
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.annotation.UiThread
import expo.modules.kotlin.exception.CodedException
import java.io.File
import kotlin.math.roundToInt

internal class PrintPDFRenderTask(private val context: Context, private val options: PrintOptions) {
  companion object {
    // Native method-entry budget; JS still guards its own dispatch/result lifetime.
    const val FILE_RENDER_TIMEOUT_MS = 25_000L
  }

  private val PIXELS_PER_INCH = 72
  private val MILS_PER_INCH = 1000.0
  private val PIXELS_PER_MIL = PIXELS_PER_INCH / MILS_PER_INCH
  private val DEFAULT_MEDIA_WIDTH = 612
  private val DEFAULT_MEDIA_HEIGHT = 792
  private lateinit var outputFile: File
  private lateinit var callbacks: Callbacks
  private var webView: WebView? = null
  private var fileDescriptor: ParcelFileDescriptor? = null
  private var document: PrintDocumentAdapter? = null
  private var numberOfPages = 0
  private var fileRender = false
  private var layoutStarted = false
  private var writeStarted = false
  private var finished = false
  private var deadline = 0L
  private val mainHandler = Handler(Looper.getMainLooper())
  private val cancellationSignal = CancellationSignal()
  private val timeout = Runnable { failFileRender(timeoutException()) }

  @UiThread
  fun render(outputFile: File?, fileDescriptor: ParcelFileDescriptor?, callbacks: Callbacks, fileDeadline: Long? = null) {
    this.callbacks = callbacks
    this.fileDescriptor = fileDescriptor
    fileRender = fileDescriptor != null
    outputFile?.let { this.outputFile = it }
    if (fileRender) {
      deadline = fileDeadline ?: (SystemClock.elapsedRealtime() + FILE_RENDER_TIMEOUT_MS)
      val remaining = deadline - SystemClock.elapsedRealtime()
      if (remaining <= 0) {
        failFileRender(timeoutException())
        return
      }
      mainHandler.postDelayed(timeout, remaining)
    }

    try {
      val html = options.html ?: ""
      val view = WebView(context)
      webView = view
      view.settings.defaultTextEncodingName = "UTF-8"
      view.webViewClient = webViewClient
      options.textZoom?.let { view.settings.textZoom = it }
      view.loadDataWithBaseURL(null, html, "text/html; charset=utf-8", "UTF-8", null)
    } catch (error: Exception) {
      if (!fileRender) throw error
      failFileRender(UnexpectedPrintException("Could not start PDF rendering", error))
    }
  }

  private val printAttributes: PrintAttributes
    get() {
      val builder = PrintAttributes.Builder()
      if (options.html != null) {
        var width = DEFAULT_MEDIA_WIDTH
        var height = DEFAULT_MEDIA_HEIGHT
        options.width?.let { width = it }
        options.height?.let { height = it }
        var mediaSize = PrintAttributes.MediaSize(
          "id", "label",
          (width / PIXELS_PER_MIL).roundToInt(),
          (height / PIXELS_PER_MIL).roundToInt()
        )
        options.orientation?.let {
          if (it === "landscape") mediaSize = mediaSize.asLandscape()
        }
        builder
          .setMediaSize(mediaSize)
          .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
          .setResolution(PrintAttributes.Resolution("id", "label", PIXELS_PER_INCH, PIXELS_PER_INCH))
      }
      return builder.build()
    }

  private val webViewClient: WebViewClient = object : WebViewClient() {
    override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean = false

    override fun onPageFinished(view: WebView, url: String) {
      if (fileRender && (!isFileRenderActive() || layoutStarted)) return
      layoutStarted = true
      try {
        val adapter = view.createPrintDocumentAdapter("Document")
        document = adapter
        @SuppressLint("Range")
        val pageHeight = PIXELS_PER_MIL * printAttributes.mediaSize!!.heightMils
        numberOfPages = 1 + (view.contentHeight / pageHeight).toInt()
        if (fileRender) {
          adapter.onStart()
          adapter.onLayout(null, printAttributes, cancellationSignal, fileLayoutCallback, null)
        } else {
          // Preserve the upstream printer handoff. PrintManager owns this adapter;
          // file-render cleanup must not destroy it after the handoff.
          adapter.onLayout(null, printAttributes, null, object : PrintDocumentAdapterLayoutCallback() {}, null)
          callbacks.onRenderFinished(adapter, null, numberOfPages)
        }
      } catch (error: Exception) {
        if (!fileRender) throw error
        failFileRender(UnexpectedPrintException("Could not lay out PDF", error))
      }
    }

    override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
      if (!fileRender) return super.onRenderProcessGone(view, detail)
      onMain {
        failFileRender(UnexpectedPrintException("PDF WebView renderer exited (didCrash=${detail.didCrash()})"))
      }
      return true
    }
  }

  private val fileLayoutCallback = object : PrintDocumentAdapterLayoutCallback() {
    override fun onLayoutFinished(info: PrintDocumentInfo, changed: Boolean) {
      onMain {
        if (!isFileRenderActive() || writeStarted) return@onMain
        writeStarted = true
        if (info.pageCount > 0) numberOfPages = info.pageCount
        try {
          // Layout is asynchronous: writing starts only after its success callback.
          document!!.onWrite(arrayOf(PageRange.ALL_PAGES), fileDescriptor, cancellationSignal, printDocumentWriteCallback)
        } catch (error: Exception) {
          failFileRender(PdfWriteException(error))
        }
      }
    }

    override fun onLayoutFailed(error: CharSequence?) {
      onMain { failFileRender(UnexpectedPrintException("PDF layout failed: $error")) }
    }

    override fun onLayoutCancelled() {
      onMain { failFileRender(UnexpectedPrintException("PDF layout was cancelled")) }
    }
  }

  private val printDocumentWriteCallback = object : PrintDocumentAdapterWriteCallback() {
    override fun onWriteFinished(pages: Array<PageRange>) {
      onMain {
        if (!isFileRenderActive()) return@onMain
        val adapter = document ?: return@onMain
        finished = true
        releaseFileResources(cancel = false, deleteOutput = false)
        callbacks.onRenderFinished(adapter, outputFile, numberOfPages)
      }
    }

    override fun onWriteFailed(error: CharSequence?) {
      onMain { failFileRender(UnexpectedPrintException("PDF write failed: $error")) }
    }

    override fun onWriteCancelled() {
      onMain { failFileRender(UnexpectedPrintException("PDF write was cancelled")) }
    }
  }

  private fun timeoutException() = UnexpectedPrintException("PDF rendering timed out after 25 seconds")

  @UiThread
  private fun isFileRenderActive(): Boolean {
    if (finished) return false
    // If Main was delayed, a queued success still cannot escape the deadline.
    if (SystemClock.elapsedRealtime() >= deadline) {
      failFileRender(timeoutException())
      return false
    }
    return true
  }

  @UiThread
  private fun failFileRender(exception: CodedException) {
    if (!fileRender || finished) return
    finished = true
    releaseFileResources(cancel = true, deleteOutput = true)
    callbacks.onRenderError(exception)
  }

  @UiThread
  fun disposeFileRender() {
    if (!fileRender || finished) return
    // Coroutine cancellation: no result callback, and all later callbacks are inert.
    finished = true
    releaseFileResources(cancel = true, deleteOutput = true)
  }

  @UiThread
  private fun releaseFileResources(cancel: Boolean, deleteOutput: Boolean) {
    // Marked finished before invoking APIs that may synchronously call us back.
    mainHandler.removeCallbacks(timeout)
    if (cancel) runCatching { cancellationSignal.cancel() }
    val adapter = document
    document = null
    runCatching { adapter?.onFinish() }
    val view = webView
    webView = null
    runCatching { view?.stopLoading() }
    runCatching { view?.destroy() }
    val descriptor = fileDescriptor
    fileDescriptor = null
    runCatching { descriptor?.close() }
    if (deleteOutput && ::outputFile.isInitialized) runCatching { outputFile.delete() }
  }

  private fun onMain(action: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) action() else mainHandler.post { action() }
  }

  abstract class Callbacks {
    open fun onRenderFinished(document: PrintDocumentAdapter, outputFile: File?, numberOfPages: Int) = Unit
    open fun onRenderError(exception: CodedException) = Unit
  }
}
