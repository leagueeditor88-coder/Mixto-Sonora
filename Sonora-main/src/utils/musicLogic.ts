/**
 * Core musical query cleaning, normalization, and genre classification logic.
 * Enforces deep specificity for Latin / Spanish music, avoiding lazy umbrella labels ("Latino", "Tropical").
 * 100% autonomous: cleans filenames, track numbers, and release years automatically.
 */

export interface ParsedQuery {
  raw: string;
  cleaned: string;
  detectedArtist?: string;
  detectedTitle?: string;
}

export interface GenreProfile {
  primaryGenre: string;
  subgenres: string[];
  category: string;
  color: string;
  badgeBg: string;
  badgeText: string;
  vibe: string;
  typicalRhythm: string;
  tempoRange: string;
  instruments: string[];
  danceability: string;
  isLazyLabelRefined?: boolean;
  lazyLabelNote?: string;
  culturalLineage?: string;
}

const NOISE_PHRASES: RegExp[] = [
  /determinar\s+g[eé]nero(\s+musical)?/gi,
  /qu[eé]\s+g[eé]nero(\s+musical)?\s+(es|tiene)/gi,
  /cu[aá]l\s+es\s+el\s+g[eé]nero(\s+musical)?(\s+de)?/gi,
  /saber\s+(el\s+)?g[eé]nero(\s+musical)?/gi,
  /buscar\s+(el\s+)?g[eé]nero(\s+musical)?/gi,
  /identificar\s+(el\s+)?g[eé]nero(\s+musical)?/gi,
  /g[eé]nero\s+musical/gi,
  /g[eé]nero/gi,
  /(de\s+)?(la|el|este|esta)\s+canci[oó]n/gi,
  /canci[oó]n/gi,
  /tema(\s+musical)?/gi,
  /musica/gi,
  /m[uú]sica/gi,
  /track/gi,
  /what\s+genre(\s+is)?/gi,
  /find\s+genre/gi,
  /song\s+genre/gi,
];

/**
 * Limpia y normaliza el título de la canción:
 * - Elimina extensiones de audio (.mp3, .wav, .flac, .m4a, etc.)
 * - Elimina prefijos de pista (01. , Track 02 - , etc.)
 * - Elimina años en paréntesis o texto (1998, 2022, del año 2015, etc.) sin pedirlo al usuario.
 * - Elimina etiquetas de video/audio ((Official Video), (En Vivo), [Remastered], etc.)
 * - Extrae el artista y el título limpios.
 */
