// B1: instrumentacion del pool de reservas. Pruebas LOCALES con dobles (sin red, sin DB).
//
// Verifica que la instrumentacion registra el origen, la antiguedad y los motivos de descarte, que
// relaciona reserva y entrega, que NO guarda texto de preguntas y que no altera ninguna decision.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createInterviewSession } = require('../lib/interviewSession');

// Doble de modelo que devuelve una pregunta distinta en cada llamada (textos deterministicos).
function sequence(prefix = 'Pregunta') {
  let call = 0;
  return async () => {
    call += 1;
    return { question: `¿${prefix} ${call}?` };
  };
}

const buildSession = ({ models = ['m1'], ask, isObsolete } = {}) =>
  createInterviewSession({
    sessionId: 'pool-1',
    models,
    askModel: ask,
    ...(isObsolete ? { isObsolete } : {}),
  });

const reasonsOf = (snapshot) => snapshot.poolLog.filter((entry) => entry.event === 'reserva_descartada').map((entry) => entry.reason);

test('B1-1) la reserva aceptada registra su antiguedad y el pool la expone', async () => {
  const session = buildSession({ ask: async () => ({ question: '¿Cuál fue la causa de la caída?' }) });
  const result = await session.prewarm({ context: {}, rounds: 1, waitPerRoundMs: 5 });
  assert.equal(result.reserved, 1);

  const snapshot = session.snapshot();
  assert.equal(snapshot.reserved.length, 1);
  assert.equal(snapshot.reserved[0].forMain, 1, 'la vista del pool expone a que principal apunta');
  assert.equal(snapshot.reserved[0].historyLen, 0, 'sin respuestas cuando se reservo');

  const accepted = snapshot.poolLog.filter((entry) => entry.event === 'reserva_aceptada');
  assert.equal(accepted.length, 1);
  assert.deepEqual(
    { forMain: accepted[0].forMain, historyLen: accepted[0].historyLen, pool: accepted[0].pool },
    { forMain: 1, historyLen: 0, pool: 1 },
  );
  assert.ok(snapshot.poolLog.some((entry) => entry.event === 'prewarm_ronda'), 'se registra cada ronda');
  assert.ok(snapshot.poolLog.some((entry) => entry.event === 'prewarm_fin'), 'se registra el cierre del prewarm');
});

test('B1-2) el pool respeta su objetivo y registra el motivo del descarte', async () => {
  const session = buildSession({ models: ['m1', 'm2', 'm3', 'm4'], ask: sequence() });
  await session.prewarm({ context: {}, rounds: 1, waitPerRoundMs: 60 });
  const snapshot = session.snapshot();
  assert.equal(snapshot.reserved.length, 3, 'no supera el objetivo de reservas');
  assert.ok(reasonsOf(snapshot).includes('pool_completo'), `motivos: ${reasonsOf(snapshot).join(',')}`);
});

test('B1-3) un candidato repetido no entra al pool', async () => {
  const session = buildSession({ models: ['m1', 'm2'], ask: async () => ({ question: '¿La misma pregunta?' }) });
  await session.prewarm({ context: {}, rounds: 1, waitPerRoundMs: 20 });
  const snapshot = session.snapshot();
  assert.equal(snapshot.reserved.length, 1);
  assert.ok(reasonsOf(snapshot).includes('duplicada_en_pool'), `motivos: ${reasonsOf(snapshot).join(',')}`);
});

test('B1-4) una pregunta ya formulada no se vuelve a reservar', async () => {
  const session = buildSession({ ask: async () => ({ question: '¿Siempre la misma?' }) });
  await session.prewarm({ context: {}, rounds: 1, waitPerRoundMs: 5 });
  await session.start({ context: {}, timeoutMs: 50 });
  await session.next({ context: {}, timeoutMs: 80 });
  assert.ok(reasonsOf(session.snapshot()).includes('texto_ya_preguntado'), `motivos: ${reasonsOf(session.snapshot()).join(',')}`);
});

test('B1-5) el origen de la pregunta entregada queda registrado', async () => {
  const session = buildSession({ models: ['m1'], ask: sequence() });
  await session.prewarm({ context: {}, rounds: 1, waitPerRoundMs: 5 });

  const fromPool = await session.start({ context: {}, timeoutMs: 60 });
  assert.equal(fromPool.ok, true);
  assert.equal(fromPool.origin, 'reserva_previa');
  assert.equal(fromPool.historyLenAtReserve, 0, 'la reserva se creo sin respuestas');
  assert.equal(fromPool.answersAtDelivery, 0);

  session.recordAnswer('respuesta del vocero');
  const generated = await session.next({ context: {}, timeoutMs: 200 });
  assert.equal(generated.ok, true);
  assert.equal(generated.origin, 'generada_en_la_solicitud', 'no habia reserva: se genero en la solicitud');
  assert.equal(generated.answersAtDelivery, 1, 'habia una respuesta al entregarla');
  assert.equal(generated.historyLenAtReserve, 1);

  const followUp = await session.next({ needsFollowUp: true, focus: 'la cifra exacta', context: {}, timeoutMs: 200 });
  assert.equal(followUp.ok, true);
  assert.equal(followUp.origin, 'repregunta');
  assert.equal(followUp.kind, 'followup');
});

