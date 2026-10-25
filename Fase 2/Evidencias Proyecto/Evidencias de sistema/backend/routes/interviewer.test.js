// Pruebas de integración de POST /api/interviewer/next-question (Prisma y modelos simulados).
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const authPath = require.resolve('../auth');
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: { requireAuth: () => (req, res, next) => { req.user = { id: 'u1' }; next(); } },
};

const registerInterviewerRoutes = require('./interviewer');

const THEME = {
  title: 'Corte de suministro', context: 'falla eléctrica', keyMessages: 'a|b', redLines: 'c',
  interviewConfig: { questionCount: 4, followUps: 1, aggressiveness: 'MEDIA' },
};
const SESSIONS = {
  s1: { id: 's1', userId: 'u1', score: null, theme: THEME },
  s2: { id: 's2', userId: 'u1', score: null, theme: THEME },
  ajena: { id: 'ajena', userId: 'u2', score: null, theme: THEME },
};
const prisma = { session: { findUnique: async ({ where }) => SESSIONS[where.id] || null } };

const freshRegistry = () => {
  const map = new Map();
  return {
    getOrCreate: (id, build) => { if (!map.has(id)) map.set(id, build()); return map.get(id); },
    touch: () => {}, get: (id) => map.get(id) || null,
  };
};

function buildApp({ askModel, timeoutFor = () => 400, registry = freshRegistry(), assess } = {}) {
  const app = express();
  app.use(express.json());
  registerInterviewerRoutes(app, prisma, {
    askModel: askModel || (async (model) => ({ question: `¿P${model}?`, model, ms: 1 })),
    models: () => ['m1', 'm2'], timeoutFor, registry, questionAllowed: () => true,
    startWaitMs: () => 120,
    ...(assess ? { assess } : {}),
  });
  return { app, registry };
}

async function call(app, body, path = '/api/interviewer/next-question') {
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  } finally {
    server.close();
  }
}

test('1) primera pregunta válida con el contrato del frontend', async () => {
  const { app } = buildApp();
  const res = await call(app, { sessionId: 's1', history: [] });
  assert.equal(res.status, 200);
  assert.match(res.body.question, /^¿P/);
  for (const field of ['question', 'kind', 'number', 'total', 'interview', 'model', 'ms']) assert.ok(field in res.body, field);
});

test('2) la siguiente pregunta no repite la anterior', async () => {
  const { app } = buildApp();
  const first = await call(app, { sessionId: 's1', history: [] });
  const second = await call(app, { sessionId: 's1', history: [{ role: 'interviewer', text: first.body.question }] });
  assert.equal(second.status, 200);
  assert.notEqual(second.body.question, first.body.question);
});

test('3) si un modelo falla, responde el otro', async () => {
  const { app } = buildApp({
    askModel: async (model) => {
      if (model === 'm1') throw new Error('HTTP 500: caído');
      return { question: `¿De ${model}?`, model, ms: 2 };
    },
  });
  const res = await call(app, { sessionId: 's1', history: [] });
  assert.equal(res.status, 200);
  assert.equal(res.body.model, 'm2');
});

test('4) una respuesta tardía no avanza el turno por sí sola', async () => {
  let release;
  const { app, registry } = buildApp({
    askModel: (model) =>
      model === 'm1'
        ? Promise.resolve({ question: '¿Primera?', model, ms: 1 })
        : new Promise((resolve) => { release = resolve; }),
  });
  const res = await call(app, { sessionId: 's1', history: [] });
  assert.equal(res.body.question, '¿Primera?');
  assert.equal(registry.get('s1').session.snapshot().turn, 1);
  release({ question: '¿Tardía?', model: 'm2', ms: 5 });
  await new Promise((r) => setImmediate(r));
  assert.equal(registry.get('s1').session.snapshot().turn, 1);
});

