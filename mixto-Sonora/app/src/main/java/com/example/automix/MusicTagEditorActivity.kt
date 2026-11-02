package com.example.automix

import android.app.Activity
import android.content.ContentUris
import android.content.ContentValues
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import android.widget.*
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.result.IntentSenderRequest
import org.jaudiotagger.audio.AudioFileIO
import org.jaudiotagger.tag.FieldKey
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** Editor unificado: edición manual y escritura automática de las etiquetas clasificadas por Sonora. */
class MusicTagEditorActivity : ComponentActivity() {

    private data class TrackRow(
        val uri: Uri,
        val title: String,
        val artist: String,
        val album: String
    )

    private data class SonoraTags(
        val genre: String,
        val subgenres: List<String>
    )

    private var pendingSave: (() -> Unit)? = null
    private var automaticRows: List<Pair<TrackRow, SonoraTags>> = emptyList()
    private var automaticOffset = 0
    private var automaticWritten = 0
    private var automaticFailed = 0

    private lateinit var status: TextView
    private lateinit var manualButton: Button
    private lateinit var automaticButton: Button

    private val writePermission =
        registerForActivityResult(
            ActivityResultContracts.StartIntentSenderForResult()
        ) { result ->

            if (result.resultCode == Activity.RESULT_OK) {
                pendingSave?.invoke()
            } else {
                manualButton.isEnabled = true
                automaticButton.isEnabled = true

                Toast.makeText(
                    this,
                    "Android no autorizó modificar los archivos.",
                    Toast.LENGTH_LONG
                ).show()

                status.text =
                    "Operación cancelada: no se concedió permiso de escritura."
            }

            pendingSave = null
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(22, 18, 22, 18)
        }

        root.addView(TextView(this).apply {
            text = "←  Volver a Sonora"
            textSize = 17f
            setPadding(2, 4, 2, 18)
            setOnClickListener { finish() }
        })

        root.addView(TextView(this).apply {
            text = "Etiquetas de la biblioteca"
            textSize = 23f
            setPadding(2, 4, 2, 8)
        })

        root.addView(TextView(this).apply {
            text = "Elige cómo quieres guardar los metadatos en los archivos de música. Las carátulas y los demás campos no se modifican salvo que los edites manualmente."
            textSize = 14f
            setPadding(2, 2, 2, 18)
        })

        manualButton = Button(this).apply {
            text = "EDICIÓN MANUAL · Elegir canciones"
            setOnClickListener { chooseTrack() }
        }

        automaticButton = Button(this).apply {
            text = "AUTOMÁTICO · Aplicar etiquetas de Sonora"
            setOnClickListener { prepareAutomaticWrite() }
        }

        root.addView(
            manualButton,
            LinearLayout.LayoutParams(-1, -2)
        )

        root.addView(
            automaticButton,
            LinearLayout.LayoutParams(-1, -2).apply {
                topMargin = 10
            }
        )

        status = TextView(this).apply {
            text = "Manual: corriges los campos que quieras.\nAutomático: escribe en lote el género principal y los subgéneros que Sonora ya clasificó."
            textSize = 14f
            setPadding(2, 18, 2, 4)
        }

