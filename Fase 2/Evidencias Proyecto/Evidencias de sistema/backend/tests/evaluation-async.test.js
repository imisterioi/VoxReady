// Pruebas del flujo ASÍNCRONO de evaluación y de la exclusión del WPM no verificado.
// Usan un Prisma en memoria y una IA simulada: sin base de datos, sin red externa, sin
// servicio de Whisper (se desactiva a propósito en este archivo).
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.EVAL_WHISPER_ENABLED = 'false'; // aquí se prueba el camino "sin audio"
process.env.NVIDIA_API_KEY = 'test-key';
process.env.AI_EVAL_MODEL = 'test/modelo-a';
process.env.AI_EVAL_FALLBACK_MODEL = 'test/modelo-b';

const express = require('express');
const { createToken } = require('../auth');
const registerSessionRoutes = require('../routes/sessions');
const { DEFAULT_CONFIG } = require('../ai/patternConfig');

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

// ---------------------------------------------------------------- datos

const theme = () => ({
  id: 't1',
  title: 'Accidente',
  context: 'Accidente en una planta.',
  optic: 'Institucional',
  keyMessages: JSON.stringify(['Colaboramos con la autoridad']),
  redLines: JSON.stringify(['No especular']),
  interviewConfig: { aggressiveness: 'MEDIA', questionCount: 2, followUps: 0 },
});

const user = (id) => ({
  id,
  name: `Usuario ${id}`,
  role: 'VOCERO',
  status: 'ACTIVE',
  tenant: { status: 'ACTIVE', name: 'Org' },
});

function sessionRow(overrides = {}) {
  return {
    id: 's1',
    userId: 'u1',
    status: 'CREATED',
    createdAt: new Date(),
    completedAt: null,
    tenantId: 't1',
    themeId: 't1',
    transcript: null,
    metrics: null,
    report: null,
    score: null,
    review: null,
    theme: theme(),
    user: { id: 'u1', name: 'Usuario u1' },
    tenant: { status: 'ACTIVE' },
    ...overrides,
  };
}

// Prisma mínimo en memoria con las operaciones que usan las rutas.
function createStore({ sessions = {}, users = {} } = {}) {
  const rows = new Map(Object.entries(sessions));
  const clone = (value) => (value == null ? value : JSON.parse(JSON.stringify(value)));
  return {
    rows,
    user: {
      async findUnique({ where }) {
        return users[where.id] || null;
      },
      async findMany() {
        return [];
      },
    },
    session: {
      async findUnique({ where }) {
        return clone(rows.get(where.id) || null);
      },
      async findMany() {
        return [];
      },
      async update({ where, data }) {
        const row = rows.get(where.id);
        if (!row) throw new Error('sesión inexistente');
        Object.assign(row, data);
        return clone(row);
      },
      // CAS: solo actualiza si el estado sigue siendo el que se leyó.
      async updateMany({ where, data }) {
        const row = rows.get(where.id);
        if (!row) return { count: 0 };
        if ('status' in where && row.status !== where.status) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
      async delete({ where }) {
        rows.delete(where.id);
        return {};
      },
    },
    tenant: { async findMany() { return []; } },
    voceroPatternOverride: { async findUnique() { return null; } },
    patternOverride: { async findUnique() { return null; } },
    masterPattern: { async findFirst() { return null; } },
  };
}

// Respuesta válida de la IA (mismas claves de criterio que la configuración real).
function judgement() {
  const coherencia = Object.fromEntries(Object.keys(DEFAULT_CONFIG.coherence.criteria).map((key) => [key, 80]));
  const empatia = Object.fromEntries(Object.keys(DEFAULT_CONFIG.empathy.criteria).map((key) => [key, 70]));
  return {
    coherencia,
    empatia,
    resumen: 'Buen desempeño.',
    cita: 'Cita de coach.',
    fortalezas: ['Claridad'],
    mejoras: ['Sintetizar'],
    mensajesClave: [{ mensaje: 'Colaboramos con la autoridad', cubierto: true }],
    lineasRojas: [{ linea: 'No especular', cruzada: false, evidencia: '' }],
    porPregunta: [{ pregunta: 1, puntaje: 85, comentario: 'Correcta' }],
  };
}

const aiResponse = () =>
  new Response(
    JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(judgement()) } }] }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );

