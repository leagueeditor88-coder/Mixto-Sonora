package com.example.automix

import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.Locale

/**
 * Motor nativo de clasificación musical de Sonora integrado directamente en Android.
 * Requiere el backend multi-fuente y sus proveedores obligatorios. No clasifica con reglas locales
 * ni iTunes como sustituto silencioso si el backend falla. No realiza análisis acústico directo.
 */
object SonoraNativeClassifier {

    const val CLASSIFIER_VERSION = "sonora-embedded-v2"
    const val AI_SOURCE = "Sonora"

    data class ClassificationResult(
        val primaryGenre: String,
        val subgenres: List<String>,
        val confidence: Int,
        val source: String,
        val cleanedArtist: String,
        val cleanedTitle: String
    )

    /**
     * Limpia el nombre del archivo o título musical:
     * - Elimina extensiones (.mp3, .wav, .flac, .m4a, etc.)
     * - Elimina prefijos de pista (01. , Track 02 - , etc.)
     * - Elimina años en paréntesis o texto (1998, 2022, del año 2015, etc.)
     * - Elimina etiquetas de video/audio ((Official Video), (En Vivo), [Remastered], etc.)
     * - Separa limpiamente el Artista y el Título de la canción.
     */
    fun cleanTrackQuery(rawArtist: String, rawTitle: String): Pair<String, String> {
        var title = rawTitle.trim()
        title = title.replace(Regex("\\.(mp3|wav|flac|m4a|aac|ogg|opus|wma)$", RegexOption.IGNORE_CASE), "")
        title = title.replace(Regex("^(track\\s*)?\\d+[\\s._-]+", RegexOption.IGNORE_CASE), "")
        title = title.replace(Regex("\\(?\\b(del\\s+año|año|year)\\s+\\d{4}\\b\\)?", RegexOption.IGNORE_CASE), "")
        title = title.replace(Regex("[\\[(]\\s*(19\\d\\d|20\\d\\d)\\s*[\\])]"), "")

        val hasPromo = Regex("(?i)HONOR\\s+Brand|Brand\\s+Song|official\\s+(video|audio|music)|lyric\\s+video|campaign\\s+song|commercial").containsMatchIn(title)
        if (hasPromo) title = title.replace(Regex("\\b\\d{1,4}\\b"), " ")
        title = title.replace(Regex("(?i)HONOR\\s+Brand(?:\\s+Song)?|Brand\\s+Song|Campaign\\s+Song|Commercial|Official\\s+(?:Music\\s+)?Video|Official\\s+Audio|Official\\s+Lyrics?|Video\\s+Oficial|Audio\\s+Oficial|Lyrics?|Lyric\\s+Video|Visualizer|HD|HQ|4K"), " ")
        title = title.replace(
            Regex("[\\[(]\\s*(en\\s*vivo|live|remaster(ed)?(\\s*\\d{4})?|extended|clean|explicit|bonus\\s*track|version\\s*acustica|acustico)\\s*[\\])]", RegexOption.IGNORE_CASE),
            " "
        )
        title = title.replace(Regex("[|•]+|\\.{2,}"), " ")
            .replace(Regex("[()\\[\\]{}]"), " ")
            .replace(Regex("\\s+"), " ").trim()
        title = title.replace(Regex("^[-–—:\\s]+|[-–—:\\s]+$"), "").trim()

        var artist = rawArtist.trim()
        if (artist == "<unknown>" || artist.equals("Artista desconocido", ignoreCase = true)) artist = ""

        if (artist.isBlank()) {
            val dashMatch = Regex("^([^-–—:]+?)\\s*[-–—:]\\s*(.+)$").find(title)
            if (dashMatch != null) {
                artist = dashMatch.groupValues[1].trim()
                title = dashMatch.groupValues[2].trim()
            } else {
                // Filename contextual recovery when a title and artist were concatenated and the artist tag is missing.
                val words = title.split(Regex("\\s+")).filter { it.isNotBlank() }
                for (i in 1 until words.size - 2) {
                    if (words[i].equals(words[i + 1], ignoreCase = true)) {
                        val possibleTitle = words.take(i).joinToString(" ").trim()
                        val possibleArtist = words.drop(i + 1).joinToString(" ").trim()
                        if (possibleTitle.isNotBlank() && possibleArtist.split(Regex("\\s+")).size >= 2) {
                            title = possibleTitle
                            artist = possibleArtist
                            break
                        }
                    }
                }
            }
        }

        if (artist.isNotBlank() && artist != "Artista Independiente") {
            val artistTokens = artist.split(Regex("\\s+")).filter { it.isNotBlank() }
            if (artistTokens.size >= 2) {
                val firstName = Regex.escape(artistTokens.first())
                val duplicateBoundary = Regex("(?i)\\b$firstName\\s+${Regex.escape(artist)}$")
                if (duplicateBoundary.containsMatchIn(title)) {
                    title = title.replace(Regex("(?i)\\s+$firstName\\s+${Regex.escape(artist)}$"), " ").trim()
                } else {
                    title = title.replace(Regex("\\s+${Regex.escape(artist)}$", RegexOption.IGNORE_CASE), " ").trim()
                }
            } else {
                title = title.replace(Regex("\\s+${Regex.escape(artist)}$", RegexOption.IGNORE_CASE), " ").trim()
            }
        }

        artist = artist.replace(Regex("^(la|el|de|del)\\s+", RegexOption.IGNORE_CASE), "").trim()
        title = title.replace(Regex("^(la|el|de|del)\\s+", RegexOption.IGNORE_CASE), "").trim()
        if (title.isBlank()) title = rawTitle.trim()
        if (artist.isBlank()) artist = "Artista Independiente"
        return Pair(artist, title)
    }

