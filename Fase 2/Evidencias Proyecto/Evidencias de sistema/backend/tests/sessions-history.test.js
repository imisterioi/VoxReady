// Historial de prácticas del vocero (GET /api/sessions): incluye sesiones SIN informe, informa el
// estado real de la evaluación y mantiene el aislamiento por usuario. Prisma falso, sin red.
process.env.NVIDIA_API_KEY = 'test-key';
process.env.AI_EVAL_MODEL = 'test/modelo-a';
process.env.AI_EVAL_FALLBACK_MODEL = '';
process.env.EVAL_WHISPER_ENABLED = 'false';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

// `requireAuth` real informa siempre el rol en `req.apiRole`: el doble de prueba también lo hace
// (la ruta decide el alcance de la consulta a partir de ese rol).
const authPath = require.resolve('../auth');
require.cache[authPath] = {
  id: authPath,
  filename: authPath,
  loaded: true,
  exports: { requireAuth: () => (req, _res, next) => { req.user = { id: 'u1' }; req.apiRole = 'user'; next(); } },
};

const registerSessionRoutes = require('../routes/sessions');

const THEME = { id: 't1', title: 'Crisis', category: 'general' };
const BASE = Date.now();

const sessionRow = (extra = {}) => ({
  id: 's-base',
  userId: 'u1',
  status: 'CREATED',
  createdAt: new Date(BASE),
  completedAt: null,
  transcript: null,
  metrics: null,
  report: null,
  score: null,
  review: null,
  themeId: 't1',
  tenantId: 'ten1',
  evalAttempts: 0,
  evalNextAt: null,
  evalLeaseUntil: null,
  evalLastError: null,
  evalFinishedAt: null,
  evalExhausted: false,
  theme: THEME,
  ...extra,
});

// Prisma falso mínimo: solo lo que usa el endpoint (filtro por usuario, orden, límite y total).
function createStore(rows) {
  const matches = (row, where = {}) => (where.userId ? row.userId === where.userId : true);
  return {
    session: {
      async count({ where = {} } = {}) {
        return rows.filter((row) => matches(row, where)).length;
      },
      async findMany({ where = {}, orderBy, take, skip } = {}) {
        let out = rows.filter((row) => matches(row, where));
        if (orderBy?.createdAt === 'desc') {
          out = [...out].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        }
        if (skip) out = out.slice(skip);
        return take ? out.slice(0, take) : out;
      },
    },
  };
}

