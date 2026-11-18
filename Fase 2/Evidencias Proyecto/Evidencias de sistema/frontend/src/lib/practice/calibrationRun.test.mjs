// Pruebas del ciclo de vida PROTEGIDO de la calibración: sin navegador, sin esperas reales y sin
// tocar los umbrales (esos siguen probados en `calibration.test.mjs`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { CALIBRATION_MS, SAMPLE_MS } from './calibration.js';
import {
  CALIBRATION_WATCHDOG_MS,
  FINISH_REASONS,
  WATCHDOG_MARGIN_MS,
  createCalibrationRun,
  needsNewTracker,
  resetTrackerForRun,
  stopTracker,
} from './calibrationRun.js';

// Reloj y temporizadores simulados: `advance(ms)` ejecuta, en orden de vencimiento, los trabajos.
function fakeClock() {
  let clock = 0;
  let seq = 0;
  const jobs = new Map();
  const timers = {
    setInterval: (fn, ms) => { seq += 1; jobs.set(seq, { fn, every: ms, at: clock + ms, repeat: true }); return seq; },
    clearInterval: (id) => { jobs.delete(id); },
    setTimeout: (fn, ms) => { seq += 1; jobs.set(seq, { fn, every: null, at: clock + ms, repeat: false }); return seq; },
    clearTimeout: (id) => { jobs.delete(id); },
  };
  const advance = (ms) => {
    const until = clock + ms;
    for (;;) {
      const pending = [...jobs.entries()].filter(([, job]) => job.at <= until).sort((a, b) => a[1].at - b[1].at);
      if (!pending.length) break;
      const [id, job] = pending[0];
      clock = job.at;
      if (job.repeat) job.at = clock + job.every;
      else jobs.delete(id);
      job.fn();
    }
    clock = until;
  };
  return { now: () => clock, timers, advance, pending: () => jobs.size };
}

function runWith({ sample, now = null, ...rest } = {}) {
  const clock = fakeClock();
  const finishes = [];
  const published = [];
  const run = createCalibrationRun({
    now: now || clock.now,
    timers: clock.timers,
    sample,
    onSample: (info) => published.push(info),
    onFinish: (payload) => finishes.push(payload),
    ...rest,
  });
  return { run, clock, finishes, published };
}

const good = () => ({ micLevel: 0.16, hasImage: true, person: true });

test('a) termina a los 10 s con el resultado real y una sola notificación', () => {
  const { run, clock, finishes } = runWith({ sample: good });
  assert.equal(run.start(), true);
  clock.advance(CALIBRATION_MS);
  assert.equal(finishes.length, 1, 'se publica exactamente un cierre');
  assert.equal(finishes[0].reason, FINISH_REASONS.completed);
  assert.equal(finishes[0].result.mic.status, 'ok');
  assert.equal(finishes[0].result.camera.status, 'ok');
  assert.equal(finishes[0].result.canStart, true);
  assert.equal(clock.pending(), 0, 'no quedan temporizadores vivos');
});

test('b) si el medidor falla en todos los ciclos, la calibración termina igual y NUNCA aprueba', () => {
  const { run, clock, finishes } = runWith({
    sample: () => {
      throw new Error('medidor de audio no disponible');
    },
  });
  run.start();
  clock.advance(CALIBRATION_WATCHDOG_MS + SAMPLE_MS);
  assert.equal(finishes.length, 1, 'termina en vez de quedarse calibrando');
  // Cierra la ventana normal (el reloj avanza aunque el medidor falle): lo importante es que termina
  // y que el resultado es el real, no que lo cierre el watchdog.
  assert.equal(finishes[0].reason, FINISH_REASONS.completed);
  assert.ok(finishes[0].errorCount > 0, 'los errores quedan registrados');
  assert.equal(finishes[0].result.mic.status, 'unavailable', 'lo que no se pudo medir no se inventa');
  assert.equal(finishes[0].result.canStart, false, 'un error de micrófono no aprueba la calibración');
  assert.equal(clock.pending(), 0, 'sin temporizadores vivos');
});

test('c) errores intermitentes no impiden completar y el resultado refleja lo medido', () => {
  let n = 0;
  const { run, clock, finishes } = runWith({
    sample: () => {
      n += 1;
      if (n % 3 === 0) throw new Error('fallo intermitente');
      return good();
    },
  });
  run.start();
  clock.advance(CALIBRATION_MS);
  assert.equal(finishes.length, 1);
  assert.equal(finishes[0].reason, FINISH_REASONS.completed);
  assert.ok(finishes[0].errorCount > 0);
  assert.equal(finishes[0].result.canStart, true, 'con señal suficiente y sostenida sí se aprueba');
});

test('d) el cierre es idempotente: dos caminos no publican ni limpian dos veces', () => {
  const { run, clock, finishes } = runWith({ sample: good });
  run.start();
  clock.advance(CALIBRATION_MS);
  assert.equal(finishes.length, 1);
  assert.equal(run.finish(FINISH_REASONS.interrupted), false, 'el segundo cierre no hace nada');
  assert.equal(run.cancel(), false);
  assert.equal(finishes.length, 1);
  clock.advance(30000);
  assert.equal(finishes.length, 1, 'ya no hay ciclos después de cerrar');
});

