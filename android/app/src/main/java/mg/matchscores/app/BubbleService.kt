package mg.matchscores.app

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.Icon
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.TextView
import android.widget.Toast
import org.json.JSONObject
import kotlin.math.abs

/**
 * Bulle flottante « MS » affichée par-dessus les autres applis.
 * Toucher la bulle (ou la déplacer puis la relâcher) lit l'écran et ouvre le panneau d'analyse.
 */
class BubbleService : Service() {

    companion object {
        const val ACTION_STOP = "mg.matchscores.app.STOP"
        const val EXTRA_RESULT_CODE = "resultCode"
        const val EXTRA_DATA = "data"
        private const val CHANNEL = "bubble"

        @Volatile
        var running = false
            private set

        @Volatile
        var capturing = false
            private set
    }

    private lateinit var wm: WindowManager
    private val main = Handler(Looper.getMainLooper())
    private var bubble: TextView? = null
    private lateinit var bubbleParams: WindowManager.LayoutParams
    private var panel: WebView? = null
    private var panelShown = false
    private var panelReady = false
    private var pending: ScreenReaderService.Capture? = null
    private var screen: ScreenCapture? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        wm = getSystemService(WINDOW_SERVICE) as WindowManager
        startInForeground(false)
        if (!Settings.canDrawOverlays(this)) {
            Toast.makeText(this, "Autorise l'affichage par-dessus les autres applis", Toast.LENGTH_LONG).show()
            stopSelf()
            return
        }
        running = true
        addBubble()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopSelf()
            return START_NOT_STICKY
        }
        val code = intent?.getIntExtra(EXTRA_RESULT_CODE, 0) ?: 0
        val data: Intent? = if (Build.VERSION.SDK_INT >= 33) {
            intent?.getParcelableExtra(EXTRA_DATA, Intent::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent?.getParcelableExtra(EXTRA_DATA)
        }
        if (data != null && running) startCapture(code, data)
        return START_STICKY
    }

    /** Démarre la capture d'écran autorisée par l'utilisateur (accord « Commencer »). */
    private fun startCapture(code: Int, data: Intent) {
        try {
            startInForeground(true) // Android exige ce type de service avant la capture
            screen?.release()
            screen = ScreenCapture(this, code, data) {
                main.post {
                    screen = null
                    capturing = false
                }
            }
            capturing = true
        } catch (e: Exception) {
            capturing = false
            Toast.makeText(this, "Capture d'écran impossible : ${e.message}", Toast.LENGTH_LONG).show()
        }
    }

    override fun onDestroy() {
        running = false
        capturing = false
        screen?.release()
        screen = null
        bubble?.let { safeRemove(it) }
        panel?.let {
            if (panelShown) safeRemove(it)
            it.destroy()
        }
        bubble = null
        panel = null
        super.onDestroy()
    }

    private fun dp(v: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt()

    private fun safeRemove(v: View) {
        try {
            wm.removeView(v)
        } catch (_: Exception) {
        }
    }

    private fun startInForeground(withCapture: Boolean) {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "Bulle flottante", NotificationManager.IMPORTANCE_LOW))
        val stop = PendingIntent.getService(
            this, 1, Intent(this, BubbleService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE,
        )
        val open = PendingIntent.getActivity(
            this, 2, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE,
        )
        val n = Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("Bulle MatchScores active")
            .setContentText("Touche la bulle sur Bet261 pour analyser les matchs")
            .setContentIntent(open)
            .addAction(Notification.Action.Builder(null as Icon?, "Arrêter", stop).build())
            .setOngoing(true)
            .build()
        val capture = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
        when {
            Build.VERSION.SDK_INT >= 34 ->
                startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE or (if (withCapture) capture else 0))
            Build.VERSION.SDK_INT >= 29 && withCapture -> startForeground(1, n, capture)
            else -> startForeground(1, n)
        }
    }

    private fun overlayParams(w: Int, h: Int, flags: Int) = WindowManager.LayoutParams(
        w, h,
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
        flags,
        PixelFormat.TRANSLUCENT,
    )

    @SuppressLint("ClickableViewAccessibility", "SetTextI18n")
    private fun addBubble() {
        val size = dp(58)
        val view = TextView(this).apply {
            text = "MS"
            gravity = Gravity.CENTER
            setTextColor(Color.parseColor("#052E1A"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 17f)
            typeface = Typeface.DEFAULT_BOLD
            background = GradientDrawable(
                GradientDrawable.Orientation.TL_BR,
                intArrayOf(Color.parseColor("#34D399"), Color.parseColor("#22D3EE")),
            ).apply {
                shape = GradientDrawable.OVAL
                setStroke(dp(2), Color.parseColor("#CCFFFFFF"))
            }
            elevation = dp(8).toFloat()
        }
        bubbleParams = overlayParams(
            size, size,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = resources.displayMetrics.widthPixels - size - dp(8)
            y = resources.displayMetrics.heightPixels / 3
        }

        val slop = ViewConfiguration.get(this).scaledTouchSlop
        var startX = 0
        var startY = 0
        var downX = 0f
        var downY = 0f
        var moved = false
        view.setOnTouchListener { v, e ->
            when (e.action) {
                MotionEvent.ACTION_DOWN -> {
                    startX = bubbleParams.x
                    startY = bubbleParams.y
                    downX = e.rawX
                    downY = e.rawY
                    moved = false
                    v.animate().scaleX(0.9f).scaleY(0.9f).setDuration(80).start()
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = (e.rawX - downX).toInt()
                    val dy = (e.rawY - downY).toInt()
                    if (abs(dx) > slop || abs(dy) > slop) moved = true
                    if (moved) {
                        bubbleParams.x = startX + dx
                        bubbleParams.y = startY + dy
                        wm.updateViewLayout(v, bubbleParams)
                    }
                }
                MotionEvent.ACTION_UP -> {
                    v.animate().scaleX(1f).scaleY(1f).setDuration(80).start()
                    // Toucher ou déposer la bulle sur l'écran des matchs = analyser.
                    analyze()
                }
            }
            true
        }
        wm.addView(view, bubbleParams)
        bubble = view
    }

    private fun analyze() {
        // 1. Accessibilité (si activée) : lit aussi le texte hors de l'écran.
        val reader = ScreenReaderService.instance
        val a11y = reader?.capture()
        if (a11y != null && a11y.text.isNotBlank()) return deliver(a11y)

        // 2. Capture d'écran + reconnaissance de texte (comme Hi Translate).
        val cap = screen
        if (cap == null) {
            Toast.makeText(this, "Autorise la capture d'écran (bouton « Commencer »)", Toast.LENGTH_LONG).show()
            startActivity(
                Intent(this, MainActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    .putExtra(MainActivity.EXTRA_REQUEST_CAPTURE, true),
            )
            return
        }
        // On masque la bulle et le panneau le temps de la capture.
        bubble?.alpha = 0f
        hidePanel()
        main.postDelayed({
            cap.read { text ->
                main.post {
                    bubble?.alpha = 1f
                    if (text.isNullOrBlank()) {
                        Toast.makeText(this, "Aucun texte lu, réessaie dans une seconde", Toast.LENGTH_SHORT).show()
                    } else {
                        deliver(ScreenReaderService.Capture(text, "écran", text.count { it == '\n' } + 1))
                    }
                }
            }
        }, 350)
    }

    private fun deliver(c: ScreenReaderService.Capture) {
        showPanel()
        if (panelReady) send(c) else pending = c
    }

    private fun send(c: ScreenReaderService.Capture) {
        val args = "${JSONObject.quote(c.text)}, ${JSONObject.quote(c.pkg)}"
        // Si la page n'a pas encore fini de démarrer, on met le texte en file d'attente.
        val js = "window.msIngest ? window.msIngest($args) : (window.__msQueue = window.__msQueue || []).push([$args])"
        panel?.evaluateJavascript(js, null)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun ensurePanel(): WebView {
        panel?.let { return it }
        val web = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#060912"))
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            addJavascriptInterface(PanelBridge(), "MatchScoresPanel")
            webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView?, url: String?) {
                    panelReady = true
                    pending?.let { send(it) }
                    pending = null
                }
            }
            loadUrl(BuildConfig.APP_URL + "/bulle")
        }
        panel = web
        return web
    }

    private fun showPanel() {
        val web = ensurePanel()
        if (panelShown) return
        val m = resources.displayMetrics
        val params = overlayParams(
            (m.widthPixels * 0.94).toInt(),
            (m.heightPixels * 0.6).toInt(),
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
        ).apply {
            gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
            y = dp(16)
        }
        wm.addView(web, params)
        panelShown = true
        // La bulle reste au-dessus du panneau.
        bubble?.let {
            safeRemove(it)
            wm.addView(it, bubbleParams)
        }
    }

    private fun hidePanel() {
        val web = panel ?: return
        if (panelShown) safeRemove(web)
        panelShown = false
    }

    /** Fonctions appelées par la page /bulle. */
    inner class PanelBridge {
        @JavascriptInterface
        fun close() {
            main.post { hidePanel() }
        }

        @JavascriptInterface
        fun openApp() {
            main.post {
                hidePanel()
                startActivity(
                    Intent(this@BubbleService, MainActivity::class.java)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        .putExtra(MainActivity.EXTRA_RELOAD, true),
                )
            }
        }

        @JavascriptInterface
        fun stopBubble() {
            main.post { stopSelf() }
        }
    }
}