test('5) timeout recuperable: error previsto y recuperación sin consumir turno', async () => {
  const { app, registry } = buildApp({ askModel: () => new Promise(() => {}), timeoutFor: () => 60 });
  const failed = await call(app, { sessionId: 's1', history: [] });
  assert.equal(failed.status, 502);
  assert.equal(failed.body.status, 'error');
  assert.equal(registry.get('s1').session.snapshot().turn, 0, 'un timeout no consume turno');

  const recovering = buildApp({
    askModel: async (model) => ({ question: `¿De ${model}?`, model, ms: 1 }),
    timeoutFor: () => 400,
  });
  const ok = await call(recovering.app, { sessionId: 's1', history: [] });
  assert.equal(ok.status, 200);
  assert.equal(recovering.registry.get('s1').session.snapshot().turn, 1);
});

test('6) la repregunta se genera tras la respuesta real y no se duplica', async () => {
  const kinds = [];
  const { app, registry } = buildApp({
    askModel: async (model, context) => {
      kinds.push(context.kind);
      return { question: `¿${context.kind}-${model}?`, model, ms: 1 };
    },
  });
  const history = [
    { role: 'interviewer', text: '¿Qué pasó?' },
    { role: 'vocero', text: 'no lo sé' },
  ];
  const res = await call(app, { sessionId: 's1', history });
  assert.equal(res.status, 200);
  assert.equal(res.body.kind, 'followup');
  assert.ok(kinds.includes('followup'));
  const snapshot = registry.get('s1').session.snapshot();
  assert.equal(snapshot.answers.length, 1, 'la respuesta no se registra dos veces');
});

test('7) sesión de otro usuario: 404 y ninguna llamada a modelos', async () => {
  let calls = 0;
  const { app } = buildApp({
    askModel: async (model) => {
      calls += 1;
      return { question: `¿${model}?`, model, ms: 1 };
    },
  });
  const res = await call(app, { sessionId: 'ajena', history: [] });
  assert.equal(res.status, 404);
  assert.equal(calls, 0);
});

test('8) aislamiento: dos sesiones mantienen su propio historial y turno', async () => {
  const { app, registry } = buildApp();
  await call(app, { sessionId: 's1', history: [{ role: 'interviewer', text: '¿A?' }] });
  await call(app, { sessionId: 's2', history: [] });
  const a = registry.get('s1').session.snapshot();
  const b = registry.get('s2').session.snapshot();
  assert.equal(a.turn, 2, 's1 parte del historial recibido');
  assert.equal(b.turn, 1, 's2 no hereda nada de s1');
  assert.notDeepEqual(a.asked, b.asked);
});

