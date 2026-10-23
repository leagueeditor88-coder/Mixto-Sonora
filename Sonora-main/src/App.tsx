import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { SearchBar } from './components/SearchBar';
import { GenreResultCard } from './components/GenreResultCard';
import { BatchAnalyzer } from './components/BatchAnalyzer';
import { GenreExplorer } from './components/GenreExplorer';
import { RecentHistory } from './components/RecentHistory';
import { detectGenre } from './services/genreClient';
import type { GenreDetectionResult } from './server/genreService';
import {
  Sparkles,
  Database,
  Radio,
  HelpCircle,
  AlertTriangle,
  Music2,
  Disc3,
  Cpu,
  Globe
} from 'lucide-react';


declare global {
  interface Window {
    MixtoLibrary?: {
      saveClassification: (trackUri: string, primaryGenre: string, subgenresJson: string, title: string, artist: string, confidence: number) => boolean;
    };
    __mixtoPendingTrack?: { uri: string; title: string; artist: string };
  }
}

const STORAGE_KEY = 'sonoragenre_history_v1';

export default function App() {
  const [activeTab, setActiveTab] = useState<'detect' | 'batch' | 'encyclopedia'>('detect');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [currentResult, setCurrentResult] = useState<GenreDetectionResult | null>(null);
  const [history, setHistory] = useState<GenreDetectionResult[]>([]);

  // Load history from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        setHistory(JSON.parse(saved));
      }
    } catch (e) {
      console.warn('Failed to load history:', e);
    }
  }, []);

  // Save history
  const saveToHistory = (item: GenreDetectionResult) => {
    setHistory((prev) => {
      const filtered = prev.filter(
        (h) => h.track.title.toLowerCase() !== item.track.title.toLowerCase() ||
               h.track.artist.toLowerCase() !== item.track.artist.toLowerCase()
      );
      const updated = [item, ...filtered].slice(0, 9);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch (e) {
        console.warn('Failed to save history:', e);
      }
      return updated;
    });
  };

  const handleClearHistory = () => {
    setHistory([]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      console.warn('Failed to clear history:', e);
    }
  };

  const handleSearch = async (queryText: string) => {
    if (!queryText.trim()) return;

    setIsLoading(true);
    setErrorMsg(null);
    setActiveTab('detect');

    try {
      const data = await detectGenre(queryText);
      setCurrentResult(data);
      saveToHistory(data);

      // Si la búsqueda empezó desde la biblioteca nativa, persiste el resultado
      // en Mixto asociado al URI real del archivo, no solo al texto de búsqueda.
      const pendingTrack = window.__mixtoPendingTrack;
      if (pendingTrack && window.MixtoLibrary?.saveClassification) {
        const normalizeMatch = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        const selectedTitle = normalizeMatch(pendingTrack.title);
        const detectedTitle = normalizeMatch(data.track.title);
        const selectedArtist = normalizeMatch(pendingTrack.artist);
        const detectedArtist = normalizeMatch(data.track.artist);
        const sameTitle = selectedTitle === detectedTitle || selectedTitle.includes(detectedTitle) || detectedTitle.includes(selectedTitle);
        const sameArtist = !selectedArtist || selectedArtist === 'artista desconocido' || !detectedArtist || detectedArtist === 'artista no especificado' || selectedArtist === detectedArtist || selectedArtist.includes(detectedArtist) || detectedArtist.includes(selectedArtist);
        if (sameTitle && sameArtist) {
          const saved = window.MixtoLibrary.saveClassification(
            pendingTrack.uri,
            data.primaryGenre,
            JSON.stringify(data.subgenres || []),
            pendingTrack.title,
            pendingTrack.artist,
            data.confidence || 0
          );
          if (saved) console.info('[Sonora] Clasificación guardada en la biblioteca de Mixto.');
          else console.warn('[Sonora] No se pudo guardar la clasificación en Mixto.');
          delete window.__mixtoPendingTrack;
        } else {
          console.warn('[Sonora] La coincidencia no corresponde exactamente a la canción seleccionada; no se guardó en Mixto.');
          delete window.__mixtoPendingTrack;
        }
      }
    } catch (err: unknown) {
      // No conservar una canción pendiente si el análisis falló; evita asociar una búsqueda posterior al archivo equivocado.
      if (window.__mixtoPendingTrack) delete window.__mixtoPendingTrack;
      console.error('Detection error:', err);
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'No se pudo conectar con las bases de datos externas. Por favor verifica tu conexión e intenta nuevamente.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  // Perform initial search with user example so the app starts populated and immediately demonstrates its value
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const autostart = urlParams.get('autostart');
    const qParam = urlParams.get('q');

    if (qParam) {
      handleSearch(qParam);
    } else if (autostart === '1' || !currentResult) {
      // Default to the user's example query: "j Balvin - azul determinar genero"
      handleSearch('j Balvin - azul determinar genero');
    }
  }, []);

  return (
    <div className="min-h-screen bg-[#090a10] text-slate-100 flex flex-col font-sans selection:bg-pink-500/30 selection:text-pink-200">
      {/* Top Header */}
      <Header activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Main Content Area */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-8 space-y-8">
        {/* Tab 1: Single Detector */}
        {activeTab === 'detect' && (
          <div className="space-y-8">
            {/* Hero Title & Search */}
            <section className="text-center max-w-3xl mx-auto space-y-3 pt-2">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-pink-500/10 border border-pink-500/20 text-pink-400 text-xs font-semibold mb-1">
                <Sparkles className="w-3.5 h-3.5" />
                <span>Extracción Automática desde Bases de Datos Oficiales y Abiertas</span>
              </div>

              <h1 className="text-3xl sm:text-4xl md:text-5xl font-black text-white tracking-tight leading-tight">
                ¿Qué género es esa canción?
              </h1>
              <p className="text-sm sm:text-base text-slate-400 max-w-2xl mx-auto leading-relaxed">
                Clasificación musical contextual: identifica el género específico cuando las fuentes y etiquetas disponibles lo respaldan (<strong className="text-pink-300 font-semibold">Bachata</strong>, <strong className="text-yellow-300 font-semibold">Salsa</strong>, <strong className="text-emerald-300 font-semibold">Cumbia</strong>, <strong className="text-orange-300 font-semibold">Corridos Tumbados</strong>, <strong className="text-purple-300 font-semibold">Reggaetón</strong>, <strong className="text-red-300 font-semibold">Rock en Español</strong>) superando las etiquetas genéricas o &ldquo;cajón de sastre&rdquo; como &ldquo;Latino&rdquo; o &ldquo;Tropical&rdquo;.
              </p>

              {/* Search component */}
              <div className="pt-4">
                <SearchBar
                  onSearch={handleSearch}
                  isLoading={isLoading}
                  initialQuery="j Balvin - azul determinar genero"
                />
              </div>
            </section>

            {/* Error Message */}
            {errorMsg && (
              <div
                role="alert"
                className="max-w-2xl mx-auto p-4 rounded-2xl bg-red-950/40 border border-red-500/30 flex items-start gap-3 text-red-300 text-xs sm:text-sm"
              >
                <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold block mb-0.5">Aviso de consulta:</span>
                  <p>{errorMsg}</p>
                </div>
              </div>
            )}

            {/* Loading Indicator */}
            {isLoading && (
              <div className="flex flex-col items-center justify-center py-16 gap-4">
                <div className="relative">
                  <div className="w-16 h-16 rounded-full border-4 border-pink-500/20 border-t-pink-500 animate-spin" />
                  <Disc3 className="w-7 h-7 text-pink-400 absolute inset-0 m-auto animate-pulse" />
                </div>
                <div className="text-center space-y-1">
                  <p className="text-sm font-semibold text-white">
                    Consultando catálogos de bases de datos externas...
                  </p>
                  <p className="text-xs text-slate-500">
                    Cotejando metadatos y etiquetas; las fuentes disponibles dependen de la conexión al backend
                  </p>
                </div>
              </div>
            )}

            {/* Result Card */}
            {!isLoading && currentResult && (
              <section aria-label="Resultado del género detectado">
                <GenreResultCard result={currentResult} />
              </section>
            )}

            {/* History of recent searches */}
            <RecentHistory
              history={history}
              onSelect={(item) => setCurrentResult(item)}
              onClear={handleClearHistory}
            />

            {/* Explanatory Database Trust Banner */}
            <section className="bg-slate-900/40 border border-white/5 rounded-2xl p-6">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                <Globe className="w-4 h-4 text-cyan-400" />
                Cómo funciona la detección automática con bases de datos externas
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs text-slate-300">
                <div className="p-3.5 rounded-xl bg-slate-950/60 border border-white/5 space-y-1.5">
                  <span className="font-semibold text-white flex items-center gap-1.5">
                    <Database className="w-3.5 h-3.5 text-pink-400" /> 1. Filtro y Limpieza
                  </span>
                  <p className="text-slate-400 text-[11px] leading-relaxed">
                    Elimina palabras conversacionales como &ldquo;determinar género&rdquo; o &ldquo;canción de&rdquo; para extraer el artista y título limpios.
                  </p>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-950/60 border border-white/5 space-y-1.5">
                  <span className="font-semibold text-white flex items-center gap-1.5">
                    <Cpu className="w-3.5 h-3.5 text-purple-400" /> 2. Consulta en BD Externa
                  </span>
                  <p className="text-slate-400 text-[11px] leading-relaxed">
                    Busca en los catálogos globales de iTunes y MusicBrainz la clasificación comercial y etiquetas comunitarias asignadas por sellos discográficos.
                  </p>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-950/60 border border-white/5 space-y-1.5">
                  <span className="font-semibold text-white flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-cyan-400" /> 3. Musicología & Acústica
                  </span>
                  <p className="text-slate-400 text-[11px] leading-relaxed">
                    Combina etiquetas verificables y reglas de género. No afirma medir BPM ni analizar directamente el audio; si las fuentes discrepan, el resultado debe reflejar esa incertidumbre.
                  </p>
                </div>
              </div>
            </section>
          </div>
        )}

        {/* Tab 2: Batch Analyzer */}
        {activeTab === 'batch' && (
          <BatchAnalyzer
            onSelectTrack={(item) => {
              setCurrentResult(item);
              setActiveTab('detect');
            }}
          />
        )}

        {/* Tab 3: Encyclopedia & Taxonomy */}
        {activeTab === 'encyclopedia' && (
          <GenreExplorer
            onSearchGenreSample={(sample) => {
              handleSearch(sample);
            }}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-white/10 bg-slate-950/90 py-6 mt-12 text-xs text-slate-500">
        <div className="max-w-6xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Music2 className="w-4 h-4 text-pink-400" />
            <span className="font-medium text-slate-300">SonoraGenre</span>
            <span>— Clasificador inteligente de géneros musicales</span>
          </div>

          <div className="flex items-center gap-4 text-slate-400 text-[11px]">
            <span>Fuentes según disponibilidad: iTunes, MusicBrainz y Deezer</span>
            <span>•</span>
            <span>Last.fm, Discogs, Spotify y Gemini requieren configuración adicional</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
