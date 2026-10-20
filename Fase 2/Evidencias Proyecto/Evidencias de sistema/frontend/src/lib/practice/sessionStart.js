// Condiciones para EMPEZAR a grabar una práctica.
//
// La grabación no debe arrancar mientras el entrevistador sigue cargando (la primera
// pregunta se pide a la IA y puede tardar decenas de segundos), ni antes de tener cámara,
// micrófono y el modelo de análisis listos. Este módulo aísla esa decisión para poder
// probarla sin navegador.
export function recordingReadiness({
  sessionId = null,
  mediaReady = false,
  textMode = false,
  question = null,
  poseReady = false,
  poseFailed = false,
} = {}) {
  const missing = [];
  if (!sessionId) missing.push('session');
  if (!textMode && !mediaReady) missing.push('media');
  if (!question) missing.push('question');
  // El cuerpo es opcional: si el modelo no carga, la práctica sigue sin medirlo.
  if (!textMode && !poseReady && !poseFailed) missing.push('pose');
  return { ready: missing.length === 0, missing };
}
