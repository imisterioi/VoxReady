// Pruebas de ventanas por respuesta y de la transcripción independiente.
//   cd backend && node --test lib/nvidiaTranscribe.test.js
const test = require('node:test');
const assert = require('node:assert/strict');

const { windowsForTurns } = require('./nvidiaWindows');
const { transcribeAnswers } = require('./nvidiaTranscribe');

test('las ventanas respetan los tiempos y añaden margen sin pisar al vecino', () => {
  const windows = windowsForTurns({
    padMs: 200,
    turns: [
      { startMs: 1000, endMs: 5000 },
      { startMs: 6000, endMs: 9000 },
    ],
  });
  assert.deepEqual(windows[0], { index: 0, startMs: 800, endMs: 5200, ok: true, reason: null });
  // La segunda no puede empezar antes del fin de la primera.
  assert.equal(windows[1].startMs, 5800);
  assert.equal(windows[1].endMs, 9200);
  assert.equal(windows[0].endMs <= windows[1].startMs, true);
});

test('tiempos inválidos o ausentes no generan ventana', () => {
  const windows = windowsForTurns({
    turns: [{}, { startMs: 500, endMs: 500 }, { startMs: -10, endMs: 900 }, { startMs: 'x', endMs: 900 }],
  });
  assert.deepEqual(windows.map((w) => w.reason), ['NO_TIMES', 'INVALID_RANGE', 'INVALID_RANGE', 'NO_TIMES']);
  assert.equal(windows.every((w) => !w.ok), true);
});

test('una respuesta vacía no se inventa: se reporta como no transcribible', async () => {
  const result = await transcribeAnswers({
    filePath: 'x.webm',
    turns: [{}],
    runAsrImpl: async () => {
      throw new Error('no debería llamarse');
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'NO_WINDOWS');
});

test('transcribe en serie y asigna cada texto a su turno', async () => {
  let active = 0;
  let maxActive = 0;
  const calls = [];
  const result = await transcribeAnswers({
    filePath: 'x.webm',
    turns: [
      { startMs: 0, endMs: 4000 },
      { startMs: 5000, endMs: 8000 },
    ],
    runAsrImpl: async ({ startMs, endMs }) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      calls.push([startMs, endMs]);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return { ok: true, text: `texto ${startMs}` };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(maxActive, 1, 'nunca dos peticiones a la vez');
  assert.equal(calls.length, 2);
  assert.equal(result.answers[0], 'texto 0');
  assert.equal(result.answers[1], 'texto 4800');
});

test('un fallo parcial no produce evaluación: lo marca y no atribuye texto', async () => {
  const result = await transcribeAnswers({
    filePath: 'x.webm',
    turns: [
      { startMs: 0, endMs: 4000 },
      { startMs: 5000, endMs: 8000 },
    ],
    runAsrImpl: async ({ startMs }) => (startMs === 0 ? { ok: true, text: 'uno' } : { ok: false, code: 'RIVA_ERROR', message: 'caído' }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ANSWER_TRANSCRIPTION_FAILED');
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].index, 1);
  assert.equal(result.answers[1], '');
});

test('una respuesta vacía de NVIDIA cuenta como fallo', async () => {
  const result = await transcribeAnswers({
    filePath: 'x.webm',
    turns: [{ startMs: 0, endMs: 4000 }],
    runAsrImpl: async () => ({ ok: true, text: '   ' }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.failures[0].code, 'ALL_ENGINES_FAILED');
  assert.equal(result.failures[0].attempts[0].code, 'EMPTY_TRANSCRIPT');
});
