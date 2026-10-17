package mg.matchscores.app

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityWindowInfo

/**
 * Service d'accessibilité : lit le texte affiché par l'appli au premier plan
 * (Bet261, Chrome…) uniquement quand la bulle le demande. Il n'écoute aucun événement.
 */
class ScreenReaderService : AccessibilityService() {

    companion object {
        @Volatile
        var instance: ScreenReaderService? = null
            private set

        private const val MAX_LINES = 20_000
    }

    data class Capture(val text: String, val pkg: String, val lines: Int)

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {}

    override fun onInterrupt() {}

    override fun onUnbind(intent: Intent?): Boolean {
        instance = null
        return super.onUnbind(intent)
    }

    override fun onDestroy() {
        instance = null
        super.onDestroy()
    }

    /** Texte de toutes les fenêtres d'application visibles, sauf celles de MatchScores. */
    fun capture(): Capture? {
        val roots = mutableListOf<AccessibilityNodeInfo>()
        try {
            for (w in windows) {
                if (w.type != AccessibilityWindowInfo.TYPE_APPLICATION) continue
                val root = w.root ?: continue
                if (root.packageName?.toString() == packageName) continue
                roots.add(root)
            }
        } catch (_: Exception) {
        }
        if (roots.isEmpty()) {
            rootInActiveWindow?.let { if (it.packageName?.toString() != packageName) roots.add(it) }
        }
        if (roots.isEmpty()) return null

        val lines = ArrayList<String>()
        var pkg = ""
        for (root in roots) {
            pkg = root.packageName?.toString() ?: pkg
            walk(root, lines, 0)
        }
        return Capture(lines.joinToString("\n"), pkg, lines.size)
    }

    /** Parcours en profondeur : on garde le texte des feuilles (ou d'un nœud dont les enfants sont muets). */
    private fun walk(node: AccessibilityNodeInfo?, out: MutableList<String>, depth: Int) {
        if (node == null || depth > 100 || out.size > MAX_LINES) return
        val before = out.size
        for (i in 0 until node.childCount) {
            walk(node.getChild(i), out, depth + 1)
        }
        if (out.size == before) {
            val text = node.text?.toString()?.trim().orEmpty()
            val label = if (text.isNotEmpty()) text else node.contentDescription?.toString()?.trim().orEmpty()
            if (label.isNotEmpty()) out.add(label)
        }
    }
}
