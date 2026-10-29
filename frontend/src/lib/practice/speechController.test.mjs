// Pruebas del controlador de lectura en voz alta (sin navegador ni audio real).
import assert from 'node:assert/strict';
import test from 'node:test';

import { createSpeechController, fallbackDelayFor } from './speechController.js';

// `speak` simulado: guarda los handlers para dispararlos cuando la prueba quiera.
function fakeSpeak({ mode = 'manual' } = {}) {
  const calls = [];
  const speak = (text, voice, handlers) => {
    const call = { text, voice, handlers };
    calls.push(call);
    if (mode === 'end') handlers.onEnd();
    if (mode === 'error') handlers.onError('synthesis-failed');
    if (mode === 'unavailable') return null;
    return { text };
  };
  return { speak, calls };
}

test('reproducción completada normalmente', () => {
  const { speak, calls } = fakeSpeak();
  const controller = createSpeechController({ speak });
  let ended = 0;
  controller.play('hola', null, { onEnd: () => (ended += 1), fallbackMs: 1000 });
  calls[0].handlers.onEnd();
  assert.equal(ended, 1);
});

test('error de síntesis no se confunde con el final', () => {
  const { speak, calls } = fakeSpeak();
  const controller = createSpeechController({ speak });
  let ended = 0;
  const errors = [];
  controller.play('hola', null, { onEnd: () => (ended += 1), onError: (r) => errors.push(r), fallbackMs: 1000 });
  calls[0].handlers.onError('not-allowed');
  assert.equal(ended, 0);
  assert.deepEqual(errors, ['not-allowed']);
});

test('sin mecanismo de voz se informa como error', () => {
  const { speak } = fakeSpeak({ mode: 'unavailable' });
  const controller = createSpeechController({ speak });
  const errors = [];
  controller.play('hola', null, { onEnd: () => {}, onError: (r) => errors.push(r) });
  assert.deepEqual(errors, ['unavailable']);
});

test('repetición rápida: sólo el último intento puede terminar', () => {
  const { speak, calls } = fakeSpeak();
  const controller = createSpeechController({ speak });
  const results = [];
  controller.play('primera', null, { onEnd: () => results.push('primera'), fallbackMs: 1000 });
  controller.play('segunda', null, { onEnd: () => results.push('segunda'), fallbackMs: 1000 });
  calls[0].handlers.onEnd(); // evento tardío del intento anterior
  calls[1].handlers.onEnd();
  assert.deepEqual(results, ['segunda']);
});

test('un cambio de turno invalida los callbacks del turno anterior', () => {
  const { speak, calls } = fakeSpeak();
  const controller = createSpeechController({ speak });
  let ended = 0;
  controller.play('turno 1', null, { onEnd: () => (ended += 1), fallbackMs: 1000 });
  controller.cancel();
  calls[0].handlers.onEnd();
  assert.equal(ended, 0);
});

test('cancelar limpia el temporizador y cierra el intento', () => {
  const { speak } = fakeSpeak();
  const timers = [];
  const controller = createSpeechController({
    speak,
    setTimeoutImpl: (fn, ms) => {
      timers.push({ fn, ms, cleared: false });
      return timers.length - 1;
    },
    clearTimeoutImpl: (id) => {
      timers[id].cleared = true;
    },
  });
  controller.play('hola', null, { onEnd: () => {}, fallbackMs: 500 });
  controller.cancel();
  assert.equal(timers[0].cleared, true);
});

test('el temporizador de respaldo se cancela al completar y no dispara startListening dos veces', () => {
  const { speak, calls } = fakeSpeak();
  const timers = [];
  const controller = createSpeechController({
    speak,
    setTimeoutImpl: (fn) => {
      timers.push(fn);
      return timers.length - 1;
    },
    clearTimeoutImpl: () => {},
  });
  let listening = 0;
  controller.play('hola', null, { onEnd: () => (listening += 1), onError: () => (listening += 1), fallbackMs: 500 });
  calls[0].handlers.onEnd();
  timers[0](); // el respaldo dispara después: debe ignorarse
  assert.equal(listening, 1);
});

test('si el navegador no emite eventos, el respaldo cierra como fallo (no como éxito)', () => {
  const { speak } = fakeSpeak();
  const timers = [];
  const controller = createSpeechController({
    speak,
    setTimeoutImpl: (fn) => {
      timers.push(fn);
      return 0;
    },
    clearTimeoutImpl: () => {},
  });
  const errors = [];
  controller.play('hola', null, { onEnd: () => {}, onError: (r) => errors.push(r), fallbackMs: 500 });
  timers[0]();
  assert.deepEqual(errors, ['timeout']);
});

test('el respaldo crece con el número de palabras', () => {
  assert.equal(fallbackDelayFor('una dos tres'), 3 * 450 + 3000);
  assert.equal(fallbackDelayFor(''), 3000);
});
