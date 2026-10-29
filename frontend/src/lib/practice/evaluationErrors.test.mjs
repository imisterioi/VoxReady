import assert from 'node:assert/strict';
import test from 'node:test';

import { describeEvaluationError } from './evaluationErrors.js';

const err = (extra = {}) => Object.assign(new Error('interno'), extra);

test('integración desactivada se explica sin tecnicismos', () => {
  const message = describeEvaluationError(err({ status: 503, code: 'EVAL_NVIDIA_ASR_DISABLED' }));
  assert.match(message, /no está habilitada/);
  assert.doesNotMatch(message, /NVIDIA_API_KEY|EVAL_|http/i);
});

test('sin ventanas válidas pide repetir la sesión', () => {
  assert.match(describeEvaluationError(err({ status: 422, code: 'TRANSCRIPTION_NO_WINDOWS' })), /Repite la sesión/);
});

test('fallo de transcripción conserva la grabación y sugiere reintentar', () => {
  const message = describeEvaluationError(err({ status: 502, code: 'TRANSCRIPTION_ANSWER_TRANSCRIPTION_FAILED' }));
  assert.match(message, /grabación se conserva/);
  assert.match(message, /reintentar/);
});

test('errores genéricos de red y servidor no filtran detalles internos', () => {
  assert.match(describeEvaluationError(err({ status: 502 })), /servicio de transcripción/);
  assert.match(describeEvaluationError(err()), /conectar con el servidor/);
  assert.match(describeEvaluationError(err({ status: 500 })), /No se pudo completar el análisis/);
  assert.equal(describeEvaluationError(null), 'No se pudo completar el análisis. Inténtalo de nuevo en unos minutos.');
});

test('una ejecución cancelada no muestra error', () => {
  assert.equal(describeEvaluationError(err({ name: 'AbortError' })), null);
});