    /** Clasifica exclusivamente mediante el backend multi-fuente; los fallos se informan al worker. */
    fun classify(rawArtist: String, rawTitle: String): ClassificationResult {
        val (artist, title) = cleanTrackQuery(rawArtist, rawTitle)

        return querySonoraBackend(title, artist)
            ?: throw IllegalStateException("Sonora no devolvió una clasificación multi-fuente válida.")
    }

    private fun matchHeuristicTaxonomy(combined: String, artist: String, title: String): Pair<String, List<String>>? {
        // --- BACHATA ---
        if (listOf("romeo santos", "aventura", "prince royce", "antony santos", "anthony santos", "frank reyes", "luis vargas", "elvis martinez", "zacarias ferreira", "zacarías ferreira", "raulin rodriguez", "raulín rodríguez", "monchy & alexandra", "monchy y alexandra", "alex bueno", "teodoro reyes", "kiko rodriguez").any { combined.contains(it) } || title.contains("bachata")) {
            return Pair("Bachata Sensual & Tradicional", listOf("Bachata Tradicional", "Bachata Urbana", "Música de Amargue", "Bachata Sensual"))
        }

        // --- SALSA ---
        if (listOf("hector lavoe", "héctor lavoe", "marc anthony", "willie colon", "willie colón", "ruben blades", "rubén blades", "celia cruz", "grupo niche", "gilberto santa rosa", "joe arroyo", "frankie ruiz", "el gran combo", "oscar d'leon", "oscar d'león", "victor manuelle", "víctor manuelle", "tito nieves", "cheo feliciano", "ismael rivera", "fania all-stars", "eddie santiago", "rey ruiz", "jerry rivera", "puerto rican power", "guayacan", "guayacán", "la india").any { combined.contains(it) } || title.contains("salsa")) {
            return Pair("Salsa (Brava / Romántica)", listOf("Salsa Brava", "Salsa Romántica", "Salsa Clásica", "Timba Cubana"))
        }

        // --- CUMBIA ---
        if (listOf("los angeles azules", "los ángeles azules", "damas gratis", "celso piña", "celso pina", "rafaga", "ráfaga", "grupo 5", "la sonora dinamita", "raymix", "los palmeras", "gilda", "amar azul", "cumbia all stars", "karina", "sonidera", "villera").any { combined.contains(it) } || title.contains("cumbia")) {
            return Pair("Cumbia (Sonidera / Villera)", listOf("Cumbia Sonidera", "Cumbia Villera", "Cumbia Colombiana", "Electro Cumbia"))
        }

        // --- CORRIDOS TUMBADOS & REGIONAL MEXICANO ---
        if (listOf("peso pluma", "natanael cano", "fuerza regida", "junior h", "christian nodal", "carin leon", "carín león", "banda ms", "grupo firme", "grupo frontera", "eslabon armado", "eslabón armado", "los dos carnales", "calibre 50", "gerardo ortiz", "alfredo olivas", "luis r conriquez", "gabito ballesteros", "tito double p", "chinito pacas", "los tigres del norte", "los tucanes de tijuana", "julion alvarez", "julión álvarez").any { combined.contains(it) } || title.contains("corrido") || title.contains("tumbado")) {
            return Pair("Regional Mexicano (Corridos Tumbados / Banda)", listOf("Corridos Tumbados", "Banda Sinaloense", "Norteño", "Sierreño"))
        }

        // --- REGGAETÓN & DEMBOW ---
        if (listOf("bad bunny", "karol g", "rauw alejandro", "feid", "daddy yankee", "don omar", "wisin & yandel", "wisin y yandel", "j balvin", "ozuna", "anuel aa", "maluma", "chencho corleone", "ryan castro", "myke towers", "sech", "tegocalderon", "tego calderón", "zion & lennox", "arcangel", "arcángel", "jhay cortez", "jhayco", "mora", "blessd", "el alfa", "rochyrd", "rochy rd", "chimbala").any { combined.contains(it) }) {
            return Pair("Reggaetón & Urbano Latino", listOf("Perreo Clásico", "Reggaetón Moderno", "Dembow", "Trap Latino"))
        }

        // --- LATIN TRAP ---
        if (listOf("eladio carrion", "eladio carrión", "duki", "ysy a", "bhavi", "trueno", "milo j", "neo pistea", "cazzu", "khea", "tiago pzk", "lit killah").any { combined.contains(it) } || title.contains("trap")) {
            return Pair("Latin Trap & Hip-Hop", listOf("Latin Trap", "Trap Argentino", "Urban Rap", "Freestyle"))
        }

        // --- VALLENATO ---
        if (listOf("silvestre dangond", "diomedes diaz", "diomedes díaz", "carlos vives", "binomio de oro", "jorge celedon", "jorge celedón", "peter manjarres", "peter manjarrés", "kaleth morales", "los inquietos del vallenato", "los chiches del vallenato").any { combined.contains(it) } || title.contains("vallenato")) {
            return Pair("Vallenato (Tradicional & Nueva Ola)", listOf("Vallenato Tradicional", "Vallenato Nueva Ola", "Paseo Vallenato"))
        }

        // --- MERENGUE ---
        if (listOf("juan luis guerra", "elvis crespo", "olga tañon", "olga tañón", "los hermanos rosario", "wilfrido vargas", "eddy herrera", "sergio vargas", "milly quezada", "toño rosario", "kinito mendez").any { combined.contains(it) } || title.contains("merengue")) {
            return Pair("Merengue Dominicano", listOf("Merengue Tradicional", "Merengue de Calle", "Merengue Mambo"))
        }

        // --- ROCK EN ESPAÑOL ---
        if (listOf("soda stereo", "gustavo cerati", "mana", "maná", "enanitos verdes", "heroes del silencio", "héroes del silencio", "cafe tacvba", "café tacvba", "molotov", "los fabulosos cadillacs", "andres calamaro", "andrés calamaro", "fito paez", "fito páez", "charly garcia", "charly garcía", "la renga", "babasonicos", "babasónicos", "caifanes", "zoe", "zoé", "bunbury").any { combined.contains(it) } || title.contains("rock")) {
            return Pair("Rock en Español / Rock Latino", listOf("Rock Clásico Latino", "Pop Rock", "Rock Alternativo", "Ska Rock"))
        }

        // --- POP LATINO & BALADA ---
        if (listOf("luis miguel", "chayanne", "ricky martin", "shakira", "camilo", "sebastian yatra", "sebastián yatra", "morat", "reik", "sin bandera", "ricardo arjona", "enrique iglesias", "alejandro sanz", "la oreja de van gogh", "jesse & joy", "ha*ash", "ha ash", "camila", "david bisbal").any { combined.contains(it) }) {
            return Pair("Pop Latino & Balada Romántica", listOf("Pop Latino", "Balada Romántica", "Pop Vocal", "Latin Pop"))
        }

        // --- FLAMENCO FUSIÓN ---
        if (listOf("rosalia", "rosalía", "c. tangana", "c tangana", "paco de lucia", "paco de lucía", "gipsy kings", "niña pastori", "ketama", "chambao", "estopa").any { combined.contains(it) }) {
            return Pair("Flamenco Fusión & Rumba", listOf("Flamenco Pop", "Nuevo Flamenco", "Rumba Catalana", "Urbano Flamenco"))
        }

        // --- ELECTRÓNICA & EDM ---
        if (listOf("tiesto", "tiësto", "david guetta", "calvin harris", "avicii", "martin garrix", "daft punk", "marshmello", "alok", "skrillex", "deadmau5", "armin van buuren", "swedish house mafia", "kygo", "dj snake").any { combined.contains(it) } || title.contains("edm") || title.contains("house") || title.contains("techno")) {
            return Pair("Electrónica & Dance (EDM)", listOf("Electro House", "Progressive House", "Club Dance", "Future Bass"))
        }

        // --- POP & ROCK INTERNACIONAL ---
        if (listOf("michael jackson", "madonna", "queen", "the beatles", "dua lipa", "the weeknd", "bruno mars", "taylor swift", "billie eilish", "ed sheeran", "ariana grande", "coldplay", "imagine dragons", "guns n' roses", "metallica", "nirvana", "ac/dc", "led zeppelin", "pink floyd", "adele", "rihanna", "eminem").any { combined.contains(it) }) {
            return Pair("Pop & Rock Internacional", listOf("Mainstream Pop", "Classic Rock", "Synth-Pop", "Alternative Rock"))
        }

        return null
    }

