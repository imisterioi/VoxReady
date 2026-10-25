// Pruebas de los reintentos automáticos y la recuperación tras reinicios.
// Prisma en memoria, IA simulada y reloj inyectado: sin base de datos, sin red y sin esperas reales.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.EVAL_WHISPER_ENABLED = 'false'; // sin servicio de Whisper en estas pruebas
process.env.NVIDIA_API_KEY = 'test-key';
process.env.AI_EVAL_MODEL = 'test/modelo-a';
process.env.AI_EVAL_FALLBACK_MODEL = 'test/modelo-b';

const express = require('express');
const { createToken } = require('../auth');
const registerSessionRoutes = require('../routes/sessions');
const { matches, applyOps } = require('./support/prismaFake');
const { DEFAULT_CONFIG } = require('../ai/patternConfig');
const { limits, markAttemptFailed } = require('../lib/evaluationRetry');
const { evaluatorModels } = require('../lib/evaluatorModels');

const realFetch = global.fetch;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, { timeout = 5000, interval = 25 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(interval);
  }
  return false;
}

// Reloj simulado: el runner y el reclamo usan este `now`, así que las pausas de 3/15 minutos
// se prueban sin esperar de verdad.
function fakeClock(start = Date.now()) {
  const state = { t: start };
  return { now: () => state.t, advance: (ms) => { state.t += ms; }, set: (t) => { state.t = t; } };
}

const THEME = { id: 't1', title: 'Crisis', context: 'planta', keyMessages: '', redLines: '', optic: null, interviewConfig: { questionCount: 3, followUps: 0, estimatedMinutes: 5 } };
const USERS = { u1: { id: 'u1', name: 'Usuario u1', role: 'VOCERO', status: 'ACTIVE', tenantId: 'ten1', tenant: { status: 'ACTIVE' } } };
const TRANSCRIPT = [
  { question: '¿Qué ocurrió?', answer: 'Hubo un incidente y activamos el protocolo de inmediato.', metrics: { wpm: 130, fillers: 0, latencyMs: 900 } },
];
const METRICS = { voice: { available: false }, body: { available: false }, lighting: null, durationSeconds: 40 };

function sessionRow(overrides = {}) {
  return {
    id: 's1',
    userId: 'u1',
    themeId: 't1',
    tenantId: 'ten1',
    status: 'CREATED',
    createdAt: new Date(),
    completedAt: null,
    transcript: TRANSCRIPT,
    metrics: METRICS,
    report: null,
    score: null,
    review: null,
    evalAttempts: 0,
    evalNextAt: null,
    evalLeaseUntil: null,
    evalLastError: null,
    evalFinishedAt: null,
    evalExhausted: false,
    theme: THEME,
    user: { id: 'u1', name: 'Usuario u1' },
    tenant: { status: 'ACTIVE' },
    ...overrides,
  };
}

function createStore({ sessions = {} } = {}) {
  const rows = new Map(Object.entries(sessions));
  const clone = (value) => (value == null ? value : JSON.parse(JSON.stringify(value)));
  return {
    rows,
    session: {
      async findUnique({ where }) {
        return clone(rows.get(where.id) || null);
      },
      async findMany({ where, take } = {}) {
        const out = [...rows.values()].filter((row) => matches(row, where || {}));
        return clone(take ? out.slice(0, take) : out);
      },
      async update({ where, data }) {
        const row = rows.get(where.id);
        if (!row) throw new Error('sesion inexistente');
        Object.assign(row, applyOps(row, data));
        return clone(row);
      },
      async updateMany({ where, data }) {
        const row = rows.get(where.id);
        if (!row || !matches(row, where)) return { count: 0 };
        Object.assign(row, applyOps(row, data));
        return { count: 1 };
      },
      async delete({ where }) {
        rows.delete(where.id);
        return {};
      },
    },
    tenant: { async findMany() { return []; } },
    user: {
      async findUnique({ where }) {
        return clone(USERS[where.id] || null);
      },
      async findMany() {
        return clone(Object.values(USERS));
      },
    },
    voceroPatternOverride: { async findUnique() { return null; } },
    patternOverride: { async findUnique() { return null; } },
    masterPattern: { async findFirst() { return null; } },
  };
}

