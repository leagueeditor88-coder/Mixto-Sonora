package com.example.automix

import android.annotation.SuppressLint
import android.content.ContentUris
import android.provider.MediaStore
import android.webkit.JavascriptInterface
import org.json.JSONArray
import org.json.JSONObject
import android.graphics.Color
import android.os.Bundle
import android.view.View
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.webkit.WebViewAssetLoader

/**
 * Sonora se carga desde un origen HTTPS local controlado por WebViewAssetLoader.
 * Esto permite que Vite/React cargue sus módulos ES sin las restricciones de file://.
 * El cambio queda limitado a la pantalla Sonora.
 */
class SonoraActivity : ComponentActivity() {
    private var webView: WebView? = null

    /** Expone a Sonora la misma biblioteca de audio que utiliza Mixto, mediante MediaStore. */
    inner class MixtoLibraryBridge {
        @JavascriptInterface
        fun getTracksJson(): String {
            val permission = if (android.os.Build.VERSION.SDK_INT >= 33)
                android.Manifest.permission.READ_MEDIA_AUDIO
            else android.Manifest.permission.READ_EXTERNAL_STORAGE
            if (checkSelfPermission(permission) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                return JSONObject().put("permissionGranted", false).put("tracks", JSONArray()).toString()
            }
            val tracks = JSONArray()
            val projection = arrayOf(
                MediaStore.Audio.Media._ID,
                MediaStore.Audio.Media.TITLE,
                MediaStore.Audio.Media.ARTIST,
                MediaStore.Audio.Media.DURATION,
                MediaStore.Audio.Media.IS_MUSIC
            )
            contentResolver.query(
                MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                projection,
                "${MediaStore.Audio.Media.IS_MUSIC} != 0 AND ${MediaStore.Audio.Media.DURATION} >= 60000",
                null,
                "${MediaStore.Audio.Media.TITLE} COLLATE NOCASE ASC"
            )?.use { cursor ->
                val idCol = cursor.getColumnIndex(MediaStore.Audio.Media._ID)
                val titleCol = cursor.getColumnIndex(MediaStore.Audio.Media.TITLE)
                val artistCol = cursor.getColumnIndex(MediaStore.Audio.Media.ARTIST)
                val durationCol = cursor.getColumnIndex(MediaStore.Audio.Media.DURATION)
                while (cursor.moveToNext()) {
                    val id = cursor.getLong(idCol)
                    val title = if (titleCol >= 0) cursor.getString(titleCol) ?: "Sin título" else "Sin título"
                    val artistRaw = if (artistCol >= 0) cursor.getString(artistCol) else null
                    val artist = artistRaw?.takeIf { it.isNotBlank() && it != "<unknown>" } ?: "Artista desconocido"
                    tracks.put(JSONObject()
                        .put("id", id)
                        .put("title", title)
                        .put("artist", artist)
                        .put("durationMs", if (durationCol >= 0) cursor.getLong(durationCol) else 0L)
                        .put("uri", ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, id).toString()))
                }
            }
            return JSONObject().put("permissionGranted", true).put("tracks", tracks).toString()
        }

        /** Guarda el resultado de Sonora en el mismo caché persistente que muestra la biblioteca de Mixto. */
        @JavascriptInterface
        fun saveClassification(
            trackUri: String,
            primaryGenre: String,
            subgenresJson: String,
            title: String,
            artist: String,
            confidence: Int
        ): Boolean {
            if (trackUri.isBlank() || primaryGenre.isBlank()) return false
            return try {
                val subgenres = try { JSONArray(subgenresJson) } catch (_: Exception) { JSONArray() }
                val displaySubgenre = (0 until subgenres.length())
                    .map { subgenres.optString(it).trim() }
                    .firstOrNull { it.isNotBlank() && !it.equals(primaryGenre, ignoreCase = true) }
                val displayGenre = if (displaySubgenre != null) "$primaryGenre · $displaySubgenre" else primaryGenre
                val prefs = this@SonoraActivity.getSharedPreferences("automix", MODE_PRIVATE)
                val cache = try { JSONObject(prefs.getString("genre_cache", "{}") ?: "{}") } catch (_: Exception) { JSONObject() }
                val evidence = try { JSONObject(prefs.getString("genre_evidence", "{}") ?: "{}") } catch (_: Exception) { JSONObject() }
                cache.put(trackUri, displayGenre)
                evidence.put(trackUri, JSONObject()
                    .put("source", "Sonora")
                    .put("classifierVersion", "sonora-api-v1")
                    .put("genre", primaryGenre)
                    .put("subgenres", subgenres)
                    .put("title", title)
                    .put("artist", artist)
                    .put("confidence", confidence.coerceIn(0, 100))
                    .put("status", "Clasificado desde Sonora"))
                prefs.edit()
                    .putString("genre_cache", cache.toString())
                    .putString("genre_evidence", evidence.toString())
                    .apply()
                android.util.Log.i("SonoraWeb", "Clasificación guardada para $artist - $title: $displayGenre")
                true
            } catch (e: Exception) {
                android.util.Log.e("SonoraWeb", "No se pudo guardar la clasificación", e)
                false
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.rgb(10, 12, 20))
        }

