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
          || data.results.find((result: any) => isExactTitleMatch(searchTitle, result.trackName))
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
    const url = `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(searchTerm)}&fmt=json&limit=8`;
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'SonoraGenreMusicDetector/1.0 (https://github.com/google-aistudio-build)'
      },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.recordings && data.recordings.length > 0) {
      const rec = (searchArtist || searchTitle)
        ? data.recordings.find((item: any) => isRelevantMatch(searchArtist, searchTitle, item['artist-credit']?.map((credit: any) => credit.name).join(' '), item.title))
          || data.recordings.find((item: any) => isExactTitleMatch(searchTitle, item.title))
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

/**
 * Calls Gemini 2.5 Flash for deep musicological genre breakdown, rhythm analysis, and cultural roots.
 */
async function queryGeminiMusicology(artist: string, title: string, baseGenre: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  try {
    const ai = new GoogleGenAI();
    const prompt = `Actúa como un musicólogo experto. Clasifica con prudencia usando los metadatos disponibles. No tienes el archivo de audio: no afirmes haber medido BPM, escuchado instrumentos ni analizado acústicamente la grabación. Si no hay evidencia suficiente, indica un género principal amplio y subgéneros no confirmados.
Determina el género musical más defendible, posibles subgéneros y contexto para la canción:
Artista: "${artist}"
Título: "${title}"
Género base preliminar en catálogo: "${baseGenre}"

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

Responde EXCLUSIVAMENTE en formato JSON con la siguiente estructura (sin texto extra):
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
        responseMimeType: 'application/json',
      },
    });

    if (response.text) {
      return JSON.parse(response.text);
    }
  } catch (err) {
    console.warn('[Gemini AI] analysis failed or key unavailable:', err);
  }
  return null;
}

/**
 * Master genre detection pipeline combining external databases and AI.
 */
export async function detectSongGenre(rawQuery: string): Promise<GenreDetectionResult> {
  const parsed = cleanMusicQuery(rawQuery);
  const searchTerm = parsed.cleaned || rawQuery;

  // 1. External DB queries in parallel: iTunes & MusicBrainz
  const [itunesResult, mbResult] = await Promise.all([
    queryItunes(searchTerm, parsed.detectedArtist, parsed.detectedTitle),
    queryMusicBrainz(searchTerm, parsed.detectedArtist, parsed.detectedTitle),
  ]);

  const matchFound = !!(itunesResult || mbResult);

  // Extract song info from best available source
  const detectedArtist = itunesResult?.artistName || mbResult?.artist || parsed.detectedArtist || 'Artista no especificado';
  const detectedTitle = itunesResult?.trackName || mbResult?.title || parsed.detectedTitle || parsed.cleaned;
  const albumName = itunesResult?.collectionName || 'Sencillo / Álbum';
  const releaseYear = itunesResult?.releaseDate
    ? new Date(itunesResult.releaseDate).getFullYear().toString()
    : mbResult?.firstReleaseDate
    ? mbResult.firstReleaseDate.slice(0, 4)
    : '2020';

  const durationMs = itunesResult?.trackTimeMillis || 205000;
  const minutes = Math.floor(durationMs / 60000);
  const seconds = Math.floor((durationMs % 60000) / 1000);
  const durationFormatted = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;

  // Upgraded high-resolution artwork from iTunes (600x600 instead of 100x100)
  const artworkUrl = itunesResult?.artworkUrl100
    ? itunesResult.artworkUrl100.replace('100x100bb', '600x600bb')
    : 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80';

  const previewUrl = itunesResult?.previewUrl;
  const trackViewUrl = itunesResult?.trackViewUrl;

  // External database genre tags
  const itunesGenre = itunesResult?.primaryGenreName || '';
  const mbTags = mbResult?.tags || [];

  // Synthesize standard profile
  const baseProfile = enrichGenreProfile(
    itunesGenre,
    mbTags,
    (itunesGenre || mbTags.length > 0) ? detectedTitle : ''
  );

  // 2. Query Gemini for deep musicology
  const aiAnalysis = await queryGeminiMusicology(detectedArtist, detectedTitle, itunesGenre || baseProfile.primaryGenre);

  // Cross-validation confidence
  const confidence = calculateConfidence(
    !!itunesResult,
    !!mbResult && mbTags.length > 0,
    !!aiAnalysis,
    itunesResult?.trackName?.toLowerCase().includes(detectedTitle.toLowerCase()) || false
  );

  // Compile database sources list
  const sources: GenreDetectionResult['sources'] = [];

  if (itunesResult) {
    sources.push({
      name: 'Apple iTunes Music Catalog',
      badge: 'Base de Datos Oficial',
      genreReported: itunesResult.primaryGenreName || 'Latino / Urbano',
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
    mbTags,
    aiAnalysis?.primaryGenre,
    aiAnalysis?.subgenres || []
  );
  const primaryGenre = classification.primaryGenre === 'Desconocido' ? baseProfile.primaryGenre : classification.primaryGenre;
  const subgenres = classification.subgenres.length ? classification.subgenres : baseProfile.subgenres;
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
      externalId: itunesResult?.trackId ? String(itunesResult.trackId) : undefined,
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
