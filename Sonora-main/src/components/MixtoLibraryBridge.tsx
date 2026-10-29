import React, { useState } from 'react';
import { batchDetectGenres } from '../services/genreClient';

type MixtoTrack = { uri: string; title: string; artist: string; album?: string; genre?: string };

declare global {
  interface Window {
    MixtoAndroid?: {
      getLibraryJson: () => string;
      saveClassification: (uri: string, genre: string, subgenresJson: string,
        title: string, artist: string, confidence: number) => boolean;
    };
  }
}

/** Puente web: solo funciona dentro del WebView de Mixto. */
export function MixtoLibraryBridge() {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const available = typeof window !== 'undefined' && !!window.MixtoAndroid;

  const run = async () => {
    const bridge = window.MixtoAndroid;
    if (!bridge || busy) return;
    setBusy(true); setStatus('Leyendo biblioteca de Mixto…'); setProgress({ done: 0, total: 0 });
    try {
      const data = JSON.parse(bridge.getLibraryJson()) as MixtoTrack[] | { error: string };
      if (!Array.isArray(data)) throw new Error('error' in data ? data.error : 'Biblioteca no válida.');
      const pending = data.filter(t => t.uri && t.title?.trim() && !t.genre?.trim());
      setProgress({ done: 0, total: pending.length });
      if (!pending.length) { setStatus(`Se encontraron ${data.length} canciones; no hay pendientes de clasificar.`); return; }

      let saved = 0, processed = 0;
      for (let offset = 0; offset < pending.length; offset += 5) {
        const batch = pending.slice(offset, offset + 5);
        setStatus(`Sonora clasifica ${Math.min(offset + batch.length, pending.length)} de ${pending.length}…`);
        const results = await batchDetectGenres(batch.map(t => `${t.artist || 'Artista desconocido'} - ${t.title}`));
        for (let i = 0; i < Math.min(batch.length, results.length); i++) {
          const t = batch[i], r = results[i], genre = r?.primaryGenre?.trim();
          if (!genre) continue;
          if (bridge.saveClassification(t.uri, genre, JSON.stringify(Array.isArray(r.subgenres) ? r.subgenres : []),
            r.track?.title || t.title, r.track?.artist || t.artist, Math.round(Number(r.confidence) || 0))) saved++;
        }
        processed += batch.length; setProgress({ done: processed, total: pending.length });
      }
      setStatus(`Terminado: ${saved} géneros guardados en Mixto. Las clasificaciones existentes se conservaron.`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'No se pudo conectar Sonora con la biblioteca.');
    } finally { setBusy(false); }
  };

  if (!available) return null;
  return <section className="mx-auto max-w-4xl rounded-2xl border border-pink-500/30 bg-slate-900/80 p-4">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div><h2 className="font-bold text-white">Biblioteca de Mixto</h2>
        <p className="mt-1 text-sm text-slate-300">Clasifica canciones pendientes y guarda sus géneros en Mixto.</p></div>
      <button type="button" onClick={run} disabled={busy}
        className="rounded-xl bg-pink-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">
        {busy ? 'Clasificando…' : 'Leer y clasificar biblioteca'}
      </button>
    </div>
    {progress.total > 0 && <div className="mt-3">
      <div className="h-2 overflow-hidden rounded-full bg-slate-700"><div className="h-full rounded-full bg-pink-500"
        style={{ width: `${Math.round(progress.done / progress.total * 100)}%` }} /></div>
      <p className="mt-1 text-xs text-slate-400">{progress.done}/{progress.total}</p>
    </div>}
    {status && <p role="status" className="mt-3 text-sm text-slate-200">{status}</p>}
  </section>;
}
