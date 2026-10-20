// Cliente del servicio local de Whisper para la EVALUACIÓN (no para el laboratorio).
//
// Reglas de esta integración:
//  - Solo se transcribe el audio de UNA sesión, y el archivo lo pone el servidor
//    (`uploads/sessions/<id>.audio.webm`); el cliente nunca elige la ruta.
//  - Se lee el archivo UNA vez, se envía y se libera: no se guardan copias.
//  - Límites explícitos: tamaño, timeout y concurrencia (cola corta). Si el servicio está
//    ocupado se devuelve BUSY en vez de bloquear la evaluación indefinidamente.
//  - Nunca lanza: devuelve `{ ok: false, code }` para que la evaluación pueda degradar a
//    "no verificado" sin romper el informe.
const fs = require('fs');

const DEFAULT_BASE_URL = 'http://127.0.0.1:8001';
const DEFAULT_MODEL = 'small';
const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_MAX_MB = 15;
const DEFAULT_MAX_CONCURRENCY = 1;
const DEFAULT_MAX_QUEUE = 2;

const intFromEnv = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

function configFromEnv() {
  const rawBase = String(process.env.WHISPER_URL || DEFAULT_BASE_URL).trim();
  let baseUrl = null;
  try {
    const url = new URL(rawBase);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      baseUrl = `${url.origin}${url.pathname}`.replace(/\/+$/, '');
    }
  } catch {
    baseUrl = null;
  }
  return {
    baseUrl,
    model: String(process.env.EVAL_WHISPER_MODEL || DEFAULT_MODEL).trim(),
    timeoutMs: intFromEnv('EVAL_WHISPER_TIMEOUT_MS', DEFAULT_TIMEOUT_MS),
    maxBytes: intFromEnv('EVAL_WHISPER_MAX_MB', DEFAULT_MAX_MB) * 1024 * 1024,
    maxConcurrency: intFromEnv('EVAL_WHISPER_CONCURRENCY', DEFAULT_MAX_CONCURRENCY),
    maxQueue: intFromEnv('EVAL_WHISPER_MAX_QUEUE', DEFAULT_MAX_QUEUE),
  };
}

// ------------------------------------------------------------------ cola

// Semáforo mínimo: como máximo `maxConcurrency` transcripciones a la vez y una cola corta.
// Sin esto, dos evaluaciones simultáneas se quedarían esperando al semáforo del servicio
// (WHISPER_MAX_CONCURRENCY=1) sin control y podrían agotar el timeout de la petición.
function createLimiter(maxConcurrency, maxQueue) {
  let active = 0;
  const waiting = [];

  const release = () => {
    active -= 1;
    const next = waiting.shift();
    if (next) next();
  };

  const acquire = () =>
    new Promise((resolve, reject) => {
      if (active < maxConcurrency) {
        active += 1;
        resolve(release);
        return;
      }
      if (waiting.length >= maxQueue) {
        reject(Object.assign(new Error('busy'), { code: 'BUSY' }));
        return;
      }
      waiting.push(() => {
        active += 1;
        resolve(release);
      });
    });

  return { acquire, stats: () => ({ active, waiting: waiting.length }) };
}

let limiter = createLimiter(DEFAULT_MAX_CONCURRENCY, DEFAULT_MAX_QUEUE);

function resetLimiter(options = configFromEnv()) {
  limiter = createLimiter(options.maxConcurrency || 1, options.maxQueue || 0);
}

// ---------------------------------------------------------------- petición

const fail = (code, extra = {}) => ({ ok: false, code, ...extra });

// Traduce la respuesta del servicio (o su ausencia) a un código estable y auditable.
function codeFromStatus(status) {
  if (status === 413) return 'HTTP_413';
  if (status === 422) return 'HTTP_422';
  if (status === 503) return 'HTTP_503';
  if (status === 400) return 'HTTP_400';
  return 'HTTP_ERROR';
}

async function transcribeFile(filePath, overrides = {}) {
  const config = { ...configFromEnv(), ...overrides };
  if (!config.baseUrl) return fail('NOT_CONFIGURED');

  let stat;
  try {
    stat = await fs.promises.stat(filePath);
  } catch {
    return fail('NO_AUDIO');
  }
  if (!stat.isFile() || stat.size === 0) return fail('NO_AUDIO');
  if (stat.size > config.maxBytes) return fail('TOO_LARGE', { bytes: stat.size, maxBytes: config.maxBytes });

  let release;
  try {
    release = await limiter.acquire();
  } catch {
    return fail('BUSY');
  }

  try {
    // Una sola lectura del archivo: se convierte en Blob y se envía tal cual.
    const buffer = await fs.promises.readFile(filePath);
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: 'audio/webm' }), 'sesion.webm');

    const url = `${config.baseUrl}/transcribe?model=${encodeURIComponent(config.model)}&word_timestamps=true`;
    let response;
    const started = Date.now();
    try {
      response = await (config.fetchImpl || fetch)(url, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch (error) {
      const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
      return fail(timedOut ? 'TIMEOUT' : 'SERVICE_DOWN', { ms: Date.now() - started });
    }

    const ms = Date.now() - started;
    if (!response.ok) return fail(codeFromStatus(response.status), { status: response.status, ms });

    let data = null;
    try {
      data = await response.json();
    } catch {
      return fail('BAD_RESPONSE', { ms });
    }
    if (!data || !Array.isArray(data.segments)) return fail('BAD_RESPONSE', { ms });

    return {
      ok: true,
      segments: data.segments,
      durationSeconds: Number.isFinite(Number(data.duration_seconds)) ? Number(data.duration_seconds) : null,
      modelKey: data.model_key ?? config.model,
      modelName: data.model ?? null,
      processingMs: Number.isFinite(Number(data.elapsed_ms)) ? Number(data.elapsed_ms) : null,
      rtf: Number.isFinite(Number(data.rtf)) ? Number(data.rtf) : null,
      audioBytes: stat.size,
      ms,
    };
  } catch (error) {
    return fail('READ_ERROR');
  } finally {
    release();
  }
}

module.exports = {
  DEFAULT_MODEL,
  DEFAULT_TIMEOUT_MS,
  codeFromStatus,
  configFromEnv,
  createLimiter,
  resetLimiter,
  transcribeFile,
};
