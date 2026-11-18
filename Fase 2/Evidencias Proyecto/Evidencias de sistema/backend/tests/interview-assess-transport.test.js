// Transporte del CLASIFICADOR en la ruta oficial.
//
// `assessAnswer` entrega un ARRAY de mensajes ya construidos, asi que su transporte debe ser
// `askModel` (mensajes) y NO `askModelFromContext` (objeto de contexto): si se usa el adaptador de
// contexto, el clasificador viaja con el prompt del ENTREVISTADOR y su veredicto se pierde.
//
// Pruebas con `fetch` simulado y dobles locales: NINGUNA llamada real a un proveedor.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

// El entrevistador debe trabajar con UN modelo para que los conteos sean deterministas.
process.env.AI_MODEL = 'modelo-test';
process.env.AI_FALLBACK_MODEL = 'modelo-test';
process.env.AI_EXTRA_MODELS = '';

// Autenticacion simulada (mismo patron que las pruebas oficiales de la ruta).
const authPath = require.resolve('../auth');
require.cache[authPath] = {
  id: authPath,
  filename: authPath,
  loaded: true,
  exports: { requireAuth: () => (req, res, next) => { req.user = { id: 'u1', tenant: { name: 'Energia Andes', sector: 'Energia' } }; next(); } },
};

const registerInterviewerRoutes = require('../routes/interviewer');
const IV = require('../ai/interviewer');

// `fetch` REAL para hablar con el servidor Express de prueba; el global se sustituye por el doble.
const REAL_FETCH = globalThis.fetch.bind(globalThis);
test.after(() => { globalThis.fetch = REAL_FETCH; });

const ANSWER = 'Cerramos la planta a las 9 y avisamos a los vecinos en 20 minutos.';
const QUESTION = '¿Cuántos clientes siguen sin suministro y desde cuándo?';
const THEME = {
  title: 'Corte masivo de suministro',
  context: 'Corte desde las 06:00 en la zona sur.',
  keyMessages: '',
  redLines: '',
  interviewConfig: { aggressiveness: 'MEDIA', questionCount: 5, followUps: 0, estimatedMinutes: 30 },
};
const prisma = { session: { findUnique: async () => ({ id: 's1', userId: 'u1', score: null, theme: THEME }) } };

const jsonResponse = (body) => ({ ok: true, status: 200, json: async () => body });

// Doble de `fetch`: responde como un proveedor CUMPLIDOR segun el prompt que recibe.
// Cada generacion devuelve una pregunta DISTINTA: el sistema descarta repeticiones de una pregunta
// ya formulada, y con un texto constante el turno fallaria por `NO_QUESTION_IN_TIME` (artefacto del
// doble, no del sistema).
function providerDouble({ classification, question } = {}) {
  const calls = [];
  let generated = 0;
  const impl = async (url, init = {}) => {
    const body = JSON.parse(init.body || '{}');
    const system = String(body.messages?.[0]?.content || '');
    const isClassifier = system.includes('analista de entrevistas');
    calls.push({
      url: String(url),
      model: body.model,
      messagesIsArray: Array.isArray(body.messages),
      roles: Array.isArray(body.messages) ? body.messages.map((item) => item.role) : null,
      system,
      isClassifier,
      maxTokens: body.max_tokens,
      temperature: body.temperature,
    });
    if (isClassifier) {
      return jsonResponse({ choices: [{ message: { content: classification } }] });
    }
    generated += 1;
    const content = typeof question === 'function' ? question(generated) : `¿Pregunta numero ${generated} sobre el corte y el suministro?`;
    return jsonResponse({ choices: [{ message: { content } }] });
  };
  return { impl, calls };
}

function buildApp(deps = {}) {
  const app = express();
  app.use(express.json());
  registerInterviewerRoutes(app, prisma, {
    questionAllowed: () => true,
    startWaitMs: () => 200,
    timeoutFor: () => 2000,
    ...deps,
  });
  return app;
}

