// Controlador de un intento de lectura en voz alta.
//
// Garantiza:
//  - un ÚNICO resultado terminal por intento (end, error o temporizador), aunque el
//    navegador emita varios eventos;
//  - que los callbacks de una pregunta anterior no actúen en un turno nuevo (token);
//  - que el temporizador de respaldo se cancele al repetir, al cambiar de turno y al
//    desmontar;
//  - distinguir "terminó bien" de "falló" para no avanzar como si el vocero hubiera oído.
//
// Es puro (recibe `speak` y los temporizadores), por lo que se prueba sin navegador.
export function createSpeechController({
  speak,
  now = () => Date.now(),
  setTimeoutImpl = (fn, ms) => setTimeout(fn, ms),
  clearTimeoutImpl = (handle) => clearTimeout(handle),
} = {}) {
  let attempt = 0;
  let timer = null;
  let settled = false;

  function clearTimer() {
    if (timer != null) {
      clearTimeoutImpl(timer);
      timer = null;
    }
  }

  function finish(token, kind, detail, handlers) {
    if (token !== attempt || settled) return; // intento viejo o ya cerrado
    settled = true;
    clearTimer();
    if (kind === 'ok') handlers.onEnd?.();
    else handlers.onError?.(detail || 'unknown');
  }

  return {
    // Devuelve el identificador del intento (útil en pruebas).
    play(text, voice, { onEnd, onError, fallbackMs } = {}) {
      attempt += 1;
      const token = attempt;
      settled = false;
      clearTimer();

      const handlers = { onEnd, onError };

      const utterance = speak(text, voice, {
        onEnd: () => finish(token, 'ok', null, handlers),
        onError: (reason) => finish(token, 'error', reason, handlers),
      });

      // Respaldo: si el navegador no emite ningún evento, se cierra el intento como fallo
      // (nunca como éxito silencioso) para que el llamador informe y permita repetir.
      if (Number.isFinite(fallbackMs) && fallbackMs > 0) {
        timer = setTimeoutImpl(() => {
          timer = null;
          finish(token, 'error', 'timeout', handlers);
        }, fallbackMs);
      }
      if (utterance === null) finish(token, 'error', 'unavailable', handlers);

      return token;
    },

    // Invalida el intento en curso: sus callbacks tardíos ya no hacen nada.
    cancel() {
      attempt += 1;
      settled = true;
      clearTimer();
    },

    // Estado para pruebas/observabilidad (sin datos del vocero).
    stats() {
      return { attempt, settled, hasTimer: timer != null, elapsedMs: timer == null ? null : now() };
    },
  };
}

// Duración estimada de lectura: ~450 ms por palabra + 3 s de margen.
export function fallbackDelayFor(text, { perWordMs = 450, extraMs = 3000 } = {}) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean).length;
  return words * perWordMs + extraMs;
}
