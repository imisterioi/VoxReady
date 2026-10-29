// Límites de configuración de la entrevista (vista previa en el formulario).
//
// La AUTORIDAD es el backend (`backend/ai/interviewConfig.js` -> validateInterviewConfig, que
// responde 422 y NO recorta valores). Estas funciones replican solo la aritmética mínima para
// avisar antes de guardar; si divergen, manda el backend.
export const TURN_LIMIT = 30;
export const EXTRA_MARGIN_MS = 120000; // margen global de cierre: 2 minutos
export const MINUTES_PER_TURN = 1.2;

// Duración MÁXIMA de la entrevista: es obligatoria (la entrevista nunca queda sin límite de
// tiempo). Si el escenario no la trae (configuración antigua o campo vacío) se usa este valor.
export const DEFAULT_MINUTES = 5;
export const MINUTES_RANGE = [1, 120];

const EXTRAORDINARY_BY_LEVEL = { BAJA: 0, MEDIA: 0, ALTA: 1, EXTREMA: 2 };

export function followUpBudget(cfg = {}) {
  const habitual = Number(cfg.followUps) || 0;
  const clarity = habitual === 0 ? 1 : 0;
  const extraordinary = EXTRAORDINARY_BY_LEVEL[cfg.aggressiveness] ?? 0;
  const contingency = 1;
  return { habitual, clarity, extraordinary, contingency, perMain: habitual + clarity + extraordinary + contingency };
}

export function maxTurnsPotential(cfg = {}) {
  const questions = Number(cfg.questionCount) || 0;
  return questions * (1 + followUpBudget(cfg).perMain);
}

export function autoMinutes(cfg = {}) {
  const questions = Number(cfg.questionCount) || 0;
  const turns = questions * (1 + (Number(cfg.followUps) || 0));
  return Math.max(1, Math.round(turns * MINUTES_PER_TURN));
}

// Problemas que impiden iniciar/guardar. Devuelve [] si la configuración es válida.
export function interviewConfigIssues(cfg = {}) {
  const issues = [];
  // Duración máxima OBLIGATORIA: vacía, nula o inválida no puede desactivar el límite de tiempo.
  const rawMinutes = cfg.estimatedMinutes;
  const missingMinutes = rawMinutes === '' || rawMinutes == null;
  const minutes = Number(rawMinutes);
  if (missingMinutes) {
    issues.push({
      field: 'estimatedMinutes',
      code: 'REQUIRED',
      mensaje: `Indica la duración máxima de la entrevista (entre ${MINUTES_RANGE[0]} y ${MINUTES_RANGE[1]} minutos). Si la dejas vacía se usan ${DEFAULT_MINUTES} minutos.`,
    });
  } else if (!Number.isFinite(minutes)) {
    issues.push({ field: 'estimatedMinutes', code: 'INVALID', mensaje: 'La duración máxima debe ser un número de minutos.' });
  } else if (minutes < MINUTES_RANGE[0]) {
    issues.push({
      field: 'estimatedMinutes',
      code: 'BELOW_MIN',
      mensaje: `La duración máxima no puede ser menor a ${MINUTES_RANGE[0]} minuto.`,
    });
  } else if (minutes > MINUTES_RANGE[1]) {
    issues.push({
      field: 'estimatedMinutes',
      code: 'ABOVE_MAX',
      mensaje: `La duración máxima no puede superar los ${MINUTES_RANGE[1]} minutos.`,
    });
  }
  const questions = Number(cfg.questionCount) || 0;
  const followUps = Number(cfg.followUps) || 0;
  if (questions < 1) issues.push({ field: 'questionCount', code: 'MIN', mensaje: 'Indica al menos 1 pregunta principal.' });
  if (questions > 12) issues.push({ field: 'questionCount', code: 'MAX', mensaje: 'Máximo 12 preguntas principales.' });
  if (followUps > 3) issues.push({ field: 'followUps', code: 'MAX', mensaje: 'Máximo 3 repreguntas habituales.' });
  const potential = maxTurnsPotential(cfg);
  if (potential > TURN_LIMIT) {
    issues.push({
      field: 'turnos',
      code: 'TURN_LIMIT',
      potential,
      mensaje: `Esta configuración puede llegar a ${potential} turnos y el máximo es ${TURN_LIMIT}. Baja la cantidad de preguntas o de repreguntas para poder comenzar.`,
    });
  }
  return issues;
}
