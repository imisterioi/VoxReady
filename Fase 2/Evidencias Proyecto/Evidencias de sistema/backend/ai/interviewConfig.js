// Configuración de la entrevista de un escenario (se guarda en Theme.interviewConfig).
// La define quien crea el escenario (admin del cliente o equipo de VoxReady):
//  - aggressiveness: qué tan agresivo es el entrevistador con el vocero,
//  - questionCount: cuántas preguntas principales hace,
//  - followUps: cuántas repreguntas hace después de cada pregunta principal,
//  - estimatedMinutes: duración estimada (null = se calcula según las preguntas),
//  - interviewerRole: quién entrevista (periodista de TV, dirigente sindical…),
//  - maxAnswerSeconds: tiempo máximo por respuesta (null = sin límite).

const AGGRESSIVENESS = {
  BAJA: {
    label: 'Baja',
    persona: 'Tu tono es cordial y colaborativo: das espacio al vocero para explicarse y no lo interrumpes ni lo acusas.',
    followUp: 'Pide con amabilidad que aclare o profundice lo que acaba de decir.',
  },
  MEDIA: {
    label: 'Media',
    persona: 'Eres incisivo pero respetuoso: no aceptas respuestas genéricas y pides precisiones.',
    followUp: 'Repregunta sobre lo que el vocero evitó contestar o dejó poco claro en su última respuesta.',
  },
  ALTA: {
    label: 'Alta',
    persona:
      'Eres confrontacional: desconfías de la versión oficial, señalas contradicciones y presionas por responsables, cifras y plazos concretos.',
    followUp:
      'Toma una frase concreta de la última respuesta del vocero y cuestiónala directamente, señalando lo que no calza o lo que implica.',
  },
  EXTREMA: {
    label: 'Extrema',
    persona:
      'Eres hostil y buscas el titular: asumes lo peor de la organización, interpretas las palabras del vocero de la forma más dañina posible y no le das tregua. Nunca insultas ni usas groserías.',
    followUp:
      'Toma la última respuesta del vocero y devuélvesela reformulada en su peor interpretación posible, como pregunta de sí o no (por ejemplo: "¿Dice entonces que…?").',
  },
};

const DEFAULTS = {
  aggressiveness: 'MEDIA',
  questionCount: 5,
  followUps: 0,
  // Duracion MAXIMA de la entrevista. Es OBLIGATORIA: la entrevista nunca queda sin limite de
  // tiempo, asi que un escenario sin duracion guardada (o con un valor vacio/invalido) usa este
  // predeterminado de 5 minutos. La estimacion orientativa es `estimateMinutes()` y NO es un limite.
  estimatedMinutes: 5,
  interviewerRole: '',
  maxAnswerSeconds: null,
};

const LIMITS = {
  questionCount: [1, 12],
  followUps: [0, 3],
  estimatedMinutes: [1, 120],
  maxAnswerSeconds: [15, 600],
  totalTurns: 30,
  interviewerRole: 120,
};

const MINUTES_PER_TURN = 1.2; // pregunta leída en voz alta + respuesta

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

