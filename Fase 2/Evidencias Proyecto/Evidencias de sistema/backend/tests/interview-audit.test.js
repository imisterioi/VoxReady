// Instrumentacion de la entrevista (auditoria JSONL): pruebas LOCALES con dobles simulados.
//
// Comprueba que la auditoria registra lo necesario para reconstruir un turno real (preguntas,
// respuestas, prompts, respuestas del proveedor, clasificacion, decision y presupuestos) sin
// alterar el comportamiento del entrevistador y sin llamadas externas ni secretos.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Un solo modelo del entrevistador: los conteos son deterministas.
process.env.AI_MODEL = 'modelo-audit';
process.env.AI_FALLBACK_MODEL = 'modelo-audit';
process.env.AI_EXTRA_MODELS = '';

// El acta vive en el directorio temporal del sistema (NUNCA dentro del repositorio).
const AUDIT_FILE = path.join(os.tmpdir(), `voxready-audit-test-${process.pid}-${Date.now()}.jsonl`);
process.env.INTERVIEW_AUDIT = '1';
process.env.INTERVIEW_AUDIT_FILE = AUDIT_FILE;

// Autenticacion simulada (mismo patron que el resto de pruebas de la ruta).
const authPath = require.resolve('../auth');
require.cache[authPath] = {
  id: authPath,
  filename: authPath,
  loaded: true,
  exports: { requireAuth: () => (req, res, next) => { req.user = { id: 'u1', tenant: { name: 'Energia Andes', sector: 'Energia' } }; next(); } },
};

const registerInterviewerRoutes = require('../routes/interviewer');
const REAL_FETCH = globalThis.fetch.bind(globalThis);

test.after(() => {
  globalThis.fetch = REAL_FETCH;
  for (const file of [AUDIT_FILE, `${AUDIT_FILE}.off`]) {
    try { fs.unlinkSync(file); } catch { /* no existia */ }
  }
});

const ANSWER = 'Cerramos la planta a las 9 y avisamos a los vecinos en 20 minutos.';
const JSON_PARTIAL = JSON.stringify({ status: 'partial', focus: 'la cifra exacta y desde cuándo', evidence: ['avisamos a los vecinos'], reason: 'respuesta general' });
const JSON_SUFFICIENT = JSON.stringify({ status: 'sufficient', focus: '', evidence: [], reason: 'contesta lo pedido' });

const theme = (level) => ({
  title: 'Corte masivo de suministro',
  context: 'Corte desde las 06:00 en la zona sur.',
  keyMessages: '',
  redLines: '',
  interviewConfig: { aggressiveness: level, questionCount: 5, followUps: 0, estimatedMinutes: 30 },
});
// Nivel del escenario que devuelve la "base de datos" simulada (se cambia en la prueba de niveles).
let currentLevel = 'MEDIA';
const prisma = { session: { findUnique: async () => ({ id: 's1', userId: 'u1', score: null, theme: theme(currentLevel) }) } };

const jsonResponse = (payload) => ({
  ok: true,
  status: 200,
  json: async () => payload,
  // El auditor clona la respuesta para no consumir el cuerpo que el sistema necesita.
  clone() { return { json: async () => payload }; },
});

// Proveedor simulado: responde JSON si el prompt es el del clasificador y una pregunta si es el
// del entrevistador. `fail` simula una caida del proveedor (sin red real) y `failOn` la limita a
// las generaciones, a las clasificaciones o a ambas.
function providerDouble({ classification = JSON_SUFFICIENT, fail = null, failOn = 'any' } = {}) {
  const calls = [];
  const impl = async (url, init = {}) => {
    const body = JSON.parse(init.body || '{}');
    const system = String(body.messages?.[0]?.content || '');
    const isClassifier = system.includes('analista de entrevistas');
    const kind = isClassifier ? 'classification' : 'generation';
    calls.push({ url: String(url), system, isClassifier, kind, maxTokens: body.max_tokens, model: body.model });
    if (fail && (failOn === 'any' || failOn === kind)) throw Object.assign(new Error(fail), { name: 'FetchError' });
    const content = isClassifier ? classification : `¿Pregunta ${calls.length} sobre el corte?`;
    return jsonResponse({ choices: [{ message: { content } }] });
  };
  return { impl, calls };
}