// Juicio válido construido con los criterios REALES de la configuración (nada inventado).
function judgement() {
  const coherencia = Object.fromEntries(Object.keys(DEFAULT_CONFIG.coherence.criteria).map((key) => [key, 80]));
  const empatia = Object.fromEntries(Object.keys(DEFAULT_CONFIG.empathy.criteria).map((key) => [key, 70]));
  return {
    coherencia,
    empatia,
    resumen: 'Buen desempeno.',
    cita: 'Cita de coach.',
    fortalezas: ['Claridad'],
    mejoras: ['Sintetizar'],
    mensajesClave: [],
    lineasRojas: [],
    porPregunta: [{ pregunta: 1, puntaje: 80, comentario: 'Correcta' }],
  };
}

// Intercepta SOLO las llamadas al proveedor de IA; el resto sigue al servidor local de pruebas.
function stubAI({ status = 200, body = null, calls = null } = {}) {
  global.fetch = async (url, options) => {
    if (!String(url).includes('integrate.api.nvidia.com')) return realFetch(url, options);
    if (calls) calls.value += 1;
    if (status !== 200) return new Response('{}', { status });
    const payload = body || { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(judgement()) } }] };
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

const restoreFetch = () => {
  global.fetch = realFetch;
};

// Servidor de pruebas con las rutas reales, el Prisma falso y el runner de recuperación.
async function withApp(store, run, { queue = {} } = {}) {
  const app = express();
  app.use(express.json());
  registerSessionRoutes(app, store, {
    // Transcripción inyectada: estas pruebas no usan audio real ni servicios externos.
    transcribe: async ({ turns = [] } = {}) => ({
      ok: true,
      answers: turns.map((turn) => turn.answer || 'respuesta'),
      enginesUsed: ['test'],
      diagnostics: [],
      model: 'test',
    }),
    evaluationQueue: { enabled: false, ...queue },
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address();
  const token = createToken({ id: 'u1', role: 'VOCERO' });
  const call = (path, { method = 'GET', body, auth = token } = {}) =>
    realFetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  try {
    return await run({ call, queue: app.locals.evaluationQueue, app });
  } finally {
    app.locals.evaluationQueue?.stop();
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

const evaluate = (call) => call('/api/sessions/s1/evaluate', { method: 'POST', body: { transcript: TRANSCRIPT, metrics: METRICS } });


test('una evaluación válida publica el informe una sola vez y limpia el reintento', async () => {
  const store = createStore({ sessions: { s1: sessionRow() } });
  const calls = { value: 0 };
  stubAI({ calls });
  try {
    await withApp(store, async ({ call }) => {
      const started = await evaluate(call);
      assert.equal(started.status, 202);
      assert.ok(await waitFor(() => store.rows.get('s1').status === 'COMPLETED'));

      const row = store.rows.get('s1');
      assert.ok(row.report, 'debe publicar el informe');
      assert.equal(typeof row.score, 'number');
      assert.equal(row.evalAttempts, 1);
      assert.equal(row.evalNextAt, null, 'sin reintentos pendientes');
      assert.equal(row.evalExhausted, false);
      assert.equal(calls.value, evaluatorModels().length, 'una sola carrera con los modelos configurados');

      // Una sesión ya publicada no se vuelve a evaluar (respuesta idempotente con el informe).
      const again = await evaluate(call);
      assert.equal(again.status, 200);
      const againBody = await again.json();
      assert.equal(againBody.evaluation.state, 'done');
      assert.equal(store.rows.get('s1').evalAttempts, 1);
    });
  } finally {
    restoreFetch();
  }
});

test('un fallo programa un reintento a 3 minutos y no duplica la ejecución', async () => {
  const store = createStore({ sessions: { s1: sessionRow() } });
  const clock = fakeClock();
  stubAI({ status: 500 });
  try {
    await withApp(store, async ({ call, queue }) => {
      await evaluate(call);
      assert.ok(await waitFor(() => store.rows.get('s1').status === 'FAILED'));

      const row = store.rows.get('s1');
      assert.equal(row.report, null);
      assert.equal(row.evalAttempts, 1);
      assert.equal(row.evalExhausted, false);
      const delay = new Date(row.evalNextAt).getTime() - new Date(row.evalFinishedAt).getTime();
      assert.equal(delay, limits().retryMs, 'espera normal de 3 minutos');

      // Antes del momento programado no hay ninguna solicitud activa ni intento nuevo.
      await queue.tick();
      assert.equal(store.rows.get('s1').evalAttempts, 1);
    }, { queue: { now: clock.now } });
  } finally {
    restoreFetch();
  }
});

test('cinco intentos fallidos activan la pausa de 15 minutos', async () => {
  const store = createStore({ sessions: { s1: sessionRow({ evalAttempts: 4 }) } });
  const clock = fakeClock();
  stubAI({ status: 500 });
  try {
    await withApp(store, async ({ call }) => {
      await evaluate(call); // consume el quinto intento
      assert.ok(await waitFor(() => store.rows.get('s1').status === 'FAILED'));

      const row = store.rows.get('s1');
      assert.equal(row.evalAttempts, 5);
      const delay = new Date(row.evalNextAt).getTime() - new Date(row.evalFinishedAt).getTime();
      assert.equal(delay, limits().batchPauseMs, 'la pausa de 15 minutos sustituye a los 3 minutos');
      assert.equal(row.evalExhausted, false);
    }, { queue: { now: clock.now } });
  } finally {
    restoreFetch();
  }
});

test('tras la pausa los intentos continúan automáticamente y publican el informe', async () => {
  const pauseMs = limits().batchPauseMs;
  const store = createStore({
    sessions: {
      s1: sessionRow({
        status: 'FAILED',
        evalAttempts: 5,
        evalFinishedAt: new Date(),
        evalNextAt: new Date(Date.now() + pauseMs),
        metrics: { ...METRICS, evaluation: { state: 'failed', stage: 'ai', error: 'AI_UNAVAILABLE' } },
      }),
    },
  });
  const clock = fakeClock(Date.now() + pauseMs + 1000); // la pausa ya venció
  const calls = { value: 0 };
  stubAI({ calls });
  try {
    await withApp(store, async ({ queue }) => {
      await queue.tick();
      assert.ok(await waitFor(() => store.rows.get('s1').status === 'COMPLETED'));
      const row = store.rows.get('s1');
      assert.equal(row.evalAttempts, 6, 'continúa desde el intento 6');
      assert.ok(row.report);
      assert.ok(calls.value >= 1);
    }, { queue: { now: clock.now } });
  } finally {
    restoreFetch();
  }
});


test('el contador persiste tras un reinicio y se reanuda un trabajo interrumpido', async () => {
  const store = createStore({
    sessions: {
      s1: sessionRow({
        status: 'EVALUATING',
        evalAttempts: 2,
        evalLeaseUntil: new Date(Date.now() - 60_000), // el proceso murió a mitad del intento
        evalFinishedAt: null,
        metrics: { ...METRICS, evaluation: { state: 'processing', stage: 'ai', startedAt: Date.now() - 120_000 } },
      }),
    },
  });
  stubAI({});
  try {
    // "Reinicio": instancia nueva sobre la MISMA base. El contador no se reinicia.
    await withApp(store, async ({ queue }) => {
      assert.equal(store.rows.get('s1').evalAttempts, 2, 'el contador persiste');
      await queue.tick();
      assert.ok(await waitFor(() => store.rows.get('s1').status === 'COMPLETED'));
      assert.equal(store.rows.get('s1').evalAttempts, 3, 'el intento recuperado cuenta uno más');
      assert.ok(store.rows.get('s1').report);
    });
  } finally {
    restoreFetch();
  }
});

test('una evaluación en curso no se duplica: lease vivo y POST idempotente', async () => {
  const store = createStore({
    sessions: {
      s1: sessionRow({
        status: 'EVALUATING',
        evalAttempts: 1,
        evalLeaseUntil: new Date(Date.now() + 60_000), // trabajo vivo en otra instancia
        metrics: { ...METRICS, evaluation: { state: 'processing', stage: 'ai', startedAt: Date.now() } },
      }),
    },
  });
  const calls = { value: 0 };
  stubAI({ calls });
  try {
    await withApp(store, async ({ call, queue }) => {
      await queue.tick();
      assert.equal(calls.value, 0, 'el runner no reclama un trabajo con lease vigente');
      assert.equal(store.rows.get('s1').evalAttempts, 1);

      const res = await evaluate(call);
      assert.equal(res.status, 202);
      const body = await res.json();
      assert.equal(body.evaluation.state, 'processing');
      assert.equal(store.rows.get('s1').evalAttempts, 1, 'no consume un intento extra');
    });
  } finally {
    restoreFetch();
  }
});

test('al llegar a 50 intentos la sesión queda agotada y no se reintenta más', async () => {
  const store = createStore({ sessions: { s1: sessionRow({ evalAttempts: 49 }) } });
  const clock = fakeClock();
  stubAI({ status: 500 });
  try {
    await withApp(store, async ({ call, queue }) => {
      await evaluate(call); // intento 50
      assert.ok(await waitFor(() => store.rows.get('s1').status === 'EXHAUSTED'));

      const row = store.rows.get('s1');
      assert.equal(row.evalAttempts, 50);
      assert.equal(row.evalExhausted, true);
      assert.equal(row.evalNextAt, null, 'no queda nada programado');
      assert.equal(row.report, null);

      // Distinguible de "completada" y de "informe disponible", sin detalles técnicos.
      const status = await call('/api/sessions/s1');
      const body = await status.json();
      assert.equal(body.evaluation.state, 'exhausted');
      assert.equal(body.evaluation.maxAttempts, 50);
      assert.equal(body.session.report, null);

      // Ni el runner ni una petición explícita vuelven a intentarlo.
      await queue.tick();
      assert.equal(store.rows.get('s1').evalAttempts, 50);
      const res = await evaluate(call);
      assert.equal(res.status, 202);
      assert.equal((await res.json()).evaluation.state, 'exhausted');
      assert.equal(store.rows.get('s1').evalAttempts, 50);
    }, { queue: { now: clock.now } });
  } finally {
    restoreFetch();
  }
});

test('un informe inválido nunca publica report, score ni COMPLETED y conserva la evidencia', async () => {
  const store = createStore({ sessions: { s1: sessionRow() } });
  // Estructura válida pero SIN los criterios obligatorios: validateJudgement la rechaza.
  const incomplete = { coherencia: { criterio_inexistente: 5 }, empatia: { criterio_inexistente: 5 } };
  stubAI({ body: { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(incomplete) } }] } });
  try {
    await withApp(store, async ({ call }) => {
      await evaluate(call);
      assert.ok(await waitFor(() => store.rows.get('s1').status === 'FAILED'));

      const row = store.rows.get('s1');
      assert.equal(row.report, null);
      assert.equal(row.score, null);
      assert.notEqual(row.status, 'COMPLETED');
      assert.equal(row.metrics.evaluation.error, 'INVALID_AI_RESPONSE');
      assert.ok(row.evalNextAt, 'se reprograma el intento');
      // Evidencias conservadas para volver a intentarlo sin repetir la entrevista.
      assert.equal(row.transcript.length, TRANSCRIPT.length);
      assert.ok(row.metrics.voice !== undefined);
    });
  } finally {
    restoreFetch();
  }
});

test('una sesión eliminada no deja trabajos huérfanos', async () => {
  const store = createStore({ sessions: { s1: sessionRow({ evalNextAt: new Date(Date.now() - 1000) }) } });
  const calls = { value: 0 };
  stubAI({ calls });
  try {
    await withApp(store, async ({ queue }) => {
      store.rows.delete('s1'); // eliminada según la política existente
      await queue.tick(); // no debe lanzar ni evaluar nada
      assert.equal(calls.value, 0);
      assert.equal(store.rows.size, 0);
    });
  } finally {
    restoreFetch();
  }
});

test('dos peticiones simultáneas a /evaluate no duplican la evaluación', async () => {
  const store = createStore({ sessions: { s1: sessionRow() } });
  const calls = { value: 0 };
  stubAI({ calls });
  try {
    await withApp(store, async ({ call }) => {
      const [a, b] = await Promise.all([evaluate(call), evaluate(call)]);
      // La segunda puede responder 202 (en curso) o 200 (ya publicada): lo importante es que no
      // se duplique el trabajo ni el contador.
      assert.ok([200, 202].includes(a.status), `estado inesperado: ${a.status}`);
      assert.ok([200, 202].includes(b.status), `estado inesperado: ${b.status}`);
      assert.ok(await waitFor(() => store.rows.get('s1').status === 'COMPLETED'));
      assert.equal(store.rows.get('s1').evalAttempts, 1, 'solo un intento');
      assert.equal(calls.value, evaluatorModels().length, 'una sola carrera con los modelos configurados');
    });
  } finally {
    restoreFetch();
  }
});


// ------------------------------------------- límites técnicos y clasificación del fallo

test('los límites no incluyen un presupuesto de evaluación de 60 s', () => {
  const l = limits({});
  assert.equal(l.attemptBudgetMs, undefined, 'el presupuesto fijo de 60 s ya no existe');
  // El lease se dimensiona con los límites reales: audio ≤120 s + generación (techo del transporte,
  // 300 s) + 60 s de margen. Antes eran 6 minutos fijos, que ya no cubren un intento completo.
  assert.equal(l.leaseMs, (120 + 300 + 60) * 1000, 'el lease cubre un intento completo (audio + generación)');
  assert.equal(limits({ AI_EVAL_TIMEOUT_MS: '900000' }).leaseMs, (120 + 900 + 60) * 1000, 'crece con el límite configurado');
  assert.equal(limits({ EVAL_RETRY_LEASE_MS: '120000' }).leaseMs, 120000, 'se puede fijar a mano');
  assert.equal(l.retryMs, 3 * 60 * 1000, 'espera normal de 3 minutos');
  assert.equal(l.batchPauseMs, 15 * 60 * 1000, 'pausa de 15 minutos cada cinco fallos');
  assert.equal(l.maxAttempts, 50, 'máximo de 50 intentos por sesión');
});

test('el fallo persistido queda clasificado como temporal', async () => {
  const store = createStore({ sessions: { s1: sessionRow({ evalAttempts: 1 }) } });
  const now = () => 1_700_000_000_000;
  const result = await markAttemptFailed(store, 's1', { error: 'AI_UNAVAILABLE', kind: 'transient', now, env: {} });
  assert.equal(result.kind, 'transient');
  const row = store.rows.get('s1');
  assert.equal(row.metrics.evaluation.errorKind, 'transient');
  assert.equal(row.metrics.evaluation.error, 'AI_UNAVAILABLE');
  assert.equal(row.evalLastError, 'AI_UNAVAILABLE');
  assert.equal(new Date(row.evalNextAt).getTime(), 1_700_000_000_000 + 3 * 60 * 1000);
});

test('un fallo permanente se registra como tal y NO programa reintentos automáticos', async () => {
  const store = createStore({ sessions: { s1: sessionRow({ evalAttempts: 1 }) } });
  const now = () => 1_700_000_000_000;
  const result = await markAttemptFailed(store, 's1', { error: 'AI_UNAVAILABLE', kind: 'permanent', now, env: {} });
  assert.equal(result.kind, 'permanent');
  const row = store.rows.get('s1');
  assert.equal(row.metrics.evaluation.errorKind, 'permanent');
  // Reintentar no arreglaría nada (credenciales, configuración, modelo inexistente): se detiene y
  // queda señalado para revisión técnica. La política de 3/15/50 sigue aplicando a los temporales.
  assert.equal(row.evalNextAt, null, 'un error permanente no genera reintentos inútiles');
  assert.equal(row.evalExhausted, false, 'no es «agotada por 50 intentos»: requiere corregir la causa');
  assert.equal(row.status, 'FAILED', 'la interfaz debe mostrar el estado real, no «puede llegar»');
  assert.equal(result.nextAt, null);
});

test('un intento que perdió el lease no puede marcar el fallo de otro intento', async () => {
  const store = createStore({ sessions: { s1: sessionRow({ evalLeaseUntil: new Date(2_000_000_000_000) }) } });
  const result = await markAttemptFailed(store, 's1', {
    error: 'AI_UNAVAILABLE',
    kind: 'transient',
    leaseUntil: 1_700_000_000_000, // lease de un intento anterior
    now: () => 1_700_000_000_000,
    env: {},
  });
  assert.equal(result.skipped, true);
  assert.equal(result.superseded, true);
  const row = store.rows.get('s1');
  assert.equal(row.evalLastError, null, 'el intento descartado no toca el estado');
  assert.equal(row.status, 'CREATED');
});

