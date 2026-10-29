// Comprobación anticipada de disponibilidad de los modelos EVALUADORES.
//
// QUÉ HACE
//  - Durante la entrevista (enganchada al precalentamiento y, como red de seguridad, al primer
//    turno) lanza en SEGUNDO PLANO una sonda pequeña por modelo evaluador.
//  - Guarda el resultado en memoria del proceso (modelo → disponible/no disponible, motivo, ms).
//  - La evaluación final usa ese resultado reciente para priorizar modelos disponibles y para no
//    ordenar los disponibles primero. El orden NO recorta ningún límite de tiempo: un modelo que
//    falló en la sonda se reintenta con el mismo trato que los demás.
//
// QUÉ NO HACE (límites explícitos)
//  - No bloquea nada: `preflight()` devuelve enseguida y nunca lanza; los llamadores no lo esperan.
//  - No evalúa transcripciones ni genera informes: la sonda es una petición mínima de contrato.
//  - No conoce sesiones ni usuarios: no recibe `sessionId` y no registra respuestas.
//  - No llama a `recordAi` (no es una evaluación real; no debe contarse como tal).
//  - No repite sondas: una sola tanda en vuelo y un intervalo mínimo entre tandas.
//  - No permite que una sonda antigua sobrescriba un resultado más reciente.
//
// El resultado es una AYUDA, no una garantía: un modelo disponible puede fallar después y un
// modelo que falló puede recuperarse (se reintenta en la evaluación final, con timeout acotado).
const { evaluatorModels } = require('./evaluatorModels');

const BASE_URL = 'https://integrate.api.nvidia.com/v1';
const PROBE_MAX_TOKENS = 1000; // petición pequeña: no es una evaluación real
const DEFAULT_PROBE_TIMEOUT_MS = 25000;
const DEFAULT_HEALTH_TTL_MS = 10 * 60 * 1000; // un resultado más viejo que esto no se usa para priorizar
const DEFAULT_MIN_INTERVAL_MS = 5 * 60 * 1000; // no sondear de nuevo antes de este intervalo

// Fallos que indican indisponibilidad real (HTTP 4xx/5xx, timeout o red).
const HARD_FAILURE = /^(HTTP_\d+|TIMEOUT|NETWORK|NO_KEY)$/;

const PROBE_MESSAGES = [
  { role: 'system', content: 'Responde SOLO con un objeto JSON valido, sin markdown.' },
  { role: 'user', content: 'Devuelve exactamente: {"coherencia":{"claridad":50},"empatia":{"escucha":50}}' },
];

