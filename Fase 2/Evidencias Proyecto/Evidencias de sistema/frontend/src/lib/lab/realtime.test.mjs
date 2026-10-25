import assert from 'node:assert/strict';
import test from 'node:test';

import { createChunkPipeline, latencyStats, monotonicNow } from './realtime.js';

const blob = (n = 1) => ({ size: n });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('latencyStats calcula media, mediana y máximo', () => {
  assert.deepEqual(latencyStats([100, 300, 200]), { count: 3, avg: 200, median: 200, max: 300 });
  assert.deepEqual(latencyStats([100, 200]), { count: 2, avg: 150, median: 150, max: 200 });
  assert.deepEqual(latencyStats([]), { count: 0, avg: null, median: null, max: null });
  assert.equal(latencyStats([100, NaN, Infinity]).count, 1);
});

test('los fragmentos se procesan en serie y en orden', async () => {
  const order = [];
  let active = 0;
  let maxActive = 0;
  const pipeline = createChunkPipeline({
    transcribe: async (_blob, { index }) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      order.push(index);
      await wait(5);
      active -= 1;
      return { text: `t${index}` };
    },
  });

  pipeline.push(blob());
  pipeline.push(blob());
  const result = await pipeline.stop();

  assert.deepEqual(order, [0, 1]);
  assert.equal(maxActive, 1, 'nunca debe haber dos transcripciones a la vez');
  assert.equal(result.status, 'complete');
  assert.equal(pipeline.stats().generated, 2);
  assert.equal(pipeline.stats().processed, 2);
});

test('el último fragmento es provisional y el anterior pasa a confirmado', async () => {
  const pipeline = createChunkPipeline({
    transcribe: async (_b, { index }) => ({ text: `frase${index}` }),
  });

  pipeline.push(blob());
  await wait(10);
  assert.equal(pipeline.getState().confirmed, '');
  assert.equal(pipeline.getState().provisional, 'frase0');

  pipeline.push(blob());
  await wait(10);
  assert.equal(pipeline.getState().confirmed, 'frase0');
  assert.equal(pipeline.getState().provisional, 'frase1');

  await pipeline.stop();
  assert.equal(pipeline.text(), 'frase0 frase1');
  assert.equal(pipeline.getState().provisional, '');
});

test('la latencia usa el reloj monotónico y no produce valores epoch', async () => {
  let clock = 1000;
  const now = () => {
    clock += 20;
    return clock;
  };
  const pipeline = createChunkPipeline({ now, transcribe: async () => ({ text: 'x' }) });

  pipeline.push(blob(), { endedAt: now() });
  await pipeline.stop();

  const stats = pipeline.stats();
  assert.ok(stats.latency.avg != null && stats.latency.avg < 5000, `latencia irreal: ${stats.latency.avg}`);
  assert.ok(stats.latency.max < 5000);
  assert.ok(stats.audioToText.count >= 1, 'audio→texto se mide si el reloj coincide');
});

