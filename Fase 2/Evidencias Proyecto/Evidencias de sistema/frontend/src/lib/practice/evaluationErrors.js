// Mensajes de usuario para los errores de la evaluación (sin detalles internos).
// Los TEXTOS llegan como parámetro (`texts`) para poder mostrarlos en el idioma activo: la interfaz
// pasa el diccionario (`d.evalErrors`). Los valores por defecto son el español.

export const ERROR_TEXTS = {
  disabled: 'La transcripción automática no está habilitada en este servidor. Avisa al administrador para activarla.',
  noWindows: 'No se registraron tiempos válidos para tus respuestas, así que no se puede separar el audio. Repite la sesión.',
  transcriptionFailed: 'No se pudo transcribir una o más respuestas. Tu grabación se conserva: puedes reintentar el análisis.',
  noTimestamps: 'El servicio de transcripción no devolvió el texto esperado. Tu grabación se conserva; reintenta más tarde.',
  languageUnsupported: 'Ningún motor de transcripción configurado admite el idioma de esta sesión. Avisa al administrador.',
  unavailable: 'El análisis no está disponible en este momento. Inténtalo más tarde.',
  transcriptionService: 'El servicio de transcripción no respondió correctamente. Tu grabación se conserva; puedes reintentar.',
  insufficient: 'La sesión no tiene datos suficientes para evaluarse. Repite la práctica.',
  offline: 'No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.',
  fallback: 'No se pudo completar el análisis. Inténtalo de nuevo en unos minutos.',
};

const DEFAULT_MESSAGE = ERROR_TEXTS.fallback;

export function describeEvaluationError(error, texts = ERROR_TEXTS) {
  if (!error) return texts.fallback;
  if (error.name === 'AbortError') return null;
  const code = String(error.code || '');

  if (code === 'EVAL_NVIDIA_ASR_DISABLED') return texts.disabled;
  if (code === 'TRANSCRIPTION_NO_WINDOWS') return texts.noWindows;
  if (code === 'TRANSCRIPTION_ANSWER_TRANSCRIPTION_FAILED' || code === 'TRANSCRIPTION_EMPTY_TRANSCRIPT') {
    return texts.transcriptionFailed;
  }
  if (code === 'TRANSCRIPTION_NO_TIMESTAMPS') return texts.noTimestamps;
  // Ningún motor admite el idioma de la sesión: es un problema de configuración, no un fallo
  // puntual, así que no se invita a reintentar.
  if (code === 'TRANSCRIPTION_LANGUAGE_UNSUPPORTED') return texts.languageUnsupported;
  if (error.status === 503) return texts.unavailable;
  if (error.status === 502) return texts.transcriptionService;
  if (error.status === 422) return texts.insufficient;
  if (!error.status) return texts.offline;
  return texts.fallback;
}

export { DEFAULT_MESSAGE as EVALUATION_ERROR_FALLBACK };
