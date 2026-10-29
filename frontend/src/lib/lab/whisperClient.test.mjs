import assert from 'node:assert/strict';
import test from 'node:test';

import { describeModelStatus, transcribeChunk } from './whisperClient.js';

const healthWith = (models) => ({ available: true, service: { models } });

test('describeModelStatus lee el estado real de cada modelo', () => {
  const list = describeModelStatus(
    healthWith({
      base: { loaded: true, load_ms: 900, device: 'cpu', model: 'base' },
      small: { loaded: false, loading: true },
      medium: { loaded: false, load_error: 'ModelUnavailable' },
    }),
  );

  assert.deepEqual(
    list.map((m) => [m.key, m.state]),
    [
      ['base', 'loaded'],
      ['small', 'loading'],
      ['medium', 'error'],
    ],
  );
  assert.equal(list[0].loadMs, 900);
  assert.equal(list[2].loadError, 'ModelUnavailable');
});

test('describeModelStatus no inventa estado si el servicio no informa modelos', () => {
  const list = describeModelStatus({ available: true, service: null });
  assert.equal(list.length, 3);
  assert.ok(list.every((m) => m.state === 'unknown' && m.loaded === null));

  const partial = describeModelStatus(healthWith({ base: { loaded: true } }));
  assert.equal(partial[1].state, 'missing');
  assert.equal(partial[1].loaded, null);
});

test('sin fragmento no se llama al servidor', async () => {
  let called = false;
  const result = await transcribeChunk({
    blob: null,
    modelKey: 'small',
    apiUrl: 'http://x',
    fetchImpl: async () => {
      called = true;
      return { ok: true, json: async () => ({ text: '' }) };
    },
  });
  assert.equal(called, false);
  assert.equal(result.ok, false);
  assert.match(result.error, /vacío/);
});

test('traduce una respuesta correcta a los campos reales del backend', async () => {
  const seen = [];
  const result = await transcribeChunk({
    blob: { size: 10, type: 'audio/wav' },
    modelKey: 'small',
    apiUrl: 'http://api',
    token: 't',
    fetchImpl: async (url, init) => {
      seen.push({ url, init });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: 'ok',
          text: 'hola',
          processingMs: 120,
          modelLoadMs: 0,
          proxyMs: 130,
          totalMs: 132,
          modelKey: 'small',
          modelName: 'small',
          durationSeconds: 6,
          rtf: 0.02,
          audioBytes: 576000,
        }),
      };
    },
  });

  assert.equal(seen[0].url, 'http://api/api/lab/transcribe?model=small');
  assert.equal(seen[0].init.headers['Content-Type'], 'audio/wav');
  assert.equal(seen[0].init.headers.Authorization, 'Bearer t');
  assert.equal(result.ok, true);
  assert.equal(result.text, 'hola');
  assert.equal(result.processingMs, 120);
  assert.equal(result.proxyMs, 130);
  assert.equal(result.durationSeconds, 6);
});

test('un 403 explica el rol y no expone el token', async () => {
  const result = await transcribeChunk({
    blob: { size: 10, type: 'audio/wav' },
    modelKey: 'base',
    apiUrl: 'http://api',
    token: 'secreto',
    fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({ mensaje: 'detalle interno' }) }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.match(result.error, /rol/);
  assert.doesNotMatch(result.error, /secreto/);
});

test('un 503 reenvía el mensaje del backend', async () => {
  const result = await transcribeChunk({
    blob: { size: 10, type: 'audio/wav' },
    modelKey: 'medium',
    apiUrl: 'http://api',
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({ mensaje: 'El servicio no está levantado.' }) }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'El servicio no está levantado.');
});

test('una respuesta sin `text` se trata como inesperada, no como texto vacío válido', async () => {
  const result = await transcribeChunk({
    blob: { size: 10, type: 'audio/wav' },
    modelKey: 'base',
    apiUrl: 'http://api',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ status: 'ok' }) }),
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /inesperada/);
});

test('un fallo de red y un timeout devuelven mensajes distintos', async () => {
  const network = await transcribeChunk({
    blob: { size: 10, type: 'audio/wav' },
    modelKey: 'base',
    apiUrl: 'http://api',
    fetchImpl: async () => {
      throw new TypeError('Failed to fetch');
    },
  });
  assert.equal(network.ok, false);
  assert.match(network.error, /No se pudo contactar/);

  const aborted = await transcribeChunk({
    blob: { size: 10, type: 'audio/wav' },
    modelKey: 'base',
    apiUrl: 'http://api',
    fetchImpl: async () => {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    },
  });
  assert.equal(aborted.ok, false);
  assert.match(aborted.error, /no respondió a tiempo/);
});
