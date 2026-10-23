import type { GenreDetectionResult } from '../server/genreService';
import { cleanMusicQuery, enrichGenreProfile, calculateConfidence, isRelevantMatch, isExactTitleMatch, resolveGenreClassification } from '../utils/musicLogic';

/**
 * Client service to detect song genres via server API with graceful direct-fetch fallback.
 */
export async function detectGenre(queryText: string): Promise<GenreDetectionResult> {
  const trimmed = queryText.trim();
  if (!trimmed) {
    throw new Error('Ingresa el título o artista de una canción para determinar su género.');
  }

  // 1. Try our backend API first
  try {
    const res = await fetch(`/api/detect?q=${encodeURIComponent(trimmed)}`);
    if (res.ok) {
      const data = await res.json();
      return data;
    }
  } catch (err) {
    console.warn('[GenreClient] Backend API failed, falling back to direct client database lookup:', err);
  }

  // 2. Direct client fallback via iTunes Search API (CORS enabled)
  return await fallbackClientDetect(trimmed);
}

/**
 * Direct client-side fallback if backend API is ever unreachable.
 */
async function fallbackClientDetect(queryText: string): Promise<GenreDetectionResult> {
  const parsed = cleanMusicQuery(queryText);
  const searchStr = parsed.cleaned || queryText;

  let itunesData: any = null;
  try {
    const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(searchStr)}&entity=song&limit=8`;
    const res = await fetch(itunesUrl);
    if (res.ok) {
      const json = await res.json();
      if (json.resultCount > 0 && Array.isArray(json.results)) {
        const candidates = json.results;
        itunesData = (parsed.detectedArtist || parsed.detectedTitle)
          ? candidates.find((item: any) => isRelevantMatch(parsed.detectedArtist, parsed.detectedTitle, item.artistName, item.trackName))
            || candidates.find((item: any) => isExactTitleMatch(parsed.detectedTitle, item.trackName))
            || null
          : candidates[0] || null;
      }
    }
  } catch (e) {
    console.warn('[GenreClient] Direct iTunes API query failed:', e);
  }

  const artist = itunesData?.artistName || parsed.detectedArtist || 'Artista no especificado';
  const title = itunesData?.trackName || parsed.detectedTitle || parsed.cleaned;
  const itunesGenre = itunesData?.primaryGenreName || '';
  const albumName = itunesData?.collectionName || 'Sencillo';
  const releaseYear = itunesData?.releaseDate ? new Date(itunesData.releaseDate).getFullYear().toString() : '2021';
  const durationMs = itunesData?.trackTimeMillis || 210000;
  const minutes = Math.floor(durationMs / 60000);
  const seconds = Math.floor((durationMs % 60000) / 1000);
  const durationFormatted = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;

  const artworkUrl = itunesData?.artworkUrl100
    ? itunesData.artworkUrl100.replace('100x100bb', '600x600bb')
    : 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80';

  // No inferir el género solo por el nombre del artista: usar el género del catálogo y, como contexto, el título.
  const profile = enrichGenreProfile(itunesGenre, [itunesGenre].filter(Boolean), itunesGenre ? title : '');
  const classification = resolveGenreClassification(itunesGenre || profile.primaryGenre, [], undefined, []);
  const primaryGenre = classification.primaryGenre || profile.primaryGenre;
  const subgenres = classification.subgenres.length ? classification.subgenres : profile.subgenres;
  const confidence = calculateConfidence(!!itunesData, false, false, !!itunesData && isRelevantMatch(parsed.detectedArtist, parsed.detectedTitle, itunesData.artistName, itunesData.trackName));

  return {
    query: {
      raw: queryText,
      cleaned: searchStr,
      detectedArtist: artist,
      detectedTitle: title,
    },
    matchFound: !!itunesData,
    track: {
      title,
      artist,
      album: albumName,
      releaseYear,
      durationFormatted,
      artworkUrl,
      previewUrl: itunesData?.previewUrl,
      trackViewUrl: itunesData?.trackViewUrl,
      externalId: itunesData?.trackId ? String(itunesData.trackId) : undefined,
    },
    primaryGenre,
    subgenres,
    category: profile.category,
    confidence,
    sources: itunesData ? [
      {
        name: 'Apple iTunes Music Catalog (Direct)',
        badge: 'Catálogo musical',
        genreReported: itunesGenre || 'Género no especificado por el catálogo',
        reliability: 'Fuente de catálogo; la etiqueta puede ser amplia',
        tags: itunesGenre ? [itunesGenre] : [],
        description: 'Coincidencia encontrada en iTunes. El género refleja los metadatos del catálogo y puede ser general.',
      },
    ] : [
      {
        name: 'Clasificación de respaldo de Sonora',
        badge: 'Sin coincidencia externa',
        genreReported: profile.primaryGenre,
        reliability: 'Baja; no se verificó una coincidencia en el catálogo',
        tags: profile.subgenres,
        description: 'No se encontró una coincidencia verificable en iTunes. Esta etiqueta es provisional y requiere confirmación.',
      },
    ],
    musicalProfile: {
      ...profile,
      bpmEstimate: profile.tempoRange,
      moodDescription: profile.vibe,
    },
    similarArtists: ['Bad Bunny', 'Rauw Alejandro', 'Karol G'],
    similarTracks: ['Rauw Alejandro - Todo De Ti', 'Bad Bunny - Ojitos Lindos'],
  };
}

/**
 * Batch detection for multiple songs.
 */
export async function batchDetectGenres(songs: string[]): Promise<GenreDetectionResult[]> {
  try {
    const res = await fetch('/api/batch-detect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ songs }),
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.results)) {
        return data.results;
      }
    }
  } catch (err) {
    console.warn('[GenreClient] Batch API failed, executing sequentially:', err);
  }

  // Fallback: sequential client detection
  const results: GenreDetectionResult[] = [];
  for (const s of songs) {
    results.push(await detectGenre(s));
  }
  return results;
}