        root.addView(status)
        setContentView(root)
    }

    private fun libraryRows(): List<TrackRow> {

        val rows = mutableListOf<TrackRow>()
        val collection = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI

        val columns = arrayOf(
            MediaStore.Audio.Media._ID,
            MediaStore.Audio.Media.TITLE,
            MediaStore.Audio.Media.ARTIST,
            MediaStore.Audio.Media.ALBUM
        )

        contentResolver.query(
            collection,
            columns,
            "${MediaStore.Audio.Media.IS_MUSIC} != 0",
            null,
            "${MediaStore.Audio.Media.TITLE} COLLATE NOCASE ASC"
        )?.use { c ->

            val id = c.getColumnIndexOrThrow(
                MediaStore.Audio.Media._ID
            )

            val title = c.getColumnIndexOrThrow(
                MediaStore.Audio.Media.TITLE
            )

            val artist = c.getColumnIndexOrThrow(
                MediaStore.Audio.Media.ARTIST
            )

            val album = c.getColumnIndexOrThrow(
                MediaStore.Audio.Media.ALBUM
            )

            while (c.moveToNext()) {

                rows += TrackRow(
                    ContentUris.withAppendedId(
                        collection,
                        c.getLong(id)
                    ),
                    c.getString(title) ?: "Sin título",
                    c.getString(artist) ?: "Artista desconocido",
                    c.getString(album) ?: ""
                )
            }
        }

        return rows
    }

    private fun chooseTrack() {

        val rows = try {
            libraryRows()
        } catch (e: Exception) {

            Toast.makeText(
                this,
                "No se pudo leer la biblioteca: ${e.message}",
                Toast.LENGTH_LONG
            ).show()

            return
        }

        if (rows.isEmpty()) {
            Toast.makeText(
                this,
                "No se encontraron canciones.",
                Toast.LENGTH_SHORT
            ).show()
            return
        }

        val labels = rows.map {
            "${it.title}\n${it.artist} · ${it.album}"
        }.toTypedArray()

        android.app.AlertDialog.Builder(this)
            .setTitle("Seleccionar canción")
            .setItems(labels) { _, which ->
                openEditor(rows[which])
            }
            .setNegativeButton("Cancelar", null)
            .show()
    }

    /** Solo aplica resultados cuyo origen registrado sea Sonora. */
    private fun prepareAutomaticWrite() {

        val prefs = getSharedPreferences(
            "automix",
            MODE_PRIVATE
        )

        val evidence = try {
            JSONObject(
                prefs.getString("genre_evidence", "{}") ?: "{}"
            )
        } catch (_: Exception) {
            JSONObject()
        }

        val cache = try {
            JSONObject(
                prefs.getString("genre_cache", "{}") ?: "{}"
            )
        } catch (_: Exception) {
            JSONObject()
        }

        val rows = try {
            libraryRows()
        } catch (e: Exception) {

            Toast.makeText(
                this,
                "No se pudo leer la biblioteca: ${e.message}",
                Toast.LENGTH_LONG
            ).show()

            return
        }

        val eligible = rows.mapNotNull { row ->

            val key = row.uri.toString()

            val item = evidence.optJSONObject(key)
                ?: return@mapNotNull null

            val source = item.optString("source", "")

            val genre = item.optString(
                "genre",
                cache.optString(key, "")
            ).trim()

            if (!source.equals("Sonora", true) || genre.isBlank()) {
                return@mapNotNull null
            }

            val subsJson = item.optJSONArray("subgenres")
                ?: JSONArray()

            val subs = (0 until subsJson.length()).mapNotNull { i ->
                subsJson.optString(i)
                    .trim()
                    .takeIf { it.isNotBlank() }
            }

            row to SonoraTags(genre, subs)
        }

        if (eligible.isEmpty()) {

            status.text =
                "No hay canciones con clasificación de Sonora pendiente de aplicar. Primero clasifica canciones desde Sonora."

            Toast.makeText(
                this,
                "No se encontraron etiquetas guardadas por Sonora.",
                Toast.LENGTH_LONG
            ).show()

            return
        }

        android.app.AlertDialog.Builder(this)
            .setTitle("Aplicar etiquetas de Sonora")
            .setMessage(
                "Se encontraron ${eligible.size} canciones clasificadas por Sonora. Se reescribirán únicamente Género y Subgéneros (GROUPING) en los archivos. Título, artista, álbum y carátula permanecerán intactos. ¿Continuar?"
            )
            .setPositiveButton("Aplicar a todas") { _, _ ->

                automaticRows = eligible
                automaticOffset = 0
                automaticWritten = 0
                automaticFailed = 0

                manualButton.isEnabled = false
                automaticButton.isEnabled = false

                status.text = "Preparando escritura automática…"

                applyNextBatch()
            }
            .setNegativeButton("Cancelar", null)
            .show()
    }

    /** Procesa las canciones por lotes para solicitar autorización de escritura. */
    private fun applyNextBatch() {

        if (automaticOffset >= automaticRows.size) {

            manualButton.isEnabled = true
            automaticButton.isEnabled = true

            status.text =
                "Proceso terminado. Guardadas: $automaticWritten · Fallidas: $automaticFailed · Total: ${automaticRows.size}."

            Toast.makeText(
                this,
                "Etiquetas de Sonora aplicadas: $automaticWritten. Errores: $automaticFailed.",
                Toast.LENGTH_LONG
            ).show()

            return
        }

        val batch = automaticRows
            .drop(automaticOffset)
            .take(100)

        requestWriteAccess(batch.map { it.first.uri }) {

            status.text =
                "Escribiendo ${automaticOffset + 1}–${automaticOffset + batch.size} de ${automaticRows.size}…"

            Thread {

                var written = 0
                var failed = 0

                batch.forEach { (row, tags) ->

                    try {
                        writeAudioTags(
                            row.uri,
                            tags.genre,
                            tags.subgenres.joinToString(", ")
                        )

                        written++

                    } catch (_: Exception) {
                        failed++
                    }
                }

                runOnUiThread {

                    automaticWritten += written
                    automaticFailed += failed
                    automaticOffset += batch.size

                    status.text =
                        "Procesadas $automaticOffset de ${automaticRows.size} · Guardadas $automaticWritten · Fallidas $automaticFailed"

                    applyNextBatch()
                }

            }.start()
        }
    }

    private fun openEditor(row: TrackRow) {

        val fields = linkedMapOf<String, EditText>()

        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(24, 8, 24, 0)
        }

        fun field(
            label: String,
            hint: String,
            value: String = ""
        ) {

            container.addView(TextView(this).apply {
                text = label
                textSize = 13f
            })

            val input = EditText(this).apply {
                this.hint = hint
                setText(value)
                setSingleLine(true)
            }

            container.addView(input)
            fields[label] = input
        }

        val source = File(
            cacheDir,
            "tag_edit_${System.currentTimeMillis()}.${extensionFor(row.uri)}"
        )

        try {

            copyUriToFile(row.uri, source)

            val tag = AudioFileIO.read(source).tag

            field(
                "Título",
                "Título",
                tag?.getFirst(FieldKey.TITLE).orEmpty()
            )

            field(
                "Artista",
                "Artista",
                tag?.getFirst(FieldKey.ARTIST).orEmpty()
            )

            field(
                "Álbum",
                "Álbum",
                tag?.getFirst(FieldKey.ALBUM).orEmpty()
            )

            field(
                "Género principal",
                "Género",
                tag?.getFirst(FieldKey.GENRE).orEmpty()
            )

            field(
                "Subgéneros",
                "Separados por comas",
                tag?.getFirst(FieldKey.GROUPING).orEmpty()
            )

            field(
                "Año",
                "AAAA",
                tag?.getFirst(FieldKey.YEAR).orEmpty()
            )

            field(
                "Número de pista",
                "Ej. 4",
                tag?.getFirst(FieldKey.TRACK).orEmpty()
            )

            val scroll = ScrollView(this).apply {
                addView(container)
            }

            val dialog = android.app.AlertDialog.Builder(this)
                .setTitle("Editar etiquetas")
                .setView(scroll)
                .setPositiveButton("Guardar en archivo", null)
                .setNegativeButton("Cancelar", null)
                .create()

            dialog.setOnDismissListener {
                source.delete()
            }

            dialog.setOnShowListener {

                dialog.getButton(
                    android.app.AlertDialog.BUTTON_POSITIVE
                ).setOnClickListener {

                    val fieldValues = fields.mapValues {
                        it.value.text?.toString()?.trim().orEmpty()
                    }

                    val genre = fieldValues["Género principal"].orEmpty()
                    val subs = fieldValues["Subgéneros"].orEmpty()

                    requestWriteAccess(listOf(row.uri)) {

                        Thread {

                            try {

                                val editable = AudioFileIO.read(source)

                                val outTag =
                                    editable.tagOrCreateAndSetDefault

                                fun set(
                                    key: FieldKey,
                                    label: String
                                ) {

                                    val value =
                                        fieldValues[label].orEmpty()

                                    if (value.isNotEmpty()) {
                                        outTag.setField(key, value)
                                    } else {
                                        outTag.deleteField(key)
                                    }
                                }

                                set(FieldKey.TITLE, "Título")
                                set(FieldKey.ARTIST, "Artista")
                                set(FieldKey.ALBUM, "Álbum")
                                set(FieldKey.GENRE, "Género principal")
                                set(FieldKey.GROUPING, "Subgéneros")
                                set(FieldKey.YEAR, "Año")
                                set(FieldKey.TRACK, "Número de pista")

                                AudioFileIO.write(editable)

                                writeFileToUri(source, row.uri)

                                val values = ContentValues().apply {
                                    put(
                                        MediaStore.Audio.Media.TITLE,
                                        fieldValues["Título"]
                                    )

                                    put(
                                        MediaStore.Audio.Media.ARTIST,
                                        fieldValues["Artista"]
                                    )

                                    put(
                                        MediaStore.Audio.Media.ALBUM,
                                        fieldValues["Álbum"]
                                    )
                                }

                                contentResolver.update(
                                    row.uri,
                                    values,
                                    null,
                                    null
                                )

                                updateGenreCache(
                                    row.uri.toString(),
                                    genre,
                                    subs,
                                    "Edición manual"
                                )

                                runOnUiThread {

                                    Toast.makeText(
                                        this,
                                        "Etiquetas guardadas en el archivo y en Mixto.",
                                        Toast.LENGTH_LONG
                                    ).show()

                                    dialog.dismiss()
                                }

                            } catch (e: Exception) {

                                runOnUiThread {

                                    Toast.makeText(
                                        this,
                                        "No se pudo guardar: ${e.message ?: "formato no compatible"}",
                                        Toast.LENGTH_LONG
                                    ).show()
                                }
                            }

                        }.start()
                    }
                }
            }

            dialog.show()

        } catch (e: Exception) {

            source.delete()

            Toast.makeText(
                this,
                "No se pudo leer este formato: ${e.message ?: "error"}",
                Toast.LENGTH_LONG
            ).show()
        }
    }

