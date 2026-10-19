package mg.matchscores.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.ContentValues
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.util.Base64
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.FileProvider
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File

/**
 * Écran unique de l'appli :
 *  - « ui » : l'interface MatchScores (fichiers embarqués, servis en https://appassets.androidplatform.net) ;
 *  - « collector » : bet261 ouvert comme dans un navigateur, avec le script collecteur injecté
 *    dans chaque page et iframe. Ce qu'il relève est transmis à l'interface, qui l'enregistre.
 * Le collecteur reste chargé derrière l'interface pour continuer la collecte pendant l'analyse.
 */
class MainActivity : Activity() {

    companion object {
        private const val APP_ORIGIN = "https://appassets.androidplatform.net"
        private const val UI_URL = "$APP_ORIGIN/assets/app/index.html"
        private const val DEFAULT_START = "https://bet261.mg/"
        private const val PREFS = "matchscores"
        private const val CHANNEL = "alerts"
    }

    private val main = Handler(Looper.getMainLooper())
    private lateinit var ui: WebView
    private lateinit var collector: WebView
    private lateinit var pane: LinearLayout
    private lateinit var barTitle: TextView
    private lateinit var collectorJs: String
    private val pending = ArrayDeque<String>()
    private var uiReady = false
    private var collectorStarted = false
    private var collectorVisible = false
    private var collectorLoading = false
    private var retries = 0
    private val chunks = HashMap<String, Array<String?>>()

    private fun dp(v: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt()

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true)
        collectorJs = assets.open("collector.js").bufferedReader().use { it.readText() }

        val root = FrameLayout(this)
        root.setBackgroundColor(Color.parseColor("#070B14"))
        // Marges sous la barre d'état et la barre de navigation
        root.setOnApplyWindowInsetsListener { v, insets ->
            if (Build.VERSION.SDK_INT >= 30) {
                val b = insets.getInsets(android.view.WindowInsets.Type.systemBars() or android.view.WindowInsets.Type.ime())
                v.setPadding(b.left, b.top, b.right, b.bottom)
            } else {
                @Suppress("DEPRECATION")
                v.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop, insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
            }
            insets
        }

