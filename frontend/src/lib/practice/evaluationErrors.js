// Mensajes de usuario para los errores de la evaluación (sin detalles internos).
const DEFAULT_MESSAGE = 'No se pudo completar el análisis. Inténtalo de nuevo en unos minutos.';

export function describeEvaluationError(error) {
  if (!error) return DEFAULT_MESSAGE;
  if (error.name === 'AbortError') return null;
  const code = String(error.code || '');

  if (code === 'EVAL_NVIDIA_ASR_DISABLED') {
    return 'La transcripción automática no está habilitada en este servidor. Avisa al administrador para activarla.';
  }
  if (code === 'TRANSCRIPTION_NO_WINDOWS') {
    return 'No se registraron tiempos válidos para tus respuestas, así que no se puede separar el audio. Repite la sesión.';
  }
  if (code === 'TRANSCRIPTION_ANSWER_TRANSCRIPTION_FAILED' || code === 'TRANSCRIPTION_EMPTY_TRANSCRIPT') {
    return 'No se pudo transcribir una o más respuestas. Tu grabación se conserva: puedes reintentar el análisis.';
  }
  if (code === 'TRANSCRIPTION_NO_TIMESTAMPS') {
    return 'El servicio de transcripción no devolvió el texto esperado. Tu grabación se conserva; reintenta más tarde.';
  }
  if (error.status === 503) return 'El análisis no está disponible en este momento. Inténtalo más tarde.';
  if (error.status === 502) return 'El servicio de transcripción no respondió correctamente. Tu grabación se conserva; puedes reintentar.';
  if (error.status === 422) return 'La sesión no tiene datos suficientes para evaluarse. Repite la práctica.';
  if (!error.status) return 'No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.';
  return DEFAULT_MESSAGE;
}

export { DEFAULT_MESSAGE as EVALUATION_ERROR_FALLBACK };
