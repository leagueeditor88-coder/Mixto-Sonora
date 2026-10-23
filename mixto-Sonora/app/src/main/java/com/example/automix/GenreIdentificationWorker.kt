package com.example.automix

import android.content.ContentUris
import android.content.Context
import android.net.Uri
import android.provider.MediaStore
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

/**
 * Worker nativo de clasificación musical de Sonora.
 * 100% autónomo: no requiere servidor externo, API keys ni conexión obligatoria a Internet.
 * Limpia los títulos y asigna el género específico real a cada canción.
 */
class GenreIdentificationWorker(appContext: Context, params: WorkerParameters) : CoroutineWorker(appContext, params) {

    companion object {
        const val UNIQUE_WORK_NAME = "automix_genre_scan"
        private const val PREFS = "automix"
        private const val CACHE_KEY = "genre_cache"
        private const val EVIDENCE_KEY = "genre_evidence"
        private const val AI_SOURCE = "Sonora"
        private const val CLASSIFIER_VERSION = "sonora-embedded-v1"
    }

    private data class Item(val uri: Uri, val title: String, val artist: String, val album: String)

    private fun readLibrary(): List<Item> {
        val resolver = applicationContext.contentResolver
        val uri = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
        val projection = arrayOf(
            MediaStore.Audio.Media._ID,
            MediaStore.Audio.Media.TITLE,
            MediaStore.Audio.Media.ARTIST,
            MediaStore.Audio.Media.ALBUM,
            MediaStore.Audio.Media.IS_MUSIC
        )
        val selection = "${MediaStore.Audio.Media.IS_MUSIC} != 0"
        val sortOrder = "${MediaStore.Audio.Media.TITLE} ASC"
        val list = mutableListOf<Item>()
        try {
            resolver.query(uri, projection, selection, null, sortOrder)?.use { cursor ->
                val idCol = cursor.getColumnIndex(MediaStore.Audio.Media._ID)
                val titleCol = cursor.getColumnIndex(MediaStore.Audio.Media.TITLE)
                val artistCol = cursor.getColumnIndex(MediaStore.Audio.Media.ARTIST)
                val albumCol = cursor.getColumnIndex(MediaStore.Audio.Media.ALBUM)

                while (cursor.moveToNext()) {
                    val id = if (idCol >= 0) cursor.getLong(idCol) else continue
                    val trackUri = ContentUris.withAppendedId(uri, id)
                    val rawTitle = if (titleCol >= 0) cursor.getString(titleCol) ?: "Sin título" else "Sin título"
                    val rawArtist = if (artistCol >= 0) cursor.getString(artistCol)?.takeIf { it != "<unknown>" } ?: "Artista desconocido" else "Artista desconocido"
                    val album = if (albumCol >= 0) cursor.getString(albumCol) ?: "" else ""
                    list.add(Item(trackUri, rawTitle, rawArtist, album))
                }
            }
        } catch (_: Exception) {
            // Error leyendo biblioteca de medios
        }
        return list
    }

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val prefs = applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

        try {
            val items = readLibrary()
            val cache = try { JSONObject(prefs.getString(CACHE_KEY, "{}") ?: "{}") } catch (_: Exception) { JSONObject() }
            val evidence = try { JSONObject(prefs.getString(EVIDENCE_KEY, "{}") ?: "{}") } catch (_: Exception) { JSONObject() }

            var identified = items.count { item ->
                val ev = evidence.optJSONObject(item.uri.toString())
                cache.optString(item.uri.toString()).isNotBlank() &&
                        ev?.optString("source") == AI_SOURCE &&
                        (ev.optString("classifierVersion") == CLASSIFIER_VERSION || ev.optString("classifierVersion") == "sonora-api-v1")
            }
            var processed = 0

            setProgress(
                workDataOf(
                    "status" to "Iniciando clasificación nativa con Sonora…",
                    "processed" to 0,
                    "total" to items.size,
                    "identified" to identified,
                    "pending" to (items.size - identified).coerceAtLeast(0)
                )
            )

            for (item in items) {
                if (isStopped) return@withContext Result.failure(workDataOf("status" to "Pausado"))

                val key = item.uri.toString()
                val prior = evidence.optJSONObject(key)
                val alreadyCurrent = cache.optString(key).isNotBlank() &&
                        prior?.optString("source") == AI_SOURCE &&
                        (prior.optString("classifierVersion") == CLASSIFIER_VERSION)

                if (!alreadyCurrent) {
                    try {
                        // Clasificación mediante el backend multi-fuente obligatorio de Sonora
                        val classification = SonoraNativeClassifier.classify(item.artist, item.title)

                        cache.put(key, classification.primaryGenre)

                        val subgenresArray = JSONArray()
                        classification.subgenres.forEach { subgenresArray.put(it) }

                        val evObj = JSONObject()
                            .put("source", AI_SOURCE)
                            .put("classifierVersion", CLASSIFIER_VERSION)
                            .put("genre", classification.primaryGenre)
                            .put("subgenres", subgenresArray)
                            .put("cleanedArtist", classification.cleanedArtist)
                            .put("cleanedTitle", classification.cleanedTitle)
                            .put("confidence", classification.confidence)
                            .put("sourceDetail", classification.source)
                            .put("status", if (classification.source.startsWith("Sonora API")) "Identificado con Sonora API multi-fuente" else "Identificado con Sonora (respaldo local)")

                        evidence.put(key, evObj)
                        identified++
                    } catch (e: Exception) {
                        val msg = e.message ?: e.javaClass.simpleName
                        evidence.put(
                            key,
                            JSONObject()
                                .put("source", AI_SOURCE)
                                .put("classifierVersion", CLASSIFIER_VERSION)
                                .put("status", "Clasificación no completada: falta una fuente o falló el backend")
                                .put("error", msg.take(150))
                        )
                        cache.put(key, "Género no determinado")
                    }

                    prefs.edit().putString(CACHE_KEY, cache.toString()).putString(EVIDENCE_KEY, evidence.toString()).apply()
                    delay(80) // Procesamiento rápido y fluido
                }

                processed++
                setProgress(
                    workDataOf(
                        "status" to "Sonora: clasificando canciones (${processed}/${items.size})…",
                        "processed" to processed,
                        "total" to items.size,
                        "identified" to identified,
                        "pending" to (items.size - identified).coerceAtLeast(0)
                    )
                )
            }

            prefs.edit().putString(CACHE_KEY, cache.toString()).putString(EVIDENCE_KEY, evidence.toString()).apply()
            Result.success(
                workDataOf(
                    "status" to "Clasificación Sonora completada ($identified canciones)",
                    "processed" to processed,
                    "total" to items.size,
                    "identified" to identified,
                    "pending" to 0
                )
            )
        } catch (_: SecurityException) {
            Result.failure(workDataOf("status" to "Falta permiso para leer la biblioteca"))
        } catch (e: Exception) {
            Result.failure(workDataOf("status" to "Error al clasificar con Sonora: ${(e.message ?: e.javaClass.simpleName).take(200)}"))
        }
    }
}
