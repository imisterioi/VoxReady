// E1: integracion de la evaluacion adaptativa en el flujo real (Prisma y modelos simulados).
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const authPath = require.resolve('../auth');
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: { requireAuth: () => (req, res, next) => { req.user = { id: 'u1' }; next(); } },
};

const registerInterviewerRoutes = require('../routes/interviewer');
const { decideTurn, cleanHistory } = require('../routes/interviewer');
const { createInterviewSession } = require('../lib/interviewSession');
const { parseAssessment, ruleDecision } = require('../ai/answerAssessment');
const { turnPlan, normalizeInterviewConfig } = require('../ai/interviewConfig');

const theme = (interviewConfig) => ({ title: 'Accidente', context: 'planta', keyMessages: '', redLines: '', interviewConfig });
const SESSIONS = {
  s1: { id: 's1', userId: 'u1', score: null, theme: theme({ questionCount: 3, followUps: 1, aggressiveness: 'MEDIA' }) },
  s0: { id: 's0', userId: 'u1', score: null, theme: theme({ questionCount: 3, followUps: 0, aggressiveness: 'BAJA' }) },
  big: { id: 'big', userId: 'u1', score: null, theme: theme({ questionCount: 12, followUps: 3, aggressiveness: 'EXTREMA' }) },
};
const prisma = { session: { findUnique: async ({ where }) => SESSIONS[where.id] || null } };

const freshRegistry = () => {
  const map = new Map();
  return { getOrCreate: (id, build) => { if (!map.has(id)) map.set(id, build()); return map.get(id); }, touch: () => {}, get: (id) => map.get(id) || null };
};