function num(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function limits(env = process.env) {
  return {
    probeTimeoutMs: num(env.AI_EVAL_PROBE_TIMEOUT_MS, DEFAULT_PROBE_TIMEOUT_MS),
    ttlMs: num(env.AI_EVAL_HEALTH_TTL_MS, DEFAULT_HEALTH_TTL_MS),
    minIntervalMs: num(env.AI_EVAL_HEALTH_INTERVAL_MS, DEFAULT_MIN_INTERVAL_MS),
  };
}

// Estado en memoria del proceso (la evaluación final corre en este mismo proceso).
const state = {
  results: new Map(), // model -> { model, ok, reason, ms, at, startedAt }
  inflight: null,
  lastRunAt: 0,
  runs: 0,
};

function reset() {
  state.results.clear();
  state.inflight = null;
  state.lastRunAt = 0;
  state.runs = 0;
}

// Clasificación del resultado de una sonda (función pura: se prueba sin red).
function classifyProbe({ ok = false, status = null, finish = null, usable = false, errorName = null } = {}) {
  if (errorName === 'AbortError') return 'TIMEOUT';
  if (errorName) return 'NETWORK';
  if (!ok) return status ? `HTTP_${status}` : 'NETWORK';
  if (finish === 'length') return 'TRUNCATED';
  if (!usable) return 'NO_JSON';
  return 'OK';
}

const isHardFailure = (reason) => HARD_FAILURE.test(String(reason || ''));

// Una sonda: petición mínima con el MISMO contrato que exige el evaluador
// (`response_format: json_object` + objeto con `coherencia` y `empatia`).
// No imprime la clave, ni el prompt, ni el contenido de la respuesta.
async function probeModel(model, {
  fetchImpl = globalThis.fetch,
  apiKey = process.env.NVIDIA_API_KEY,
  baseUrl = BASE_URL,
  timeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
  maxTokens = PROBE_MAX_TOKENS,
  now = () => Date.now(),
} = {}) {
  const startedAt = now();
  if (!apiKey) return { model, ok: false, reason: 'NO_KEY', ms: 0, at: startedAt, startedAt };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: PROBE_MESSAGES,
        temperature: 0,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
      }),
    });
    const ms = now() - startedAt;
    if (!response?.ok) {
      return { model, ok: false, reason: classifyProbe({ ok: false, status: response?.status ?? null }), ms, at: now(), startedAt };
    }
    const data = await response.json().catch(() => null);
    const choice = data?.choices?.[0];
    const content = String(choice?.message?.content || '');
    let parsed = null;
    try {
      parsed = JSON.parse(content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1));
    } catch {
      parsed = null;
    }
    const usable = Boolean(parsed && parsed.coherencia && parsed.empatia);
    const reason = classifyProbe({ ok: true, finish: choice?.finish_reason ?? null, usable });
    return { model, ok: reason === 'OK', reason, ms: now() - startedAt, at: now(), startedAt };
  } catch (error) {
    return {
      model,
      ok: false,
      reason: classifyProbe({ errorName: error?.name || 'Error' }),
      ms: now() - startedAt,
      at: now(),
      startedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ¿Toca sondear? (sin tanda en vuelo y respetando el intervalo mínimo)
function shouldProbe({ now = () => Date.now(), env = process.env } = {}) {
  if (state.inflight) return false;
  // Sin clave configurada no hay sonda posible: no se intenta ninguna solicitud.
  if (!env.NVIDIA_API_KEY) return false;
  const { minIntervalMs } = limits(env);
  return now() - state.lastRunAt >= minIntervalMs;
}

// Tanda de sondas. Nunca lanza: cada modelo queda con su resultado.
async function runProbes({ models = evaluatorModels(), deps = {}, now = () => Date.now(), env = process.env } = {}) {
  const { probeTimeoutMs } = limits(env);
  const startedAt = now();
  // El intervalo se mide desde la última tanda MÁS RECIENTE (una tanda antigua no lo retrocede).
  state.lastRunAt = Math.max(state.lastRunAt, startedAt);
  state.runs += 1;
  // La clave se hereda del entorno recibido: así la sonda y su comprobación previa de clave usan
  // la MISMA configuración (evita sondear "sin clave" cuando el llamador pasó un entorno válido).
  const apiKey = deps.apiKey ?? env.NVIDIA_API_KEY;
  const results = await Promise.all(
    models.map((model) => probeModel(model, { ...deps, apiKey, timeoutMs: deps.timeoutMs || probeTimeoutMs, now })),
  );
  for (const result of results) {
    const previous = state.results.get(result.model);
    // Una sonda más antigua nunca sobrescribe una más reciente.
    if (previous && previous.startedAt > result.startedAt) continue;
    state.results.set(result.model, result);
  }
  return results;
}

// Comprobación anticipada. Devuelve enseguida (promesa) y no bloquea al llamador.
//  - `deduped`: ya había una tanda en vuelo (no se duplica).
//  - `skipped`: hay un resultado reciente (no se repite la sonda).
function preflight({ reason = 'manual', models = evaluatorModels(), deps = {}, now = () => Date.now(), env = process.env, force = false } = {}) {
  // Sin clave configurada no hay nada que sondear (y no se debe emitir ninguna solicitud).
  if (!deps.apiKey && !env.NVIDIA_API_KEY) {
    return Promise.resolve({ ok: false, skipped: true, reason: 'sin_clave', results: [] });
  }
  if (state.inflight) return state.inflight.then((results) => ({ ok: true, deduped: true, results }));
  if (!force && !shouldProbe({ now, env })) {
    return Promise.resolve({ ok: true, skipped: true, reason: 'reciente', results: snapshotArray({ now, env }) });
  }
  const promise = runProbes({ models, deps, now, env })
    .then((results) => {
      const summary = results.map((item) => `${item.model}:${item.ok ? 'ok' : item.reason}(${item.ms}ms)`).join(' ');
      // Registro técnico (solo backend): motivo y milisegundos, nunca contenido ni claves.
      console.log('[IA evaluadora] disponibilidad', JSON.stringify({ reason, models: summary }));
      return { ok: true, results };
    })
    .catch((error) => {
      console.error('[IA evaluadora] la comprobación de disponibilidad falló:', error?.message);
      return { ok: false, results: [] };
    })
    .finally(() => {
      state.inflight = null;
    });
  state.inflight = promise;
  return promise;
}

function snapshotArray({ now = () => Date.now(), env = process.env } = {}) {
  const { ttlMs } = limits(env);
  return [...state.results.values()].map((item) => ({
    ...item,
    fresh: now() - item.at <= ttlMs,
    hardFailure: isHardFailure(item.reason),
  }));
}

function healthSnapshot(options = {}) {
  const out = {};
  for (const item of snapshotArray(options)) out[item.model] = item;
  return out;
}

// Prioriza los modelos disponibles: disponibles → desconocidos/antiguos → con fallo.
// El orden dentro de cada grupo es el orden configurado (orden estable).
function orderByHealth(models = [], options = {}) {
  const health = healthSnapshot(options);
  const rank = (model) => {
    const item = health[model];
    if (!item || !item.fresh) return 1;
    return item.ok ? 0 : 2;
  };
  return models
    .map((model, index) => ({ model, index, rank: rank(model) }))
    .sort((a, b) => (a.rank - b.rank) || (a.index - b.index))
    .map((item) => item.model);
}

// La salud solo se usa para ORDENAR los modelos: nunca recorta la generación de ninguno.

module.exports = {
  BASE_URL,
  PROBE_MAX_TOKENS,
  limits,
  classifyProbe,
  isHardFailure,
  probeModel,
  preflight,
  shouldProbe,
  healthSnapshot,
  orderByHealth,
  reset,
  _state: state,
};
