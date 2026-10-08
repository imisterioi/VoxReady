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
  estimatedMinutes: null,
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

// Normaliza lo que envía el cliente o lo guardado en BD (siempre devuelve una config completa)
function normalizeInterviewConfig(input) {
  const raw = isObject(input) ? input : {};
  const followUps = intIn(raw.followUps, LIMITS.followUps, DEFAULTS.followUps);
  const maxQuestions = Math.min(LIMITS.questionCount[1], Math.floor(LIMITS.totalTurns / (1 + followUps)));
  return {
    aggressiveness: AGGRESSIVENESS[raw.aggressiveness] ? raw.aggressiveness : DEFAULTS.aggressiveness,
    questionCount: intIn(raw.questionCount, [LIMITS.questionCount[0], maxQuestions], DEFAULTS.questionCount),
    followUps,
    estimatedMinutes: intIn(raw.estimatedMinutes, LIMITS.estimatedMinutes, null),
    interviewerRole: String(raw.interviewerRole ?? '').trim().slice(0, LIMITS.interviewerRole),
    maxAnswerSeconds: intIn(raw.maxAnswerSeconds, LIMITS.maxAnswerSeconds, null),
  };
}

const totalTurns = (cfg) => cfg.questionCount * (1 + cfg.followUps);

// Config de un tema tal como la ve el frontend: incluye los valores calculados
function resolveInterviewConfig(theme) {
  const cfg = normalizeInterviewConfig(theme?.interviewConfig);
  const total = totalTurns(cfg);
  return {
    ...cfg,
    totalTurns: total,
    estimatedMinutes: cfg.estimatedMinutes ?? Math.max(1, Math.round(total * MINUTES_PER_TURN)),
    estimatedMinutesAuto: cfg.estimatedMinutes == null,
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

module.exports = { AGGRESSIVENESS, DEFAULTS, LIMITS, normalizeInterviewConfig, resolveInterviewConfig, turnPlan, totalTurns };