async function call(app, payload) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const response = await REAL_FETCH(`http://127.0.0.1:${server.address().port}/api/interviewer/next-question`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return { status: response.status, body: await response.json() };
  } finally {
    server.close();
  }
}

// Turno completo: T1 (generacion) y el turno siguiente con la respuesta del vocero (clasificacion).
async function runTurn(app, sessionId, provider, answer = ANSWER) {
  const first = await call(app, { sessionId, history: [] });
  const history = [
    { role: 'interviewer', text: first.body.question || QUESTION },
    { role: 'vocero', text: answer },
  ];
  const second = await call(app, { sessionId, history });
  return { first, second, classification: provider.calls.filter((item) => item.maxTokens === 500) };
}

test('T1) con las dependencias por defecto la ruta envia el prompt del CLASIFICADOR', async () => {
  assert.equal(IV.interviewModels().length, 1, 'precondicion: un solo modelo del entrevistador');
  const provider = providerDouble({ classification: JSON.stringify({ status: 'sufficient', focus: '', evidence: [], reason: 'ok' }) });
  globalThis.fetch = provider.impl;

  const app = buildApp(); // SIN inyectar `assess` ni `assessAskModel`
  const { second, classification } = await runTurn(app, 'T1', provider);

  assert.equal(second.status, 200);
  assert.equal(classification.length, 1, 'una clasificacion por turno');
  assert.equal(classification[0].isClassifier, true, 'el clasificador debe recibir SU prompt');
  assert.ok(!classification[0].system.includes('Método:'), 'no debe recibir el prompt del entrevistador');
  assert.equal(classification[0].messagesIsArray, true, 'el transporte recibe un ARRAY de mensajes');
  assert.deepEqual(classification[0].roles, ['system', 'user']);
  assert.equal(classification[0].maxTokens, 500);
  assert.equal(classification[0].temperature, 0.2);
  // Sintoma del defecto corregido: antes esto era `unevaluable` (+ contingencia).
  assert.equal(second.body.assessment.status, 'sufficient');
  assert.ok(String(second.body.assessment.source).startsWith('ai:'));
});

test('T2) el transporte del clasificador recibe un ARRAY y conserva raw/timeoutMs/lang', async () => {
  const provider = providerDouble({ classification: JSON.stringify({ status: 'partial', focus: 'la cifra exacta', evidence: [], reason: 'falta el dato' }) });
  globalThis.fetch = provider.impl;

  const seen = [];
  const assessAskModel = (model, messages, options = {}) => {
    seen.push({ model, messages, options });
    return IV.askModel(model, messages, options); // el global ya apunta al doble
  };
  const app = buildApp({ assessAskModel });
  const { second } = await runTurn(app, 'T2', provider);

  assert.equal(second.status, 200);
  assert.equal(seen.length, 1, 'assessAskModel se usa SOLO para el clasificador');
  assert.equal(Array.isArray(seen[0].messages), true, 'recibe un array de mensajes');
  assert.deepEqual(seen[0].messages.map((item) => item.role), ['system', 'user']);
  assert.match(String(seen[0].messages[0].content), /analista de entrevistas/);
  assert.equal(seen[0].model, 'modelo-test');
  assert.equal(seen[0].options.raw, true, 'conserva raw:true');
  assert.equal(seen[0].options.lang, 'es', 'conserva el idioma de la sesion');
  assert.equal(seen[0].options.timeoutMs, 15000, 'conserva el timeout del clasificador');
});

test('T3) JSON valido con status sufficient llega a advance', async () => {
  const provider = providerDouble({ classification: JSON.stringify({ status: 'sufficient', focus: '', evidence: [], reason: 'contesta lo pedido' }) });
  globalThis.fetch = provider.impl;

  const app = buildApp();
  const { second } = await runTurn(app, 'T3', provider);

  assert.equal(second.status, 200);
  assert.equal(second.body.assessment.status, 'sufficient');
  assert.equal(second.body.decision.action, 'advance');
  assert.equal(second.body.decision.reason, 'respuesta_suficiente');
  assert.equal(second.body.decision.budget, null);
});

