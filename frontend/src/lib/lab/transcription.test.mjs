// Pruebas del módulo de métricas del Laboratorio de transcripción.
// Se ejecutan con el runner incluido en Node (sin dependencias):
//   cd frontend && node --test src/lib/lab/transcription.test.mjs
//
// Convención del WER en los empates: se prefiere la SUSTITUCIÓN (diagonal), que es la
// convención habitual; por eso algunos casos reparten igual entre S e I.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_NORMALIZATION,
  EXAMPLE_SCRIPT,
  buildRunRecord,
  characterErrorReport,
  compareWithReference,
  diffWords,
  editOperations,
  extractKeywords,
  formatPercent,
  keywordCoverage,
  normalizeText,
  toCSV,
  toJSON,
  tokenize,
  wordErrorReport,
} from './transcription.js';

// ---------------------------------------------------------------- Normalización

test('normalizeText: colapsa espacios y saltos de línea', () => {
  assert.equal(normalizeText('Hola,   mundo.\n\n¿Qué tal?'), 'hola mundo qué tal');
});

test('normalizeText: mayúsculas y puntuación son opcionales', () => {
  assert.equal(normalizeText('Hola, mundo.', { lowercase: false, stripPunctuation: false }), 'Hola, mundo.');
  assert.equal(normalizeText('Hola, mundo.', { lowercase: false }), 'Hola mundo');
});

test('normalizeText: conserva acentos por defecto y los quita si se pide', () => {
  assert.equal(normalizeText('Sé que sí'), 'sé que sí');
  assert.equal(normalizeText('Sé que sí', { stripAccents: true }), 'se que si');
});

test('tokenize: separa por palabras y devuelve vacío con texto vacío', () => {
  assert.deepEqual(tokenize('El vocero habla'), ['el', 'vocero', 'habla']);
  assert.deepEqual(tokenize('   \n  '), []);
  assert.deepEqual(tokenize(null), []);
});

test('DEFAULT_NORMALIZATION: valores documentados', () => {
  assert.deepEqual(DEFAULT_NORMALIZATION, {
    lowercase: true,
    stripPunctuation: true,
    collapseWhitespace: true,
    stripAccents: false,
  });
});

// ---------------------------------------------------------------- Distancia de edición

test('editOperations: textos idénticos no tienen errores', () => {
  const r = editOperations(['a', 'b'], ['a', 'b']);
  assert.equal(r.distance, 0);
  assert.deepEqual(r.counts, { equal: 2, substitute: 0, delete: 0, insert: 0 });
});

test('editOperations: omisión, inserción y sustitución por separado', () => {
  assert.equal(editOperations(['a', 'b'], ['a']).counts.delete, 1);
  assert.equal(editOperations(['a'], ['a', 'b']).counts.insert, 1);
  assert.equal(editOperations(['a'], ['b']).counts.substitute, 1);
});

// ---------------------------------------------------------------- WER

test('WER: transcripción idéntica da 0', () => {
  const r = wordErrorReport('el vocero habla claro', 'el vocero habla claro');
  assert.equal(r.wer, 0);
  assert.equal(r.substitutions + r.deletions + r.insertions, 0);
  assert.equal(r.referenceWords, 4);
});

test('WER: una omisión sobre cuatro palabras = 0,25', () => {
  const r = wordErrorReport('el vocero habla claro', 'el vocero habla');
  assert.equal(r.deletions, 1);
  assert.equal(r.substitutions, 0);
  assert.equal(r.insertions, 0);
  assert.equal(r.wer, 0.25);
});

test('WER: una sustitución sobre cuatro palabras = 0,25', () => {
  const r = wordErrorReport('el vocero habla claro', 'el vocero habla oscuro');
  assert.equal(r.substitutions, 1);
  assert.equal(r.deletions, 0);
  assert.equal(r.insertions, 0);
  assert.equal(r.wer, 0.25);
});

test('WER: una inserción sobre cuatro palabras = 0,25', () => {
  const r = wordErrorReport('el vocero habla claro', 'el vocero habla muy claro');
  assert.equal(r.insertions, 1);
  assert.equal(r.substitutions, 0);
  assert.equal(r.deletions, 0);
  assert.equal(r.wer, 0.25);
});

test('WER: combinación de sustitución e inserción', () => {
  const r = wordErrorReport('uno dos tres', 'uno cuatro tres cinco');
  assert.equal(r.substitutions, 1);
  assert.equal(r.insertions, 1);
  assert.equal(r.deletions, 0);
  assert.equal(r.errors, 2);
  assert.ok(Math.abs(r.wer - 2 / 3) < 1e-9);
});

test('WER: hipótesis vacía omite todas las palabras del guion', () => {
  const r = wordErrorReport('uno dos tres', '');
  assert.equal(r.deletions, 3);
  assert.equal(r.wer, 1);
  assert.equal(r.hypothesisWords, 0);
});

test('WER: guion vacío no es medible (null, no 0)', () => {
  const r = wordErrorReport('', 'hola');
  assert.equal(r.wer, null);
  assert.equal(r.insertions, 1);
  assert.equal(r.referenceWords, 0);
});

test('WER: puede superar el 100 %', () => {
  const r = wordErrorReport('uno dos', 'a b c d e f');
  assert.equal(r.errors, 6);
  assert.equal(r.wer, 3);
  assert.equal(formatPercent(r.wer), '300.0 %');
  assert.equal(r.substitutions, 2); // empate resuelto a favor de la sustitución
  assert.equal(r.insertions, 4);
});

