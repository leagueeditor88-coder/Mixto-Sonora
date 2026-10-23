import type { GenreDetectionResult } from '../server/genreService';

/**
 * Cliente estricto: toda clasificación debe pasar por el backend multi-fuente.
 * No usa iTunes directo ni reglas locales como sustituto silencioso.
 */
const API_BASE = ((import.meta as any).env?.VITE_SONORA_API_URL || '').replace(/\/$/, '');
function apiUrl(path: string): string { return `${API_BASE}${path}`; }

async function readError(res: Response): Promise<string> {
  try {
    const data = await res.json();
    return data.message || data.error || '';
  } catch {
    return '';
  }
}

export async function detectGenre(queryText: string): Promise<GenreDetectionResult> {
  const trimmed = queryText.trim();
  if (!trimmed) throw new Error('Ingresa el título o artista de una canción para determinar su género.');
  if (!API_BASE) throw new Error('Sonora requiere el backend multi-fuente. Configura VITE_SONORA_API_URL con la URL HTTPS del servicio.');

  const res = await fetch(apiUrl(`/api/detect?q=${encodeURIComponent(trimmed)}`));
  if (!res.ok) throw new Error((await readError(res)) || `El backend multi-fuente de Sonora respondió HTTP ${res.status}.`);
  const data = await res.json();
  if (!data || !data.primaryGenre) throw new Error('El backend de Sonora no devolvió una clasificación válida.');
  return data as GenreDetectionResult;
}

export async function batchDetectGenres(songs: string[]): Promise<GenreDetectionResult[]> {
  if (!API_BASE) throw new Error('Sonora requiere el backend multi-fuente. Configura VITE_SONORA_API_URL.');
  const res = await fetch(apiUrl('/api/batch-detect'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ songs }),
  });
  if (!res.ok) throw new Error((await readError(res)) || `El backend multi-fuente de Sonora respondió HTTP ${res.status}.`);
  const data = await res.json();
  if (!Array.isArray(data.results)) throw new Error('El backend no devolvió resultados por lotes válidos.');
  return data.results as GenreDetectionResult[];
}