    private fun matchGenreKeywords(combined: String): Pair<String, List<String>> {
        return when {
            combined.contains("bachata") -> Pair("Bachata Sensual & Tradicional", listOf("Bachata", "Música de Amargue"))
            combined.contains("salsa") -> Pair("Salsa (Brava / Romántica)", listOf("Salsa Brava", "Salsa Romántica"))
            combined.contains("cumbia") -> Pair("Cumbia (Sonidera / Villera)", listOf("Cumbia", "Música Tropical"))
            combined.contains("reggaeton") || combined.contains("reguetón") || combined.contains("perreo") || combined.contains("dembow") -> Pair("Reggaetón & Urbano Latino", listOf("Reggaetón", "Dembow", "Urbano"))
            combined.contains("corrido") || combined.contains("banda") || combined.contains("norteño") || combined.contains("ranchera") -> Pair("Regional Mexicano", listOf("Corridos", "Banda Sinaloense"))
            combined.contains("vallenato") -> Pair("Vallenato (Tradicional & Nueva Ola)", listOf("Vallenato", "Paseo Vallenato"))
            combined.contains("merengue") -> Pair("Merengue Dominicano", listOf("Merengue", "Ritmo Tropical"))
            combined.contains("bolero") -> Pair("Bolero & Balada", listOf("Bolero Romántico", "Música del Recuerdo"))
            combined.contains("rock") -> Pair("Rock en Español / Rock Latino", listOf("Rock Latino", "Rock Clásico"))
            combined.contains("jazz") -> Pair("Jazz & Bossa Nova", listOf("Latin Jazz", "Smooth Jazz"))
            combined.contains("pop") -> Pair("Pop Latino & Internacional", listOf("Latin Pop", "Dance Pop"))
            combined.contains("reggae") -> Pair("Reggae & Ska", listOf("Roots Reggae", "Dancehall"))
            else -> Pair("Género no determinado", emptyList())
        }
    }

