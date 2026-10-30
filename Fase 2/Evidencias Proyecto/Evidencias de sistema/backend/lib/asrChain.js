// Cadena de respaldo ASR: Whisper Large v3 (NVIDIA) → Canary 1B (NVIDIA) → Whisper Small local.
//
// Cada ventana de respuesta se transcribe de forma independiente y con el MISMO fragmento.
// Se pasa al siguiente motor sólo si el anterior no devolvió texto utilizable (nunca por
// «calidad»). Cada motor tiene su propio límite de tiempo y la cadena entera tiene un
// presupuesto: cuando ya no queda tiempo suficiente no se inicia otro motor.
const { runAsr } = require('./nvidiaAsr');
const { transcribeWindowLocal } = require('./localWhisperWindow');
const { asrLanguage } = require('./language');
// Códigos que indican que el proveedor no está operativo (no un fallo puntual del audio).
const SYSTEMIC_CODES = new Set(['NO_KEY', 'PYTHON_MISSING', 'CLIENT_MISSING', 'SPAWN_ERROR', 'TIMEOUT']);

const envMs = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

// Límites por INTENTO, incluida la comunicación completa con el servicio.
const DEFAULT_TIMEOUTS = {
  'nvidia-whisper-large-v3': envMs('ASR_WHISPER_TIMEOUT_MS', 10000),
  'nvidia-canary-1b': envMs('ASR_CANARY_TIMEOUT_MS', 10000),
  'local-whisper-small': envMs('ASR_LOCAL_TIMEOUT_MS', 30000),
};

// Presupuesto por respuesta. 10 + 10 + 30 = 50 s en el peor caso teórico; 45 s evita que
// el usuario espere el máximo absoluto y aún deja ~25 s al motor local si los dos NVIDIA
// agotan su límite.
const DEFAULT_BUDGET_MS = envMs('ASR_CHAIN_BUDGET_MS', 45000);

// Motores de la cadena. Cada uno declara con qué clave del registro resuelve su idioma (`asr`) y
// SOLO se incluye si ese motor ADMITE el idioma de la sesión. Un motor incompatible se descarta:
// nunca se le envía el código de otro idioma ni se le hace «caer» al idioma predeterminado.
function defaultEngines({ language = 'multi', runAsrImpl = runAsr, localImpl = transcribeWindowLocal } = {}) {
  const definitions = [
    {
      id: 'nvidia-whisper-large-v3',
      asr: 'iso',
      timeoutMs: DEFAULT_TIMEOUTS['nvidia-whisper-large-v3'],
      transcribe: (window, { timeoutMs }) =>
        runAsrImpl({ modelKey: 'whisper-large-v3', language: asrLanguage(language, 'iso'), timeoutMs, ...window }),
    },
    {
      id: 'nvidia-canary-1b',
      asr: 'canary',
      timeoutMs: DEFAULT_TIMEOUTS['nvidia-canary-1b'],
      // Canary tiene su propio function-id y usa un locale (ver `asr.canary` en lib/language.js).
      transcribe: (window, { timeoutMs }) =>
        runAsrImpl({ modelKey: 'canary-1b-asr', language: asrLanguage(language, 'canary'), timeoutMs, ...window }),
    },
    {
      id: 'local-whisper-small',
      asr: 'iso',
      timeoutMs: DEFAULT_TIMEOUTS['local-whisper-small'],
      transcribe: (window, { timeoutMs }) => localImpl({ ...window, language: asrLanguage(language, 'iso'), timeoutMs }),
    },
  ];
  return definitions.filter((engine) => asrLanguage(language, engine.asr) !== null).map(({ asr, ...engine }) => engine);
}

