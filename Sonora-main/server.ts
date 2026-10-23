import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { detectSongGenre } from './src/server/genreService.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  app.use(express.json());
  // Permit calls from the Android WebView and hosted frontend. Restrict with CORS_ORIGIN in production.
  app.use((req, res, next) => {
    const allowedOrigin = process.env.CORS_ORIGIN || req.headers.origin || '*';
    res.header('Access-Control-Allow-Origin', allowedOrigin);
    res.header('Vary', 'Origin');
    res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // API endpoint: Detect single song genre
  app.get('/api/detect', async (req, res) => {
    try {
      const q = (req.query.q as string) || '';
      if (!q.trim()) {
        return res.status(400).json({ error: 'Parámetro de búsqueda "q" requerido.' });
      }
      const result = await detectSongGenre(q);
      return res.json(result);
    } catch (err: unknown) {
      console.error('Error in /api/detect:', err);
      return res.status(500).json({
        error: 'Error al consultar las bases de datos de géneros musicales.',
        message: err instanceof Error ? err.message : String(err)
      });
    }
  });

  app.post('/api/detect', async (req, res) => {
    try {
      const query = req.body?.query || req.body?.q || '';
      if (!query.trim()) {
        return res.status(400).json({ error: 'Campo "query" requerido en el cuerpo.' });
      }
      const result = await detectSongGenre(query);
      return res.json(result);
    } catch (err: unknown) {
      console.error('Error in POST /api/detect:', err);
      return res.status(500).json({
        error: 'Error procesando la solicitud.',
        message: err instanceof Error ? err.message : String(err)
      });
    }
  });

  // Batch detection endpoint
  app.post('/api/batch-detect', async (req, res) => {
    try {
      const songs: string[] = req.body?.songs || [];
      if (!Array.isArray(songs) || songs.length === 0) {
        return res.status(400).json({ error: 'Se requiere un arreglo "songs" de canciones.' });
      }

      const limitedSongs = songs.slice(0, 10); // Limit to 10 in batch
      const results = await Promise.all(
        limitedSongs.map(async (song) => {
          try {
            return await detectSongGenre(song);
          } catch (e) {
            return {
              query: { raw: song, cleaned: song },
              matchFound: false,
              primaryGenre: 'Desconocido',
              error: e instanceof Error ? e.message : 'Error al procesar',
            };
          }
        })
      );

      return res.json({ results });
    } catch (err: unknown) {
      console.error('Error in /api/batch-detect:', err);
      return res.status(500).json({ error: 'Error en procesamiento por lotes.' });
    }
  });

  // Health check
  app.get('/api/health', (req, res) => {
    // Expose provider availability without revealing secret values.
    const providers = {
      itunes: true,
      musicBrainz: true,
      deezer: true,
      lastFm: Boolean(process.env.LASTFM_API_KEY),
      discogs: Boolean(process.env.DISCOGS_TOKEN),
      spotify: Boolean(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET),
      gemini: Boolean(process.env.GEMINI_API_KEY),
    };
    const requiredReady = providers.lastFm && providers.discogs && providers.spotify && providers.gemini;
    const missing = [
      ...(!providers.lastFm ? ['LASTFM_API_KEY'] : []),
      ...(!providers.discogs ? ['DISCOGS_TOKEN'] : []),
      ...(!providers.spotify ? ['SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET'] : []),
      ...(!providers.gemini ? ['GEMINI_API_KEY'] : []),
    ];
    res.status(requiredReady ? 200 : 503).json({
      status: requiredReady ? 'ok' : 'needs_configuration',
      service: 'SonoraGenre API',
      timestamp: new Date().toISOString(),
      providers,
      requiredProvidersReady: requiredReady,
      missingRequiredEnvironmentVariables: missing,
    });
  });

  // Vite middleware in dev or static files in production
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`🎵 SonoraGenre server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
