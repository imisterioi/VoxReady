// B3: trazabilidad del foco y prioridad de la instruccion de repregunta. Todo con dobles: sin red.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildSystemPrompt, buildMessages } = require('../ai/interviewer');

const CFG = { aggressiveness: 'ALTA', questionCount: 5, followUps: 0, estimatedMinutes: 30, interviewerRole: '', maxAnswerSeconds: null };
const PLAN = { kind: 'main', number: 2, total: 5, mainNumber: 2, done: false };
const THEME = { title: 'Corte de suministro', context: 'Corte desde las 06:00.', keyMessages: '', redLines: '' };
const FOCUS = 'la cifra exacta de clientes afectados';
const MAIN = '¿A cuántos clientes afectó el corte?';

const promptFor = (turn, lang = 'es') => buildSystemPrompt(THEME, CFG, PLAN, turn, false, lang, {});

test('B3-1) con foco, la repregunta recibe la regla de prioridad, el aspecto pendiente y el fallback', () => {
  const prompt = promptFor({ kind: 'followup', mainQuestion: MAIN, focus: FOCUS, hasTranscript: true });
  assert.match(prompt, /PRIORIDAD DE ESTE TURNO/, 'la regla del turno esta presente');
  assert.match(prompt, /la repregunta debe solicitar EXACTAMENTE el aspecto pendiente/);
  assert.match(prompt, new RegExp(`- Aspecto pendiente que debe aclarar: ${FOCUS}`));
  assert.match(prompt, /no permiten formular una pregunta pertinente|no permite formular una pregunta pertinente/);
  assert.match(prompt, /no inventes información/);
  assert.match(prompt, /mantén el idioma y el tono/, 'se mantiene el idioma y el tono');
});

test('B3-2) la prioridad esta ordenada: contexto, regla, aspecto pendiente y fallback', () => {
  const prompt = promptFor({ kind: 'followup', mainQuestion: MAIN, focus: FOCUS, hasTranscript: true });
  const at = (needle) => prompt.indexOf(needle);
  assert.ok(at(MAIN) >= 0, 'la pregunta principal viaja como contexto');
  assert.ok(at('PRIORIDAD DE ESTE TURNO') > at(MAIN), 'la regla va despues del contexto');
  assert.ok(at('- Aspecto pendiente que debe aclarar') > at('PRIORIDAD DE ESTE TURNO'), 'el foco va despues de la regla');
  assert.ok(at('Si ese aspecto no permite') > at('- Aspecto pendiente que debe aclarar'), 'el fallback cierra el bloque');
});

test('B3-3) sin foco o sin repregunta, el prompt no cambia', () => {
  const sinFoco = promptFor({ kind: 'followup', mainQuestion: MAIN, focus: '', hasTranscript: true });
  assert.ok(!sinFoco.includes('PRIORIDAD DE ESTE TURNO'), 'no se anade la regla si no hay foco');
  assert.ok(!sinFoco.includes('Aspecto pendiente que debe aclarar'));
  assert.ok(sinFoco.includes(MAIN), 'el contexto de la pregunta principal se conserva');

  const preguntaNueva = promptFor({ kind: 'normal', mainQuestion: MAIN, focus: FOCUS, hasTranscript: true });
  assert.ok(!preguntaNueva.includes('PRIORIDAD DE ESTE TURNO'), 'la regla es exclusiva de las repreguntas');
  assert.ok(!preguntaNueva.includes(FOCUS));
});

test('B3-4) la regla tambien existe en ingles y no se mezcla con el español', () => {
  const english = promptFor({ kind: 'followup', mainQuestion: MAIN, focus: FOCUS, hasTranscript: true }, 'en');
  assert.match(english, /PRIORITY FOR THIS TURN/);
  assert.match(english, /do not invent information/);
  assert.ok(!english.includes('PRIORIDAD DE ESTE TURNO'), 'no se filtran textos en español');
});