// Devuelve { ok, text, engine, attempts, totalMs } o { ok:false, code, attempts, totalMs }.
// Los motores arrancan EN PARALELO; la PRIORIDAD decide qué texto gana, no quién termina
// antes. `down` se comparte entre respuestas de la misma sesión.
async function transcribeWindow({
  window,
  engines,
  down = new Set(),
  budgetMs = DEFAULT_BUDGET_MS,
  now = () => Date.now(),
} = {}) {
  const startedAt = now();
  const deadline = startedAt + Math.max(0, budgetMs);
  const attempts = [];
  const controllers = new Map();

  // Ningún motor admite el idioma de la sesión: se informa del motivo en vez de transcribir con
  // otro idioma (y no se intenta nada más, porque reintentar no cambiaría el resultado).
  if (!engines.length) {
    return { ok: false, code: 'LANGUAGE_UNSUPPORTED', attempts: [], totalMs: 0 };
  }

  // Sin presupuesto no se lanza ningún motor (arrancar y abortar sería trabajo inútil).
  if (!(budgetMs > 0)) {
    return {
      ok: false,
      code: 'BUDGET_EXHAUSTED',
      attempts: engines.map((engine) => ({ engine: engine.id, skipped: 'BUDGET_EXHAUSTED' })),
      totalMs: 0,
    };
  }

  const runnable = [];
  for (const engine of engines) {
    if (down.has(engine.id)) {
      attempts.push({ engine: engine.id, skipped: 'PROVIDER_DOWN' });
      continue;
    }
    const controller = new AbortController();
    controllers.set(engine.id, controller);
    const attemptStart = now();
    const limit = Math.min(engine.timeoutMs || budgetMs, Math.max(0, deadline - attemptStart));
    const task = Promise.resolve()
      .then(() => engine.transcribe(window, { timeoutMs: limit, signal: controller.signal }))
      .then((result) => ({ engine, result, ms: now() - attemptStart }))
      .catch((error) => ({
        engine,
        result: { ok: false, code: 'ENGINE_ERROR', message: error?.message },
        ms: now() - attemptStart,
      }));
    runnable.push({ engine, task, controller });
  }

  // Selección por prioridad: se espera al motor de turno; los demás ya están trabajando.
  for (const { engine, task, controller } of runnable) {
    const remaining = deadline - now();
    if (remaining <= 0) {
      for (const item of runnable) item.controller.abort();
      attempts.push({ engine: engine.id, skipped: 'BUDGET_EXHAUSTED' });
      return { ok: false, code: 'BUDGET_EXHAUSTED', attempts, totalMs: now() - startedAt };
    }

    const outcome = await new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      // El temporizador se limpia siempre: si no, node --test se queda esperando.
      const timer = setTimeout(() => finish({ timedOut: true }), remaining);
      task.then(finish, () => finish({ timedOut: true }));
    });
    if (outcome?.timedOut) {
      controller.abort();
      attempts.push({ engine: engine.id, ok: false, code: 'TIMEOUT', ms: now() - startedAt });
      for (const item of runnable) item.controller.abort();
      return { ok: false, code: 'BUDGET_EXHAUSTED', attempts, totalMs: now() - startedAt };
    }

    const { result, ms } = outcome;
    const text = String(result?.text ?? '').trim();
    if (result?.ok && text) {
      attempts.push({ engine: engine.id, ok: true, ms });
      // Los demás ya no son necesarios: se abortan y sus resultados tardíos se ignoran.
      for (const item of runnable) {
        if (item.engine.id !== engine.id) item.controller.abort();
      }
      return { ok: true, text, engine: engine.id, attempts, totalMs: now() - startedAt };
    }

    const code = result?.code || 'EMPTY_TRANSCRIPT';
    attempts.push({ engine: engine.id, ok: false, code, ms });
    if (SYSTEMIC_CODES.has(code)) down.add(engine.id);
  }

  return { ok: false, code: 'ALL_ENGINES_FAILED', attempts, totalMs: now() - startedAt };
}

// Motores a pasar a `transcribeAnswers` segun el interruptor operativo `EVAL_NVIDIA_ASR_ENABLED`:
//  - `false`  → SOLO el respaldo local (los motores NVIDIA quedan desactivados);
//  - cualquier otro valor (incluido ausente) → `undefined`, que hace que `transcribeAnswers`
//    construya su cadena por defecto (y así sigue funcionando la inyección de pruebas).
// Una única definición para la evaluación y para la transcripción por respuesta del entrevistador.
function enginesForEnv({ language = 'multi' } = {}) {
  const disabled = String(process.env.EVAL_NVIDIA_ASR_ENABLED ?? '').trim().toLowerCase() === 'false';
  if (!disabled) return undefined;
  // Solo el respaldo local, y solo si ADMITE el idioma de la sesión: si no, la cadena queda vacía y
  // `transcribeWindow` responde LANGUAGE_UNSUPPORTED en lugar de transcribir en otro idioma.
  return defaultEngines({ language }).filter((engine) => engine.id === 'local-whisper-small');
}

module.exports = { transcribeWindow, defaultEngines, enginesForEnv, SYSTEMIC_CODES, DEFAULT_TIMEOUTS, DEFAULT_BUDGET_MS };

