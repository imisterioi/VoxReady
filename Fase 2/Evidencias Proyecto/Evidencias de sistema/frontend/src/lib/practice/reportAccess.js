// Reglas de acceso al informe: un informe solo se muestra cuando el BACKEND confirma
// que esa sesión tiene resultados. No basta con que exista la sesión, ni con un texto
// en sessionStorage. Todo lo que dependa de esto (pantalla de análisis e informe) usa
// estas funciones para no inventar estados ni mostrar contenido de otra sesión.
//
// Los TEXTOS llegan como parámetro (`texts`) para poder mostrarlos en el idioma activo: la interfaz
// pasa el diccionario (`d.report`). Estos valores por defecto son el español y permiten usar los
// módulos sin React (pruebas).

export const REPORT_TEXTS = {
  stage: {
    audio: 'Transcribiendo el audio de tu entrevista…',
    ai: 'Evaluando tu práctica con la IA…',
    done: 'Preparando el informe…',
    idle: 'Preparando la evaluación…',
    retry: 'Preparando tu informe…',
  },
  pending: {
    title: 'Tu informe estará disponible más adelante',
    message:
      'La entrevista ha finalizado, pero estamos tardando un poco más de lo esperado en preparar tu informe. ' +
      'El informe continúa preparándose en segundo plano: podrás consultarlo más tarde en «Mi progreso». ' +
      'No necesitas hacer nada.',
  },
  failure: {
    transient: 'El servicio de generación no está disponible en este momento. El informe se volverá a intentar automáticamente.',
    permanent: 'No pudimos preparar el informe de esta práctica. Nuestro equipo lo está revisando.',
  },
  error: { title: 'No se pudo consultar el estado' },
  missing: { title: 'No se encontró la sesión', description: 'Puede que se haya eliminado o que no tengas acceso a ella.' },
  ready: { title: 'Informe listo' },
  processing: { title: 'El informe todavía se está generando' },
  stalled: { title: 'La evaluación se interrumpió', description: 'Puedes consultar el estado o reintentarla desde la pantalla de análisis.' },
  failed: { title: 'La evaluación no se pudo completar' },
  notStarted: { title: 'El informe todavía no está disponible', description: 'La sesión existe, pero su evaluación aún no ha comenzado.' },
};

// Constantes históricas: mismo contenido que los textos por defecto en español.
export const STAGE_TEXT = REPORT_TEXTS.stage;
export const PENDING_TITLE = REPORT_TEXTS.pending.title;
export const PENDING_MESSAGE = REPORT_TEXTS.pending.message;
export const TRANSIENT_MESSAGE = REPORT_TEXTS.failure.transient;
export const PERMANENT_MESSAGE = REPORT_TEXTS.failure.permanent;

export function describeStage(evaluation, texts = REPORT_TEXTS) {
  const stage = texts.stage;
  if (!evaluation) return stage.idle;
  if (evaluation.stage === 'ai') return stage.ai;
  if (evaluation.stage === 'done') return stage.done;
  // Reintentos automáticos en curso o agotados: sigue siendo "preparando", nunca un error técnico.
  if (evaluation.stage === 'pending' || evaluation.stage === 'exhausted') return stage.retry;
  return stage.audio;
}

// `evaluation.errorKind` lo envía el backend ('transient' | 'permanent'). Cualquier valor ausente o
// desconocido se trata como temporal: la sesión sigue teniendo reintentos programados.
export function failureMessage(evaluation, texts = REPORT_TEXTS) {
  return evaluation?.errorKind === 'permanent' ? texts.failure.permanent : texts.failure.transient;
}

// Reintentos automáticos en curso (o agotados): el informe puede llegar más adelante y el vocero
// no debe hacer nada. Se comprueba ANTES que `failed` para no mostrar un error técnico.
export function pendingRetryAccess(evaluation = null, texts = REPORT_TEXTS) {
  return {
    state: 'pending',
    canOpen: false,
    title: texts.pending.title,
    description: evaluation?.errorKind === 'permanent' ? texts.failure.permanent : texts.pending.message,
  };
}

// Devuelve el estado real y si se puede abrir el informe.
export function reportAccess({ session = null, evaluation = null, error = '', texts = REPORT_TEXTS } = {}) {
  if (error) {
    return { state: 'error', canOpen: false, title: texts.error.title, description: error };
  }
  if (!session) {
    return { state: 'missing', canOpen: false, title: texts.missing.title, description: texts.missing.description };
  }
  if (session.report) {
    return { state: 'ready', canOpen: true, title: texts.ready.title, description: '' };
  }

  const state = evaluation?.state;
  if (state === 'processing') {
    return {
      state: 'processing',
      canOpen: false,
      title: texts.processing.title,
      description: describeStage(evaluation, texts),
    };
  }
  if (state === 'stalled') {
    return {
      state: 'failed',
      canOpen: false,
      title: texts.stalled.title,
      description: texts.stalled.description,
    };
  }
  // Reintentos automáticos en curso (o agotados): espera discreta, sin errores técnicos.
  if (state === 'retrying' || state === 'exhausted') return pendingRetryAccess(evaluation, texts);
  if (state === 'failed') {
    return {
      state: 'failed',
      canOpen: false,
      title: texts.failed.title,
      // Mensaje según la clasificación del backend (temporal o requiere revisión). Sin códigos.
      description: failureMessage(evaluation, texts),
    };
  }
  return {
    state: 'pending',
    canOpen: false,
    title: texts.notStarted.title,
    description: texts.notStarted.description,
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

