import React, { useState, useRef, useEffect } from 'react';
import type { GenreDetectionResult } from '../server/genreService';
import {
  Play,
  Pause,
  ExternalLink,
  CheckCircle2,
  Volume2,
  VolumeX,
  Share2,
  Copy,
  Check,
  Activity,
  Layers,
  Radio,
  Clock,
  Calendar,
  Sparkles,
  Database
} from 'lucide-react';

interface GenreResultCardProps {
  result: GenreDetectionResult;
}

export const GenreResultCard: React.FC<GenreResultCardProps> = ({ result }) => {
  const { track, primaryGenre, subgenres, category, confidence, sources, musicalProfile } = result;

  // Audio player state
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(30);
  const [isMuted, setIsMuted] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Reset player on new song result
    setIsPlaying(false);
    setCurrentTime(0);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
  }, [result]);

  const togglePlay = () => {
    if (!audioRef.current || !track.previewUrl) return;

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().then(() => {
        setIsPlaying(true);
      }).catch((e) => {
        console.warn('Playback prevented:', e);
      });
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
      if (audioRef.current.duration && !isNaN(audioRef.current.duration)) {
        setDuration(audioRef.current.duration);
      }
    }
  };

  const handleAudioEnded = () => {
    setIsPlaying(false);
    setCurrentTime(0);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    setCurrentTime(val);
    if (audioRef.current) {
      audioRef.current.currentTime = val;
    }
  };

  const toggleMute = () => {
    if (audioRef.current) {
      audioRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  const handleCopy = () => {
    const text = `🎵 Canción: ${track.artist} - ${track.title}\n🏷️ Género Principal: ${primaryGenre} (${category})\n🎚️ Subgéneros: ${subgenres.join(', ')}\n🎯 Confianza: ${confidence}%\n🥁 Ritmo: ${musicalProfile.typicalRhythm}\n⚡ BPM: ${musicalProfile.bpmEstimate || musicalProfile.tempoRange}`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatSec = (sec: number) => {
    const s = Math.floor(sec);
    return `0:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <article className="w-full bg-slate-900/90 border border-white/15 rounded-3xl overflow-hidden shadow-2xl shadow-black/60 relative">
      {/* Background glow tinted by genre color */}
      <div
        className="absolute top-0 right-0 w-96 h-96 blur-3xl opacity-20 pointer-events-none rounded-full"
        style={{ backgroundColor: musicalProfile.color || '#ec4899' }}
      />

      {/* Main Hero Header */}
      <div className="p-6 sm:p-8 border-b border-white/10 bg-gradient-to-b from-white/5 to-transparent relative">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
          {/* Left: Vinyl & Artwork */}
          <div className="flex items-center gap-5 sm:gap-6 w-full lg:w-auto">
            {/* Vinyl record container */}
            <div className="relative group shrink-0">
              {/* Spinning vinyl disk behind artwork */}
              <div
                className={`absolute -right-6 top-1/2 -translate-y-1/2 w-28 h-28 sm:w-32 sm:h-32 rounded-full bg-neutral-950 border-4 border-neutral-800 shadow-xl hidden sm:flex items-center justify-center transition-transform duration-700 ${
                  isPlaying ? 'translate-x-4 rotate-180 animate-spin [animation-duration:3s]' : 'translate-x-1 group-hover:translate-x-3'
                }`}
              >
                {/* Vinyl grooves */}
                <div className="w-24 h-24 rounded-full border border-neutral-700/60 flex items-center justify-center">
                  <div className="w-16 h-16 rounded-full border border-neutral-700/40 flex items-center justify-center">
                    <div className="w-8 h-8 rounded-full bg-pink-600/80 border-2 border-white/80 flex items-center justify-center">
                      <div className="w-2 h-2 rounded-full bg-black" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Album cover */}
              <div className="relative w-24 h-24 sm:w-28 sm:h-28 rounded-2xl overflow-hidden shadow-xl border border-white/20 bg-slate-800 z-10 shrink-0">
                <img
                  src={track.artworkUrl}
                  alt={`${track.title} por ${track.artist}`}
                  className="w-full h-full object-cover"
                />
                {track.previewUrl && (
                  <button
                    onClick={togglePlay}
                    aria-label={isPlaying ? 'Pausar muestra de audio' : 'Reproducir muestra de audio'}
                    className="absolute inset-0 bg-black/40 hover:bg-black/60 flex items-center justify-center transition-colors group/play"
                  >
                    <div className="w-10 h-10 rounded-full bg-pink-500 text-white flex items-center justify-center shadow-lg transform group-hover/play:scale-110 transition-transform">
                      {isPlaying ? <Pause className="w-5 h-5 fill-white" /> : <Play className="w-5 h-5 fill-white ml-0.5" />}
                    </div>
                  </button>
                )}
              </div>
            </div>

            {/* Track Info */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-xs text-pink-400 font-medium mb-1">
                <Radio className="w-3.5 h-3.5 text-pink-400 animate-pulse" />
                <span>Canción Identificada</span>
                <span className="text-slate-600">•</span>
                <span className="text-slate-400 flex items-center gap-1">
                  <Calendar className="w-3 h-3" /> {track.releaseYear}
                </span>
                <span className="text-slate-600">•</span>
                <span className="text-slate-400 flex items-center gap-1">
                  <Clock className="w-3 h-3" /> {track.durationFormatted}
                </span>
              </div>

              <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight truncate">
                {track.title}
              </h2>
              <p className="text-base sm:text-lg text-slate-300 font-medium truncate mt-0.5">
                {track.artist}
              </p>
              <p className="text-xs text-slate-500 truncate mt-0.5">
                Álbum: <span className="text-slate-400">{track.album}</span>
              </p>
            </div>
          </div>

          {/* Right: Primary Genre Display Box */}
          <div className="w-full lg:w-auto lg:min-w-[280px] bg-slate-950/70 border border-white/10 rounded-2xl p-4 flex flex-col justify-between">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Género Detectado
              </span>
              <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium">
                <CheckCircle2 className="w-3 h-3" />
                <span>{confidence}% Confianza</span>
              </div>
            </div>

            {/* Prominent Genre Label */}
            <div className="my-1">
              <div
                className="inline-block text-xl sm:text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-pink-400 via-purple-300 to-cyan-300 tracking-tight"
              >
                {primaryGenre}
              </div>
              <div className="text-xs text-slate-400 mt-1 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-purple-400" />
                Categoría: <span className="text-slate-200 font-medium">{category}</span>
              </div>
            </div>

            {/* Subgenres Pills */}
            <div className="flex flex-wrap gap-1.5 mt-3 pt-2 border-t border-white/10">
              {subgenres.map((sg, idx) => (
                <span
                  key={idx}
                  className="text-[11px] px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-slate-300 font-medium"
                >
                  {sg}
                </span>
              ))}
            </div>

            {/* Anti-lazy label badge */}
            <div className="mt-2.5 pt-2 border-t border-white/10 flex items-center gap-1.5 text-[10px] text-emerald-400">
              <Sparkles className="w-3 h-3 text-emerald-400 shrink-0" />
              <span>Precisión específica (Sin etiqueta genérica &quot;Latino/Tropical&quot;)</span>
            </div>
          </div>
        </div>

        {/* Anti-Lazy Label Refinement Alert */}
        {(musicalProfile.isLazyLabelRefined || musicalProfile.lazyLabelNote) && (
          <div className="mt-5 p-3 rounded-xl bg-cyan-950/40 border border-cyan-500/30 flex items-start gap-2.5 text-xs text-cyan-200">
            <Sparkles className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold text-white block">
                Desglose Específico vs. Etiqueta Generalista:
              </span>
              <p className="text-cyan-200/90 leading-relaxed mt-0.5">
                {musicalProfile.lazyLabelNote ||
                  'Las bases de datos externas a menudo catalogan erróneamente toda la música hispana como "Latino" o "Tropical". Nuestro motor analiza el compás y los instrumentos para clasificar su verdadero ritmo.'}
              </p>
              {musicalProfile.culturalLineage && (
                <div className="mt-1.5 font-mono text-[11px] text-cyan-300 bg-cyan-950/80 px-2.5 py-1 rounded-lg border border-cyan-500/20 inline-block">
                  Linaje Musical: {musicalProfile.culturalLineage}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Audio Preview Bar (If previewUrl available) */}
        {track.previewUrl && (
          <div className="mt-6 pt-5 border-t border-white/10">
            <audio
              ref={audioRef}
              src={track.previewUrl}
              onTimeUpdate={handleTimeUpdate}
              onEnded={handleAudioEnded}
              preload="metadata"
            />
            <div className="flex flex-col sm:flex-row items-center gap-3">
              <div className="flex items-center gap-3 w-full sm:w-auto">
                <button
                  onClick={togglePlay}
                  className="px-4 py-2 rounded-xl bg-pink-600 hover:bg-pink-500 text-white font-medium text-xs flex items-center gap-2 shadow-md transition-all active:scale-95"
                >
                  {isPlaying ? (
                    <>
                      <Pause className="w-4 h-4 fill-white" />
                      <span>Pausar Muestra (30s)</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 fill-white" />
                      <span>Reproducir Muestra Oficial</span>
                    </>
                  )}
                </button>

                {/* Animated frequency visualizer bars */}
                <div className="flex items-end gap-1 h-6 px-2 py-1 rounded bg-black/40 border border-white/5" aria-hidden="true">
                  {[40, 75, 55, 90, 60, 85, 45, 95, 65, 80].map((height, i) => (
                    <span
                      key={i}
                      className={`w-1 bg-gradient-to-t from-pink-500 to-cyan-400 rounded-full transition-all ${
                        isPlaying ? 'animate-pulse' : 'opacity-40'
                      }`}
                      style={{
                        height: isPlaying ? `${Math.max(20, (height * (i % 2 === 0 ? 1 : 0.8)))}%` : '20%',
                        animationDelay: `${i * 120}ms`,
                      }}
                    />
                  ))}
                </div>
              </div>

              {/* Progress Slider */}
              <div className="flex items-center gap-2 w-full flex-1">
                <span className="text-[11px] font-mono text-slate-400 w-8 text-right">
                  {formatSec(currentTime)}
                </span>
                <input
                  type="range"
                  min="0"
                  max={duration || 30}
                  step="0.1"
                  value={currentTime}
                  onChange={handleSeek}
                  aria-label="Progreso de la muestra de audio"
                  className="w-full accent-pink-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                />
                <span className="text-[11px] font-mono text-slate-500 w-8">
                  {formatSec(duration || 30)}
                </span>

                <button
                  onClick={toggleMute}
                  aria-label={isMuted ? 'Activar sonido' : 'Silenciar'}
                  className="p-1.5 text-slate-400 hover:text-white rounded hover:bg-white/5 transition-colors"
                >
                  {isMuted ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4" />}
                </button>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
                <button
                  onClick={handleCopy}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs flex items-center gap-1.5 transition-colors"
                  title="Copiar detalles del género"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? '¡Copiado!' : 'Copiar Ficha'}</span>
                </button>

                {track.trackViewUrl && (
                  <a
                    href={track.trackViewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs flex items-center gap-1.5 transition-colors"
                  >
                    <span>Apple Music</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Musical Analysis & Acoustical Profile */}
      <div className="p-6 sm:p-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 bg-slate-950/40">
        {/* Card 1: Rhythm & Structure */}
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-5">
          <div className="flex items-center gap-2.5 text-pink-400 text-sm font-semibold mb-3">
            <Activity className="w-4 h-4" />
            <span>Patrón Rítmico & Tempo</span>
          </div>
          <div className="space-y-3 text-xs">
            <div>
              <span className="text-slate-500 block mb-0.5">Estructura del Beat:</span>
              <p className="text-slate-200 font-medium leading-relaxed">
                {musicalProfile.typicalRhythm}
              </p>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-white/5">
              <span className="text-slate-400">Tempo Estimado:</span>
              <span className="font-mono font-bold text-pink-300 bg-pink-950/40 px-2 py-0.5 rounded border border-pink-500/30">
                {musicalProfile.bpmEstimate || musicalProfile.tempoRange}
              </span>
            </div>
            <div className="flex items-center justify-between pt-1 border-t border-white/5">
              <span className="text-slate-400">Bailabilidad:</span>
              <span className="text-emerald-400 font-medium">
                {musicalProfile.danceability}
              </span>
            </div>
          </div>
        </div>

        {/* Card 2: Instrumentation & Vibe */}
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-5">
          <div className="flex items-center gap-2.5 text-cyan-400 text-sm font-semibold mb-3">
            <Radio className="w-4 h-4" />
            <span>Instrumentación Típica</span>
          </div>
          <div className="space-y-3 text-xs">
            <div>
              <span className="text-slate-500 block mb-1">Elementos Sonoros Clave:</span>
              <ul className="space-y-1">
                {musicalProfile.instruments.slice(0, 4).map((inst, i) => (
                  <li key={i} className="flex items-center gap-1.5 text-slate-300">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                    <span>{inst}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="pt-2 border-t border-white/5">
              <span className="text-slate-500 block mb-0.5">Atmósfera & Vibe:</span>
              <p className="text-slate-300 italic">{musicalProfile.vibe}</p>
            </div>
          </div>
        </div>

        {/* Card 3: Context & Origins */}
        <div className="bg-slate-900/60 border border-white/10 rounded-2xl p-5 md:col-span-2 lg:col-span-1">
          <div className="flex items-center gap-2.5 text-purple-400 text-sm font-semibold mb-3">
            <Sparkles className="w-4 h-4" />
            <span>Contexto & Raíces Musicales</span>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            {musicalProfile.historicalContext ||
              `Este tema pertenece al núcleo del movimiento ${primaryGenre}, caracterizado por su síntesis de melodías vocales comerciales con patrones rítmicos bailables arraigados en la evolución del ${category}.`}
          </p>

          {/* Similar reference tracks */}
          {result.similarTracks?.length > 0 && (
            <div className="mt-3 pt-3 border-t border-white/5">
              <span className="text-[11px] text-slate-500 block mb-1.5 font-medium">
                Pistas con acústica y género similar:
              </span>
              <div className="space-y-1">
                {result.similarTracks.slice(0, 2).map((st, i) => (
                  <span
                    key={i}
                    className="block text-[11px] text-slate-300 bg-white/5 px-2 py-1 rounded truncate border border-white/5"
                  >
                    🎵 {st}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Multi-Database Corroboration Transparency Table */}
      <div className="p-6 sm:p-8 border-t border-white/10 bg-slate-950/80">
        <div className="flex items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-purple-400" />
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">
              Corroboración en Bases de Datos Externas
            </h3>
          </div>
          <span className="text-xs text-slate-400">
            {sources.length} {sources.length === 1 ? 'fuente consultada' : 'fuentes externas cotejadas'}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sources.map((src, idx) => (
            <div
              key={idx}
              className="p-4 rounded-xl bg-slate-900/70 border border-white/10 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-xs font-semibold text-slate-200">{src.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-300 border border-purple-500/20">
                    {src.badge}
                  </span>
                </div>
                <div className="text-xs mb-2">
                  <span className="text-slate-500 text-[11px]">Género reportado: </span>
                  <span className="text-pink-400 font-semibold">{src.genreReported}</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed mb-3">
                  {src.description}
                </p>
                {src.url && (
                  <a
                    href={src.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-sky-300 hover:text-sky-200 underline underline-offset-2 mb-3 break-all"
                  >
                    Consultar fuente web <ExternalLink className="w-3 h-3 shrink-0" />
                  </a>
                )}
              </div>

              <div className="pt-2 border-t border-white/5 flex items-center justify-between text-[11px]">
                <span className="text-slate-500">Fiabilidad:</span>
                <span className="text-emerald-400 font-medium">{src.reliability}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </article>
  );
};