test('e) el watchdog cierra con margen y sin aprobar una medición incompleta', () => {
  assert.equal(WATCHDOG_MARGIN_MS, 2000);
  assert.equal(CALIBRATION_WATCHDOG_MS, CALIBRATION_MS + WATCHDOG_MARGIN_MS);
  // Reloj congelado: el ciclo normal nunca llega a «terminado»; el watchdog es la única salida.
  const { run, clock, finishes } = runWith({
    now: () => 0,
    sample: () => ({ hasImage: true, person: true }), // sin nivel de micrófono
  });
  run.start();
  clock.advance(CALIBRATION_MS);
  assert.equal(finishes.length, 0, 'sigue midiendo durante la ventana normal');
  clock.advance(WATCHDOG_MARGIN_MS);
  assert.equal(finishes.length, 1, 'el watchdog cierra la ejecución');
  assert.equal(finishes[0].reason, FINISH_REASONS.interrupted);
  assert.equal(finishes[0].result.canStart, false, 'una calibración incompleta no se aprueba');
  assert.equal(clock.pending(), 0);
});

test('f) cancelar limpia todo y no deja nada en segundo plano', () => {
  const { run, clock, finishes } = runWith({ sample: good });
  run.start();
  clock.advance(1000);
  assert.equal(run.cancel(), true);
  assert.equal(run.reason(), FINISH_REASONS.cancelled);
  assert.equal(finishes.length, 1);
  assert.equal(clock.pending(), 0, 'sin intervalo ni watchdog pendientes');
  const after = finishes.length;
  clock.advance(30000);
  assert.equal(finishes.length, after, 'nada se reactiva solo');
});

test('g) dispose cierra en silencio (desmontaje de la pantalla)', () => {
  const { run, clock, finishes } = runWith({ sample: good });
  run.start();
  clock.advance(500);
  assert.equal(run.dispose(), true);
  assert.equal(finishes.length, 0, 'no se avisa a una pantalla que ya no está');
  assert.equal(clock.pending(), 0);
  assert.equal(run.finish(), false, 'después del desmontaje no hay nada que cerrar');
});

test('h) publica el progreso de 0 a 1 y deja de publicar al cerrar', () => {
  const { run, clock, published } = runWith({ sample: good });
  run.start();
  clock.advance(5000);
  const half = published.at(-1).progress;
  assert.ok(half > 0.4 && half < 0.6, `progreso intermedio inesperado: ${half}`);
  clock.advance(5000);
  assert.equal(published.at(-1).progress, 1);
  const total = published.length;
  clock.advance(5000);
  assert.equal(published.length, total, 'no publica después de terminar');
});

test('i) start no se puede lanzar dos veces sobre la misma ejecución', () => {
  const { run, clock } = runWith({ sample: good });
  assert.equal(run.start(), true);
  assert.equal(run.start(), false);
  clock.advance(CALIBRATION_MS);
  assert.equal(run.isFinished(), true);
});

test('j) una calibración sin micrófono medible nunca se aprueba', () => {
  const { run, clock, finishes } = runWith({ sample: () => ({ micLevel: null, hasImage: true, person: true }) });
  run.start();
  clock.advance(CALIBRATION_MS);
  assert.equal(finishes[0].reason, FINISH_REASONS.completed);
  assert.equal(finishes[0].result.mic.status, 'unavailable');
  assert.equal(finishes[0].result.canStart, false);
});

test('k) el tracker no reutiliza datos de la ejecución anterior', () => {
  const video = { id: 'video-1' };
  const other = { id: 'video-2' };
  assert.equal(needsNewTracker(null, video), true, 'sin tracker hace falta uno nuevo');
  assert.equal(needsNewTracker({ video }, video), false, 'el mismo <video> sirve');
  assert.equal(needsNewTracker({ video }, other), true, 'otro <video> exige tracker nuevo');

  const calls = [];
  const tracker = {
    video,
    ready: true,
    running: true,
    personNow: true,
    stop() { calls.push('stop'); this.running = false; },
    reset() { calls.push('reset'); this.personNow = false; },
    start() { calls.push('start'); this.running = true; },
  };
  assert.equal(resetTrackerForRun(tracker), true);
  assert.deepEqual(calls, ['stop', 'reset', 'start'], 'se detiene, se limpia y se reinicia');
  assert.equal(tracker.personNow, false, 'sin presencia heredada');

  const notReady = {
    video,
    ready: false,
    running: false,
    personNow: true,
    stop() { calls.push('stop2'); },
    reset() { calls.push('reset2'); this.personNow = false; },
    start() { calls.push('start2'); },
  };
  assert.equal(resetTrackerForRun(notReady), false, 'sin modelo no se juzga el encuadre');
  assert.equal(notReady.personNow, false);

  assert.equal(stopTracker(tracker), true);
  assert.equal(tracker.running, false);
  assert.equal(tracker.personNow, false);
  assert.equal(stopTracker(null), false);
});