        val header = TextView(this).apply {
            text = "←  Volver a Mixto"
            textSize = 16f
            setTextColor(Color.WHITE)
            setPadding(24, 18, 16, 18)
            setBackgroundColor(Color.rgb(24, 28, 42))
            setOnClickListener { finish() }
        }
        root.addView(header, LinearLayout.LayoutParams(-1, -2))

        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler(
                "/assets/",
                WebViewAssetLoader.AssetsPathHandler(this)
            )
            .build()

        val web = WebView(this).apply {
            setBackgroundColor(Color.rgb(10, 12, 20))
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            addJavascriptInterface(MixtoLibraryBridge(), "MixtoLibrary")

            webChromeClient = object : WebChromeClient() {
                override fun onConsoleMessage(consoleMessage: ConsoleMessage): Boolean {
                    android.util.Log.e(
                        "SonoraWeb",
                        "${consoleMessage.message()} -- ${consoleMessage.sourceId()}:${consoleMessage.lineNumber()}"
                    )
                    return true
                }
            }

            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(
                    view: WebView?,
                    request: WebResourceRequest
                ): android.webkit.WebResourceResponse? {
                    return assetLoader.shouldInterceptRequest(request.url)
                }

                override fun shouldOverrideUrlLoading(
                    view: WebView?,
                    request: WebResourceRequest?
                ): Boolean {
                    val uri = request?.url ?: return false
                    // Mantener la navegación dentro de Sonora en el origen local.
                    return uri.scheme != "https" ||
                        uri.host != "appassets.androidplatform.net"
                }

                override fun onPageFinished(view: WebView?, url: String?) {
                    super.onPageFinished(view, url)
                    injectMixtoLibraryPanel(view)
                }

                override fun onReceivedError(
                    view: WebView?,
                    request: WebResourceRequest?,
                    error: android.webkit.WebResourceError?
                ) {
                    super.onReceivedError(view, request, error)
                    if (request?.isForMainFrame == true) {
                        android.util.Log.e(
                            "SonoraWeb",
                            "Error cargando Sonora: ${error?.description} (${error?.errorCode})"
                        )
                    }
                }
            }