        pane = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(Color.parseColor("#0B111E"))
            setPadding(dp(6), dp(4), dp(6), dp(4))
        }
        val back = Button(this).apply {
            text = "← Analyse"
            isAllCaps = false
            setOnClickListener { showCollector(false) }
        }
        barTitle = TextView(this).apply {
            setTextColor(Color.parseColor("#CBD5E1"))
            textSize = 12f
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.END
            setPadding(dp(8), 0, dp(8), 0)
        }
        val reload = Button(this).apply {
            text = "↻"
            setOnClickListener { collector.reload() }
        }
        bar.addView(back)
        bar.addView(barTitle, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        bar.addView(reload)

        collector = WebView(this)
        setupCollector()
        pane.addView(bar, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        pane.addView(collector, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))

        ui = WebView(this)
        setupUi()

        root.addView(pane, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        root.addView(ui, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        setContentView(root)

        ui.loadUrl(UI_URL)
        handleIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    /** Adresse de départ imposée (tests automatiques sur le site de test). */
    private fun handleIntent(intent: Intent?) {
        val url = intent?.getStringExtra("collectorUrl") ?: return
        if (url.startsWith("http://") || url.startsWith("https://")) {
            startCollector(url)
        }
    }

    /* ---------------- Collecteur (bet261) ---------------- */

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupCollector() {
        collector.setBackgroundColor(Color.WHITE)
        collector.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = true
            loadWithOverviewMode = true
            useWideViewPort = true
            // User-Agent honnête : navigateur Android + nom de l'outil (cahier des charges, section 7)
            userAgentString = "$userAgentString MatchScores/${BuildConfig.VERSION_NAME}"
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(collector, collectorJs, setOf("*"))
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(collector, "MSBridge", setOf("*")) { _, message, _, _, _ ->
                message.data?.let { sendToUi(it) }
            }
        } else {
            collector.addJavascriptInterface(object {
                @android.webkit.JavascriptInterface
                fun postMessage(s: String) {
                    main.post { sendToUi(s) }
                }
            }, "MSBridge")
        }
        collector.webChromeClient = object : WebChromeClient() {
            override fun onReceivedTitle(view: WebView, title: String?) {
                barTitle.text = title ?: view.url
                sendCollectorState()
            }
        }
        collector.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val scheme = request.url.scheme ?: return true
                if (scheme == "http" || scheme == "https") return false
                // tel:, mailto:, intent:… → hors de l'appli
                openExternal(request.url)
                return true
            }

            override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
                collectorLoading = true
                // Sans injection au démarrage du document : injection dès le début du chargement
                if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) view.evaluateJavascript(collectorJs, null)
                sendCollectorState()
            }

            override fun onPageFinished(view: WebView, url: String?) {
                collectorLoading = false
                retries = 0
                if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) view.evaluateJavascript(collectorJs, null)
                if (url != null && url.contains("bet261")) getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString("lastUrl", url).apply()
                barTitle.text = view.title ?: url
                sendCollectorState()
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (!request.isForMainFrame) return
                // Reprise automatique : 3 tentatives, délai croissant (NF2)
                if (retries < 3) {
                    val delay = 10_000L * (1L shl retries)
                    retries++
                    main.postDelayed({ view.reload() }, delay)
                }
            }

            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                recreate()
                return true
            }
        }
    }

    private fun startCollector(url: String? = null) {
        val target = url ?: getSharedPreferences(PREFS, MODE_PRIVATE).getString("lastUrl", null) ?: DEFAULT_START
        collectorStarted = true
        collector.loadUrl(target)
    }

    private fun showCollector(show: Boolean) {
        if (show && !collectorStarted) startCollector()
        collectorVisible = show
        ui.visibility = if (show) View.GONE else View.VISIBLE
        sendCollectorState()
    }

    private fun sendCollectorState() {
        val state = JSONObject()
            .put("t", "collector")
            .put("visible", collectorVisible)
            .put("url", collector.url ?: JSONObject.NULL)
            .put("loading", collectorLoading)
            .put("title", collector.title ?: JSONObject.NULL)
        sendToUi(state.toString())
    }

    /* ---------------- Interface (MatchScores) ---------------- */

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupUi() {
        val loader = WebViewAssetLoader.Builder().addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this)).build()
        ui.setBackgroundColor(Color.parseColor("#070B14"))
        ui.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
        }
        ui.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? = loader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.url.toString().startsWith(APP_ORIGIN)) return false
                openExternal(request.url)
                return true
            }

            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                recreate()
                return true
            }
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(ui, "MSNative", setOf(APP_ORIGIN)) { _, message, _, _, _ ->
                message.data?.let { onUiMessage(it) }
            }
        } else {
            ui.addJavascriptInterface(object {
                @android.webkit.JavascriptInterface
                fun postMessage(s: String) {
                    main.post { onUiMessage(s) }
                }
            }, "MSNative")
        }
    }

    private fun sendToUi(json: String) {
        if (!uiReady) {
            pending.addLast(json)
            while (pending.size > 3000) pending.removeFirst()
            return
        }
        ui.evaluateJavascript("window.__msFromNative && window.__msFromNative(${JSONObject.quote(json)})", null)
    }

    private fun onUiMessage(raw: String) {
        val m = try {
            JSONObject(raw)
        } catch (_: Exception) {
            return
        }
        when (m.optString("t")) {
            "ready" -> {
                uiReady = true
                sendToUi(JSONObject().put("t", "app").put("version", BuildConfig.VERSION_NAME).toString())
                while (pending.isNotEmpty()) sendToUi(pending.removeFirst())
                sendCollectorState()
            }
            "showCollector" -> showCollector(m.optBoolean("show", true))
            "keepAwake" -> {
                if (m.optBoolean("on")) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            }
            "replay" -> {
                val urls = m.optJSONArray("urls") ?: JSONArray()
                collector.evaluateJavascript("window.__msReplay && window.__msReplay($urls)", null)
            }
            "shot" -> sendToUi(JSONObject().put("t", "shot").put("dataUrl", collectorShot() ?: JSONObject.NULL).toString())
            "saveFile" -> receiveChunk(m)
            "notify" -> notifyUser(m.optString("title"), m.optString("text"))
            "openExternal" -> openExternal(Uri.parse(m.optString("url")))
        }
    }

    /* ---------------- Fichiers (relevé de diagnostic) ---------------- */

    private fun receiveChunk(m: JSONObject) {
        val id = m.optString("id")
        val total = m.optInt("total", 1)
        val parts = chunks.getOrPut(id) { arrayOfNulls(total) }
        parts[m.optInt("index")] = m.optString("data")
        if (parts.any { it == null }) return
        chunks.remove(id)
        saveFile(m.optString("name", "releve.json"), m.optString("mime", "application/json"), parts.joinToString(""))
    }

    private fun saveFile(name: String, mime: String, text: String) {
        val bytes = text.toByteArray(Charsets.UTF_8)
        var where = name
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                val values = ContentValues().apply {
                    put(MediaStore.Downloads.DISPLAY_NAME, name)
                    put(MediaStore.Downloads.MIME_TYPE, mime)
                    put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/MatchScores")
                }
                contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)?.let { uri ->
                    contentResolver.openOutputStream(uri)?.use { it.write(bytes) }
                    where = "Téléchargements/MatchScores/$name"
                }
            }
            val dir = File(cacheDir, "share").apply { mkdirs() }
            val file = File(dir, name).apply { writeBytes(bytes) }
            val uri = FileProvider.getUriForFile(this, "$packageName.files", file)
            val share = Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            startActivity(Intent.createChooser(share, "Envoyer le relevé MatchScores"))
            sendToUi(JSONObject().put("t", "saved").put("ok", true).put("name", where).toString())
        } catch (e: Exception) {
            sendToUi(JSONObject().put("t", "saved").put("ok", false).put("name", name).put("error", e.message ?: "erreur").toString())
        }
    }

    /** Capture de la page bet261 affichée (pour le relevé), réduite et compressée. */
    private fun collectorShot(): String? {
        val w = collector.width
        val h = collector.height
        if (w == 0 || h == 0) return null
        return try {
            val scale = 0.5f
            val bmp = Bitmap.createBitmap((w * scale).toInt(), (h * scale).toInt(), Bitmap.Config.ARGB_8888)
            val canvas = Canvas(bmp)
            canvas.scale(scale, scale)
            collector.draw(canvas)
            val out = ByteArrayOutputStream()
            bmp.compress(Bitmap.CompressFormat.JPEG, 60, out)
            "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
        } catch (_: Exception) {
            null
        }
    }

    /* ---------------- Divers ---------------- */

    /** Alerte quand la collecte ne reçoit plus rien (NF4). */
    private fun notifyUser(title: String, text: String) {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
            return
        }
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "Alertes de collecte", NotificationManager.IMPORTANCE_DEFAULT))
        val n = android.app.Notification.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_notify_error)
            .setContentTitle(title)
            .setContentText(text)
            .setAutoCancel(true)
            .build()
        nm.notify(2, n)
    }

    private fun openExternal(uri: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
        } catch (_: Exception) {
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        when {
            collectorVisible && collector.canGoBack() -> collector.goBack()
            collectorVisible -> showCollector(false)
            else -> super.onBackPressed()
        }
    }

    override fun onDestroy() {
        ui.destroy()
        collector.destroy()
        super.onDestroy()
    }
}
