// Pruebas del orquestador del entrevistador (sin red, sin inferencias).
const test = require('node:test');
const assert = require('node:assert/strict');
const { createInterviewSession } = require('./interviewSession');

const MODELS = ['m1', 'm2', 'm3'];
const fastClock = () => { let t = 0; return () => (t += 100); };
const noSleep = async () => {};
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise((r) => setImmediate(r));

function session({ models = MODELS, askModel, reserveTarget = 3, sessionId = 's1' } = {}) {
  return createInterviewSession({ sessionId, models, askModel, reserveTarget, now: fastClock(), sleep: noSleep });
}

test('consulta a todos los modelos en paralelo', async () => {
  const seen = [];
  const s = session({ askModel: async (model) => { seen.push(model); return { question: `p${model}?` }; } });
  await s.start({ context: {} });
  assert.deepEqual(seen.sort(), MODELS);
});

test('no se cancelan las demás solicitudes al ganar la primera', async () => {
  const pending = new Map(MODELS.map((m) => [m, deferred()]));
  const s = session({ askModel: (model) => pending.get(model).promise.then((q) => ({ question: q })) });
  pending.get('m1').resolve('primera?');
  const started = await s.start({ context: {} });
  assert.equal(started.question, 'primera?');
  pending.get('m2').resolve('segunda?');
  pending.get('m3').resolve('tercera?');
  await tick();
  assert.deepEqual(s.snapshot().reserved.map((i) => i.question).sort(), ['segunda?', 'tercera?']);
});

test('una respuesta tardía no avanza el turno', async () => {
  const late = deferred();
  const s = session({ askModel: (model) => (model === 'm1' ? Promise.resolve({ question: 'uno?' }) : late.promise) });
  await s.start({ context: {} });
  assert.equal(s.snapshot().turn, 1);
  late.resolve({ question: 'tarde?' });
  await tick();
  assert.equal(s.snapshot().turn, 1);
  assert.equal(s.snapshot().asked.length, 1);
});

test('una pregunta reservada se consume una sola vez', async () => {
  const s = session({ askModel: async (model) => ({ question: `p${model}?` }) });
  const first = await s.start({ context: {} });
  const second = await s.next({ context: {} });
  assert.notEqual(first.question, second.question);
  assert.equal(s.snapshot().asked.length, 2);
});

test('las respuestas del vocero entran en el contexto de los respaldos', async () => {
  const s = session({ askModel: async (model) => ({ question: `p${model}?` }) });
  await s.start({ context: {} });
  s.recordAnswer('hubo un corte de tres horas');
  const ctx = s.contextFor({ kind: 'normal' });
  assert.deepEqual(ctx.answers, [{ text: 'hubo un corte de tres horas', turn: 1 }]);
  assert.ok(Array.isArray(ctx.reservedNotAsked));
});

test('la repregunta se genera tras la respuesta real', async () => {
  const s = session({
    askModel: async (model, context) => (context.kind === 'followup' ? { question: '¿y cómo lo explica?' } : { question: `p${model}?` }),
  });
  await s.start({ context: {} });
  s.recordAnswer('no lo sé');
  const follow = await s.next({ needsFollowUp: true, originAnswer: 'no lo sé' });
  assert.equal(follow.kind, 'followup');
  assert.equal(follow.question, '¿y cómo lo explica?');
});

test('cambio de modelo activo sin perder contexto', async () => {
  const s = session({ askModel: async (model) => ({ question: `p${model}?` }) });
  await s.start({ context: {} });
  s.recordAnswer('respuesta');
  assert.equal(s.setActiveModel('m2'), true);
  assert.equal(s.snapshot().activeModel, 'm2');
  assert.equal(s.snapshot().answers.length, 1);
});

test('un error definitivo desactiva solo ese modelo', async () => {
  const s = session({
    askModel: async (model) => { if (model === 'm1') throw new Error('HTTP 410: retirado'); return { question: `p${model}?` }; },
  });
  await s.start({ context: {} });
  await tick();
  assert.deepEqual(s.disabledModels(), ['m1']);
  assert.equal(s.setActiveModel('m1'), false);
});

test('el límite de inicio no cancela lo pendiente', async () => {
  const s = session({ askModel: () => new Promise(() => {}) });
  const result = await s.start({ context: {}, timeoutMs: 1000 });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'NO_QUESTION_IN_TIME');
  assert.ok(s.pendingCount() > 0);
});

