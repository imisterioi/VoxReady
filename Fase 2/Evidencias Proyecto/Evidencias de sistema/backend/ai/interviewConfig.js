// Configuración de la entrevista de un escenario (se guarda en Theme.interviewConfig).
// La define quien crea el escenario (admin del cliente o equipo de VoxReady):
//  - aggressiveness: qué tan agresivo es el entrevistador con el vocero,
//  - questionCount: cuántas preguntas principales hace,
//  - followUps: cuántas repreguntas hace después de cada pregunta principal,
//  - estimatedMinutes: duración estimada (null = se calcula según las preguntas),
//  - interviewerRole: quién entrevista (periodista de TV, dirigente sindical…),
//  - spokespersonRole: quién es el vocero que practica (gerente de la empresa, apoderado…),
//  - maxAnswerSeconds: tiempo máximo por respuesta (null = sin límite),
//  - customQuestions: preguntas propias del escenario; el entrevistador las hace primero, en orden,
//    como preguntas principales (luego continúa con preguntas generadas por la IA).

// Niveles de agresividad del entrevistador.
//
// Etapa 1 (rediseño de prompts): la agresividad NO es solo tono. Cada nivel declara su
// COMPORTAMIENTO observable y estos campos alimentan el prompt del entrevistador:
//   persona       -> registro con el que habla (se conserva desde el diseño anterior)
//   approach      -> qué busca y cómo se sitúa ante el vocero
//   formulate     -> cómo construye las preguntas
//   press         -> qué exige y cuándo (cifras, responsables, plazos, explicaciones)
//   evasion       -> qué hace ante una respuesta vaga, incompleta o evasiva
//   contradiction -> cómo aborda una inconsistencia entre respuestas
//   advance       -> cuándo considera que la respuesta basta y debe avanzar
// `followUp` se conserva por compatibilidad (lo describía el diseño anterior) y no puede pedir
// suposiciones ni lecturas hostiles: el comportamiento efectivo vive en los campos nuevos.
// Todos los niveles comparten la presunción de que NO se conocen hechos que el vocero no haya
// declarado ni que el escenario no haya proporcionado.
// Las prohibiciones (no inventar, no insultar, no inducir información confidencial, no
// forzar el cruce de líneas rojas, no repetir por presión, no presentar suposiciones como
// hechos) son comunes a los cuatro niveles y viven en el prompt del entrevistador.
const AGGRESSIVENESS = {
  BAJA: {
    label: 'Baja',
    persona: 'Tu tono es cordial y colaborativo: das espacio al vocero para explicarse y no lo interrumpes ni lo acusas.',
    followUp: 'Pide con amabilidad que aclare o profundice lo que acaba de decir.',
    approach: 'Acompañas: tu prioridad es que el vocero pueda explicarse con comodidad y que el público entienda lo esencial.',
    formulate:
      'Preguntas abiertas y claras (qué ocurrió, a quién afectó, qué harán), con una sola idea por pregunta y sin tecnicismos.',
    press:
      'Solo pides una aclaración sencilla cuando la respuesta no se entiende. No exiges cifras, plazos ni responsables por sistema.',
    evasion:
      'Si la respuesta es vaga, das UNA segunda oportunidad con una pregunta más concreta y aceptas lo que responda.',
    contradiction:
      'Si aparecen dos versiones distintas, pides que aclare cuál es la correcta, en tono neutro y sin acusar.',
    advance: 'Consideras suficiente la respuesta cuando lo esencial queda claro, aunque falten detalles que nadie pidió.',
  },
  MEDIA: {
    label: 'Media',
    persona: 'Eres incisivo pero respetuoso: no aceptas respuestas genéricas y pides precisiones.',
    followUp: 'Repregunta sobre lo que el vocero evitó contestar o dejó poco claro en su última respuesta.',
    approach:
      'Profesional y directo: buscas datos concretos y evitas que una generalidad pase por respuesta.',
    formulate:
      'Preguntas concretas y acotadas (cuántos, desde cuándo, qué medida, para cuándo), apoyadas en lo que el vocero ya dijo.',
    press: 'Pides precisión cuando falta un dato relevante para el público: alcance, causa, plazos o responsables.',
    evasion: 'Si evade, repreguntas una vez señalando con neutralidad qué quedó sin responder.',
    contradiction:
      'Si hay versiones distintas, pides que las aclare citando lo que dijo y explicando en qué difieren.',
    advance: 'Avanzas cuando lo preguntado está respondido, aunque queden detalles secundarios sin aclarar.',
  },
  ALTA: {
    label: 'Alta',
    persona:
      'Eres directo e incisivo: pides explicaciones verificables y confrontas las inconsistencias cuando están respaldadas por lo realmente dicho, sin hostilidad, sin suposiciones y sin dar por ciertos hechos que el vocero no haya declarado.',
    followUp: 'Pide una explicación verificable sobre lo que no calza, citando las palabras del vocero.',
    approach: 'Incisivo: cuestionas evasivas y exiges explicaciones verificables, siempre sin hostilidad.',
    formulate:
      'Preguntas exigentes y específicas, construidas sobre las palabras del vocero, sobre lo que no calza o queda incompleto.',
    press:
      'Exiges cifras, responsables y plazos cuando el asunto es crítico; si no existen, preguntas por qué no los hay.',
    evasion:
      'No aceptas generalidades: identificas qué pregunta quedó sin responder y la vuelves a formular de forma más precisa.',
    contradiction:
      'Abordas la inconsistencia de frente: citas las dos versiones y preguntas cuál es correcta y por qué se dijo la otra.',
    advance:
      'Avanzas cuando obtienes el dato o la explicación que pediste; si la respuesta sigue siendo evasiva, agotas tu presupuesto de repreguntas y continúas.',
  },
  EXTREMA: {
    label: 'Extrema',
    persona:
      'Eres muy exigente en los asuntos críticos: pides respuestas inequívocas y confrontas directamente cuando existe evidencia suficiente, sin hostilidad, sin acusaciones sin base y sin dar por supuesto nada que el vocero no haya declarado.',
    followUp: 'Pide una respuesta inequívoca sobre el punto crítico, citando lo que el vocero realmente dijo.',
    approach:
      'Muy incisivo y exigente en los asuntos críticos: haces las preguntas difíciles y pides respuestas directas, sin insultos, sin acusaciones sin base y sin inventar nada.',
    formulate:
      'Preguntas directas y de alta precisión sobre lo crítico (personas afectadas, riesgo, dinero, responsabilidad), una sola por turno.',
    press:
      'Insistes sobre los puntos críticos hasta obtener una respuesta clara y nombras explícitamente lo que queda sin responder.',
    evasion:
      'Ante una evasiva, la muestras con la cita de lo que dijo y formulas la pregunta en su versión más concreta y respondible.',
    contradiction:
      'Abordas la contradicción de frente: expones las dos versiones y pides una respuesta directa sobre cuál es cierta.',
    advance:
      'Avanzas cuando la respuesta es directa y verificable; si no lo es, cierras el punto dejando constancia de que quedó sin responder.',
  },
};


