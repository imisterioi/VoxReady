// Historial de prácticas del vocero: separa lo evaluado de lo pendiente y traduce el estado REAL
// del backend (`session.evaluation.state` + `session.hasReport`) a una etiqueta para el vocero.
//
// Reglas:
//  - El estado NUNCA se deduce de la ausencia de `score`/`report`: lo informa el backend.
//  - Una sesión sin informe sigue apareciendo en el historial (no se descarta).
//  - Nunca se inventan puntajes: las vistas numéricas usan solo sesiones con informe válido.
//  - Los mensajes son comprensibles y sin detalles técnicos (sin modelos, códigos ni errores).

export const HISTORY_LABELS = {
  ready: 'Informe disponible',
  preparing: 'Informe en preparación',
  exhausted: 'Informe no disponible todavía',
  failed: 'El informe no se pudo generar',
  // Sesión sin evaluación solicitada: no hay informe ni nada programado (no se promete uno).
  idle: 'Sin informe',
};

// Tono visual por estado (los tonos existen en el componente Badge).
const TONES = { ready: 'success', preparing: 'accent', exhausted: 'warning', failed: 'neutral', idle: 'neutral' };

// Estados que el backend informa mientras el informe puede llegar más adelante.
const PENDING_STATES = new Set(['processing', 'retrying', 'stalled']);

export function historyStatus(session = {}) {
  if (session?.hasReport || session?.report) return { key: 'ready', label: HISTORY_LABELS.ready, tone: TONES.ready };
  const state = session?.evaluation?.state;
  if (state === 'done') return { key: 'ready', label: HISTORY_LABELS.ready, tone: TONES.ready };
  if (state === 'exhausted') return { key: 'exhausted', label: HISTORY_LABELS.exhausted, tone: TONES.exhausted };
  if (state === 'failed') return { key: 'failed', label: HISTORY_LABELS.failed, tone: TONES.failed };
  if (state && PENDING_STATES.has(state)) return { key: 'preparing', label: HISTORY_LABELS.preparing, tone: TONES.preparing };
  return { key: 'idle', label: HISTORY_LABELS.idle, tone: TONES.idle };
}

// Sesiones con informe válido: son las únicas que pueden alimentar puntajes y tendencias.
export function evaluatedSessions(sessions = []) {
  return (Array.isArray(sessions) ? sessions : []).filter((s) => Boolean(s?.hasReport || s?.report) || s?.score != null);
}

// ¿Se puede abrir el informe? Solo con informe válido; el resto se muestra como estado.
export function canOpenReport(session = {}) {
  return Boolean(session?.hasReport || session?.report);
}
