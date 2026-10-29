// Cliente del laboratorio «En tiempo real»: estado del servicio y transcripción de un
// fragmento de audio.
//
// Contrato REAL verificado en backend/routes/lab.js y backend/whisper/server.py:
//   GET  /api/lab/health      -> { status, available, ms?, service: { model_loaded,
//                                 load_ms, default_model, models: { key: { key, model,
//                                 device, loaded, loading, load_ms, load_error, ... } },
//                                 config } | null, detail? }
//   POST /api/lab/transcribe?model=<key>  (cuerpo binario, Content-Type audio/wav)
//                             -> { status, text, segments, processingMs, modelLoadMs,
//                                  serviceTotalMs, modelKey, modelName, durationSeconds,
//                                  rtf, proxyMs, totalMs, audioBytes }
//                             -> error: { status: 'error', mensaje, proxyMs }
// Nunca se inventan campos: lo que el servidor no devuelve queda en `null`.

export const REALTIME_MODELS = [
  {
    key: 'base',
    label: 'Whisper Base',
    tone: 'neutral',
    description: 'El más rápido. Fragmentos de 6 s, texto provisional de una sola pieza.',
  },
  {
    key: 'small',
    label: 'Whisper Small',
    tone: 'accent',
    description: 'El más completo: cola controlada, estabilidad del texto, latencia y consolidación.',
  },
  {
    key: 'medium',
    label: 'Whisper Medium',
    tone: 'warning',
    description: 'El más preciso y el más lento: puede acumular retraso; la interfaz lo avisa.',
  },
];

const MODEL_STATE_LABEL = {
  loaded: 'Cargado',
  loading: 'Cargando',
  error: 'Error de carga',
  idle: 'Sin cargar',
  missing: 'No configurado',
  unknown: 'No informado',
};

// Estado de los tres modelos a partir de /api/lab/health. Si el servicio no informa
// `models`, el estado queda como «No informado» (no se supone que estén listos).
export function describeModelStatus(health) {
  const service = health?.service || null;
  const models = service?.models && typeof service.models === 'object' ? service.models : null;
  return REALTIME_MODELS.map((model) => {
    const info = models ? models[model.key] : null;
    let state = 'unknown';
    if (!models) state = 'unknown';
    else if (!info) state = 'missing';
    else if (info.load_error) state = 'error';
    else if (info.loaded) state = 'loaded';
    else if (info.loading) state = 'loading';
    else state = 'idle';

    return {
      ...model,
      state,
      stateLabel: MODEL_STATE_LABEL[state],
      loaded: info ? Boolean(info.loaded) : null,
      loadMs: info?.load_ms ?? null,
      loadError: info?.load_error ?? null,
      device: info?.device ?? null,
      modelName: info?.model ?? null,
      requests: info?.requests ?? null,
    };
  });
}

function messageForStatus(status, body) {
  const serverMessage = typeof body?.mensaje === 'string' ? body.mensaje : '';
  if (status === 403) return 'Tu rol no permite transcribir en el laboratorio (solo configurador maestro y administrador del sistema).';
  if (status === 503) return serverMessage || 'El servicio de transcripción no está disponible.';
  if (status === 504) return 'El servicio tardó demasiado en responder.';
  if (status === 415) return 'Formato de audio no admitido por el servidor.';
  return serverMessage || `El backend respondió con estado ${status}.`;
}

// Transcribe UN fragmento. Nunca lanza: devuelve { ok, text, ... } o { ok:false, error }.
// Los tiempos del servidor se devuelven tal cual, sin restarlos de relojes del navegador.
export async function transcribeChunk({
  blob,
  modelKey,
  apiUrl,
  token,
  fetchImpl = globalThis.fetch,
  timeoutMs = 120000,
  signal: externalSignal = null,
} = {}) {
  if (!blob || !blob.size) {
    return { ok: false, error: 'Fragmento de audio vacío: no se envió.' };
  }
  if (typeof fetchImpl !== 'function') {
    return { ok: false, error: 'Este navegador no permite enviar audio.' };
  }

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let detach = null;
  // La cancelación del usuario y el timeout se combinan en un solo AbortController.
  if (controller && externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else {
      const onAbort = () => controller.abort();
      externalSignal.addEventListener('abort', onAbort);
      detach = () => externalSignal.removeEventListener('abort', onAbort);
    }
  }
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  const started = Date.now();

  try {
    const query = modelKey ? `?model=${encodeURIComponent(modelKey)}` : '';
    const response = await fetchImpl(`${apiUrl}/api/lab/transcribe${query}`, {
      method: 'POST',
      headers: {
        'Content-Type': blob.type || 'audio/wav',
        Authorization: `Bearer ${token || ''}`,
      },
      body: blob,
      signal: controller?.signal,
    });

    const body = await response.json().catch(() => null);
    const clientMs = Date.now() - started;

    if (!response.ok) {
      return { ok: false, error: messageForStatus(response.status, body), status: response.status, clientMs };
    }
    if (!body || typeof body.text !== 'string') {
      return { ok: false, error: 'El servicio devolvió una respuesta inesperada.', status: response.status, clientMs };
    }

    return {
      ok: true,
      text: body.text,
      clientMs,
      processingMs: body.processingMs ?? null,
      loadMs: body.modelLoadMs ?? null,
      proxyMs: body.proxyMs ?? null,
      totalMs: body.totalMs ?? null,
      modelKey: body.modelKey ?? modelKey ?? null,
      modelName: body.modelName ?? null,
      durationSeconds: body.durationSeconds ?? null,
      rtf: body.rtf ?? null,
      audioBytes: body.audioBytes ?? null,
    };
  } catch (error) {
    const clientMs = Date.now() - started;
    if (error?.name === 'AbortError') {
      const cancelled = Boolean(externalSignal?.aborted);
      return {
        ok: false,
        cancelled,
        error: cancelled
          ? 'Petición cancelada por el usuario.'
          : 'El servidor no respondió a tiempo y la petición se canceló.',
        clientMs,
      };
    }
    return { ok: false, error: 'No se pudo contactar el backend con el fragmento de audio.', clientMs };
  } finally {
    if (timer) clearTimeout(timer);
    if (detach) detach();
  }
}