const DEFAULTS = {
  aggressiveness: 'MEDIA',
  questionCount: 5,
  followUps: 0,
  // Duracion maxima de la entrevista. Es obligatoria: la entrevista nunca queda sin limite de
  // tiempo, asi que un escenario sin duracion guardada (o con un valor vacio/invalido) usa este
  // predeterminado de 5 minutos. La estimacion orientativa es `estimateMinutes()` y NO es un limite.
  estimatedMinutes: 5,
  interviewerRole: '',
  spokespersonRole: '',
  maxAnswerSeconds: null,
  customQuestions: [],
};

const LIMITS = {
  questionCount: [1, 12],
  followUps: [0, 3],
  estimatedMinutes: [1, 120],
  maxAnswerSeconds: [15, 600],
  totalTurns: 30,
  interviewerRole: 120,
  spokespersonRole: 120,
  customQuestions: 12,
  customQuestionChars: 300,
};

// Preguntas personalizadas: textos no vacíos, recortados y sin duplicados.
function normalizeCustomQuestions(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const item of value) {
    const text = String(item ?? '').replace(/\s+/g, ' ').trim().slice(0, LIMITS.customQuestionChars);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= LIMITS.customQuestions) break;
  }
  return out;
}

const MINUTES_PER_TURN = 1.2; // pregunta leída en voz alta + respuesta

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