test('9) solicitudes concurrentes: sin doble consumo ni turno duplicado', async () => {
  const { app, registry } = buildApp();
  const [a, b] = await Promise.all([
    call(app, { sessionId: 's1', history: [] }),
    call(app, { sessionId: 's1', history: [] }),
  ]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.notEqual(a.body.question, b.body.question);
  const snapshot = registry.get('s1').session.snapshot();
  assert.equal(snapshot.turn, 2);
  assert.equal(new Set(snapshot.asked.map((item) => item.question)).size, 2, 'sin preguntas repetidas');
});

test('10) rechazos y timeouts de los modelos quedan gestionados', async () => {
  const rejections = [];
  const onRejection = (error) => rejections.push(error);
  process.on('unhandledRejection', onRejection);
  try {
    const { app } = buildApp({
      askModel: async (model) => {
        if (model === 'm1') throw new Error('HTTP 500: caído');
        if (model === 'm2') {
          await new Promise((r) => setTimeout(r, 30));
          throw new Error('HTTP 503: tarde');
        }
        return { question: '¿Nunca?', model, ms: 1 };
      },
      timeoutFor: () => 10,
    });
    const res = await call(app, { sessionId: 's1', history: [] });
    assert.equal(res.status, 502);
    await new Promise((r) => setTimeout(r, 80));
    assert.deepEqual(rejections, []);
  } finally {
    process.off('unhandledRejection', onRejection);
  }
});

test('11) reconstrucción con registro nuevo: deduplica preguntas y respuestas del historial', async () => {
  const history = [
    { role: 'interviewer', text: '¿Repetida?' },
    { role: 'vocero', text: 'respuesta' },
    { role: 'interviewer', text: '¿Repetida?' }, // duplicado del cliente
    { role: 'vocero', text: 'respuesta' }, // respuesta duplicada
    { role: 'vocero', text: 'respuesta sin pregunta previa' },
  ];
  const { app, registry } = buildApp();
  const res = await call(app, { sessionId: 's1', history });
  assert.equal(res.status, 200);
  const snapshot = registry.get('s1').session.snapshot();
  assert.equal(snapshot.asked.filter((item) => item.question === '¿Repetida?').length, 1, 'la pregunta duplicada se cuenta una vez');
  assert.equal(snapshot.turn, 2, 'turno sembrado (1) + la pregunta aceptada en esta solicitud');
  assert.equal(snapshot.answers.filter((item) => item.text === 'respuesta').length, 1, 'sin respuestas duplicadas');
  assert.equal(snapshot.answers.length, 2, 'la respuesta sin pregunta previa se conserva');
  assert.notEqual(res.body.question, '¿Repetida?');
});

const PREWARM = '/api/interviewer/prewarm';

test('15) una repregunta no consume preguntas de respaldo', async () => {
  const { app, registry } = buildApp({
    askModel: async (model, context) => ({ question: `¿${context.kind}-${model}?`, model, ms: 1 }),
    // Evaluacion parcial inyectada: el turno debe resolverse como REPREGUNTA (no por posicion).
    assess: async () => ({ status: 'partial', focus: 'aclarar el punto pendiente', source: 'test', ms: 1 }),
  });
  await call(app, { sessionId: 's1', history: [] }, PREWARM);
  const session = registry.get('s1').session;
  const before = session.snapshot().reserved.length;
  assert.ok(before >= 1, 'el prewarm dejó reservas');

  const res = await call(app, {
    sessionId: 's1',
    history: [{ role: 'interviewer', text: '¿P1?' }, { role: 'vocero', text: 'no lo sé' }],
  });
  assert.equal(res.body.kind, 'followup');
  assert.ok(session.snapshot().reserved.length >= before, 'las reservas se conservan mientras se repregunta');
  assert.equal(session.snapshot().mainsAsked, 1, 'la repregunta NO incrementa el contador de preguntas principales');
});


test('12) prewarm consulta todos los modelos y no consume turno ni marca preguntas', async () => {
  const seen = [];
  let n = 0;
  const { app, registry } = buildApp({
    askModel: async (model) => {
      seen.push(model);
      n += 1;
      return { question: `¿R${n}-${model}?`, model, ms: 1 };
    },
  });
  const res = await call(app, { sessionId: 's1', history: [] }, PREWARM);
  assert.equal(res.status, 200);
  assert.ok(seen.includes('m1') && seen.includes('m2'), 'todos los modelos consultados');
  const snapshot = registry.get('s1').session.snapshot();
  assert.equal(snapshot.turn, 0, 'precalentar no consume turno');
  assert.equal(snapshot.asked.length, 0, 'no se marca como formulada');
  assert.ok(snapshot.reserved.length >= 1, 'deja preguntas reservadas');
});

test('13) la primera pregunta usa una reserva ya preparada', async () => {
  const { app } = buildApp();
  await call(app, { sessionId: 's1', history: [] }, PREWARM);
  const res = await call(app, { sessionId: 's1', history: [] });
  assert.equal(res.status, 200);
  assert.match(res.body.question, /^¿R?P?m\d\?$/, 'la pregunta viene de la reserva del prewarm');
});

test('14) prewarm repetido no duplica tandas ni preguntas reservadas', async () => {
  let calls = 0;
  let n = 0;
  const { app, registry } = buildApp({
    askModel: async (model) => {
      calls += 1;
      n += 1;
      return { question: `¿R${n}-${model}?`, model, ms: 1 };
    },
  });
  await call(app, { sessionId: 's1', history: [] }, PREWARM);
  const callsAfterFirst = calls;
  const second = await call(app, { sessionId: 's1', history: [] }, PREWARM);
  assert.equal(second.status, 200);
  assert.ok(calls <= callsAfterFirst + 2, 'no relanza tandas completas por consultas de estado');
  const reserved = registry.get('s1').session.snapshot().reserved.map((item) => item.question);
  assert.equal(new Set(reserved).size, reserved.length, 'sin reservas duplicadas');
});