    /** Consulta el backend real multi-fuente de Sonora. Devuelve null si no está configurado o no responde. */
    private fun querySonoraBackend(title: String, artist: String): ClassificationResult? {
        val baseUrl = BuildConfig.SONORA_API_URL.trim().trimEnd('/')
        if (baseUrl.isBlank()) throw IllegalStateException("Falta SONORA_API_URL: configura el backend multi-fuente de Sonora.")
        val query = if (artist.isNotBlank() && artist != "Artista Independiente") "$artist - $title" else title
        val encoded = URLEncoder.encode(query, "UTF-8")
        val connection = (URL("$baseUrl/api/detect?q=$encoded").openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 7000
            readTimeout = 12000
            setRequestProperty("Accept", "application/json")
        }
        try {
            if (connection.responseCode !in 200..299) {
                val errorBody = try { connection.errorStream?.bufferedReader()?.use { it.readText() }.orEmpty() } catch (_: Exception) { "" }
                val detail = try { JSONObject(errorBody).optString("message", JSONObject(errorBody).optString("error", "")) } catch (_: Exception) { "" }
                throw IllegalStateException(detail.ifBlank { "El backend multi-fuente respondió HTTP ${connection.responseCode}." })
            }
            val json = JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
            val track = json.optJSONObject("track") ?: JSONObject()
            val rawGenre = json.optString("primaryGenre", "").trim()
            val subgenreJson = json.optJSONArray("subgenres") ?: JSONArray()
            val subgenres = (0 until subgenreJson.length()).map { subgenreJson.optString(it).trim() }
                .filter { it.isNotBlank() && !isBroadGenre(it) }.take(5)
            val genre = if (isBroadGenre(rawGenre) && subgenres.isNotEmpty()) subgenres.first() else rawGenre
            if (genre.isBlank() || isBroadGenre(genre) || genre.equals("Desconocido", true)) {
                throw IllegalStateException("Sonora no encontró evidencia suficiente para asignar un género específico.")
            }
            val sourcesJson = json.optJSONArray("sources") ?: JSONArray()
            val sourceNames = (0 until sourcesJson.length()).mapNotNull { index ->
                sourcesJson.optJSONObject(index)?.optString("name")?.takeIf { !it.isNullOrBlank() }
            }.distinct()
            return ClassificationResult(
                primaryGenre = genre,
                subgenres = subgenres.filterNot { it.equals(genre, true) },
                confidence = json.optInt("confidence", 65).coerceIn(0, 95),
                source = if (sourceNames.isNotEmpty()) "Sonora API: ${sourceNames.joinToString(", ")}" else "Sonora API multi-fuente",
                cleanedArtist = track.optString("artist", artist).ifBlank { artist },
                cleanedTitle = track.optString("title", title).ifBlank { title }
            )
        } finally {
            connection.disconnect()
        }
    }