h
    private fun updateGenreCache(
        uri: String,
        genre: String,
        subgenres: String,
        source: String
    ) {

        val prefs = getSharedPreferences(
            "automix",
            MODE_PRIVATE
        )

        val cache = try {
            JSONObject(
                prefs.getString("genre_cache", "{}") ?: "{}"
            )
        } catch (_: Exception) {
            JSONObject()
        }

        val evidence = try {
            JSONObject(
                prefs.getString("genre_evidence", "{}") ?: "{}"
            )
        } catch (_: Exception) {
            JSONObject()
        }

        if (genre.isBlank()) {

            cache.remove(uri)
            evidence.remove(uri)

        } else {

            val subs = JSONArray(
                subgenres.split(",")
                    .map { it.trim() }
                    .filter { it.isNotBlank() }
            )

            cache.put(uri, genre)

            evidence.put(
                uri,
                JSONObject()
                    .put("source", source)
                    .put("classifierVersion", "sonora-tags-v2")
                    .put("genre", genre)
                    .put("subgenres", subs)
                    .put("status", "Etiquetas escritas en el archivo")
            )
        }

        prefs.edit()
            .putString("genre_cache", cache.toString())
            .putString("genre_evidence", evidence.toString())
            .apply()
    }
private fun copyUriToFile(
        uri: Uri,
        file: File
    ) {

        contentResolver.openInputStream(uri)?.use { input ->

            file.outputStream().use { output ->
                input.copyTo(output)
            }

        } ?: throw IllegalStateException(
            "No se pudo leer el archivo original"
        )
    }

    private fun writeFileToUri(
        source: File,
        uri: Uri
    ) {

        contentResolver.openOutputStream(uri, "wt")?.use { output ->

            source.inputStream().use { input ->
                input.copyTo(output)
            }

        } ?: throw IllegalStateException(
            "Android no permitió escribir el archivo"
        )
    }

    private fun requestWriteAccess(
        uris: List<Uri>,
        action: () -> Unit
    ) {

        if (Build.VERSION.SDK_INT >= 30) {

            try {

                val request = MediaStore.createWriteRequest(
                    contentResolver,
                    uris.distinct()
                )

                pendingSave = action

                writePermission.launch(
                    IntentSenderRequest.Builder(
                        request.intentSender
                    ).build()
                )

            } catch (e: Exception) {

                manualButton.isEnabled = true
                automaticButton.isEnabled = true

                Toast.makeText(
                    this,
                    "Android no pudo solicitar permiso de escritura: ${e.message ?: "error"}",
                    Toast.LENGTH_LONG
                ).show()
            }

        } else {
            action()
        }
    }

    private fun extensionFor(uri: Uri): String {

        return when (contentResolver.getType(uri)?.lowercase()) {

            "audio/mpeg" -> "mp3"
            "audio/flac" -> "flac"
            "audio/mp4", "audio/x-m4a" -> "m4a"
            "audio/ogg", "application/ogg" -> "ogg"
            "audio/wav", "audio/x-wav" -> "wav"

            else -> "audio"
        }
    }
}
    
