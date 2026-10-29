package com.example.automix

import android.annotation.SuppressLint
import android.content.ContentUris
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Bundle
import android.provider.MediaStore
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import org.json.JSONArray
import org.json.JSONObject

/** Web Sonora + puente de metadatos con la biblioteca de Mixto. */
class SonoraActivity : ComponentActivity() {
    private var webView: WebView? = null
    companion object {
        private const val HOST = "sonoragenre-detector-de-g-nero-musical.ai.studio"
        private const val URL = "https://sonoragenre-detector-de-g-nero-musical.ai.studio/"
        private const val PREFS = "automix"
        private const val CACHE = "genre_cache"
        private const val EVIDENCE = "genre_evidence"
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.rgb(10, 12, 20))
        }
        root.addView(TextView(this).apply {
            text = "←  Volver a Mixto"
            textSize = 16f
            setTextColor(Color.WHITE)
            setPadding(24, 18, 16, 18)
            setBackgroundColor(Color.rgb(24, 28, 42))
            setOnClickListener { finish() }
        }, LinearLayout.LayoutParams(-1, -2))

        val web = WebView(this).apply {
            setBackgroundColor(Color.rgb(10, 12, 20))
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            webChromeClient = WebChromeClient()
            addJavascriptInterface(MixtoAndroidBridge(this@SonoraActivity), "MixtoAndroid")
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                    val uri = request?.url ?: return true
                    // No exponer el puente a otros sitios.
                    return !(uri.scheme == "https" && uri.host == HOST)
                }
            }
            loadUrl(URL)
        }
        webView = web
        root.addView(web, LinearLayout.LayoutParams(-1, 0, 1f))
        setContentView(root)
    }

    @Deprecated("Deprecated in Android API")
    override fun onBackPressed() {
        val web = webView
        if (web?.canGoBack() == true) web.goBack() else finish()
    }

    override fun onDestroy() {
        webView?.apply { stopLoading(); removeJavascriptInterface("MixtoAndroid"); loadUrl("about:blank"); destroy() }
        webView = null
        super.onDestroy()
    }

    private class MixtoAndroidBridge(context: Context) {
        private val app = context.applicationContext

        @JavascriptInterface
        fun getLibraryJson(): String {
            val permission = if (android.os.Build.VERSION.SDK_INT >= 33)
                android.Manifest.permission.READ_MEDIA_AUDIO
            else android.Manifest.permission.READ_EXTERNAL_STORAGE
            if (app.checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED)
                return JSONObject().put("error", "Falta permiso de audio. Vuelve a Mixto, concede el permiso y abre Sonora otra vez.").toString()

            val prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val genres = try { JSONObject(prefs.getString(CACHE, "{}") ?: "{}") } catch (_: Exception) { JSONObject() }
            val out = JSONArray()
            val collection = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
            val columns = arrayOf(MediaStore.Audio.Media._ID, MediaStore.Audio.Media.TITLE,
                MediaStore.Audio.Media.ARTIST, MediaStore.Audio.Media.ALBUM, MediaStore.Audio.Media.IS_MUSIC)
            try {
                app.contentResolver.query(collection, columns, "${MediaStore.Audio.Media.IS_MUSIC} != 0", null,
                    "${MediaStore.Audio.Media.TITLE} COLLATE NOCASE ASC")?.use { c ->
                    val idCol = c.getColumnIndex(MediaStore.Audio.Media._ID)
                    val titleCol = c.getColumnIndex(MediaStore.Audio.Media.TITLE)
                    val artistCol = c.getColumnIndex(MediaStore.Audio.Media.ARTIST)
                    val albumCol = c.getColumnIndex(MediaStore.Audio.Media.ALBUM)
                    while (c.moveToNext()) {
                        if (idCol < 0) continue
                        val uri = ContentUris.withAppendedId(collection, c.getLong(idCol)).toString()
                        val title = if (titleCol >= 0) c.getString(titleCol)?.takeIf { it.isNotBlank() } ?: "Sin título" else "Sin título"
                        val artist = if (artistCol >= 0) c.getString(artistCol)?.takeIf { it.isNotBlank() && it != "<unknown>" } ?: "Artista desconocido" else "Artista desconocido"
                        val album = if (albumCol >= 0) c.getString(albumCol) ?: "" else ""
                        out.put(JSONObject().put("uri", uri).put("title", title).put("artist", artist)
                            .put("album", album).put("genre", genres.optString(uri, "")))
                    }
                }
            } catch (e: Exception) {
                return JSONObject().put("error", "No se pudo leer la biblioteca: ${e.message ?: "error"}").toString()
            }
            return out.toString()
        }

        @JavascriptInterface
        fun saveClassification(trackUri: String, primaryGenre: String, subgenresJson: String,
                               title: String, artist: String, confidence: Int): Boolean {
            val genre = primaryGenre.trim()
            if (!trackUri.startsWith("content://media/external/audio/media/") || genre.isBlank()) return false
            val prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val cache = try { JSONObject(prefs.getString(CACHE, "{}") ?: "{}") } catch (_: Exception) { JSONObject() }
            val evidence = try { JSONObject(prefs.getString(EVIDENCE, "{}") ?: "{}") } catch (_: Exception) { JSONObject() }
            val subs = try { JSONArray(subgenresJson) } catch (_: Exception) { JSONArray() }
            cache.put(trackUri, genre)
            evidence.put(trackUri, JSONObject().put("source", "Sonora")
                .put("classifierVersion", "sonora-api-v1").put("genre", genre).put("subgenres", subs)
                .put("cleanedTitle", title).put("cleanedArtist", artist)
                .put("confidence", confidence.coerceIn(0, 100)).put("status", "Clasificado por la web de Sonora"))
            prefs.edit().putString(CACHE, cache.toString()).putString(EVIDENCE, evidence.toString()).apply()
            return true
        }
    }
}
