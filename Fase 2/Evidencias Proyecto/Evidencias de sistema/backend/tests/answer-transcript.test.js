// Transcripción por respuesta (entrevistador): POST /api/sessions/:id/answer-transcript
// Servidor HTTP local + Prisma falso + cadena ASR inyectada. No toca la base de datos ni el
// directorio real de grabaciones (el audio de prueba se escribe en %TEMP%).
process.env.EVAL_MAX_AUDIO_MB = '0.0005'; // 524 bytes: permite probar el 413 con un cuerpo pequeño

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const authPath = require.resolve('../auth');
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: { requireAuth: () => (req, res, next) => { req.user = { id: 'u1' }; next(); } },
};

const registerSessionRoutes = require('../routes/sessions');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vox-live-asr-'));
const EBML = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
const audioBody = (size = 64) => Buffer.concat([EBML, Buffer.alloc(Math.max(0, size - 4), 0x11)]);

const SESSIONS = {
  s1: { id: 's1', userId: 'u1', score: null, report: null, themeId: 't1', tenantId: 'ten1', tenant: { status: 'ACTIVE' } },
  evaluada: { id: 'evaluada', userId: 'u1', score: 80, report: { global: 80 }, themeId: 't1', tenantId: 'ten1', tenant: { status: 'ACTIVE' } },
  borrando: { id: 'borrando', userId: 'u1', score: null, report: null, themeId: 't1', tenantId: 'ten1', tenant: { status: 'DELETING' } },
  ajena: { id: 'ajena', userId: 'u2', score: null, report: null, themeId: 't1', tenantId: 'ten1', tenant: { status: 'ACTIVE' } },
};

function fakePrisma() {
  const audits = [];
  return {
    audits,
    session: { findUnique: async ({ where }) => SESSIONS[where.id] || null },
    transcriptionAudit: {
      create: async ({ data }) => { audits.push(data); return data; },
      updateMany: async () => ({ count: 0 }),
      findMany: async () => [],
    },
  };
}

const OK_RESULT = {
  ok: true,
  answers: ['la planta se cerró a las nueve y avisamos en veinte minutos'],
  windows: [{ index: 0, ok: true, startMs: 1000, endMs: 4000 }],
  enginesUsed: ['nvidia-whisper-large-v3'],
  diagnostics: [{ index: 0, status: 'ok', engine: 'nvidia-whisper-large-v3', code: null, attempts: [{ engine: 'nvidia-whisper-large-v3', ok: true, ms: 900 }], totalMs: 900 }],
  model: 'whisper-large-v3',
};

async function withServer({ transcribeResult = OK_RESULT, prisma = fakePrisma() } = {}, run) {
  const express = require('express');
  const calls = [];
  const transcribe = async (options) => { calls.push(options); return transcribeResult; };
  const app = express();
  // Sin parser de cuerpo: el endpoint necesita el stream binario tal cual.
  registerSessionRoutes(app, prisma, { transcribe, audioPathFor: (id) => path.join(TMP, `${id}.audio.webm`) });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address();
  try {
    return await run({ baseUrl: `http://127.0.0.1:${port}`, calls, prisma });
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function call(baseUrl, { id = 's1', query = 'startMs=1000&endMs=4000&turnIndex=5', type = 'audio/webm', payload = audioBody() } = {}) {
  const response = await fetch(`${baseUrl}/api/sessions/${id}/answer-transcript?${query}`, {
    method: 'POST',
    headers: { 'Content-Type': type },
    body: payload,
  });
  return { status: response.status, body: await response.json() };
}

test('transcribe la ventana indicada y deja la auditoría del turno real', async () => {
  await withServer({}, async ({ baseUrl, calls, prisma }) => {
    const res = await call(baseUrl, {});
    assert.equal(res.status, 200);
    assert.equal(res.body.text, 'la planta se cerró a las nueve y avisamos en veinte minutos');
    assert.equal(res.body.engine, 'nvidia-whisper-large-v3');
    assert.equal(res.body.code, null);

    // La cadena ASR recibe UNA ventana con la ventana pedida y un presupuesto acotado.
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].turns, [{ startMs: 1000, endMs: 4000 }]);
    assert.equal(calls[0].budgetMs, 12000, 'presupuesto por defecto de 12 s');
    assert.ok(calls[0].filePath.endsWith('s1.audio.webm'));

    // Auditoría: misma clave (sesión, turnIndex) y texto del motor elegido.
    assert.equal(prisma.audits.length, 1);
    assert.equal(prisma.audits[0].turnIndex, 5);
    assert.equal(prisma.audits[0].status, 'ok');
    assert.equal(prisma.audits[0].engine, 'nvidia-whisper-large-v3');
    assert.match(prisma.audits[0].transcript, /la planta se cerró/);

    // El audio de prueba quedó guardado en el directorio inyectado.
    assert.ok(fs.existsSync(path.join(TMP, 's1.audio.webm')));
  });
});