test('B3-5) el prompt se construye igual a traves de buildMessages', () => {
  const messages = buildMessages(THEME, [], CFG, PLAN, { kind: 'followup', mainQuestion: MAIN, focus: FOCUS, hasTranscript: true }, 'es', {});
  assert.equal(messages[0].role, 'system');
  assert.match(messages[0].content, /PRIORIDAD DE ESTE TURNO/);
  assert.match(messages[0].content, new RegExp(FOCUS));
});

// --- Integracion: clasificacion con foco -> repregunta y su registro ---

process.env.AI_MODEL = 'modelo-foco';
process.env.AI_FALLBACK_MODEL = 'modelo-foco';
process.env.AI_EXTRA_MODELS = '';
process.env.INTERVIEW_AUDIT = '1';

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
const AUDIT_FILES = [];

const useAuditFile = (name) => {
  const file = path.join(os.tmpdir(), `voxready-focus-${name}-${process.pid}-${Date.now()}.jsonl`);
  AUDIT_FILES.push(file);
  process.env.INTERVIEW_AUDIT_FILE = file;
  try {
    fs.unlinkSync(file);
  } catch {
    /* no existia */
  }
  return file;
};

test.after(() => {
  globalThis.fetch = REAL_FETCH;
  for (const file of AUDIT_FILES) {
    try {
      fs.unlinkSync(file);
    } catch {
      /* no existia */
    }
  }
});

const JSON_PARTIAL = JSON.stringify({ status: 'partial', focus: FOCUS, evidence: [], reason: 'falta el dato' });
const JSON_SUFFICIENT = JSON.stringify({ status: 'sufficient', focus: '', evidence: [], reason: 'contesta lo pedido' });
const theme = () => ({
  title: 'Corte masivo de suministro',
  context: 'Corte desde las 06:00 en la zona sur.',
  keyMessages: '',
  redLines: '',
  interviewConfig: { aggressiveness: 'ALTA', questionCount: 5, followUps: 0, estimatedMinutes: 30 },
});
const prisma = { session: { findUnique: async () => ({ id: 's-focus', userId: 'u1', score: null, theme: theme() }) } };
const jsonResponse = (payload) => ({
  ok: true,
  status: 200,
  json: async () => payload,
  clone() {
    return { json: async () => payload };
  },
});

function providerDouble({ classification }) {
  const calls = [];
  let generation = 0;
  const impl = async (url, init = {}) => {
    const body = JSON.parse(init.body || '{}');
    const system = String(body.messages?.[0]?.content || '');
    const isClassifier = system.includes('analista de entrevistas');
    calls.push({ system, isClassifier });
    if (isClassifier) return jsonResponse({ choices: [{ message: { content: classification } }] });
    generation += 1;
    return jsonResponse({ choices: [{ message: { content: `¿Pregunta generada ${generation}?` } }] });
  };
  return { impl, calls };
}

function buildApp() {
  const app = express();
  app.use(express.json());
  registerInterviewerRoutes(app, prisma, { questionAllowed: () => true, startWaitMs: () => 200, timeoutFor: () => 2000 });
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

const readRecords = (file) =>
  (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));

test('B3-6) la clasificacion con foco entrega una repregunta y queda trazada', async () => {
  const file = useAuditFile('trace');
  const provider = providerDouble({ classification: JSON_PARTIAL });
  globalThis.fetch = provider.impl;
  const app = buildApp();
  const sessionId = 'focus-1';

  const first = await call(app, { sessionId, history: [] });
  assert.equal(first.status, 200);
  const second = await call(app, {
    sessionId,
    history: [
      { role: 'interviewer', text: first.body.question },
      { role: 'vocero', text: 'Hubo un corte de tres horas en la zona sur.' },
    ],
  });
  assert.equal(second.status, 200);
  assert.equal(second.body.kind, 'followup', 'el veredicto parcial pide repregunta');

  const turn1 = readRecords(file).find((item) => item.type === 'turn' && item.turn === 1);
  assert.ok(turn1.focusTrace, 'el turno registra la traza del foco');
  assert.equal(turn1.focusTrace.followUpId, `${sessionId}:1`);
  assert.equal(turn1.focusTrace.mainQuestionId, `${sessionId}:main-1`);
  assert.equal(turn1.focusTrace.followUpQuestionId, `${sessionId}:fu-1.1`);
  assert.equal(turn1.focusTrace.focusPresent, true);
  assert.equal(turn1.focusTrace.focusChars, FOCUS.length);
  assert.equal(turn1.focusTrace.focusFromModel, 'ai:modelo-foco');
  assert.equal(turn1.focusTrace.followUpRequested, true);
  assert.equal(turn1.focusTrace.focusUsedInPrompt, true);
  assert.equal(turn1.focusTrace.followUpGenerated, true);
  assert.equal(turn1.focusTrace.followUpTurn, 2, 'la repregunta entregada fue el turno 2 de la sesion');
  assert.equal(turn1.focusTrace.mainQuestionAskedTurn, 1, 'la principal en curso fue la primera');
  assert.ok(!JSON.stringify(turn1.focusTrace).includes(FOCUS), 'la traza no lleva el texto del foco');

  const followUpPrompt = provider.calls.filter((item) => !item.isClassifier).pop().system;
  assert.match(followUpPrompt, /PRIORIDAD DE ESTE TURNO/, 'el generador recibe la regla de prioridad');
  assert.ok(followUpPrompt.includes(FOCUS), 'el generador recibe el aspecto pendiente');
});

