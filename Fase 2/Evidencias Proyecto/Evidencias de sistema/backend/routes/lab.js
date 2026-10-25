// Laboratorio de transcripción (EXPERIMENTAL) — proxy hacia el servicio local de Whisper.
//
//   GET  /api/lab/health      → disponibilidad del servicio Whisper                [master, system]
//   POST /api/lab/transcribe  → reenvía el audio al servicio Whisper y devuelve    [master, system]
//                               la transcripción, los segmentos y los tiempos
//
// Reglas de esta integración:
//  - El destino del servicio NO lo elige el usuario: se configura con WHISPER_URL.
//  - El audio NO se guarda en disco ni en uploads/sessions: se reenvía en memoria.
//  - No crea ni modifica sesiones, informes, métricas ni evaluaciones oficiales.
//  - Los mensajes de error no exponen rutas, claves ni detalles internos.
const { requireAuth } = require('../auth');

const DEFAULT_WHISPER_URL = 'http://127.0.0.1:8001';
const DEFAULT_MAX_MB = 25;
// 5 min: Base tarda unos segundos por minuto de audio, pero Medium en CPU int8 (beam 5)
// puede multiplicar por ~8 el tiempo real; el laboratorio avisa con un 504 si se agota.
const DEFAULT_TIMEOUT_MS = 300000;
const HEALTH_TIMEOUT_MS = 4000;

// Tipos aceptados desde el navegador (audio del laboratorio y archivos subidos a mano)
const ALLOWED_TYPES = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/flac': 'flac',
  'video/webm': 'webm', // algunos navegadores etiquetan así el audio de MediaRecorder
  'application/octet-stream': 'webm',
};

// Clave de modelo que puede pedir el laboratorio (evita construir URLs con texto
// libre): el servicio valida además que exista y responde 400 si no la conoce.
const MODEL_KEY_RE = /^[a-z0-9._-]{1,40}$/;

const MAX_MB = Number(process.env.LAB_TRANSCRIBE_MAX_MB) || DEFAULT_MAX_MB;
const TIMEOUT_MS = Number(process.env.LAB_TRANSCRIBE_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;

// Normaliza WHISPER_URL y descarta cualquier valor que no sea http(s) válido
function serviceBase() {
  const raw = String(process.env.WHISPER_URL || DEFAULT_WHISPER_URL).trim();
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const base = `${url.origin}${url.pathname}`.replace(/\/+$/, '');
    return base || null;
  } catch {
    return null;
  }
}