test('B1-6) una reserva para una principal ya superada se descarta con su motivo', async () => {
  const session = buildSession({ models: ['m1', 'm2', 'm3'], ask: sequence() });
  await session.prewarm({ context: {}, rounds: 1, waitPerRoundMs: 60 });
  assert.equal(session.snapshot().reserved.length, 3, 'precondicion: tres reservas de la principal 1');

  await session.start({ context: {}, timeoutMs: 60 }); // principal 1
  await session.next({ context: {}, timeoutMs: 60 }); // principal 2
  await session.next({ context: {}, timeoutMs: 200 }); // la reserva 3 apunta a la principal 1: obsoleta

  assert.equal(session.snapshot().mainsAsked, 3);
  assert.ok(reasonsOf(session.snapshot()).includes('principal_ya_entregada'), `motivos: ${reasonsOf(session.snapshot()).join(',')}`);
});

test('B1-7) el descarte por el predicado de obsolescencia queda registrado', async () => {
  const session = buildSession({ ask: async () => ({ question: '¿Pregunta reservada?' }), isObsolete: () => true });
  await session.prewarm({ context: {}, rounds: 1, waitPerRoundMs: 5 });
  await session.next({ context: {}, timeoutMs: 60 });
  assert.ok(reasonsOf(session.snapshot()).includes('obsoleta_por_respuesta'), `motivos: ${reasonsOf(session.snapshot()).join(',')}`);
});

test('B1-8) el registro del pool nunca contiene el texto de las preguntas', async () => {
  const session = buildSession({ ask: async () => ({ question: '¿Contenido reservado confidencial?' }) });
  await session.prewarm({ context: {}, rounds: 1, waitPerRoundMs: 5 });
  await session.start({ context: {}, timeoutMs: 60 });
  const dump = JSON.stringify(session.snapshot().poolLog);
  assert.ok(!dump.includes('confidencial'), 'no se instrumenta el texto de la pregunta');
  assert.ok(!dump.includes('Contenido reservado'));
});

test('B1-9) la instrumentacion no altera lo que se entrega ni los contadores', async () => {
  const session = buildSession({ models: ['m1', 'm2'], ask: sequence() });
  await session.prewarm({ context: {}, rounds: 1, waitPerRoundMs: 60 });

  const first = await session.start({ context: {}, timeoutMs: 60 });
  const second = await session.next({ context: {}, timeoutMs: 60 });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.notEqual(first.question, second.question);
  assert.equal(session.snapshot().mainsAsked, 2);
  assert.equal(session.snapshot().asked.length, 2);
  assert.deepEqual(
    Object.keys(session.snapshot().asked[0]).sort(),
    ['kind', 'question', 'turn'],
    'la forma de `asked` no cambia',
  );
  assert.equal(session.snapshot().reserved.length, 0);
});

test('B1-11) la reposicion del pool ocurre solo al pedir la pregunta (no antes)', async () => {
  let calls = 0;
  const session = buildSession({
    models: ['m1'],
    ask: async () => {
      calls += 1;
      return { question: `¿Pregunta ${calls}?` };
    },
  });
  await session.prewarm({ context: {}, rounds: 1, waitPerRoundMs: 60 });
  assert.equal(session.snapshot().reserved.length, 1, 'el prewarm deja una reserva');
  const afterPrewarm = calls;

  // 1) La reserva se consume al pedir la primera pregunta (sin generar nada nuevo).
  const fromPool = await session.next({ context: {}, timeoutMs: 60 });
  assert.equal(fromPool.ok, true);
  assert.equal(fromPool.origin, 'reserva_previa');
  assert.equal(calls, afterPrewarm, 'consumir la reserva no genera');
  assert.equal(session.snapshot().reserved.length, 0, 'el pool queda vacio');

  // 2) Sin peticion de pregunta, el pool NO se repone en segundo plano.
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(calls, afterPrewarm, 'no hay reposicion proactiva');

  // 3) La reposicion se dispara al pedir la siguiente pregunta sin reserva disponible.
  session.recordAnswer('respuesta del vocero');
  const generated = await session.next({ context: {}, timeoutMs: 200 });
  assert.equal(generated.ok, true);
  assert.equal(generated.origin, 'generada_en_la_solicitud');
  assert.ok(calls > afterPrewarm, 'la generacion se dispara con la peticion');
});

// --- Integracion con la ruta y la auditoria (JSONL en el directorio temporal, nunca en el repo) ---

process.env.AI_MODEL = 'modelo-pool-a';
process.env.AI_FALLBACK_MODEL = 'modelo-pool-b';
process.env.AI_EXTRA_MODELS = 'modelo-pool-c';

const AUDIT_FILE = path.join(os.tmpdir(), `voxready-pool-audit-${process.pid}-${Date.now()}.jsonl`);
process.env.INTERVIEW_AUDIT = '1';
process.env.INTERVIEW_AUDIT_FILE = AUDIT_FILE;

