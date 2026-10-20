// Pruebas del Laboratorio de transcripción: selección de motores, comparación justa
// (mismo audio y mismo guion), tolerancia a fallos, ejecución en serie y conservación
// del historial y la exportación.
//
//   cd frontend
//   node --test src/lib/lab/engines.test.mjs
//
// No usan red, ni modelos, ni navegador: el "motor" se sustituye por una función que
// devuelve lo mismo que devolvería el transporte del laboratorio.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  COMPARE_ALL_ID,
  COMPARISON_ORDER,
  DEFAULT_ENGINE_ID,
  ENGINES,
  comparisonIds,
  describeSelection,
  enginesRecord,
  engineIds,
  failureResult,
  finishResult,
  getEngine,
  idleResult,
  isEngineId,
  metricsFor,
  runEnginesSequentially,
  summarizeComparison,
  supportsFileInput,
  targetIdsFor,
} from './engines.js';

import { buildRunRecord, characterErrorReport, toCSV, toJSON, wordErrorReport } from './transcription.js';

const REFERENCE = 'el vocero habla claro y responde con transparencia';

// ---------------------------------------------------------------- 1. selección

test('el catálogo ofrece las cuatro alternativas y solo esas', () => {
  assert.deepEqual(engineIds().sort(), [
    'speech-api',
    'whisper-base',
    'whisper-medium',
    'whisper-small',
  ]);
  assert.equal(getEngine('whisper-small').modelKey, 'small');
  assert.equal(getEngine('whisper-base').modelKey, 'base');
  assert.equal(getEngine('whisper-medium').modelKey, 'medium');
  assert.equal(getEngine('speech-api').kind, 'browser-speech');
  assert.equal(getEngine('whisper-large'), null);
  assert.equal(isEngineId('whisper-large'), false);
});

test('Whisper Medium se incorpora sin pisar las claves de las alternativas existentes', () => {
  const medium = getEngine('whisper-medium');
  assert.equal(medium.storageKey, 'whisper_medium'); // clave propia en el historial
  assert.equal(medium.remote, false); // cómputo local, igual que Base y Small
  assert.equal(supportsFileInput(medium), true); // acepta el video/audio grabado
  // Las tres alternativas anteriores conservan sus claves de siempre.
  assert.equal(getEngine('whisper-base').storageKey, 'whisper');
  assert.equal(getEngine('whisper-small').storageKey, 'whisper_small');
  assert.equal(getEngine('speech-api').storageKey, 'webspeech');
});

test('el selector puede elegir un motor o la comparación de las cuatro', () => {
  assert.deepEqual(targetIdsFor('whisper-small'), ['whisper-small']);
  assert.deepEqual(targetIdsFor('whisper-base'), ['whisper-base']);
  assert.deepEqual(targetIdsFor('whisper-medium'), ['whisper-medium']);
  assert.deepEqual(targetIdsFor('speech-api'), ['speech-api']);
  assert.deepEqual(targetIdsFor(COMPARE_ALL_ID), COMPARISON_ORDER);
  // Un valor desconocido nunca deja la prueba sin motor: cae en el de por defecto.
  assert.deepEqual(targetIdsFor('motor-inventado'), [DEFAULT_ENGINE_ID]);
  assert.match(describeSelection(COMPARE_ALL_ID), /4 motores en serie/);
});

test('ningún motor queda como local o remoto sin declararlo', () => {
  for (const engine of ENGINES) {
    const result = idleResult(engine);
    assert.equal(result.engineId, engine.id);
    assert.equal(result.remote, engine.remote);
    assert.equal(result.local, !engine.remote);
    assert.ok(result.provider.length > 10, `${engine.id} debe declarar su proveedor`);
  }
  assert.equal(getEngine('whisper-small').remote, false);
  assert.equal(getEngine('speech-api').remote, true);
});

// ---------------------------------------------------------------- 2. Whisper Base

test('Whisper Base conserva su clave de historial y sigue siendo el motor por defecto', () => {
  const base = getEngine(DEFAULT_ENGINE_ID);
  assert.equal(DEFAULT_ENGINE_ID, 'whisper-base');
  assert.equal(base.storageKey, 'whisper'); // la clave que ya usaba el historial
  assert.equal(base.modelKey, 'base');
  assert.equal(supportsFileInput(base), true);
});

test('el registro de Whisper Base mantiene la forma que ya guardaba el laboratorio', () => {
  const result = finishResult(
    getEngine('whisper-base'),
    { text: REFERENCE, status: 'ok', processingMs: 800 },
    { reference: REFERENCE },
  );
  const run = buildRunRecord({ reference: REFERENCE, engines: { webspeech: null, whisper: result } });
  assert.equal(run.engines.whisper.status, 'ok');
  assert.equal(run.engines.whisper.text, REFERENCE);
  assert.equal(run.engines.webspeech, null);
  assert.equal(typeof run.engines.whisper.wer, 'number'); // ya no queda en null
});