function buildApp(deps = {}) {
  const app = express();
  app.use(express.json());
  registerInterviewerRoutes(app, prisma, { questionAllowed: () => true, startWaitMs: () => 200, timeoutFor: () => 2000, ...deps });
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

// Turno completo: T1 (genera la pregunta) + T2 (respuesta del vocero -> clasificacion).
async function runTurn(app, sessionId, { answer = ANSWER } = {}) {
  const first = await call(app, { sessionId, history: [] });
  const second = await call(app, {
    sessionId,
    history: [
      { role: 'interviewer', text: first.body.question },
      { role: 'vocero', text: answer },
    ],
  });
  return { first, second };
}

const readRecords = (file = AUDIT_FILE) =>
  (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));

test('E1) se registra la GENERACION de una pregunta (prompt, respuesta original y latencia)', async () => {
  const provider = providerDouble();
  globalThis.fetch = provider.impl;
  const app = buildApp();
  await runTurn(app, 'aud-1');

  const records = readRecords();
  const generation = records.find((item) => item.type === 'provider-request' && item.kind === 'generation' && item.turn === 0);
  assert.ok(generation, 'debe existir la solicitud de generacion del turno 0');
  assert.equal(generation.sessionId, 'aud-1');
  assert.equal(generation.ok, true);
  assert.ok(Number.isFinite(generation.ms) && generation.ms >= 0, 'latencia registrada');
  assert.equal(generation.request.model, 'modelo-audit', 'modelo que genero la pregunta');
  assert.equal(generation.request.host, 'integrate.api.nvidia.com');
  assert.equal(Array.isArray(generation.request.messages), true, 'prompt literal por mensajes');
  assert.match(generation.request.messages[0].content, /Método:/, 'prompt del entrevistador');
  assert.equal(typeof generation.response.choices[0].message.content, 'string', 'respuesta original del proveedor');
});

test('E2) se registra la CLASIFICACION con su prompt y la respuesta original del proveedor', async () => {
  const provider = providerDouble({ classification: JSON_PARTIAL });
  globalThis.fetch = provider.impl;
  const app = buildApp();
  await runTurn(app, 'aud-2');

  const classification = readRecords().find((item) => item.sessionId === 'aud-2' && item.type === 'provider-request' && item.kind === 'classification');
  assert.ok(classification, 'debe existir la solicitud de clasificacion');
  assert.equal(classification.sessionId, 'aud-2');
  assert.equal(classification.model, 'modelo-audit', 'modelo consultado por el clasificador');
  assert.equal(classification.request.maxTokens, 500, 'peticion en modo raw');
  assert.match(classification.request.messages[0].content, /analista de entrevistas/, 'prompt del CLASIFICADOR');
});

test('E3) la clasificacion queda asociada al turno y a la respuesta correctos', async () => {
  const provider = providerDouble({ classification: JSON_PARTIAL });
  globalThis.fetch = provider.impl;
  const app = buildApp();
  await runTurn(app, 'aud-3');

  const records = readRecords().filter((item) => item.sessionId === 'aud-3');
  const classification = records.find((item) => item.kind === 'classification');
  assert.equal(classification.turn, 1, 'la clasificacion del segundo turno corresponde al turno ya formulado');

  const turn1 = records.find((item) => item.type === 'turn' && item.turn === 1);
  assert.ok(turn1, 'resumen del turno 1');
  assert.equal(turn1.answer, ANSWER, 'respuesta del vocero asociada al turno');
  assert.ok(turn1.mainQuestion, 'pregunta principal en curso');

  const turn0 = records.find((item) => item.type === 'turn' && item.turn === 0);
  assert.ok(turn0, 'el turno de arranque tambien se registra');
  assert.equal(turn0.assessment, null);
  assert.ok(turn0.question, 'pregunta generada');
});

test('E4) la respuesta original del clasificador se conserva tal cual (sin reprocesar)', async () => {
  const raw = '{"status":"evasive",  "focus":"no respondio la causa","evidence":[],"reason":"generalidad"}';
  const provider = providerDouble({ classification: raw });
  globalThis.fetch = provider.impl;
  const app = buildApp();
  await runTurn(app, 'aud-4');

  const classification = readRecords().find((item) => item.sessionId === 'aud-4' && item.kind === 'classification');
  assert.equal(classification.response.choices[0].message.content, raw, 'texto literal del proveedor');
});

