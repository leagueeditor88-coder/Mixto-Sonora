import { cleanMusicQuery, enrichGenreProfile, calculateConfidence, isRelevantMatch, isExactTitleMatch, resolveGenreClassification, genreFamily } from '../utils/musicLogic.js';
import type { GenreProfile } from '../utils/musicLogic.js';
import { GoogleGenAI } from '@google/genai';

export interface GenreDetectionResult {
  query: {
    raw: string;
    cleaned: string;
    detectedArtist?: string;
    detectedTitle?: string;
  };
  matchFound: boolean;
  track: {
    title: string;
    artist: string;
    album: string;
    releaseYear: string;
    durationFormatted: string;
    artworkUrl: string;
    previewUrl?: string;
    trackViewUrl?: string;
    externalId?: string;
  };
  primaryGenre: string;
  subgenres: string[];
  category: string;
  confidence: number;
  sources: {
    name: string;
    badge: string;
    genreReported: string;
    reliability: string;
    tags: string[];
    description: string;
    url?: string;
  }[];
  musicalProfile: GenreProfile & {
    bpmEstimate?: string;
    moodDescription?: string;
    historicalContext?: string;
  };
  similarArtists: string[];
  similarTracks: string[];
}

/**
 * Queries Apple iTunes API for exact track metadata, genres, preview audio, and artwork.
 */
async function queryItunes(searchTerm: string, searchArtist?: string, searchTitle?: string) {
  try {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(searchTerm)}&entity=song&limit=5`;
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.resultCount > 0 && Array.isArray(data.results)) {
      if (searchArtist || searchTitle) {
        return data.results.find((result: any) => isRelevantMatch(searchArtist, searchTitle, result.artistName, result.trackName))
          || (!searchArtist ? data.results.find((result: any) => isExactTitleMatch(searchTitle, result.trackName)) : null)
          || null;
      }
      return data.results[0];
    }
  } catch (err) {
    console.warn('[iTunes API] fetch failed or timed out:', err);
  }
  return null;
}

/**
 * Queries MusicBrainz Open Music Encyclopedia for community genre tags and recording metadata.
 */
async function queryMusicBrainz(searchTerm: string, searchArtist?: string, searchTitle?: string) {
  try {
    const url = `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(searchTerm)}&fmt=json&limit=8&inc=artist-credits%2Btags`;
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'MixtoSonoraGenreDetector/1.1 (https://github.com/leagueeditor88-coder/Mixto-Sono)'
      },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.recordings && data.recordings.length > 0) {
      const rec = (searchArtist || searchTitle)
        ? data.recordings.find((item: any) => isRelevantMatch(searchArtist, searchTitle, item['artist-credit']?.map((credit: any) => credit.name).join(' '), item.title))
          || (!searchArtist ? data.recordings.find((item: any) => isExactTitleMatch(searchTitle, item.title)) : null)
        : data.recordings[0];
      if (!rec) return null;
      const tags = (rec.tags || []).map((t: { name: string }) => t.name);
      return {
        title: rec.title,
        artist: rec['artist-credit']?.[0]?.name,
        tags,
        disambiguation: rec.disambiguation,
        firstReleaseDate: rec['first-release-date'],
      };
    }
  } catch (err) {
    console.warn('[MusicBrainz API] fetch failed or timed out:', err);
  }
  return null;
}

/** Deezer: public search endpoint; album genre metadata may be broad and is treated as supporting evidence. */
async function queryDeezer(searchTerm: string, searchArtist?: string, searchTitle?: string) {
  try {
    const url = `https://api.deezer.com/search?q=${encodeURIComponent(searchTerm)}&limit=8`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6500) });
    if (!res.ok) return null;
    const data = await res.json();
    const tracks = Array.isArray(data.data) ? data.data : [];
    const track = (searchArtist || searchTitle)
      ? tracks.find((item: any) => isRelevantMatch(searchArtist, searchTitle, item.artist?.name, item.title))
        || (!searchArtist ? tracks.find((item: any) => isExactTitleMatch(searchTitle, item.title)) : null)
      : tracks[0];
    if (!track) return null;
    let tags: string[] = [];
    const albumId = track.album?.id;
    if (albumId) {
      try {
        const albumRes = await fetch(`https://api.deezer.com/album/${albumId}`, { signal: AbortSignal.timeout(4500) });
        if (albumRes.ok) {
          const album = await albumRes.json();
          tags = (album.genres?.data || []).map((g: any) => String(g.name || '')).filter(Boolean);
        }
      } catch { /* Album genres are optional. */ }
    }
    return { title: track.title, artist: track.artist?.name || '', album: track.album?.title || '', tags, link: track.link, cover: track.album?.cover_big || track.album?.cover_medium, duration: track.duration };
  } catch (err) {
    console.warn('[Deezer] search unavailable:', err);
    return null;
  }
}

