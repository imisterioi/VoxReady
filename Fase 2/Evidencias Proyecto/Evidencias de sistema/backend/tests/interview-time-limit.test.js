// E2: cierre de la entrevista por TIEMPO (determinista: reloj e inactividad inyectados).
//
// La ruta acepta `now`/`sleep` inyectables (el mismo diseño que `lib/interviewSession.js`), así
// que estas pruebas controlan el cronómetro con un reloj simulado: no hay esperas reales ni
// llamadas a modelos (todo lo que consulta IA está inyectado).
//
// Se fijan el coste por turno y el margen ANTES de cargar los módulos para que el resultado no
// dependa del entorno de quien ejecuta las pruebas: son exactamente los valores por defecto.
process.env.INTERVIEW_MS_PER_TURN = '40000';
process.env.INTERVIEW_EXTRA_MARGIN_MS = '120000';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const authPath = require.resolve('../auth');
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: { requireAuth: () => (req, res, next) => { req.user = { id: 'u1' }; next(); } },
};

const registerInterviewerRoutes = require('../routes/interviewer');
const { INTERVIEW_TIMING } = require('../ai/interviewConfig');

const MS_PER_TURN = INTERVIEW_TIMING.msPerTurn;
const MINUTE = 60000;
const PREWARM = '/api/interviewer/prewarm';
const SUFFICIENT = async () => ({ status: 'sufficient', source: 'test', ms: 1 });

// Reloj simulado: `sleep` avanza el tiempo, así que los ciclos de espera de la sesión terminan
// sin esperar de verdad y el cronómetro de la entrevista queda bajo control de la prueba.
function fakeClock(start = 1_000_000) {
  let current = start;
  return { now: () => current, advance: (ms) => { current += ms; }, sleep: async (ms) => { current += ms; } };
}

const freshRegistry = () => {
  const map = new Map();
  return {
    getOrCreate: (id, build) => { if (!map.has(id)) map.set(id, build()); return map.get(id); },
    touch: () => {},
    get: (id) => map.get(id) || null,
  };
};

