// Decisión de DESCARTAR la sesión creada por una práctica que NO llegó a empezar.
//
// Contexto: `POST /api/sessions` crea un registro CREATED en cuanto se entra a la pantalla de
// práctica. Si el vocero sale, recarga, se queda sin cámara/micrófono o falla la preparación,
// ese registro quedaba huérfano (vacío, sin datos) de forma permanente. La regla es:
//  - solo se descarta si existe sesión, la entrevista NO ha empezado (sin grabación ni turnos)
//    y no se está cerrando una práctica real;
//  - NUNCA se toca una sesión con datos: una sesión usada se conserva íntegra.
export function shouldDiscardSession({ sessionId = null, interviewStarted = false, finishing = false } = {}) {
  if (!sessionId) return false; // no hay nada que descartar
  if (interviewStarted) return false; // la práctica real ya empezó: sus datos son legítimos
  if (finishing) return false; // se está cerrando la entrevista: la sesión se usa
  return true;
}

// Ejecuta el descarte cuando corresponde. `del` (la llamada a la API) se inyecta para poder
// probarlo sin red. Nunca lanza: un fallo al descartar no debe romper la salida de la práctica.
export async function discardUnusedSession({ sessionId, interviewStarted, finishing, del, onDiscarded } = {}) {
  if (!shouldDiscardSession({ sessionId, interviewStarted, finishing })) return false;
  try {
    await del(sessionId);
  } catch {
    return false;
  }
  onDiscarded?.(sessionId);
  return true;
}