/** Last.fm top tags require a server-side LASTFM_API_KEY. */
async function queryLastFm(artist: string, title: string) {
  const key = process.env.LASTFM_API_KEY;
  if (!key || !artist || !title) return null;
  try {
    const url = `https://ws.audioscrobbler.com/2.0/?method=track.gettoptags&artist=${encodeURIComponent(artist)}&track=${encodeURIComponent(title)}&api_key=${encodeURIComponent(key)}&format=json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const data = await res.json();
    const tags = (data.toptags?.tag || []).map((tag: any) => String(tag.name || '')).filter(Boolean).slice(0, 12);
    return tags.length ? { tags } : null;
  } catch (err) {
    console.warn('[Last.fm] tags unavailable:', err);
    return null;
  }
}

/** Spotify Web API: artist genres are supporting evidence only, not song-level truth. Requires client credentials. */
async function querySpotify(searchTerm: string, searchArtist?: string, searchTitle?: string) {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  try {
    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(6000),
    });
    if (!tokenRes.ok) return null;
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) return null;
    const searchRes = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(searchTerm)}&type=track&limit=8`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
      signal: AbortSignal.timeout(6500),
    });
    if (!searchRes.ok) return null;
    const data = await searchRes.json();
    const tracks = data.tracks?.items || [];
    const track = (searchArtist || searchTitle)
      ? tracks.find((item: any) => isRelevantMatch(searchArtist, searchTitle, item.artists?.map((a: any) => a.name).join(' '), item.name))
        || (!searchArtist ? tracks.find((item: any) => isExactTitleMatch(searchTitle, item.name)) : null)
      : tracks[0];
    if (!track) return null;
    const artistId = track.artists?.[0]?.id;
    let tags: string[] = [];
    if (artistId) {
      const artistRes = await fetch(`https://api.spotify.com/v1/artists/${artistId}`, {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
        signal: AbortSignal.timeout(4500),
      });
      if (artistRes.ok) {
        const artist = await artistRes.json();
        tags = Array.isArray(artist.genres) ? artist.genres : [];
      }
    }
    return { title: track.name, artist: track.artists?.map((a: any) => a.name).join(', ') || '', tags, url: track.external_urls?.spotify || '' };
  } catch (err) {
    console.warn('[Spotify] lookup unavailable:', err);
    return null;
  }
}

