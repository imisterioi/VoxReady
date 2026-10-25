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

test('el motivo real de un error HTTP se conserva (sin exponerlo a la interfaz)', async () => {
  const httpError = Object.assign(new Error('Error 503'), { status: 503, code: 'EVAL_NVIDIA_ASR_DISABLED' });
  const payload = { transcript: [], metrics: {} };
  const result = await runAnalysis({
    sessionId: 's1',
    payload,
    postEvaluate: async () => {
      throw httpError;
    },
    fetchSession: async () => ({ session: { report: null }, evaluation: { state: 'processing' } }),
    sleep: noSleep,
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'EVAL_NVIDIA_ASR_DISABLED', 'se conserva el código real');
  assert.equal(result.httpStatus, 503, 'se conserva el estado HTTP real');
  // Sin código ni estado, sigue siendo el motivo genérico de red.
  const generic = await runAnalysis({
    sessionId: 's1',
    payload,
    postEvaluate: async () => {
      throw new Error('sin conexión');
    },
    fetchSession: async () => ({ session: { report: null }, evaluation: { state: 'processing' } }),
    sleep: noSleep,
  });
  assert.equal(generic.reason, 'NETWORK');
  assert.equal(generic.httpStatus, null);
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

test('al agotarse el sondeo la evaluación sigue en curso: no es un fallo ni se cancela', async () => {
  let now = 0;
  const controller = new AbortController();
  const result = await runAnalysis({
    sessionId: 's1',
    postEvaluate: async () => ({ session: { report: null } }),
    fetchSession: async () => ({ session: { report: null }, evaluation: { state: 'processing', stage: 'ai' } }),
    sleep: async () => {
      now += 30_000;
    },
    now: () => now,
    timeoutMs: 8 * 60 * 1000,
    signal: controller.signal,
  });
  // La generación continúa en el backend: el informe llegará a «Mi progreso».
  assert.equal(result.status, 'pending');
  assert.equal(result.reason, 'STILL_RUNNING');
  assert.ok(now >= 8 * 60 * 1000, `terminó en ${now} ms, antes del límite configurado`);
  assert.equal(controller.signal.aborted, false, 'nunca se aborta el trabajo en curso');
});

test('un reintento programado no se trata como fallo: sigue esperando y avisa pendiente', async () => {
  const stages = [];
  let polls = 0;
  const result = await runAnalysis({
    sessionId: 's1',
    postEvaluate: async () => ({ session: { report: null } }),
    fetchSession: async () => {
      polls += 1;
      if (polls <= 2) return { session: { report: null }, evaluation: { state: 'retrying', attempts: polls, nextAttemptAt: Date.now() + 180000 } };
      if (polls === 3) return { session: { report: null }, evaluation: { state: 'exhausted', attempts: 50 } };
      return { session: { report: { global: 70 } }, evaluation: { state: 'done' } };
    },
    sleep: noSleep,
    onStage: (stage) => stages.push(stage),
  });

  assert.equal(result.status, 'done', 'el reintento automático no es un fallo');
  assert.deepEqual(stages, ['pending', 'exhausted'], 'la interfaz recibe estados de espera');
  assert.ok(polls >= 4, 'sigue consultando hasta que aparece el informe');
});

test('una sesión agotada tampoco se presenta como error: espera hasta el límite', async () => {
  let now = 0;
  const result = await runAnalysis({
    sessionId: 's1',
    postEvaluate: async () => ({ session: { report: null } }),
    fetchSession: async () => ({ session: { report: null }, evaluation: { state: 'exhausted', attempts: 50, maxAttempts: 50 } }),
    sleep: async (ms) => { now += ms; },
    now: () => now,
    timeoutMs: 60_000,
  });
  // Nunca se convierte en `failed` por el estado: solo el límite de sondeo lo detiene, y sigue en curso.
  assert.equal(result.status, 'pending');
  assert.equal(result.reason, 'STILL_RUNNING');
});


test('pasados 60 s la evaluación sigue en curso: el cliente no cancela ni cambia el estado', async () => {
  // Reloj simulado: se representan 90 s sin esperar de verdad.
  let now = 0;
  const polls = [];
  const backendState = { state: 'processing' };
  const result = await runAnalysis({
    sessionId: 's1',
    postEvaluate: async () => ({ session: { report: null } }),
    fetchSession: async () => {
      polls.push(now);
      if (now > 90_000) {
        backendState.state = 'done';
        return { session: { report: { global: 70 } }, evaluation: { state: 'done' } };
      }
      return { session: { report: null }, evaluation: { state: 'processing', stage: 'ai' } };
    },
    sleep: async (ms) => { now += ms; },
    now: () => now,
    timeoutMs: 5 * 60 * 1000,
  });
  assert.equal(result.status, 'done', 'una evaluación larga termina publicando su informe');
  assert.ok(polls.some((t) => t > 60_000), 'se sigue consultando después de los 60 s');
  assert.ok(polls.length > 1, 'no se abandona tras el primer sondeo');
  assert.equal(backendState.state, 'done', 'el cliente solo lee el estado: nunca lo modifica');
});

test('el fallo conserva la clasificación del backend para elegir el mensaje', async () => {
  const result = await runAnalysis({
    sessionId: 's1',
    postEvaluate: async () => ({ session: { report: null } }),
    fetchSession: async () => ({
      session: { report: null },
      evaluation: { state: 'failed', reason: 'AI_UNAVAILABLE', errorKind: 'permanent' },
    }),
    sleep: noSleep,
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'AI_UNAVAILABLE');
  assert.equal(result.errorKind, 'permanent');
});