test('formatPercent: sin dato devuelve "no medible"', () => {
  assert.equal(formatPercent(null), 'no medible');
  assert.equal(formatPercent(undefined), 'no medible');
  assert.equal(formatPercent(Number.NaN), 'no medible');
  assert.equal(formatPercent(0.142), '14.2 %');
});

// ---------------------------------------------------------------- CER

test('CER: texto idéntico da 0 y un carácter cambiado sobre cuatro da 0,25', () => {
  assert.equal(characterErrorReport('hola mundo', 'hola mundo').cer, 0);
  const r = characterErrorReport('hola', 'holo');
  assert.equal(r.substitutions, 1);
  assert.equal(r.referenceChars, 4);
  assert.equal(r.cer, 0.25);
});

test('CER: guion vacío no es medible (null)', () => {
  assert.equal(characterErrorReport('', 'hola').cer, null);
});

// ---------------------------------------------------------------- Diferencias y palabras clave

test('diffWords: permite reconstruir guion e hipótesis', () => {
  const reference = 'el vocero habla claro hoy';
  const hypothesis = 'el vocero dijo algo claro';
  const ops = diffWords(reference, hypothesis);
  const fromRef = ops.filter((o) => o.type !== 'insert').map((o) => o.ref).join(' ');
  const fromHyp = ops.filter((o) => o.type !== 'delete').map((o) => o.hyp).join(' ');
  assert.equal(fromRef, tokenize(reference).join(' '));
  assert.equal(fromHyp, tokenize(hypothesis).join(' '));
  // Con empate de coste, la convención prefiere la sustitución: 2 iguales + 3 sustituciones
  assert.equal(ops.filter((o) => o.type === 'equal').length, 2);
  assert.equal(ops.filter((o) => o.type === 'substitute').length, 3);
  assert.equal(ops.filter((o) => o.type === 'delete').length, 0);
});

test('keywordCoverage: presente, cambiada y omitida', () => {
  const coverage = keywordCoverage(
    ['vocero', 'autoridades', 'transparencia'],
    'el vocero colabora con la autoridad',
  );
  assert.equal(coverage[0].status, 'presente');
  assert.equal(coverage[1].status, 'cambiada');
  assert.equal(coverage[2].status, 'omitida');
});

test('keywordCoverage: lista vacía devuelve lista vacía', () => {
  assert.deepEqual(keywordCoverage([], 'cualquier texto'), []);
});

test('extractKeywords: ignora palabras vacías, cortas y repetidas', () => {
  assert.deepEqual(extractKeywords('el vocero habla del vocero claro'), ['vocero', 'habla', 'claro']);
  assert.deepEqual(extractKeywords(''), []);
});

// ---------------------------------------------------------------- Comparación completa

test('compareWithReference: conserva el texto original con muletillas', () => {
  const hyp = 'este... el vocero, eh, habla claro';
  const r = compareWithReference('el vocero habla claro', hyp, { engine: 'webspeech' });
  assert.equal(r.hypothesisOriginal, hyp);
  assert.equal(r.hypothesisEmpty, false);
  assert.equal(r.engine, 'webspeech');
  // Las muletillas cuentan como errores de edición (inserciones), no se eliminan
  assert.ok(r.word.insertions >= 2);
});

test('compareWithReference: hipótesis vacía se marca como vacía', () => {
  const r = compareWithReference('el vocero habla', '   ');
  assert.equal(r.hypothesisEmpty, true);
  assert.equal(r.word.wer, 1);
});

test('EXAMPLE_SCRIPT: es un guion de ejemplo, sin datos de organización', () => {
  assert.ok(EXAMPLE_SCRIPT.length > 100);
  assert.equal(tokenize(EXAMPLE_SCRIPT).length > 40, true);
  assert.equal(/@|\.com|\.cl|\b\d{7,}\b/.test(EXAMPLE_SCRIPT), false);
});

// ---------------------------------------------------------------- Registro y exportación

test('buildRunRecord: guarda solo los campos conocidos (no credenciales)', () => {
  const run = buildRunRecord({
    reference: 'hola mundo',
    engines: {
      webspeech: { status: 'ok', text: 'hola mundo', wer: 0, token: 'SECRETO' },
      whisper: null,
    },
    audio: { durationSeconds: 3.2, sizeBytes: 1024, mimeType: 'audio/webm' },
    whisperConfig: { model: 'base' },
    warnings: ['aviso de prueba'],
  });
  assert.ok(run.id.startsWith('lab-'));
  assert.equal(run.engines.webspeech.text, 'hola mundo');
  assert.equal('token' in run.engines.webspeech, false);
  assert.equal(run.engines.whisper, null);
  assert.equal(run.audio.durationSeconds, 3.2);
  assert.equal(run.status, 'ok');
  assert.equal(run.normalization.stripAccents, false);
});

test('toCSV: escapa comas, comillas y saltos de línea', () => {
  const run = buildRunRecord({
    reference: 'hola, "mundo"',
    engines: { webspeech: { text: 'linea1\nlinea2', wer: 0.1 } },
  });
  const csv = toCSV([run]);
  assert.ok(csv.startsWith('id,fecha,estado,guion,'));
  assert.ok(csv.includes('"hola, ""mundo"""'));
  assert.ok(csv.includes('"linea1 linea2"'));
});

test('toJSON: exporta las ejecuciones', () => {
  const run = buildRunRecord({ reference: 'uno dos', engines: {} });
  const parsed = JSON.parse(toJSON([run]));
  assert.equal(parsed.runs.length, 1);
  assert.equal(parsed.runs[0].reference, 'uno dos');
  assert.ok(typeof parsed.exportedAt === 'string');
});

