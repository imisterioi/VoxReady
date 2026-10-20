// Pruebas del manejador de subidas (video/audio) con un servidor HTTP local y un Prisma falso.
// No tocan la base de datos ni el directorio real de grabaciones (todo en %TEMP%).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const { createMediaUploadHandler } = require('../lib/mediaUpload');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vox-uploads-'));
const EBML = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
const body = (size = 64) => Buffer.concat([EBML, Buffer.alloc(size - 4, 0x11)]);

const USERS = {
  dueno: { id: 'u1' },
  otro: { id: 'u2' },
};

function fakePrisma(sessions) {
  return {
    session: {
      async findUnique({ where }) {
        return sessions[where.id] || null;
      },
    },
  };
}

// Levanta el handler con autenticación simulada; devuelve { baseUrl, close }.
async function withHandler({ sessions, maxAudioBytes = 1024, maxVideoBytes = 4096 }, run) {
  const express = require('express');
  const prisma = fakePrisma(sessions);
  const handler = createMediaUploadHandler({ prisma, sessionsDir: TMP, maxVideoBytes, maxAudioBytes });

  const app = express();
  // Autenticación simulada: el usuario llega en una cabecera de la prueba.
  app.use((req, _res, next) => {
    req.user = USERS[req.headers['x-user']];
    next();
  });
  // Sin parser de cuerpo: el handler necesita el stream binario tal cual.
  app.post('/api/sessions/:id/:kind', (req, res) => handler(req, res, { kind: req.params.kind }));

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address();
  try {
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    // Las respuestas tempranas (403/409/415) no consumen el cuerpo: hay que cerrar las
    // conexiones keep-alive para que el servidor de pruebas termine.
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

function upload(baseUrl, { id = 's1', kind = 'audio', user = 'dueno', type = 'audio/webm', payload = body() } = {}) {
  return fetch(`${baseUrl}/api/sessions/${id}/${kind}`, {
    method: 'POST',
    headers: { 'content-type': type, 'x-user': user },
    body: payload,
  });
}

const SESSION = { id: 's1', userId: 'u1', report: null, tenant: { status: 'ACTIVE' } };
const file = (id, suffix = '.audio.webm') => path.join(TMP, `${id}${suffix}`);

test('sesión inexistente: 404 y no escribe nada', async () => {
  const res = await withHandler({ sessions: {} }, (baseUrl) => upload(baseUrl));
  assert.equal(res.status, 404);
  assert.equal(fs.existsSync(file('s1')), false);
});

test('otro usuario no puede subir la grabación: 403', async () => {
  const res = await withHandler({ sessions: { s1: SESSION } }, (baseUrl) => upload(baseUrl, { user: 'otro' }));
  assert.equal(res.status, 403);
  assert.equal(fs.existsSync(file('s1')), false);
});

test('sesión con informe: 409 (inmutabilidad)', async () => {
  const sessions = { s1: { ...SESSION, report: { global: 80 } } };
  const res = await withHandler({ sessions }, (baseUrl) => upload(baseUrl));
  assert.equal(res.status, 409);
  assert.equal(fs.existsSync(file('s1')), false);
});

test('organización en borrado: 409', async () => {
  const sessions = { s1: { ...SESSION, tenant: { status: 'DELETING' } } };
  const res = await withHandler({ sessions }, (baseUrl) => upload(baseUrl));
  assert.equal(res.status, 409);
});

test('tipo de contenido no admitido: 415', async () => {
  const res = await withHandler({ sessions: { s1: SESSION } }, (baseUrl) => upload(baseUrl, { type: 'text/plain' }));
  assert.equal(res.status, 415);
  assert.equal(fs.existsSync(file('s1')), false);
});

test('contenido que no es WebM: 415 y no deja archivo ni parcial', async () => {
  const res = await withHandler({ sessions: { s1: SESSION } }, (baseUrl) =>
    upload(baseUrl, { payload: Buffer.from('no soy webm') }),
  );
  assert.equal(res.status, 415);
  assert.equal(fs.existsSync(file('s1')), false);
  assert.equal(fs.existsSync(`${file('s1')}.part`), false);
});

test('subida válida de audio: guarda <id>.audio.webm', async () => {
  const payload = body(128);
  const res = await withHandler({ sessions: { s1: SESSION } }, (baseUrl) => upload(baseUrl, { payload }));
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.file, 's1.audio.webm');
  assert.equal(data.bytes, payload.length);
  assert.equal(fs.readFileSync(file('s1')).length, payload.length);
  assert.equal(fs.existsSync(`${file('s1')}.part`), false);
});

test('subida válida de video: guarda <id>.webm', async () => {
  const res = await withHandler({ sessions: { s1: SESSION } }, (baseUrl) =>
    upload(baseUrl, { kind: 'video', type: 'video/webm' }),
  );
  assert.equal(res.status, 200);
  assert.equal((await res.json()).file, 's1.webm');
  assert.equal(fs.existsSync(file('s1', '.webm')), true);
});

test('demasiado grande: 413 y no deja archivo ni parcial', async () => {
  const sessions = { big: { ...SESSION, id: 'big' } };
  const res = await withHandler({ sessions, maxAudioBytes: 32 }, (baseUrl) =>
    upload(baseUrl, { id: 'big', payload: body(512) }),
  );
  assert.equal(res.status, 413);
  assert.equal(fs.existsSync(file('big')), false);
  assert.equal(fs.existsSync(`${file('big')}.part`), false);
});

test('se puede volver a subir mientras no haya informe (sustituye)', async () => {
  await withHandler({ sessions: { s1: SESSION } }, async (baseUrl) => {
    await upload(baseUrl, { payload: body(64) });
    const second = await upload(baseUrl, { payload: body(96) });
    assert.equal(second.status, 200);
    assert.equal(fs.statSync(file('s1')).size, 96);
  });
});