export function cleanMusicQuery(input: string): ParsedQuery {
  if (!input) return { raw: '', cleaned: '' };

  const raw = input.trim();
  let text = raw;

  // Si se pega una explicación completa, usar primero la línea que parece identificar la pista.
  if (text.includes('\n')) {
    const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
    const trackLine = lines.find((line) =>
      /[“"«].+?[”"»]/.test(line) || /\s[-–—:]\s/.test(line)
    );
    text = trackLine || lines[0] || text;
  }

  // Limpieza que conserva los datos musicales, pero quita ruido de nombres de archivo.
  text = text
    .replace(/\.(mp3|wav|flac|m4a|aac|ogg|opus|wma)$/i, '')
    .replace(/^(track\s*)?\d+[\s._-]+/i, '')
    .replace(/\(?\b(del\s+año|año|year)\s+\d{4}\b\)?/gi, '')
    .replace(/[\[(]\s*(19\d\d|20\d\d)\s*[\])]/g, '')
    .replace(/[\[(]\s*(official\s*(music\s*)?video|video\s*oficial|audio\s*oficial|official\s*audio|letra|lyric(s)?(\s*video)?|en\s*vivo|live|remaster(ed)?(\s*\d{4})?|hd|hq|4k|visualizer|extended|clean|explicit|bonus\s*track|version\s*acustica|acustico)\s*[\])]/gi, '');

  for (const regex of NOISE_PHRASES) text = text.replace(regex, ' ');
  text = text.replace(/\s+/g, ' ').trim();

  let detectedArtist: string | undefined;
  let detectedTitle: string | undefined;

  // Título entre comillas seguido del artista: “Título” — Artista. Tolera comillas tipográficas mixtas.
  const quotedTitleFirst = text.match(/^[“"«](.+?)[”"»]?\s*[-–—:]\s*(.+)$/);
  const quotedTitleLast = text.match(/^(.+?)\s*[-–—:]\s*[“"«](.+?)[”"»]?$/);
  if (quotedTitleFirst) {
    detectedTitle = quotedTitleFirst[1].trim();
    detectedArtist = quotedTitleFirst[2].trim();
  } else if (quotedTitleLast) {
    detectedArtist = quotedTitleLast[1].trim();
    detectedTitle = quotedTitleLast[2].trim();
  } else {
    const dashMatch = text.match(/^(.+?)\s+[-–—:]\s+(.+)$/);
    if (dashMatch) {
      // Sin comillas, se conserva el formato habitual «Artista - Título».
      detectedArtist = dashMatch[1].trim();
      detectedTitle = dashMatch[2].trim();
    } else {
      const deMatch = text.match(/^(.+?)\s+de\s+(.+)$/i);
      if (deMatch) {
        detectedTitle = deMatch[1].trim();
        detectedArtist = deMatch[2].trim();
      }
    }
  }

  const cleanPart = (value: string | undefined) => (value || '')
    .replace(/\s*\((HONOR\s+Brand\s+Song|Brand\s+Song|Official\s+Video|Audio\s+Oficial|Lyric\s+Video|Soundtrack|Video\s+Oficial|Tema\s+Oficial|Comercial|Campaign\s+Song)\)/gi, '')
    .replace(/["'«»“”()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  detectedTitle = cleanPart(detectedTitle);
  detectedArtist = cleanPart(detectedArtist);

  // If no reliable artist/title split was detected, retain a clean searchable phrase.
  const cleaned = detectedArtist && detectedTitle
    ? `${detectedArtist} - ${detectedTitle}`
    : cleanPart(text) || raw;

  return {
    raw,
    cleaned,
    detectedArtist: detectedArtist || undefined,
    detectedTitle: detectedTitle || undefined,
  };
}

/** Rejects search results whose artist/title do not match the requested track. */
export function isRelevantMatch(
  searchArtist: string | undefined,
  searchTitle: string | undefined,
  foundArtist: string | undefined,
  foundTitle: string | undefined
): boolean {
  if (!foundArtist && !foundTitle) return false;
  const normalize = (value: string) => value.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  const matches = (wanted: string | undefined, found: string | undefined, minWordLength: number) => {
    if (!wanted) return undefined;
    if (!found) return false;
    const w = normalize(wanted);
    const f = normalize(found);
    if (!w || !f) return false;
    if (w === f || f.includes(w) || w.includes(f)) return true;
    const words = w.split(' ').filter((word) => word.length >= minWordLength);
    return words.length > 1 && words.every((word) => f.split(' ').includes(word));
  };
  const artistMatch = matches(searchArtist, foundArtist, 3);
  const titleMatch = matches(searchTitle, foundTitle, 2);
  if (searchArtist && searchTitle) return artistMatch === true && titleMatch === true;
  return artistMatch === true || titleMatch === true;
}

/** Exact title-only fallback for tracks credited to a featured singer/composer differently across catalogs. */
export function isExactTitleMatch(searchTitle: string | undefined, foundTitle: string | undefined): boolean {
  if (!searchTitle || !foundTitle) return false;
  const normalize = (value: string) => value.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  return normalize(searchTitle) === normalize(foundTitle);
}

/** Normalizes genre labels so broad families and their subgenres can be compared. */
export function genreFamily(label: string): string {
  const value = (label || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9+#/ ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!value) return '';
  if (/electropop|electro pop|dance pop|synth pop|indie pop|power pop|art pop|teen pop|pop rock|pop music|^pop$/.test(value)) return 'Pop';
  if (/hip hop|hip-hop|rap|trap/.test(value)) return 'Hip-Hop/Rap';
  if (/reggaeton|regueton|dembow/.test(value)) return 'Reggaetón';
  if (/bachata/.test(value)) return 'Bachata';
  if (/salsa|timba/.test(value)) return 'Salsa';
  if (/cumbia/.test(value)) return 'Cumbia';
  if (/rock|metal|punk|grunge/.test(value)) return 'Rock';
  if (/electronic|electronica|house|techno|trance|edm|dance music/.test(value)) return 'Electrónica';
  if (/country|bluegrass/.test(value)) return 'Country';
  if (/jazz/.test(value)) return 'Jazz';
  if (/classical|clasica|orchestral/.test(value)) return 'Clásica';
  if (/r&b|rhythm and blues|soul/.test(value)) return 'R&B/Soul';
  if (/folk|world music|musica del mundo/.test(value)) return 'Folk/World';
  return label.trim();
}

/** Chooses a main genre and subgenres without letting a single conflicting AI label blindly replace catalog data. */
export function resolveGenreClassification(
  catalogGenre: string,
  communityTags: string[] = [],
  aiGenre?: string,
  aiSubgenres: string[] = []
): { primaryGenre: string; subgenres: string[] } {
  const rawCatalog = (catalogGenre || '').trim();
  const catalog = /^(music|unknown|various|n\/?a|not available)$/i.test(rawCatalog) ? '' : rawCatalog;
  const tags = communityTags.map((tag) => tag.trim()).filter(Boolean);
  const ai = (aiGenre || '').trim();
  const family = genreFamily(catalog);
  const aiFamily = genreFamily(ai);
  const knownFamilies = new Set(['Pop', 'Hip-Hop/Rap', 'Reggaetón', 'Bachata', 'Salsa', 'Cumbia', 'Rock', 'Electrónica', 'Country', 'Jazz', 'Clásica', 'R&B/Soul', 'Folk/World']);
  const usefulTags = tags.filter((tag) => {
    const tagFamily = genreFamily(tag);
    return knownFamilies.has(tagFamily) && (!family || tagFamily === family || tagFamily === aiFamily);
  });

  // A broad catalog label can be refined by corroborating tags/AI, but conflicting AI alone cannot overturn it.
  let primaryGenre = catalog || ai || (usefulTags[0] ? genreFamily(usefulTags[0]) : '') || 'Desconocido';
  if (!catalog && ai) primaryGenre = aiFamily || ai;
  else if (catalog && family && ai && aiFamily === family) primaryGenre = family;
  else if (catalog && family && ai && aiFamily && aiFamily !== family) {
    const corroboratesCatalog = usefulTags.some((tag) => genreFamily(tag) === family);
    if (!corroboratesCatalog) primaryGenre = catalog;
  }

  const aiAgreesWithPrimary = !aiFamily || aiFamily === genreFamily(primaryGenre);
  const subgenres = [...new Set([
    ...(aiAgreesWithPrimary ? aiSubgenres : []),
    ...usefulTags,
    ...(ai && aiAgreesWithPrimary && ai.toLowerCase() !== primaryGenre.toLowerCase() ? [ai] : []),
  ].map((value) => value.trim()).filter((value) => value && value.toLowerCase() !== primaryGenre.toLowerCase()))].slice(0, 5);

  return { primaryGenre, subgenres };
}

export function enrichGenreProfile(
  rawGenre: string,
  extraTags: string[] = [],
  context: string = ''
): GenreProfile {
  const normalizedGenre = (rawGenre || '').trim().toLowerCase();
  const lowerContext = context.toLowerCase();
  const genreEvidence = `${normalizedGenre} ${extraTags.join(' ').toLowerCase()}`;
  const genericLabels = ['latino', 'latin', 'tropical', 'latin urban', 'musica latina', ''];
  const hasSpecificCatalogGenre = !!normalizedGenre && !genericLabels.includes(normalizedGenre) && !/^(music|world music|popular music)$/.test(normalizedGenre);
  const allText = hasSpecificCatalogGenre ? genreEvidence : `${genreEvidence} ${lowerContext}`;

  // POP / ELECTROPOP: distinguish main family from supported electronic subgenres.
  if (/\b(pop|pop music|popular music|electropop|electro pop|dance pop|synth pop|indie pop|power pop)\b/i.test(genreEvidence)) {
    const supportedSubgenres = extraTags.filter((tag) => /electropop|electro pop|dance.?pop|synth.?pop|indie pop|power pop|pop rock/i.test(tag));
    return {
      primaryGenre: 'Pop',
      subgenres: [...new Set(supportedSubgenres.length ? supportedSubgenres : ['Pop contemporáneo'])].slice(0, 4),
      category: 'Música popular',
      color: 'from-fuchsia-500 to-violet-600',
      badgeBg: 'rgba(168, 85, 247, 0.15)',
      badgeText: '#c084fc',
      vibe: 'Variable según la canción y su producción',
      typicalRhythm: 'Depende de la grabación; no se infiere únicamente por la etiqueta Pop',
      tempoRange: 'No determinado por la etiqueta de catálogo',
      instruments: [],
      danceability: 'No determinada por la etiqueta de catálogo',
      isLazyLabelRefined: false,
      culturalLineage: 'Música popular contemporánea',
    };
  }

  // ROCK: use explicit catalog/tag evidence; do not infer a subgenre from artist identity alone.
  if (/\b(rock|metal|punk|grunge)\b/i.test(genreEvidence)) {
    const supportedRockTags = extraTags.filter((tag) => /alternative rock|indie rock|hard rock|punk rock|rock en español|rock latino|progressive rock/i.test(tag));
    return {
      primaryGenre: /rock en español|rock latino/i.test(genreEvidence) ? 'Rock en Español' : 'Rock',
      subgenres: [...new Set(supportedRockTags.length ? supportedRockTags : ['Rock contemporáneo'])].slice(0, 4),
      category: 'Rock',
      color: 'from-orange-500 to-red-600',
      badgeBg: 'rgba(249, 115, 22, 0.15)',
      badgeText: '#fb923c',
      vibe: 'Variable según la canción y su producción',
      typicalRhythm: 'No determinado por la etiqueta de catálogo',
      tempoRange: 'No determinado por la etiqueta de catálogo',
      instruments: [],
      danceability: 'No determinada por la etiqueta de catálogo',
      isLazyLabelRefined: false,
      culturalLineage: 'Rock y sus distintas vertientes',
    };
  }

  // BACHATA
  if (
    allText.includes('bachata') ||
    lowerContext.includes('romeo santos') ||
    lowerContext.includes('aventura') ||
    lowerContext.includes('prince royce') ||
    lowerContext.includes('antony santos') ||
    lowerContext.includes('frank reyes')
  ) {
    return {
      primaryGenre: 'Bachata Sensual & Tradicional',
      subgenres: ['Bachata Tradicional', 'Bachata Urbana', 'Música de Amargue', 'Bachata Sensual'],
      category: 'Música Dominicana / Caribeña',
      color: 'from-pink-500 to-rose-600',
      badgeBg: 'rgba(244, 63, 94, 0.15)',
      badgeText: '#fb7185',
      vibe: 'Romántico, melancólico, sensual y bailable en pareja',
      typicalRhythm: 'Compás sincopado de 4/4 con requinto (lead guitar) y toque de bongo/güira',
      tempoRange: '120 - 138 BPM',
      instruments: ['Requinto (guitarra solista)', 'Segunda guitarra', 'Bajo eléctrico', 'Bongó', 'Güira'],
      danceability: 'Muy alta (paso básico de 4 tiempos con acento en cadera)',
      isLazyLabelRefined: true,
      lazyLabelNote: 'Se reclasificó de la etiqueta genérica "Latino" a Bachata Dominicana específica.',
      culturalLineage: 'República Dominicana ➔ Bolero Campesino ➔ Música de Amargue ➔ Bachata',
    };
  }

  // SALSA
  if (
    allText.includes('salsa') ||
    lowerContext.includes('hector lavoe') ||
    lowerContext.includes('marc anthony') ||
    lowerContext.includes('willie colon') ||
    lowerContext.includes('ruben blades') ||
    lowerContext.includes('celia cruz') ||
    lowerContext.includes('grupo niche') ||
    lowerContext.includes('gilberto santa rosa')
  ) {
    return {
      primaryGenre: 'Salsa (Brava / Romántica)',
      subgenres: ['Salsa Brava', 'Salsa Romántica', 'Timba Cubana', 'Salsa Dura'],
      category: 'Música Afrocaribeña & Antillana',
      color: 'from-red-500 to-amber-600',
      badgeBg: 'rgba(239, 68, 68, 0.15)',
      badgeText: '#f87171',
      vibe: 'Enérgico, polirrítmico, pasional y festivo',
      typicalRhythm: 'Patrón de clave 2:3 o 3:2 con montuno de piano y tumbao de conga',
      tempoRange: '160 - 220 BPM (80-110 a medio tiempo)',
      instruments: ['Congas', 'Timbales', 'Bongó y Campana', 'Piano (montuno)', 'Bajo (tumbao)', 'Trombones', 'Trompetas'],
      danceability: 'Máxima (baile en tiempo 1 o 2 en compás de 8 tiempos)',
      isLazyLabelRefined: true,
      lazyLabelNote: 'Se reclasificó de "Tropical" o "Latino" a Salsa clásica y estructurada.',
      culturalLineage: 'Cuba (Son Cubano & Mambo) + Puerto Rico ➔ Barrio Latino de Nueva York (Fania) ➔ Salsa Mundial',
    };
  }

  // CUMBIA
  if (
    allText.includes('cumbia') ||
    lowerContext.includes('angeles azules') ||
    lowerContext.includes('damas gratis') ||
    lowerContext.includes('celso piña') ||
    lowerContext.includes('sonidera') ||
    lowerContext.includes('villera')
  ) {
    return {
      primaryGenre: 'Cumbia (Sonidera / Villera / Tradicional)',
      subgenres: ['Cumbia Sonidera', 'Cumbia Villera', 'Cumbia Colombiana', 'Electro Cumbia'],
      category: 'Folclore Urbano Panlatino',
      color: 'from-emerald-500 to-teal-600',
      badgeBg: 'rgba(16, 185, 129, 0.15)',
      badgeText: '#34d399',
      vibe: 'Festivo, popular, hipnótico y rítmico',
      typicalRhythm: 'Compás de 2/4 o 4/4 con patrón característico de güiro (chiki-chiki) y contratiempo',
      tempoRange: '88 - 105 BPM',
      instruments: ['Güiro / Guache', 'Acordeón', 'Teclados con efectos', 'Timbales', 'Bajo melódico'],
      danceability: 'Muy alta (balanceo cadencioso accesible para cualquier oyente)',
      isLazyLabelRefined: true,
      lazyLabelNote: 'Desglosado del término "Tropical" a la vertiente específica de Cumbia.',
      culturalLineage: 'Caribe colombiano (indígena + africano) ➔ México (Sonidera) / Argentina (Villera)',
    };
  }

  // CORRIDOS TUMBADOS / REGIONAL MEXICANO
  if (
    allText.includes('corrido') ||
    allText.includes('banda') ||
    allText.includes('norteño') ||
    lowerContext.includes('peso pluma') ||
    lowerContext.includes('natanael cano') ||
    lowerContext.includes('fuerza regida') ||
    lowerContext.includes('junior h') ||
    lowerContext.includes('christian nodal')
  ) {
    return {
      primaryGenre: 'Regional Mexicano (Corridos Tumbados / Banda)',
      subgenres: ['Corridos Tumbados', 'Banda Sinaloense', 'Norteño Clásico', 'Sierreño Urbano'],
      category: 'Música Mexicana & Tradicional',
      color: 'from-amber-500 to-orange-600',
      badgeBg: 'rgba(245, 158, 11, 0.15)',
      badgeText: '#fbbf24',
      vibe: 'Crudo, acústico de alta velocidad, narrativo y moderno',
      typicalRhythm: 'Compás ternario de 3/4 o 6/8 con requinto de 12 cuerdas y bajo acústico',
      tempoRange: '125 - 145 BPM',
      instruments: ['Docerola (guitarra de 12 cuerdas)', 'Tololoche / Bajo acústico', 'Charcheta', 'Trompetas y Trombón'],
      danceability: 'Moderada a alta (estilo zapateado o balanceo)',
      isLazyLabelRefined: true,
      lazyLabelNote: 'Se reclasificó de la etiqueta genérica "Latino" a Corridos Tumbados / Regional Mexicano.',
      culturalLineage: 'Tradición del Corrido de la Revolución Mexicana ➔ Fusión Sierreña ➔ Corridos Tumbados Siglo XXI',
    };
  }

  // REGGAETÓN & URBANO
  if (
    allText.includes('reggaeton') ||
    allText.includes('reguetón') ||
    allText.includes('dembow') ||
    allText.includes('urbano') ||
    lowerContext.includes('bad bunny') ||
    lowerContext.includes('karol g') ||
    lowerContext.includes('rauw alejandro') ||
    lowerContext.includes('daddy yankee') ||
    lowerContext.includes('feid')
  ) {
    return {
      primaryGenre: 'Reggaetón & Urbano Latino',
      subgenres: ['Perreo Clásico', 'Reggaetón Moderno / Melódico', 'Dembow Dominicano', 'Trap Latino'],
      category: 'Música Urbana Contemporánea',
      color: 'from-purple-500 to-indigo-600',
      badgeBg: 'rgba(168, 85, 247, 0.15)',
      badgeText: '#c084fc',
      vibe: 'Enérgico, nocturno, bailable y contagioso',
      typicalRhythm: 'Patrón sincopado clásico Dembow (boom-ch-boom-chick) en 4/4',
      tempoRange: '90 - 105 BPM',
      instruments: ['Caja de ritmos (kick y snare dembow)', 'Sintetizadores', 'Sub-bajo 808', 'Vocal chops'],
      danceability: 'Máxima (baile perreo y discoteca)',
      isLazyLabelRefined: true,
      lazyLabelNote: 'Identificado como Reggaetón específico en vez de "Música Latina".',
      culturalLineage: 'Reggae en español de Panamá + Dancehall jamaiquino ➔ Puerto Rico Underground ➔ Reggaetón Global',
    };
  }

  // Default / Variado
  return {
    primaryGenre: rawGenre || 'Música Latina & Variada',
    subgenres: ['Música Popular', 'Ritmo Melódico', 'Contemporáneo'],
    category: 'Música General',
    color: 'from-cyan-500 to-blue-600',
    badgeBg: 'rgba(6, 182, 212, 0.15)',
    badgeText: '#22d3ee',
    vibe: 'Melódico y envolvente',
    typicalRhythm: 'Compás de 4/4 estándar',
    tempoRange: '95 - 128 BPM',
    instruments: ['Batería', 'Bajo', 'Guitarras', 'Teclados'],
    danceability: 'Media',
    isLazyLabelRefined: false,
    culturalLineage: 'Tradición y evolución de la música popular contemporánea',
  };
}

export function calculateConfidence(
  hasItunes: boolean,
  hasMusicBrainz: boolean,
  hasAi: boolean,
  titleExactMatch: boolean
): number {
  // Es un índice heurístico de corroboración, no una probabilidad estadística.
  let score = 40;
  if (hasItunes) score += 25;
  if (hasMusicBrainz) score += 15;
  if (hasAi) score += 10;
  if (titleExactMatch) score += 10;
  return Math.min(score, 99);
}