// ---------------------------------------------------------------- 3. Whisper Small

test('Whisper Small usa la clave "small" y se guarda en su propia entrada', () => {
  const small = getEngine('whisper-small');
  assert.equal(small.modelKey, 'small');
  assert.equal(small.storageKey, 'whisper_small');
  const result = finishResult(
    small,
    { text: 'el vocero habla claro', status: 'ok', processingMs: 2100, loadMs: 4000 },
    { reference: REFERENCE },
  );
  assert.equal(result.modelKey, 'small');
  assert.equal(result.processingMs, 2100);
  assert.equal(result.loadMs, 4000);
  assert.equal(enginesRecord([result]).whisper_small.modelKey, 'small');
});

// ---------------------------------------------------------------- 4. modelo no disponible

test('si un modelo no está disponible, los demás motores terminan igual', async () => {
  const results = await runEnginesSequentially(comparisonIds(), async (engine) => {
    if (engine.id === 'whisper-small') {
      return { status: 'error', text: '', error: "El modelo 'small' no está disponible (503)." };
    }
    return { status: 'ok', text: REFERENCE, processingMs: 120 };
  });
  const small = results.find((r) => r.engineId === 'whisper-small');
  assert.equal(small.status, 'error');
  assert.match(small.error, /no está disponible/);
  assert.equal(results.find((r) => r.engineId === 'whisper-base').status, 'ok');
  assert.equal(results.find((r) => r.engineId === 'speech-api').status, 'ok');
});

test('si un motor lanza una excepción se registra y los demás continúan', async () => {
  const results = await runEnginesSequentially(comparisonIds(), async (engine) => {
    if (engine.id === 'whisper-small') throw new Error('No se pudo contactar el backend.');
    return { status: 'ok', text: REFERENCE };
  });
  assert.equal(results.length, 4);
  assert.equal(results.find((r) => r.engineId === 'whisper-small').error, 'No se pudo contactar el backend.');
  assert.equal(results.find((r) => r.engineId === 'whisper-base').status, 'ok');
});

test('si Medium falla, las otras tres alternativas terminan igual', async () => {
  const results = await runEnginesSequentially(comparisonIds(), async (engine) => {
    if (engine.id === 'whisper-medium') {
      return { status: 'error', text: '', error: "El modelo 'medium' no está disponible (503)." };
    }
    return { status: 'ok', text: REFERENCE, processingMs: 100 };
  });
  assert.equal(results.length, 4);
  assert.equal(results.find((r) => r.engineId === 'whisper-medium').status, 'error');
  assert.equal(results.filter((r) => r.status === 'ok').length, 3);
  assert.equal(results.find((r) => r.engineId === 'speech-api').status, 'ok');
});

// ---------------------------------------------------------------- 5. Speech API

test('Speech API no lee archivos y se marca como no disponible sin inventar texto', () => {
  const speech = getEngine('speech-api');
  assert.equal(supportsFileInput(speech), false);
  const result = finishResult(
    speech,
    { status: 'no_disponible', error: 'Speech API solo transcribe el micrófono en vivo.' },
    { reference: REFERENCE },
  );
  assert.equal(result.status, 'no_disponible');
  assert.equal(result.text, '');
  assert.equal(result.word, null);
});

test('el error de Speech API se conserva tal cual', () => {
  const result = finishResult(
    getEngine('speech-api'),
    { status: 'error', error: 'Web Speech API informó un error de red.' },
    { reference: REFERENCE },
  );
  assert.equal(result.status, 'error');
  assert.match(result.error, /error de red/);
});

// ---------------------------------------------------------------- 6. misma referencia

test('los cuatro motores se comparan contra el MISMO guion', () => {
  const hypotheses = {
    'whisper-base': REFERENCE,
    'whisper-small': 'el vocero habla claro',
    'whisper-medium': 'el vocero habla claro y responde',
    'speech-api': 'el vocero que habla claro y responde con transparencia',
  };
  const results = comparisonIds().map((id) =>
    finishResult(getEngine(id), { text: hypotheses[id], status: 'ok' }, { reference: REFERENCE }),
  );
  assert.equal(results.length, 4);
  for (const result of results) {
    assert.equal(result.hasReference, true);
    assert.equal(result.word.referenceWords, wordErrorReport(REFERENCE, hypotheses[result.engineId]).referenceWords);
  }
  // El mismo guion implica el mismo número de palabras de referencia para los tres.
  assert.equal(new Set(results.map((r) => r.word.referenceWords)).size, 1);
});