test('una marca `endedAt` de otro reloj se ignora en vez de falsear la latencia', async () => {
  const pipeline = createChunkPipeline({
    now: () => 5000,
    transcribe: async () => ({ text: 'x' }),
  });

  // Date.now() está ~1.79e12 ms por encima de performance.now(): desfase imposible.
  pipeline.push(blob(), { endedAt: Date.now() });
  await pipeline.stop();

  const [chunk] = pipeline.getState().chunks;
  assert.equal(chunk.audioToTextMs, null, 'no se inventa una latencia audio→texto');
  assert.ok(chunk.latencyMs < 60000, 'la latencia desde el envío sigue siendo válida');
  assert.equal(pipeline.stats().audioToText.count, 0);

test('un fragmento que falla no rompe el siguiente y deja el estado incompleto', async () => {
  const pipeline = createChunkPipeline({
    transcribe: async (_b, { index }) => {
      if (index === 0) throw new Error('whisper caído');
      return { text: 'bueno' };
    },
  });

  pipeline.push(blob());
  pipeline.push(blob());
  const result = await pipeline.stop();

  const state = pipeline.getState();
  assert.equal(state.errors.length, 1);
  assert.equal(state.errors[0].code, 'Error');
  assert.match(state.errors[0].message, /whisper caído/);
  assert.equal(pipeline.text(), 'bueno');
  assert.equal(result.failed, 1);
  assert.equal(result.status, 'incomplete', 'un fallo impide declararla completa');
  assert.equal(result.complete, false);
});

test('si todos los fragmentos fallan, la sesión es fallida', async () => {
  const pipeline = createChunkPipeline({
    transcribe: async () => {
      throw new Error('servicio apagado');
    },
  });
  pipeline.push(blob());
  const result = await pipeline.stop();
  assert.equal(result.status, 'failed');
  assert.equal(result.complete, false);
  assert.equal(pipeline.getState().processed, 0);
});

test('avisa cuando la cola crece y registra el máximo', async () => {
  const pipeline = createChunkPipeline({
    maxQueue: 1,
    transcribe: () => new Promise((r) => setTimeout(() => r({ text: 'x' }), 20)),
  });
  pipeline.push(blob());
  pipeline.push(blob());
  pipeline.push(blob());
  assert.equal(pipeline.getState().overloaded, true);
  await pipeline.stop();
  assert.equal(pipeline.getState().overloaded, false);
  assert.equal(pipeline.stats().maxQueueDepth, 2);
});

test('stop consolida todo y deja de marcar fragmentos pendientes', async () => {
  const pipeline = createChunkPipeline({ transcribe: async (_b, { index }) => ({ text: `p${index}` }) });
  pipeline.push(blob());
  pipeline.push(blob());
  pipeline.push(blob());
  const result = await pipeline.stop();
  assert.equal(result.complete, true);
  assert.equal(result.pending, 0);
  assert.equal(result.status, 'complete');
  assert.equal(pipeline.text(), 'p0 p1 p2');
  assert.ok(result.tailMs >= 0);
});

test('si no da tiempo a procesar, lo dice y no finge que terminó', async () => {
  const pipeline = createChunkPipeline({
    transcribe: () => new Promise(() => {}), // nunca resuelve
    flushTimeoutMs: 0,
  });
  pipeline.push(blob());
  const result = await pipeline.stop();
  assert.equal(result.complete, false);
  assert.equal(result.status, 'incomplete');
  assert.ok(result.pending >= 1);
  assert.ok(pipeline.stats().errors.some((e) => e.code === 'FLUSH_TIMEOUT'));
});

test('cancelar aborta la petición en curso y descarta su texto tardío', async () => {
  let aborted = false;
  const pipeline = createChunkPipeline({
    transcribe: (_blob, { signal }) =>
      new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => {
          aborted = true;
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
        setTimeout(() => resolve({ text: 'texto tardío' }), 40);
      }),
  });

  pipeline.push(blob());
  await wait(5);
  pipeline.cancel();
  await wait(60);

  assert.equal(aborted, true, 'la petición en curso debe abortarse');
  assert.equal(pipeline.text(), '', 'no se aplica texto de una sesión cancelada');
  assert.equal(pipeline.getState().processed, 0);
  assert.equal(pipeline.getState().status, 'cancelled');
});

test('cancelar vacía la cola pendiente', async () => {
  const pipeline = createChunkPipeline({
    transcribe: () => new Promise((r) => setTimeout(() => r({ text: 'x' }), 50)),
  });
  pipeline.push(blob());
  pipeline.push(blob());
  pipeline.cancel();
  assert.equal(pipeline.getState().pending, 0);
  assert.equal(pipeline.getState().overloaded, false);
  assert.equal(pipeline.getState().status, 'cancelled');
});

test('un fragmento vacío se registra como fallo, no se envía', async () => {
  let calls = 0;
  const pipeline = createChunkPipeline({
    transcribe: async () => {
      calls += 1;
      return { text: 'x' };
    },
  });

  assert.equal(pipeline.push({ size: 0 }), false);
  await wait(5);
  assert.equal(calls, 0);
  const state = pipeline.getState();
  assert.equal(state.failed, 1);
  assert.equal(state.errors[0].code, 'EMPTY_CHUNK');
  assert.equal(state.generated, 0);
});

test('acumula el tiempo de procesamiento de los fragmentos', async () => {
  const pipeline = createChunkPipeline({
    transcribe: async () => {
      await wait(10);
      return { text: 'x' };
    },
  });
  pipeline.push(blob());
  pipeline.push(blob());
  await pipeline.stop();
  const stats = pipeline.stats();
  assert.ok(stats.processingMs >= 15, `procesamiento acumulado irreal: ${stats.processingMs}`);
  assert.ok(stats.processingMs < 5000);
});

test('monotonicNow devuelve milisegundos del reloj monotónico', () => {
  const value = monotonicNow();
  assert.ok(Number.isFinite(value));
  assert.ok(value < Date.now(), 'no debe ser una marca epoch');
});

});
