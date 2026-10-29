import assert from 'node:assert/strict';
import test from 'node:test';

import { recordingReadiness } from './sessionStart.js';

const base = { sessionId: 's1', mediaReady: true, question: '¿Qué ocurrió?', poseReady: true };

test('no está listo mientras el entrevistador carga (sin primera pregunta)', () => {
  const r = recordingReadiness({ ...base, question: null });
  assert.equal(r.ready, false);
  assert.deepEqual(r.missing, ['question']);
});

test('no está listo sin sesión o sin cámara/micrófono', () => {
  assert.deepEqual(recordingReadiness({ ...base, sessionId: null }).missing, ['session']);
  assert.deepEqual(recordingReadiness({ ...base, mediaReady: false }).missing, ['media']);
});

test('está listo cuando todo está preparado', () => {
  const r = recordingReadiness(base);
  assert.equal(r.ready, true);
  assert.deepEqual(r.missing, []);
});

test('sin modelo de cuerpo no bloquea si el modelo ya falló (se mide sin cuerpo)', () => {
  assert.equal(recordingReadiness({ ...base, poseReady: false }).ready, false);
  assert.equal(recordingReadiness({ ...base, poseReady: false, poseFailed: true }).ready, true);
});

test('en modo texto no se exige cámara ni modelo de cuerpo', () => {
  const r = recordingReadiness({
    sessionId: 's1',
    textMode: true,
    mediaReady: false,
    question: 'P1',
    poseReady: false,
  });
  assert.equal(r.ready, true);
});