// ---------------------------------------------------------------- 7. WER y CER consistentes

test('WER y CER se calculan igual para los tres motores', () => {
  const hypothesis = 'el vocero habla claro';
  for (const id of comparisonIds()) {
    const result = finishResult(getEngine(id), { text: hypothesis, status: 'ok' }, { reference: REFERENCE });
    assert.deepEqual(result.word, wordErrorReport(REFERENCE, hypothesis));
    assert.deepEqual(result.char, characterErrorReport(REFERENCE, hypothesis));
  }
});

test('sin guion de referencia no se inventan métricas', () => {
  const result = finishResult(getEngine('whisper-base'), { text: 'algo', status: 'ok' }, { reference: '   ' });
  assert.equal(result.hasReference, false);
  assert.equal(result.word, null);
  assert.equal(result.char, null);
  assert.deepEqual(result.keywords, []);
  assert.equal(metricsFor('algo', '').hasReference, false);
  assert.equal(metricsFor('texto', REFERENCE).hasReference, true);
});

// ---------------------------------------------------------------- 8. historial y exportación

test('el historial guarda los tres motores sin perder el WER ni colar credenciales', () => {
  const record = buildRunRecord({
    reference: REFERENCE,
    engines: enginesRecord([
      finishResult(
        getEngine('whisper-base'),
        { text: REFERENCE, status: 'ok', processingMs: 900, token: 'SECRETO' },
        { reference: REFERENCE },
      ),
      finishResult(
        getEngine('whisper-small'),
        { text: 'el vocero habla claro', status: 'ok', processingMs: 2500, loadMs: 4000 },
        { reference: REFERENCE },
      ),
      finishResult(getEngine('speech-api'), { text: REFERENCE, status: 'ok' }, { reference: REFERENCE }),
    ]),
    audio: { durationSeconds: 12.5, sizeBytes: 2048, mimeType: 'audio/webm' },
  });

  assert.deepEqual(Object.keys(record.engines).sort(), ['webspeech', 'whisper', 'whisper_small']);
  assert.equal(record.engines.whisper.wer, 0); // antes quedaba en null
  assert.equal(record.engines.whisper_small.processingMs, 2500);
  assert.equal(record.engines.whisper_small.loadMs, 4000); // la carga se guarda aparte
  assert.equal('token' in record.engines.whisper, false);
  assert.equal(record.engines.webspeech.cer, 0);
});

test('la exportación CSV conserva las columnas antiguas y añade las de Whisper Small', () => {
  const record = buildRunRecord({
    reference: REFERENCE,
    engines: enginesRecord([
      finishResult(
        getEngine('whisper-small'),
        { text: REFERENCE, status: 'ok', processingMs: 1200, loadMs: 3500, model: 'small (cpu/int8)' },
        { reference: REFERENCE },
      ),
    ]),
  });
  const csv = toCSV([record]);
  const header = csv.split('\n')[0];
  assert.ok(header.startsWith('id,fecha,estado,guion,')); // encabezado histórico intacto
  assert.ok(header.includes('webspeech_wer'));
  assert.ok(header.includes('whisper_wer'));
  assert.ok(header.includes('whisper_small_wer'));
  assert.ok(header.includes('whisper_small_carga_ms'));
  assert.ok(header.endsWith('motores'));
  assert.ok(csv.includes('whisper_small:ok'));

  const json = JSON.parse(toJSON([record]));
  assert.equal(json.runs.length, 1);
  assert.equal(json.runs[0].engines.whisper_small.wer, 0);
  assert.equal(json.runs[0].reference, REFERENCE);
});

// Corta una línea CSV respetando las comillas (los campos JSON llevan comas y comillas).
function splitCsvLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

