// Pruebas del proxy del laboratorio de transcripción (Express → servicio Whisper).
//
//   cd backend
//   node --test routes/lab.test.js
//
// No necesitan el servicio Whisper, ni la base de datos, ni Prisma: la autenticación se
// sustituye por un middleware que deja pasar y `fetch` por un doble que devuelve lo que
// devolvería el servicio. Así se comprueba la compatibilidad de Whisper Base (sin
// `?model=`), la selección de modelo, el rechazo de claves inválidas y el reenvío de los
// errores del servicio.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

// El middleware real consulta Prisma: se reemplaza SOLO para estas pruebas.
const authPath = require.resolve('../auth');
require.cache[authPath] = {
  id: authPath,
  filename: authPath,
  loaded: true,
  exports: { requireAuth: () => (req, res, next) => next() },
};

const registerLabRoutes = require('./lab');

const realFetch = global.fetch; // se conserva para las peticiones de la prueba
const AUDIO = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02]);

// Doble del servicio Whisper: registra las URLs pedidas y responde según el escenario.
function stubService({ status = 200, body = { status: 'ok', text: 'hola mundo' }, throwError = null } = {}) {
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    if (throwError) throw throwError;
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return calls;
}

// Levanta la app con las rutas del laboratorio y ejecuta el cuerpo de la prueba.
async function withApp(run) {
  const app = express();
  registerLabRoutes(app, {});
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function postAudio(base, { query = '', contentType = 'audio/webm', body = AUDIO } = {}) {
  return realFetch(`${base}/api/lab/transcribe${query}`, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body,
  });
}

test('el laboratorio no puede usar el servicio si WHISPER_URL es inválida', async () => {
  stubService();
  const previous = process.env.WHISPER_URL;
  process.env.WHISPER_URL = 'no-es-una-url';
  try {
    await withApp(async (base) => {
      const health = await (await realFetch(`${base}/api/lab/health`)).json();
      assert.equal(health.available, false);
      assert.match(health.detail, /WHISPER_URL/);
    });
  } finally {
    if (previous === undefined) delete process.env.WHISPER_URL;
    else process.env.WHISPER_URL = previous;
  }
});

test('/health conserva los campos de siempre y añade los modelos', async () => {
  stubService({
    body: {
      status: 'ok',
      model_loaded: true,
      load_ms: 1205.2,
      load_error: null,
      config: { model: 'base', device: 'cpu', compute_type: 'int8', language: 'es' },
      default_model: 'base',
      models: { base: { loaded: true }, small: { loaded: false, load_error: null } },
    },
  });
  await withApp(async (base) => {
    const data = await (await realFetch(`${base}/api/lab/health`)).json();
    assert.equal(data.status, 'ok');
    assert.equal(data.available, true);
    assert.equal(typeof data.ms, 'number');
    assert.equal(data.service.model_loaded, true);
    assert.equal(data.service.load_ms, 1205.2);
    assert.equal(data.service.load_error, null);
    assert.equal(data.service.config.model, 'base');
    // Nuevo: el frontend puede saber si Small está listo.
    assert.equal(data.service.default_model, 'base');
    assert.equal(data.service.models.small.loaded, false);
  });
});

test('sin ?model= el proxy no añade parámetro: Whisper Base sigue igual', async () => {
  const calls = stubService();
  await withApp(async (base) => {
    const res = await postAudio(base);
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.status, 'ok');
    assert.equal(data.text, 'hola mundo');
    assert.equal(calls.length, 1);
    assert.ok(calls[0].endsWith('/transcribe'), calls[0]);
  });
});

test('?model=small se reenvía al servicio y se informa aparte de la inferencia', async () => {
  const calls = stubService({
    body: {
      status: 'ok',
      text: 'hola mundo',
      model_key: 'small',
      model: 'small',
      elapsed_ms: 1800.5,
      model_load_ms: 4200.0,
      total_ms: 6000.5,
    },
  });
  await withApp(async (base) => {
    const data = await (await postAudio(base, { query: '?model=small' })).json();
    assert.ok(calls[0].endsWith('/transcribe?model=small'), calls[0]);
    assert.equal(data.modelKey, 'small');
    assert.equal(data.modelName, 'small');
    assert.equal(data.processingMs, 1800.5);
    assert.equal(data.modelLoadMs, 4200.0);
    assert.equal(data.serviceTotalMs, 6000.5);
    assert.equal(typeof data.proxyMs, 'number');
  });
});

