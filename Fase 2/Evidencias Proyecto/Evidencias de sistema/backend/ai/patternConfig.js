// Configuración de un patrón de evaluación.
// El configurador maestro puede cambiar:
//  - el peso de cada área en el puntaje global,
//  - el peso de cada criterio dentro de un área,
//  - los rangos ideales de las métricas medidas (voz y cuerpo),
//  - las descripciones que guían a la IA evaluadora (coherencia y empatía),
//  - la exigencia general del evaluador.

// Áreas evaluadas (claves internas estables: los informes antiguos usan las cuatro primeras).
//  coherence → «Control del mensaje», empathy → «Gestión del contexto».
const AREA_KEYS = ['expression', 'voice', 'coherence', 'empathy', 'listening', 'pressure'];

const DEFAULT_CONFIG = {
  strictness: 'normal', // flexible | normal | exigente
  areas: { expression: 20, voice: 20, coherence: 20, empathy: 15, listening: 10, pressure: 15 },

  voice: {
    criteria: {
      // Se muestra al vocero como «Fluidez al hablar» (0-100); el rango ideal sigue en palabras/min.
      wpm: { label: 'Fluidez al hablar', weight: 3, idealMin: 120, idealMax: 165 },
      fillers: { label: 'Muletillas', weight: 3, tolerancePerMin: 2 },
      pauses: { label: 'Pausas largas', weight: 2, tolerancePerAnswer: 1 },
      variation: { label: 'Variación de volumen', weight: 1, idealMin: 35, idealMax: 90, maxOutOfRangeSec: 4 },
      latency: { label: 'Tiempo antes de responder', weight: 1, idealMaxSec: 2.5 },
    },
  },

  expression: {
    criteria: {
      facing: { label: 'Mirada hacia la cámara', weight: 3, idealMinPct: 75 },
      emotions: { label: 'Expresiones faciales', weight: 2, maxNegativePct: 15 },
      posture: { label: 'Postura (pose inicial)', weight: 2, idealMaxDeg: 4, maxOffPoseSec: 6, maxShrinkPct: 10 },
      head: { label: 'Estabilidad de la cabeza', weight: 2 },
      hands: { label: 'Gestos con las manos', weight: 1 },
    },
  },

  coherence: {
    descriptor: 'Un buen vocero controla su mensaje: sostiene los mensajes clave aunque lo presionen, responde lo que se le pregunta y no se contradice.',
    criteria: {
      keyMessages: { label: 'Sostiene los mensajes clave', weight: 3 },
      directness: { label: 'Responde directo, sin evadir', weight: 2 },
      redLines: { label: 'Evita las líneas rojas', weight: 3 },
      clarity: { label: 'Claridad y estructura', weight: 1 },
    },
  },

  empathy: {
    descriptor: 'Lee el contexto de la crisis y responde a él: reconoce explícitamente el impacto en las personas afectadas antes de dar datos técnicos, con un tono humano.',
    visualWeight: 20, // % del área que aporta mirar a la cámara
    criteria: {
      impact: { label: 'Empatía', weight: 3 },
      warmth: { label: 'Calidez y tono humano', weight: 2 },
      responsibility: { label: 'Asume responsabilidad', weight: 2 },
    },
  },

  listening: {
    descriptor: 'Escucha la pregunta completa sin interrumpir al periodista y responde exactamente lo que se le preguntó, sin evadir.',
    criteria: {
      // Medido con el micrófono: voz del vocero mientras el entrevistador habla.
      noInterrupt: { label: 'No interrumpe', weight: 2, tolerance: 0, source: 'mic' },
      noEvade: { label: 'No evade la respuesta', weight: 3 },
      relevance: { label: 'Responde a lo que se pregunta', weight: 2 },
    },
  },

  pressure: {
    descriptor: 'Ante preguntas difíciles u hostiles mantiene la calma, no ataca ni descalifica al periodista y responde de manera diplomática.',
    criteria: {
      hardQuestions: { label: 'Responde las preguntas difíciles', weight: 3 },
      noAttack: { label: 'No ataca a la persona', weight: 3 },
      diplomacy: { label: 'Respuesta diplomática', weight: 2 },
    },
  },
};

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

// Mezcla profunda: lo guardado sobrescribe los valores por defecto
function deepMerge(base, extra) {
  if (!isObject(extra)) return base;
  const out = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    out[key] = isObject(value) && isObject(base[key]) ? deepMerge(base[key], value) : value;
  }
  return out;
}

// Pesos de áreas de un patrón anterior (4 áreas): se reescalan a 75 % y se suman las áreas
// nuevas con su peso recomendado, para que todo patrón guardado siga sumando 100.
function upgradeAreas(areas) {
  if (!isObject(areas) || AREA_KEYS.every((k) => areas[k] != null)) return areas;
  const old = ['expression', 'voice', 'coherence', 'empathy'];
  const extra = { listening: DEFAULT_CONFIG.areas.listening, pressure: DEFAULT_CONFIG.areas.pressure };
  const room = 100 - extra.listening - extra.pressure;
  const sum = old.reduce((s, k) => s + (Number(areas[k]) || 0), 0) || 1;
  const out = {};
  for (const k of old) out[k] = Math.round(((Number(areas[k]) || 0) / sum) * room);
  const diff = room - old.reduce((s, k) => s + out[k], 0);
  out.coherence += diff;
  return { ...out, ...extra };
}

// Configuración completa de un patrón (compatible con patrones antiguos sin "config")
function resolveConfig(pattern) {
  if (!pattern) return DEFAULT_CONFIG;
  const legacy = {
    areas: {
      expression: pattern.expressionWeight,
      voice: pattern.voiceToneWeight,
      coherence: pattern.coherenceWeight,
      empathy: pattern.empathyWeight,
    },
    ...(pattern.empathyDescription ? { empathy: { descriptor: pattern.empathyDescription } } : {}),
  };
  const saved = isObject(pattern.config) ? pattern.config : {};
  const merged = deepMerge(deepMerge(DEFAULT_CONFIG, legacy), saved);
  merged.areas = upgradeAreas({ ...legacy.areas, ...(saved.areas || {}) });
  return normalizeConfig(merged);
}

// Limpia criterios retirados (p. ej. «Presencia en cámara») y fija las etiquetas vigentes:
// las etiquetas no son editables, así que un patrón antiguo no conserva nombres obsoletos.
function normalizeConfig(config) {
  const out = JSON.parse(JSON.stringify(config));
  for (const area of AREA_KEYS) {
    const def = DEFAULT_CONFIG[area];
    if (!def) continue;
    out[area] = out[area] || {};
    const criteria = out[area].criteria || {};
    const clean = {};
    for (const [key, c] of Object.entries(def.criteria)) {
      clean[key] = { ...c, ...(isObject(criteria[key]) ? criteria[key] : {}), label: c.label };
      if (c.source) clean[key].source = c.source;
    }
    out[area].criteria = clean;
  }
  return out;
}

module.exports = { AREA_KEYS, DEFAULT_CONFIG, resolveConfig, deepMerge, normalizeConfig, upgradeAreas };