function intIn(value, [min, max], fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

// Duracion MAXIMA (minutos). A diferencia de los demas campos NO admite "sin valor": un valor
// ausente, vacio (incluida una cadena en blanco) o no numerico usa el PREDETERMINADO, y uno fuera
// de rango se acota dentro de [1, 120] (normalizacion documentada). Nunca devuelve `null`, de modo
// que la entrevista siempre tiene un limite efectivo. Al GUARDAR, un valor vacio o fuera de rango
// se rechaza con 422 (ver `validateInterviewConfig`).
function durationIn(value) {
  if (value === null || value === undefined) return DEFAULTS.estimatedMinutes;
  if (typeof value === 'string' && value.trim() === '') return DEFAULTS.estimatedMinutes;
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return DEFAULTS.estimatedMinutes;
  return Math.max(LIMITS.estimatedMinutes[0], Math.min(LIMITS.estimatedMinutes[1], n));
}

// Duracion guardada en el escenario: `null` cuando no hay valor utilizable (escenario antiguo,
// campo vacio o valor no numerico), para poder distinguir "predeterminado" de "elegido".
function storedMinutes(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? n : null;
}

// Normaliza lo que envía el cliente o lo guardado en BD (siempre devuelve una config completa).
// `estimatedMinutes` SIEMPRE sale como numero dentro de [1, 120]: un valor ausente, `null`, vacio
// o no numerico cae al predeterminado (5 min) y uno fuera de rango se acota (normalizacion
// documentada). Nunca devuelve `null`: la entrevista no puede quedar sin limite de duracion.
function normalizeInterviewConfig(input) {
  const raw = isObject(input) ? input : {};
  const followUps = intIn(raw.followUps, LIMITS.followUps, DEFAULTS.followUps);
  const maxQuestions = Math.min(LIMITS.questionCount[1], Math.floor(LIMITS.totalTurns / (1 + followUps)));
  return {
    aggressiveness: AGGRESSIVENESS[raw.aggressiveness] ? raw.aggressiveness : DEFAULTS.aggressiveness,
    questionCount: intIn(raw.questionCount, [LIMITS.questionCount[0], maxQuestions], DEFAULTS.questionCount),
    followUps,
    estimatedMinutes: durationIn(raw.estimatedMinutes),
    interviewerRole: String(raw.interviewerRole ?? '').trim().slice(0, LIMITS.interviewerRole),
    maxAnswerSeconds: intIn(raw.maxAnswerSeconds, LIMITS.maxAnswerSeconds, null),
  };
}

const totalTurns = (cfg) => cfg.questionCount * (1 + cfg.followUps);

// Config de un tema tal como la ve el frontend: incluye los valores calculados.
// Dos conceptos que NO deben confundirse:
//  - `estimatedMinutes` / `maxDurationMs`: duracion MAXIMA efectiva (obligatoria, compartida por
//    todos los temas del escenario). Nunca es `null`: un escenario antiguo sin duracion guardada
//    recibe el predeterminado de 5 minutos.
//  - `estimatedMinutesReference`: estimacion ORIENTATIVA (preguntas x 1,2 min). Es informativa y
//    no limita nada.
function resolveInterviewConfig(theme) {
  const stored = isObject(theme?.interviewConfig) ? theme.interviewConfig : {};
  const storedEstimated = storedMinutes(stored.estimatedMinutes);
  const cfg = normalizeInterviewConfig(theme?.interviewConfig);
  const total = totalTurns(cfg);
  const budget = followUpBudget(cfg);
  return {
    ...cfg,
    totalTurns: total,
    // Duracion MAXIMA efectiva: siempre existe (predeterminado 5 min si no se guardo ninguna).
    maxDurationMs: cfg.estimatedMinutes * 60000,
    // Lo que habia guardado: permite distinguir "elegido por el usuario" de "predeterminado".
    estimatedMinutesStored: storedEstimated,
    estimatedMinutesAuto: storedEstimated == null,
    estimatedMinutesReference: estimateMinutes(cfg),
    msPerTurn: INTERVIEW_TIMING.msPerTurn,
    maxTurnsPotential: maxTurnsPotential(cfg),
    followUpBudget: budget,
    extraMarginMs: INTERVIEW_TIMING.extraMarginMs,
    aggressivenessLabel: AGGRESSIVENESS[cfg.aggressiveness].label,
  };
}

// Qué le toca preguntar al entrevistador según cuántas preguntas ya hizo.
// Cada pregunta principal va seguida de `followUps` repreguntas.
function turnPlan(cfg, asked) {
  const total = totalTurns(cfg);
  const block = 1 + cfg.followUps;
  return {
    total,
    number: Math.min(asked + 1, total),
    done: asked >= total,
    kind: asked % block === 0 ? 'main' : 'followup',
    mainNumber: Math.min(Math.floor(asked / block) + 1, cfg.questionCount),
  };
}

// --- Evaluacion adaptativa: presupuestos de repreguntas y validacion tecnica ---
// Repreguntas EXTRAORDINARIAS por nivel de agresividad (adicionales a las habituales del tema).
const EXTRAORDINARY_BY_LEVEL = { BAJA: 0, MEDIA: 0, ALTA: 1, EXTREMA: 2 };
// Con "Sin repreguntas fijas" no se planifican repreguntas, pero se admite UNA aclaracion
// habitual cuando la respuesta es evasiva, vacia o no aborda lo preguntado.
const CLARITY_WHEN_NO_FIXED = 1;
// Aclaracion de CONTINGENCIA cuando la cadena de evaluacion falla por completo.
const CONTINGENCY_CLARIFICATIONS = 1;

// Margen global de cierre (mismo para todos los temas) y coste medio por turno para la
// estimacion automatica. Configurable por variable de entorno; sin ella, 2 minutos.
const INTERVIEW_TIMING = {
  extraMarginMs: (() => {
    const value = Number(process.env.INTERVIEW_EXTRA_MARGIN_MS);
    return Number.isFinite(value) && value >= 0 ? value : 120000;
  })(),
  msPerTurn: (() => {
    const value = Number(process.env.INTERVIEW_MS_PER_TURN);
    return Number.isFinite(value) && value > 0 ? value : 40000;
  })(),
};

const extraordinaryMax = (cfg) => EXTRAORDINARY_BY_LEVEL[cfg?.aggressiveness] ?? 0;

// Presupuesto de repreguntas por pregunta principal. Todos los conceptos cuentan para el limite
// tecnico: habituales + aclaracion de "sin fijas" + extraordinarias + contingencia.
function followUpBudget(cfg) {
  const habitual = Number(cfg?.followUps) || 0;
  const clarity = habitual === 0 ? CLARITY_WHEN_NO_FIXED : 0;
  const extraordinary = extraordinaryMax(cfg);
  const contingency = CONTINGENCY_CLARIFICATIONS;
  return { habitual, clarity, extraordinary, contingency, perMain: habitual + clarity + extraordinary + contingency };
}

// Peor caso alcanzable: principales x (1 + repreguntas posibles de cada una).
const maxTurnsPotential = (cfg) => (Number(cfg?.questionCount) || 0) * (1 + followUpBudget(cfg).perMain);

// Duracion estimada automatica (orientativa). No se edita por tema.
const estimateMinutes = (cfg) => Math.max(1, Math.round(totalTurns(cfg) * MINUTES_PER_TURN));

// Validacion autoritativa (la usa el backend antes de guardar y antes de iniciar).
// NO recorta nada: si no cabe, devuelve error con el motivo y los parametros a ajustar.
//  - `requireDuration: true` (rutas que GUARDAN un escenario): la duracion maxima es OBLIGATORIA y
//    debe estar dentro de rango, para que no se pueda guardar un escenario sin limite de tiempo.
//  - Sin la opcion (configuracion YA guardada, p. ej. al iniciar la entrevista): una duracion
//    ausente NO es un error, porque `normalizeInterviewConfig` aplica el predeterminado de 5 min.
//    Asi los escenarios antiguos (`interviewConfig = null`) siguen siendo compatibles.
function validateInterviewConfig(input, { requireDuration = false } = {}) {
  const raw = isObject(input) ? input : {};
  const cfg = normalizeInterviewConfig(raw);
  const errors = [];
  if (requireDuration) {
    const [minMinutes, maxMinutes] = LIMITS.estimatedMinutes;
    const duration = raw.estimatedMinutes;
    if (duration === null || duration === undefined || duration === '') {
      errors.push({
        field: 'estimatedMinutes',
        code: 'REQUIRED',
        mensaje: `Indica la duracion maxima de la entrevista (entre ${minMinutes} y ${maxMinutes} minutos). Si la dejas vacia se usan ${DEFAULTS.estimatedMinutes} minutos.`,
      });
    } else {
      const minutes = Number(duration);
      if (!Number.isFinite(minutes)) {
        errors.push({ field: 'estimatedMinutes', code: 'INVALID', mensaje: 'La duracion maxima debe ser un numero de minutos.' });
      } else if (minutes < minMinutes) {
        errors.push({
          field: 'estimatedMinutes',
          code: 'BELOW_MIN',
          requested: minutes,
          min: minMinutes,
          mensaje: `La duracion maxima no puede ser menor a ${minMinutes} minuto.`,
        });
      } else if (minutes > maxMinutes) {
        errors.push({
          field: 'estimatedMinutes',
          code: 'ABOVE_MAX',
          requested: minutes,
          max: maxMinutes,
          mensaje: `La duracion maxima no puede superar los ${maxMinutes} minutos.`,
        });
      }
    }
  }
  const requestedQuestions = Number(raw.questionCount);
  if (Number.isFinite(requestedQuestions) && requestedQuestions > LIMITS.questionCount[1]) {
    errors.push({
      field: 'questionCount',
      code: 'ABOVE_MAX',
      requested: requestedQuestions,
      max: LIMITS.questionCount[1],
      mensaje: `El maximo de preguntas principales es ${LIMITS.questionCount[1]}.`,
    });
  }
  const requestedFollowUps = Number(raw.followUps);
  if (Number.isFinite(requestedFollowUps) && requestedFollowUps > LIMITS.followUps[1]) {
    errors.push({
      field: 'followUps',
      code: 'ABOVE_MAX',
      requested: requestedFollowUps,
      max: LIMITS.followUps[1],
      mensaje: `El maximo de repreguntas fijas es ${LIMITS.followUps[1]}.`,
    });
  }
  const budget = followUpBudget({ ...cfg, followUps: Number.isFinite(requestedFollowUps) && requestedFollowUps >= 0 ? requestedFollowUps : cfg.followUps });
  // El peor caso se calcula con los valores SOLICITADOS, no con los recortados por
  // `normalizeInterviewConfig`: si no, el recorte podria hacer parecer valida una config invalida.
  const rawQuestions = Number.isFinite(requestedQuestions) && requestedQuestions > 0 ? Math.round(requestedQuestions) : cfg.questionCount;
  const potential = rawQuestions * (1 + budget.perMain);
  if (potential > LIMITS.totalTurns) {
    errors.push({ field: 'turnos', code: 'TURN_LIMIT', potential, limit: LIMITS.totalTurns, budgetPerMain: budget.perMain });
  }
  return { ok: errors.length === 0, errors, cfg, budget, potential, limit: LIMITS.totalTurns };
}

// Cuerpo 422 UNIFORME para una configuracion invalida. Lo usan todas las rutas que guardan un
// escenario, siempre ANTES de normalizar: asi una configuracion invalida se rechaza con el motivo
// (en vez de recortarse en silencio) y el mensaje es el mismo en todas.
// Devuelve `null` cuando la configuracion es valida.
function invalidInterviewConfigPayload(input, { requireDuration = false } = {}) {
  const validation = validateInterviewConfig(input, { requireDuration });
  if (validation.ok) return null;
  const first = validation.errors[0];
  const mensaje =
    first?.code === 'TURN_LIMIT'
      ? `La configuracion de la entrevista supera el limite de ${validation.limit} turnos potenciales (calculados: ${validation.potential}). Ajusta la cantidad de preguntas o de repreguntas.`
      : first?.mensaje || 'La configuracion de la entrevista no es valida.';
  return {
    status: 'error',
    code: 'INTERVIEW_CONFIG_INVALID',
    mensaje,
    errors: validation.errors,
    limit: validation.limit,
    potential: validation.potential,
    budget: validation.budget,
  };
}

module.exports = {
  AGGRESSIVENESS,
  DEFAULTS,
  LIMITS,
  INTERVIEW_TIMING,
  EXTRAORDINARY_BY_LEVEL,
  normalizeInterviewConfig,
  resolveInterviewConfig,
  turnPlan,
  totalTurns,
  extraordinaryMax,
  followUpBudget,
  maxTurnsPotential,
  estimateMinutes,
  validateInterviewConfig,
  invalidInterviewConfigPayload,
};