function intIn(value, [min, max], fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

// Duracion maxima (minutos). A diferencia de los demas campos NO admite "sin valor": un valor
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
// `estimatedMinutes` siempre sale como numero dentro de [1, 120]: un valor ausente, `null`, vacio
// o no numerico cae al predeterminado (5 min) y uno fuera de rango se acota (normalizacion
// documentada). Nunca devuelve `null`: la entrevista no puede quedar sin limite de duracion.
function normalizeInterviewConfig(input) {
  const raw = isObject(input) ? input : {};
  const followUps = intIn(raw.followUps, LIMITS.followUps, DEFAULTS.followUps);
  const maxQuestions = Math.min(LIMITS.questionCount[1], Math.floor(LIMITS.totalTurns / (1 + followUps)));
  const customQuestions = normalizeCustomQuestions(raw.customQuestions).slice(0, maxQuestions);
  const questionCount = intIn(raw.questionCount, [LIMITS.questionCount[0], maxQuestions], DEFAULTS.questionCount);
  return {
    aggressiveness: AGGRESSIVENESS[raw.aggressiveness] ? raw.aggressiveness : DEFAULTS.aggressiveness,
    // Todas las preguntas personalizadas caben: si hay más que preguntas principales, se amplía.
    questionCount: Math.max(questionCount, customQuestions.length),
    followUps,
    estimatedMinutes: durationIn(raw.estimatedMinutes),
    interviewerRole: String(raw.interviewerRole ?? '').trim().slice(0, LIMITS.interviewerRole),
    spokespersonRole: String(raw.spokespersonRole ?? '').trim().slice(0, LIMITS.spokespersonRole),
    maxAnswerSeconds: intIn(raw.maxAnswerSeconds, LIMITS.maxAnswerSeconds, null),
    customQuestions,
  };
}

const totalTurns = (cfg) => cfg.questionCount * (1 + cfg.followUps);

// Config de un tema tal como la ve el frontend: incluye los valores calculados.
// Dos conceptos que NO deben confundirse:
//  - `estimatedMinutes` / `maxDurationMs`: duracion maxima efectiva (obligatoria, compartida por
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
    // Duracion maxima efectiva: siempre existe (predeterminado 5 min si no se guardo ninguna).
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
//  - `requireDuration: true` (rutas que guardan un escenario): la duracion maxima es obligatoria y
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
  // El peor caso se calcula con los valores solicitados, no con los recortados por
  // `normalizeInterviewConfig`: el recorte podría ocultar una configuración inválida.
  const rawQuestions = Number.isFinite(requestedQuestions) && requestedQuestions > 0 ? Math.round(requestedQuestions) : cfg.questionCount;
  const potential = rawQuestions * (1 + budget.perMain);
  if (potential > LIMITS.totalTurns) {
    errors.push({ field: 'turnos', code: 'TURN_LIMIT', potential, limit: LIMITS.totalTurns, budgetPerMain: budget.perMain });
  }
  return { ok: errors.length === 0, errors, cfg, budget, potential, limit: LIMITS.totalTurns };
}

// Cuerpo 422 UNIFORME para una configuracion invalida. Lo usan todas las rutas que guardan un
// escenario, siempre antes de normalizar: asi una configuracion invalida se rechaza con el motivo
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
  normalizeCustomQuestions,
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

