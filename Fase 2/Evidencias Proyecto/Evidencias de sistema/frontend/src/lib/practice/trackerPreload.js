// Precarga del tracker de postura (MediaPipe) para la preparación del vocero (C1).
//
// POR QUÉ EXISTE
//  - La inicialización de MediaPipe (compilar el WASM y crear el grafo del modelo) cuesta segundos
//    de trabajo en el hilo principal. Antes se pagaba al pulsar «Iniciar calibración»; ahora se
//    adelanta cuando la cámara queda disponible, así el clic no bloquea la interfaz.
//  - Una sola inicialización por elemento `<video>` (la comparación es por IDENTIDAD de nodo: el
//    componente pasa siempre `videoRef.current`, que es el mismo nodo salvo remontaje): dos llamadas
//    simultáneas comparten la MISMA promesa de carga (nunca dos `createFromOptions` en paralelo).
//  - Si el usuario abandona la pantalla durante la carga, los recursos que lleguen tarde se cierran
//    (`destroy()`), así no quedan grafos de MediaPipe filtrando memoria/GPU.
//  - Si cambia el elemento `<video>`, el tracker anterior se destruye antes de crear el nuevo.
//
// Reglas:
//  - Módulo puro respecto a React y a la red: recibe `createTracker` inyectado (se prueba con dobles).
//  - Nunca lanza: un fallo de carga deja el estado en `failed` y la calibración puede seguir sin
//    detector (los criterios de aprobación viven en `calibration.js` y no cambian).
//  - El estado sólo puede ser: idle → loading → (ready | failed); `dispose()` vuelve a idle.
import { resetTrackerForRun, stopTracker } from './calibrationRun.js';

export const TRACKER_STATES = Object.freeze({
  idle: 'idle',
  loading: 'loading',
  ready: 'ready',
  failed: 'failed',
});

export function createTrackerPreload({ createTracker, onState = () => {} } = {}) {
  let status = TRACKER_STATES.idle;
  let tracker = null; // instancia viva (puede estar cargando)
  let videoEl = null; // elemento <video> al que pertenece `tracker`
  let inflight = null; // promesa de carga en curso (dedupe de cargas concurrentes)
  let disposed = false;

  const emit = (next) => {
    if (next === status) return;
    status = next;
    onState(status);
  };

  // Cierra los grafos de una instancia sin poder romper nada: es una limpieza de mejor esfuerzo.
  const destroy = (instance) => {
    try {
      instance?.destroy?.();
    } catch {
      /* la limpieza nunca debe propagar un error */
    }
  };

  return {
    status: () => status,
    current: () => (disposed ? null : tracker),
    isReady: () => !disposed && status === TRACKER_STATES.ready && Boolean(tracker?.ready),

    // Prepara el tracker para `video` y lo carga si hace falta. Devuelve siempre el estado final.
    async ensure(video, { face = false } = {}) {
      if (disposed || !video) return { status, tracker: null, reused: false };
      if (typeof createTracker !== 'function') {
        emit(TRACKER_STATES.failed);
        return { status, tracker: null, reused: false };
      }

      // Mismo elemento: se reutiliza (y se espera la carga en curso en vez de duplicarla)
      if (tracker && videoEl === video) {
        if (inflight) await inflight;
        return { status, tracker: disposed ? null : tracker, reused: true };
      }

      // Elemento distinto: el tracker anterior no sirve para este <video> y se libera ya
      if (tracker) {
        destroy(tracker);
        tracker = null;
        videoEl = null;
      }

      let instance = null;
      try {
        instance = createTracker(video);
      } catch {
        emit(TRACKER_STATES.failed);
        return { status, tracker: null, reused: false };
      }
      if (!instance) {
        emit(TRACKER_STATES.failed);
        return { status, tracker: null, reused: false };
      }

      tracker = instance;
      videoEl = video;
      emit(TRACKER_STATES.loading);

      let pending = null;
      pending = Promise.resolve()
        .then(() => instance.load({ face }))
        .then((ok) => {
          // Carga que llega tarde: la pantalla se desmontó o el tracker ya no es el vivo ⇒ se cierra.
          if (disposed || tracker !== instance) {
            destroy(instance);
            return false;
          }
          emit(ok === false ? TRACKER_STATES.failed : TRACKER_STATES.ready);
          return ok !== false;
        })
        .catch(() => {
          if (!disposed && tracker === instance) emit(TRACKER_STATES.failed);
          return false;
        })
        .finally(() => {
          if (inflight === pending) inflight = null;
        });

      inflight = pending;
      await pending;
      return { status, tracker: disposed ? null : tracker, reused: false };
    },

    // Deja el tracker listo para una medición nueva (sin datos de la anterior) antes de cada
    // calibración. Devuelve false si no hay tracker o el modelo no está cargado.
    beginRun() {
      if (disposed || !tracker) return false;
      return resetTrackerForRun(tracker);
    },

    // Detiene la medición sin destruir (lo usa el cierre de la calibración).
    stop() {
      if (disposed || !tracker) return false;
      return stopTracker(tracker);
    },

    // Desmontaje de la pantalla: abandona la instancia y libera recursos. Si hay una carga en curso,
    // el cierre lo hará la propia promesa al terminar (destruir a medias dejaría recursos a medio
    // crear); así no queda ningún estado de carga permanente.
    dispose() {
      if (disposed) return;
      disposed = true;
      const instance = tracker;
      const pending = inflight;
      tracker = null;
      videoEl = null;
      inflight = null;
      if (!pending) destroy(instance);
      emit(TRACKER_STATES.idle);
    },
  };
}