// Lee el cuerpo binario con tope de tamaño (nunca escribe en disco)
function readBody(req, limitBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let settled = false;
    req.on('data', (chunk) => {
      if (settled) return;
      total += chunk.length;
      if (total > limitBytes) {
        settled = true;
        req.resume(); // se descarta el resto para no dejar la conexión colgada
        reject(Object.assign(new Error('too_large'), { code: 'TOO_LARGE' }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!settled) {
        settled = true;
        resolve(Buffer.concat(chunks));
      }
    });
    req.on('error', (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    req.on('aborted', () => {
      if (!settled) {
        settled = true;
        reject(Object.assign(new Error('aborted'), { code: 'ABORTED' }));
      }
    });
  });
}

module.exports = function registerLabRoutes(app, prisma) {
  const auth = (...roles) => requireAuth(prisma, roles);
  const LAB_ROLES = ['master', 'system']; // mismo criterio que el resto de herramientas del laboratorio

  // ---------------------------------------------------------------- Disponibilidad
  app.get('/api/lab/health', auth(...LAB_ROLES), async (req, res) => {
    const base = serviceBase();
    if (!base) {
      return res.json({
        status: 'ok',
        available: false,
        detail: 'WHISPER_URL no está configurada con una dirección http(s) válida.',
      });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    const started = Date.now();
    try {
      const response = await fetch(`${base}/health`, { signal: controller.signal });
      const body = await response.json().catch(() => null);
      res.json({
        status: 'ok',
        available: response.ok,
        ms: Date.now() - started,
        // Solo los campos que el laboratorio necesita mostrar
        service: body
          ? {
              status: body.status ?? null,
              model_loaded: Boolean(body.model_loaded),
              load_ms: body.load_ms ?? null,
              load_error: body.load_error ?? null,
              config: body.config ?? null,
              // Modelo por defecto y estado de CADA modelo (base y small): el laboratorio
              // muestra cuál está listo antes de transcribir.
              default_model: body.default_model ?? null,
              models: body.models ?? null,
            }
          : null,
      });
    } catch (error) {
      res.json({
        status: 'ok',
        available: false,
        ms: Date.now() - started,
        detail:
          error.name === 'AbortError'
            ? 'El servicio de transcripción no respondió a tiempo.'
            : 'No se pudo contactar el servicio de transcripción local.',
      });
    } finally {
      clearTimeout(timer);
    }
  });

  // ---------------------------------------------------------------- Transcripción
  app.post('/api/lab/transcribe', auth(...LAB_ROLES), async (req, res) => {
    const base = serviceBase();
    if (!base) {
      return res.status(503).json({
        status: 'error',
        mensaje: 'El laboratorio no tiene configurado el servicio de transcripción.',
      });
    }

    // Modelo pedido por el laboratorio (opcional). Sin parámetro, el servicio usa su
    // modelo por defecto: el comportamiento de Whisper Base no cambia.
    const requestedModel = String(req.query?.model || '').trim().toLowerCase();
    if (requestedModel && !MODEL_KEY_RE.test(requestedModel)) {
      return res.status(400).json({
        status: 'error',
        mensaje: 'Identificador de modelo no válido.',
      });
    }

    const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const extension = ALLOWED_TYPES[contentType];
    if (!extension) {
      return res.status(415).json({
        status: 'error',
        mensaje: 'Formato de audio no admitido. Usa WebM/Opus, WAV, MP3, OGG, M4A o FLAC.',
      });
    }

    let audio;
    try {
      audio = await readBody(req, Math.round(MAX_MB * 1024 * 1024));
    } catch (error) {
      if (error.code === 'TOO_LARGE') {
        return res.status(413).json({
          status: 'error',
          mensaje: `El audio supera el máximo de ${MAX_MB} MB para el laboratorio.`,
        });
      }
      return res.status(400).json({ status: 'error', mensaje: 'No se pudo leer el audio enviado.' });
    }

    if (!audio.length) {
      return res.status(400).json({ status: 'error', mensaje: 'El audio llegó vacío.' });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    // Si el navegador corta la petición (cancelar sesión), se aborta también el trabajo
    // upstream: así el fragmento no sigue ocupando el único slot del servicio y no se
    // acumulan peticiones fantasma en la cola. Al responder normalmente, `res` ya está
    // cerrado y el aborto es inofensivo.
    const onClientClose = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.on('close', onClientClose);
    const started = Date.now();
    try {
      // Nombre fijo y seguro: no se usa el nombre que envíe el cliente
      const form = new FormData();
      form.append('file', new Blob([audio], { type: contentType }), `lab-audio.${extension}`);

      const query = requestedModel ? `?model=${encodeURIComponent(requestedModel)}` : '';
      const response = await fetch(`${base}/transcribe${query}`, {
        method: 'POST',
        body: form,
        signal: controller.signal,
      });
      const proxyMs = Date.now() - started;

      if (!response.ok) {
        // Se traduce el error del servicio a un mensaje propio, sin filtrar detalles internos.
        // EXCEPCIÓN: el propio servicio Whisper devuelve `detail` con texto corto y
        // controlado (nunca rutas, claves ni trazas) que distingue "audio ilegible" de
        // "fallo interno del servicio". Se reenvía para no repetir el diagnóstico
        // equivocado que provocó la incompatibilidad PyAV 19 / faster-whisper 1.2.1.
        // Si `detail` no es una cadena corta (p. ej. el array de FastAPI), se ignora.
        const body = await response.json().catch(() => null);
        const rawDetail = typeof body?.detail === 'string' ? body.detail.replace(/\s+/g, ' ').trim() : '';
        const serviceDetail = rawDetail && rawDetail.length <= 300 ? rawDetail : '';
        const status = [400, 413, 422, 503].includes(response.status) ? response.status : 502;
        // `serviceDetail` tiene prioridad: es texto corto y controlado del propio servicio
        // y distingue "audio ilegible", "modelo no disponible" o "modelo no válido" de un
        // fallo interno. Si no viene, se usa el mensaje genérico de siempre.
        const mensaje =
          serviceDetail ||
          (response.status === 413
            ? 'El audio es demasiado largo o pesado para el servicio de transcripción.'
            : response.status === 422
              ? 'El servicio no pudo decodificar el audio.'
              : response.status === 503
                ? 'El servicio de transcripción está levantado pero el modelo no está cargado.'
                : 'El servicio de transcripción devolvió un error.');
        return res.status(status).json({ status: 'error', mensaje, proxyMs });
      }

      const data = await response.json().catch(() => null);
      if (!data || typeof data.text !== 'string') {
        return res.status(502).json({
          status: 'error',
          mensaje: 'El servicio de transcripción devolvió una respuesta inesperada.',
          proxyMs,
        });
      }

      return res.json({
        status: 'ok',
        text: data.text,
        segments: Array.isArray(data.segments) ? data.segments : [],
        language: data.language ?? null,
        languageProbability: data.language_probability ?? null,
        durationSeconds: data.duration_seconds ?? null,
        // Duración que el filtro de voz conservó (evidencia de que el VAD no recortó).
        durationAfterVad: data.duration_after_vad ?? null,
        rtf: data.rtf ?? null,
        // `processingMs` es SOLO inferencia; la carga del modelo se informa aparte para
        // no confundir el arranque del modelo con el tiempo de transcripción.
        processingMs: data.elapsed_ms ?? null,
        modelLoadMs: data.model_load_ms ?? null,
        serviceTotalMs: data.total_ms ?? null,
        modelKey: data.model_key ?? null,
        modelName: data.model ?? null,
        proxyMs,
        totalMs: Date.now() - started,
        audioBytes: audio.length,
        config: data.config ?? null,
      });
    } catch (error) {
      if (error.name === 'AbortError') {
        return res.status(504).json({
          status: 'error',
          mensaje: `El servicio de transcripción tardó más de ${Math.round(TIMEOUT_MS / 1000)} s.`,
          proxyMs: Date.now() - started,
        });
      }
      return res.status(503).json({
        status: 'error',
        mensaje: 'No se pudo contactar el servicio de transcripción local. ¿Está iniciado?',
        proxyMs: Date.now() - started,
      });
    } finally {
      res.off('close', onClientClose);
      clearTimeout(timer);
    }
  });
};

