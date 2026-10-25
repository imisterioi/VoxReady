// Cadena de respaldo: orden, cortes por fallo, proveedor caído y mismo fragmento.
const test = require('node:test');
const assert = require('node:assert/strict');

const { transcribeWindow, defaultEngines } = require('./asrChain');
const { transcribeAnswers } = require('./nvidiaTranscribe');

const window = { filePath: 'x.webm', startMs: 1000, endMs: 4000 };
const engine = (id, result) => ({ id, transcribe: async () => result });

test('si el principal funciona, los respaldos se cancelan y no ganan', async () => {
  let backupSignal = null;
  const result = await transcribeWindow({
    window,
    engines: [
      engine('w', { ok: true, text: 'hola' }),
      { id: 'c', transcribe: async (w, { signal }) => { backupSignal = signal; await sleep(30); return { ok: true, text: 'x' }; } },
    ],
  });
  assert.equal(result.ok, true);
  assert.equal(result.engine, 'w');
  assert.equal(backupSignal.aborted, true, 'el respaldo debe quedar cancelado');
});

test('si el principal falla, entra Canary', async () => {
  const result = await transcribeWindow({
    window,
    engines: [engine('w', { ok: false, code: 'RIVA_ERROR' }), engine('c', { ok: true, text: 'canary' })],
  });
  assert.equal(result.engine, 'c');
  assert.equal(result.text, 'canary');
});

test('si fallan los dos NVIDIA, entra el Whisper local', async () => {
  const result = await transcribeWindow({
    window,
    engines: [
      engine('w', { ok: false, code: 'TIMEOUT' }),
      engine('c', { ok: false, code: 'RIVA_ERROR' }),
      engine('l', { ok: true, text: 'local' }),
    ],
  });
  assert.equal(result.engine, 'l');
});

test('texto vacío del principal cuenta como fallo y pasa al respaldo', async () => {
  const result = await transcribeWindow({
    window,
    engines: [engine('w', { ok: true, text: '   ' }), engine('c', { ok: true, text: 'respaldo' })],
  });
  assert.equal(result.engine, 'c');
});

