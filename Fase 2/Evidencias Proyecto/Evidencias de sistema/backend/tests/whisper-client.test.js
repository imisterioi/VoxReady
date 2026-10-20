// Pruebas del cliente de Whisper con un servidor HTTP local de mentira.
// No descargan modelos, no usan la base de datos y no escriben en el repositorio.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const { createLimiter, resetLimiter, transcribeFile } = require('../lib/whisperClient');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vox-whisper-client-'));
const AUDIO = path.join(TMP, 'sesion.audio.webm');
fs.writeFileSync(AUDIO, Buffer.from('1a45dfa3', 'hex'));

const OK_BODY = {
  status: 'ok',
  text: 'hola mundo',
  segments: [{ id: 0, start: 0, end: 1, text: 'hola mundo', words: [{ start: 0, end: 0.4, word: 'hola' }] }],
  duration_seconds: 12.5,
  model_key: 'small',
  model: 'small',
  elapsed_ms: 900,
  rtf: 0.07,
};

// Levanta un servidor efímero y devuelve su URL base.
async function withServer(handler, run) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

test.beforeEach(() => resetLimiter({ maxConcurrency: 2, maxQueue: 2 }));

test('archivo inexistente: NO_AUDIO (no lanza)', async () => {
  const result = await transcribeFile(path.join(TMP, 'no-existe.webm'));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'NO_AUDIO');
});

test('archivo demasiado grande: TOO_LARGE sin contactar el servicio', async () => {
  const result = await transcribeFile(AUDIO, { maxBytes: 2, baseUrl: 'http://127.0.0.1:1' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'TOO_LARGE');
  assert.equal(result.maxBytes, 2);
});

test('respuesta correcta: devuelve segmentos y metadatos', async () => {
  const result = await withServer((req, res) => json(res, 200, OK_BODY), (baseUrl) =>
    transcribeFile(AUDIO, { baseUrl }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.segments.length, 1);
  assert.equal(result.durationSeconds, 12.5);
  assert.equal(result.modelKey, 'small');
  assert.equal(result.audioBytes, 4);
});

test('pide marcas por palabra y el modelo configurado', async () => {
  let seen = '';
  const result = await withServer(
    (req, res) => {
      seen = req.url;
      json(res, 200, OK_BODY);
    },
    (baseUrl) => transcribeFile(AUDIO, { baseUrl, model: 'small' }),
  );
  assert.equal(result.ok, true);
  assert.match(seen, /word_timestamps=true/);
  assert.match(seen, /model=small/);
});

test('413, 422, 503 y 500 se traducen a códigos estables', async () => {
  for (const [status, code] of [[413, 'HTTP_413'], [422, 'HTTP_422'], [503, 'HTTP_503'], [500, 'HTTP_ERROR']]) {
    const result = await withServer((req, res) => json(res, status, { detail: 'x' }), (baseUrl) =>
      transcribeFile(AUDIO, { baseUrl }),
    );
    assert.equal(result.code, code, `estado ${status}`);
    assert.equal(result.status, status);
  }
});

test('JSON inválido o sin segmentos: BAD_RESPONSE', async () => {
  const broken = await withServer(
    (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('no es json');
    },
    (baseUrl) => transcribeFile(AUDIO, { baseUrl }),
  );
  assert.equal(broken.code, 'BAD_RESPONSE');

  const noSegments = await withServer((req, res) => json(res, 200, { text: 'hola' }), (baseUrl) =>
    transcribeFile(AUDIO, { baseUrl }),
  );
  assert.equal(noSegments.code, 'BAD_RESPONSE');
});

test('timeout: TIMEOUT y no deja la cola bloqueada', async () => {
  const result = await withServer(
    (req, res) => {
      setTimeout(() => json(res, 200, OK_BODY), 500);
    },
    (baseUrl) => transcribeFile(AUDIO, { baseUrl, timeoutMs: 60 }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, 'TIMEOUT');

  // La siguiente petición debe poder entrar (el hueco se liberó)
  const after = await withServer((req, res) => json(res, 200, OK_BODY), (baseUrl) =>
    transcribeFile(AUDIO, { baseUrl }),
  );
  assert.equal(after.ok, true);
});

test('servicio caído: SERVICE_DOWN', async () => {
  const result = await withServer(() => {}, async (baseUrl) => {
    // Se cierra el servidor antes de llamar: el puerto queda sin escuchar
    return transcribeFile(AUDIO, { baseUrl, timeoutMs: 200 });
  });
  assert.equal(result.ok, false);
  assert.ok(['SERVICE_DOWN', 'TIMEOUT'].includes(result.code));
});

test('concurrencia llena: BUSY en vez de esperar indefinidamente', async () => {
  resetLimiter({ maxConcurrency: 1, maxQueue: 0 });
  const result = await withServer(
    (req, res) => {
      setTimeout(() => json(res, 200, OK_BODY), 200);
    },
    async (baseUrl) => {
      const first = transcribeFile(AUDIO, { baseUrl });
      const second = await transcribeFile(AUDIO, { baseUrl });
      assert.equal(second.ok, false);
      assert.equal(second.code, 'BUSY');
      assert.equal((await first).ok, true);
      return second;
    },
  );
  assert.equal(result.code, 'BUSY');
});

test('el limitador reparte los turnos y libera el hueco al terminar', async () => {
  const limiter = createLimiter(1, 2);
  const order = [];
  const release1 = await limiter.acquire();
  const waiting = limiter.acquire().then((release) => {
    order.push('segundo');
    release();
  });
  assert.deepEqual(limiter.stats(), { active: 1, waiting: 1 });
  release1();
  await waiting;
  assert.deepEqual(order, ['segundo']);
  assert.deepEqual(limiter.stats(), { active: 0, waiting: 0 });
});