test('T4) JSON valido con status partial llega a followup con presupuesto clarity', async () => {
  const provider = providerDouble({ classification: JSON.stringify({ status: 'partial', focus: 'la cifra exacta y desde cuándo', evidence: [], reason: 'respuesta general' }) });
  globalThis.fetch = provider.impl;

  const app = buildApp();
  const { second } = await runTurn(app, 'T4', provider);

  assert.equal(second.status, 200);
  assert.equal(second.body.assessment.status, 'partial');
  assert.equal(second.body.decision.action, 'followup');
  assert.equal(second.body.decision.budget, 'clarity', 'con followUps:0 la aclaracion ordinaria es `clarity`');
  assert.equal(second.body.decision.reason, 'partial');
  assert.equal(second.body.kind, 'followup', 'el turno entregado es la repregunta');
  assert.ok(second.body.question);
});

test('T5) una respuesta sin el JSON esperado NO se acepta y sigue el tratamiento de error', async () => {
  // (a) El proveedor devuelve texto que no es JSON.
  const providerA = providerDouble({ classification: 'Respuesta sin JSON' });
  globalThis.fetch = providerA.impl;
  const appA = buildApp();
  const a = await runTurn(appA, 'T5a', providerA);
  assert.equal(a.second.status, 200);
  assert.equal(a.second.body.assessment.status, 'unevaluable');
  assert.equal(a.second.body.assessment.source, 'ai-failed');
  assert.equal(a.second.body.decision.action, 'followup');
  assert.equal(a.second.body.decision.budget, 'contingency', 'se conserva el presupuesto de contingencia');

  // (b) El proveedor devuelve una pregunta (contenido tipico si el prompt fuera el del entrevistador).
  const providerB = providerDouble({ classification: QUESTION });
  globalThis.fetch = providerB.impl;
  const appB = buildApp();
  const b = await runTurn(appB, 'T5b', providerB);
  assert.equal(b.second.body.assessment.status, 'unevaluable');
  assert.notEqual(b.second.body.decision.action, 'advance');

  // (c) JSON con categoria no permitida: tampoco se acepta.
  const providerC = providerDouble({ classification: JSON.stringify({ status: 'sorprendido', focus: 'x' }) });
  globalThis.fetch = providerC.impl;
  const appC = buildApp();
  const c = await runTurn(appC, 'T5c', providerC);
  assert.equal(c.second.body.assessment.status, 'unevaluable');
});

test('T6) la generacion normal sigue usando askModelFromContext (no assessAskModel)', async () => {
  const provider = providerDouble({ classification: 'irrelevante' });
  globalThis.fetch = provider.impl;

  let assessCalls = 0;
  const app = buildApp({
    assessAskModel: () => {
      assessCalls += 1;
      throw new Error('assessAskModel NO debe usarse para generar preguntas');
    },
  });

  const first = await call(app, { sessionId: 'T6', history: [] });
  assert.equal(first.status, 200);
  assert.ok(first.body.question, 'la generacion sigue funcionando');
  assert.equal(assessCalls, 0, 'el transporte del clasificador no participa en la generacion');

  const generation = provider.calls.filter((item) => item.maxTokens === 200);
  assert.equal(generation.length, 1);
  assert.equal(generation[0].messagesIsArray, true, 'el despacho de sesion se construye desde el contexto');
  assert.ok(generation[0].system.includes('Método:'), 'el prompt del entrevistador se construye desde el contexto');
  assert.ok(!generation[0].system.includes('analista de entrevistas'), 'la generacion no usa el prompt del clasificador');
  assert.equal(generation[0].temperature, 0.7);
});