// Sustituye `fetch` SOLO para el proveedor de IA; el resto sigue yendo al servidor local.
function stubAI({ calls, delay = 0, status = 200 } = {}) {
  global.fetch = async (url, options) => {
    if (!String(url).includes('integrate.api.nvidia.com')) return realFetch(url, options);
    calls.value += 1;
    if (delay) await sleep(delay);
    if (status !== 200) return new Response('{}', { status });
    return aiResponse();
  };
}

const restoreFetch = () => {
  global.fetch = realFetch;
};

const BODY = {
  transcript: [
    {
      question: '¿Qué ocurrió?',
      answer: 'Quiero lamentar profundamente lo ocurrido y expresar nuestra solidaridad con la familia.',
      metrics: { speakingMs: 6000, latencyMs: 900, longPauses: 0, volumeVariation: 0.3 },
    },
    {
      question: '¿Están colaborando?',
      answer: 'Estamos colaborando con la autoridad desde el primer minuto.',
      metrics: { speakingMs: 4000, latencyMs: 1200, longPauses: 1, volumeVariation: 0.25 },
    },
  ],
  metrics: {
    voice: { available: true, longPauses: 1, volumeVariation: 0.3, avgLatencyMs: 1000, transcription: 'voz' },
    body: { available: true, presence: 0.95, facingCamera: 0.8, analyzedSeconds: 20, facingSeconds: 16, awaySeconds: 4 },
    lighting: { average: 120 },
    durationSeconds: 30,
  },
};

const users = () => ({ u1: user('u1'), u2: user('u2') });