function harness({ interviewConfig, assess = SUFFICIENT, clock = fakeClock() } = {}) {
  const sessions = {
    s1: { id: 's1', userId: 'u1', score: null, theme: { title: 'Crisis', context: 'planta', keyMessages: '', redLines: '', interviewConfig } },
  };
  const prisma = { session: { findUnique: async ({ where }) => sessions[where.id] || null } };
  const registry = freshRegistry();
  const calls = { ask: 0, assess: 0 };
  const app = express();
  app.use(express.json());
  registerInterviewerRoutes(app, prisma, {
    // Nunca se llama a un modelo real: se cuenta cuántas preguntas se pidieron.
    askModel: async (model) => { calls.ask += 1; return { question: `¿Pregunta ${calls.ask}?`, model, ms: 1 }; },
    models: () => ['m1'],
    timeoutFor: () => 400,
    registry,
    questionAllowed: () => true,
    startWaitMs: () => 120,
    now: clock.now,
    sleep: clock.sleep,
    assess: async (input) => { calls.assess += 1; return assess(input); },
    assessTimeoutMs: () => 200,
  });
  return { app, registry, calls, clock };
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

const history = (question, answer) => [{ role: 'interviewer', text: question }, { role: 'vocero', text: answer }];

test('E2-1 con tiempo suficiente la entrevista continúa con normalidad', async () => {
  const { app, registry, clock } = harness({ interviewConfig: { questionCount: 3, followUps: 0, estimatedMinutes: 120 } });
  const first = await call(app, { sessionId: 's1', history: [] });
  assert.equal(first.status, 200);
  assert.equal(first.body.done, false);

  clock.advance(MINUTE); // 1 minuto de los 120 configurados
  const second = await call(app, { sessionId: 's1', history: history(first.body.question, 'respuesta suficiente') });
  assert.equal(second.status, 200);
  assert.ok(second.body.question, 'se entrega la siguiente pregunta');
  assert.equal(second.body.done, false);
  assert.equal(second.body.closeReason, undefined, 'no hay cierre');
  assert.equal(second.body.mainsAsked, 2);
  assert.equal(registry.get('s1').session.snapshot().closeReason, null);
});

test('E2-2 sin tiempo para otra intervención se cierra con done:true y TIME_LIMIT', async () => {
  const { app, registry, calls, clock } = harness({ interviewConfig: { questionCount: 3, followUps: 0, estimatedMinutes: 1 } });
  const first = await call(app, { sessionId: 's1', history: [] });
  const askedBefore = calls.ask;

  clock.advance(MS_PER_TURN * 2); // ya no cabe otro turno en el minuto configurado
  const res = await call(app, { sessionId: 's1', history: history(first.body.question, 'respuesta real') });

  assert.equal(res.status, 200);
  assert.equal(res.body.done, true);
  assert.equal(res.body.closeReason, 'TIME_LIMIT');
  assert.equal(res.body.question, null, 'no se entrega una pregunta nueva');
  assert.equal(res.body.decision.action, 'close');
  assert.equal(calls.ask, askedBefore, 'el cierre por tiempo NO solicita otra pregunta a la IA');
  assert.ok(res.body.elapsedMs >= MS_PER_TURN * 2, 'el tiempo transcurrido es el de la sesión');
  assert.equal(registry.get('s1').session.snapshot().closeReason, 'TIME_LIMIT');
});

test('E2-3 la respuesta que provoca el cierre se registra y evalúa antes de finalizar', async () => {
  const { app, registry, calls, clock } = harness({ interviewConfig: { questionCount: 3, followUps: 0, estimatedMinutes: 1 } });
  const first = await call(app, { sessionId: 's1', history: [] });
  const assessBefore = calls.assess;

  clock.advance(MS_PER_TURN * 2);
  const res = await call(app, { sessionId: 's1', history: history(first.body.question, 'la planta se cerró a las nueve') });

  assert.equal(res.body.done, true);
  assert.equal(calls.assess, assessBefore + 1, 'la respuesta de la petición que cierra sí se evaluó');
  assert.equal(res.body.assessment.status, 'sufficient');

  const snapshot = registry.get('s1').session.snapshot();
  assert.equal(snapshot.answers.length, 1);
  assert.equal(snapshot.answers[0].text, 'la planta se cerró a las nueve');
  assert.equal(snapshot.resolutions.length, 1, 'la evaluación queda registrada');
  assert.equal(snapshot.resolutions[0].status, 'sufficient');
});

test('E2-5 las principales no realizadas quedan en pendingMains y no se marcan como respondidas', async () => {
  const { app, registry, clock } = harness({ interviewConfig: { questionCount: 3, followUps: 0, estimatedMinutes: 1 } });
  const first = await call(app, { sessionId: 's1', history: [] });

  clock.advance(MS_PER_TURN * 2);
  const res = await call(app, { sessionId: 's1', history: history(first.body.question, 'respuesta real') });

  assert.equal(res.body.pendingMains, 2);
  assert.equal(res.body.mainsAsked, 1);
  assert.equal(res.body.mainsTotal, 3);

  const snapshot = registry.get('s1').session.snapshot();
  assert.equal(snapshot.asked.length, 1, 'solo se formuló una pregunta principal');
  assert.equal(snapshot.mainsAsked, 1, 'las pendientes no cuentan como realizadas');
  assert.equal(snapshot.answers.length, 1, 'no se inventan respuestas para las pendientes');
});

test('E2-6 el cronómetro es de la entrevista completa: no se reinicia al cambiar de tema ni al repreguntar', async () => {
  let evaluation = 0;
  const { app, registry, clock } = harness({
    interviewConfig: { questionCount: 3, followUps: 1, estimatedMinutes: 2 },
    // La primera respuesta es insuficiente (repregunta); las demás, suficientes.
    assess: async () => (++evaluation === 1 ? { status: 'partial', focus: 'aclarar', source: 'test', ms: 1 } : { status: 'sufficient', source: 'test', ms: 1 }),
  });

  const turns = [];
  const step = async (answer, advanceMs) => {
    if (advanceMs) clock.advance(advanceMs);
    const res = await call(app, {
      sessionId: 's1',
      history: turns.flatMap((t) => [{ role: 'interviewer', text: t.question }, { role: 'vocero', text: t.answer }]),
    });
    if (res.status === 200) turns.push({ question: res.body.question, answer });
    return res;
  };

  const first = await call(app, { sessionId: 's1', history: [] });
  turns.push({ question: first.body.question, answer: 'algo vago' });

  const second = await step('algo vago', MINUTE / 2); // 30 s
  assert.equal(second.body.kind, 'followup');
  assert.equal(second.body.done, false, 'la repregunta no cierra la entrevista');

  const third = await step('ahora completo', MINUTE / 2); // 60 s acumulados
  assert.equal(third.body.kind, 'normal');
  assert.equal(third.body.mainsAsked, 2, 'cambió de tema (nueva principal) sin reiniciar el cronómetro');
  assert.equal(third.body.done, false);

  const fourth = await step('respuesta final', MINUTE / 2); // 90 s acumulados de 120 s
  assert.equal(fourth.status, 200, 'a 90 s de 120 s la entrevista continúa');
  assert.equal(fourth.body.done, false, 'no se cierra por reservar tiempo para el siguiente turno');

  const fifth = await step('respuesta final', MINUTE / 2); // 120 s acumulados = límite
  assert.equal(fifth.body.done, true);
  assert.equal(fifth.body.closeReason, 'TIME_LIMIT');
  assert.ok(fifth.body.elapsedMs >= MINUTE * 2, 'el cierre usa el tiempo acumulado desde la primera pregunta');
  assert.equal(registry.get('s1').session.snapshot().answers.length, 4);
});

test('E2-7 una sesión cerrada no genera preguntas nuevas ni reutiliza reservas precargadas', async () => {
  const { app, registry, calls, clock } = harness({ interviewConfig: { questionCount: 3, followUps: 0, estimatedMinutes: 1 } });

  // Precalentamiento: deja reservas listas ANTES del cierre.
  const prewarm = await call(app, { sessionId: 's1', history: [] }, PREWARM);
  assert.equal(prewarm.status, 200);
  const session = registry.get('s1').session;
  const reservedBefore = session.snapshot().reserved.length;
  assert.ok(reservedBefore >= 1, 'el precalentamiento dejó reservas');

  const first = await call(app, { sessionId: 's1', history: [] });
  assert.equal(first.status, 200);
  clock.advance(MS_PER_TURN * 2);
  const closing = await call(app, { sessionId: 's1', history: history(first.body.question, 'respuesta real') });
  assert.equal(closing.body.done, true);
  assert.equal(closing.body.closeReason, 'TIME_LIMIT');

  const askedAtClose = calls.ask;
  const turnAtClose = session.snapshot().turn;

  // Otra petición sobre la sesión cerrada: no hay pregunta nueva ni reserva consumida.
  const after = await call(app, { sessionId: 's1', history: history(first.body.question, 'respuesta real') });
  assert.equal(after.status, 409);
  assert.equal(after.body.done, true);
  assert.equal(after.body.code, 'INTERVIEW_DONE');
  assert.equal(after.body.closeReason, 'TIME_LIMIT');
  assert.equal(calls.ask, askedAtClose, 'no se pide ninguna pregunta nueva');
  assert.equal(session.snapshot().turn, turnAtClose, 'no se consume ninguna reserva');
  assert.equal(session.snapshot().reserved.length, reservedBefore - 1, 'solo se consumió la reserva de la primera pregunta');
  assert.equal(session.snapshot().answers.length, 1, 'la respuesta repetida no se duplica');

  // El precalentamiento tampoco vuelve a lanzar tandas sobre una sesión cerrada.
  const again = await call(app, { sessionId: 's1', history: [] }, PREWARM);
  assert.equal(again.body.closed, true);
  assert.equal(calls.ask, askedAtClose, 'el precalentamiento de una sesión cerrada no consulta modelos');
});

test('E2-8 un error de evaluación se informa, no pierde la respuesta y no duplica al reintentar', async () => {
  const { app, registry } = harness({
    interviewConfig: { questionCount: 3, followUps: 0, estimatedMinutes: 60 },
    assess: async () => { throw new Error('evaluación no disponible'); },
  });
  const first = await call(app, { sessionId: 's1', history: [] });
  const body = { sessionId: 's1', history: history(first.body.question, 'respuesta real del vocero') };

  const failed = await call(app, body);
  assert.equal(failed.status, 502, 'el fallo se informa (no hay pérdida silenciosa)');
  assert.ok(failed.body.mensaje, 'el error lleva mensaje para el usuario');

  const snapshot = registry.get('s1').session.snapshot();
  assert.equal(snapshot.answers.length, 1, 'la respuesta queda registrada en la sesión');
  assert.equal(snapshot.answers[0].text, 'respuesta real del vocero');
  assert.equal(snapshot.turn, 1, 'sin evaluación no se consume turno');

  const retry = await call(app, body);
  assert.equal(retry.status, 502);
  assert.equal(registry.get('s1').session.snapshot().answers.length, 1, 'el reintento no duplica la respuesta');
});

test('E2-8b evaluación no disponible repetida: contingencia acotada, sin ciclo indefinido', async () => {
  const { app, registry } = harness({
    interviewConfig: { questionCount: 3, followUps: 0 },
    assess: async () => ({ status: 'unevaluable', source: 'test', ms: 1 }),
  });
  const first = await call(app, { sessionId: 's1', history: [] });

  const one = await call(app, { sessionId: 's1', history: history(first.body.question, 'a') });
  assert.equal(one.status, 200);
  assert.equal(one.body.decision.action, 'followup');
  assert.equal(one.body.decision.budget, 'contingency');
  assert.equal(
    registry.get('s1').session.snapshot().usedByBudget.contingency,
    1,
    'la contingencia se usa una sola vez',
  );

  const two = await call(app, {
    sessionId: 's1',
    history: [...history(first.body.question, 'a'), ...history(one.body.question, 'b')],
  });
  assert.equal(two.status, 200);
  assert.equal(two.body.decision.action, 'advance', 'sin evaluación no se repregunta sin fin');
  assert.equal(two.body.decision.reason, 'sin_evaluacion_ni_contingencia');

  const snapshot = registry.get('s1').session.snapshot();
  assert.equal(snapshot.resolutions.length, 2);
  assert.equal(snapshot.mainsAsked, 2, 'la entrevista avanza a la siguiente principal');
  assert.deepEqual(
    snapshot.usedByBudget,
    { habitual: 0, clarity: 0, extraordinary: 0, contingency: 0 },
    'al cambiar de principal se reinician los presupuestos de repregunta',
  );
});

test('E2-9 el cierre normal al completar las preguntas principales sigue funcionando', async () => {
  const { app, registry } = harness({ interviewConfig: { questionCount: 2, followUps: 0 } });

  const first = await call(app, { sessionId: 's1', history: [] });
  assert.equal(first.status, 200);

  const second = await call(app, { sessionId: 's1', history: history(first.body.question, 'a') });
  assert.equal(second.status, 200);
  assert.equal(second.body.mainsAsked, 2);
  // Completar las principales NO cierra la entrevista por si solo: la peticion siguiente evalua la
  // ultima respuesta y decide (aclaracion necesaria o cierre). Por eso `done` ya no se adelanta.
  assert.equal(second.body.done, false, 'la ultima principal se entrega sin done');

  const closing = await call(app, {
    sessionId: 's1',
    history: [...history(first.body.question, 'a'), ...history(second.body.question, 'b')],
  });
  assert.equal(closing.status, 409);
  assert.equal(closing.body.done, true);
  assert.equal(closing.body.code, 'INTERVIEW_DONE');
  assert.equal(closing.body.closeReason, 'COMPLETED', 'cierre por preguntas completadas, no por tiempo');
  assert.equal(closing.body.pendingMains, 0);
  assert.equal(registry.get('s1').session.snapshot().closeReason, 'COMPLETED');

  // Repetir la peticion sobre una entrevista ya cerrada no genera preguntas nuevas.
  const again = await call(app, {
    sessionId: 's1',
    history: [...history(first.body.question, 'a'), ...history(second.body.question, 'b')],
  });
  assert.equal(again.status, 409);
  assert.equal(again.body.done, true);
});

test('E2-10 una solicitud repetida no duplica la respuesta registrada', async () => {
  // Limitación conocida: el mecanismo actual protege la RESPUESTA registrada (una sola vez por
  // texto del historial); la evaluación de suficiencia se vuelve a ejecutar en el reintento.
  const { app, registry } = harness({ interviewConfig: { questionCount: 3, followUps: 0 } });
  const first = await call(app, { sessionId: 's1', history: [] });
  const body = { sessionId: 's1', history: history(first.body.question, 'respuesta completa') };

  const one = await call(app, body);
  const two = await call(app, body);
  assert.equal(one.status, 200);
  assert.equal(two.status, 200);

  const snapshot = registry.get('s1').session.snapshot();
  assert.equal(snapshot.answers.filter((item) => item.text === 'respuesta completa').length, 1, 'la misma respuesta no se registra dos veces');
  assert.equal(snapshot.mainsAsked, 3, 'cada solicitud avanza a lo sumo una principal');
});

// ------------------------------- Regresion: repreguntas adaptativas y cierre normal (E2-11..E2-14)

// Evaluacion inyectada: "vaga" es insuficiente (obliga a repreguntar), cualquier otra es suficiente.
const ANSWER_ASSESS = async ({ answer }) =>
  String(answer).includes('vaga')
    ? { status: 'partial', focus: 'aclarar', source: 'test', ms: 1 }
    : { status: 'sufficient', source: 'test', ms: 1 };

// Simula al frontend: pide la primera pregunta y luego encadena respuestas con el historial real.
async function drive(app, registry, answers) {
  const turns = [];
  const responses = [await call(app, { sessionId: 's1', history: [] })];
  let question = responses[0].body.question;
  for (const answer of answers) {
    if (!question) break;
    turns.push({ question, answer });
    const res = await call(app, {
      sessionId: 's1',
      history: turns.flatMap((t) => [{ role: 'interviewer', text: t.question }, { role: 'vocero', text: t.answer }]),
    });
    responses.push(res);
    if (res.status !== 200) break;
    question = res.body.question;
  }
  return { responses, snapshot: registry.get('s1').session.snapshot() };
}

test('E2-11 (regresión) 5 principales + 2 repreguntas adaptativas NO cierran la entrevista con 3 principales', async () => {
  const { app, registry } = harness({ interviewConfig: { questionCount: 5, followUps: 0 }, assess: ANSWER_ASSESS });
  const { responses, snapshot } = await drive(app, registry, ['vaga', 'completa', 'vaga', 'completa', 'completa', 'completa', 'completa']);

  // El defecto anterior cerraba en el turno 5 con mainsAsked = 3. Ahora la entrevista sigue: el
  // unico cierre posible es al completar las 5 principales.
  const closed = responses.find((res) => res.body.code === 'INTERVIEW_DONE');
  assert.ok(closed, 'la entrevista debe cerrar al completar las principales');
  assert.equal(closed.body.mainsAsked, 5, 'solo cierra cuando las 5 principales están hechas');
  assert.equal(snapshot.turn, 7, '5 principales + 2 repreguntas adaptativas (el conteo nominal era 5)');
  assert.equal(snapshot.mainsAsked, 5, 'se completan las 5 principales');

  const last = responses[responses.length - 1];
  assert.equal(last.status, 409);
  assert.equal(last.body.done, true);
  assert.equal(last.body.closeReason, 'COMPLETED', 'cierre por preguntas completadas');
  assert.equal(last.body.pendingMains, 0);
});

test('E2-12 la aclaración necesaria tras la ÚLTIMA principal se formula y no cuenta como principal', async () => {
  const { app, registry } = harness({ interviewConfig: { questionCount: 2, followUps: 0 }, assess: ANSWER_ASSESS });
  const first = await call(app, { sessionId: 's1', history: [] });
  const second = await call(app, { sessionId: 's1', history: history(first.body.question, 'completa') });
  assert.equal(second.body.mainsAsked, 2, 'las dos principales ya se entregaron');

  const third = await call(app, {
    sessionId: 's1',
    history: [...history(first.body.question, 'completa'), ...history(second.body.question, 'vaga')],
  });
  assert.equal(third.status, 200, 'con una aclaración necesaria la entrevista NO se cierra');
  assert.equal(third.body.kind, 'followup');
  assert.equal(third.body.mainsAsked, 2, 'la repregunta no incrementa las principales');
  assert.equal(registry.get('s1').session.snapshot().followUpsForMain, 1);

  const closing = await call(app, {
    sessionId: 's1',
    history: [
      ...history(first.body.question, 'completa'),
      ...history(second.body.question, 'vaga'),
      ...history(third.body.question, 'completa'),
    ],
  });
  assert.equal(closing.status, 409);
  assert.equal(closing.body.closeReason, 'COMPLETED');
  assert.equal(closing.body.mainsAsked, 2);
  assert.equal(closing.body.pendingMains, 0);
});

test('E2-13 si la evaluación falla tras la última principal el cierre es determinista (sin bucle)', async () => {
  const { app, registry } = harness({
    interviewConfig: { questionCount: 2, followUps: 0 },
    assess: async () => ({ status: 'unevaluable', source: 'test', ms: 1 }),
  });
  const { responses, snapshot } = await drive(app, registry, new Array(12).fill('respuesta'));

  const last = responses[responses.length - 1];
  assert.equal(last.status, 409, 'la entrevista termina: no hay bucle de repreguntas');
  assert.equal(last.body.closeReason, 'COMPLETED', 'no se infiere insuficiencia: cierre normal');
  assert.equal(last.body.pendingMains, 0);
  assert.equal(snapshot.mainsAsked, 2);
  assert.ok(responses.length <= 8, `no debe insistir indefinidamente (peticiones=${responses.length})`);
});

test('E2-14 escenario antiguo sin configuración: límite predeterminado de 5 minutos y cierre por tiempo distinguible', async () => {
  // `interviewConfig: null` es el caso de los escenarios antiguos.
  const { app, clock } = harness({ interviewConfig: null });
  const first = await call(app, { sessionId: 's1', history: [] });
  assert.equal(first.status, 200);
  assert.equal(first.body.interview.estimatedMinutes, 5, 'duración efectiva predeterminada');
  assert.equal(first.body.interview.maxDurationMs, 300000, 'el límite existe aunque no se configurara');
  assert.equal(first.body.interview.estimatedMinutesAuto, true);

  clock.advance(first.body.interview.maxDurationMs);
  const closing = await call(app, { sessionId: 's1', history: history(first.body.question, 'respuesta') });
  assert.equal(closing.body.done, true);
  assert.equal(closing.body.closeReason, 'TIME_LIMIT', 'cierre por TIEMPO, no por preguntas completadas');
  assert.ok(closing.body.pendingMains > 0, 'informa las principales pendientes');
});

test('E2-15 (regresión) no se cierra con menos de 40 s para el límite; sí al alcanzarlo', async () => {
  // Límite de 1 minuto y `msPerTurn` de 40 s: con la heurística anterior, a los 30 s (30 + 40 > 60)
  // la entrevista se cerraba aunque el tiempo transcurrido fuera inferior al máximo configurado.
  const { app, registry, clock } = harness({
    interviewConfig: { questionCount: 3, followUps: 0, estimatedMinutes: 1 },
  });
  const first = await call(app, { sessionId: 's1', history: [] });
  assert.equal(first.status, 200);

  clock.advance(30000); // 30 s de 60 s: quedan menos de 40 s
  const second = await call(app, {
    sessionId: 's1',
    history: history(first.body.question, 'respuesta completa'),
  });
  assert.equal(second.status, 200, 'a 30 s de 60 s la entrevista continúa');
  assert.equal(second.body.done, false);
  assert.equal(second.body.closeReason, undefined, 'no hay cierre por tiempo');
  assert.equal(second.body.mainsAsked, 2, 'se formuló otra pregunta principal');
  assert.ok(registry.get('s1').session.snapshot().elapsedMs < 60000, 'el tiempo transcurrido era inferior al límite');

  clock.advance(30000); // 60 s acumulados = límite alcanzado
  const third = await call(app, {
    sessionId: 's1',
    history: [...history(first.body.question, 'respuesta completa'), ...history(second.body.question, 'respuesta completa')],
  });
  assert.equal(third.status, 200);
  assert.equal(third.body.done, true, 'se cierra al alcanzar el límite');
  assert.equal(third.body.closeReason, 'TIME_LIMIT');
  assert.ok(third.body.elapsedMs >= 60000, `el cierre usa el tiempo transcurrido (${third.body.elapsedMs} ms)`);
  assert.equal(third.body.pendingMains, 1, 'informa las principales pendientes (2 de 3 realizadas)');
  // La respuesta de la petición que provoca el cierre se registró y evaluó antes de cerrar.
  assert.equal(registry.get('s1').session.snapshot().answers.length, 2);
  assert.ok(third.body.assessment, 'la evaluación de esa respuesta llegó en la misma respuesta');
});
test('E2-16 el tiempo de transcripción cuenta dentro de la duración: no reinicia ni pausa el reloj', async () => {
  // Con la transcripción por respuesta, el turno llega hasta 12 s más tarde. El cronómetro es el de
  // la sesión (servidor): no se reinicia ni se pausa, así que el cierre por tiempo se aplica igual.
  const { app, registry, clock } = harness({ interviewConfig: { questionCount: 3, followUps: 0, estimatedMinutes: 1 } });
  const first = await call(app, { sessionId: 's1', history: [] });
  const elapsedAfterFirst = registry.get('s1').session.snapshot().elapsedMs;

  clock.advance(12000); // presupuesto máximo de transcripción de una respuesta
  const second = await call(app, { sessionId: 's1', history: history(first.body.question, 'la planta se cerró a las nueve') });
  assert.equal(second.status, 200);
  assert.equal(second.body.done, false, 'dentro del minuto configurado la entrevista continúa');

  const elapsedAfterSecond = registry.get('s1').session.snapshot().elapsedMs;
  assert.ok(
    elapsedAfterSecond - elapsedAfterFirst >= 12000,
    `los 12 s de transcripción cuentan en la duración (${elapsedAfterSecond - elapsedAfterFirst} ms)`,
  );

  // Se agota el minuto: la respuesta tardía se registra y se evalúa, y después se cierra.
  clock.advance(MINUTE);
  const third = await call(app, {
    sessionId: 's1',
    history: [
      ...history(first.body.question, 'la planta se cerró a las nueve'),
      { role: 'interviewer', text: second.body.question },
      { role: 'vocero', text: 'avisamos en veinte minutos' },
    ],
  });
  assert.equal(third.body.done, true);
  assert.equal(third.body.closeReason, 'TIME_LIMIT');
  assert.equal(registry.get('s1').session.snapshot().answers.length, 2, 'la respuesta que llega tarde también se registra');
});

