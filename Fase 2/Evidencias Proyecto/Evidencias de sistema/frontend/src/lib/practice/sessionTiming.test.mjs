// Pruebas del umbral de silencio que provoca el avance automático de la entrevista.
import assert from 'node:assert/strict';
import test from 'node:test';

import { END_SILENCE_MS, NO_ANSWER_MS, isSilenceAdvance, silenceRemainingMs } from './sessionTiming.js';

test('el umbral de silencio tras hablar es de 4 segundos', () => {
  assert.equal(END_SILENCE_MS, 4000);
});

test('no avanza antes de 4 segundos y sí al alcanzarlos', () => {
  assert.equal(isSilenceAdvance({ spoke: true, quietForMs: 3999 }), false);
  assert.equal(isSilenceAdvance({ spoke: true, quietForMs: 4000 }), true);
  assert.equal(isSilenceAdvance({ spoke: true, quietForMs: 4001 }), true);
});

test('el tiempo restante es coherente con el umbral', () => {
  assert.equal(silenceRemainingMs({ spoke: true, quietForMs: 0 }), 4000);
  assert.equal(silenceRemainingMs({ spoke: true, quietForMs: 1500 }), 2500);
  assert.equal(silenceRemainingMs({ spoke: true, quietForMs: 4000 }), 0);
});

test('si el vocero no ha hablado se usa el otro umbral (12 s) y no se mezcla', () => {
  assert.equal(NO_ANSWER_MS, 12000);
  assert.equal(isSilenceAdvance({ spoke: false, quietForMs: 4000 }), false);
  assert.equal(isSilenceAdvance({ spoke: false, quietForMs: 12000 }), true);
});

test('el avance es idempotente por episodio: tras cerrar el temporizador no vuelve a vencer', () => {
  // El componente limpia el intervalo en finishAnswer; aquí se comprueba que la condición
  // depende solo de (spoke, quietForMs) y no de llamadas previas.
  const first = isSilenceAdvance({ spoke: true, quietForMs: 4000 });
  const second = isSilenceAdvance({ spoke: true, quietForMs: 4000 });
  assert.equal(first, second);
});