test('E5) se registra el resultado PROCESADO por assessAnswer (estado, fuente, foco y evidencias)', async () => {
  const provider = providerDouble({ classification: JSON_PARTIAL });
  globalThis.fetch = provider.impl;
  const app = buildApp();
  await runTurn(app, 'aud-5');

  const turn = readRecords().find((item) => item.sessionId === 'aud-5' && item.type === 'turn' && item.turn === 1);
  assert.equal(turn.assessment.status, 'partial');
  assert.equal(turn.assessment.source, 'ai:modelo-audit');
  assert.equal(turn.assessment.focus, 'la cifra exacta y desde cuándo');
  assert.deepEqual(turn.assessment.evidence, ['avisamos a los vecinos'], 'cita verificable conservada');
});

test('E6) se registran la DECISION, el presupuesto y la pregunta de seguimiento', async () => {
  const provider = providerDouble({ classification: JSON_PARTIAL });
  globalThis.fetch = provider.impl;
  const app = buildApp();
  await runTurn(app, 'aud-6');

  const turn = readRecords().find((item) => item.sessionId === 'aud-6' && item.type === 'turn' && item.turn === 1);
  assert.equal(turn.decision.action, 'followup');
  assert.equal(turn.decision.budget, 'clarity', 'con followUps:0 la aclaracion es `clarity`');
  assert.equal(turn.budgetConfig.clarity, 1, 'presupuesto configurado');
  assert.equal(turn.usedBudget.clarity, 1, 'presupuesto consumido');
  assert.equal(turn.deliveredKind, 'followup', 'tipo de seguimiento');
  assert.ok(turn.question, 'pregunta de seguimiento generada');
  assert.equal(turn.ok, true);
  assert.equal(turn.level, 'MEDIA');
});

test('E7) se distinguen los CUATRO niveles de agresividad', async () => {
  const provider = providerDouble({ classification: JSON_PARTIAL });
  globalThis.fetch = provider.impl;

  for (const level of ['BAJA', 'MEDIA', 'ALTA', 'EXTREMA']) {
    currentLevel = level;
    const sessionId = `aud-level-${level}`;
    await runTurn(buildApp(), sessionId);
    const records = readRecords().filter((item) => item.sessionId === sessionId);
    const turns = records.filter((item) => item.type === 'turn');
    assert.ok(turns.length >= 2, `${level}: turnos registrados`);
    for (const item of turns) assert.equal(item.level, level, `${level}: nivel en el resumen del turno`);
    const classification = records.find((item) => item.kind === 'classification');
    assert.equal(classification.level, level, `${level}: nivel en la clasificacion`);
  }
  currentLevel = 'MEDIA';
});

test('E8) se registran errores y latencias (generacion y clasificacion)', async () => {
  // (a) El proveedor cae en la GENERACION: no hay pregunta y el turno se registra con su codigo.
  const generationFailure = providerDouble({ fail: 'ECONNRESET' });
  globalThis.fetch = generationFailure.impl;
  const first = await call(buildApp(), { sessionId: 'aud-8a', history: [] });
  assert.equal(first.status, 502, 'sin pregunta no hay turno');

  const records = readRecords();
  const failed = records.find((item) => item.sessionId === 'aud-8a' && item.type === 'provider-request' && item.ok === false);
  assert.ok(failed, 'solicitud fallida registrada');
  assert.equal(failed.error.name, 'FetchError');
  assert.match(failed.error.message, /ECONNRESET/);
  assert.ok(Number.isFinite(failed.ms) && failed.ms >= 0, 'latencia del fallo');
  const turnError = records.find((item) => item.sessionId === 'aud-8a' && item.type === 'turn' && item.error);
  assert.equal(turnError.ok, false);
  assert.equal(turnError.error, 'NO_QUESTION_IN_TIME', 'codigo del error en el resumen del turno');

  // (b) El proveedor cae en la CLASIFICACION: el sistema degrada a contingencia y queda registrado.
  const classificationFailure = providerDouble({ fail: 'timeout', failOn: 'classification' });
  globalThis.fetch = classificationFailure.impl;
  const second = await runTurn(buildApp(), 'aud-8b');
  assert.equal(second.second.body.assessment.status, 'unevaluable');

  const recordsB = readRecords().filter((item) => item.sessionId === 'aud-8b');
  const clsFailure = recordsB.find((item) => item.kind === 'classification');
  assert.equal(clsFailure.ok, false);
  assert.match(clsFailure.error.message, /timeout/);
  const turnB = recordsB.find((item) => item.type === 'turn' && item.turn === 1);
  assert.equal(turnB.assessment.status, 'unevaluable');
  assert.equal(turnB.decision.budget, 'contingency');
});