const authPath = require.resolve('../auth');
require.cache[authPath] = {
  id: authPath,
  filename: authPath,
  loaded: true,
  exports: {
    requireAuth: () => (req, res, next) => {
      req.user = { id: 'u1', tenant: { name: 'Energia Andes', sector: 'Energia' } };
      next();
    },
  },
};

const registerInterviewerRoutes = require('../routes/interviewer');
const REAL_FETCH = globalThis.fetch.bind(globalThis);

test.after(() => {
  globalThis.fetch = REAL_FETCH;
  try {
    fs.unlinkSync(AUDIT_FILE);
  } catch {
    /* no existia */
  }
});

const JSON_SUFFICIENT = JSON.stringify({ status: 'sufficient', focus: '', evidence: [], reason: 'contesta lo pedido' });
const theme = () => ({
  title: 'Corte masivo de suministro',
  context: 'Corte desde las 06:00 en la zona sur.',
  keyMessages: '',
  redLines: '',
  interviewConfig: { aggressiveness: 'ALTA', questionCount: 5, followUps: 0, estimatedMinutes: 30 },
});
const prisma = {
  session: { findUnique: async () => ({ id: 's-pool', userId: 'u1', score: null, theme: theme() }) },
};
const jsonResponse = (payload) => ({
  ok: true,
  status: 200,
  json: async () => payload,
  clone() {
    return { json: async () => payload };
  },
});

// Proveedor simulado: el entrevistador recibe siempre una pregunta marcada (para poder comprobar
// que ese texto NO aparece en los bloques de instrumentacion) y el clasificador un JSON valido.
function providerDouble() {
  let generation = 0;
  return async (url, init = {}) => {
    const body = JSON.parse(init.body || '{}');
    const system = String(body.messages?.[0]?.content || '');
    if (system.includes('analista de entrevistas')) return jsonResponse({ choices: [{ message: { content: JSON_SUFFICIENT } }] });
    generation += 1;
    return jsonResponse({ choices: [{ message: { content: `¿Pregunta confidencial ${generation}?` } }] });
  };
}

function buildApp() {
  const app = express();
  app.use(express.json());
  registerInterviewerRoutes(app, prisma, { questionAllowed: () => true, startWaitMs: () => 200, timeoutFor: () => 2000 });
  return app;
}

async function call(app, route, payload) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const response = await REAL_FETCH(`http://127.0.0.1:${server.address().port}${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return { status: response.status, body: await response.json() };
  } finally {
    server.close();
  }
}

const readRecords = () =>
  (fs.existsSync(AUDIT_FILE) ? fs.readFileSync(AUDIT_FILE, 'utf8') : '')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));

test('B1-10) la ruta registra el pool, el origen de la pregunta y el evento de prewarm', async () => {
  globalThis.fetch = providerDouble();
  const app = buildApp();
  const sessionId = 'pool-audit-1';

  const prewarm = await call(app, '/api/interviewer/prewarm', { sessionId });
  assert.equal(prewarm.status, 200);
  assert.ok(prewarm.body.reserved >= 1, 'el prewarm deja reservas');
  assert.equal(prewarm.body.answers, 0, 'no hay respuestas al reservar');
  assert.ok(Array.isArray(prewarm.body.poolTopics), 'se informan los temas del pool');

  const first = await call(app, '/api/interviewer/next-question', { sessionId, history: [] });
  assert.equal(first.status, 200);
  assert.match(first.body.question, /confidencial/, 'la primera pregunta sale del pool');

  const records = readRecords();
  const poolEvent = records.find((item) => item.type === 'pool' && item.event === 'prewarm');
  assert.ok(poolEvent, 'se registra el evento de prewarm');
  assert.equal(poolEvent.answersAtReserve, 0);
  assert.ok(poolEvent.reserved >= 1);
  assert.ok(Array.isArray(poolEvent.candidates[0].topics), 'los temas son claves del ladder');
  assert.ok(!JSON.stringify({ candidates: poolEvent.candidates, log: poolEvent.log }).includes('confidencial'), 'sin texto de preguntas en el evento de pool');

  const turn0 = records.find((item) => item.type === 'turn' && item.turn === 0);
  assert.ok(turn0.pool, 'el turno registra el estado del pool');
  assert.equal(turn0.delivery.origin, 'reserva_previa');
  assert.equal(turn0.delivery.fromPool, true, 'la pregunta del turno 0 proviene del pool');
  assert.equal(turn0.delivery.answersAtReserve, 0);
  assert.equal(turn0.delivery.answersAtDelivery, 0);
  assert.ok(turn0.pool.before >= 1, 'habia reservas antes de entregar');
  assert.equal(turn0.pool.after, turn0.pool.before - 1, 'se consumio una reserva');
  assert.ok((turn0.pool.log || []).some((entry) => entry.event === 'reserva_entregada'), 'la entrega queda registrada');
  assert.ok(!JSON.stringify({ pool: turn0.pool, delivery: turn0.delivery }).includes('confidencial'), 'los bloques nuevos no llevan texto');
});