test('el historial y el CSV incorporan Medium sin perder las columnas anteriores', () => {
  const record = buildRunRecord({
    reference: REFERENCE,
    engines: enginesRecord([
      finishResult(getEngine('whisper-base'), { text: REFERENCE, status: 'ok' }, { reference: REFERENCE }),
      finishResult(getEngine('whisper-small'), { text: REFERENCE, status: 'ok' }, { reference: REFERENCE }),
      finishResult(
        getEngine('whisper-medium'),
        { text: 'el vocero habla claro', status: 'ok', processingMs: 9000, loadMs: 12000 },
        { reference: REFERENCE },
      ),
    ]),
  });
  assert.deepEqual(Object.keys(record.engines).sort(), ['whisper', 'whisper_medium', 'whisper_small']);
  assert.equal(record.engines.whisper_medium.loadMs, 12000); // la carga se guarda aparte
  const csv = toCSV([record]);
  const header = csv.split('\n')[0];
  assert.ok(header.startsWith('id,fecha,estado,guion,')); // encabezado histórico intacto
  assert.ok(header.includes('whisper_small_wer'));
  assert.ok(header.includes('whisper_medium_wer'));
  assert.ok(header.includes('whisper_medium_carga_ms'));
  assert.ok(header.endsWith('motores'));
  assert.ok(csv.includes('whisper_medium:ok'));
  // La fila tiene tantos valores como la cabecera (ninguna columna queda desalineada) y el
  // valor de Medium cae en su columna.
  const rows = csv.split('\n');
  const headerCells = splitCsvLine(header);
  const rowCells = splitCsvLine(rows[1]);
  assert.equal(rowCells.length, headerCells.length);
  assert.equal(rowCells[headerCells.indexOf('whisper_medium_carga_ms')], '12000');
  assert.equal(rowCells[headerCells.indexOf('whisper_medium_wer')], String(record.engines.whisper_medium.wer));
  assert.equal(rowCells[headerCells.indexOf('whisper_small_wer')], String(record.engines.whisper_small.wer));
});

// ---------------------------------------------------------------- 9. ejecución secuencial

test('los motores se ejecutan en serie (uno a la vez) y en el orden acordado', async () => {
  const started = [];
  let running = 0;
  let maxRunning = 0;
  await runEnginesSequentially(comparisonIds(), async (engine) => {
    running += 1;
    maxRunning = Math.max(maxRunning, running);
    started.push(engine.id);
    await new Promise((resolve) => setTimeout(resolve, 5));
    running -= 1;
    return { status: 'ok', text: REFERENCE };
  });
  assert.deepEqual(started, COMPARISON_ORDER);
  assert.equal(maxRunning, 1, 'los modelos no deben ejecutarse a la vez');
});

test('la comparación avisa a medida que termina cada motor', async () => {
  const seen = [];
  await runEnginesSequentially(
    comparisonIds(),
    async () => ({ status: 'ok', text: REFERENCE }),
    { onResult: (result, all) => seen.push([result.engineId, all.length]) },
  );
  assert.deepEqual(seen, [
    ['whisper-base', 1],
    ['whisper-small', 2],
    ['whisper-medium', 3],
    ['speech-api', 4],
  ]);
});

test('un motor desconocido se ignora sin romper la comparación', async () => {
  const results = await runEnginesSequentially(['whisper-base', 'inexistente'], async () => ({
    status: 'ok',
    text: REFERENCE,
  }));
  assert.equal(results.length, 1);
  assert.equal(results[0].engineId, 'whisper-base');
});

// ---------------------------------------------------------------- 10. resumen y estados

test('el resumen destaca el más rápido y el de menor WER, sin declarar un ganador absoluto', () => {
  const results = [
    finishResult(getEngine('whisper-base'), { text: REFERENCE, status: 'ok', processingMs: 900 }, { reference: REFERENCE }),
    finishResult(getEngine('whisper-small'), { text: 'el vocero habla claro', status: 'ok', processingMs: 2500 }, { reference: REFERENCE }),
    finishResult(getEngine('speech-api'), { status: 'error', error: 'red' }, { reference: REFERENCE }),
  ];
  const summary = summarizeComparison(results);
  assert.equal(summary.total, 3);
  assert.equal(summary.ok, 2);
  assert.equal(summary.failed, 1);
  assert.equal(summary.fastest.engineId, 'whisper-base');
  assert.equal(summary.bestWer.engineId, 'whisper-base');
  assert.match(summary.note, /no significa que su transcripción sea correcta/);
});

test('un motor que no devuelve texto se marca con error, no como transcripción válida', () => {
  const result = finishResult(
    getEngine('whisper-small'),
    { text: '   ', status: 'ok', processingMs: 10 },
    { reference: REFERENCE },
  );
  assert.equal(result.status, 'error');
  assert.ok(result.error);
  assert.equal(result.text, '');
});

test('idleResult y failureResult describen el estado inicial y el fallo', () => {
  const engine = getEngine('whisper-small');
  assert.equal(idleResult(engine).status, 'idle');
  assert.equal(idleResult(engine, 'running').status, 'running');
  assert.equal(failureResult(engine, 'sin servicio').error, 'sin servicio');
  assert.equal(failureResult(engine).error, 'El motor falló sin detalle.');
});

test('la comparación no toca la evaluación: solo produce métricas y textos', () => {
  const result = finishResult(getEngine('whisper-base'), { text: REFERENCE, status: 'ok' }, { reference: REFERENCE });
  assert.equal(result.textOriginal, REFERENCE);
  assert.deepEqual(Object.keys(result).includes('id'), false); // el id lo pone el historial
  assert.equal(typeof result.word.wer, 'number');
});