test('un identificador de modelo inválido se rechaza sin llamar al servicio', async () => {
  const calls = stubService();
  await withApp(async (base) => {
    const res = await postAudio(base, { query: '?model=../../secreto' });
    assert.equal(res.status, 400);
    assert.match((await res.json()).mensaje, /no válido/);
    assert.equal(calls.length, 0);
  });
});

test('el error del servicio se reenvía cuando distingue el motivo', async () => {
  stubService({
    status: 503,
    body: { detail: "El modelo 'small' no está disponible en el servicio de transcripción (ModuleNotFoundError)." },
  });
  await withApp(async (base) => {
    const res = await postAudio(base, { query: '?model=small' });
    assert.equal(res.status, 503);
    const data = await res.json();
    assert.equal(data.status, 'error');
    assert.match(data.mensaje, /no está disponible/);
  });
});

test('un 422 del servicio (audio ilegible) mantiene su mensaje identificable', async () => {
  stubService({ status: 422, body: { detail: 'No se pudo decodificar el audio (...). [InvalidDataError]' } });
  await withApp(async (base) => {
    const res = await postAudio(base);
    assert.equal(res.status, 422);
    assert.match((await res.json()).mensaje, /InvalidDataError/);
  });
});

test('un fallo interno del servicio no se disfraza de audio ilegible', async () => {
  stubService({
    status: 500,
    body: { detail: 'Error interno del servicio de transcripción al procesar el audio. [TypeError]' },
  });
  await withApp(async (base) => {
    const res = await postAudio(base);
    assert.equal(res.status, 502); // 500 del servicio → 502 para el cliente
    assert.match((await res.json()).mensaje, /\[TypeError\]/);
  });
});

test('si el servicio no responde se avisa sin detalles internos', async () => {
  stubService({ throwError: Object.assign(new Error('aborted'), { name: 'AbortError' }) });
  await withApp(async (base) => {
    const res = await postAudio(base);
    assert.equal(res.status, 504);
    assert.match((await res.json()).mensaje, /tardó más de/);
  });

  stubService({ throwError: new Error('ECONNREFUSED') });
  await withApp(async (base) => {
    const res = await postAudio(base);
    assert.equal(res.status, 503);
    assert.match((await res.json()).mensaje, /No se pudo contactar/);
  });
});

test('se validan formato y contenido antes de llamar al servicio', async () => {
  const calls = stubService();
  await withApp(async (base) => {
    const formato = await postAudio(base, { contentType: 'text/plain' });
    assert.equal(formato.status, 415);
    const vacio = await postAudio(base, { body: Buffer.alloc(0) });
    assert.equal(vacio.status, 400);
    assert.match((await vacio.json()).mensaje, /vacío/);
    assert.equal(calls.length, 0); // ninguna de las dos llegó al servicio
  });
});

test('?model=medium se reenvía igual que las demás alternativas', async () => {
  const calls = stubService({
    body: { status: 'ok', text: 'hola mundo', model_key: 'medium', model: 'medium' },
  });
  await withApp(async (base) => {
    const data = await (await postAudio(base, { query: '?model=medium' })).json();
    assert.ok(calls[0].endsWith('/transcribe?model=medium'), calls[0]);
    assert.equal(data.modelKey, 'medium');
    assert.equal(data.status, 'ok');
  });
});

test('acepta video/webm (lo que graba la cámara) y lo envía al servicio', async () => {
  const calls = stubService();
  await withApp(async (base) => {
    // El navegador graba la práctica como video/webm; el servicio transcribe su pista de audio.
    const res = await postAudio(base, { contentType: 'video/webm', body: AUDIO });
    assert.equal(res.status, 200);
    assert.equal(calls.length, 1, 'el video debe llegar al servicio como .webm');
    assert.ok(calls[0].endsWith('/transcribe'), calls[0]);
  });
});

test('una respuesta inesperada del servicio se informa como tal', async () => {
  stubService({ status: 200, body: { status: 'ok' } }); // sin `text`
  await withApp(async (base) => {
    const res = await postAudio(base);
    assert.equal(res.status, 502);
    assert.match((await res.json()).mensaje, /respuesta inesperada/);
  });
});