test('sesiones distintas no comparten estado', async () => {
  const ask = async (model) => ({ question: `p${model}?` });
  const a = session({ askModel: ask, sessionId: 'a' });
  const b = session({ askModel: ask, sessionId: 'b' });
  await a.start({ context: {} });
  a.recordAnswer('solo en a');
  assert.equal(b.snapshot().answers.length, 0);
  assert.equal(b.snapshot().turn, 0);
});

test('al terminar la sesión se limpia y se ignoran resultados tardíos', async () => {
  const late = deferred();
  const s = session({ askModel: () => late.promise });
  s.dispose();
  late.resolve({ question: 'tarde?' });
  await tick();
  assert.equal(s.isDisposed(), true);
  assert.equal(s.snapshot().reserved.length, 0);
  assert.equal(s.pendingCount(), 0);
});

test('si todos fallan hay error recuperable y luego se puede reintentar', async () => {
  let fail = true;
  const s = session({ askModel: async (model) => { if (fail) throw new Error('HTTP 502'); return { question: `p${model}?` }; } });
  assert.equal((await s.start({ context: {}, timeoutMs: 500 })).ok, false);
  fail = false;
  assert.equal((await s.start({ context: {}, timeoutMs: 1000 })).ok, true);
});

test('la misma pregunta no se reserva ni se formula dos veces', async () => {
  const s = session({ askModel: async () => ({ question: 'repetida?' }) });
  await s.start({ context: {} });
  await tick();
  assert.equal(s.snapshot().reserved.filter((i) => i.question === 'repetida?').length, 0);
  const next = await s.next({ context: {}, timeoutMs: 500 });
  assert.equal(next.ok, false);
  assert.equal(s.snapshot().asked.length, 1);
});

test('16) el contexto de next() conserva cfg/theme (regresion aggressiveness)', async () => {
  const seen = [];
  const session = createInterviewSession({
    sessionId: 's1',
    models: ['m1'],
    askModel: async (model, context) => {
      seen.push(context);
      return { question: '¿Pregunta?', model, ms: 1 };
    },
  });
  const cfg = { aggressiveness: 'ALTA', followUps: 1, questionCount: 3, interviewerRole: '' };
  await session.next({ context: { theme: { title: 'T', context: 'C' }, history: [], cfg }, timeoutMs: 300 });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].cfg.aggressiveness, 'ALTA', 'el contexto despachado lleva la configuracion del escenario');
  assert.ok(seen[0].theme, 'el contexto despachado lleva el tema');
  assert.equal(seen[0].kind, 'normal');
});
test('17) la repregunta despacha pregunta principal, foco y estado de transcripción', async () => {
  const seen = [];
  const session = createInterviewSession({
    sessionId: 's1',
    models: ['m1'],
    askModel: async (model, context) => {
      seen.push(context);
      return { question: '¿Cuándo avisaron a la autoridad?', model, ms: 1 };
    },
  });
  const cfg = { aggressiveness: 'MEDIA', followUps: 1, questionCount: 3, interviewerRole: '' };
  const context = { theme: { title: 'T', context: 'C' }, history: [], cfg };
  await session.next({
    needsFollowUp: true,
    originAnswer: 'Hubo una explosión y avisamos a la autoridad.',
    focus: 'cuándo avisaron',
    mainQuestion: '¿Qué ocurrió?',
    hasTranscript: true,
    budget: 'habitual',
    context,
    timeoutMs: 300,
  });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].kind, 'followup', 'el tipo REAL viaja en el contexto');
  assert.equal(seen[0].mainQuestion, '¿Qué ocurrió?');
  assert.equal(seen[0].focus, 'cuándo avisaron');
  assert.equal(seen[0].hasTranscript, true);
  assert.match(seen[0].originAnswer, /explosión/);
  assert.equal(seen[0].cfg.aggressiveness, 'MEDIA', 'sigue conservando la configuración del escenario');
});

test('18) sin transcripción la repregunta viaja igual, con el estado explícito', async () => {
  const seen = [];
  const session = createInterviewSession({
    sessionId: 's1',
    models: ['m1'],
    askModel: async (model, context) => {
      seen.push(context);
      return { question: '¿Puede concretar el punto central?', model, ms: 1 };
    },
  });
  await session.next({
    needsFollowUp: true,
    originAnswer: '',
    focus: null,
    mainQuestion: '¿Qué ocurrió?',
    hasTranscript: false,
    budget: 'clarity',
    context: { theme: { title: 'T', context: 'C' }, history: [], cfg: { aggressiveness: 'MEDIA', followUps: 1 } },
    timeoutMs: 300,
  });
  assert.equal(seen[0].kind, 'followup');
  assert.equal(seen[0].hasTranscript, false);
  assert.equal(seen[0].originAnswer, '');
});


