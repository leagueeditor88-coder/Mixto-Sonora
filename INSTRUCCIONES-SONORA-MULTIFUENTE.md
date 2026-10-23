# Mixto-Sonora: activar búsqueda musical multi-fuente

Esta actualización corrige tres cosas: identificación contextual del título, evita guardar `Música Latina & Variada` como género final cuando no hay evidencia, y hace obligatorio el backend multi-fuente y Gemini, sin respaldos silenciosos que oculten la ausencia de fuentes.

## Archivos reemplazados

Copia estos archivos respetando exactamente sus rutas:

1. `.github/workflows/build.yml`
2. `Sonora-main/src/App.tsx`
3. `Sonora-main/src/server/genreService.ts`
4. `Sonora-main/src/services/genreClient.ts`
5. `Sonora-main/src/utils/musicLogic.ts`
6. `Sonora-main/src/utils/musicLogic.test.ts`
7. `Sonora-main/server.ts`
8. `mixto-Sonora/app/build.gradle.kts`
9. `mixto-Sonora/app/src/main/java/com/example/automix/SonoraNativeClassifier.kt`
10. `mixto-Sonora/app/src/main/java/com/example/automix/GenreIdentificationWorker.kt`

También se actualizan `Sonora-main/.env.example` y `SONORA_FUENTES_Y_CONFIGURACION.txt` para documentar que las credenciales son obligatorias.

## Paso 1: desplegar el backend

El ZIP incluye `render.yaml` en la raíz. En Render, crea/despliega el servicio web usando ese Blueprint y el repositorio. El servicio ejecuta el servidor de `Sonora-main`.

El backend consulta iTunes, MusicBrainz y Deezer sin credenciales propias. La clasificación refinada requiere que estén configuradas **todas** las credenciales siguientes. Si falta alguna, el backend rechazará la clasificación en lugar de fingir que se consultaron todas las fuentes:

- `LASTFM_API_KEY` — etiquetas comunitarias de canciones.
- `DISCOGS_TOKEN` — géneros/estilos del lanzamiento.
- `SPOTIFY_CLIENT_ID` y `SPOTIFY_CLIENT_SECRET` — metadatos de género del artista, como evidencia secundaria.
- `GEMINI_API_KEY` — refinamiento final basado en los metadatos y etiquetas recuperados; no es análisis directo del audio.

Configura las cuatro credenciales/pares en Render → servicio → Environment. iTunes, MusicBrainz y Deezer se consultan sin estas claves. Una fuente puede no encontrar etiquetas para una canción, pero Gemini debe recibir las evidencias que sí existan y la API debe estar correctamente configurada.

No pongas estas claves dentro del APK ni en el código fuente.

Al terminar el despliegue, abre `https://TU-SERVICIO.onrender.com/api/health`. Debe devolver `status: "ok"`, `requiredProvidersReady: true` y un objeto `providers` con todas las fuentes requeridas en `true`. Si devuelve HTTP 503 y `needs_configuration`, revisa `missingRequiredEnvironmentVariables`. Usa la URL HTTPS real que te asigne Render; no añadas `/api` al final de la variable.

## Paso 2: conectar el APK y la web al backend

En GitHub abre el repositorio → **Settings → Secrets and variables → Actions → Variables → New repository variable**.

Crea esta variable:

- Name: `SONORA_API_URL`
- Value: la URL HTTPS base del servicio Render, por ejemplo `https://tu-servicio.onrender.com` (usa la URL real asignada a tu servicio).

El flujo de GitHub Actions utiliza esa variable tanto para el frontend web como para el clasificador nativo de la biblioteca Android.

## Paso 3: reconstruir el APK

Sube/commitea los archivos reemplazados, configura primero las credenciales en Render y la variable `SONORA_API_URL` en GitHub, y ejecuta **Actions → Compilar Mixto-Sonora APK → Run workflow**. El clasificador nativo cambió a `sonora-embedded-v2`, así que la biblioteca volverá a clasificar canciones que estaban guardadas con la versión anterior.

## Qué esperar

- Si el backend responde y todas las credenciales obligatorias están configuradas, la biblioteca usa las fuentes reales que devuelva Sonora y guarda sus nombres en `sourceDetail`.
- Si el backend no está configurado, falta una clave o falla Gemini, la clasificación devuelve un error explícito; no se presenta como una clasificación refinada ni se oculta el fallo detrás de un resultado local/iTunes. La web y la biblioteca Android ya no recurren silenciosamente a iTunes o reglas locales.
- Un resultado genérico no se convierte mágicamente en un subgénero específico: hacen falta etiquetas o metadatos que lo respalden.
