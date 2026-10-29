// Progreso de la entrevista: el BACKEND es la autoridad. El frontend solo refleja lo que la API
// informa (`mainsAsked`, `mainsTotal`, `total`, `done`); no decide suficiencia ni presupuestos.
// `mainsAsked`/`mainsTotal` cuentan preguntas PRINCIPALES; las repreguntas no los incrementan.

export function emptyProgress(interview = null) {
  return {
    mainsAsked: 0,
    mainsTotal: Number.isFinite(interview?.questionCount) ? interview.questionCount : null,
    total: Number.isFinite(interview?.totalTurns) ? interview.totalTurns : null,
    done: false,
  };
}

// Aplica una respuesta del backend sobre el progreso actual. Idempotente: aplicar dos veces el
// mismo payload no cambia nada (evita duplicar progreso con reintentos o respuestas repetidas).
export function applyServerProgress(progress, data = {}) {
  const current = progress || emptyProgress();
  const next = { ...current };
  if (Number.isFinite(data.mainsAsked)) next.mainsAsked = data.mainsAsked;
  if (Number.isFinite(data.mainsTotal)) next.mainsTotal = data.mainsTotal;
  if (Number.isFinite(data.total)) next.total = data.total;
  if (data.done === true) next.done = true;
  const changed =
    next.mainsAsked !== current.mainsAsked ||
    next.mainsTotal !== current.mainsTotal ||
    next.total !== current.total ||
    next.done !== current.done;
  return { progress: next, changed, done: next.done === true };
}

// La entrevista terminó: lo dice el backend con `done` o con el código de error INTERVIEW_DONE.
export function isInterviewDone(response = {}) {
  return response?.done === true || response?.code === 'INTERVIEW_DONE';
}

// Etiqueta del encabezado: diferencia pregunta principal de repregunta.
export function progressLabel({ isFollowUp = false, mainsAsked = 0, mainsTotal = null, fallback = 'Pregunta' } = {}) {
  if (isFollowUp) return 'Repregunta';
  if (!mainsTotal) return fallback; // sin dato del backend no se inventa un total
  return `${fallback} ${Math.max(1, mainsAsked)} de ${mainsTotal}`;
}

export function progressPercent({ mainsAsked = 0, mainsTotal = null } = {}) {
  if (!mainsTotal) return 0;
  return Math.min(100, Math.round((mainsAsked / mainsTotal) * 100));
}