test('si la transcripción falla devuelve texto vacío con motivo y auditoría `failed`', async () => {
  const failed = {
    ok: false,
    code: 'ANSWER_TRANSCRIPTION_FAILED',
    answers: [''],
    diagnostics: [{ index: 0, status: 'failed', engine: null, code: 'BUDGET_EXHAUSTED', attempts: [{ engine: 'nvidia-whisper-large-v3', ok: false, code: 'TIMEOUT' }], totalMs: 12000 }],
  };
  await withServer({ transcribeResult: failed }, async ({ baseUrl, prisma }) => {
    const res = await call(baseUrl, {});
    assert.equal(res.status, 200, 'no es un error del endpoint: el cliente distingue por `text`/`code`');
    assert.equal(res.body.text, '');
    assert.equal(res.body.code, 'BUDGET_EXHAUSTED');
    assert.equal(prisma.audits[0].status, 'failed');
    assert.equal(prisma.audits[0].turnIndex, 5);
    assert.equal(prisma.audits[0].transcript, null);
  });
});

test('sin ventanas utilizables (NO_WINDOWS) también devuelve motivo y auditoría', async () => {
  const noWindows = { ok: false, code: 'NO_WINDOWS', windows: [{ index: 0, ok: false, code: 'NO_WINDOWS' }] };
  await withServer({ transcribeResult: noWindows }, async ({ baseUrl, prisma }) => {
    const res = await call(baseUrl, {});
    assert.equal(res.status, 200);
    assert.equal(res.body.text, '');
    assert.equal(res.body.code, 'NO_WINDOWS');
    assert.equal(prisma.audits[0].status, 'failed');
    assert.equal(prisma.audits[0].reason, 'NO_WINDOWS');
  });
});

test('valida la ventana y el turno antes de tocar el audio', async () => {
  await withServer({}, async ({ baseUrl, calls }) => {
    const badWindow = await call(baseUrl, { query: 'startMs=4000&endMs=1000&turnIndex=1' });
    assert.equal(badWindow.status, 400);
    const negative = await call(baseUrl, { query: 'startMs=-5&endMs=100&turnIndex=1' });
    assert.equal(negative.status, 400);
    const notANumber = await call(baseUrl, { query: 'startMs=x&endMs=100&turnIndex=1' });
    assert.equal(notANumber.status, 400);
    const badTurn = await call(baseUrl, { query: 'startMs=0&endMs=100&turnIndex=-1' });
    assert.equal(badTurn.status, 400);
    assert.equal(calls.length, 0, 'no se llama a la cadena ASR con entradas inválidas');
  });
});

test('rechaza sesiones ajenas, evaluadas, en borrado o con formato no admitido', async () => {
  await withServer({}, async ({ baseUrl, calls }) => {
    assert.equal((await call(baseUrl, { id: 'ajena' })).status, 403);
    assert.equal((await call(baseUrl, { id: 'evaluada' })).status, 409);
    assert.equal((await call(baseUrl, { id: 'borrando' })).status, 409);
    assert.equal((await call(baseUrl, { id: 'inexistente' })).status, 404);
    assert.equal((await call(baseUrl, { type: 'text/plain' })).status, 415);
    assert.equal(calls.length, 0);
  });
});

test('rechaza un audio que no es WebM y un cuerpo demasiado grande', async () => {
  await withServer({}, async ({ baseUrl, calls }) => {
    const notWebm = await call(baseUrl, { payload: Buffer.alloc(64, 0x22) });
    assert.equal(notWebm.status, 415);
    const tooLarge = await call(baseUrl, { payload: audioBody(2048) });
    assert.equal(tooLarge.status, 413);
    assert.equal(calls.length, 0, 'no se transcribe nada si el audio no se pudo guardar');
  });
});
