package mg.matchscores.app

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.Image
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Handler
import android.os.HandlerThread
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions

/**
 * Lecture de l'écran par capture + reconnaissance de texte (comme Hi Translate).
 * Ne demande pas l'accessibilité : seulement l'accord « Commencer » de la capture d'écran.
 */
class ScreenCapture(private val context: Context, resultCode: Int, data: Intent, private val onStopped: () -> Unit) {

    private val thread = HandlerThread("ms-capture").apply { start() }
    private val handler = Handler(thread.looper)
    private val lock = Any()
    private var latest: Image? = null
    private val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)

    private val projection: MediaProjection
    private val reader: ImageReader
    private val display: VirtualDisplay

    init {
        val metrics = context.resources.displayMetrics
        // Résolution réduite si l'écran est très grand : suffisant pour l'OCR et plus rapide.
        val scale = if (metrics.widthPixels > 1080) 1080f / metrics.widthPixels else 1f
        val w = (metrics.widthPixels * scale).toInt()
        val h = (metrics.heightPixels * scale).toInt()

        val mpm = context.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        projection = mpm.getMediaProjection(resultCode, data)
        projection.registerCallback(object : MediaProjection.Callback() {
            override fun onStop() {
                release()
                onStopped()
            }
        }, handler)

        reader = ImageReader.newInstance(w, h, PixelFormat.RGBA_8888, 3)
        reader.setOnImageAvailableListener({ r ->
            val img = try {
                r.acquireLatestImage()
            } catch (_: Exception) {
                null
            } ?: return@setOnImageAvailableListener
            synchronized(lock) {
                latest?.close()
                latest = img
            }
        }, handler)

        display = projection.createVirtualDisplay(
            "matchscores", w, h, metrics.densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, reader.surface, null, handler,
        )
    }

    private fun snapshot(): Bitmap? = synchronized(lock) {
        val img = latest ?: return null
        val plane = img.planes[0]
        val buffer = plane.buffer.apply { rewind() }
        val pixelStride = plane.pixelStride
        val rowPadding = plane.rowStride - pixelStride * img.width
        val padded = Bitmap.createBitmap(img.width + rowPadding / pixelStride, img.height, Bitmap.Config.ARGB_8888)
        padded.copyPixelsFromBuffer(buffer)
        if (rowPadding == 0) padded else Bitmap.createBitmap(padded, 0, 0, img.width, img.height)
    }

    /** Lit le texte de l'écran ; [done] reçoit les lignes (une par ligne d'écran) ou null. */
    fun read(done: (String?) -> Unit) {
        val bmp = snapshot() ?: return done(null)
        recognizer.process(InputImage.fromBitmap(bmp, 0))
            .addOnSuccessListener { done(toLines(it)) }
            .addOnFailureListener { done(null) }
    }

    fun release() {
        try {
            display.release()
        } catch (_: Exception) {
        }
        try {
            projection.stop()
        } catch (_: Exception) {
        }
        synchronized(lock) {
            latest?.close()
            latest = null
        }
        reader.close()
        thread.quitSafely()
    }

    private data class Line(val text: String, val top: Int, val bottom: Int, val left: Int) {
        val center get() = (top + bottom) / 2
        val height get() = bottom - top
    }

    /** Remet les lignes OCR dans l'ordre de lecture : de haut en bas, puis de gauche à droite. */
    private fun toLines(text: Text): String {
        val lines = text.textBlocks.flatMap { b ->
            b.lines.mapNotNull { l -> l.boundingBox?.let { Line(l.text.trim(), it.top, it.bottom, it.left) } }
        }.filter { it.text.isNotEmpty() }.sortedBy { it.center }

        val rows = mutableListOf<MutableList<Line>>()
        for (l in lines) {
            val row = rows.lastOrNull()
            val ref = row?.first()
            if (row != null && ref != null && kotlin.math.abs(l.center - ref.center) <= maxOf(ref.height, l.height) / 2) row.add(l)
            else rows.add(mutableListOf(l))
        }
        return rows.joinToString("\n") { row -> row.sortedBy { it.left }.joinToString("\n") { it.text } }
    }
}
