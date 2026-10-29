import assert from 'node:assert/strict';
import test from 'node:test';

import { characterErrorRate, levenshtein, normalizeForComparison, wordErrorRate } from './wer.js';

test('normaliza mayúsculas, tildes, puntuación y espacios', () => {
  assert.equal(normalizeForComparison('  ¡Hola,   SEÑOR!  ¿Qué tal?  '), 'hola senor que tal');
  assert.equal(normalizeForComparison('Año 2026: cifras (1.000)'), 'ano 2026 cifras 1 000');
});

test('WER 0 cuando el texto coincide tras normalizar', () => {
  const result = wordErrorRate('La plataforma falló ayer.', 'la plataforma fallo ayer');
  assert.equal(result.wer, 0);
  assert.equal(result.errors, 0);
  assert.equal(result.referenceWords, 4);
});

test('WER separa sustituciones, eliminaciones e inserciones', () => {
  const sub = wordErrorRate('uno dos tres cuatro', 'uno dos cinco cuatro');
  assert.equal(sub.substitutions, 1);
  assert.equal(sub.deletions, 0);
  assert.equal(sub.insertions, 0);
  assert.equal(sub.wer, 0.25);

  const del = wordErrorRate('uno dos tres cuatro', 'uno tres cuatro');
  assert.equal(del.deletions, 1);
  assert.equal(del.wer, 0.25);

  const ins = wordErrorRate('uno dos tres', 'uno dos tres cuatro');
  assert.equal(ins.insertions, 1);
  assert.ok(ins.wer > 0.3 && ins.wer < 0.34);
});

test('WER no se inventa sin referencia', () => {
  assert.equal(wordErrorRate('', 'cualquier cosa'), null);
  assert.equal(wordErrorRate('   ', 'algo'), null);
  assert.equal(characterErrorRate('', 'algo'), null);
});

test('CER mide caracteres sin espacios y Levenshtein es correcto', () => {
  assert.equal(levenshtein('kitten'.split(''), 'sitting'.split('')), 3);
  const cer = characterErrorRate('hola mundo', 'hola munDo');
  assert.equal(cer.cer, 0);
  const cer2 = characterErrorRate('hola', 'hila');
  assert.equal(cer2.cer, 0.25);
});

// Documenta una LIMITACIÓN deliberada de la normalización: al quitar tildes, un nombre mal
// acentuado no cuenta como error. Se deja explícito para no ocultarlo en el informe.
test('las tildes no penalizan: limitación documentada', () => {
  const result = wordErrorRate('El director Pérez dijo que sí', 'el director Perez dijo que si');
  assert.equal(result.wer, 0);
  assert.equal(result.errors, 0);
});

// Muletillas y repeticiones SÍ cuentan: son parte de lo que se dijo.
test('las muletillas y repeticiones cuentan como errores', () => {
  const result = wordErrorRate('no tengo idea', 'eh no tengo idea la verdad');
  assert.equal(result.insertions, 3);
  assert.ok(result.wer > 0.7 && result.wer < 1.1);
});