async function withApp(rows, run) {
  const app = express();
  app.use(express.json());
  registerSessionRoutes(app, createStore(rows), { evaluationQueue: { enabled: false } });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address();
  try {
    return await run((path) => fetch(`http://127.0.0.1:${port}${path}`));
  } finally {
    app.locals.evaluationQueue?.stop();
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

test('incluye sesiones recientes SIN informe y con el estado real de la evaluación', async () => {
  const rows = [
    sessionRow({ id: 'reciente-sin-informe', createdAt: new Date(BASE - 60_000), status: 'FAILED', evalAttempts: 1, evalNextAt: new Date(BASE + 120_000), metrics: { evaluation: { state: 'failed' } } }),
    sessionRow({ id: 'en-proceso', createdAt: new Date(BASE - 120_000), status: 'EVALUATING', evalLeaseUntil: new Date(BASE + 60_000), metrics: { evaluation: { state: 'processing', stage: 'ai', startedAt: BASE } } }),
    sessionRow({ id: 'agotada', createdAt: new Date(BASE - 180_000), status: 'EXHAUSTED', evalAttempts: 50, evalExhausted: true, metrics: { evaluation: { state: 'failed', error: 'AI_UNAVAILABLE' } } }),
  ];
  await withApp(rows, async (get) => {
    const response = await get('/api/sessions');
    assert.equal(response.status, 200);
    const body = await response.json();
    const byId = Object.fromEntries(body.sessions.map((s) => [s.id, s]));

    // Las tres aparecen: ninguna se descarta por no tener informe ni puntaje.
    assert.equal(body.sessions.length, 3);
    assert.equal(byId['reciente-sin-informe'].hasReport, false);
    assert.equal(byId['reciente-sin-informe'].score, null);
    // Reintento programado → la evaluación sigue pendiente (no un fallo definitivo).
    assert.equal(byId['reciente-sin-informe'].evaluation.state, 'retrying');
    assert.equal(byId['en-proceso'].evaluation.state, 'processing');
    assert.equal(byId['agotada'].evaluation.state, 'exhausted');
    // Sin puntajes inventados y sin áreas de otra sesión.
    for (const session of body.sessions) {
      assert.equal(session.score, null);
      assert.deepEqual(session.areas, []);
    }
  });
});

test('las sesiones con informe válido siguen apareciendo y son abribles', async () => {
  const report = { global: 78, areas: [{ key: 'voice', label: 'Tono de voz', score: 78 }, { key: 'coherence', label: 'Coherencia', score: 81 }] };
  const rows = [sessionRow({ id: 'evaluada', status: 'COMPLETED', completedAt: new Date(BASE - 30_000), report, score: 78 })];
  await withApp(rows, async (get) => {
    const body = await (await get('/api/sessions')).json();
    const session = body.sessions[0];
    assert.equal(session.hasReport, true);
    assert.equal(session.score, 78);
    assert.equal(session.evaluation.state, 'done');
    assert.deepEqual(session.areas.map((a) => a.key), ['voice', 'coherence']);
  });
});

test('un fallo definitivo sin reintento programado se informa como failed (no como reintento)', async () => {
  const rows = [sessionRow({ id: 'fallo-definitivo', status: 'FAILED', evalAttempts: 1, evalNextAt: null, metrics: { evaluation: { state: 'failed', error: 'AI_UNAVAILABLE' } } })];
  await withApp(rows, async (get) => {
    const body = await (await get('/api/sessions')).json();
    assert.equal(body.sessions[0].evaluation.state, 'failed');
    assert.equal(body.sessions[0].hasReport, false);
  });
});

test('mantiene el aislamiento por usuario: no muestra sesiones de otro vocero', async () => {
  const rows = [
    sessionRow({ id: 'mia', userId: 'u1' }),
    sessionRow({ id: 'ajena', userId: 'u2', report: { global: 90 }, score: 90, status: 'COMPLETED' }),
  ];
  await withApp(rows, async (get) => {
    const body = await (await get('/api/sessions')).json();
    assert.deepEqual(body.sessions.map((s) => s.id), ['mia']);
  });
});

test('las sesiones históricas siguen apareciendo y el orden es del más reciente al más antiguo', async () => {
  const rows = [
    sessionRow({ id: 'antigua', createdAt: new Date(BASE - 4 * 24 * 60 * 60 * 1000), report: { global: 60, areas: [] }, score: 60, status: 'COMPLETED' }),
    sessionRow({ id: 'nueva', createdAt: new Date(BASE - 60_000) }),
    sessionRow({ id: 'media', createdAt: new Date(BASE - 24 * 60 * 60 * 1000) }),
  ];
  await withApp(rows, async (get) => {
    const body = await (await get('/api/sessions')).json();
    assert.deepEqual(body.sessions.map((s) => s.id), ['nueva', 'media', 'antigua']);
    assert.equal(body.sessions[2].hasReport, true, 'la histórica con informe se conserva');
  });
});

test('el estado se actualiza al volver a consultar el backend', async () => {
  const rows = [sessionRow({ id: 'cambia', status: 'FAILED', evalAttempts: 1, evalNextAt: new Date(BASE + 60_000), metrics: { evaluation: { state: 'failed' } } })];
  await withApp(rows, async (get) => {
    const first = await (await get('/api/sessions')).json();
    assert.equal(first.sessions[0].evaluation.state, 'retrying');

    // El backend publica el informe: la siguiente consulta refleja el estado nuevo.
    rows[0].report = { global: 70, areas: [] };
    rows[0].score = 70;
    rows[0].status = 'COMPLETED';
    rows[0].evalNextAt = null;
    const second = await (await get('/api/sessions')).json();
    assert.equal(second.sessions[0].evaluation.state, 'done');
    assert.equal(second.sessions[0].hasReport, true);
    assert.equal(second.sessions[0].score, 70);
  });
});

