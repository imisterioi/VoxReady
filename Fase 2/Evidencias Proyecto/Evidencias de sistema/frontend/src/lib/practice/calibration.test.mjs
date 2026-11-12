// Pruebas de la calibración del equipo (lógica pura: se le pasan muestras reales simuladas).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CALIBRATION_MS,
  MIN_PERSON_RATIO,
  addSample,
  calibrationResult,
  createCalibration,
  isFinished,
  progress,
} from './calibration.js';

// Acumula N muestras con los valores indicados.
const collect = (samples, overrides = {}) => {
  let state = createCalibration({ durationMs: CALIBRATION_MS, now: () => 0 });
  for (let i = 0; i < samples; i += 1) state = addSample(state, overrides);
  return state;
};

test('la calibración dura diez segundos y avanza con el reloj real', () => {
  let clock = 1000;
  const state = createCalibration({ now: () => clock });
  assert.equal(state.durationMs, 10000);
  assert.equal(progress(state, () => clock), 0);
  clock += 5000;
  assert.equal(progress(state, () => clock), 0.5);
  assert.equal(isFinished(state, () => clock), false);
  clock += 5000;
  assert.equal(progress(state, () => clock), 1);
  assert.equal(isFinished(state, () => clock), true);
});

test('micrófono correcto: señal clara y sostenida', () => {
  let state = createCalibration({ now: () => 0 });
  for (let i = 0; i < 100; i += 1) state = addSample(state, { micLevel: i % 2 ? 0.12 : 0.16, hasImage: true, person: true });
  const result = calibrationResult(state);
  assert.equal(result.mic.status, 'ok');
  assert.equal(result.camera.status, 'ok');
  assert.equal(result.ready, true);
  assert.equal(result.canStart, true);
});

test('sin señal de micrófono: se detecta y se bloquea el inicio', () => {
  const result = calibrationResult(collect(100, { micLevel: 0.001, hasImage: true, person: true }));
  assert.equal(result.mic.status, 'silent');
  assert.equal(result.canStart, false, 'sin señal de micrófono no se puede practicar');
  assert.equal(result.ready, false);
});

test('volumen bajo: avisa pero no bloquea', () => {
  const result = calibrationResult(collect(100, { micLevel: 0.03, hasImage: true, person: true }));
  assert.equal(result.mic.status, 'low');
  assert.equal(result.canStart, true, 'un volumen bajo es un aviso, no un bloqueo');
  assert.equal(result.ready, false);
});

test('señal inestable (casi todo silencio): cuenta como volumen bajo', () => {
  let state = createCalibration({ now: () => 0 });
  for (let i = 0; i < 100; i += 1) state = addSample(state, { micLevel: i < 3 ? 0.2 : 0.005, hasImage: true, person: true });
  const result = calibrationResult(state);
  assert.equal(result.mic.status, 'low');
  assert.ok(result.mic.voicedRatio < 0.08);
});

test('se detecta ruido de fondo alto', () => {
  const noisy = calibrationResult(collect(100, { micLevel: 0.07, hasImage: true, person: true }));
  assert.equal(noisy.mic.noise, 'high');
  const quiet = calibrationResult(collect(100, { micLevel: 0.2, hasImage: true, person: true }));
  assert.equal(quiet.mic.noise, 'ok', 'con voz clara el piso de ruido no queda por encima');
});

test('cámara sin imagen: se detecta y bloquea el inicio', () => {
  const result = calibrationResult(collect(100, { micLevel: 0.2, hasImage: false, person: null }));
  assert.equal(result.camera.status, 'no-image');
  assert.equal(result.canStart, false);
});

test('encuadre mejorable: avisa pero no bloquea', () => {
  let state = createCalibration({ now: () => 0 });
  for (let i = 0; i < 100; i += 1) state = addSample(state, { micLevel: 0.2, hasImage: true, person: i < 20 });
  const result = calibrationResult(state);
  assert.equal(result.camera.status, 'framing');
  assert.ok(result.camera.personRatio < MIN_PERSON_RATIO);
  assert.equal(result.canStart, true, 'un encuadre mejorable no debe impedir practicar');
});

test('sin detector de presencia disponible no se juzga el encuadre', () => {
  const result = calibrationResult(collect(100, { micLevel: 0.2, hasImage: true, person: null }));
  assert.equal(result.camera.status, 'ok');
  assert.equal(result.camera.checked, false);
  assert.equal(result.ready, true);
});

test('sin poder medir audio el resultado queda no disponible (no se inventa éxito)', () => {
  const result = calibrationResult(collect(100, { micLevel: null, hasImage: true, person: true }));
  assert.equal(result.mic.status, 'unavailable');
  assert.equal(result.canStart, false);
});
