import assert from 'node:assert/strict';
import test from 'node:test';

import { runAnalysis } from './analysisRunner.js';

const noSleep = async () => {};

// Backend falso: N sondeos en proceso y luego el informe.
function fakeBackend({ processingPolls = 1, report = true, state = 'processing', throws = false } = {}) {
  const calls = { post: 0, fetch: 0 };
  let polls = 0;
  return {
    calls,
    postEvaluate: async () => {
      calls.post += 1;
      return { session: { report: null } };
    },
    fetchSession: async () => {
      calls.fetch += 1;
      if (throws) throw new Error('sin conexión');
      if (polls < processingPolls) {
        polls += 1;
        return { session: { report: null }, evaluation: { state, stage: 'audio' } };
      }
      return { session: { report: report ? { global: 70 } : null }, evaluation: { state: 'done', stage: 'done' } };
    },
  };
}

test('el polling funciona después de un cleanup de StrictMode', async () => {
  const backend = fakeBackend({ processingPolls: 2 });

  // Primer montaje: se cancela antes de terminar (como hace StrictMode).
  const first = new AbortController();
  const runA = runAnalysis({ sessionId: 's1', payload: { x: 1 }, ...backend, signal: first.signal, sleep: noSleep });
  first.abort();
  assert.equal((await runA).status, 'cancelled');

  // Segundo montaje: debe seguir consultando y terminar.
  const second = new AbortController();
  const runB = await runAnalysis({ sessionId: 's1', ...backend, signal: second.signal, sleep: noSleep });
  assert.equal(runB.status, 'done');
  assert.equal(backend.calls.post, 1);
  assert.ok(backend.calls.fetch >= 2);
});

test('con ?sesion= (sin payload) consulta sin volver a evaluar', async () => {
  const backend = fakeBackend({ processingPolls: 1 });
  const result = await runAnalysis({ sessionId: 's1', payload: null, ...backend, sleep: noSleep });
  assert.equal(result.status, 'done');
  assert.equal(backend.calls.post, 0, 'no debe llamar a POST /evaluate');
  assert.ok(backend.calls.fetch > 0);
});

test('una sesión en proceso se sigue consultando hasta tener informe', async () => {
  const backend = fakeBackend({ processingPolls: 3 });
  const stages = [];
  const result = await runAnalysis({
    sessionId: 's1',
    ...backend,
    sleep: noSleep,
    onStage: (stage) => stages.push(stage),
  });
  assert.equal(result.status, 'done');
  assert.equal(backend.calls.fetch, 4);
  assert.deepEqual(stages, ['audio']);
});

test('una sesión completada devuelve done con su id', async () => {
  const backend = fakeBackend({ processingPolls: 0 });
  const result = await runAnalysis({ sessionId: 's9', ...backend, sleep: noSleep });
  assert.deepEqual(result, { status: 'done', sessionId: 's9' });
});

test('una evaluación fallida no se presenta como completada', async () => {
  const result = await runAnalysis({
    sessionId: 's1',
    postEvaluate: async () => ({ session: { report: null } }),
    fetchSession: async () => ({ session: { report: null }, evaluation: { state: 'failed', reason: 'AI_UNAVAILABLE' } }),
    sleep: noSleep,
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'AI_UNAVAILABLE');
});

test('un error de consulta no se interpreta como completado', async () => {
  const backend = fakeBackend({ throws: true });
  const result = await runAnalysis({ sessionId: 's1', ...backend, sleep: noSleep });
  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'NETWORK');
});

test('una ejecución cancelada no puede modificar el estado ni navegar', async () => {
  let stageCalls = 0;
  const controller = new AbortController();
  const result = await runAnalysis({
    sessionId: 's1',
    postEvaluate: async () => ({ session: { report: null } }),
    fetchSession: async () => {
      controller.abort(); // se cancela mientras consulta
      return { session: { report: { global: 1 } }, evaluation: { state: 'done' } };
    },
    signal: controller.signal,
    sleep: noSleep,
    onStage: () => { stageCalls += 1; },
  });
  assert.equal(result.status, 'cancelled');
  assert.equal(stageCalls, 0);
});

test('el timeout no se adelanta ni se acorta', async () => {
  let now = 0;
  const result = await runAnalysis({
    sessionId: 's1',
    postEvaluate: async () => ({ session: { report: null } }),
    fetchSession: async () => ({ session: { report: null }, evaluation: { state: 'processing', stage: 'ai' } }),
    sleep: async () => { now += 30_000; },
    now: () => now,
    timeoutMs: 8 * 60 * 1000,
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'TIMEOUT');
  assert.ok(now >= 8 * 60 * 1000, `terminó en ${now} ms, antes del timeout configurado`);
});