/** Discogs release genres/styles require a server-side DISCOGS_TOKEN. These are release-level evidence, not guaranteed track-level tags. */
async function queryDiscogs(searchTerm: string, searchArtist?: string, searchTitle?: string) {
  const token = process.env.DISCOGS_TOKEN;
  if (!token) return null;
  try {
    const url = `https://api.discogs.com/database/search?q=${encodeURIComponent(searchTerm)}&type=release&per_page=8&token=${encodeURIComponent(token)}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'MixtoSonoraGenreDetector/1.0' }, signal: AbortSignal.timeout(6500) });
    if (!res.ok) return null;
    const data = await res.json();
    const releases = Array.isArray(data.results) ? data.results : [];
    const release = (searchArtist || searchTitle)
      ? releases.find((item: any) => {
          const releaseTitle = String(item.title || '');
          // Discogs formats release titles commonly as "Artist - Release title".
          const split = releaseTitle.match(/^(.+?)\s[-–—:]\s(.+)$/);
          const releaseArtist = split?.[1] || '';
          const releaseName = split?.[2] || releaseTitle;
          return isRelevantMatch(searchArtist, searchTitle, releaseArtist, releaseName)
            || (!searchArtist && isExactTitleMatch(searchTitle, releaseName));
        })
      : releases[0];
    if (!release) return null;
    const tags = [...(release.genre || []), ...(release.style || [])].map(String).filter(Boolean);
    return tags.length ? { title: release.title || '', tags, year: release.year ? String(release.year) : '' } : null;
  } catch (err) {
    console.warn('[Discogs] lookup unavailable:', err);
    return null;
  }
}

/**
 * Calls Gemini 2.5 Flash for deep musicological genre breakdown, rhythm analysis, and cultural roots.
 */
async function queryGeminiMusicology(artist: string, title: string, baseGenre: string, sourceEvidence: string[]) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('Falta GEMINI_API_KEY: Gemini es obligatorio para refinar la clasificación.');

  try {
    const ai = new GoogleGenAI({ apiKey });
    const prompt = `Actúa como un musicólogo experto y clasificador basado en evidencia. No tienes el archivo de audio: no afirmes haber medido BPM, escuchado instrumentos ni analizado acústicamente la grabación. Usa las coincidencias y etiquetas verificables que aparecen abajo; distingue datos de catálogo, etiquetas comunitarias y contexto inferido. Si las fuentes discrepan, explica la incertidumbre y no inventes detalles.
INVESTIGACIÓN WEB OBLIGATORIA:
Usa la herramienta Google Search para buscar la combinación exacta del título y el artista. Busca fuentes independientes que identifiquen esta canción concreta y describan su ritmo o género. No confundas canciones homónimas ni atribuyas automáticamente a una canción todos los géneros del artista. Da prioridad a fuentes musicales, discográficas, entrevistas y reseñas; compara los resultados y no inventes fuentes ni datos.

Determina el género musical más defendible y posibles subgéneros para la canción:
Artista: "${artist}"
Título: "${title}"
Género base preliminar en catálogo: "${baseGenre}"
EVIDENCIA REAL RECOPILADA DE LAS FUENTES:
${sourceEvidence.length ? sourceEvidence.map((item) => `- ${item}`).join('\n') : '- Ninguna etiqueta de género específica encontrada en los catálogos'}

REGLA DE PRECISIÓN:
No fuerces un subgénero específico sin evidencia. No uses etiquetas genéricas si los datos apoyan una categoría más precisa, pero tampoco inventes detalles. Separa el género principal de los subgéneros y declara la incertidumbre cuando corresponda. Clasifica la canción según evidencia disponible, no solo por el artista:
- Si es ritmo con güira y requinto de amargue: "Bachata" (ej. Bachata Sensual, Bachata Tradicional).
- Si es ritmo con clave, congas y metales: "Salsa" (ej. Salsa Brava, Salsa Romántica, Timba).
- Si es ritmo con güiro/acordeón (chiki-chiki): "Cumbia" (ej. Cumbia Sonidera, Cumbia Villera, Cumbia Colombiana).
- Si es con docerola, tololoche o metales de Sinaloa: "Corridos Tumbados" o "Banda Sinaloense" / "Regional Mexicano".
- Si es ritmo dembow 3:2: "Reggaetón" o "Dembow Dominicano".
- Si tiene compás a medio tiempo con sub-bajo 808 y hi-hats rápidos: "Latin Trap".
- Si es con tambora dominicana rápida: "Merengue".
- Si es con acordeón vallenato y guacharaca: "Vallenato".
- Si es rock: "Rock en Español" / "Rock Latino".
- Si es bolero: "Bolero & Balada Romántica".

Responde exclusivamente con un objeto JSON válido, sin Markdown ni texto fuera del JSON. La búsqueda web se ejecuta mediante la herramienta de Google Search; las URLs verificadas se extraerán de los metadatos de la respuesta y no debes inventarlas.
Estructura JSON:
{
  "primaryGenre": "Nombre exacto y específico del género (ej. Bachata Sensual, Salsa Brava, Reggaetón, Cumbia Sonidera, Corridos Tumbados, Latin Trap, Rock en Español)",
  "subgenres": ["subgénero 1", "subgénero 2", "subgénero 3", "subgénero 4"],
  "category": "Tradición o vertiente musical (ej. Música Dominicana / Caribeña, Folclore Panlatino, Música Urbana, Rock Latino, Regional Mexicano)",
  "bpmEstimate": "ej. 94 BPM",
  "mood": "ej. Romántico, melancólico, sensual y bailable en pareja",
  "typicalRhythm": "ej. Compás sincopado de 4/4 con toque de requinto y bajo característico de bachata",
  "instruments": ["instrumento 1", "instrumento 2", "instrumento 3", "instrumento 4"],
  "historicalContext": "Explicación de 2 frases sobre la identidad y evolución de este ritmo específico.",
  "culturalLineage": "Linaje cultural específico (ej. República Dominicana ➔ Música de Amargue ➔ Bachata)",
  "similarArtists": ["Artista 1", "Artista 2", "Artista 3"],
  "similarTracks": ["Canción 1 - Artista", "Canción 2 - Artista"]
}`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        // Google Search grounding: Gemini puede investigar la canción en la web.
        // Pedimos JSON en el prompt y lo validamos después, para evitar conflictos
        // entre la herramienta de búsqueda y responseMimeType en ciertos modelos.
        tools: [{ googleSearch: {} }],
      },
    });

    if (response.text) {
      const rawText = response.text.trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '');
      const parsed = JSON.parse(rawText);
      if (typeof parsed.primaryGenre !== 'string' || !parsed.primaryGenre.trim()) {
        throw new Error('Gemini no devolvió un género principal válido.');
      }

      // Extrae solo URLs que Google Search realmente devolvió; nunca inventar citas.
      const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
      const webSources = chunks
        .map((chunk: any) => chunk.web)
        .filter((web: any) => web && typeof web.uri === 'string' && /^https?:\/\//i.test(web.uri))
        .map((web: any) => ({ title: String(web.title || web.uri), url: web.uri }))
        .filter((item: { title: string; url: string }, index: number, list: { title: string; url: string }[]) =>
          list.findIndex((other) => other.url === item.url) === index)
        .slice(0, 6);

      return { ...parsed, webSources };
    }
    throw new Error('Gemini no devolvió una respuesta de clasificación.');
  } catch (err) {
    console.error('[Gemini AI] required classification failed:', err);
    throw new Error(`No se pudo completar el refinamiento obligatorio de Gemini: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Master genre detection pipeline combining external databases and AI.
 */
export async function detectSongGenre(rawQuery: string): Promise<GenreDetectionResult> {
  const requiredEnv: Array<[string, boolean]> = [
    ['GEMINI_API_KEY', Boolean(process.env.GEMINI_API_KEY)],
    ['LASTFM_API_KEY', Boolean(process.env.LASTFM_API_KEY)],
    ['DISCOGS_TOKEN', Boolean(process.env.DISCOGS_TOKEN)],
    ['SPOTIFY_CLIENT_ID', Boolean(process.env.SPOTIFY_CLIENT_ID)],
    ['SPOTIFY_CLIENT_SECRET', Boolean(process.env.SPOTIFY_CLIENT_SECRET)],
  ];
  const missing = requiredEnv.filter(([, configured]) => !configured).map(([name]) => name);
  if (missing.length) {
    throw new Error(`Configuración multi-fuente incompleta. Configura estas variables en el backend: ${missing.join(', ')}. Sonora no ejecutará una clasificación parcial como si estuviera refinada.`);
  }

  const parsed = cleanMusicQuery(rawQuery);
  const searchTerm = parsed.cleaned || rawQuery;

  // Query the unkeyed catalogs first; keyed refiners were validated as configured above.
  let [itunesResult, mbResult, deezerResult] = await Promise.all([
    queryItunes(searchTerm, parsed.detectedArtist, parsed.detectedTitle),
    queryMusicBrainz(searchTerm, parsed.detectedArtist, parsed.detectedTitle),
    queryDeezer(searchTerm, parsed.detectedArtist, parsed.detectedTitle),
  ]);

  // A dash does not prove which side is the artist. If the first orientation finds no verified
  // match, retry with title and artist reversed before accepting a fallback.
  if (!itunesResult && !mbResult && !deezerResult && parsed.detectedArtist && parsed.detectedTitle) {
    const reversed = await Promise.all([
      queryItunes(searchTerm, parsed.detectedTitle, parsed.detectedArtist),
      queryMusicBrainz(searchTerm, parsed.detectedTitle, parsed.detectedArtist),
      queryDeezer(searchTerm, parsed.detectedTitle, parsed.detectedArtist),
    ]);
    itunesResult = reversed[0];
    mbResult = reversed[1];
    deezerResult = reversed[2];
  }

  const preliminaryArtist = itunesResult?.artistName || mbResult?.artist || deezerResult?.artist || parsed.detectedArtist || '';
  const preliminaryTitle = itunesResult?.trackName || mbResult?.title || deezerResult?.title || parsed.detectedTitle || parsed.cleaned;
  let [lastFmResult, discogsResult, spotifyResult] = await Promise.all([
    queryLastFm(preliminaryArtist, preliminaryTitle),
    queryDiscogs(searchTerm, parsed.detectedArtist, parsed.detectedTitle),
    querySpotify(searchTerm, parsed.detectedArtist, parsed.detectedTitle),
  ]);
  if (!discogsResult && !spotifyResult && parsed.detectedArtist && parsed.detectedTitle) {
    const reversed = await Promise.all([
      queryDiscogs(searchTerm, parsed.detectedTitle, parsed.detectedArtist),
      querySpotify(searchTerm, parsed.detectedTitle, parsed.detectedArtist),
    ]);
    discogsResult = reversed[0];
    spotifyResult = reversed[1];
  }

  const matchFound = !!(itunesResult || mbResult || deezerResult);

  // Extract song info from best available source
  const detectedArtist = itunesResult?.artistName || mbResult?.artist || deezerResult?.artist || parsed.detectedArtist || 'Artista no especificado';
  const detectedTitle = itunesResult?.trackName || mbResult?.title || deezerResult?.title || parsed.detectedTitle || parsed.cleaned;
  const albumName = itunesResult?.collectionName || deezerResult?.album || 'Sencillo / Álbum';
  const releaseYear = itunesResult?.releaseDate
    ? new Date(itunesResult.releaseDate).getFullYear().toString()
    : mbResult?.firstReleaseDate
    ? mbResult.firstReleaseDate.slice(0, 4)
    : '2020';

  const durationMs = itunesResult?.trackTimeMillis || (deezerResult?.duration ? deezerResult.duration * 1000 : 205000);
  const minutes = Math.floor(durationMs / 60000);
  const seconds = Math.floor((durationMs % 60000) / 1000);
  const durationFormatted = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;

  // Upgraded high-resolution artwork from iTunes (600x600 instead of 100x100)
  const artworkUrl = itunesResult?.artworkUrl100
    ? itunesResult.artworkUrl100.replace('100x100bb', '600x600bb')
    : deezerResult?.cover || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80';

  const previewUrl = itunesResult?.previewUrl;
  const trackViewUrl = itunesResult?.trackViewUrl || deezerResult?.link;

  // External database genre tags
  const itunesGenre = itunesResult?.primaryGenreName || '';
  const mbTags = mbResult?.tags || [];
  const deezerTags: string[] = deezerResult?.tags || [];
  const lastFmTags: string[] = lastFmResult?.tags || [];
  const discogsTags: string[] = discogsResult?.tags || [];
  const spotifyTags: string[] = spotifyResult?.tags || [];
  const allExternalTags = [...new Set([...mbTags, ...deezerTags, ...lastFmTags, ...discogsTags, ...spotifyTags])];

  // Synthesize standard profile
  const baseProfile = enrichGenreProfile(
    itunesGenre,
    allExternalTags,
    (itunesGenre || allExternalTags.length > 0) ? `${detectedArtist} ${detectedTitle}` : ''
  );

  // 2. Gemini is mandatory and receives the actual evidence returned by each configured source.
  const sourceEvidence = [
    ...(itunesGenre ? [`iTunes: género de catálogo = ${itunesGenre}`] : []),
    ...(mbTags.length ? [`MusicBrainz: etiquetas = ${mbTags.join(', ')}`] : []),
    ...(deezerTags.length ? [`Deezer: etiquetas = ${deezerTags.join(', ')}`] : []),
    ...(lastFmTags.length ? [`Last.fm: etiquetas = ${lastFmTags.join(', ')}`] : []),
    ...(discogsTags.length ? [`Discogs: géneros/estilos del lanzamiento = ${discogsTags.join(', ')}`] : []),
    ...(spotifyTags.length ? [`Spotify: géneros asociados al artista = ${spotifyTags.join(', ')}`] : []),
  ];
  const aiAnalysis = await queryGeminiMusicology(detectedArtist, detectedTitle, itunesGenre || baseProfile.primaryGenre, sourceEvidence);

  // Cross-validation confidence
  const sourceCount = [itunesResult, mbResult, deezerResult, lastFmResult, discogsResult, spotifyResult].filter(Boolean).length;
  // Heuristic corroboration index, not a statistical probability. Only real returned sources count.
  const confidence = Math.min(95, 35 + sourceCount * 9 + (itunesResult || deezerResult ? 5 : 0) + (aiAnalysis ? 3 : 0));

  // Compile database sources list
  const sources: GenreDetectionResult['sources'] = [];

  if (itunesResult) {
    sources.push({
      name: 'Apple iTunes Music Catalog',
      badge: 'Base de Datos Oficial',
      genreReported: itunesResult.primaryGenreName || 'Género no especificado por el catálogo',
      reliability: 'Fuente de catálogo; el género puede ser amplio',
      tags: [itunesResult.primaryGenreName, ...(itunesResult.collectionArtistName ? [itunesResult.collectionArtistName] : [])].filter(Boolean),
      description: `Verificado en el catálogo global de Apple Music con ID de pista ${itunesResult.trackId}.`,
    });
  }

  if (mbResult) {
    sources.push({
      name: 'MusicBrainz Open Music Archive',
      badge: 'Enciclopedia Comunitaria Abierta',
      genreReported: mbTags.length > 0 ? mbTags.slice(0, 3).join(', ') : 'Música grabada indexada',
      reliability: mbTags.length > 0 ? 'Etiquetas comunitarias; corroboración variable' : 'Metadatos de grabación; sin etiquetas de género',
      tags: mbTags.length > 0 ? mbTags : ['recording', 'single', 'album'],
      description: `Entrada comunitaria validada con identificador abierto para "${mbResult.title}".`,
    });
  }

  if (deezerResult) {
    sources.push({
      name: 'Deezer',
      badge: 'Catálogo de streaming',
      genreReported: deezerTags.length ? deezerTags.join(', ') : 'Pista encontrada; sin género de álbum disponible',
      reliability: deezerTags.length ? 'Etiqueta de álbum; puede ser amplia' : 'Metadatos de pista; sin etiqueta de género',
      tags: deezerTags,
      description: `Coincidencia de pista en Deezer: ${deezerResult.title} — ${deezerResult.artist}.`,
    });
  }

  if (lastFmResult) {
    sources.push({
      name: 'Last.fm',
      badge: 'Etiquetas comunitarias',
      genreReported: lastFmTags.slice(0, 5).join(', ') || 'Sin etiquetas',
      reliability: 'Etiquetas colaborativas; peso moderado',
      tags: lastFmTags,
      description: 'Etiquetas obtenidas de Last.fm para el título y artista identificados.',
    });
  }

  if (discogsResult) {
    sources.push({
      name: 'Discogs',
      badge: 'Base de datos discográfica',
      genreReported: discogsTags.join(', ') || 'Lanzamiento encontrado sin género',
      reliability: 'Género/estilo del lanzamiento; puede no describir una pista individual',
      tags: discogsTags,
      description: `Etiquetas del lanzamiento coincidente: ${discogsResult.title}.`,
    });
  }

  if (spotifyResult) {
    sources.push({
      name: 'Spotify Web API',
      badge: 'Metadatos de artista',
      genreReported: spotifyTags.length ? spotifyTags.join(', ') : 'Pista encontrada; artista sin etiquetas de género',
      reliability: 'Géneros del artista, no necesariamente de esta canción',
      tags: spotifyTags,
      description: `Coincidencia de pista en Spotify: ${spotifyResult.title} — ${spotifyResult.artist}. Las etiquetas son del artista principal.`,
    });
  }

  if (aiAnalysis?.webSources?.length) {
    for (const webSource of aiAnalysis.webSources) {
      sources.push({
        name: webSource.title || 'Fuente web de Google Search',
        badge: 'Búsqueda web de Google',
        genreReported: aiAnalysis.primaryGenre || baseProfile.primaryGenre,
        reliability: 'Fuente web recuperada durante esta consulta; revisar el contenido original',
        tags: aiAnalysis.subgenres || [],
        description: `Gemini utilizó esta fuente web para investigar la canción: ${webSource.url}`,
        url: webSource.url,
      });
    }
  }

  if (aiAnalysis) {
    sources.push({
      name: 'Gemini AI Musicologist Engine',
      badge: 'Análisis Acústico & Estilístico',
      genreReported: aiAnalysis.primaryGenre || baseProfile.primaryGenre,
      reliability: 'Estimación textual por IA; no es análisis directo del audio',
      tags: aiAnalysis.subgenres || baseProfile.subgenres,
      description: aiAnalysis.historicalContext || 'Desglose detallado de compás, instrumentación y raíces de género.',
    });
  }

  // If no external DB connected (e.g. offline query), provide local detection source
  if (sources.length === 0) {
    sources.push({
      name: 'Motor Acústico Heurístico SonoraGenre',
      badge: 'Base de Datos Local',
      genreReported: baseProfile.primaryGenre,
      reliability: 'Baja; no se encontró corroboración externa',
      tags: baseProfile.subgenres,
      description: 'Estimación de respaldo sin coincidencia verificada en catálogos. No equivale a un análisis directo del audio.',
    });
  }

  const classification = resolveGenreClassification(
    itunesGenre,
    allExternalTags,
    aiAnalysis?.primaryGenre,
    aiAnalysis?.subgenres || []
  );
  const isBroadLabel = (value: string) => /^(latino|latin|tropical|latin urban|música latina|musica latina|música latina & variada|musica latina & variada|música popular|musica popular|general|desconocido|unknown|various)$/i.test((value || '').trim());
  const profileHasSpecificGenre = !!baseProfile.primaryGenre && !isBroadLabel(baseProfile.primaryGenre) && !/^general$/i.test(baseProfile.primaryGenre);
  const primaryGenre = classification.primaryGenre === 'Desconocido' || isBroadLabel(classification.primaryGenre)
    ? (profileHasSpecificGenre ? baseProfile.primaryGenre : 'Género no determinado')
    : classification.primaryGenre;
  const proposedSubgenres = classification.subgenres.length ? classification.subgenres : baseProfile.subgenres;
  const subgenres = primaryGenre === 'Género no determinado'
    ? []
    : proposedSubgenres.filter((genre) => !isBroadLabel(genre)).slice(0, 5);
  const category = aiAnalysis?.category && (!itunesGenre || !aiAnalysis?.primaryGenre || primaryGenre === genreFamily(aiAnalysis.primaryGenre))
    ? aiAnalysis.category
    : baseProfile.category;

  const musicalProfile = {
    ...baseProfile,
    culturalLineage: aiAnalysis?.culturalLineage || baseProfile.culturalLineage,
    bpmEstimate: aiAnalysis?.bpmEstimate || baseProfile.tempoRange,
    moodDescription: aiAnalysis?.mood || baseProfile.vibe,
    historicalContext: aiAnalysis?.historicalContext,
    instruments: aiAnalysis?.instruments?.length ? aiAnalysis.instruments : baseProfile.instruments,
  };

  const similarArtists = aiAnalysis?.similarArtists || [
    'Bad Bunny', 'Rauw Alejandro', 'Karol G', 'Feid', 'Daddy Yankee'
  ];

  const similarTracks = aiAnalysis?.similarTracks || [
    'Rauw Alejandro - Todo De Ti',
    'Bad Bunny - Tití Me Preguntó',
    'Karol G - Provenza'
  ];

  return {
    query: {
      raw: rawQuery,
      cleaned: searchTerm,
      detectedArtist,
      detectedTitle,
    },
    matchFound,
    track: {
      title: detectedTitle,
      artist: detectedArtist,
      album: albumName,
      releaseYear,
      durationFormatted,
      artworkUrl,
      previewUrl,
      trackViewUrl,
      externalId: itunesResult?.trackId ? String(itunesResult.trackId) : (deezerResult ? `deezer:${deezerResult.title}:${deezerResult.artist}` : spotifyResult ? `spotify:${spotifyResult.title}:${spotifyResult.artist}` : undefined),
    },
    primaryGenre,
    subgenres,
    category,
    confidence,
    sources,
    musicalProfile,
    similarArtists,
    similarTracks,
  };
}
