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
const { judgeContent } = require('../ai/evaluator');
const { evaluatorModels } = require('../lib/evaluatorModels');
const { matches, applyOps } = require('./support/prismaFake');
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
    // Columnas de la migración de reintentos (en la BD real tienen default: 0/false/null).
    evalAttempts: 0,
    evalNextAt: null,
    evalLeaseUntil: null,
    evalLastError: null,
    evalFinishedAt: null,
    evalExhausted: false,
    theme: theme(),
    user: { id: 'u1', name: 'Usuario u1' },
    tenant: { status: 'ACTIVE' },
    ...overrides,
  };
}

// Prisma mínimo en memoria con las operaciones que usan las rutas.
function createStore({ sessions = {}, users = {}, audits = [] } = {}) {
  const rows = new Map(Object.entries(sessions));
  const auditRows = audits.map((row) => ({ ...row }));
  const clone = (value) => (value == null ? value : JSON.parse(JSON.stringify(value)));
  return {
    rows,
    auditRows,
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
        Object.assign(row, applyOps(row, data));
        return clone(row);
      },
      // CAS: solo actualiza si el estado sigue siendo el que se leyó.
      async updateMany({ where, data }) {
        const row = rows.get(where.id);
        if (!row) return { count: 0 };
        if (!matches(row, where)) return { count: 0 };
        Object.assign(row, applyOps(row, data));
        return { count: 1 };
      },
      async delete({ where }) {
        rows.delete(where.id);
        return {};
      },
    },
    tenant: { async findMany() { return []; } },
    // Auditoría de transcripción en memoria: misma clave única (sesión, turno) que la real.
    transcriptionAudit: {
      async findMany({ where } = {}) {
        return auditRows
          .filter((row) => (!where?.sessionId || row.sessionId === where.sessionId) && (!where?.status || row.status === where.status))
          .map((row) => ({ ...row }));
      },
      async create({ data }) {
        if (auditRows.some((row) => row.sessionId === data.sessionId && row.turnIndex === data.turnIndex)) {
          const error = new Error('clave duplicada');
          error.code = 'P2002';
          throw error;
        }
        auditRows.push({ ...data });
        return { ...data };
      },
      async updateMany({ where, data }) {
        let count = 0;
        auditRows.forEach((row, index) => {
          if (row.sessionId !== where.sessionId || row.turnIndex !== where.turnIndex) return;
          if (where.status && row.status !== where.status) return;
          auditRows[index] = { ...row, ...data };
          count += 1;
        });
        return { count };
      },
    },
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
async function withApp(store, run, { transcribe } = {}) {
  const app = express();
  app.use(express.json());
  const asr = transcribe || (async ({ turns = [] } = {}) => ({ ok: true, answers: turns.map((turn) => turn.answer || turn.text || 'res'), enginesUsed: turns.map(() => 'nvidia-whisper-large-v3'), diagnostics: [], model: 'whisper-large-v3' }));
  registerSessionRoutes(app, store, { transcribe: asr });
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
      // UNA sola tanda de modelos (todos los habilitados), no dos
      assert.equal(calls.value, evaluatorModels().length);
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
      // Contador persistente + reintento programado a ~3 minutos del fin del intento.
      assert.equal(row.evalAttempts, 1);
      assert.equal(row.evalExhausted, false);
      const delayMs = new Date(row.evalNextAt).getTime() - row.metrics.evaluation.finishedAt;
      assert.ok(delayMs >= 2 * 60 * 1000 && delayMs <= 3 * 60 * 1000, `espera inesperada: ${delayMs} ms`);

      // El estado es consultable y el reintento se permite
      const status = await call('/api/sessions/s1');
      const statusBody = await status.json();
      assert.equal(statusBody.evaluation.state, 'retrying');
      assert.equal(statusBody.evaluation.attempts, 1);
      assert.ok(statusBody.evaluation.nextAttemptAt > 0, 'debe informar el proximo intento');

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

test('la evaluación reutiliza las respuestas ya transcritas por el entrevistador', async () => {
  const store = createStore({
    sessions: { s1: sessionRow() },
    users: users(),
    audits: [
      { sessionId: 's1', turnIndex: 0, status: 'ok', transcript: 'Quiero lamentar profundamente lo ocurrido y expresar nuestra solidaridad.', engine: 'nvidia-whisper-large-v3' },
    ],
  });
  const calls = { value: 0 };
  const windows = [];
  stubAI({ calls });
  const transcribe = async ({ turns = [] }) => {
    windows.push(turns);
    return { ok: true, answers: turns.map(() => 'Estamos colaborando con la autoridad desde el primer minuto.'), enginesUsed: ['nvidia-whisper-large-v3'], diagnostics: [], model: 'whisper-large-v3' };
  };
  try {
    await withApp(store, async ({ call }) => {
      const started = await call('/api/sessions/s1/evaluate', { method: 'POST', body: BODY });
      assert.equal(started.status, 202);
      assert.ok(await waitFor(() => store.rows.get('s1').status === 'COMPLETED'));

      // Solo se pidió ASR para la ventana que faltaba (el turno 1), nunca para la reutilizada.
      assert.equal(windows.length, 1);
      assert.equal(windows[0].length, 1);
      assert.equal(windows[0][0].question, BODY.transcript[1].question);

      // La evaluación usó el texto ya registrado para el turno 0 y el nuevo para el turno 1.
      assert.match(store.rows.get('s1').transcript[0].answer, /lamentar profundamente/);
      assert.match(store.rows.get('s1').transcript[1].answer, /colaborando con la autoridad/);
      // No se reescribió la auditoría ya correcta.
      assert.equal(store.auditRows.filter((row) => row.turnIndex === 0).length, 1);
      assert.equal(store.auditRows.find((row) => row.turnIndex === 0).transcript, 'Quiero lamentar profundamente lo ocurrido y expresar nuestra solidaridad.');
    }, { transcribe });
  } finally {
    restoreFetch();
  }
});

test('si todas las respuestas están transcritas, la evaluación no llama a la cadena ASR', async () => {
  const store = createStore({
    sessions: { s1: sessionRow() },
    users: users(),
    audits: [
      { sessionId: 's1', turnIndex: 0, status: 'ok', transcript: 'Quiero lamentar profundamente lo ocurrido y expresar nuestra solidaridad.' },
      { sessionId: 's1', turnIndex: 1, status: 'ok', transcript: 'Estamos colaborando con la autoridad desde el primer minuto.' },
    ],
  });
  const calls = { value: 0 };
  const windows = [];
  stubAI({ calls });
  const transcribe = async ({ turns = [] }) => {
    windows.push(turns);
    return { ok: true, answers: turns.map(() => 'no debería usarse'), enginesUsed: [], diagnostics: [], model: null };
  };
  try {
    await withApp(store, async ({ call }) => {
      const started = await call('/api/sessions/s1/evaluate', { method: 'POST', body: BODY });
      assert.equal(started.status, 202);
      assert.ok(await waitFor(() => store.rows.get('s1').status === 'COMPLETED'));
      assert.equal(windows.length, 0, 'sin ventanas pendientes no se ejecuta ASR');
      assert.match(store.rows.get('s1').transcript[0].answer, /lamentar profundamente/);
      assert.match(store.rows.get('s1').transcript[1].answer, /colaborando con la autoridad/);
    }, { transcribe });
  } finally {
    restoreFetch();
  }
});

test('un turno con transcripción fallida se reintenta en la evaluación', async () => {
  const store = createStore({
    sessions: { s1: sessionRow() },
    users: users(),
    audits: [
      { sessionId: 's1', turnIndex: 0, status: 'failed', transcript: null, reason: 'BUDGET_EXHAUSTED' },
      { sessionId: 's1', turnIndex: 1, status: 'ok', transcript: 'Estamos colaborando con la autoridad desde el primer minuto.' },
    ],
  });
  const calls = { value: 0 };
  const windows = [];
  stubAI({ calls });
  const transcribe = async ({ turns = [] }) => {
    windows.push(turns);
    return { ok: true, answers: turns.map(() => 'Quiero lamentar profundamente lo ocurrido y expresar nuestra solidaridad.'), enginesUsed: ['nvidia-whisper-large-v3'], diagnostics: [{ index: 0, status: 'ok', engine: 'nvidia-whisper-large-v3', code: null, attempts: [], totalMs: 900 }], model: 'whisper-large-v3' };
  };
  try {
    await withApp(store, async ({ call }) => {
      const started = await call('/api/sessions/s1/evaluate', { method: 'POST', body: BODY });
      assert.equal(started.status, 202);
      assert.ok(await waitFor(() => store.rows.get('s1').status === 'COMPLETED'));

      // Solo el turno fallido vuelve a pasar por ASR y su auditoría se actualiza a `ok`.
      assert.equal(windows.length, 1);
      assert.equal(windows[0][0].question, BODY.transcript[0].question);
      const row = store.auditRows.find((item) => item.turnIndex === 0);
      assert.equal(row.status, 'ok');
      assert.match(row.transcript, /lamentar profundamente/);
      assert.match(store.rows.get('s1').transcript[0].answer, /lamentar profundamente/);
    }, { transcribe });
  } finally {
    restoreFetch();
  }
});


// ------------------------------------------- timeouts técnicos, lease y clasificación de errores
// Todas estas pruebas usan un PROVEEDOR SIMULADO (fetch sustituido): no se llama a NVIDIA.

// Cambia una variable de entorno y devuelve la función que la restaura.
function setEnv(name, value) {
  const previous = process.env[name];
  if (value == null) delete process.env[name];
  else process.env[name] = value;
  return () => {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  };
}

test('el límite del proveedor es el timeout técnico configurado, nunca un presupuesto de 60 s', async () => {
  const restoreEnv = setEnv('AI_EVAL_TIMEOUT_MS', '123456'); // valor inconfundible
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => {
    logs.push(args.map(String).join(' '));
  };
  try {
    // Se inyecta a propósito un presupuesto de 60 s: ya no existe y NO debe recortar el timeout.
    const result = await judgeContent(
      {
        theme: theme(),
        transcript: BODY.transcript,
        voice: BODY.metrics.voice,
        body: BODY.metrics.body,
        lighting: BODY.metrics.lighting,
        cfg: DEFAULT_CONFIG,
        attemptBudgetMs: 60000,
      },
      { call: async () => judgement() },
    );
    assert.ok(result.judgement, 'la evaluación se completa con el proveedor simulado');
    const line = logs.find((entry) => entry.includes('[IA evaluadora] modelos'));
    assert.ok(line, 'el backend registra los límites efectivos');
    const detail = JSON.parse(line.slice(line.indexOf('{')));
    assert.equal(detail.baseTimeoutMs, 123456, 'un presupuesto de 60 s no puede recortar la evaluación');
    assert.ok(
      detail.orden.every((item) => !item.endsWith('/60000ms')),
      'ningún modelo queda limitado a 60 s',
    );
  } finally {
    console.log = originalLog;
    restoreEnv();
  }
});

test('una evaluación lenta pero válida publica el informe completo (proveedor simulado)', async () => {
  const store = createStore({ sessions: { s1: sessionRow() }, users: users() });
  const calls = { value: 0 };
  // Más lenta que el sondeo del cliente: el informe debe publicarse igual, sin reintentos.
  stubAI({ calls, delay: 1200 });
  const restoreEnv = setEnv('AI_EVAL_TIMEOUT_MS', '20000');
  try {
    await withApp(store, async ({ call }) => {
      const started = await call('/api/sessions/s1/evaluate', { method: 'POST', body: BODY });
      assert.equal(started.status, 202);
      assert.ok(await waitFor(() => store.rows.get('s1').status === 'COMPLETED', { timeout: 15000 }));
      const row = store.rows.get('s1');
      assert.ok(row.report, 'el informe completo se publica');
      assert.equal(typeof row.score, 'number');
      assert.equal(row.metrics.evaluation.state, 'done');
      assert.equal(row.evalNextAt, null, 'una evaluación correcta no deja reintentos pendientes');
      assert.equal(row.evalAttempts, 1, 'se consumió exactamente un intento');
    });
    assert.ok(calls.value >= 1, 'se consultó al proveedor simulado');
    // Una sola tanda de modelos (todos los habilitados): el intento no se repite.
    assert.ok(calls.value <= evaluatorModels().length, `sin reintentos del intento (llamadas: ${calls.value})`);
  } finally {
    restoreEnv();
    restoreFetch();
  }
});


test('un timeout técnico real produce un fallo controlado y programa el reintento (proveedor simulado)', async () => {
  const store = createStore({ sessions: { s1: sessionRow() }, users: users() });
  const calls = { value: 0 };
  // Proveedor que NUNCA responde: solo rechaza cuando el backend aborta (como fetch real).
  global.fetch = async (url, options = {}) => {
    if (!String(url).includes('integrate.api.nvidia.com')) return realFetch(url, options);
    calls.value += 1;
    return new Promise((resolve, reject) => {
      const signal = options.signal;
      const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      if (signal?.aborted) abort();
      else signal?.addEventListener('abort', abort);
    });
  };
  const restoreEnv = setEnv('AI_EVAL_TIMEOUT_MS', '5000'); // mínimo técnico admitido
  const before = Date.now();
  try {
    await withApp(store, async ({ call }) => {
      const started = await call('/api/sessions/s1/evaluate', { method: 'POST', body: BODY });
      assert.equal(started.status, 202);
      assert.ok(await waitFor(() => store.rows.get('s1').status === 'FAILED', { timeout: 25000 }));
      const row = store.rows.get('s1');
      assert.equal(row.report, null, 'un intento agotado no publica nada');
      assert.equal(row.score, null);
      assert.equal(row.evalLastError, 'AI_UNAVAILABLE');
      assert.equal(row.metrics.evaluation.errorKind, 'transient', 'un timeout es un fallo temporal');
      assert.equal(row.evalLeaseUntil, null, 'el lease se libera al terminar el intento');
      const delay = new Date(row.evalNextAt).getTime() - before;
      assert.ok(
        delay >= 3 * 60 * 1000 - 2000 && delay <= 3 * 60 * 1000 + 60000,
        `el reintento se programa a 3 minutos (fue ${Math.round(delay / 1000)} s)`,
      );
      // El vocero ve una espera discreta, no un error técnico.
      const state = await (await call('/api/sessions/s1')).json();
      assert.equal(state.session.report, null);
      assert.equal(state.evaluation.state, 'retrying');
      assert.equal(state.evaluation.errorKind, 'transient');
      assert.equal(state.evaluation.nextAttemptAt, new Date(row.evalNextAt).getTime());
    });
    assert.ok(calls.value >= 1, 'se intentó llamar al proveedor');
  } finally {
    restoreEnv();
    restoreFetch();
  }
});


test('un error permanente queda identificado para revisión técnica sin cambiar la política (proveedor simulado)', async () => {
  const store = createStore({ sessions: { s1: sessionRow() }, users: users() });
  const calls = { value: 0 };
  stubAI({ calls, status: 404 }); // modelo inexistente o retirado
  const restoreEnv = setEnv('AI_EVAL_TIMEOUT_MS', '20000');
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => {
    logs.push(args.map(String).join(' '));
  };
  const before = Date.now();
  try {
    await withApp(store, async ({ call }) => {
      const started = await call('/api/sessions/s1/evaluate', { method: 'POST', body: BODY });
      assert.equal(started.status, 202);
      assert.ok(await waitFor(() => store.rows.get('s1').status === 'FAILED', { timeout: 15000 }));
      const row = store.rows.get('s1');
      assert.equal(row.report, null);
      assert.equal(row.metrics.evaluation.errorKind, 'permanent');
      assert.equal(row.evalNextAt, null, 'un error permanente no programa reintentos inútiles');
      assert.equal(row.evalExhausted, false, 'no es «agotada por 50 intentos»: requiere corrección');
      // El vocero ve el estado real: fallo permanente (revisión), nunca «puede llegar más adelante».
      const state = await (await call('/api/sessions/s1')).json();
      assert.equal(state.evaluation.state, 'failed');
      assert.equal(state.evaluation.errorKind, 'permanent');
    });
    assert.ok(
      logs.some((entry) => entry.includes('ERROR PERMANENTE')),
      'el registro debe señalar que requiere revisión técnica',
    );
    assert.ok(
      logs.some((entry) => entry.includes('sin reintentos automáticos')),
      'el registro debe indicar que no se reintenta solo',
    );
  } finally {
    console.log = originalLog;
    restoreEnv();
    restoreFetch();
  }
});

test('un intento que perdió el lease no publica ni programa reintentos (proveedor simulado)', async () => {
  const store = createStore({ sessions: { s1: sessionRow() }, users: users() });
  const calls = { value: 0 };
  stubAI({ calls, delay: 300 });
  const restoreEnv = setEnv('AI_EVAL_TIMEOUT_MS', '20000');
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => {
    warnings.push(args.map(String).join(' '));
  };
  try {
    await withApp(store, async ({ call }) => {
      const started = await call('/api/sessions/s1/evaluate', { method: 'POST', body: BODY });
      assert.equal(started.status, 202);
      // Otra instancia reclama la sesión mientras este intento trabaja: el lease cambia de dueño.
      const row = store.rows.get('s1');
      row.evalLeaseUntil = new Date(Date.now() + 60 * 60 * 1000);
      assert.ok(
        await waitFor(() => warnings.some((entry) => entry.includes('intento descartado')), { timeout: 15000 }),
        'el intento sin lease debe descartarse',
      );
      assert.equal(row.report, null, 'un intento sin lease no puede publicar un informe');
      assert.equal(row.score, null);
      assert.equal(row.status, 'EVALUATING', 'el intento descartado no cambia el estado de la sesión');
      assert.equal(row.evalNextAt, null, 'un intento descartado no programa reintentos');
      assert.notEqual(row.metrics.evaluation.state, 'done');
    });
  } finally {
    console.warn = originalWarn;
    restoreEnv();
    restoreFetch();
  }
});

// ------------------------------------------- modelos evaluadores EN PARALELO (mismo intento)
// Todas las pruebas de esta sección usan un PROVEEDOR SIMULADO (fetch sustituido): no se llama a
// NVIDIA. La sonda real está en `scripts/probe-evaluator-models.js` y se ejecuta a mano.

// Silencia los registros técnicos mientras dura la prueba.
async function silent(run) {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
  try {
    return await run();
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }
}

// Entrada equivalente a la de la evaluación real, para llamar a `judgeContent` directamente.
const JUDGE_INPUT = () => ({
  theme: theme(),
  transcript: BODY.transcript,
  voice: BODY.metrics.voice,
  body: BODY.metrics.body,
  lighting: BODY.metrics.lighting,
  cfg: DEFAULT_CONFIG,
});

// Proveedor simulado que responde DISTINTO según el modelo pedido. Los modelos sin plan fallan con
// 404 (así la carrera solo la pueden ganar los modelos del plan).
function stubAIByModel(plan, { calls = { value: 0 } } = {}) {
  global.fetch = async (url, options) => {
    if (!String(url).includes('integrate.api.nvidia.com')) return realFetch(url, options);
    calls.value += 1;
    const model = JSON.parse(options.body).model;
    const entry = plan[model] || { status: 404 };
    if (entry.hang) {
      return new Promise((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
    }
    if (entry.delay) await sleep(entry.delay);
    if (entry.status && entry.status !== 200) return new Response('{}', { status: entry.status });
    if (entry.invalid) {
      // Llega rápido pero NO sirve como informe (faltan criterios con peso).
      const content = JSON.stringify({ coherencia: { keyMessages: 80 }, empatia: {} });
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    const body = judgement();
    if (entry.resumen) body.resumen = entry.resumen;
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(body) } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return calls;
}

test('1) TODOS los modelos habilitados se consultan en paralelo en la misma carrera', async () => {
  const started = [];
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const promise = silent(() =>
    judgeContent(JUDGE_INPUT(), {
      models: ['m1', 'm2', 'm3', 'm4'],
      call: async (model) => {
        started.push(model);
        await gate;
        return judgement();
      },
    }),
  );
  await Promise.resolve();
  assert.deepEqual(started, ['m1', 'm2', 'm3', 'm4'], 'los cuatro arrancan antes de que responda ninguno');
  release();
  const winner = await promise;
  assert.ok(winner.model, 'hay un ganador');
});

test('2) un modelo lento no bloquea al que termina antes con un informe válido', async () => {
  const winner = await silent(() =>
    judgeContent(JUDGE_INPUT(), {
      models: ['lento', 'rapido'],
      call: async (model) => {
        if (model === 'lento') await sleep(400);
        return judgement();
      },
    }),
  );
  assert.equal(winner.model, 'rapido');
  assert.ok(winner.ms < 300, `el ganador no espera al lento (tardó ${winner.ms} ms)`);
  assert.equal(winner.validated, true);
  const failed = winner.failed.find((item) => item.model === 'lento');
  assert.ok(failed, 'el modelo que pierde queda registrado');
});

test('3) una respuesta rápida INCOMPLETA no gana la carrera', async () => {
  const winner = await silent(() =>
    judgeContent(JUDGE_INPUT(), {
      models: ['incompleto', 'completo'],
      call: async (model) => {
        if (model === 'incompleto') return { coherencia: { keyMessages: 80 }, empatia: {} };
        await sleep(60);
        return judgement();
      },
    }),
  );
  assert.equal(winner.model, 'completo', 'gana el primero VÁLIDO, no el primero en llegar');
  assert.equal(winner.validated, true);
  const failed = winner.failed.find((item) => item.model === 'incompleto');
  assert.match(failed.reason, /puntajes inválidos/i, 'el motivo queda registrado para el diagnóstico');
});

test('4) si un modelo falla, los demás siguen ejecutándose y otro gana', async () => {
  const winner = await silent(() =>
    judgeContent(JUDGE_INPUT(), {
      models: ['caido', 'ok'],
      call: async (model) => {
        if (model === 'caido') throw new Error('HTTP 500');
        return judgement();
      },
    }),
  );
  assert.equal(winner.model, 'ok');
  assert.equal(winner.failed.find((item) => item.model === 'caido').reason, 'HTTP 500');
});


test('5) el informe del ganador NO se sobrescribe con el resultado posterior de otro modelo', async () => {
  const store = createStore({ sessions: { s1: sessionRow() }, users: users() });
  const calls = stubAIByModel({ rapido: {}, lento: { delay: 900, resumen: 'del modelo lento' } });
  const restoreEnv = setEnv('AI_EVAL_MODELS', 'rapido,lento');
  try {
    await withApp(store, async ({ call }) => {
      const started = await call('/api/sessions/s1/evaluate', { method: 'POST', body: BODY });
      assert.equal(started.status, 202);
      assert.ok(await waitFor(() => store.rows.get('s1').status === 'COMPLETED', { timeout: 15000 }));
      const published = JSON.stringify(store.rows.get('s1').report);
      assert.equal(store.rows.get('s1').report.audit.model, 'rapido', 'gana el primero VÁLIDO');
      assert.equal(store.rows.get('s1').evalAttempts, 1, 'una carrera paralela = UN intento');

      // El modelo lento termina DESPUÉS de la publicación: no puede cambiar nada.
      await sleep(1400);
      assert.equal(JSON.stringify(store.rows.get('s1').report), published, 'el informe publicado no cambia');
      assert.notEqual(store.rows.get('s1').report.resumen, 'del modelo lento');
      assert.equal(store.rows.get('s1').evalAttempts, 1, 'el modelo lento no cuenta como intento nuevo');
      assert.equal(store.rows.get('s1').score, store.rows.get('s1').report.global);
    });
    assert.ok(calls.value >= 2, 'se consultaron los dos modelos en paralelo');
  } finally {
    restoreEnv();
    restoreFetch();
  }
});

test('6) si TODOS los modelos fallan por causa recuperable: UN intento y reintento a 3 min', async () => {
  const store = createStore({ sessions: { s1: sessionRow() }, users: users() });
  stubAIByModel({ rapido: { status: 500 }, lento: { status: 503 } });
  const restoreEnv = setEnv('AI_EVAL_MODELS', 'rapido,lento');
  const before = Date.now();
  try {
    await withApp(store, async ({ call }) => {
      const started = await call('/api/sessions/s1/evaluate', { method: 'POST', body: BODY });
      assert.equal(started.status, 202);
      assert.ok(await waitFor(() => store.rows.get('s1').status === 'FAILED', { timeout: 15000 }));
      const row = store.rows.get('s1');
      assert.equal(row.report, null);
      assert.equal(row.evalAttempts, 1, 'los fallos por modelo NO son intentos independientes');
      assert.equal(row.metrics.evaluation.errorKind, 'transient');
      const delay = new Date(row.evalNextAt).getTime() - before;
      assert.ok(
        delay >= 3 * 60 * 1000 - 2000 && delay <= 3 * 60 * 1000 + 60000,
        `un único reintento a 3 minutos (fue ${Math.round(delay / 1000)} s)`,
      );
      const state = await (await call('/api/sessions/s1')).json();
      assert.equal(state.evaluation.state, 'retrying');
      assert.equal(state.evaluation.errorKind, 'transient');
    });
  } finally {
    restoreEnv();
    restoreFetch();
  }
});


test('7) proveedor que no responde nunca: el límite EXPLÍCITO corta y se reintenta (temporal)', async () => {
  const store = createStore({ sessions: { s1: sessionRow() }, users: users() });
  stubAIByModel({ rapido: { hang: true }, lento: { hang: true } });
  const restoreEnv = setEnv('AI_EVAL_MODELS', 'rapido,lento');
  const restoreLimit = setEnv('AI_EVAL_TIMEOUT_MS', '400'); // decisión explícita del operador
  const before = Date.now();
  try {
    await withApp(store, async ({ call }) => {
      const started = await call('/api/sessions/s1/evaluate', { method: 'POST', body: BODY });
      assert.equal(started.status, 202);
      assert.ok(await waitFor(() => store.rows.get('s1').status === 'FAILED', { timeout: 15000 }));
      const row = store.rows.get('s1');
      assert.equal(row.evalAttempts, 1);
      assert.equal(row.metrics.evaluation.errorKind, 'transient', 'una espera agotada es recuperable');
      const delay = new Date(row.evalNextAt).getTime() - before;
      assert.ok(delay >= 3 * 60 * 1000 - 2000, 'se mantiene la espera de 3 minutos');
    });
  } finally {
    restoreLimit();
    restoreEnv();
    restoreFetch();
  }
});

test('8) errores permanentes (modelo inexistente): identificados y SIN reintentos inútiles', async () => {
  const store = createStore({ sessions: { s1: sessionRow() }, users: users() });
  stubAIByModel({}); // todos los modelos del plan fallan con 404
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.map(String).join(' '));
  try {
    await withApp(store, async ({ call }) => {
      const started = await call('/api/sessions/s1/evaluate', { method: 'POST', body: BODY });
      assert.equal(started.status, 202);
      assert.ok(await waitFor(() => store.rows.get('s1').status === 'FAILED', { timeout: 15000 }));
      const row = store.rows.get('s1');
      assert.equal(row.report, null);
      assert.equal(row.metrics.evaluation.errorKind, 'permanent');
      assert.equal(row.evalNextAt, null, 'no se programa un reintento inútil');
      const state = await (await call('/api/sessions/s1')).json();
      assert.equal(state.evaluation.state, 'failed');
      assert.equal(state.evaluation.errorKind, 'permanent');
    });
    assert.ok(logs.some((entry) => entry.includes('ERROR PERMANENTE')), 'queda señalado para revisión');
    assert.ok(logs.some((entry) => entry.includes('sin reintentos automáticos')), 'no se reintenta solo');
  } finally {
    console.log = originalLog;
    restoreFetch();
  }
});

test('9) una generación lenta NO se corta por un límite artificial de 60 o 90 segundos', async () => {
  const restore = setEnv('AI_EVAL_TIMEOUT_MS', null);
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.map(String).join(' '));
  try {
    const options = [];
    const winner = await judgeContent(JUDGE_INPUT(), {
      models: ['lento-pero-valido'],
      call: async (model, _messages, callOptions) => {
        options.push(callOptions);
        await sleep(1500);
        return judgement();
      },
    });
    assert.equal(winner.model, 'lento-pero-valido', 'una generación lenta y válida publica igual');
    assert.equal(options[0].timeoutMs, 0, 'sin límite local: no se aborta por una cantidad de segundos');
    const line = logs.find((entry) => entry.includes('[IA evaluadora] modelos'));
    assert.ok(line, 'el backend registra los límites efectivos');
    const detail = JSON.parse(line.slice(line.indexOf('{')));
    assert.equal(detail.baseTimeoutMs, null, 'no hay presupuesto global (ni 60 ni 90 s)');
    assert.ok(detail.orden.every((item) => item.endsWith('/sin-limite')), 'ningún modelo recibe un corte');
  } finally {
    console.log = originalLog;
    restore();
  }
});