// Servidor de pruebas con las rutas reales y el Prisma falso.
async function withApp(store, run) {
  const app = express();
  app.use(express.json());
  registerSessionRoutes(app, store);
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
    return await run({ call });
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

// ---------------------------------------------------------------- pruebas

test('la evaluación corre en segundo plano y termina con informe', async () => {
  const store = createStore({ sessions: { s1: sessionRow() }, users: users() });
  const calls = { value: 0 };
  // La IA tarda un poco a propósito: así se puede observar el estado intermedio real.
  stubAI({ calls, delay: 80 });
  try {
    await withApp(store, async ({ call }) => {
      const started = await call('/api/sessions/s1/evaluate', { method: 'POST', body: BODY });
      assert.equal(started.status, 202);
      const payload = await started.json();
      assert.equal(payload.status, 'processing');
      assert.equal(payload.evaluation.state, 'processing');
      assert.ok(['audio', 'ai'].includes(payload.evaluation.stage));
      // Todavía NO hay informe ni puntaje
      assert.equal(store.rows.get('s1').report, null);
      assert.equal(store.rows.get('s1').score, null);
      assert.equal(store.rows.get('s1').status, 'EVALUATING');

      const done = await waitFor(() => store.rows.get('s1').status === 'COMPLETED');
      assert.ok(done, 'la evaluación no terminó a tiempo');

      const row = store.rows.get('s1');
      assert.ok(row.report);
      assert.equal(typeof row.score, 'number');
      assert.equal(row.metrics.evaluation.state, 'done');

      // El WPM no se pudo verificar (Whisper desactivado): queda excluido, no en 0.
      const voice = row.report.areas.find((area) => area.key === 'voice');
      const wpm = voice.details.find((detail) => detail.key === 'wpm');
      assert.equal(wpm.verified, false);
      assert.equal(wpm.value, null);
      assert.equal(wpm.score, null);
      assert.equal(wpm.reason, 'DISABLED');
      assert.ok(voice.coverage < 1);
      assert.equal(row.report.coverage.wpmVerified, false);
      assert.equal(row.report.audit.speech.status, 'unverified');
      assert.equal(row.report.audit.speech.reason, 'DISABLED');
      assert.equal(row.report.audit.metricSources.wpm, 'unverified');
      // El resto de la rúbrica sí se midió: el área de voz no queda vacía
      assert.ok(voice.score > 0);
      // La transcripción normalizada se guarda con el turno sin WPM
      assert.equal(row.transcript[0].metrics.wpm, null);
      assert.equal(row.transcript[0].metrics.speechSource, 'unverified');
    });
  } finally {
    restoreFetch();
  }
});

test('dos peticiones simultáneas no duplican la evaluación', async () => {
  const store = createStore({ sessions: { s1: sessionRow() }, users: users() });
  const calls = { value: 0 };
  stubAI({ calls, delay: 60 });
  try {
    await withApp(store, async ({ call }) => {
      const [a, b] = await Promise.all([
        call('/api/sessions/s1/evaluate', { method: 'POST', body: BODY }),
        call('/api/sessions/s1/evaluate', { method: 'POST', body: BODY }),
      ]);
      assert.equal(a.status, 202);
      assert.equal(b.status, 202);

      await waitFor(() => store.rows.get('s1').status === 'COMPLETED');
      // Una sola tanda de modelos (3), no dos
      assert.equal(calls.value, 3);
    });
  } finally {
    restoreFetch();
  }
});

test('si la IA falla, la sesión queda FAILED sin informe y se puede reintentar', async () => {
  const store = createStore({ sessions: { s1: sessionRow() }, users: users() });
  const calls = { value: 0 };
  stubAI({ calls, status: 500 });
  try {
    await withApp(store, async ({ call }) => {
      const started = await call('/api/sessions/s1/evaluate', { method: 'POST', body: BODY });
      assert.equal(started.status, 202);
      await waitFor(() => store.rows.get('s1').status === 'FAILED');

      const row = store.rows.get('s1');
      assert.equal(row.status, 'FAILED');
      assert.equal(row.report, null); // nunca se guarda un informe inválido
      assert.equal(row.score, null);
      assert.equal(row.metrics.evaluation.state, 'failed');
      assert.equal(row.metrics.evaluation.error, 'AI_UNAVAILABLE');

      // El estado es consultable y el reintento se permite
      const status = await call('/api/sessions/s1');
      const statusBody = await status.json();
      assert.equal(statusBody.evaluation.state, 'failed');
      assert.equal(statusBody.evaluation.reason, 'AI_UNAVAILABLE');

      stubAI({ calls });
      const retry = await call('/api/sessions/s1/evaluate', { method: 'POST', body: BODY });
      assert.equal(retry.status, 202);
      const recovered = await waitFor(() => store.rows.get('s1').status === 'COMPLETED');
      assert.ok(recovered, 'el reintento no completó la evaluación');
      assert.ok(store.rows.get('s1').report);
    });
  } finally {
    restoreFetch();
  }
});

test('un informe existente no se recalcula (histórico intacto)', async () => {
  const existing = { global: 77, areas: [], audit: { evaluatorVersion: '1.0.0' } };
  const store = createStore({
    sessions: { s1: sessionRow({ status: 'COMPLETED', report: existing, score: 77 }) },
    users: users(),
  });
  const calls = { value: 0 };
  stubAI({ calls });
  try {
    await withApp(store, async ({ call }) => {
      const res = await call('/api/sessions/s1/evaluate', { method: 'POST', body: BODY });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.deepEqual(body.session.report, existing);
      assert.equal(body.evaluation.state, 'done');
      assert.equal(calls.value, 0); // no se llamó a la IA
    });
  } finally {
    restoreFetch();
  }
});

test('otro usuario no puede evaluar la sesión (403)', async () => {
  const store = createStore({ sessions: { s1: sessionRow() }, users: users() });
  const calls = { value: 0 };
  stubAI({ calls });
  try {
    await withApp(store, async ({ call }) => {
      const res = await call('/api/sessions/s1/evaluate', {
        method: 'POST',
        body: BODY,
        auth: createToken({ id: 'u2', role: 'VOCERO' }),
      });
      assert.equal(res.status, 403);
      assert.equal(calls.value, 0);
      assert.equal(store.rows.get('s1').status, 'CREATED');
    });
  } finally {
    restoreFetch();
  }
});

test('una organización en borrado no evalúa (409)', async () => {
  const store = createStore({
    sessions: { s1: sessionRow({ tenant: { status: 'DELETING' } }) },
    users: users(),
  });
  const calls = { value: 0 };
  stubAI({ calls });
  try {
    await withApp(store, async ({ call }) => {
      const res = await call('/api/sessions/s1/evaluate', { method: 'POST', body: BODY });
      assert.equal(res.status, 409);
      assert.equal(calls.value, 0);
    });
  } finally {
    restoreFetch();
  }
});