test('E9) la auditoria no altera el comportamiento del entrevistador', async () => {
  const withAudit = providerDouble({ classification: JSON_PARTIAL });
  globalThis.fetch = withAudit.impl;
  const on = await runTurn(buildApp(), 'aud-on');

  process.env.INTERVIEW_AUDIT = '';
  const withoutAudit = providerDouble({ classification: JSON_PARTIAL });
  globalThis.fetch = withoutAudit.impl;
  const off = await runTurn(buildApp(), 'aud-off');
  process.env.INTERVIEW_AUDIT = '1';

  assert.equal(on.first.status, off.first.status);
  assert.equal(on.second.status, off.second.status);
  assert.equal(on.first.body.question, off.first.body.question, 'misma pregunta generada');
  assert.equal(on.second.body.kind, off.second.body.kind, 'mismo tipo de turno');
  assert.equal(on.second.body.number, off.second.body.number, 'mismo numero de turno');
  assert.deepEqual(on.second.body.decision, off.second.body.decision, 'misma decision');
  assert.deepEqual(on.second.body.assessment, off.second.body.assessment, 'misma clasificacion');
});

test('E10) todas las solicitudes registradas van al proveedor simulado (sin destinos ocultos)', async () => {
  const provider = providerDouble({ classification: JSON_PARTIAL });
  globalThis.fetch = provider.impl;
  await runTurn(buildApp(), 'aud-10');

  const requests = readRecords().filter((item) => item.sessionId === 'aud-10' && item.type === 'provider-request');
  // Turno 1: genera la pregunta. Turno 2: clasifica la respuesta y genera la intervencion siguiente.
  assert.equal(requests.length, 3, 'dos generaciones y una clasificacion');
  assert.equal(requests.length, provider.calls.length, 'no hay solicitudes fuera del doble');
  assert.equal(requests.filter((item) => item.kind === 'generation').length, 2);
  assert.equal(requests.filter((item) => item.kind === 'classification').length, 1);
  for (const item of requests) {
    assert.equal(item.request.host, 'integrate.api.nvidia.com', 'unico destino posible');
    assert.ok([200, 500].includes(item.request.maxTokens), 'peticion del entrevistador o del clasificador');
  }
});

test('E11) el acta no contiene credenciales', async () => {
  const provider = providerDouble({ classification: JSON_PARTIAL });
  globalThis.fetch = provider.impl;
  await runTurn(buildApp(), 'aud-11');

  const content = fs.readFileSync(AUDIT_FILE, 'utf8').toLowerCase();
  for (const needle of ['bearer', 'authorization', 'nvapi-', 'api_key', 'apikey', 'password', 'secret']) {
    assert.equal(content.includes(needle), false, `no debe contener «${needle}»`);
  }
  const apiKey = process.env.NVIDIA_API_KEY;
  if (apiKey) assert.equal(content.includes(String(apiKey).toLowerCase()), false, 'no debe contener la clave real');
});

test('E12) con la auditoria APAGADA no se escribe ningun archivo', async () => {
  const offFile = `${AUDIT_FILE}.off`;
  process.env.INTERVIEW_AUDIT = '';
  process.env.INTERVIEW_AUDIT_FILE = offFile;

  const provider = providerDouble({ classification: JSON_PARTIAL });
  globalThis.fetch = provider.impl;
  await runTurn(buildApp(), 'aud-12');

  assert.equal(fs.existsSync(offFile), false, 'sin auditoria no se crea archivo');
  process.env.INTERVIEW_AUDIT = '1';
  process.env.INTERVIEW_AUDIT_FILE = AUDIT_FILE;
});
