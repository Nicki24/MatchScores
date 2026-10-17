package mg.matchscores.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONObject

/** Écran principal : l'app web MatchScores + un pont JavaScript pour régler la bulle. */
class MainActivity : Activity() {

    companion object {
        const val EXTRA_RELOAD = "reload"
        const val EXTRA_REQUEST_CAPTURE = "requestCapture"
        private const val REQ_CAPTURE = 42
    }

    private lateinit var web: WebView
    private var captureFromBubble = false
    private val appHost: String? by lazy { Uri.parse(BuildConfig.APP_URL).host }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.parseColor("#060912")
        window.navigationBarColor = Color.parseColor("#060912")
        web = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#060912"))
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            addJavascriptInterface(AppBridge(), "MatchScoresAndroid")
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    if (request.url.host == appHost) return false
                    openExternal(request.url)
                    return true
                }
            }
        }
        setContentView(web)
        web.loadUrl(BuildConfig.APP_URL + if (savedInstanceState == null) "/connecter" else "/")
        if (intent.getBooleanExtra(EXTRA_REQUEST_CAPTURE, false)) {
            captureFromBubble = true
            requestCapture()
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.getBooleanExtra(EXTRA_RELOAD, false)) web.loadUrl(BuildConfig.APP_URL + "/")
        if (intent.getBooleanExtra(EXTRA_REQUEST_CAPTURE, false)) {
            captureFromBubble = true
            requestCapture()
        }
    }

    /** Demande l'accord de capture d'écran (fenêtre Android « Commencer »). */
    private fun requestCapture() {
        val mpm = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        @Suppress("DEPRECATION")
        startActivityForResult(mpm.createScreenCaptureIntent(), REQ_CAPTURE)
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQ_CAPTURE) return
        val service = Intent(this, BubbleService::class.java)
        if (resultCode == RESULT_OK && data != null) {
            service.putExtra(BubbleService.EXTRA_RESULT_CODE, resultCode).putExtra(BubbleService.EXTRA_DATA, data)
        }
        startForegroundService(service)
        // Demandé depuis la bulle : on revient directement sur Bet261.
        if (resultCode == RESULT_OK && captureFromBubble) moveTaskToBack(true)
        captureFromBubble = false
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else super.onBackPressed()
    }

    private fun openExternal(uri: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
        } catch (_: Exception) {
        }
    }

    /** Fonctions appelées par la page Connecter (window.MatchScoresAndroid). */
    inner class AppBridge {
        @JavascriptInterface
        fun status(): String = JSONObject()
            .put("overlay", Settings.canDrawOverlays(this@MainActivity))
            .put("accessibility", ScreenReaderService.instance != null)
            .put("bubble", BubbleService.running)
            .put("capture", BubbleService.capturing)
            .put("version", BuildConfig.VERSION_NAME)
            .toString()

        @JavascriptInterface
        fun requestOverlay() {
            runOnUiThread {
                startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
            }
        }

        @JavascriptInterface
        fun openAccessibility() {
            runOnUiThread { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }
        }

        @JavascriptInterface
        fun openAppInfo() {
            runOnUiThread {
                startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName")))
            }
        }

        @JavascriptInterface
        fun startBubble() {
            runOnUiThread {
                if (!Settings.canDrawOverlays(this@MainActivity)) {
                    requestOverlay()
                    return@runOnUiThread
                }
                if (Build.VERSION.SDK_INT >= 33) {
                    requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
                }
                // La bulle démarre après l'accord de capture d'écran (onActivityResult).
                requestCapture()
            }
        }

        @JavascriptInterface
        fun requestCaptureAgain() {
            runOnUiThread { requestCapture() }
        }

        @JavascriptInterface
        fun stopBubble() {
            runOnUiThread {
                if (BubbleService.running) {
                    startService(Intent(this@MainActivity, BubbleService::class.java).setAction(BubbleService.ACTION_STOP))
                }
            }
        }

        @JavascriptInterface
        fun openUrl(url: String) {
            runOnUiThread { openExternal(Uri.parse(url)) }
        }
    }
}