let askedCount = 0;
function buildApp({ assess, askModel, registry = freshRegistry(), timeoutFor = () => 400, startWaitMs = () => 120 } = {}) {
  const app = express();
  app.use(express.json());
  registerInterviewerRoutes(app, prisma, {
    askModel: askModel || (async (model) => ({ question: `Pregunta ${++askedCount} de ${model}`, model, ms: 1 })),
    models: () => ['m1'], timeoutFor, registry, questionAllowed: () => true, startWaitMs,
    assess: assess || (async () => ({ status: 'sufficient', source: 'test', ms: 1 })),
    assessTimeoutMs: () => 200,
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

const ANSWER = (text) => ([{ role: 'interviewer', text: 'Por que murio el trabajador?' }, { role: 'vocero', text }]);
const suficient = async () => ({ status: 'sufficient', source: 'test', ms: 1 });

test('E1-1 respuesta suficiente: avanza sin repregunta', async () => {
  const { app } = buildApp({ assess: suficient });
  await call(app, { sessionId: 's1', history: [] });
  const res = await call(app, { sessionId: 's1', history: ANSWER('Se cerro la planta a las 9 y avisamos en 20 minutos') });
  assert.equal(res.status, 200);
  assert.equal(res.body.decision.action, 'advance');
  assert.equal(res.body.decision.reason, 'respuesta_suficiente');
});

test('E1-2 respuesta insuficiente: repregunta con presupuesto habitual', async () => {
  const { app } = buildApp({ assess: async () => ({ status: 'partial', focus: 'cuando se reviso la maquina', source: 'test', ms: 1 }) });
  await call(app, { sessionId: 's1', history: [] });
  const res = await call(app, { sessionId: 's1', history: ANSWER('Fue un error humano') });
  assert.equal(res.body.decision.action, 'followup');
  assert.equal(res.body.decision.budget, 'habitual');
  assert.equal(res.body.kind, 'followup');
});

test('E1-3 presupuesto agotado: no genera ciclos', async () => {
  const { app } = buildApp({ assess: async () => ({ status: 'evasive', focus: 'no respondio', source: 'test', ms: 1 }) });
  await call(app, { sessionId: 's0', history: [] });
  const first = await call(app, { sessionId: 's0', history: ANSWER('no lo se') });
  assert.equal(first.body.decision.budget, 'clarity', 'sin repreguntas fijas usa la aclaracion habitual');
  const second = await call(app, {
    sessionId: 's0',
    history: [...ANSWER('no lo se'), { role: 'interviewer', text: 'x' }, { role: 'vocero', text: 'no lo se' }],
  });
  assert.equal(second.body.decision.action, 'advance');
  assert.match(second.body.decision.reason, /presupuesto_agotado/);
});

test('E1-4 fallo de todos los modelos: contingencia, nunca suficiencia', async () => {
  const { app } = buildApp({ assess: async () => ({ status: 'unevaluable', source: 'ai-failed', reason: 'timeout', ms: 1 }) });
  await call(app, { sessionId: 's1', history: [] });
  const res = await call(app, { sessionId: 's1', history: ANSWER('Fue un error humano') });
  assert.equal(res.body.decision.action, 'followup');
  assert.equal(res.body.decision.budget, 'contingency');
});

test('E1-5 JSON invalido: se rechaza', () => {
  assert.equal(parseAssessment('no es json', { answer: 'algo' }), null);
  assert.equal(parseAssessment('{"status":"sorprendido","focus":"x"}', { answer: 'algo' }), null);
  assert.equal(parseAssessment('{"status":"partial"}', { answer: 'algo' }), null, 'partial sin focus es invalido');
});

test('E1-6 reserva obsoleta: no se entrega', async () => {
  let n = 0;
  const session = createInterviewSession({
    sessionId: 'r1', models: ['a', 'b', 'c'], timeoutMs: 100,
    askModel: async (model) => ({ question: `q${++n}`, model, ms: 1 }),
  });
  await session.prewarm({ context: {}, rounds: 1, waitPerRoundMs: 60 });
  assert.equal(session.snapshot().reserved.length, 3);
  assert.equal((await session.start({ context: {}, timeoutMs: 200 })).question, 'q1');
  assert.equal((await session.next({ context: {}, timeoutMs: 200 })).question, 'q2');
  const third = await session.next({ context: {}, timeoutMs: 200 });
  assert.notEqual(third.question, 'q3', 'la reserva de una principal ya pasada no se reutiliza');
  assert.equal(session.snapshot().mainsAsked, 3);
});

test('E1-7 configuracion que excede 30 turnos: 422 sin recortes', async () => {
  const { app } = buildApp();
  const res = await call(app, { sessionId: 'big', history: [] });
  assert.equal(res.status, 422);
  assert.equal(res.body.code, 'INTERVIEW_CONFIG_INVALID');
  assert.equal(res.body.limit, 30);
  assert.equal(res.body.potential, 84);
});

test('E1-8 configuracion valida: conserva exactamente las preguntas principales', async () => {
  const { app } = buildApp({ assess: suficient });
  let history = [];
  const mains = [];
  for (let i = 0; i < 3; i += 1) {
    const res = await call(app, { sessionId: 's1', history });
    assert.equal(res.status, 200);
    mains.push(res.body.mainsAsked);
    history = [...history, { role: 'interviewer', text: res.body.question }, { role: 'vocero', text: 'respuesta completa y pertinente' }];
  }
  assert.deepEqual(mains, [1, 2, 3], 'tres principales exactas, sin recortes');
  const done = await call(app, { sessionId: 's1', history });
  assert.equal(done.status, 409);
  assert.equal(done.body.done, true);
});

test('E1-9 solicitud repetida: no duplica respuestas ni turnos', async () => {
  const { app, registry } = buildApp({ assess: suficient });
  await call(app, { sessionId: 's1', history: [] });
  const body = { sessionId: 's1', history: ANSWER('respuesta completa') };
  await call(app, body);
  await call(app, body);
  assert.equal(registry.get('s1').session.snapshot().answers.length, 1, 'la misma respuesta no se registra dos veces');
});

test('E1-10 orden correcto: primera principal, luego repregunta', async () => {
  const { app } = buildApp({ assess: async (input) => ({ status: input.answer ? 'partial' : 'sufficient', focus: 'falta', source: 'test', ms: 1 }) });
  const first = await call(app, { sessionId: 's1', history: [] });
  assert.equal(first.body.kind, 'normal');
  assert.equal(first.body.mainsAsked, 1);
  const second = await call(app, { sessionId: 's1', history: ANSWER('algo vago') });
  assert.equal(second.body.kind, 'followup');
  assert.equal(second.body.mainsAsked, 1, 'la repregunta no cuenta como principal');
});

test('E1 decideTurn: prioridades y topes', () => {
  const base = { habitual: 1, clarity: 0, extraordinary: 1, contingency: 1, perMain: 3 };
  assert.equal(decideTurn({ assessment: { status: 'sufficient' }, budget: base }).action, 'advance');
  assert.equal(decideTurn({ assessment: { status: 'unevaluable' }, budget: base }).budget, 'contingency');
  assert.equal(decideTurn({ assessment: { status: 'unevaluable' }, budget: base, used: { contingency: 1 } }).action, 'advance');
  assert.equal(decideTurn({ assessment: { status: 'contradiction' }, budget: base, used: { habitual: 1 } }).budget, 'extraordinary');
  assert.equal(decideTurn({ assessment: { status: 'evasive' }, budget: base, used: { habitual: 1, extraordinary: 1 } }).action, 'advance');
});


// --- E3: transcripción por respuesta (silencio real vs. fallo de transcripción) ---

test('E3-1 clasificación: silencio real vs. transcripción no disponible', () => {
  // Silencio real: sin voz detectada (o sin marca de voz).
  assert.deepEqual(ruleDecision({ answer: '' }), { status: 'empty', reason: 'respuesta_vacia' });
  assert.deepEqual(ruleDecision({ answer: '   ', spoke: false }), { status: 'empty', reason: 'respuesta_vacia' });
  // Se detectó voz pero no hay transcripción utilizable: NO es silencio ni respuesta suficiente.
  assert.deepEqual(ruleDecision({ answer: '', spoke: true }), { status: 'no_transcript', reason: 'transcripcion_no_disponible' });
  assert.deepEqual(ruleDecision({ answer: '', spoke: true, hasTranscript: false }), { status: 'no_transcript', reason: 'transcripcion_no_disponible' });
  // Con texto real, la marca de voz no altera las reglas normales.
  assert.equal(ruleDecision({ answer: 'Hubo una explosión y avisamos a la autoridad', spoke: true, hasTranscript: true }), null);
  assert.equal(ruleDecision({ answer: 'eh, este, bueno', spoke: true, hasTranscript: true }).reason, 'solo_muletillas');
});

test('E3-2 decideTurn: transcripción no disponible usa UNA aclaración y luego avanza', () => {
  const budget = { habitual: 2, clarity: 1, extraordinary: 1, contingency: 1, perMain: 5 };
  const first = decideTurn({ assessment: { status: 'no_transcript' }, budget });
  assert.equal(first.action, 'followup');
  assert.equal(first.budget, 'clarity', 'no gasta repreguntas habituales ni extraordinarias');
  // Agotada la aclaración: se avanza sin inventar el contenido.
  const second = decideTurn({ assessment: { status: 'no_transcript' }, budget, used: { clarity: 1 } });
  assert.equal(second.action, 'advance');
  assert.equal(second.unresolved, true);
  // Nunca se trata como suficiente.
  assert.notEqual(decideTurn({ assessment: { status: 'no_transcript' }, budget }).action, 'advance');
});

test('E3-3 cleanHistory conserva la marca de voz y sanea la procedencia', () => {
  const cleaned = cleanHistory([
    { role: 'interviewer', text: 'P1', spoke: true, transcriptSource: 'live' },
    { role: 'vocero', text: '', spoke: true, transcriptSource: 'LIVE' },
    { role: 'vocero', text: 'ok', transcriptSource: 'inventado' },
    { role: 'vocero', text: 'ok', spoke: false },
  ]);
  assert.deepEqual(cleaned[0], { role: 'interviewer', text: 'P1' }, 'el entrevistador no lleva marcas de voz');
  assert.deepEqual(cleaned[1], { role: 'vocero', text: '', spoke: true, transcriptSource: 'live' });
  assert.deepEqual(cleaned[2], { role: 'vocero', text: 'ok' }, 'procedencia desconocida: se descarta');
  assert.deepEqual(cleaned[3], { role: 'vocero', text: 'ok' }, 'sin voz detectada no se añade la marca');
});

test('E3-5 la comprobación anticipada de evaluadores no bloquea ni se duplica', async () => {
  const health = require('../lib/evaluatorHealth');
  const previousKey = process.env.NVIDIA_API_KEY;
  const previousTimeout = process.env.AI_EVAL_PROBE_TIMEOUT_MS;
  const realFetch = global.fetch;
  const probes = [];
  process.env.NVIDIA_API_KEY = 'clave-de-prueba';
  process.env.AI_EVAL_PROBE_TIMEOUT_MS = '30'; // la sonda se aborta sola: no deja temporizadores vivos
  // El proveedor de IA "nunca responde": si el precalentamiento o la pregunta la esperaran, la
  // petición se colgaría. El resto de URLs (servidor de pruebas) usan el fetch real.
  global.fetch = async (url, init) => {
    if (!String(url).includes('integrate.api.nvidia.com')) return realFetch(url, init);
    probes.push(String(url));
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
  };
  try {
    health.reset();
    const { app } = buildApp({});
    const prewarm = await call(app, { sessionId: 's1', history: [] }, '/api/interviewer/prewarm');
    assert.equal(prewarm.status, 200, 'el precalentamiento responde sin esperar la sonda');
    // Una sonda por modelo EVALUADOR habilitado (todos se comprueban), en segundo plano.
    const { evaluatorModels } = require('../lib/evaluatorModels');
    assert.equal(probes.length, evaluatorModels().length, 'la sonda se lanza en segundo plano');

    // Repetir precalentamiento y varias preguntas no multiplica sondas (intervalo mínimo).
    await call(app, { sessionId: 's1', history: [] }, '/api/interviewer/prewarm');
    const next = await call(app, { sessionId: 's1', history: [] });
    assert.equal(next.status, 200, 'la pregunta se genera sin esperar la sonda');
    await call(app, { sessionId: 's1', history: [] });
    assert.equal(probes.length, evaluatorModels().length, 'no se duplican comprobaciones por preguntas ni repeticiones');
  } finally {
    global.fetch = realFetch;
    health.reset();
    if (previousKey === undefined) delete process.env.NVIDIA_API_KEY;
    else process.env.NVIDIA_API_KEY = previousKey;
    if (previousTimeout === undefined) delete process.env.AI_EVAL_PROBE_TIMEOUT_MS;
    else process.env.AI_EVAL_PROBE_TIMEOUT_MS = previousTimeout;
  }
});

test('E3-4 el entrevistador recibe spoke/hasTranscript de la última respuesta', async () => {
  const seen = [];
  const { app } = buildApp({
    assess: async (args) => { seen.push(args); return { status: 'sufficient', source: 'test', ms: 1 }; },
  });
  const noTranscript = await call(app, {
    sessionId: 's1',
    history: [{ role: 'interviewer', text: '¿Qué ocurrió?' }, { role: 'vocero', text: '', spoke: true, transcriptSource: 'unavailable' }],
  });
  assert.equal(noTranscript.status, 200);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].spoke, true);
  assert.equal(seen[0].hasTranscript, false);
  assert.equal(seen[0].answer, '');

  const withTranscript = [];
  const { app: app2 } = buildApp({
    assess: async (args) => { withTranscript.push(args); return { status: 'sufficient', source: 'test', ms: 1 }; },
  });
  const ok = await call(app2, {
    sessionId: 's1',
    history: [
      { role: 'interviewer', text: '¿Qué ocurrió?' },
      { role: 'vocero', text: 'Hubo una explosión y avisamos a la autoridad de inmediato.', spoke: true, transcriptSource: 'live' },
    ],
  });
  assert.equal(ok.status, 200);
  assert.equal(withTranscript[0].spoke, true);
  assert.equal(withTranscript[0].hasTranscript, true);
  assert.match(withTranscript[0].answer, /explosión/);
});

// --- E3-6/E3-7: rama de error recuperable (`!result.ok`) ---
//
// Rama de error recuperable: la traza `no-question` y el 502 deben propagarse con su motivo, sin
// acceder a `entry` fuera de su ámbito (la rama de sesión).
// Estas pruebas fuerzan los dos códigos posibles (`NO_QUESTION_IN_TIME` y `NO_FOLLOWUP_IN_TIME`).

const CFG_SESION = normalizeInterviewConfig({ questionCount: 3, followUps: 1, aggressiveness: 'MEDIA' });

// Captura las trazas `[IA]` y los errores del manejador durante una petición.
async function captureLogs(run) {
  const traces = [];
  const errors = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args) => {
    if (args[0] === '[IA]' && typeof args[2] === 'string') {
      try {
        traces.push(JSON.parse(args[2]));
      } catch {
        /* traza no JSON: se ignora */
      }
    }
  };
  console.error = (...args) => {
    errors.push(args.map((item) => String(item)).join(' '));
  };
  try {
    return await run({ traces, errors });
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

test('E3-6 sin pregunta a tiempo: 502 con traza no-question (NO_QUESTION_IN_TIME)', async () => {
  // `askModel` nunca responde y la espera de arranque es mínima: la primera pregunta no llega.
  const never = () => new Promise(() => {});
  const { app } = buildApp({ askModel: never, startWaitMs: () => 5 });

  const { res, traces, errors } = await captureLogs(async (captured) => {
    const response = await call(app, { sessionId: 's1', history: [] });
    return { res: response, ...captured };
  });

  assert.equal(res.status, 502, 'el error recuperable responde 502');
  assert.equal(res.body.mensaje, 'El entrevistador IA no respondió. Intenta de nuevo.');
  assert.ok(!errors.some((line) => line.includes('entry is not defined')), 'no debe lanzar ReferenceError');
  assert.ok(!errors.some((line) => line.includes('Error generando pregunta')), 'no debe caer en el catch genérico');

  const trace = traces.find((item) => item.event === 'no-question');
  assert.ok(trace, 'debe registrar la traza no-question');
  assert.equal(trace.code, 'NO_QUESTION_IN_TIME');
  assert.equal(trace.phase, turnPlan(CFG_SESION, 0).kind, 'la fase es el tipo de turno planificado');
  assert.equal(trace.turn, 0, 'la traza lleva el snapshot real de la sesión');
  assert.equal(trace.models, 1);
  assert.ok(Number.isFinite(trace.ms));
});

test('E3-7 sin repregunta a tiempo: 502 con traza no-question (NO_FOLLOWUP_IN_TIME)', async () => {
  // Respuesta parcial → la regla pide repregunta; la espera es mínima y la repregunta no llega.
  const { app } = buildApp({
    askModel: () => new Promise(() => {}),
    timeoutFor: () => 5,
    assess: async () => ({ status: 'partial', focus: 'aclarar el punto pendiente', source: 'test', ms: 1 }),
  });

  const history = [
    { role: 'interviewer', text: '¿Qué ocurrió?' },
    { role: 'vocero', text: 'Hubo un incidente y activamos el protocolo.' },
  ];
  const { res, traces, errors } = await captureLogs(async (captured) => {
    const response = await call(app, { sessionId: 's1', history });
    return { res: response, ...captured };
  });

  assert.equal(res.status, 502);
  assert.equal(res.body.mensaje, 'El entrevistador IA no respondió. Intenta de nuevo.');
  assert.ok(!errors.some((line) => line.includes('entry is not defined')), 'no debe lanzar ReferenceError');

  const trace = traces.find((item) => item.event === 'no-question');
  assert.ok(trace, 'debe registrar la traza no-question');
  assert.equal(trace.code, 'NO_FOLLOWUP_IN_TIME');
  assert.equal(trace.phase, turnPlan(CFG_SESION, 1).kind);
  assert.equal(trace.turn, 1, 'la sesión quedó en el turno 1 (una pregunta formulada)');
});

