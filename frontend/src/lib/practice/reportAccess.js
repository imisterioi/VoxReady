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
  // Reintentos automáticos en curso o agotados: sigue siendo "preparando", nunca un error técnico.
  if (evaluation.stage === 'pending' || evaluation.stage === 'exhausted') return 'Preparando tu informe…';
  return STAGE_TEXT.audio;
}

// Texto para cuando el informe tarda más de lo esperado (reintentos automáticos en curso).
// Es deliberadamente genérico: nunca revela modelos, códigos HTTP, cuotas ni errores internos.
// Informa de que el proceso continúa en segundo plano y dónde consultarlo después.
export const PENDING_TITLE = 'Tu informe estará disponible más adelante';
export const PENDING_MESSAGE =
  'La entrevista ha finalizado, pero estamos tardando un poco más de lo esperado en preparar tu informe. ' +
  'El informe continúa preparándose en segundo plano: podrás consultarlo más tarde en «Mi progreso». ' +
  'No necesitas hacer nada.';

// Mensajes según la naturaleza del fallo (la clasificación la decide el backend). Nunca incluyen
// códigos, modelos, proveedores ni detalles técnicos.
export const TRANSIENT_MESSAGE =
  'El servicio de generación no está disponible en este momento. El informe se volverá a intentar automáticamente.';
export const PERMANENT_MESSAGE =
  'No pudimos preparar el informe de esta práctica. Nuestro equipo lo está revisando.';

// `evaluation.errorKind` lo envía el backend ('transient' | 'permanent'). Cualquier valor ausente o
// desconocido se trata como temporal: la sesión sigue teniendo reintentos programados.
export function failureMessage(evaluation) {
  return evaluation?.errorKind === 'permanent' ? PERMANENT_MESSAGE : TRANSIENT_MESSAGE;
}

// Reintentos automáticos en curso (o agotados): el informe puede llegar más adelante y el vocero
// no debe hacer nada. Se comprueba ANTES que `failed` para no mostrar un error técnico.
export function pendingRetryAccess(evaluation = null) {
  return {
    state: 'pending',
    canOpen: false,
    title: PENDING_TITLE,
    description: evaluation?.errorKind === 'permanent' ? PERMANENT_MESSAGE : PENDING_MESSAGE,
  };
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
  // Reintentos automáticos en curso (o agotados): espera discreta, sin errores técnicos.
  if (state === 'retrying' || state === 'exhausted') return pendingRetryAccess(evaluation);
  if (state === 'failed') {
    return {
      state: 'failed',
      canOpen: false,
      title: 'La evaluación no se pudo completar',
      // Mensaje según la clasificación del backend (temporal o requiere revisión). Sin códigos.
      description: failureMessage(evaluation),
    };
  }
  return {
    state: 'pending',
    canOpen: false,
    title: 'El informe todavía no está disponible',
    description: 'La sesión existe, pero su evaluación aún no ha comenzado.',
  };
}

// De QUÉ sesión se muestra el informe. Regla dura: NUNCA se sustituye una sesión por otra.
//  - 'url':    la sesión indicada en el enlace (?sesion=) manda siempre.
//  - 'recent': la práctica recién terminada por el vocero (guardada por SesionPractica). Si su
//              informe no está listo o falló, se muestra ESE estado; nunca el informe de otra.
//  - 'none':   no se pidió ninguna sesión concreta → no se muestra ningún informe.
export function resolveReportSessionId({ paramId = null, recentId = null } = {}) {
  const clean = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);
  const fromUrl = clean(paramId);
  const fromRecent = clean(recentId);
  if (fromUrl) return { id: fromUrl, source: 'url' };
  if (fromRecent) return { id: fromRecent, source: 'recent' };
  return { id: null, source: 'none' };
}