            loadUrl("https://appassets.androidplatform.net/assets/sonora/index.html")
        }

        webView = web
        root.addView(web, LinearLayout.LayoutParams(-1, 0, 1f))
        setContentView(root)
    }

    /** Añade una pequeña sección de biblioteca sin reemplazar ni reconstruir la interfaz de Sonora. */
    private fun injectMixtoLibraryPanel(view: WebView?) {
        val script = """
            (function() {
              if (document.getElementById('mixto-library-launcher')) return;
              const style = document.createElement('style');
              style.textContent = `#mixto-library-launcher{position:fixed;z-index:99998;right:14px;bottom:18px;border:0;border-radius:999px;padding:13px 17px;background:linear-gradient(120deg,#db2777,#7c3aed,#0891b2);color:white;font-weight:700;box-shadow:0 8px 28px #0008;font-size:14px}#mixto-library-panel{position:fixed;z-index:99999;inset:8px;background:#0b1020;color:#f8fafc;border:1px solid #475569;border-radius:18px;box-shadow:0 20px 60px #000c;padding:16px;display:none;overflow:auto;font:14px system-ui,sans-serif}#mixto-library-panel h2{font-size:20px;font-weight:800;margin:0 0 6px}#mixto-library-panel .ml-muted{color:#94a3b8;font-size:12px;margin-bottom:12px}#mixto-library-panel input{box-sizing:border-box;width:100%;padding:11px;border-radius:10px;border:1px solid #475569;background:#111827;color:white;margin:8px 0 12px}#mixto-library-panel .ml-row{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #263244}#mixto-library-panel .ml-meta{flex:1;min-width:0}#mixto-library-panel .ml-title{font-weight:650;overflow-wrap:anywhere}#mixto-library-panel .ml-artist{font-size:12px;color:#94a3b8;margin-top:3px}#mixto-library-panel button.ml-action{border:0;border-radius:9px;padding:9px 10px;background:#7c3aed;color:white;font-weight:700;white-space:nowrap}#mixto-library-panel button.ml-close{float:right;background:#273449;color:white;border:0;border-radius:9px;padding:8px 11px}#mixto-library-panel .ml-empty{padding:20px 0;color:#cbd5e1;line-height:1.5}`;
              document.head.appendChild(style);
              const launcher=document.createElement('button'); launcher.id='mixto-library-launcher'; launcher.textContent='♫ Biblioteca Mixto';
              const panel=document.createElement('section'); panel.id='mixto-library-panel';
              panel.innerHTML='<button class="ml-close">Cerrar ✕</button><h2>Biblioteca musical de Mixto</h2><div class="ml-muted">Selecciona una canción de tu teléfono para analizar su género en Sonora.</div><input id="ml-filter" placeholder="Buscar título o artista…"/><div id="ml-count" class="ml-muted">Leyendo biblioteca…</div><div id="ml-list"></div>';
              document.body.appendChild(launcher); document.body.appendChild(panel);
              launcher.onclick=()=>{panel.style.display='block';loadTracks()};
              panel.querySelector('.ml-close').onclick=()=>panel.style.display='none';
              let allTracks=[];
              function render(){
                const term=(document.getElementById('ml-filter').value||'').toLocaleLowerCase();
                const filtered=allTracks.filter(t=>(t.title+' '+t.artist).toLocaleLowerCase().includes(term));
                document.getElementById('ml-count').textContent=filtered.length+' canciones'+(term?' encontradas':' en la biblioteca');
                const list=document.getElementById('ml-list'); list.innerHTML='';
                if(!filtered.length){list.innerHTML='<div class="ml-empty">No hay canciones que coincidan. Comprueba que Mixto tenga permiso para acceder al audio.</div>';return;}
                filtered.slice(0,500).forEach(t=>{
                  const row=document.createElement('div'); row.className='ml-row';
                  const meta=document.createElement('div');meta.className='ml-meta';
                  const title=document.createElement('div');title.className='ml-title';title.textContent=t.title;
                  const artist=document.createElement('div');artist.className='ml-artist';artist.textContent=t.artist;
                  meta.append(title,artist);
                  const btn=document.createElement('button');btn.className='ml-action';btn.textContent='Analizar';
                  btn.onclick=()=>analyze(t);row.append(meta,btn);list.appendChild(row);
                });
                if(filtered.length>500){const note=document.createElement('div');note.className='ml-muted';note.textContent='Mostrando las primeras 500 coincidencias. Usa el buscador para encontrar otras.';list.appendChild(note)}
              }
              function loadTracks(){
                try{
                  if(!window.MixtoLibrary){document.getElementById('ml-count').textContent='No se pudo conectar con la biblioteca nativa.';return;}
                  const data=JSON.parse(window.MixtoLibrary.getTracksJson());
                  if(!data.permissionGranted){document.getElementById('ml-count').textContent='Falta permiso de audio. Vuelve a Mixto, concede el permiso de música y abre Sonora otra vez.';return;}
                  allTracks=data.tracks||[];render();
                }catch(e){document.getElementById('ml-count').textContent='Error leyendo la biblioteca: '+e;}
              }
              function analyze(t){
                const input=document.getElementById('song-search-input');
                const form=input&&input.closest('form');
                if(!input||!form){alert('No se encontró el buscador de Sonora.');return;}
                const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
                window.__mixtoPendingTrack={uri:t.uri,title:t.title,artist:t.artist};
                setter.call(input,t.artist+' - '+t.title);input.dispatchEvent(new Event('input',{bubbles:true}));
                panel.style.display='none';
                setTimeout(()=>form.requestSubmit(),80);
              }
              document.getElementById('ml-filter').addEventListener('input',render);
            })();
        """.trimIndent()
        view?.evaluateJavascript(script, null)
    }

    @Deprecated("Deprecated in Android API")
    override fun onBackPressed() {
        val web = webView
        if (web?.canGoBack() == true) web.goBack() else finish()
    }

    override fun onDestroy() {
        webView?.apply {
            stopLoading()
            loadUrl("about:blank")
            destroy()
        }
        webView = null
        super.onDestroy()
    }
}
