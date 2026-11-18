// Ejecución de la calibración del equipo: ciclo de vida PROTEGIDO alrededor de la lógica pura de
// `calibration.js`.
//
// POR QUÉ EXISTE
//  - El cierre ocurre en UN solo sitio (`finish`) y es idempotente: el primer camino que llega cierra
//    la ejecución y limpia los temporizadores; los demás no hacen nada. Antes, la finalización
//    dependía de un único `setInterval` sin protección: si un ciclo lanzaba una excepción, el estado
//    «calibrando» quedaba activo para siempre y la pantalla no avanzaba.
//  - Un error de medición NO aborta ni aprueba: se registra, se sigue midiendo lo que se pueda y lo
//    que no se pudo medir queda como «no disponible» en el resultado real.
//  - Un watchdog cierra la ejecución si el ciclo normal no terminó (duración + margen), con el
//    resultado de lo medido: nunca convierte una calibración incompleta en aprobada.
//  - No define umbrales ni criterios: todo eso sigue en `calibration.js` (sin cambios).
//  - El reloj y los temporizadores se inyectan: se prueba sin navegador y sin esperas reales.
import {
  CALIBRATION_MS,
  SAMPLE_MS,
  addSample,
  calibrationResult,
  createCalibration,
  isFinished,
  progress as calibrationProgress,
} from './calibration.js';

// Margen del watchdog sobre la duración normal: 10 s de medición + 2 s de gracia.
export const WATCHDOG_MARGIN_MS = 2000;
export const CALIBRATION_WATCHDOG_MS = CALIBRATION_MS + WATCHDOG_MARGIN_MS;

// Motivos de cierre. `completed` es la única finalización normal; el resto son incidencias que la
// interfaz debe explicar sin aprobar nada.
export const FINISH_REASONS = Object.freeze({
  completed: 'completed',
  interrupted: 'interrupted',
  cancelled: 'cancelled',
});

const defaultTimers = () => ({
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (id) => clearInterval(id),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
});

export function createCalibrationRun({
  durationMs = CALIBRATION_MS,
  sampleMs = SAMPLE_MS,
  watchdogMs = CALIBRATION_WATCHDOG_MS,
  now = () => Date.now(),
  timers = defaultTimers(),
  sample = null,
  onSample = null,
  onFinish = null,
} = {}) {
  let state = createCalibration({ durationMs, now });
  let finished = false;
  let reason = null;
  let errorCount = 0;
  let lastError = null;
  let intervalId = null;
  let watchdogId = null;

  const clearTimers = () => {
    if (intervalId != null) {
      timers.clearInterval(intervalId);
      intervalId = null;
    }
    if (watchdogId != null) {
      timers.clearTimeout(watchdogId);
      watchdogId = null;
    }
  };

  // Una muestra: solo lo que se pueda medir. Si el medidor falla, se registra el error y la muestra
  // queda vacía (no se inventan valores: el resultado seguirá diciendo «no disponible»).
  const collect = () => {
    let values = null;
    try {
      values = typeof sample === 'function' ? sample() : null;
    } catch (error) {
      errorCount += 1;
      lastError = error;
    }
    try {
      state = addSample(state, values || {});
    } catch (error) {
      errorCount += 1;
      lastError = error;
    }
  };

  // Cierre único e idempotente. Publica SIEMPRE el resultado real de lo medido.
  const finish = (endReason = FINISH_REASONS.interrupted) => {
    if (finished) return false;
    finished = true;
    reason = endReason;
    clearTimers();
    if (typeof onFinish === 'function') {
      onFinish({
        result: calibrationResult(state),
        reason: endReason,
        errorCount,
        lastError,
        samples: state.samples.total,
      });
    }
    return true;
  };

  const tick = () => {
    if (finished) return;
    collect();
    if (finished) return;
    if (typeof onSample === 'function') {
      let value = 0;
      try {
        value = calibrationProgress(state, now);
      } catch {
        value = 0;
      }
      try {
        onSample({ progress: value, samples: state.samples.total });
      } catch {
        /* la interfaz no puede romper la medición */
      }
    }
    let due = false;
    try {
      due = isFinished(state, now);
    } catch {
      due = false; // si el reloj falla, lo cierra el watchdog
    }
    if (due) finish(FINISH_REASONS.completed);
  };

  return {
    start() {
      if (finished || intervalId != null) return false;
      intervalId = timers.setInterval(tick, sampleMs);
      watchdogId = timers.setTimeout(() => finish(FINISH_REASONS.interrupted), watchdogMs);
      return true;
    },
    finish,
    cancel: () => finish(FINISH_REASONS.cancelled),
    // Cierre silencioso (desmontaje de la pantalla): limpia temporizadores sin avisar a la interfaz.
    dispose() {
      if (finished) return false;
      finished = true;
      reason = FINISH_REASONS.cancelled;
      clearTimers();
      return true;
    },
    isFinished: () => finished,
    reason: () => reason,
    errorCount: () => errorCount,
    stats: () => ({ samples: state.samples.total, errors: errorCount, finished, reason }),
  };
}

// ----------------------------------------------------------------------------------------------
// Ciclo de vida del tracker de presencia (MediaPipe)
//
// El tracker se reutiliza entre calibraciones, pero NUNCA con datos de la anterior. Estas funciones
// solo usan la interfaz pública de `PoseTracker` (`ready`, `running`, `personNow`, `video`, `reset`,
// `start`, `stop`, `destroy`), así que se prueban con un doble y no cambian `poseTracker.js`.

// ¿Hace falta un tracker nuevo? (no hay tracker, o el elemento <video> cambió)
export function needsNewTracker(tracker, video) {
  if (!tracker) return true;
  if (video && tracker.video !== video) return true;
  return false;
}

// Deja el tracker listo para una medición nueva: sin datos de la anterior y midiendo si el modelo
// está cargado. Devuelve si quedó midiendo (si no, el encuadre no se juzga, como antes).
export function resetTrackerForRun(tracker) {
  if (!tracker) return false;
  tracker.stop?.();
  tracker.reset?.();
  tracker.personNow = false; // la presencia anterior no vale para esta medición
  if (tracker.ready && !tracker.running) tracker.start?.();
  return Boolean(tracker.ready && tracker.running);
}

// Detiene la medición de presencia y borra la presencia del último cuadro.
export function stopTracker(tracker) {
  if (!tracker) return false;
  tracker.stop?.();
  tracker.personNow = false;
  return true;
}
