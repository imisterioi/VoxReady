// Pruebas del módulo de transcripción por respuesta (sin navegador ni red).
import test from 'node:test';
import assert from 'node:assert/strict';

import { TRANSCRIPT_SOURCE, transcriptionRequest, normalizeTranscription } from './answerTranscription.js';

test('transcriptionRequest: modo texto no transcribe', () => {
  assert.deepEqual(transcriptionRequest({ textMode: true, spoke: true, startMs: 0, endMs: 1000 }), { needed: false, reason: 'texto' });
});

test('transcriptionRequest: sin ventana utilizable no transcribe', () => {
  assert.deepEqual(transcriptionRequest({ spoke: true, startMs: 0, endMs: null }), { needed: false, reason: 'sin_ventana' });
  assert.deepEqual(transcriptionRequest({ spoke: true, startMs: null, endMs: 1000 }), { needed: false, reason: 'sin_ventana' });
  assert.deepEqual(transcriptionRequest({ spoke: true, startMs: 1000, endMs: 1000 }), { needed: false, reason: 'sin_ventana' });
  assert.deepEqual(transcriptionRequest({ spoke: true, startMs: 2000, endMs: 1000 }), { needed: false, reason: 'sin_ventana' });
});

test('transcriptionRequest: silencio real no gasta ASR', () => {
  assert.deepEqual(transcriptionRequest({ spoke: false, startMs: 0, endMs: 5000 }), { needed: false, reason: 'silencio' });
  assert.deepEqual(transcriptionRequest({ startMs: 0, endMs: 5000 }), { needed: false, reason: 'silencio' });
});

test('transcriptionRequest: con voz detectada y ventana válida sí transcribe', () => {
  assert.deepEqual(transcriptionRequest({ spoke: true, startMs: 1000, endMs: 4000 }), { needed: true, reason: 'voz' });
});

test('normalizeTranscription: texto real viene del motor en vivo', () => {
  const result = normalizeTranscription({ ok: true, status: 200, body: { text: '  avisamos a la autoridad  ', code: null } });
  assert.deepEqual(result, { text: 'avisamos a la autoridad', source: TRANSCRIPT_SOURCE.live, code: null, status: 200 });
});

test('normalizeTranscription: sin texto queda como no disponible, nunca como silencio', () => {
  const vacio = normalizeTranscription({ ok: true, status: 200, body: { text: '', code: 'BUDGET_EXHAUSTED' } });
  assert.equal(vacio.text, '');
  assert.equal(vacio.source, TRANSCRIPT_SOURCE.unavailable);
  assert.equal(vacio.code, 'BUDGET_EXHAUSTED');
  const sinCodigo = normalizeTranscription({ ok: true, status: 200, body: { text: '   ' } });
  assert.equal(sinCodigo.code, 'NO_TRANSCRIPT');
});

test('normalizeTranscription: fallo de subida también es no disponible', () => {
  const red = normalizeTranscription({ ok: false, reason: 'NETWORK' });
  assert.equal(red.text, '');
  assert.equal(red.source, TRANSCRIPT_SOURCE.unavailable);
  assert.equal(red.code, 'UPLOAD_FAILED');
  const http = normalizeTranscription({ ok: false, status: 413 });
  assert.equal(http.code, 'UPLOAD_FAILED');
  assert.equal(http.status, 413);
});