    private fun isBroadGenre(value: String): Boolean = value.trim().matches(
        Regex("(?i)^(latino|latin|tropical|latin urban|música latina|musica latina|música latina & variada|musica latina & variada|música popular|musica popular|variada|general|desconocido|unknown)$")
    )

    /**
     * Consulta el catálogo público abierto de Apple iTunes sin API key ni autenticación.
     */
    private fun queryPublicCatalog(title: String, artist: String): Pair<String, String>? {
        val query = if (artist.isNotBlank() && artist != "Artista Independiente") "$artist $title" else title
        val encoded = URLEncoder.encode(query, "UTF-8")
        val url = URL("https://itunes.apple.com/search?term=$encoded&entity=song&limit=3")
        val conn = (url.openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 5000
            readTimeout = 8000
            setRequestProperty("Accept", "application/json")
        }

        try {
            if (conn.responseCode in 200..299) {
                val json = JSONObject(conn.inputStream.bufferedReader().use { it.readText() })
                val results = json.optJSONArray("results") ?: JSONArray()
                val wantedTitle = normalizeForMatch(title)
                val wantedArtist = normalizeForMatch(artist)
                var best: JSONObject? = null
                var bestScore = -1
                for (i in 0 until results.length()) {
                    val candidate = results.optJSONObject(i) ?: continue
                    val foundTitle = normalizeForMatch(candidate.optString("trackName", ""))
                    val foundArtist = normalizeForMatch(candidate.optString("artistName", ""))
                    val titleMatches = wantedTitle.isNotBlank() && (foundTitle == wantedTitle || foundTitle.contains(wantedTitle) || wantedTitle.contains(foundTitle))
                    val artistMatches = wantedArtist.isBlank() || foundArtist == wantedArtist || foundArtist.contains(wantedArtist) || wantedArtist.contains(foundArtist)
                    if (!titleMatches || !artistMatches) continue
                    val score = (if (foundTitle == wantedTitle) 2 else 1) + (if (wantedArtist.isNotBlank() && foundArtist == wantedArtist) 2 else 0)
                    if (score > bestScore) { best = candidate; bestScore = score }
                }
                val selected = best ?: return null
                val rawGenre = selected.optString("primaryGenreName", "").trim()
                val trackName = selected.optString("trackName", title)
                val artistName = selected.optString("artistName", artist)
                if (rawGenre.isNotBlank()) return Pair(rawGenre, "$artistName $trackName")
            }
        } finally {
            conn.disconnect()
        }
        return null
    }

    private fun normalizeForMatch(value: String): String = value.lowercase(Locale.ROOT)
        .replace(Regex("\\([^)]*\\)"), " ")
        .replace(Regex("[^a-z0-9áéíóúñ]+"), " ")
        .replace(Regex("\\s+"), " ").trim()

    /**
     * Reemplaza etiquetas perezosas de bases comerciales anglosajonas ("Latino", "Tropical")
     * por el género específico real según la instrumentación y el artista.
     */
    private fun refineCatalogLabel(rawGenre: String, context: String): Pair<String, List<String>> {
        val lower = "$rawGenre $context".lowercase(Locale.ROOT)
        val matched = matchHeuristicTaxonomy(lower, "", "")
        if (matched != null) return matched

        return when {
            rawGenre.equals("Latino", ignoreCase = true) || rawGenre.equals("Latin", ignoreCase = true) || rawGenre.equals("Tropical", ignoreCase = true) -> {
                val specific = matchGenreKeywords(lower)
                if (specific.first == "Género no determinado") Pair("Género no determinado", emptyList()) else specific
            }
            else -> Pair(rawGenre, listOf(rawGenre, "Música Certificada"))
        }
    }
}
