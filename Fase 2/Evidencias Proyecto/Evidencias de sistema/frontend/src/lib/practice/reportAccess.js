// Reglas de acceso al informe: un informe solo se muestra cuando el BACKEND confirma
// que esa sesión tiene resultados. No basta con que exista la sesión, ni con un texto
// en sessionStorage. Todo lo que dependa de esto (pantalla de análisis e informe) usa
// estas funciones para no inventar estados ni mostrar contenido de otra sesión.

export const STAGE_TEXT = {
  audio: 'Transcribiendo el audio de tu entrevista…',
  ai: 'Evaluando tu práctica con la IA…',
  done: 'Preparando el informe…',
};

export function describeStage(evaluation) {
  if (!evaluation) return 'Preparando la evaluación…';
  if (evaluation.stage === 'ai') return STAGE_TEXT.ai;
  if (evaluation.stage === 'done') return STAGE_TEXT.done;
  return STAGE_TEXT.audio;
}

// Devuelve el estado real y si se puede abrir el informe.
export function reportAccess({ session = null, evaluation = null, error = '' } = {}) {
  if (error) {
    return { state: 'error', canOpen: false, title: 'No se pudo consultar el estado', description: error };
  }
  if (!session) {
    return {
      state: 'missing',
      canOpen: false,
      title: 'No se encontró la sesión',
      description: 'Puede que se haya eliminado o que no tengas acceso a ella.',
    };
  }
  if (session.report) {
    return { state: 'ready', canOpen: true, title: 'Informe listo', description: '' };
  }

  const state = evaluation?.state;
  if (state === 'processing') {
    return {
      state: 'processing',
      canOpen: false,
      title: 'El informe todavía se está generando',
      description: describeStage(evaluation),
    };
  }
  if (state === 'stalled') {
    return {
      state: 'failed',
      canOpen: false,
      title: 'La evaluación se interrumpió',
      description: 'Puedes consultar el estado o reintentarla desde la pantalla de análisis.',
    };
  }
  if (state === 'failed') {
    return {
      state: 'failed',
      canOpen: false,
      title: 'La evaluación no se pudo completar',
      description: 'Esta sesión no tiene informe. Revisa el motivo en la pantalla de análisis.',
    };
  }
  return {
    state: 'pending',
    canOpen: false,
    title: 'El informe todavía no está disponible',
    description: 'La sesión existe, pero su evaluación aún no ha comenzado.',
  };
}
