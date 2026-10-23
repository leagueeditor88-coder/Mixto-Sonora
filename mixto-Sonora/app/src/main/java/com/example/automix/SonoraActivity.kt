package com.example.automix

import android.annotation.SuppressLint
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