test('si los tres fallan no hay texto y se informa ALL_ENGINES_FAILED', async () => {
  const result = await transcribeWindow({
    window,
    engines: [engine('w', { ok: false, code: 'RIVA_ERROR' }), engine('c', { ok: false, code: 'EMPTY_TRANSCRIPT' }), engine('l', { ok: false, code: 'LOCAL_ASR_ERROR' })],
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ALL_ENGINES_FAILED');
  assert.equal(result.attempts.length, 3);
});

test('un fallo sistémico marca el proveedor como caído para el resto de la sesión', async () => {
  let whisperCalls = 0;
  const engines = [
    { id: 'w', transcribe: async () => { whisperCalls += 1; return { ok: false, code: 'NO_KEY' }; } },
    engine('c', { ok: true, text: 'canary' }),
  ];
  const down = new Set();

  await transcribeWindow({ window, engines, down });
  const second = await transcribeWindow({ window, engines, down });

  assert.equal(whisperCalls, 1, 'no se reintenta un proveedor sin clave/servicio');
  assert.equal(second.engine, 'c');
  assert.ok(second.attempts.some((a) => a.skipped === 'PROVIDER_DOWN'));
});

test('todos los motores reciben EXACTAMENTE el mismo fragmento', async () => {
  const seen = [];
  const result = await transcribeAnswers({
    filePath: 'x.webm',
    turns: [{ startMs: 0, endMs: 3000 }],
    engines: [
      { id: 'w', transcribe: async (w) => { seen.push(w); return { ok: false, code: 'RIVA_ERROR' }; } },
      { id: 'c', transcribe: async (w) => { seen.push(w); return { ok: false, code: 'RIVA_ERROR' }; } },
      { id: 'l', transcribe: async (w) => { seen.push(w); return { ok: true, text: 'ok' }; } },
    ],
  });
  assert.equal(result.ok, true);
  assert.equal(seen.length, 3);
  assert.deepEqual(seen[0], seen[1]);
  assert.deepEqual(seen[1], seen[2]);
  assert.equal(seen[0].startMs, 0);
  assert.equal(seen[0].endMs, 3200); // 3000 + margen de 200
});

test('una respuesta puede usar respaldo sin afectar a las demás', async () => {
  let call = 0;
  const result = await transcribeAnswers({
    filePath: 'x.webm',
    turns: [
      { startMs: 0, endMs: 3000 },
      { startMs: 5000, endMs: 8000 },
    ],
    engines: [
      {
        id: 'w',
        transcribe: async () => {
          call += 1;
          return call === 1 ? { ok: true, text: 'principal' } : { ok: false, code: 'RIVA_ERROR' };
        },
      },
      { id: 'c', transcribe: async () => ({ ok: true, text: 'respaldo' }) },
    ],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.enginesUsed, ['w', 'c']);
  assert.deepEqual(result.answers, ['principal', 'respaldo']);
});

test('una ventana inválida no llama a ningún motor', async () => {
  let calls = 0;
  const result = await transcribeAnswers({
    filePath: 'x.webm',
    turns: [{ question: 'sin tiempos' }],
    engines: [{ id: 'w', transcribe: async () => { calls += 1; return { ok: true, text: 'x' }; } }],
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'NO_WINDOWS');
  assert.equal(calls, 0);
});

test('un timeout del principal permite probar el siguiente motor', async () => {
  const result = await transcribeWindow({
    window,
    engines: [
      { id: 'w', timeoutMs: 10, transcribe: async () => ({ ok: false, code: 'TIMEOUT' }) },
      { id: 'c', timeoutMs: 10, transcribe: async () => ({ ok: true, text: 'canary' }) },
    ],
  });
  assert.equal(result.engine, 'c');
  assert.equal(result.attempts[0].code, 'TIMEOUT');
});

test('cada intento informa su duración y el total de la respuesta', async () => {
  const result = await transcribeWindow({
    window,
    engines: [
      { id: 'w', timeoutMs: 50, transcribe: async () => { await new Promise((r) => setTimeout(r, 10)); return { ok: false, code: 'RIVA_ERROR' }; } },
      { id: 'c', timeoutMs: 50, transcribe: async () => ({ ok: true, text: 'ok' }) },
    ],
  });
  assert.equal(result.attempts.length, 2);
  assert.ok(result.attempts[0].ms >= 5);
  assert.equal(result.attempts[0].engine, 'w');
  assert.equal(result.attempts[1].engine, 'c');
  assert.ok(result.totalMs >= result.attempts[0].ms);
});

test('el presupuesto global impide iniciar motores cuando ya no queda tiempo', async () => {
  let calls = 0;
  const result = await transcribeWindow({
    window,
    budgetMs: 0,
    engines: [{ id: 'w', timeoutMs: 1000, transcribe: async () => { calls += 1; return { ok: true, text: 'x' }; } }],
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'BUDGET_EXHAUSTED');
  assert.equal(calls, 0);
  assert.ok(result.attempts.every((attempt) => attempt.skipped === 'BUDGET_EXHAUSTED'));
});

test('el límite de cada motor se recorta al tiempo restante del presupuesto', async () => {
  const seen = [];
  await transcribeWindow({
    window,
    budgetMs: 30,
    engines: [
      { id: 'w', timeoutMs: 5000, transcribe: async (_w, { timeoutMs }) => { seen.push(timeoutMs); return { ok: true, text: 'x' }; } },
    ],
  });
  assert.ok(seen[0] <= 30, `timeout ${seen[0]} no debe superar el presupuesto`);
});

test('los metadatos quedan asociados al turno correcto', async () => {
  const result = await transcribeAnswers({
    filePath: 'x.webm',
    turns: [
      { startMs: 0, endMs: 2000 },
      { startMs: 3000, endMs: 5000 },
    ],
    engines: [
      { id: 'w', timeoutMs: 100, transcribe: async ({ startMs }) => (startMs === 0 ? { ok: true, text: 'primera' } : { ok: false, code: 'RIVA_ERROR' }) },
      { id: 'c', timeoutMs: 100, transcribe: async () => ({ ok: true, text: 'segunda' }) },
    ],
  });
  assert.equal(result.diagnostics[0].engine, 'w');
  assert.equal(result.diagnostics[0].index, 0);
  assert.equal(result.diagnostics[1].engine, 'c');
  assert.equal(result.diagnostics[1].index, 1);
  assert.equal(result.diagnostics[1].status, 'ok');
});

test('la cadena por defecto usa los tres motores en orden', () => {
  const ids = defaultEngines({}).map((engineDef) => engineDef.id);
  assert.deepEqual(ids, ['nvidia-whisper-large-v3', 'nvidia-canary-1b', 'local-whisper-small']);
});

test('las respuestas se procesan en serie (no hay concurrencia)', async () => {
  let active = 0;
  let maxActive = 0;
  await transcribeAnswers({
    filePath: 'x.webm',
    turns: [
      { startMs: 0, endMs: 2000 },
      { startMs: 3000, endMs: 5000 },
      { startMs: 6000, endMs: 8000 },
    ],
    engines: [
      {
        id: 'w',
        transcribe: async () => {
          active += 1;
// ---------------------------------------------------------------- paralelo + prioridad
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('Whisper gana aunque Canary termine antes, y se cancela el resto', async () => {
  const signals = {};
  const engines = [
    { id: 'w', timeoutMs: 1000, transcribe: async (w, { signal }) => { signals.w = signal; await sleep(15); return { ok: true, text: 'whisper' }; } },
    { id: 'c', timeoutMs: 1000, transcribe: async (w, { signal }) => { signals.c = signal; return { ok: true, text: 'canary' }; } },
    { id: 'l', timeoutMs: 1000, transcribe: async (w, { signal }) => { signals.l = signal; await sleep(50); return { ok: true, text: 'local' }; } },
  ];
  const result = await transcribeWindow({ window, engines });
  assert.equal(result.text, 'whisper');
  assert.equal(result.engine, 'w');
  assert.equal(signals.c.aborted, true);
  assert.equal(signals.l.aborted, true);
});

test('si Whisper falla, gana Canary', async () => {
  const result = await transcribeWindow({
    window,
    engines: [
      { id: 'w', timeoutMs: 1000, transcribe: async () => ({ ok: false, code: 'RIVA_ERROR' }) },
      { id: 'c', timeoutMs: 1000, transcribe: async () => ({ ok: true, text: 'canary' }) },
      { id: 'l', timeoutMs: 1000, transcribe: async () => ({ ok: true, text: 'local' }) },
    ],
  });
  assert.equal(result.engine, 'c');
  assert.equal(result.text, 'canary');
});

test('el resultado local se conserva pero no gana mientras NVIDIA siga pendiente', async () => {
  const canary = deferred();
  const engines = [
    { id: 'w', timeoutMs: 1000, transcribe: async () => ({ ok: false, code: 'RIVA_ERROR' }) },
    { id: 'c', timeoutMs: 1000, transcribe: () => canary.promise },
    { id: 'l', timeoutMs: 1000, transcribe: async () => ({ ok: true, text: 'local' }) },
  ];
  const pending = transcribeWindow({ window, engines });
  await sleep(10);
  canary.resolve({ ok: false, code: 'RIVA_ERROR' }); // NVIDIA falla tarde
  const result = await pending;
  assert.equal(result.engine, 'l');
  assert.equal(result.text, 'local');
});

test('los tres fallan: error controlado', async () => {
  const result = await transcribeWindow({
    window,
    engines: [
      { id: 'w', timeoutMs: 500, transcribe: async () => ({ ok: false, code: 'RIVA_ERROR' }) },
      { id: 'c', timeoutMs: 500, transcribe: async () => ({ ok: false, code: 'EMPTY_TRANSCRIPT' }) },
      { id: 'l', timeoutMs: 500, transcribe: async () => ({ ok: false, code: 'LOCAL_ASR_ERROR' }) },
    ],
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ALL_ENGINES_FAILED');
  assert.equal(result.attempts.filter((a) => a.ok === false).length, 3);
});

test('al agotarse el presupuesto se abortan los motores en curso', async () => {
  const signals = [];
  const result = await transcribeWindow({
    window,
    budgetMs: 30,
    sleep: () => new Promise((resolve) => setTimeout(resolve, 2)),
    now: (() => {
      let t = 0;
      return () => (t += 20);
    })(),
    engines: [
      { id: 'w', timeoutMs: 5000, transcribe: async (w, { signal }) => { signals.push(signal); return new Promise(() => {}); } },
      { id: 'c', timeoutMs: 5000, transcribe: async (w, { signal }) => { signals.push(signal); return new Promise(() => {}); } },
    ],
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'BUDGET_EXHAUSTED');
  assert.ok(signals.every((signal) => signal.aborted), 'toda petición en curso debe abortarse');
});

test('un resultado tardío no reemplaza la transcripción ya seleccionada', async () => {
  const late = deferred();
  const result = await transcribeWindow({
    window,
    engines: [
      { id: 'w', timeoutMs: 1000, transcribe: async () => ({ ok: true, text: 'ganador' }) },
      { id: 'l', timeoutMs: 1000, transcribe: () => late.promise },
    ],
  });
  late.resolve({ ok: true, text: 'tarde' });
  await sleep(5);
  assert.equal(result.text, 'ganador');
  assert.equal(result.engine, 'w');
});

          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          active -= 1;
          return { ok: true, text: 'x' };
        },
      },
    ],
  });
  assert.equal(maxActive, 1);
});


test('la cadena real respeta el orden Whisper Large v3 -> Canary 1B -> local', async () => {
  const calls = [];
  const engines = defaultEngines({
    language: 'multi',
    runAsrImpl: async ({ modelKey, language }) => {
      calls.push(`${modelKey}:${language}`);
      return modelKey === 'whisper-large-v3' ? { ok: true, text: 'principal' } : { ok: false, code: 'RIVA_ERROR' };
    },
    localImpl: async () => ({ ok: true, text: 'local' }),
  });
  assert.deepEqual(engines.map((engine) => engine.id), ['nvidia-whisper-large-v3', 'nvidia-canary-1b', 'local-whisper-small']);
  const result = await transcribeWindow({ window, engines });
  assert.equal(result.engine, 'nvidia-whisper-large-v3');
  assert.equal(result.text, 'principal');
  assert.equal(calls[0], 'whisper-large-v3:multi');
  assert.ok(calls.includes('canary-1b-asr:es-US'), 'Canary se intenta en paralelo');
});

test('si fallan los dos NVIDIA, el local resuelve la respuesta', async () => {
  const engines = defaultEngines({
    runAsrImpl: async ({ modelKey, language }) => {
      assert.ok(modelKey === 'whisper-large-v3' || (modelKey === 'canary-1b-asr' && language === 'es-US'));
      return { ok: false, code: 'TIMEOUT' };
    },
    localImpl: async () => ({ ok: true, text: 'texto local' }),
  });
  const result = await transcribeWindow({ window, engines });
  assert.equal(result.engine, 'local-whisper-small');
  assert.equal(result.text, 'texto local');
});

test('si los tres motores fallan no hay texto ni informe utilizable', async () => {
  const engines = defaultEngines({
    runAsrImpl: async () => ({ ok: false, code: 'RIVA_ERROR' }),
    localImpl: async () => ({ ok: false, code: 'LOCAL_ASR_ERROR' }),
  });
  const result = await transcribeAnswers({
    filePath: 'x.webm',
    turns: [{ startMs: 0, endMs: 2000 }, { startMs: 2000, endMs: 4000 }],
    engines,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ANSWER_TRANSCRIPTION_FAILED');
  assert.deepEqual(result.answers, ['', '']);
  assert.equal(result.failures.length, 2);
});

test('una transcripcion vacia no es exito y pasa al siguiente motor', async () => {
  const engines = defaultEngines({
    runAsrImpl: async () => ({ ok: true, text: '   ' }),
    localImpl: async () => ({ ok: true, text: 'local valido' }),
  });
  const result = await transcribeAnswers({ filePath: 'x.webm', turns: [{ startMs: 0, endMs: 2000 }], engines });
  assert.equal(result.ok, true);
  assert.deepEqual(result.answers, ['local valido']);
  assert.equal(result.enginesUsed[0], 'local-whisper-small');
});
