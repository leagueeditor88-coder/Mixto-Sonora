import type { GenreDetectionResult } from '../server/genreService';
import {
  cleanMusicQuery,
  enrichGenreProfile,
  calculateConfidence,
} from '../utils/musicLogic';

type ItunesTrack = {
  trackId?: number;
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  collectionArtistName?: string;
  primaryGenreName?: string;
  releaseDate?: string;
  trackTimeMillis?: number;
  artworkUrl100?: string;
  previewUrl?: string;
  trackViewUrl?: string;
};

type MusicBrainzRecording = {
  title?: string;
  'first-release-date'?: string;
  'artist-credit'?: Array<{ name?: string }>;
  tags?: Array<{ name?: string; count?: number }>;
};

async function searchItunes(query: string): Promise<ItunesTrack | null> {
  try {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=5`;
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    const data: { results?: ItunesTrack[] } = await response.json();
    return (Array.isArray(data.results) ? data.results[0] : null) ?? null;
  } catch (error) {
    console.warn('[Sonora] Apple catalog lookup failed:', error);
    return null;
  }
}

async function searchMusicBrainz(query: string): Promise<MusicBrainzRecording | null> {
  try {
    const url = `https://musicbrainz.org/ws/2/recording/?fmt=json&limit=5&query=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    const data: { recordings?: MusicBrainzRecording[] } = await response.json();
    return (Array.isArray(data.recordings) ? data.recordings[0] : null) ?? null;
  } catch (error) {
    console.warn('[Sonora] MusicBrainz lookup unavailable:', error);
    return null;
  }
}

/**
 * Clasificación directa desde el dispositivo. No llama a /api/detect,
 * /api/batch-detect, Render ni a un endpoint Gemini.
 */
export async function detectGenre(queryText: string): Promise<GenreDetectionResult> {
  const rawQuery = queryText.trim();
  if (!rawQuery) {
    throw new Error('Ingresa el título o artista de una canción para determinar su género.');
  }

  const parsed = cleanMusicQuery(rawQuery);
  const searchTerm = parsed.cleaned || rawQuery;
  const [itunes, musicBrainz] = await Promise.all([
    searchItunes(searchTerm),
    searchMusicBrainz(searchTerm),
  ]);

  const artist =
    itunes?.artistName ||
    musicBrainz?.['artist-credit']?.[0]?.name ||
    parsed.detectedArtist ||
    'Artista no especificado';
  const title =
    itunes?.trackName ||
    musicBrainz?.title ||
    parsed.detectedTitle ||
    searchTerm;

  const itunesGenre = itunes?.primaryGenreName || '';
  const mbTags = (musicBrainz?.tags ?? [])
    .map((tag) => tag.name ?? '')
    .filter(Boolean);
  const profile = enrichGenreProfile(itunesGenre, mbTags, `${artist} ${title} ${searchTerm}`);

  const durationMs = itunes?.trackTimeMillis ?? 205000;
  const minutes = Math.floor(durationMs / 60000);
  const seconds = Math.floor((durationMs % 60000) / 1000);
  const durationFormatted = `${minutes}:${String(seconds).padStart(2, '0')}`;
  const artworkUrl = itunes?.artworkUrl100
    ? itunes.artworkUrl100.replace('100x100bb', '600x600bb')
    : 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80';

  const sources: GenreDetectionResult['sources'] = [];
  if (itunes) {
    sources.push({
      name: 'Apple iTunes Music Catalog',
      badge: 'Catálogo musical',
      genreReported: itunesGenre || 'Género no indicado por el catálogo',
      reliability: 'Metadatos del catálogo',
      tags: [itunesGenre, ...(itunes.collectionArtistName ? [itunes.collectionArtistName] : [])].filter(Boolean),
      description: `Coincidencia del catálogo de Apple${itunes.trackId ? `; ID de pista ${itunes.trackId}` : ''}.`,
    });
  }
  if (musicBrainz) {
    sources.push({
      name: 'MusicBrainz',
      badge: 'Base de datos comunitaria',
      genreReported: mbTags.length ? mbTags.slice(0, 3).join(', ') : 'Grabación encontrada; sin etiquetas de género',
      reliability: 'Etiquetas comunitarias',
      tags: mbTags.length ? mbTags : ['grabación indexada'],
      description: `Coincidencia de la base de datos abierta para "${musicBrainz.title || title}".`,
    });
  }
  if (!sources.length) {
    sources.push({
      name: 'Motor heurístico local de Sonora',
      badge: 'Clasificación local',
      genreReported: profile.primaryGenre,
      reliability: 'Estimación heurística',
      tags: profile.subgenres,
      description: 'No se pudo consultar un catálogo externo; se aplicó la clasificación heurística local.',
    });
  }

  const found = Boolean(itunes || musicBrainz);
  const confidence = calculateConfidence(
    Boolean(itunes),
    Boolean(musicBrainz && mbTags.length),
    false,
    Boolean(itunes?.trackName && title),
  );

  return {
    query: {
      raw: rawQuery,
      cleaned: searchTerm,
      detectedArtist: artist,
      detectedTitle: title,
    },
    matchFound: found,
    track: {
      title,
      artist,
      album: itunes?.collectionName || 'Sencillo / álbum no especificado',
      releaseYear: itunes?.releaseDate
        ? new Date(itunes.releaseDate).getFullYear().toString()
        : musicBrainz?.['first-release-date']?.slice(0, 4) || 'Año no disponible',
      durationFormatted,
      artworkUrl,
      previewUrl: itunes?.previewUrl,
      trackViewUrl: itunes?.trackViewUrl,
      externalId: itunes?.trackId ? String(itunes.trackId) : undefined,
    },
    primaryGenre: profile.primaryGenre,
    subgenres: profile.subgenres,
    category: profile.category,
    confidence,
    sources,
    musicalProfile: {
      ...profile,
      bpmEstimate: profile.tempoRange,
      moodDescription: profile.vibe,
      historicalContext: undefined,
    },
    similarArtists: [],
    similarTracks: [],
  };
}

export async function batchDetectGenres(songs: string[]): Promise<GenreDetectionResult[]> {
  const results: GenreDetectionResult[] = [];
  for (const song of songs) {
    results.push(await detectGenre(song));
  }
  return results;
}
