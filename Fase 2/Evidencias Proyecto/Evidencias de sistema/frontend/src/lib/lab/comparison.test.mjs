import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RECORDED_ENGINE_IDS,
  appendRun,
  latestByEngine,
  runEnginesOnRecording,
  toComparisonCsv,
} from './comparison.js';

const blob = { size: 1234, type: 'audio/webm' };

test('ejecuta los tres motores en serie, nunca en paralelo, con el MISMO audio', async () => {
  const seen = [];
  let active = 0;
  let maxActive = 0;

  const rows = await runEnginesOnRecording({
    blob,
    audioMs: 6000,
    runId: 'r1',
    transcribe: async (received, modelKey) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      seen.push({ same: received === blob, modelKey });
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return { ok: true, text: `texto ${modelKey}`, processingMs: 600, clientMs: 700, totalMs: 710 };
    },
  });

  assert.deepEqual(seen.map((s) => s.modelKey), ['base', 'small', 'medium']);
  assert.ok(seen.every((s) => s.same), 'todos reciben el mismo objeto de audio');
  assert.equal(maxActive, 1, 'no debe haber dos motores a la vez');
  assert.deepEqual(rows.map((r) => r.engineId), RECORDED_ENGINE_IDS);
  assert.ok(rows.every((r) => r.status === 'ok' && r.runId === 'r1'));
});

test('un motor que falla no impide los siguientes y conserva el error', async () => {
  const rows = await runEnginesOnRecording({
    blob,
    audioMs: 4000,
    runId: 'r2',
    transcribe: async (_blob, modelKey) => {
      if (modelKey === 'small') return { ok: false, error: 'El servicio no está disponible.' };
      return { ok: true, text: modelKey, processingMs: 200, clientMs: 210 };
    },
  });

  assert.equal(rows.length, 3);
  assert.equal(rows[0].status, 'ok');
  assert.equal(rows[1].status, 'error');
  assert.match(rows[1].error, /no está disponible/);
  assert.equal(rows[2].status, 'ok', 'Medium se ejecuta aunque Small falle');
});

test('una excepción del cliente también se registra y no corta la serie', async () => {
  const rows = await runEnginesOnRecording({
    blob,
    runId: 'r3',
    transcribe: async () => {
      throw new Error('red caída');
    },
  });
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => r.status === 'error' && /red caída/.test(r.error)));
});

test('la fila incluye duración, tiempos y RTF calculado sobre el procesamiento', async () => {
  const [row] = await runEnginesOnRecording({
    blob,
    audioMs: 6000,
    runId: 'r4',
    engineIds: ['whisper-base'],
    transcribe: async () => ({ ok: true, text: 'hola', processingMs: 1200, loadMs: 300, clientMs: 1500, totalMs: 1520, durationSeconds: 6 }),
  });

  assert.equal(row.audioMs, 6000);
  assert.equal(row.serverDurationMs, 6000);
  assert.equal(row.loadMs, 300);
  assert.equal(row.processingMs, 1200);
  assert.equal(row.requestMs, 1500);
  assert.equal(row.totalMs, 1520);
  assert.equal(row.rtf, 0.2);
  assert.equal(row.engine, 'Whisper Base');
  assert.ok(row.startedAt <= row.finishedAt);
});

test('sin grabación no se llama a ningún motor', async () => {
  await assert.rejects(() => runEnginesOnRecording({ blob: null, transcribe: async () => ({}) }), /grabación/);
  await assert.rejects(() => runEnginesOnRecording({ blob: { size: 0 }, transcribe: async () => ({}) }), /grabación/);
});

test('el historial conserva ejecuciones anteriores del mismo motor', async () => {
  const first = await runEnginesOnRecording({
    blob,
    runId: 'a',
    engineIds: ['whisper-base'],
    transcribe: async () => ({ ok: true, text: 'primera', processingMs: 100, clientMs: 110 }),
  });
  const second = await runEnginesOnRecording({
    blob,
    runId: 'b',
    engineIds: ['whisper-base'],
    transcribe: async () => ({ ok: true, text: 'segunda', processingMs: 90, clientMs: 95 }),
  });

  const history = appendRun(appendRun([], 'a', first), 'b', second);
  assert.equal(history.length, 2, 'no se borra la ejecución anterior');
  assert.deepEqual(history.map((r) => r.text), ['primera', 'segunda']);

  const latest = latestByEngine(history);
  assert.equal(latest.length, 1);
  assert.equal(latest[0].text, 'segunda', 'la tabla muestra la última de cada motor');
});

test('onUpdate informa qué motor está en curso', async () => {
  const events = [];
  await runEnginesOnRecording({
    blob,
    runId: 'r5',
    engineIds: ['whisper-base', 'whisper-small'],
    transcribe: async () => ({ ok: true, text: 'x' }),
    onUpdate: (state) => events.push(state.runningEngineId ?? 'fin'),
  });
  assert.ok(events.includes('whisper-base'));
  assert.ok(events.includes('whisper-small'));
});

test('el CSV escapa comillas, punto y coma y saltos de línea', () => {
  const csv = toComparisonCsv([
    {
      engine: 'Whisper Base',
      modelKey: 'base',
      status: 'ok',
      audioMs: 6000,
      processingMs: 1000,
      requestMs: 1100,
      totalMs: 1120,
      rtf: 0.1666,
      text: 'dijo "hola"; luego\nsiguió',
      error: null,
      finishedAt: Date.UTC(2026, 0, 2, 3, 4, 5),
    },
  ]);
  const lines = csv.split('\r\n');
  assert.equal(lines[0].split(';').length, 12);
  assert.equal(lines.length, 2, 'una fila por ejecución, aunque el texto tenga saltos o punto y coma');
  assert.match(csv, /""hola""/);
  assert.match(csv, /"0\.167"/);
});