test('B3-7) sin foco no hay repregunta ni instruccion de foco', async () => {
  const file = useAuditFile('sufficient');
  const provider = providerDouble({ classification: JSON_SUFFICIENT });
  globalThis.fetch = provider.impl;
  const app = buildApp();
  const sessionId = 'focus-2';

  const first = await call(app, { sessionId, history: [] });
  const second = await call(app, {
    sessionId,
    history: [
      { role: 'interviewer', text: first.body.question },
      { role: 'vocero', text: 'Fueron tres horas y el servicio ya esta restablecido.' },
    ],
  });
  assert.equal(second.status, 200);

  const turn1 = readRecords(file).find((item) => item.type === 'turn' && item.turn === 1);
  assert.equal(turn1.focusTrace.focusPresent, false);
  assert.equal(turn1.focusTrace.followUpRequested, false);
  assert.equal(turn1.focusTrace.focusUsedInPrompt, false);
  assert.equal(turn1.focusTrace.followUpGenerated, false);
  assert.equal(turn1.focusTrace.followUpQuestionId, null);
  assert.equal(turn1.focusTrace.followUpTurn, null);
  assert.ok(
    provider.calls.every((item) => item.isClassifier || !item.system.includes('PRIORIDAD DE ESTE TURNO')),
    'ninguna generacion recibe la regla de foco',
  );
});

test('B3-8) un foco que no llega a repregunta (avance) tambien queda trazado', async () => {
  const file = useAuditFile('advance');
  const provider = providerDouble({ classification: JSON_PARTIAL });
  globalThis.fetch = provider.impl;
  const app = buildApp();
  const sessionId = 'focus-3';

  const first = await call(app, { sessionId, history: [] });
  const second = await call(app, {
    sessionId,
    history: [
      { role: 'interviewer', text: first.body.question },
      { role: 'vocero', text: 'Fue una falla en los reguladores.' },
    ],
  });
  const followUp = second.body.question;
  const third = await call(app, {
    sessionId,
    history: [
      { role: 'interviewer', text: first.body.question },
      { role: 'vocero', text: 'Fue una falla en los reguladores.' },
      { role: 'interviewer', text: followUp },
      { role: 'vocero', text: 'Seguimos revisando los reguladores de la subestacion sur.' },
    ],
  });
  assert.equal(third.status, 200);

  const turn2 = readRecords(file).find((item) => item.type === 'turn' && item.turn === 2);
  assert.equal(turn2.focusTrace.focusPresent, true, 'el clasificador dio foco');
  assert.equal(turn2.focusTrace.followUpRequested, false, 'el presupuesto ya estaba agotado: avanza');
  assert.equal(turn2.focusTrace.focusUsedInPrompt, false, 'el foco no llega al generador');
  assert.equal(turn2.focusTrace.followUpGenerated, false);
  assert.equal(turn2.focusTrace.followUpQuestionId, null);
  assert.equal(turn2.decision.action, 'advance');
});


